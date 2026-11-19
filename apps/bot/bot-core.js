const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const stealth = StealthPlugin();
stealth.enabledEvasions.delete('iframe.contentWindow');
stealth.enabledEvasions.delete('media.codecs');
chromium.use(stealth);
const path = require('path');
const fs = require('fs');

class MeetingBot {
    constructor(options = {}) {
        const os = require('os');
        let baseDir = os.tmpdir();
        try {
            const { app } = require('electron');
            if (app) baseDir = app.getPath('userData');
        } catch(e) {}
        const sessionKey = String(options.sessionKey || `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`)
            .replace(/[^\w-]/g, '_')
            .slice(0, 64);
        this.userDataDir = path.join(baseDir, 'bot_profiles', sessionKey);
        try { fs.mkdirSync(this.userDataDir, { recursive: true }); } catch (_) {}
        this.executablePath = options.executablePath || null;
        this.botName = options.botName || 'Xobin';
        this.meetingUrl = options.meetingUrl || '';
        this.onAudioChunk = options.onAudioChunk || (() => {});
        this.onActiveSpeaker = options.onActiveSpeaker || (() => {});
        this.onParticipantsUpdate = options.onParticipantsUpdate || null;
        this._diagFilePath = null;
        this._lastParticipants = [];
        
        this.context = null;
        this.page = null;
    }

    async _exposeBridge(name, fn) {
        const targets = [];
        if (this.context && typeof this.context.exposeFunction === 'function') targets.push(this.context);
        if (this.page && typeof this.page.exposeFunction === 'function') targets.push(this.page);
        let lastErr = null;
        for (const target of targets) {
            try {
                await target.exposeFunction(name, fn);
                return;
            } catch (e) {
                lastErr = e;
                const msg = String((e && e.message) || e || '');
                if (/already registered|has been already/i.test(msg)) return;
            }
        }
        if (lastErr) console.warn(`[Bot Core] exposeFunction ${name} failed:`, lastErr.message);
    }

