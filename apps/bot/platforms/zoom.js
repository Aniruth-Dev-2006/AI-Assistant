const MeetingBot = require('../bot-core');
const { createCursor } = require('ghost-cursor-playwright');

class ZoomBot extends MeetingBot {
    constructor(options) {
        super(options);
        // Convert the meeting URL to the standard Web Client Guest Join URL
        // Handles: /j/12345, /wc/12345/start, /wc/join/12345
        let url = options.meetingUrl;
        try {
            const zoomRegex = /\/(?:j|wc|wc\/join)\/(\d+)/;
            const match = url.match(zoomRegex);
            if (match && match[1]) {
                const meetingId = match[1];
                const urlObj = new URL(url);
                // Preserve query params like ?pwd=...
                url = `${urlObj.origin}/wc/join/${meetingId}${urlObj.search}`;
            }
        } catch(e) {}
        this.meetingUrl = url;
    }

    async _ghostClick(cursor, locator) {
        try {
            if (!cursor) throw new Error("No cursor");
            const box = await locator.boundingBox();
            if (!box) throw new Error("No bounding box");
            
            if (cursor.actions && typeof cursor.actions.click === 'function') {
                await cursor.actions.click({ target: box });
            } else if (typeof cursor.click === 'function') {
                // Fallback for puppeteer API compat
                await cursor.click(box);
            } else {
                throw new Error("cursor.click is not a function");
            }
        } catch (e) {
            console.log(`[Zoom] Ghost click fallback executed for locator:`, e.message);
            await locator.click({ force: true });
        }
    }

