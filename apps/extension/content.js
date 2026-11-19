console.log('[MeetingAI] Extension content script loaded.');

let isBotActive = false;

// Proxy HTTP requests from renderer.js to background.js to bypass mixed-content blocks
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'MEETING_AI_FETCH_REQ') {
        chrome.runtime.sendMessage({
            type: 'FETCH_PROXY',
            url: event.data.url,
            options: event.data.options || {}
        }, (response) => {
            window.postMessage({
                type: 'MEETING_AI_FETCH_RES',
                fetchId: event.data.fetchId,
                response: response.data,
                error: response.error
            }, '*');
        });
    }
});

// Connect to the local WebSocket server via background script proxy
let wsReconnectTimer = null;
function connectWebSocket(forceReconnect = false) {
    chrome.runtime.sendMessage({
        type: 'WS_CONNECT',
        sessionId: 'local-session',
        meetUrl: window.location.href,
        force: !!forceReconnect
    }, () => {
        void chrome.runtime.lastError;
    });
}

function scheduleContentReconnect(delayMs = 1500) {
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(() => {
        wsReconnectTimer = null;
        connectWebSocket(false);
    }, delayMs);
}

// Listen for WebSocket events proxied from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'WS_EVENT') {
        const { event, data } = request;
        if (event === 'open') {
            console.log('[MeetingAI] Connected to local backend server (via proxy).');
            chrome.runtime.sendMessage({
                type: 'FETCH_PROXY',
                url: 'http://localhost:8080/bot/participants?sessionId=local-session',
                options: { method: 'GET' }
            }, (response) => {
                if (response && response.data && response.data.botActive !== false && response.data.participants !== null) {
                    isBotActive = true;
                    stopRequested = false;
                    if (listeners['bot:status']) listeners['bot:status'].forEach(cb => cb({ status: 'active' }));
                }
            });
        } else if (event === 'close') {
            console.log('[WS] Disconnected (proxy)...');
            // Don't mark bot failed on transient WS drops — Meet tab will rejoin the room.
            scheduleContentReconnect(1200);
        } else if (event === 'message') {
            try {
                const msg = data;
                console.log('[MeetingAI] WebSocket received message (proxied):', msg.channel, msg);
                if (msg.id && pendingInvokes[msg.id]) {
                    if (msg.error) pendingInvokes[msg.id].reject(msg.error);
                    else pendingInvokes[msg.id].resolve(msg.response);
                    delete pendingInvokes[msg.id];
                } else if (msg.channel && listeners[msg.channel]) {
                    listeners[msg.channel].forEach(cb => cb(msg.data));
                }
            } catch (e) {
                console.error('[MeetingAI] Error parsing WS message:', e);
            }
        }
    }
});
// Soft connect first, then force-rejoin after Meet tab reload so the extension
// re-enters the session room even if the SW socket stayed open without us.
connectWebSocket(false);
setTimeout(() => connectWebSocket(true), 600);
setInterval(() => {
    chrome.runtime.sendMessage({ type: 'WS_STATUS' }, (status) => {
        if (chrome.runtime.lastError) {
            scheduleContentReconnect(800);
            return;
        }
        if (!status || (!status.open && !status.connecting)) {
            connectWebSocket(false);
        }
    });
}, 8000);

const BOT_NAME_RE = /^(xobin|xora|ai interview assistant|ai meet assistant)$/i;

function scrapeHostMeetParticipants() {
    const names = new Set();
    document.querySelectorAll('[data-self-name]').forEach(el => {
        const raw = (el.getAttribute('data-self-name') || '').trim();
        const name = raw.replace(/\s*\(You\)\s*$/i, '').trim();
        if (name.length >= 2) names.add(name);
    });
    document.querySelectorAll('span.zWGUib, div.XEazBc .cS7aqe, div.dwSJ2e').forEach(el => {
        const name = (el.textContent || '').replace(/\s*\(You\)\s*$/i, '').trim();
        if (name.length >= 2) names.add(name);
    });
    document.querySelectorAll('[role="listitem"]').forEach(item => {
        const span = item.querySelector('span.zWGUib, .cS7aqe, .dwSJ2e');
        const name = span ? span.textContent.replace(/\s*\(You\)\s*$/i, '').trim() : '';
        if (name.length >= 2 && !/contributors|people|pin|mute/i.test(name)) names.add(name);
    });
    return [...names].filter((n) => !BOT_NAME_RE.test(n));
}

// Create a host element for the Shadow DOM
const host = document.createElement('div');
host.id = 'meetingai-host';
host.style.position = 'fixed';
host.style.top = '0';
host.style.left = '0';
host.style.width = '100vw';
host.style.height = '100vh';
host.style.pointerEvents = 'none'; // Let clicks pass through to Google Meet
host.style.zIndex = '999999';

