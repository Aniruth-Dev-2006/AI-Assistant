const MeetingBot = require('../bot-core');

class TeamsBot extends MeetingBot {
    constructor(options) {
        super(options);
        this.meetingUrl = options.meetingUrl;
    }

    async join() {
        try {
            console.log(`[MS Teams] Navigating to ${this.meetingUrl}...`);
            await this.page.goto(this.meetingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await this.page.waitForTimeout(4000);

            console.log('[MS Teams] Handling "How do you want to join?" prompt...');
            const browserJoinLocators = [
                'button:has-text("Continue on this browser")',
                '[data-tid="joinOnWeb"]',
                'a:has-text("Join on the web instead")'
            ];

            let clickedBrowserJoin = false;
            for (const sel of browserJoinLocators) {
                const btn = this.page.locator(sel).first();
                if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await btn.click().catch(() => {});
                    console.log(`[MS Teams] Clicked "Continue on browser": ${sel}`);
                    clickedBrowserJoin = true;
                    break;
                }
            }
            
            if (clickedBrowserJoin) {
                console.log('[MS Teams] Waiting for Teams Web Client to load...');
                await this.page.waitForTimeout(15000); // Wait for the main Teams web app to load
            }

            console.log('[MS Teams] Looking for Name Input...');
            let frame = this.page.frames().find(f => f.url().includes('teams.microsoft.com') || f.url().includes('teams.live.com')) || this.page;
            
            const nameInputSel = 'input[placeholder="Type your name"], input[placeholder="Enter name"], input[id="username"], input[aria-label="Type your name"]';
            let filledName = false;
            
            try {
                // Try the standard way first
                let el = frame.locator(nameInputSel).first();
                if (!await el.isVisible({ timeout: 5000 }).catch(() => false)) {
                    // Fallback to searching ALL frames for ANY text input if the main frame fails
                    console.log('[MS Teams] Falling back to broad search for Name input...');
                    for (const f of this.page.frames()) {
                        const fallbackEl = f.locator('input[type="text"], [role="textbox"], input').first();
                        if (await fallbackEl.isVisible({ timeout: 1000 }).catch(() => false)) {
                            el = fallbackEl;
                            frame = f; // Update the frame reference for later
                            break;
                        }
                    }
                }
                
                await el.waitFor({ state: 'visible', timeout: 5000 });
                await el.click().catch(() => {});
                await this.page.keyboard.type(this.botName);
                console.log(`[MS Teams] Filled name "${this.botName}"`);
                filledName = true;
            } catch (e) {
                console.warn('[MS Teams] Could not find any Name input. Error:', e.message);
            }

            // Mute mic and cam before joining via evaluate (Headless-safe)
            console.log('[MS Teams] Muting microphone and camera...');
            try {
                await frame.evaluate(() => {
                    // Try finding video toggle
                    const videoToggle = document.querySelector('input[data-tid="toggle-video"], button[data-tid="toggle-video"]');
                    if (videoToggle) {
                        // Check if it's an input checkbox or a button with aria-checked
                        const isVideoOn = videoToggle.type === 'checkbox' ? videoToggle.checked : videoToggle.getAttribute('aria-checked') === 'true';
                        if (isVideoOn) videoToggle.click();
                    }

                    // Try finding mic toggle
                    const micToggle = document.querySelector('input[data-tid="toggle-mute"], button[data-tid="toggle-mute"]');
                    if (micToggle) {
                        const isMicOn = micToggle.type === 'checkbox' ? micToggle.checked : micToggle.getAttribute('aria-checked') === 'true';
                        if (isMicOn) micToggle.click();
                    }
                });
                console.log('[MS Teams] Pre-join devices configured.');
            } catch (e) {
                console.warn('[MS Teams] Failed to toggle pre-join devices via evaluate:', e.message);
            }

            console.log('[MS Teams] Looking for Join Button...');
            let clickedJoin = false;
            try {
                // Keep trying to click Join using evaluate for up to 10 seconds
                for (let i = 0; i < 5; i++) {
                    const joined = await frame.evaluate(() => {
                        const joinBtns = Array.from(document.querySelectorAll('button'));
                        const joinBtn = joinBtns.find(b => b.textContent.trim().toLowerCase() === 'join now' || b.textContent.trim().toLowerCase() === 'join') || 
                                        document.querySelector('[data-tid="prejoin-join-button"]');
                        if (joinBtn && !joinBtn.disabled) {
                            joinBtn.click();
                            return true;
                        }
                        return false;
                    });
                    if (joined) {
                        clickedJoin = true;
                        console.log('[MS Teams] Clicked Join button via evaluate.');
                        break;
                    }
                    await this.page.waitForTimeout(2000);
                }
            } catch (e) {
                console.warn('[MS Teams] Evaluate join error:', e.message);
            }
            
            if (!clickedJoin) {
                console.warn('[MS Teams] Could not find Join button before timeout.');
            }

            console.log('[MS Teams] Waiting for meeting controls (admission)...');
            // Wait up to 3 hours in the lobby for the scheduled meeting to start
            const deadline = Date.now() + (3 * 60 * 60 * 1000);
            let admitted = false;
            
            while (Date.now() < deadline) {
                await this.page.waitForTimeout(2000);
                
                // Re-evaluate frame in case of navigation
                frame = this.page.frames().find(f => f.url().includes('teams.microsoft.com')) || this.page;
                const joined = await frame.evaluate(() => {
                    const chatIcon = document.querySelector('button[aria-label="Chat"], button[id="chat-button"]');
                    const rosterIcon = document.querySelector('#roster-button, button[aria-label="People"]');
                    return chatIcon !== null || rosterIcon !== null;
                });
                
                if (joined) {
                     console.log('[MS Teams] Admitted to meeting!');
                     admitted = true;
                     await this.startVideoRecording();
                     break;
                }
            }

            if (!admitted) {
                console.error('[MS Teams] Timed out waiting to be admitted. Still in lobby or blocked.');
                await this.close();
                return;
            }

            // Post chat notification
            await this.postChatNotification(frame);

            // Open the People panel
            console.log('[MS Teams] Opening People panel...');
            await this.openPeoplePanel();
            
            // Set View to Speaker Mode
            console.log('[MS Teams] Setting View to Speaker Mode...');
            await this.setSpeakerView();

            // Inject Teams specific active speaker observer
            console.log('[MS Teams] Injecting active speaker DOM observer...');
            await this.page.evaluate(() => {
                let lastActiveSpeaker = null;
                let pendingSpeaker = null;
                let pendingSpeakerCount = 0;
                const REQUIRED_CONSECUTIVE_POLLS = 3; // 900ms of sustained audio to confirm switch // Instant switch to catch short phrases
                
                setInterval(() => {
                    try {
                        if (!window.reportActiveSpeaker) return;
                        
                        let activeSpeaker = null;
                        
                        const frames = [document, ...Array.from(window.frames).map(f => {
                            try { return f.document; } catch(e) { return null; }
                        }).filter(Boolean)];
                        
                        for (const doc of frames) {
                            const voiceOutlines = doc.querySelectorAll('[data-tid="voice-level-stream-outline"]');
                            for (const outline of voiceOutlines) {
                                const style = window.getComputedStyle(outline);
                                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.opacity === '0.0') continue;
                                if (outline.clientWidth === 0 || outline.clientHeight === 0) continue;
                                
                                // 1. Check the gallery tile (purple outline)
                                const container = outline.closest('div[role="region"], div[data-tid*="video-stream"], div[data-tid*="participant"]') || outline.parentElement.parentElement.parentElement;
                                if (container) {
                                    // CRITICAL: Ensure the outline is ACTUALLY active by checking stroke/fill opacities in SVGs
                                    const svgChild = outline.querySelector('path, circle, rect');
                                    if (svgChild) {
                                        const svgStyle = window.getComputedStyle(svgChild);
                                        if (svgStyle.strokeOpacity === '0' || svgStyle.fillOpacity === '0') continue; // It's invisible!
                                    }

                                    // CRITICAL: Ensure they are not muted on screen
                                    const isMuted = container.querySelector('[data-tid*="mute"], [class*="mute"], svg[aria-label*="Muted" i], [title*="Muted" i]');
                                    if (isMuted) continue; // They can't be speaking!

                                    // Find the name label inside this specific participant's container
                                    const nameEl = container.querySelector('span[title], div[title]');
                                    if (nameEl && nameEl.getAttribute('title')) {
                                        activeSpeaker = nameEl.getAttribute('title').trim();
                                    } else {
                                        const fallbackName = container.querySelector('[data-tid*="name"], span[dir="auto"]');
                                        if (fallbackName) {
                                            activeSpeaker = fallbackName.innerText.trim();
                                        } else {
                                            activeSpeaker = container.innerText.trim().split('\n')[0];
                                        }
                                    }
                                    
                                    if (activeSpeaker) {
                                        activeSpeaker = activeSpeaker.replace(/\(Guest\)/gi, '').replace(/\(External\)/gi, '').trim();
                                        break;
                                    }
                                }
                            }
                            if (activeSpeaker) break;
                            
                            // 2. Fallback: Roster / People panel (safe mode)
                            if (!activeSpeaker) {
                                const rosterItems = doc.querySelectorAll('[data-cid="roster-participant"]');
                                
                                // Let's also find all unmuted participants as a last resort fallback
                                const unmutedParticipants = [];

                                for (const item of rosterItems) {
                                    const ariaLabel = (item.getAttribute('aria-label') || '').toLowerCase();
                                    
                                    // CRITICAL: If the person is muted, they cannot be speaking!
                                    if (ariaLabel.includes('muted') && !ariaLabel.includes('unmuted')) {
                                        continue; 
                                    }
                                    
                                    // Determine name
                                    let personName = '';
                                    const nameSpan = item.querySelector('.fui-TreeItemPersonaLayout__main span[title]');
                                    if (nameSpan) {
                                        personName = nameSpan.getAttribute('title').trim();
                                    } else {
                                        personName = ariaLabel.split(',')[0].trim();
                                    }
                                    personName = personName.replace(/\(Guest\)/gi, '').replace(/\(External\)/gi, '').trim();

                                    if (personName) {
                                        unmutedParticipants.push(personName);
                                    }

                                    // Check if actively speaking visually
                                    const isSpeaking = item.querySelector('[class*="speaking"], [class*="active-speaker"], [data-tid*="speaking"], [data-tid*="active-speaker"], svg[aria-label*="speaking" i]') || ariaLabel.includes('speaking');
                                    
                                    if (isSpeaking) {
                                        activeSpeaker = personName;
                                        break;
                                    }
                                }

                                // 3. Ultra-Fallback: If no visual indicator, but only ONE person is unmuted (and it's not the bot), assume it's them!
                                if (!activeSpeaker && unmutedParticipants.length > 0) {
                                    // Remove the bot from the unmuted list just in case
                                    const realPeople = unmutedParticipants.filter(n => !/xobin|xora/i.test(n));
                                    if (realPeople.length === 1) {
                                        activeSpeaker = realPeople[0];
                                    }
                                }
                            }
                            if (activeSpeaker) break;
                        }
                        
                        if (activeSpeaker) {
                            if (!lastActiveSpeaker) {
                                console.log('[Teams Observer] First speaker detected: ' + activeSpeaker);
                                lastActiveSpeaker = activeSpeaker;
                                window.reportActiveSpeaker(activeSpeaker);
                            } else if (activeSpeaker === lastActiveSpeaker) {
                                pendingSpeaker = null;
                                pendingSpeakerCount = 0;
                            } else if (activeSpeaker === pendingSpeaker) {
                                pendingSpeakerCount++;
                                if (pendingSpeakerCount >= REQUIRED_CONSECUTIVE_POLLS) {
                                    console.log('[Teams Observer] Speaker switch confirmed: ' + activeSpeaker);
                                    lastActiveSpeaker = activeSpeaker;
                                    window.reportActiveSpeaker(activeSpeaker);
                                    pendingSpeaker = null;
                                    pendingSpeakerCount = 0;
                                }
                            } else {
                                pendingSpeaker = activeSpeaker;
                                pendingSpeakerCount = 1;
                            }
                        }
                    } catch (e) {
                        console.error('[Teams Observer] Error:', e);
                    }
                }, 300);
            });

            console.log('[MS Teams] Bot successfully joined and notified. WebRTC interceptor should be streaming audio.');
            console.log('[MS Teams] Transcript path: dom_mono only (CC disabled).');

        } catch (error) {
            console.error('[MS Teams] Error during automation:', error);
            await this.close();
        }
    }

    async setupCaptionFallback() {
        try {
            const CaptionExtractor = require('../caption-extractor');
            await CaptionExtractor.setupTeams(this.page, (speaker, text, blockId) => {
                if (typeof this.onTranscript === 'function') {
                    this.onTranscript(speaker, text, blockId);
                }
            });
            console.log('[MS Teams] CC fallback scraper registered (EN captions when host enables).');
        } catch (e) {
            console.warn('[MS Teams] CC fallback setup failed:', e.message);
        }
    }

    async setSpeakerView() {
        try {
            const frame = this.page.frames().find(f => f.url().includes('teams.microsoft.com') || f.url().includes('teams.live.com')) || this.page;
            
            // 1. Find and click the "View" button in the toolbar
            const viewBtn = frame.locator('#view-mode-button, button[data-tid="view-mode-button"], button[aria-label="View"]').first();
            if (await viewBtn.isVisible({ timeout: 5000 })) {
                // Use evaluate to force click and bypass any tooltip overlays
                await viewBtn.evaluate(b => b.click()).catch(() => viewBtn.click({ force: true }));
                await this.page.waitForTimeout(1500); // Give the menu a moment to animate in
                
                // 2. Find and click the "Speaker" option in the dropdown menu
                const clicked = await frame.evaluate(() => {
                    // Try exact IDs first, then fallback to searching the menu items for "Speaker"
                    const speakerBtn = document.querySelector('#custom-view-button-SpeakerViewButton, [data-inp="custom-view-button-SpeakerViewButton"], [data-track-module-name="speakerViewButton"]') || 
                                     Array.from(document.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"]')).find(el => el.textContent.includes('Speaker'));
                    
                    if (speakerBtn) {
                        speakerBtn.click();
                        return true;
                    }
                    return false;
                });

                if (clicked) {
                    console.log('[MS Teams] Successfully clicked Speaker View.');
                } else {
                    console.log('[MS Teams] Speaker view option not found in menu. DOM might be too slow.');
                }
            } else {
                console.log('[MS Teams] View button not found in toolbar.');
            }
        } catch (e) {
            console.warn('[MS Teams] Could not set Speaker view:', e.message);
        }
    }

    async openPeoplePanel(cursor) {
        try {
            console.log('[Teams] Opening People panel...');
            const frame = this.page.frames().find(f => f.url().includes('teams.microsoft.com') || f.url().includes('teams.live.com')) || this.page;
            
            const peopleBtn = frame.locator('#roster-button, button[aria-label="People"], button[data-inp="roster-button"]').first();
            if (await peopleBtn.isVisible({ timeout: 5000 })) {
                try {
                    if (cursor) await cursor.click(peopleBtn);
                    else await peopleBtn.click({ force: true });
                } catch (e) {
                    await peopleBtn.evaluate(b => b.click()).catch(() => peopleBtn.click({ force: true }));
                }
                await this.page.waitForTimeout(1000);
            }
        } catch (e) {
            console.warn('[Teams] Could not open People panel:', e.message);
        }
    }

    async getParticipants() {
        if (!this.page) {
            const err = { error: 'Please wait for the bot to join the meeting.' };
            if (this.onParticipantsUpdate) this.onParticipantsUpdate(err);
            return err;
        }
        try {
            const frame = this.page.frames().find(f => f.url().includes('teams.microsoft.com') || f.url().includes('teams.live.com')) || this.page;
            
            // Ensure People panel is open before scraping (Teams lazy-loads the DOM!)
            const isPanelOpen = await frame.evaluate(() => document.querySelector('[data-tid="calling-right-side-panel"]') !== null);
            if (!isPanelOpen) {
                console.log('[Teams] People panel is closed! Re-opening before scraping...');
                const peopleBtn = frame.locator('#roster-button, button[aria-label="People"], button[data-inp="roster-button"]').first();
                if (await peopleBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
                    await peopleBtn.evaluate(b => b.click()).catch(() => peopleBtn.click({ force: true }).catch(()=>{}));
                    await this.page.waitForTimeout(1000); // Wait for React to render the tree
                }
            }

            let list = [];
            
            // Search across all frames to handle nested/multiple frames
            for (const f of this.page.frames()) {
                const namesInFrame = await f.evaluate(() => {
                    const names = [];
                    const items = document.querySelectorAll('[data-cid="roster-participant"]');
                    items.forEach(item => {
                        const nameSpan = item.querySelector('.fui-TreeItemPersonaLayout__main span[title]');
                        if (nameSpan) {
                            names.push(nameSpan.getAttribute('title').trim());
                        } else {
                            const ariaLabel = item.getAttribute('aria-label');
                            if (ariaLabel) {
                                names.push(ariaLabel.split(',')[0].trim());
                            }
                        }
                    });
                    return names;
                }).catch(() => []);
                list = list.concat(namesInFrame);
            }
            
            // Clean up suffixes and deduplicate
            list = Array.from(new Set(list))
                .map(name => name.replace(/\(Unverified\)/gi, '').replace(/\(Guest\)/gi, '').replace(/\(External\)/gi, '').trim())
                .filter(n => n && n.length > 0);
            
            console.log(`[Teams] Extracted participants: ${JSON.stringify(list)}`);
            if (this.onParticipantsUpdate) this.onParticipantsUpdate(list);
            return list;
        } catch (e) {
            console.error('[Teams] Error fetching participants:', e);
            if (this.onParticipantsUpdate) this.onParticipantsUpdate([]);
            return [];
        }
    }

    async postChatNotification(frame) {
        try {
            console.log('[MS Teams] Opening chat to post notification...');
            // In Teams, chat button often has id="chat-button" or aria-label="Chat"
            const chatBtn = frame.locator('button[aria-label="Chat"], button[id="chat-button"]').first();
            if (await chatBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
                await chatBtn.click().catch(() => {});
                await this.page.waitForTimeout(2000);
                
                // Wait for the new message box
                const editor = frame.locator('div[aria-label="Type a new message"], div[data-tid="ckeditor-messageEditor"]').first();
                if (await editor.isVisible({ timeout: 5000 }).catch(() => false)) {
                    await editor.click().catch(() => {});
                    await this.page.keyboard.type('🤖 Xobin is now recording this meeting for real-time transcription.');
                    await this.page.keyboard.press('Enter');
                    console.log('[MS Teams] Notification sent.');
                }
            }
        } catch (error) {
            console.error('[MS Teams] Failed to post chat notification:', error.message);
        }
    }

    async setMicMuted(mute) {
        if (!this.page) return;
        try {
            console.log(`[MS Teams] Attempting to set mic muted = ${mute}`);
            const frame = this.page.frames().find(f => f.url().includes('teams.microsoft.com') || f.url().includes('teams.live.com')) || this.page;
            
            await frame.evaluate((targetMute) => {
                const micBtn = document.getElementById('mic-button');
                
                if (!micBtn) {
                    console.error('[MS Teams] Mic button not found in DOM!');
                    return;
                }
                
                const label = (micBtn.getAttribute('aria-label') || '').toLowerCase();
                const isCurrentlyMuted = label.includes('unmute');
                
                if (targetMute && !isCurrentlyMuted) {
                    micBtn.click();
                } else if (!targetMute && isCurrentlyMuted) {
                    micBtn.click();
                }
            }, mute);
        } catch (e) {
            console.error('[MS Teams] Failed to toggle mic:', e);
        }
    }
}

module.exports = TeamsBot;