    async startVideoRecording() {
        if (!this.page) return;
        try {
            console.log('[Bot Core] Starting headless video recording...');
            await this.page.evaluate(async () => {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
                    console.error('[Browser] getDisplayMedia not supported');
                    return;
                }
                
                try {
                    const stream = await navigator.mediaDevices.getDisplayMedia({
                        video: { frameRate: 15 },
                        audio: false,
                        preferCurrentTab: true
                    });
                    
                    const mimeTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
                    const selectedMimeType = mimeTypes.find(mime => MediaRecorder.isTypeSupported(mime));
                    
                    if (!selectedMimeType) {
                        console.error('[Browser] No supported video/webm mime type found');
                        return;
                    }
                    
                    console.log(`[Browser] Started MediaRecorder with ${selectedMimeType}`);
                    const mediaRecorder = new MediaRecorder(stream, { mimeType: selectedMimeType });
                    
                    mediaRecorder.ondataavailable = async (event) => {
                        if (event.data && event.data.size > 0) {
                            const buffer = await event.data.arrayBuffer();
                            let binary = '';
                            const bytes = new Uint8Array(buffer);
                            for (let i = 0; i < bytes.byteLength; i++) {
                                binary += String.fromCharCode(bytes[i]);
                            }
                            const base64 = btoa(binary);
                            if (window.saveVideoChunkBase64) {
                                window.saveVideoChunkBase64(base64).catch(e => console.error('[Browser] Error sending chunk', e));
                            }
                        }
                    };
                    
                    // Send chunk every 1000ms
                    mediaRecorder.start(1000);
                    window.__botVideoRecorder = mediaRecorder;
                } catch (e) {
                    console.error('[Browser] Failed to start video recording', e);
                }
            });
        } catch (e) {
            console.error('[Bot Core] Error initiating video recording:', e.message);
        }
    }

    detectPlatform(url) {
        const u = String(url || this.meetingUrl || '').toLowerCase();
        if (u.includes('zoom.')) return 'zoom';
        if (u.includes('teams.microsoft') || u.includes('teams.live')) return 'teams';
        if (u.includes('meet.google')) return 'gmeet';
        return 'unknown';
    }

    formatWebRtcDiagBanner(payload, participants) {
        const lines = [];
        lines.push('=== WEBRTC AUDIO DIAGNOSTIC ===');
        lines.push('');
        lines.push(`Platform: ${payload.platform || 'unknown'}`);
        lines.push(`Reason: ${payload.reason || ''}`);
        lines.push(`Time: ${new Date(payload.ts || Date.now()).toISOString()}`);
        lines.push(`Meeting URL: ${payload.meetingUrl || ''}`);
        lines.push('');
        lines.push(`PeerConnections: ${payload.peerConnectionCount || 0}`);
        (payload.peerConnections || []).forEach((pc, i) => {
            lines.push('');
            lines.push(`PeerConnection #${i + 1} (${pc.pcId})`);
            lines.push(`  signaling=${pc.signalingState} ice=${pc.iceConnectionState} conn=${pc.connectionState}`);
            lines.push(`  localDesc=${pc.hasLocalDescription} remoteDesc=${pc.hasRemoteDescription}`);
            lines.push(`  receivers=${pc.receiverCount} audioTracks=${pc.audioTrackCount}`);
            (pc.receivers || []).filter((r) => r.kind === 'audio').forEach((r) => {
                lines.push(`  audio receiver[${r.receiver}]:`);
                lines.push(`    trackId=${r.trackId} label=${r.label || ''}`);
                lines.push(`    readyState=${r.readyState} muted=${r.muted}`);
                lines.push(`    mid=${r.mid} direction=${r.direction} currentDirection=${r.currentDirection}`);
                lines.push(`    syncSources=${JSON.stringify(r.syncSources || [])}`);
                lines.push(`    contribSources=${JSON.stringify(r.contribSources || [])}`);
            });
        });
        lines.push('');
        const sdp = payload.sdpSummary;
        if (sdp) {
            lines.push('Remote SDP summary:');
            lines.push(`  audio m-lines: ${sdp.audioMLines}`);
            lines.push(`  recvonly/sendrecv/sendonly audio: ${sdp.recvonlyAudio}/${sdp.sendrecvAudio}/${sdp.sendonlyAudio}`);
            lines.push(`  SSRC count: ${sdp.ssrcCount} ids=${JSON.stringify(sdp.ssrcs || [])}`);
            lines.push(`  MSID count: ${sdp.msidCount} ids=${JSON.stringify(sdp.msids || [])}`);
        } else {
            lines.push('Remote SDP summary: (none yet)');
        }
        lines.push('');
        lines.push(`Mixer track count: ${payload.mixerTrackCount || 0}`);
        lines.push(`Mixer track ids: ${JSON.stringify(payload.mixerTrackIds || [])}`);
        const paths = (payload.capturePaths || []).slice(-8);
        lines.push(`Capture paths (recent): ${JSON.stringify(paths)}`);
        lines.push('');
        const names = Array.isArray(participants) ? participants : [];
        lines.push(`Participant count: ${names.length}`);
        lines.push(`Participant metadata: ${names.length ? names.join(', ') : '(none)'}`);
        lines.push('Participant/audio mapping: NONE FOUND');
        lines.push('');
        const audioReceivers = (payload.peerConnections || []).reduce((n, pc) => {
            return n + (pc.receivers || []).filter((r) => r.kind === 'audio').length;
        }, 0);
        const audioTracks = (payload.peerConnections || []).reduce((n, pc) => n + (pc.audioTrackCount || 0), 0);
        let conclusion = 'INCONCLUSIVE';
        if (audioTracks <= 1 && (payload.mixerTrackCount || 0) <= 1) {
            conclusion = 'SINGLE MIXED AUDIO TRACK LIKELY';
        } else if (audioTracks > 1 || (payload.mixerTrackCount || 0) > 1) {
            conclusion = 'MULTIPLE AUDIO TRACKS OBSERVED (inspect receivers before concluding participant-level)';
        }
        lines.push(`Audio receivers (all PCs): ${audioReceivers}`);
        lines.push(`Remote audio tracks (all PCs): ${audioTracks}`);
        lines.push(`Conclusion: ${conclusion}`);
        lines.push('');
        lines.push('===============================');
        return lines.join('\n');
    }

    async init(loginMode = false) {
        console.log('[Bot Core] Launching browser session in ' + this.userDataDir + '...');

        // Delete lockfile to prevent zombie browser issues (cross-platform)
        try {
            const lockfile = path.join(this.userDataDir, 'SingletonLock');
            if (fs.existsSync(lockfile)) fs.unlinkSync(lockfile);
            const lockfile2 = path.join(this.userDataDir, 'lockfile');
            if (fs.existsSync(lockfile2)) fs.unlinkSync(lockfile2);
        } catch (e) {}

        const platform = this.detectPlatform(this.meetingUrl);
        // Fake media device = Chrome's green test pattern. Zoom treats that as a bot.
        // Keep auto-grant permissions; only use the fake device on Meet where we mute anyway.
        const args = [
            '--use-fake-ui-for-media-stream',
            '--autoplay-policy=no-user-gesture-required',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--window-size=1280,800',
            '--lang=en-US',
            '--accept-lang=en-US,en',
            '--disable-features=AudioServiceOutOfProcess,AudioServiceSandbox,CalculateNativeWinOcclusion',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling'
        ];
        if (platform === 'gmeet') {
            args.push('--use-fake-device-for-media-stream');
        }
        // --no-sandbox is a Zoom/Chrome bot fingerprint. Only allow when explicitly required (Linux containers).
        if (process.env.BOT_NO_SANDBOX === '1') {
            args.push('--no-sandbox');
            console.warn('[BotCore] BOT_NO_SANDBOX=1 — Zoom may flag this as automation');
        }
        if (process.env.BOT_DEBUG === '1') {
            args.push('--remote-debugging-port=9222');
        }

        // Meet blocks true headless guest joins. Default: headed Chrome parked off-screen
        // so the window isn't visible but WebRTC/TTS still work. Set BOT_TRUE_HEADLESS=1 to force.
        const trueHeadless = process.env.BOT_TRUE_HEADLESS === '1';
        const hideWindow = !trueHeadless && process.env.BOT_SHOW_BROWSER !== '1';
        if (hideWindow) {
            args.push('--window-position=-32000,-32000');
        }

        const launchOptions = {
            headless: trueHeadless,
            ignoreDefaultArgs: ['--enable-automation'],
            permissions: ['camera', 'microphone'],
            locale: 'en-US',
            args
        };
        
        if (this.executablePath) {
            launchOptions.executablePath = this.executablePath;
        } else {
            if (process.env.BOT_BROWSER_CHANNEL) {
                launchOptions.channel = process.env.BOT_BROWSER_CHANNEL;
                console.log(`[BotCore] Using requested channel: ${launchOptions.channel}`);
            } else if (platform === 'gmeet' || platform === 'zoom') {
                launchOptions.channel = 'chrome';
                console.log(`[BotCore] Using Google Chrome channel for ${platform} join`);
            } else if (process.platform === 'win32') {
                launchOptions.channel = 'msedge';
                console.log('[BotCore] Auto-falling back to Microsoft Edge channel on Windows');
            }
        }

        console.log('[BotCore] Launching browser', {
            headless: trueHeadless,
            hideWindow,
            platform,
            fakeDevice: platform === 'gmeet',
            noSandbox: process.env.BOT_NO_SANDBOX === '1'
        });

        try {
            this.context = await chromium.launchPersistentContext(this.userDataDir, launchOptions);
        } catch (e) {
            if (launchOptions.channel === 'chrome') {
                console.warn('[BotCore] Chrome channel failed, falling back:', e.message);
                delete launchOptions.channel;
                if (process.platform === 'win32') {
                    const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
                    if (fs.existsSync(edgePath)) launchOptions.executablePath = edgePath;
                }
                this.context = await chromium.launchPersistentContext(this.userDataDir, launchOptions);
            } else {
                throw e;
            }
        }

        // If the browser crashed previously, Chromium might restore old tabs (like a previous GMeet).
        // We must proactively close all extra tabs so they don't run in the background.
        const pages = this.context.pages();
        if (pages.length > 0) {
            this.page = pages[0];
            for (let i = 1; i < pages.length; i++) {
                try { await pages[i].close(); } catch(e) {}
            }
        } else {
            this.page = await this.context.newPage();
        }

        // Auto-close any extraneous popups or tabs (like Teams /gather) so they don't steal focus
        this.context.on('page', async (newPage) => {
            console.log('[Bot Core] A new tab opened. Automatically closing it to prevent focus stealing...');
            try {
                await newPage.close();
            } catch (e) {}
        });

        // Forward browser console logs to Node terminal for debugging interceptor
        this.page.on('console', msg => console.log(`[Browser] ${msg.text()}`));

        if (loginMode) {
            console.log('[Bot Core] Navigating to Google Login...');
            console.log('[Bot Core] Please sign in, then close the browser window.');
            await this.page.goto('https://accounts.google.com', { waitUntil: 'networkidle' });
            return false; // Stop further execution
        }

            this._audioLogCount = 0;
            this._trackAudioLogCount = 0;
            await this._exposeBridge('sendAudioChunkBase64', (base64Str) => {
                try {
                    const buffer = Buffer.from(base64Str, 'base64');
                    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length);
                    const floatArray = new Float32Array(arrayBuffer);
                    if (floatArray.length > 0) {
                        if (this._audioLogCount < 3) {
                            this._audioLogCount++;
                            console.log(`[Bot Core] Mixed audio chunk #${this._audioLogCount} samples=${floatArray.length}`);
                        }
                        this.onAudioChunk(floatArray);
                    }
                } catch (err) {
                    console.error('[Bot Core] Audio decode error:', err.message);
                }
            });

            await this._exposeBridge('sendAudioTrackChunkBase64', (trackId, base64Str) => {
                try {
                    if (typeof this.onAudioTrackChunk !== 'function') return;
                    const buffer = Buffer.from(base64Str, 'base64');
                    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length);
                    const floatArray = new Float32Array(arrayBuffer);
                    if (floatArray.length > 0) {
                        if (this._trackAudioLogCount < 3) {
                            this._trackAudioLogCount++;
                            console.log(`[Bot Core] Track audio chunk #${this._trackAudioLogCount} track=${trackId} samples=${floatArray.length}`);
                        }
                        this.onAudioTrackChunk(String(trackId || ''), floatArray);
                    }
                } catch (err) {
                    console.error('[Bot Core] Track audio decode error:', err.message);
                }
            });
        // Video recording receiver
        await this._exposeBridge('saveVideoChunkBase64', (base64Str) => {
            try {
                if (!this._videoRecordPath) {
                    const os = require('os');
                    const path = require('path');
                    const fs = require('fs');
                    const dir = path.join(os.tmpdir(), 'ai-meet-assistant-videos');
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    this._videoRecordPath = path.join(dir, `${this.sessionId || 'recording'}.webm`);
                    console.log(`[Bot Core] Started saving video to ${this._videoRecordPath}`);
                }
                const buffer = Buffer.from(base64Str, 'base64');
                require('fs').appendFileSync(this._videoRecordPath, buffer);
            } catch (err) {
                console.error('[Bot Core] Error saving video chunk:', err.message);
            }
        });

        // Expose function for active speaker
        await this._exposeBridge('reportActiveSpeaker', (name) => {
            this.onActiveSpeaker(name);
        });

        await this._exposeBridge('onNewTranscript', (speaker, text, blockId) => {
            if (typeof this.onTranscript === 'function') {
                this.onTranscript(speaker, text, blockId);
            }
        });

        // Expose function for participant list
        await this._exposeBridge('reportParticipants', (list) => {
            this._lastParticipants = Array.isArray(list) ? list : [];
            if (this.onParticipantsUpdate) this.onParticipantsUpdate(list);
        });

        const debugAudio = process.env.DEBUG_WEBRTC_AUDIO === '1';
        if (debugAudio) {
            const diagDir = path.join(__dirname, '.diag');
            try { fs.mkdirSync(diagDir, { recursive: true }); } catch (e) {}
            this._diagFilePath = path.join(diagDir, `webrtc-audio-${Date.now()}.jsonl`);
            console.log(`[Bot Core] DEBUG_WEBRTC_AUDIO=1 — writing diagnostics to ${this._diagFilePath}`);
            await this.page.exposeFunction('reportWebRtcAudioDiag', (payload) => {
                try {
                    const participants = this._lastParticipants || [];
                    const enriched = { ...payload, participants };
                    fs.appendFileSync(this._diagFilePath, JSON.stringify(enriched) + '\n');
                    const reason = String(payload.reason || '');
                    const print =
                        reason === 'pc-create' ||
                        reason === 'setRemoteDescription' ||
                        reason.startsWith('capture:') ||
                        (reason === 'poll-3s' && (!this._diagPollCount || (this._diagPollCount % 3) === 0));
                    if (reason === 'poll-3s') this._diagPollCount = (this._diagPollCount || 0) + 1;
                    if (print) {
                        console.log(this.formatWebRtcDiagBanner(enriched, participants));
                    }
                } catch (err) {
                    console.error('[Bot Core] WebRTC diag error:', err.message);
                }
            });
        }

        // Start mixed-mono; bot-manager promotes __BOT_MULTICHANNEL when tracks bind.
        const multichannel = false;
        const prelude = `
            window.__DEBUG_WEBRTC_AUDIO = ${debugAudio ? 'true' : 'false'};
            window.__BOT_PLATFORM = ${JSON.stringify(platform)};
            window.__BOT_MEETING_URL = ${JSON.stringify(this.meetingUrl || '')};
            window.__BOT_MULTICHANNEL = ${multichannel ? 'true' : 'false'};
        `;

        // Read interceptor script
        const interceptorPath = path.join(__dirname, 'webrtc-interceptor.js');
        const interceptorScript = fs.readFileSync(interceptorPath, 'utf8');
        
        // Inject WebRTC monkey-patch before any other scripts run
        await this.page.addInitScript(prelude + '\n' + interceptorScript);
        console.log(`[Bot Core] Init complete, interceptor registered (platform=${platform}, multichannel=${multichannel}, __BOT_MULTICHANNEL=${multichannel}).`);
        
        return true;
    }

    async setMultichannelCapture(enabled) {
        if (!this.page) return;
        const on = !!enabled;
        try {
            await this.page.evaluate((flag) => {
                window.__BOT_MULTICHANNEL = flag;
            }, on);
            console.log(`[Bot Core] __BOT_MULTICHANNEL → ${on}`);
        } catch (e) {
            console.warn('[Bot Core] setMultichannelCapture failed:', e.message);
        }
    }

    async getParticipants() {
        // Abstract method: MUST be implemented by platform-specific subclasses (google-meet.js, zoom.js, teams.js)
        console.warn('[Bot Core] WARNING: getParticipants() called on base class. The platform subclass did not implement it properly!');
        if (this.onParticipantsUpdate) this.onParticipantsUpdate([]);
        return [];
    }

    startMeetingEndWatcher() {
        if (this._endWatchTimer || !this.page) return;
        this._meetingEnded = false;
        this._endWatchTimer = setInterval(async () => {
            if (this._meetingEnded || !this.page) return;
            try {
                const ended = await this.page.evaluate(() => {
                    const t = ((document.body && document.body.innerText) || '').slice(0, 8000).toLowerCase();
                    return [
                        'you left the meeting',
                        'you left the call',
                        'you have left the meeting',
                        "you've left the meeting",
                        'the meeting has ended',
                        'this meeting has ended',
                        'this meeting has been ended',
                        'the call has ended',
                        "you've been removed",
                        'you have been removed',
                        'return to home screen',
                        'host has ended the meeting',
                        'this meeting has been ended by the host',
                        'meeting ended',
                        'call ended',
                        'the host has ended this meeting',
                        'this meeting is over',
                        'thanks for joining',
                        'how was the audio and video',
                        'how was the call quality',
                        'you are no longer in the meeting'
                    ].some((p) => t.includes(p));
                });
                if (ended) {
                    this._meetingEnded = true;
                    if (this._endWatchTimer) {
                        clearInterval(this._endWatchTimer);
                        this._endWatchTimer = null;
                    }
                    console.log('[Bot Core] Meeting ended on the call screen.');
                    if (typeof this.onMeetingEnded === 'function') this.onMeetingEnded();
                }
            } catch (e) { /* page already closed */ }
        }, 2000);
    }

    async close() {
        if (this._endWatchTimer) {
            clearInterval(this._endWatchTimer);
            this._endWatchTimer = null;
        }
        if (this.context) {
            await this.context.close();
        }
    }
}

module.exports = MeetingBot;