// Attach Shadow DOM
const shadow = host.attachShadow({ mode: 'open' });
document.body.appendChild(host);

// Expose a mock `cue` API to the renderer scripts
const listeners = {};
const pendingInvokes = {};
let invokeIdCounter = 0;

window.cue = {
    emit: (channel, data = {}) => {
        chrome.runtime.sendMessage({
            type: 'WS_SEND',
            payload: { channel, data }
        });
    },
    on: (channel, cb) => {
        if (!listeners[channel]) listeners[channel] = [];
        listeners[channel].push(cb);
    },
    send: (channel, data) => {
        // Updated to use the new emit mechanism
        window.cue.emit(channel, data);
    },
    invoke: (channel, data) => {
        return new Promise((resolve, reject) => {
            if (!isBotActive) return reject('Bot not active');
            const id = `inv_${invokeIdCounter++}`;
            pendingInvokes[id] = { resolve, reject };
            
            chrome.runtime.sendMessage({
                type: 'WS_SEND',
                payload: { id, channel, data }
            }, (res) => {
                if (res && res.error) reject(res.error);
            });
            
            // Timeout to prevent hanging
            setTimeout(() => {
                if (pendingInvokes[id]) {
                    pendingInvokes[id].reject('Timeout waiting for response from ' + channel);
                    delete pendingInvokes[id];
                }
            }, 30000);
        });
    },
    setIgnoreMouse: (ignore) => {
        // No-op for Chrome extension
    },
    settingsGet: () => Promise.resolve({}),
    captureState: () => Promise.resolve(false),
    botStart: (params) => window.cue.invoke('bot:start', params),
    ask: (payload) => window.cue.send('ask', payload),
    setCandidate: (name) => window.cue.send('candidate:set', { name }),
    requestParticipants: () => {
        const local = scrapeHostMeetParticipants();
        if (local.length && listeners['participants:update']) {
            listeners['participants:update'].forEach(cb => cb(local));
        }
        window.cue.send('participants:request', {});
    },
    captureStart: () => {
        const dispatchLocalError = (msg) => {
            if (listeners['llm:error']) listeners['llm:error'].forEach(cb => cb({ message: msg }));
        };

        window.cue.log('Requesting screenshot from background script...');
        try {
            chrome.runtime.sendMessage({ type: 'CAPTURE_SCREEN' }, (response) => {
                if (chrome.runtime.lastError) {
                    window.cue.log('Extension context error: ' + chrome.runtime.lastError.message);
                    dispatchLocalError('Extension error: Please reload the Google Meet page.');
                    return;
                }
                if (response && response.dataUrl) {
                    window.cue.log('Screenshot received, sending to server for OCR processing...');
                    if (listeners['assist:preview']) {
                        listeners['assist:preview'].forEach(cb => cb({ image: response.dataUrl }));
                    }
                    window.cue.send('ocr:process', { image: response.dataUrl });
                } else {
                    const err = response ? response.error : 'Unknown error';
                    window.cue.log('Failed to capture screen: ' + err);
                    dispatchLocalError('Screenshot failed: ' + err);
                }
            });
        } catch (e) {
            window.cue.log('Fatal capture error: ' + e.message);
            dispatchLocalError('Fatal error: ' + e.message);
        }
    },
    log: (msg) => console.log('[MeetingAI Renderer]', msg)
};

setInterval(() => {
    const local = scrapeHostMeetParticipants();
    if (local.length >= 1 && listeners['participants:update']) {
        listeners['participants:update'].forEach(cb => cb(local));
    }
}, 4000);

// --- Audio Playback Engine ---
let audioCtx = null;
let nextPlayTime = 0;

window.cue.on('agent:play-audio', (base64Str) => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });

    // Decode base64 to binary
    const binary = window.atob(base64Str);
    const len = binary.length;
    const uint8 = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        uint8[i] = binary.charCodeAt(i);
    }
    const float32Data = new Float32Array(uint8.buffer);

    // Create AudioBuffer
    const audioBuffer = audioCtx.createBuffer(1, float32Data.length, 44100);
    audioBuffer.copyToChannel(float32Data, 0);

    // Play it
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);

    const currentTime = audioCtx.currentTime;
    if (nextPlayTime < currentTime) {
        nextPlayTime = currentTime;
    }
    source.start(nextPlayTime);
    nextPlayTime += audioBuffer.duration;
});

