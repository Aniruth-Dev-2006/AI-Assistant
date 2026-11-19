console.log('[MeetingAI] Background service worker loaded.');

const DEFAULT_API = 'http://localhost:8080';

function normalizeApiBase(raw) {
    const base = String(raw || DEFAULT_API).trim().replace(/\/$/, '');
    return base || DEFAULT_API;
}

function getApiBase() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['api_base'], (stored) => {
            resolve(normalizeApiBase(stored.api_base));
        });
    });
}

function rewriteApiUrl(url, apiBase) {
    const u = String(url || '');
    if (!u) return u;
    if (u.startsWith('/')) return `${apiBase}${u}`;
    return u
        .replace(/https?:\/\/localhost:8080/gi, apiBase)
        .replace(/https?:\/\/127\.0\.0\.1:8080/gi, apiBase);
}

function toWsUrl(apiBase, sessionId, meetUrl) {
    const wsBase = apiBase.replace(/^http/i, 'ws');
    let raw = String(meetUrl || '');
    try {
        if (/%[0-9a-f]{2}/i.test(raw)) raw = decodeURIComponent(raw);
    } catch (e) {}
    const encoded = encodeURIComponent(raw);
    return `${wsBase}/ws?sessionId=${encodeURIComponent(sessionId || 'local-session')}&url=${encoded}`;
}

let bgWs = null;
let bgWsSessionId = null;
let bgWsMeetUrl = '';
let bgWsConnecting = false;
let bgWsGeneration = 0;
let reconnectTimer = null;

function clearReconnectTimer() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function scheduleReconnect(delayMs = 1500) {
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (bgWsSessionId) connectBgWebSocket(bgWsSessionId, bgWsMeetUrl, false);
    }, delayMs);
}

async function connectBgWebSocket(sessionId, meetUrl, force = false) {
    if (sessionId) bgWsSessionId = sessionId;
    if (meetUrl) bgWsMeetUrl = meetUrl;

    if (!force && bgWs && (bgWs.readyState === WebSocket.OPEN || bgWs.readyState === WebSocket.CONNECTING)) {
        return;
    }
    if (!force && bgWsConnecting) return;

    const gen = ++bgWsGeneration;
    bgWsConnecting = true;
    clearReconnectTimer();

    if (bgWs) {
        try {
            bgWs.onclose = null;
            bgWs.onerror = null;
            bgWs.onmessage = null;
            bgWs.onopen = null;
            bgWs.close();
        } catch (e) {}
        bgWs = null;
    }

    try {
        const apiBase = await getApiBase();
        if (gen !== bgWsGeneration) return;

        const ws = new WebSocket(toWsUrl(apiBase, bgWsSessionId || 'local-session', bgWsMeetUrl));
        bgWs = ws;

        ws.onopen = () => {
            if (gen !== bgWsGeneration || bgWs !== ws) return;
            bgWsConnecting = false;
            console.log('[BG WS] Connected to', apiBase);
            broadcastToContentScripts({ type: 'WS_EVENT', event: 'open' });
        };
        ws.onclose = () => {
            if (bgWs === ws) bgWs = null;
            bgWsConnecting = false;
            console.log('[BG WS] Disconnected, retrying...');
            broadcastToContentScripts({ type: 'WS_EVENT', event: 'close' });
            scheduleReconnect(2000);
        };
        ws.onerror = () => {
            console.error('[BG WS] WebSocket error');
            bgWsConnecting = false;
        };
        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                broadcastToContentScripts({ type: 'WS_EVENT', event: 'message', data: msg });
            } catch (e) {
                console.error('[BG WS] Parse error:', e);
            }
        };
    } catch (e) {
        bgWsConnecting = false;
        console.error('[BG WS] Connect failed:', e);
        scheduleReconnect(3000);
    }
}

function broadcastToContentScripts(message) {
    chrome.tabs.query({ url: ['https://meet.google.com/*', 'https://teams.microsoft.com/*', 'https://teams.live.com/*', 'https://*.zoom.us/*'] }, (tabs) => {
        for (const tab of tabs) {
            chrome.tabs.sendMessage(tab.id, message).catch(() => {});
        }
    });
}

try {
    chrome.alarms.create('ws-keepalive', { periodInMinutes: 0.5 });
} catch (e) {}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== 'ws-keepalive') return;
    if (!bgWsSessionId) return;
    if (!bgWs || bgWs.readyState > 1) {
        connectBgWebSocket(bgWsSessionId, bgWsMeetUrl, false);
    }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local' || !changes.api_base) return;
    if (bgWsSessionId) connectBgWebSocket(bgWsSessionId, bgWsMeetUrl, true);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'CAPTURE_SCREEN') {
        const windowId = sender.tab ? sender.tab.windowId : chrome.windows.WINDOW_ID_CURRENT;
        chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
            if (chrome.runtime.lastError) {
                console.error('[MeetingAI] Capture error:', chrome.runtime.lastError);
                sendResponse({ error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ dataUrl });
            }
        });
        return true;
    } else if (request.type === 'OPEN_TAB') {
        chrome.tabs.create({ url: request.url });
        sendResponse({ success: true });
        return false;
    } else if (request.type === 'GET_API_BASE') {
        getApiBase().then((base) => sendResponse({ apiBase: base }));
        return true;
    } else if (request.type === 'FETCH_PROXY') {
        chrome.storage.local.get(['auth_token', 'api_base'], (stored) => {
            const apiBase = normalizeApiBase(stored.api_base);
            const options = { ...(request.options || {}) };
            const headers = { ...(options.headers || {}) };
            if (stored.auth_token) headers.Authorization = `Bearer ${stored.auth_token}`;
            options.headers = headers;
            const url = rewriteApiUrl(request.url, apiBase);
            fetch(url, options)
                .then(async (r) => {
                    const text = await r.text();
                    let data = {};
                    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
                    if (!r.ok) sendResponse({ error: data.error || data.message || `HTTP ${r.status}`, data, status: r.status });
                    else sendResponse({ data, status: r.status });
                })
                .catch((err) => sendResponse({ error: err.message }));
        });
        return true;
    } else if (request.type === 'WS_CONNECT') {
        connectBgWebSocket(
            request.sessionId || 'local-session',
            request.meetUrl || '',
            !!request.force
        );
        sendResponse({ ok: true });
        return false;
    } else if (request.type === 'WS_STATUS') {
        const state = bgWs ? bgWs.readyState : WebSocket.CLOSED;
        sendResponse({
            ok: true,
            open: state === WebSocket.OPEN,
            connecting: state === WebSocket.CONNECTING || bgWsConnecting,
            readyState: state,
            sessionId: bgWsSessionId
        });
        return false;
    } else if (request.type === 'WS_SEND') {
        if (bgWs && bgWs.readyState === WebSocket.OPEN) {
            bgWs.send(JSON.stringify(request.payload));
            sendResponse({ ok: true });
        } else {
            if (bgWsSessionId) scheduleReconnect(300);
            sendResponse({ error: 'WebSocket not open' });
        }
        return false;
    }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url && changeInfo.url.includes('/auth/success?token=')) {
        try {
            const url = new URL(changeInfo.url);
            const token = url.searchParams.get('token');
            if (token) {
                chrome.storage.local.set({ auth_token: token, google_connected: true }, () => {
                    console.log('[MeetingAI] Token and google connection state saved successfully!');
                    chrome.tabs.remove(tabId);
                });
            }
        } catch (e) {
            console.error('[MeetingAI] Failed to parse auth callback URL', e);
        }
    }
});
