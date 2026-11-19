const MeetingBot = require('../bot-core');

class GoogleMeetBot extends MeetingBot {
    constructor(options) {
        super(options);
        this.meetingUrl = options.meetingUrl;
        this.admitted = false;
        this.inLobby = false;
        this.meetingEndAt = options.meetingEndAt ? Number(options.meetingEndAt) : null;
    }

    _meetUrlWithLocale(url) {
        try {
            const u = new URL(url);
            u.searchParams.set('hl', 'en');
            return u.toString();
        } catch {
            return url;
        }
    }

    async _pageText() {
        return (await this.page.evaluate(() => document.body?.innerText || '')).replace(/\s+/g, ' ').trim();
    }

    _isLobbyText(t) {
        return (
            /you.?ll join when someone lets you in/i.test(t) ||
            /asking to (be let in|join)/i.test(t) ||
            /someone will let you in soon/i.test(t) ||
            /instead of waiting to be let in/i.test(t) ||
            /waiting to be let in/i.test(t) ||
            /please wait until a meeting host/i.test(t) ||
            /host brings you into the call/i.test(t)
        );
    }

    _isHardBlockText(t) {
        if (!/you can't join this video call/i.test(t)) return false;
        if (this._isLobbyText(t)) return false;
        if (/your name|ask to join|join now/i.test(t)) return false;
        return true;
    }

    async _humanClick(locator) {
        const box = await locator.boundingBox().catch(() => null);
        if (box) {
            const x = box.x + box.width * (0.35 + Math.random() * 0.3);
            const y = box.y + box.height * (0.35 + Math.random() * 0.3);
            await this.page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 8) });
            await this.page.waitForTimeout(50 + Math.floor(Math.random() * 70));
            await this.page.mouse.click(x, y, { delay: 40 });
            return;
        }
        await locator.click({ force: true });
    }

    async _dismissLobbyModals() {
        const gotIt = this.page.getByRole('button', { name: /^Got it$/i }).first();
        if (await gotIt.isVisible({ timeout: 800 }).catch(() => false)) {
            console.log('[Google Meet] Dismissing sign-in prompt');
            await gotIt.click({ timeout: 2000, force: true }).catch(() => {});
            await this.page.waitForTimeout(400);
        }
    }

    async _isAdmitted() {
        const t = await this._pageText();
        if (this._isLobbyText(t)) return false;
        if (/getting ready|confirm you're not a bot/i.test(t)) return false;

        const ask = await this.page.getByRole('button', { name: /Ask to join|Join now/i }).first()
            .isVisible({ timeout: 300 }).catch(() => false);
        if (ask) return false;

        const leave = await this.page.locator('[aria-label*="Leave call" i], button[aria-label*="Leave call" i]').first()
            .isVisible({ timeout: 400 }).catch(() => false);
        return !!leave;
    }

    async join() {
        try {
            const meetUrl = this._meetUrlWithLocale(this.meetingUrl);
            console.log(`[Google Meet] Navigating to ${meetUrl}...`);
            await this.page.goto(meetUrl, { waitUntil: 'domcontentloaded' });

            console.log('[Google Meet] Waiting for the entry screen...');
            await this.page.waitForTimeout(3500);

            let bodyText = await this._pageText();
            if (this._isHardBlockText(bodyText)) {
                console.error('[Google Meet] BLOCKED before lobby. Guest join rejected — try Chrome profile login or another Meet.');
                await this.close();
                throw new Error('Google Meet blocked guest join before lobby');
            }

            try {
                const dismissBtn = this.page.locator('button[aria-label="Dismiss"]');
                if (await dismissBtn.isVisible({ timeout: 2000 })) {
                    await this._humanClick(dismissBtn);
                    console.log('[Google Meet] Dismissed browser warning banner.');
                    await this.page.waitForTimeout(800);
                }
            } catch (e) {}

            try {
                const nameSelectors = [
                    'input[aria-label="Your name"]',
                    'input[placeholder="Your name"]',
                    'input[type="text"]'
                ];
                for (const sel of nameSelectors) {
                    const input = this.page.locator(sel).first();
                    if (await input.isVisible({ timeout: 1500 }).catch(() => false)) {
                        await input.click({ delay: 30 }).catch(() => {});
                        await input.fill('');
                        await input.type(this.botName, { delay: 40 });
                        console.log(`[Google Meet] Filled name as "${this.botName}"`);
                        break;
                    }
                }
            } catch (e) {}

            console.log('[Google Meet] Muting microphone and camera...');
            for (const sel of [
                'button[aria-label*="Turn off microphone" i]',
                'button[aria-label*="Turn off camera" i]'
            ]) {
                const btn = this.page.locator(sel).first();
                if (await btn.isVisible({ timeout: 800 }).catch(() => false)) {
                    await this._humanClick(btn).catch(() => {});
                }
            }

            console.log(`[Google Meet] Attempting to join as "${this.botName}"...`);
            await this.page.waitForTimeout(1000);

            let joined = false;
            const joinBtnCandidates = [
                this.page.getByRole('button', { name: /Ask to join/i }).first(),
                this.page.getByRole('button', { name: /Join now/i }).first(),
                this.page.getByRole('button', { name: /^Join$/i }).first(),
            ];
            for (const btn of joinBtnCandidates) {
                if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
                    const txt = await btn.textContent().catch(() => '');
                    console.log(`[Google Meet] Found join button: "${(txt || '').trim()}". Clicking...`);
                    try {
                        await this._humanClick(btn);
                        joined = true;
                        break;
                    } catch (err) {
                        console.warn(`[Google Meet] Human click failed:`, err.message);
                        await btn.click({ force: true }).catch(() => {});
                        joined = true;
                        break;
                    }
                }
            }

            if (!joined) {
                const clicked = await this.page.evaluate(() => {
                    const joinKeywords = ['ask to join', 'join now', 'join meeting', 'join'];
                    const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
                    for (const kw of joinKeywords) {
                        const btn = btns.find(b => b.textContent.trim().toLowerCase().includes(kw));
                        if (btn) {
                            btn.click();
                            return btn.textContent.trim();
                        }
                    }
                    return null;
                });
                if (clicked) {
                    console.log(`[Google Meet] Clicked join via DOM eval: "${clicked}"`);
                    joined = true;
                } else {
                    console.log('[Google Meet] Could not find join button. Checking if already inside meeting...');
                }
            }

            console.log('[Google Meet] Waiting for lobby / host Admit...');
            // Wait up to 3 hours in the lobby for the scheduled meeting to start
            const fallbackMs = 3 * 60 * 60 * 1000;
            const endAt = this.meetingEndAt && this.meetingEndAt > Date.now()
                ? this.meetingEndAt
                : (Date.now() + fallbackMs);
            const admitDeadline = Math.max(endAt, Date.now() + 60 * 1000);
            console.log(`[Google Meet] Lobby wait until ${new Date(admitDeadline).toISOString()}`);
            let sawLobby = false;
            while (Date.now() < admitDeadline) {
                await this._dismissLobbyModals();
                bodyText = await this._pageText();

                if (this._isHardBlockText(bodyText)) {
                    console.error('[Google Meet] HARD_BLOCK after Ask to join (Google bot detection).');
                    await this.close();
                    return;
                }

                if (this._isLobbyText(bodyText)) {
                    this.inLobby = true;
                    if (!sawLobby) {
                        console.log('[Google Meet] In waiting room — host must Admit the bot.');
                        sawLobby = true;
                    }
                }

                if (await this._isAdmitted()) {
                    console.log('[Google Meet] Admitted to meeting!');
                    this.admitted = true;
                    // Start Video Recording immediately after admission
                    await this.startVideoRecording();
                    this.inLobby = false;
                    break;
                }

                await this.page.waitForTimeout(2000);
            }

            if (!(await this._isAdmitted())) {
                console.error('[Google Meet] Timed out waiting to be admitted. Still in lobby or blocked.');
                await this.close();
                throw new Error('Timed out waiting to be admitted to Google Meet');
            }
            
            // Post notification in chat
            await this.postChatNotification();
            
            // CRITICAL: Open the People panel in the bot's browser.
            // This is invisible to other participants but ensures the ES310d volume
            // indicator elements are always in the DOM for speaker detection.
            console.log('[Google Meet] Opening People panel for speaker detection...');
            await this.openPeoplePanel();
            
            // Inject Google Meet specific active speaker observer
            console.log('[Google Meet] Injecting active speaker DOM observer...');
            await this.page.evaluate(() => {
                let lastActiveSpeaker = null;
                let pendingSpeaker = null;
                let pendingSpeakerCount = 0;
                const REQUIRED_CONSECUTIVE_POLLS = 1; // Fast 300ms confirmation for real-time speech
                
                setInterval(() => {
                    try {
                        if (!window.reportActiveSpeaker) return;
                        let activeSpeaker = null;
                        let maxVolume = 0;

                        // 1. Check People panel listitems
                        const listItems = document.querySelectorAll('[role="listitem"]');
                        for (const item of listItems) {
                            const indicator = item.querySelector('[jscontroller="ES310d"]');
                            if (!indicator || indicator.children.length !== 3) continue;
                            const style = window.getComputedStyle(indicator);
                            if (style.display === 'none' || style.visibility === 'hidden') continue;
                            
                            const r1 = indicator.children[0].getBoundingClientRect();
                            const r2 = indicator.children[1].getBoundingClientRect();
                            const r3 = indicator.children[2].getBoundingClientRect();
                            
                            const totalVolume = r1.height + r2.height + r3.height;
                            if (totalVolume > 10 && totalVolume > maxVolume) {
                                const nameSpan = item.querySelector('.zWGUib');
                                let rawName = nameSpan ? nameSpan.textContent.trim() : (item.getAttribute('aria-label') || '');
                                
                                if (rawName.toLowerCase().includes('presenting')) continue;

                                let name = rawName.replace(/\(You\)/gi, '').replace(/\bYou\b/gi, '').replace(/Meeting host/gi, '').trim();
                                if (name && name.length > 0 && name.length <= 50) {
                                    activeSpeaker = name;
                                    maxVolume = totalVolume;
                                }
                            }
                        }

                        // 2. Fallback: video tiles — pick loudest active speaker (works without People panel)
                        const activeTiles = document.querySelectorAll('[data-requested-participant-id], div[data-participant-id], [data-self-name]');
                        for (const tile of activeTiles) {
                            const indicator = tile.querySelector('[jscontroller="ES310d"]');
                            let tileVolume = 0;
                            if (indicator && indicator.children.length === 3) {
                                const r1 = indicator.children[0].getBoundingClientRect();
                                const r2 = indicator.children[1].getBoundingClientRect();
                                const r3 = indicator.children[2].getBoundingClientRect();
                                tileVolume = r1.height + r2.height + r3.height;
                            } else if (tile.querySelector('.kssM5b, .ES310d')) {
                                tileVolume = 12;
                            }
                            if (tileVolume <= 10 || tileVolume <= maxVolume) continue;

                            let rawName = tile.getAttribute('data-self-name') || '';
                            if (!rawName) {
                                const nameEl = tile.querySelector('.zWGUib, .cS7aqe, .dwSJ2e');
                                rawName = nameEl ? nameEl.textContent.trim() : '';
                            }
                            if (!rawName) continue;
                            if (rawName.toLowerCase().includes('presenting')) continue;

                            const name = rawName.replace(/\(You\)/gi, '').replace(/\bMeeting host\b/gi, '').trim();
                            if (name && name.length > 0 && name.length <= 50) {
                                activeSpeaker = name;
                                maxVolume = tileVolume;
                            }
                        }
                        
                        if (activeSpeaker) {
                            if (!lastActiveSpeaker || activeSpeaker !== lastActiveSpeaker) {
                                console.log('[Meet Observer] Active speaker detected: ' + activeSpeaker);
                                lastActiveSpeaker = activeSpeaker;
                                window.reportActiveSpeaker(activeSpeaker);
                            }
                        }
                    } catch (e) {
                        console.error('[Meet Observer] Error:', e);
                    }
                }, 300);
            });
            
            console.log('[Google Meet] Bot successfully joined and notified. WebRTC interceptor should be streaming audio.');
            console.log('[Google Meet] Transcript path: dom_mono only (CC disabled).');

        } catch (error) {
            console.error('[Google Meet] Error during automation:', error);
            this.admitted = false;
            await this.close();
            throw error;
        }
    }

    async turnOnCaptions() {
        try {
            console.log('[Google Meet] Enabling captions (CC fallback)...');
            const btn = this.page.locator(
                'button[aria-label*="Turn on captions" i], button[aria-label*="captions" i], button[aria-label*="Captions" i]'
            ).first();
            if (await btn.isVisible({ timeout: 4000 }).catch(() => false)) {
                await btn.click({ force: true }).catch(() => {});
                console.log('[Google Meet] Captions button clicked.');
                await this.page.waitForTimeout(800);
            } else {
                console.log('[Google Meet] Captions button not found (may already be on).');
            }
        } catch (e) {
            console.warn('[Google Meet] Could not enable captions:', e.message);
        }
    }

    async setupCaptionFallback() {
        try {
            const CaptionExtractor = require('../caption-extractor');
            await CaptionExtractor.setupGoogleMeet(this.page, (speaker, text, blockId) => {
                if (typeof this.onTranscript === 'function') {
                    this.onTranscript(speaker, text, blockId);
                }
            });
            console.log('[Google Meet] CC fallback scraper registered.');
        } catch (e) {
            console.warn('[Google Meet] CC fallback setup failed:', e.message);
        }
    }

    async openPeoplePanel() {
        try {
            // The People tab in Google Meet is a DIV with jscontroller="XvR1Cc"
            // or text starting with "People" — NOT a standard button with aria-label="people"
            const clicked = await this.page.evaluate(() => {
                // Try jscontroller="XvR1Cc" first (the People tab div)
                const peopleTab = document.querySelector('[jscontroller="XvR1Cc"]');
                if (peopleTab) { peopleTab.click(); return 'jscontroller XvR1Cc'; }
                
                // Fallback: find any element whose text starts with "People" and is in the sidebar tabs
                const allEls = Array.from(document.querySelectorAll('div[role], span, div'));
                const tab = allEls.find(el => {
                    const txt = el.textContent.trim();
                    return txt.startsWith('People') && txt.length < 15;
                });
                if (tab) { tab.click(); return 'text: ' + tab.textContent.trim(); }
                
                return null;
            });
            
            if (clicked) {
                console.log('[Google Meet] People panel opened via: ' + clicked);
                await this.page.waitForTimeout(1500);
            } else {
                console.warn('[Google Meet] Could not find People tab to open.');
            }
            
            // Keep the panel open - re-click if ES310d elements disappear
            setInterval(async () => {
                try {
                    if (!this.page) return;
                    const isOpen = await this.page.evaluate(() => {
                        return document.querySelectorAll('[jscontroller="ES310d"]').length > 0;
                    });
                    if (!isOpen) {
                        await this.page.evaluate(() => {
                            const tab = document.querySelector('[jscontroller="XvR1Cc"]');
                            if (tab) tab.click();
                        });
                    }
                } catch (e) { /* ignore */ }
            }, 5000);
            
        } catch (e) {
            console.error('[Google Meet] openPeoplePanel error:', e.message);
        }
    }

    async postChatNotification() {

        try {
            console.log('[Google Meet] Opening chat to post notification...');
            // Try different variants of the chat button
            const chatButton = this.page.locator('button[aria-label*="chat" i], button[aria-label*="Chat" i]').first();
            if (await chatButton.isVisible({ timeout: 5000 })) {
                await chatButton.click().catch(() => {});
                
                // Wait for text area
                const textArea = this.page.locator('textarea').first();
                await textArea.waitFor({ state: 'visible', timeout: 5000 });
                
                // Type and send
                await textArea.fill('🤖 Xobin is now recording this meeting for real-time transcription.');
                await this.page.keyboard.press('Enter');
                
                console.log('[Google Meet] Notification sent.');
                
                // Close chat to save space
                const closeChat = this.page.locator('button[aria-label*="close" i], button[aria-label*="Close" i]').first();
                if (await closeChat.isVisible({ timeout: 2000 })) {
                    await closeChat.click().catch(() => {});
                }
            }
        } catch (error) {
            console.error('[Google Meet] Failed to post chat notification:', error.message);
        }
    }

    async setMicMuted(mute) {
        if (!this.page) return;
        try {
            console.log(`[Google Meet] Attempting to set mic muted = ${mute}`);
            
            // Move mouse to reveal bottom bar just in case
            await this.page.mouse.move(500, 500);
            
            await this.page.evaluate((targetMute) => {
                const btns = Array.from(document.querySelectorAll('button'));
                const micBtn = btns.find(b => {
                    const label = ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('data-tooltip') || '')).toLowerCase();
                    // MUST have data-is-muted attribute to avoid clicking other people's mic icons in the People panel
                    return b.hasAttribute('data-is-muted') && (label.includes('microphone') || label.includes('mic '));
                });
                
                if (!micBtn) {
                    console.error('[Google Meet] Main mic button not found in DOM!');
                    return;
                }
                
                const label = ((micBtn.getAttribute('aria-label') || '') + ' ' + (micBtn.getAttribute('data-tooltip') || '')).toLowerCase();
                const isCurrentlyMuted = label.includes('turn on') || micBtn.dataset.isMuted === 'true';
                
                if (targetMute && !isCurrentlyMuted) {
                    micBtn.click();
                } else if (!targetMute && isCurrentlyMuted) {
                    micBtn.click();
                }
            }, mute);
        } catch (error) {
            console.error('[Google Meet] Failed to toggle mic:', error);
        }
    }

    async getParticipants() {
        if (!this.page) return [];
        if (!this.admitted) return [];
        try {
            let list = await this.page.evaluate(() => {
                const names = new Set();

                // 1. Self name from the data attribute
                document.querySelectorAll('[data-self-name]').forEach(el => {
                    const n = el.getAttribute('data-self-name')?.trim();
                    if (n) names.add(n);
                });

                // 2. Participant name spans (Google Meet's class for display names)
                document.querySelectorAll('span.zWGUib').forEach(el => {
                    const n = el.textContent?.trim();
                    if (n) names.add(n);
                });

                // 3. Video tile name overlays
                document.querySelectorAll('div.XEazBc .cS7aqe, div.dwSJ2e').forEach(el => {
                    const n = el.textContent?.trim();
                    if (n) names.add(n);
                });

                // Clean: strip "(You)" suffix and dedup repeated names
                const cleaned = new Set();
                names.forEach(raw => {
                    let name = raw.replace(/\s*\(You\)\s*$/i, '').trim();
                    if (name.length < 2) return;
                    cleaned.add(name);
                });

                return Array.from(cleaned);
            });
            if (!list.length) {
                await this.openPeoplePanel().catch(() => {});
                await this.page.waitForTimeout(600);
                list = await this.page.evaluate(() => {
                    const names = new Set();
                    document.querySelectorAll('[data-self-name]').forEach(el => {
                        const n = el.getAttribute('data-self-name')?.trim();
                        if (n) names.add(n);
                    });
                    document.querySelectorAll('span.zWGUib').forEach(el => {
                        const n = el.textContent?.trim();
                        if (n) names.add(n);
                    });
                    document.querySelectorAll('[role="listitem"]').forEach(item => {
                        const span = item.querySelector('span.zWGUib, .cS7aqe, .dwSJ2e');
                        const n = span ? span.textContent.trim() : '';
                        if (n && n.length >= 2) names.add(n);
                    });
                    const cleaned = new Set();
                    names.forEach(raw => {
                        const name = raw.replace(/\s*\(You\)\s*$/i, '').trim();
                        if (name.length >= 2) cleaned.add(name);
                    });
                    return Array.from(cleaned);
                });
            }
            console.log("[Google Meet] Extracted participants: ", list);
            if (this.onParticipantsUpdate) this.onParticipantsUpdate(list);
            return list;
        } catch (e) {
            console.error('[Google Meet] Error fetching participants:', e);
            return [];
        }
    }
}

module.exports = GoogleMeetBot;