// Inject UI HTML and CSS when the extension has a real auth token
chrome.storage.local.get(['google_connected', 'auth_token'], (result) => {
    const token = result.auth_token;
    if (token && token !== 'dummy-token-123') {
        fetch(chrome.runtime.getURL('ui/index.html') + '?v=' + (chrome.runtime.getManifest().version || '1'))
            .then(r => r.text())
            .then(html => {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                // Inject stylesheets
                const cssFiles = ['styles.css', 'island-buttons.css', 'vision-card.css', 'resizer.css', 'todo-agent.css', 'permission-card.css', 'commands-menu.css', 'eval-gauge.css'];
                cssFiles.forEach(file => {
                    const link = document.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = chrome.runtime.getURL('ui/' + file) + '?v=' + (chrome.runtime.getManifest().version || '1');
                    shadow.appendChild(link);
                });

                // Inject HTML
                const appDiv = doc.getElementById('app');
                if (appDiv) shadow.appendChild(appDiv);

                // Expose shadow root globally for renderer.js to access
                window.__MEETINGAI_SHADOW__ = shadow;

                // Initialize the UI logic
                if (window.initRenderer) {
                    window.initRenderer();
                } else {
                    console.error('[MeetingAI] initRenderer not found. Check manifest.json content_scripts.');
                }
            });
    } else {
        console.log('[MeetingAI] User not authenticated. Meeting Setup UI will not be injected.');
    }
});

// Robust DOM Scraping for Speaker Diarization
let lastCapturedTranscript = '';
setInterval(() => {
    if (!isBotActive) return;

    // Target the main caption container provided by the user
    const captionContainer = document.querySelector('.a4cQT');
    if (!captionContainer) return;

    // Google Meet captions update continuously. We grab the visible text.
    // In a real scenario, you'd parse speaker names (often in a separate span like .zs7s8d) 
    // and the spoken text (often in .CNusmb). For now, we grab the raw text to ensure it's working.
    const currentText = captionContainer.innerText.trim();

    if (currentText && currentText !== lastCapturedTranscript) {
        lastCapturedTranscript = currentText;

        // Emit the captured transcript to the UI/backend
        // In this implementation, you'll likely want to send this to your local server or emit to renderer
        if (window.cue && window.cue.emit) {
            window.cue.emit('bot:transcript', {
                speaker: 'Meeting Participant', // Placeholder until we parse the specific speaker class
                text: currentText,
                isFinal: false
            });
        }
    }
}, 1000);

let stopRequested = false;
let sawInCallControls = false;

function requestBotStop(reason) {
    // Bot lifecycle is owned by the server (alone-in-meeting detection).
    // Never stop the bot because the host reloaded / closed a Meet tab.
    if (reason === 'tab-closed' || reason === 'pagehide' || reason === 'beforeunload') {
        console.log('[MeetingAI] Ignoring stop request from tab lifecycle:', reason);
        return;
    }
    if (!isBotActive || stopRequested) return;
    stopRequested = true;
    isBotActive = false;
    console.log('[MeetingAI] Ending session because:', reason);
    chrome.runtime.sendMessage({
        type: 'FETCH_PROXY',
        url: 'http://localhost:8080/bot/stop',
        options: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: 'local-session', reason })
        }
    }, (response) => {
        if (response && response.error) console.error('[MeetingAI] Failed to stop bot', response.error);
        else console.log('[MeetingAI] Bot stop requested.');
    });
}

function isInCallUi() {
    if (document.getElementById('hangup-button')) return true;
    const nodes = document.querySelectorAll('button, [role="button"]');
    for (const el of nodes) {
        const label = (el.getAttribute('aria-label') || '').toLowerCase();
        if (
            label.includes('leave call') ||
            label.includes('leave meeting') ||
            label.includes('end call') ||
            label.includes('hang up')
        ) return true;
    }
    return !!document.querySelector('[data-is-muted]');
}

function isPostCallUi() {
    const t = ((document.body && document.body.innerText) || '').slice(0, 5000).toLowerCase();
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
        'how was the audio and video',
        'how was the call quality'
    ].some((p) => t.includes(p)) || (sawInCallControls && /\brejoin\b/.test(t) && !isInCallUi());
}

function isLeaveConfirmLabel(label) {
    const t = String(label || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!t || t.includes('cancel')) return false;
    return (
        t === 'leave meeting' ||
        t === 'leave the meeting' ||
        t === 'just leave the meeting' ||
        t.includes('end meeting for everyone') ||
        t.includes('end the meeting for all') ||
        t.includes('end meeting for all')
    );
}