    async join() {
        try {
            console.log(`[Zoom] Navigating to ${this.meetingUrl}...`);
            await this.page.goto(this.meetingUrl, { waitUntil: 'domcontentloaded' });
            
            // Initialize ghost cursor
            const cursor = await createCursor(this.page);
            console.log('[Zoom] Ghost cursor initialized.');

            console.log('[Zoom] Waiting for the entry screen...');
            await this.page.waitForTimeout(4000);

            // Handle the "I Agree" button for Terms of Service if it appears
            try {
                const agreeBtn = this.page.locator('button', { hasText: /I Agree/i }).first();
                if (await agreeBtn.isVisible({ timeout: 3000 })) {
                    console.log('[Zoom] Clicking Terms of Service Agree button...');
                    await this._ghostClick(cursor, agreeBtn);
                    await this.page.waitForTimeout(2000);
                }
            } catch (e) {}

            // Handle the Name input
            try {
                console.log('[Zoom] Looking for Name Input...');
                const nameInputLocators = [
                    'input[placeholder*="Name" i]',
                    'input[name="inputname"]',
                    'input#inputname',
                    'input[type="text"]'
                ];
                let foundNameInput = null;
                for (const sel of nameInputLocators) {
                    const el = this.page.locator(sel).first();
                    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
                        foundNameInput = el;
                        break;
                    }
                }

                if (foundNameInput) {
                    console.log(`[Zoom] Filling name as "${this.botName}"`);
                    try {
                        await this._ghostClick(cursor, foundNameInput);
                    } catch (e) {
                        await foundNameInput.click();
                    }
                    await foundNameInput.press('Control+A');
                    await this.page.waitForTimeout(80 + Math.floor(Math.random() * 120));
                    await foundNameInput.press('Backspace');
                    for (const ch of this.botName) {
                        await this.page.keyboard.type(ch, { delay: 70 + Math.floor(Math.random() * 140) });
                    }
                    await this.page.waitForTimeout(400 + Math.floor(Math.random() * 600));
                } else {
                    console.log('[Zoom] Could not find name input.');
                }
            } catch (e) {
                console.log('[Zoom] Error while filling name input:', e.message);
            }

            // Mute mic and video on the pre-join screen via cursor (Headless-safe bypass)
            try {
                console.log('[Zoom] Looking for pre-join video/mic toggles...');
                // Give React time to render
                await this.page.waitForTimeout(2000);
                
                // 1. Try to find video toggle
                const videoBtn = this.page.locator('button[aria-label*="turn off my video" i], button[aria-label*="stop video" i], input[name="video"], input#video, label:has-text("Turn off my video")').first();
                if (await videoBtn.isVisible({ timeout: 2000 })) {
                    console.log('[Zoom] Toggling Video off...');
                    await this._ghostClick(cursor, videoBtn).catch(() => videoBtn.click({ force: true }));
                    await this.page.waitForTimeout(500);
                }

                // 2. Try to find mic toggle
                const micBtn = this.page.locator('button[aria-label*="mute my microphone" i], button[aria-label*="mute" i]:not([aria-label*="unmute" i]), input[name="audio"], input#audio, label:has-text("Don\'t connect to audio")').first();
                if (await micBtn.isVisible({ timeout: 2000 })) {
                    console.log('[Zoom] Toggling Mic off...');
                    await this._ghostClick(cursor, micBtn).catch(() => micBtn.click({ force: true }));
                    await this.page.waitForTimeout(500);
                }
                
                console.log('[Zoom] Pre-join devices configured.');
            } catch (e) {
                console.log('[Zoom] Failed to toggle pre-join devices:', e.message);
            }

            // Click Join button if present on the entry screen
            try {
                console.log('[Zoom] Looking for Join button...');
                const joinBtn = this.page.locator('button', { hasText: /Join/i }).first();
                if (await joinBtn.isVisible({ timeout: 2000 })) {
                    console.log('[Zoom] Clicking Join button...');
                    try {
                        await this._ghostClick(cursor, joinBtn);
                    } catch (e) {
                        await joinBtn.click({ force: true });
                    }
                    await this.page.waitForTimeout(4000);
                } else {
                    console.log('[Zoom] No Join button found.');
                }
            } catch (e) {
                console.log('[Zoom] Join error:', e.message);
            }

            console.log('[Zoom] Waiting for meeting controls (admission)...');
            try {
                // Wait for the Participants or Leave button which signifies we are truly inside the meeting
                await this.page.waitForSelector(
                    'button[aria-label*="Participants" i], button[aria-label*="Leave" i]',
                    { timeout: 90000 }
                );
                console.log('[Zoom] Admitted to meeting!');
                await this.startVideoRecording();
            } catch (e) {
                console.error('[Zoom] Timed out waiting to be admitted. Still in waiting room or blocked.');
                await this.close();
                return;
            }
            
            // Handle Join Audio by Computer (MUST HAPPEN AFTER ADMISSION)
            try {
                console.log('[Zoom] Checking for Join Audio options...');
                // Sometimes it's a footer button first
                const joinAudioFooterBtn = this.page.locator('button[aria-label*="Join Audio" i], button:has-text("Join Audio")').first();
                if (await joinAudioFooterBtn.isVisible({ timeout: 2000 })) {
                    await this._ghostClick(cursor, joinAudioFooterBtn);
                    await this.page.waitForTimeout(1000);
                }
                
                const joinAudioBtn = this.page.locator('button', { hasText: /Join Audio by Computer/i }).first();
                if (await joinAudioBtn.isVisible({ timeout: 5000 })) {
                    console.log('[Zoom] Clicking Join Audio by Computer...');
                    await this._ghostClick(cursor, joinAudioBtn);
                    await this.page.waitForTimeout(2000);
                }
            } catch (e) {}
            
            // Post notification in chat
            await this.postChatNotification(cursor);

            // Open Participants panel so Strategy 2 (Participants List Fallback) actually works!
            await this.openParticipantsPanel(cursor);

            // Switch to Gallery View for active speaker border detection
            await this.switchToGalleryView(cursor);

            // Inject Zoom specific active speaker observer
            await this.setupActiveSpeakerObserver();
            
            console.log('[Zoom] Bot successfully joined. Transcript path: dom_mono only (CC disabled).');

        } catch (error) {
            console.error('[Zoom] Error during automation:', error);
            await this.close();
        }
    }

    async switchToGalleryView(cursor) {
        try {
            console.log('[Zoom] Ensuring Gallery View is active for speaker detection...');
            
            // Wiggle mouse to wake up the control bar
            await this.page.mouse.move(500, 500);
            await this.page.waitForTimeout(500);
            await this.page.mouse.move(510, 510);
            await this.page.waitForTimeout(1000);

            // Locate the View button (top right usually)
            const viewBtn = this.page.locator('button[aria-label*="View" i], button:has-text("View")').first();
            if (await viewBtn.isVisible({ timeout: 10000 })) {
                try { if (cursor) await this._ghostClick(cursor, viewBtn); else await viewBtn.click({ force: true }); }
                catch(e) { await viewBtn.click({ force: true }); }
                
                await this.page.waitForTimeout(1500);

                // Locate the Gallery View option
                const galleryOption = this.page.locator('a[aria-label*="Gallery View" i], a:has-text("Gallery View"), [data-rr-ui-dropdown-item]:has-text("Gallery View")').first();
                if (await galleryOption.isVisible({ timeout: 5000 })) {
                    try { if (cursor) await this._ghostClick(cursor, galleryOption); else await galleryOption.click({ force: true }); }
                    catch(e) { await galleryOption.click({ force: true }); }
                    
                    console.log('[Zoom] Successfully switched to Gallery View.');
                    await this.page.waitForTimeout(1000);
                } else {
                    console.log('[Zoom] Gallery View option not found in menu. It might already be active or the menu differs.');
                    await this.page.mouse.click(100, 100); // Close menu
                }
            } else {
                console.log('[Zoom] View button not visible. Skipping Gallery View switch.');
            }
        } catch (e) {
            console.warn('[Zoom] Could not switch to Gallery View:', e.message);
        }
    }

    async setupActiveSpeakerObserver() {
        try {
            console.log('[Zoom] Injecting active speaker DOM observer...');
            await this.page.evaluate(() => {
                let lastActiveSpeaker = null;
                let pendingSpeaker = null;
                let pendingSpeakerCount = 0;
                const REQUIRED_CONSECUTIVE_POLLS = 3; // 900ms of sustained audio to confirm switch

                setInterval(() => {
                    try {
                        if (!window.reportActiveSpeaker) return;
                        let activeSpeaker = null;

                        // Strategy 1: Zoom Gallery View active speaker container
                        const activeFrame = document.querySelector('.gallery-video-container__video-frame--active');
                        if (activeFrame) {
                            const nameEl = activeFrame.querySelector('.video-avatar__avatar-footer span, .video-avatar__avatar-footer, .video-avatar__avatar-name');
                            if (nameEl) {
                                let name = nameEl.textContent.trim();
                                name = name.replace(/\(You\)/gi, '').replace(/\bYou\b/gi, '').replace(/\(Host, me\)/gi, '').replace(/\(Host\)/gi, '').trim();
                                if (name && name.length > 0 && name.length <= 50) {
                                    activeSpeaker = name;
                                }
                            }
                        }

                        // Strategy 2: Participants List active speaker (Fallback)
                        if (!activeSpeaker) {
                            const participants = document.querySelectorAll('.participants-li');
                            for (const p of participants) {
                                const ariaLabel = (p.getAttribute('aria-label') || '').toLowerCase();
                                const isSpeaking = ariaLabel.includes('speaking') || 
                                                   p.querySelector('canvas') || // Audio volume meter
                                                   p.querySelector('[class*="audio-on"]') ||
                                                   p.querySelector('[class*="speaking"]');
                                
                                if (isSpeaking) {
                                    const nameEl = p.querySelector('.participants-item__display-name');
                                    if (nameEl) {
                                        let name = nameEl.textContent.trim();
                                        name = name.replace(/\(You\)/gi, '').replace(/\bYou\b/gi, '').replace(/\(Host, me\)/gi, '').replace(/\(Host\)/gi, '').trim();
                                        if (name && name.length > 0) {
                                            activeSpeaker = name;
                                            break;
                                        }
                                    }
                                }
                            }
                        }

                        if (activeSpeaker) {
                            if (!lastActiveSpeaker) {
                                console.log('[Zoom Observer] First speaker detected: ' + activeSpeaker);
                                lastActiveSpeaker = activeSpeaker;
                                window.reportActiveSpeaker(activeSpeaker);
                            } else if (activeSpeaker === lastActiveSpeaker) {
                                pendingSpeaker = null;
                                pendingSpeakerCount = 0;
                            } else if (activeSpeaker === pendingSpeaker) {
                                pendingSpeakerCount++;
                                if (pendingSpeakerCount >= REQUIRED_CONSECUTIVE_POLLS) {
                                    console.log('[Zoom Observer] Speaker switch confirmed: ' + activeSpeaker);
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
                        console.error('[Zoom Observer] Error:', e);
                    }
                }, 300);
            });
        } catch (e) {
            console.error('[Zoom] Failed to inject active speaker observer:', e.message);
        }
    }

    async getParticipants() {
        if (!this.page) return [];
        try {
            const scrape = () => this.page.evaluate(() => {
                // Only real roster rows — not footer/settings chrome
                return Array.from(document.querySelectorAll('.participants-li .participants-item__display-name'))
                    .map((el) => el.textContent
                        .replace(/\(You\)/gi, '')
                        .replace(/\(Me\)/gi, '')
                        .replace(/\(Host,\s*me\)/gi, '')
                        .replace(/\(Host\)/gi, '')
                        .replace(/\(Co-host\)/gi, '')
                        .trim())
                    .filter((name) => name.length > 0);
            });

            let list = await scrape();
            if (!list.length) {
                await this.openParticipantsPanel().catch(() => {});
                await this.page.waitForTimeout(800);
                list = await scrape();
            }

            const uniqueParticipants = [...new Set(list)];
            if (uniqueParticipants.length) {
                console.log('[Zoom] Extracted participants:', uniqueParticipants);
            }
            if (this.onParticipantsUpdate) this.onParticipantsUpdate(uniqueParticipants);
            return uniqueParticipants;
        } catch (e) {
            console.error('[Zoom] Error fetching participants:', e);
            return [];
        }
    }

    async openParticipantsPanel(cursor) {
        try {
            console.log('[Zoom] Opening Participants panel...');

            await this.page.mouse.move(500, 500);
            await this.page.waitForTimeout(400);
            await this.page.mouse.move(510, 510);
            await this.page.waitForTimeout(400);

            const panelOpen = await this.page.locator('.participants-li, .participants-item, [id^="participants-list-"]').first().isVisible({ timeout: 800 }).catch(() => false);
            if (panelOpen) return;

            const participantsBtn = this.page.locator('button[aria-label*="participants" i], button:has-text("Participants")').first();
            if (!(await participantsBtn.isVisible({ timeout: 5000 }))) return;

            if (cursor) {
                try {
                    await this._ghostClick(cursor, participantsBtn);
                } catch (e) {
                    await participantsBtn.evaluate((b) => b.click()).catch(() => participantsBtn.click({ force: true }));
                }
            } else {
                await participantsBtn.evaluate((b) => b.click()).catch(() => participantsBtn.click({ force: true }));
            }

            try {
                await this.page.waitForSelector('.participants-li, .participants-item', { timeout: 5000 });
            } catch (e) {}
        } catch (e) {
            console.warn('[Zoom] Could not open Participants panel:', e.message);
        }
    }

    async postChatNotification(cursor) {
        try {
            console.log('[Zoom] Opening chat to post notification...');
            // In Zoom web, chat button usually has aria-label="open the chat panel" or similar
            const chatBtn = this.page.locator('button[aria-label*="chat" i]').first();
            
            // Wait up to 15 seconds for the UI to fully load after admission
            if (await chatBtn.isVisible({ timeout: 15000 })) {
                try {
                    if (cursor) await this._ghostClick(cursor, chatBtn);
                    else await chatBtn.click({ force: true });
                } catch (e) {
                    await chatBtn.click({ force: true });
                }
                
                const textArea = this.page.locator('.tiptap[contenteditable="true"], div[contenteditable="true"]').first();
                await textArea.waitFor({ state: 'visible', timeout: 5000 });
                
                try {
                    if (cursor) await this._ghostClick(cursor, textArea);
                    else await textArea.click();
                } catch(e) {
                    await textArea.click({ force: true });
                }
                
                // ProseMirror/Tiptap needs a moment after click to focus the internal <p> tag
                await this.page.waitForTimeout(500);
                
                await this.page.keyboard.type('🤖 Xobin is now recording this meeting for real-time transcription.', { delay: 10 });
                await this.page.keyboard.press('Enter');
                
                console.log('[Zoom] Notification sent.');
                
                // Close chat to save space (click it again)
                try {
                    if (cursor) await this._ghostClick(cursor, chatBtn);
                    else await chatBtn.click({ force: true });
                } catch(e) {}
            } else {
                console.log('[Zoom] Chat button never became visible.');
            }
        } catch (error) {
            console.error('[Zoom] Failed to post chat notification:', error.message);
        }
    }

    async setMicMuted(mute) {
        if (!this.page) return;
        try {
            console.log(`[Zoom] Attempting to set mic muted = ${mute}`);
            
            // Ensure bottom bar is visible
            await this.page.mouse.move(500, 500);
            
            // 1. Check if we haven't even joined audio yet!
            const joinAudioFooterBtn = this.page.locator('button[aria-label*="Join Audio" i], button:has-text("Join Audio")').first();
            if (await joinAudioFooterBtn.isVisible({ timeout: 500 })) {
                console.log('[Zoom] Audio not joined yet. Clicking Join Audio footer button...');
                await joinAudioFooterBtn.click({ force: true });
                await this.page.waitForTimeout(1000);
                
                // Now click "Join Audio by Computer" modal button
                const joinByComputerBtn = this.page.locator('button', { hasText: /Join Audio by Computer/i }).first();
                if (await joinByComputerBtn.isVisible({ timeout: 2000 })) {
                    await joinByComputerBtn.click({ force: true });
                    await this.page.waitForTimeout(1000);
                }
            }
            
            // 2. Find the actual Mute/Unmute button in the footer to check the current state
            // We explicitly look for "my microphone/audio" or the footer container to avoid matching participant list mute buttons!
            const audioBtn = this.page.locator('button[aria-label*="mute my" i], button[aria-label*="unmute my" i], .footer-button__button:has-text("Mute"), .footer-button__button:has-text("Unmute"), button:has-text("Unmute")').first();
            
            // Wait for it to exist in the DOM
            await audioBtn.waitFor({ state: 'attached', timeout: 2000 }).catch(() => {});
            
            if (await audioBtn.count() > 0) {
                const label = (await audioBtn.getAttribute('aria-label') || await audioBtn.innerText() || '').toLowerCase();
                const isCurrentlyMuted = label.includes('unmute');
                
                if (mute && !isCurrentlyMuted) {
                    console.log('[Zoom] Muting mic via Keyboard Alt+A shortcut...');
                    await this.page.keyboard.press('Alt+a');
                    await this.page.waitForTimeout(500); // Wait for state to change
                } else if (!mute && isCurrentlyMuted) {
                    console.log('[Zoom] Unmuting mic via Keyboard Alt+A shortcut...');
                    await this.page.keyboard.press('Alt+a');
                    await this.page.waitForTimeout(500); // Wait for state to change
                } else {
                    console.log(`[Zoom] Mic is already in requested state (muted=${mute}).`);
                }
            } else {
                console.log('[Zoom] Could not find mute/unmute button in DOM. Attempting blind fallback keyboard shortcut Alt+A...');
                await this.page.keyboard.press('Alt+a');
            }
        } catch (e) {
            console.error('[Zoom] Failed to toggle mic:', e);
        }
    }

    async turnOnCaptions() {
        try {
            console.log('[Zoom] Ensuring Live Captions are turned on...');
            await this.page.waitForTimeout(1500);

            // Check if captions container already exists
            const isAlreadyOn = await this.page.evaluate(() => {
                const container = document.querySelector('.caption-container') || 
                                  document.querySelector('.meeting-app__captions-container') ||
                                  document.querySelector('div[aria-label*="Captions"]');
                return !!container;
            });

            if (isAlreadyOn) {
                console.log('[Zoom] Live captions already active.');
                return;
            }

            // Method 1: Shortcut Alt+C (Zoom native shortcut for captions)
            console.log('[Zoom] Trying Alt+C shortcut...');
            await this.page.keyboard.press('Alt+c');
            await this.page.waitForTimeout(1500);

            // Method 2: Click "Show Captions" / "Live Transcript" button in toolbar
            const ccBtn = this.page.locator('button[aria-label*="Show captions" i], button[aria-label*="Captions" i], button[aria-label*="Live Transcript" i], button:has-text("Show Captions")').first();
            if (await ccBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                await ccBtn.click({ force: true });
                console.log('[Zoom] Clicked Show Captions button.');
            }
        } catch (e) {
            console.warn('[Zoom] Error turning on captions:', e.message);
        }
    }

    async setupCaptionObserver() {
        await this.page.evaluate(() => {
            let lastSpeakerText = '';
            let lastBlockId = null;

            function scrapeZoomCaptions() {
                try {
                    const container = document.querySelector('.caption-container') || 
                                      document.querySelector('.meeting-app__captions-container') ||
                                      document.querySelector('div[aria-label*="Captions"]') ||
                                      document.querySelector('[data-testid="caption-item"]');
                    if (!container) return;

                    const items = container.querySelectorAll('.caption-item, [data-testid="caption-item"], .meeting-app__caption-item, div[class*="caption"]');
                    const targetEl = items.length > 0 ? items[items.length - 1] : container;

                    // 1. Extract speaker
                    const speakerEl = targetEl.querySelector('.caption-speaker, [class*="speaker"], [class*="name"], strong');
                    let currentSpeaker = speakerEl ? speakerEl.innerText.trim().replace(/:$/, '') : 'Speaker';

                    // 2. Extract text
                    const textEl = targetEl.querySelector('.caption-content, .caption-text, [class*="content"], [class*="text"], span') || targetEl;
                    let fullDomText = textEl ? textEl.innerText.trim() : '';

                    // Strip speaker from text if it was included
                    if (currentSpeaker && fullDomText.startsWith(currentSpeaker)) {
                        fullDomText = fullDomText.substring(currentSpeaker.length).replace(/^:\s*/, '').trim();
                    }

                    // 3. Assign blockId
                    if (!targetEl.__blockId) {
                        window._zoomCaptionBlockCounter = (window._zoomCaptionBlockCounter || 0) + 1;
                        targetEl.__blockId = window._zoomCaptionBlockCounter;
                    }
                    const blockId = targetEl.__blockId;

                    if (fullDomText && (fullDomText !== lastSpeakerText || blockId !== lastBlockId)) {
                        lastSpeakerText = fullDomText;
                        lastBlockId = blockId;
                        if (window.onNewTranscript) {
                            window.onNewTranscript(currentSpeaker || 'Speaker', fullDomText, blockId);
                        }
                    }
                } catch (e) {}
            }

            const observer = new MutationObserver(() => {
                scrapeZoomCaptions();
            });
            observer.observe(document.body, { childList: true, subtree: true, characterData: true });

            setInterval(scrapeZoomCaptions, 100);

            console.log('[Zoom] Ultra-realtime CC block scraper active.');
        });
    }
}

module.exports = ZoomBot;