document.addEventListener('click', (e) => {
    if (!isBotActive) return;
    const el = e.target.closest('button, [role="button"], a');
    if (!el) return;
    const label = `${el.getAttribute('aria-label') || ''} ${el.innerText || ''}`;
    // Host leave/hangup must NOT stop the headless bot — other participants may remain.
    // Bot auto-ends when it is alone. Manual Ctrl+J still stops via botToggle.
    if (isLeaveConfirmLabel(label) || label.toLowerCase().includes('leave call') || label.toLowerCase().includes('hang up') || el.id === 'hangup-button') {
        console.log('[MeetingAI] Host leave UI clicked — bot keeps running until meeting is empty.');
    }
}, true);

setInterval(() => {
    if (!isBotActive) return;
    if (isInCallUi()) sawInCallControls = true;
    // Do not stop bot on post-call UI — host leaving != meeting ended for everyone.
}, 800);

// Tab reload/close must never kill the bot session.
window.addEventListener('pagehide', () => {
    console.log('[MeetingAI] Meet tab unloading — bot continues independently.');
});
window.addEventListener('beforeunload', () => {});

window.cue.botToggle = (payload = {}) => {
    if (isBotActive) {
        requestBotStop('manual-toggle');
        return false; // Returns new state
    } else {
        let interviewerName = 'Interviewer';

        const profileBtn = document.querySelector('a[aria-label^="Google Account:"]');
        if (profileBtn) {
            const match = profileBtn.getAttribute('aria-label').match(/Google Account:\s*([^\n]+)/);
            if (match && match[1]) interviewerName = match[1].trim();
        }
        if (interviewerName === 'Interviewer') {
            const tiles = document.querySelectorAll('div[data-self-name]');
            for (const tile of tiles) {
                let name = tile.getAttribute('data-self-name') || '';
                if (name.includes('(You)') || name.endsWith('You')) {
                    interviewerName = name.replace(/\(You\)/gi, '').replace(/You$/, '').trim();
                    break;
                }
            }
        }

        console.log(`[MeetingAI] Triggering bot join for ${window.location.href} (Interviewer: ${interviewerName})`);

        stopRequested = false;
        sawInCallControls = false;
        isBotActive = true;

        const startBot = (lang, botDisplayName) => {
            chrome.runtime.sendMessage({
                type: 'FETCH_PROXY',
                url: 'http://localhost:8080/bot/start',
                options: {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: window.location.href,
                        language: lang,
                        botDisplayName,
                        interviewerName,
                        sessionId: 'local-session',
                        jobRole: payload.jobRole || '',
                        jobDescription: payload.jobDescription || ''
                    })
                }
            }, (response) => {
                if (response && response.error) {
                    console.error('[MeetingAI] Failed to reach backend. Is node apps/server/index.js running?', response.error);
                    isBotActive = false;
                    if (listeners['bot:status']) listeners['bot:status'].forEach(cb => cb({ status: 'failed' }));
                } else if (response && response.data) {
                    const data = response.data;
                    if (data.success) {
                        console.log('[MeetingAI] Bot started successfully in background!');
                        // Soft ensure — do not tear down an existing healthy socket.
                        connectWebSocket(false);
                    } else {
                        console.error('[MeetingAI] Backend returned error:', data.error);
                        isBotActive = false;
                        if (listeners['bot:status']) listeners['bot:status'].forEach(cb => cb({ status: 'failed' }));
                    }
                }
            });
        };

        let lang = localStorage.getItem('sttLanguage') || localStorage.getItem('default_language') || 'multi';
        let botDisplayName = localStorage.getItem('bot_display_name') || 'Xobin';
        chrome.runtime.sendMessage({
            type: 'FETCH_PROXY',
            url: 'http://localhost:8080/auth/preferences',
            options: { method: 'GET', headers: { 'Content-Type': 'application/json' } }
        }, (prefRes) => {
            const prefs = prefRes && prefRes.data && !prefRes.error ? prefRes.data : null;
            if (prefs && prefs.preferredLanguage) lang = prefs.preferredLanguage;
            if (prefs && prefs.botDisplayName) botDisplayName = prefs.botDisplayName;
            startBot(lang, botDisplayName);
        });
        return true; // Returns new state
    }
};

// Keep local bot state in sync. Do NOT force-reconnect here — joining a room
// already sends bot:status:active, and reconnecting causes a join/leave storm.
window.cue.on('bot:status', (data) => {
    if (data && data.status === 'active') {
        isBotActive = true;
        stopRequested = false;
    } else if (data && (data.status === 'stopped' || data.status === 'error' || data.status === 'failed')) {
        isBotActive = false;
        stopRequested = true;
    }
});

// Global Shortcut for Bot Join/Stop (Ctrl+J)
window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        window.cue.botToggle();
    }
}, { capture: true });
