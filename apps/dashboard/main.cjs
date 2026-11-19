require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config(); // Also check local .env
const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  nativeTheme,
  screen,
  Tray,
  Menu,
  session,
  desktopCapturer,
  globalShortcut
} = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');
const { OAuth2Client } = require('google-auth-library');
const AudioMuxer = require('./main/audio-muxer.cjs');
const DeepgramMultichannelSTT = require('./main/stt-deepgram.cjs');

const PROTOCOL = 'saasapp';
let mainWindow = null;
let overlayWindow = null;
let splashWindow = null;
let notificationWindow = null;
let tray = null;
let authServer = null;
let pendingDeepLink = null;
let appIsQuitting = false;

// Audio & STT state
let isAssistActive = false;
let audioMuxer = null;
let deepgramSTT = null;
let lastTranscriptChannel = 0;
let currentMeetingContext = { title: '', candidateName: '', meetingUrl: '' };

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const deep = argv.find((a) => typeof a === 'string' && a.startsWith(`${PROTOCOL}://`));
    if (deep) handleDeepLink(deep);
    showDashboard();
  });
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

function parseDeepLink(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== `${PROTOCOL}:`) return null;
    return {
      token: u.searchParams.get('token') || '',
      flow: u.searchParams.get('flow') || 'login',
      provider: u.searchParams.get('provider') || ''
    };
  } catch (e) {
    return null;
  }
}

function handleDeepLink(raw) {
  const parsed = typeof raw === 'string' ? parseDeepLink(raw) : raw;
  if (!parsed || !parsed.token) return;
  pendingDeepLink = parsed;
  const deliver = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('oauth-deep-link', pendingDeepLink);
    pendingDeepLink = null;
    showDashboard();
  };
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    deliver();
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.once('did-finish-load', deliver);
  }
}

const PORT = 3000;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || process.env.VITE_GOOGLE_CLIENT_SECRET || '';

const oauth2Client = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

let googleAuthData = null;

function getGoogleTokenPath() {
  return path.join(app.getPath('userData'), 'google_oauth.json');
}

function loadStoredGoogleAuth() {
  try {
    const p = getGoogleTokenPath();
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (data && data.tokens) {
        googleAuthData = data;
        oauth2Client.setCredentials(data.tokens);
        console.log('[Google OAuth] Loaded saved credentials for:', data.user?.email || 'authenticated user');
      }
    }
  } catch (e) {
    console.warn('[Google OAuth] Failed to load saved credentials:', e.message);
  }
}

function saveGoogleAuth(data) {
  try {
    googleAuthData = data;
    const p = getGoogleTokenPath();
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Google OAuth] Failed to save credentials:', e.message);
  }
}

function clearGoogleAuth() {
  try {
    googleAuthData = null;
    oauth2Client.setCredentials({});
    const p = getGoogleTokenPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (e) {
    console.warn('[Google OAuth] Failed to clear credentials:', e.message);
  }
}

oauth2Client.on('tokens', (tokens) => {
  if (googleAuthData) {
    googleAuthData.tokens = { ...googleAuthData.tokens, ...tokens };
    saveGoogleAuth(googleAuthData);
  }
});

// -------- Dashboard Main Window --------
function createMainWindow() {
  const appIcon = path.join(__dirname, 'public', 'icon.ico');

  splashWindow = new BrowserWindow({
    width: 600,
    height: 400,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: true,
    icon: appIcon,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 700,
    title: 'SaaS Dashboard',
    icon: appIcon,
    titleBarStyle: 'hidden',
    show: false,
    titleBarOverlay: {
      color: 'rgba(0, 0, 0, 0)',
      symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#1f2937',
      height: 38
    },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    if (openUrl.startsWith('http')) {
      shell.openExternal(openUrl);
    }
    return { action: 'deny' };
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
    mainWindow.loadURL('http://localhost:5178');
  }

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingDeepLink) {
      mainWindow.webContents.send('oauth-deep-link', pendingDeepLink);
      pendingDeepLink = null;
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.webContents.send('stop-loading');
    }
  });

  mainWindow.on('close', (e) => {
    if (!appIsQuitting && (isAssistActive || tray)) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  ipcMain.once('splash-animation-done', () => {
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    if (!isAssistActive) mainWindow.show();
  });
}

// -------- Dynamic Island & Overlay Window --------
function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { workArea } = primaryDisplay;

  overlayWindow = new BrowserWindow({
    width: workArea.width,
    height: workArea.height,
    x: workArea.x,
    y: workArea.y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'overlay', 'preload-overlay.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  overlayWindow.setContentProtection(false);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (typeof overlayWindow.setHiddenInMissionControl === 'function') {
    overlayWindow.setHiddenInMissionControl(true);
  }

  overlayWindow.loadFile(path.join(__dirname, 'overlay', 'index.html'));

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  return overlayWindow;
}

// -------- System Tray --------
function setupTray() {
  if (tray) return;
  const appIcon = path.join(__dirname, 'public', 'icon.ico');
  tray = new Tray(appIcon);

  const updateMenu = () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Dashboard',
        click: () => showDashboard()
      },
      {
        label: 'Toggle Dynamic Island',
        click: () => toggleOverlay()
      },
      { type: 'separator' },
      {
        label: isAssistActive ? '● Assist Active (Channel 1: Mic, Channel 2: Meeting)' : '○ Assist Idle',
        enabled: false
      },
      {
        label: isAssistActive ? 'Stop Assist Session' : 'Launch Assist Session',
        click: () => {
          if (isAssistActive) stopAssistSession();
          else launchAssist(currentMeetingContext);
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          appIsQuitting = true;
          app.quit();
        }
      }
    ]);
    tray.setContextMenu(contextMenu);
  };

  tray.setToolTip('SaaS Assistant - Meeting Copilot');
  updateMenu();

  tray.on('click', () => {
    showDashboard();
  });
}

function showDashboard() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createMainWindow();
  }
}

function toggleOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('shortcut:toggle-overlay');
  }
}

// -------- Launch & Stop Assist Session --------
async function launchAssist(meetingData = {}) {
  try {
    isAssistActive = true;
    currentMeetingContext = meetingData || {};

    // 1. Send dashboard to system tray
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
    setupTray();

    // 2. Popup dynamic island overlay
    const overlay = createOverlayWindow();
    overlay.showInactive();

    // 3. Initialize Audio Muxer (Channel 1: Mic, Channel 2: Meeting Audio)
    if (!audioMuxer) {
      audioMuxer = new AudioMuxer({
        frameSamples: 1024,
        onFrame: (interleavedInt16) => {
          if (deepgramSTT && deepgramSTT.isConnected) {
            deepgramSTT.sendAudio(interleavedInt16.buffer);
          }
        }
      });
    } else {
      audioMuxer.reset();
    }

    // 4. Initialize Deepgram Multichannel STT
    const apiKey = process.env.DEEPGRAM_API_KEY || '';
    if (!deepgramSTT) {
      deepgramSTT = new DeepgramMultichannelSTT(apiKey, {
        onTranscript: (item) => {
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            const turnId = `turn-${item.channel}-${Math.floor(item.timestamp / 3500)}`;
            overlayWindow.webContents.send('transcript:update', {
              turnId,
              speaker: item.speaker,
              text: item.text,
              timestamp: item.timestamp,
              isComplete: item.isFinal
            });

            // Trigger AI insight when participant finishes speaking
            if (item.isFinal && item.channel === 1 && item.text.length > 10) {
              triggerAiFollowup(item.text);
            }
          }
        },
        onError: (err) => {
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('status', { message: `STT Notice: ${err.message}` });
          }
        }
      });
    }
    deepgramSTT.connect();

    // 5. Tell overlay to start audio recording and transition to live session
    const notifyOverlay = () => {
      if (overlay && !overlay.isDestroyed()) {
        overlay.webContents.send('session:started');
        overlay.webContents.send('capture:state', { active: true });
        if (meetingData.candidateName) {
          overlay.webContents.send('set-candidate', meetingData.candidateName);
        }
      }
    };

    if (overlay.webContents.isLoading()) {
      overlay.webContents.once('did-finish-load', notifyOverlay);
    } else {
      notifyOverlay();
    }

    // Notify dashboard
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('assist-state-change', { active: true });
    }

    return { success: true };
  } catch (err) {
    console.error('[Launch Assist Error]:', err);
    return { success: false, error: err.message };
  }
}

function stopAssistSession() {
  isAssistActive = false;

  if (deepgramSTT) {
    deepgramSTT.close();
  }
  if (audioMuxer) {
    audioMuxer.close();
  }

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('session:stopped');
    overlayWindow.webContents.send('capture:state', { active: false });
    overlayWindow.hide();
  }

  showDashboard();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('assist-state-change', { active: false });
  }

  return { success: true };
}

// -------- AI Helper for Live Suggestions --------
async function triggerAiFollowup(queryText) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  overlayWindow.webContents.send('llm:start', { small: true });

  const groqKey = process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY;
  if (!groqKey) {
    // Elegant local fallback
    setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('llm:token', {
          text: `Suggested Follow-up: Ask the participant to elaborate on the architecture and trade-offs of their approach.`
        });
        overlayWindow.webContents.send('llm:done', {});
      }
    }, 600);
    return;
  }

  try {
    const fetch = globalThis.fetch || require('node-fetch');
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are an elite real-time SaaS meeting copilot. The candidate/client just finished speaking. Generate 1 crisp, high-impact follow-up question or immediate insight in 2 sentences max.'
          },
          { role: 'user', content: queryText }
        ],
        max_tokens: 150,
        temperature: 0.3
      })
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'Probe further into their practical experience.';
    overlayWindow.webContents.send('llm:token', { text: reply });
    overlayWindow.webContents.send('llm:done', {});
  } catch (err) {
    overlayWindow.webContents.send('llm:token', { text: 'Key takeaway: Verify implementation details and error-handling paths.' });
    overlayWindow.webContents.send('llm:done', {});
  }
}

// -------- App Initialization --------
app.whenReady().then(() => {
  // Setup media permission handlers for screen & loopback audio capture
  const allowMedia = (permission) =>
    permission === 'media' ||
    permission === 'microphone' ||
    permission === 'audioCapture' ||
    permission === 'display-capture';

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowMedia(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowMedia(permission));

  // Loopback audio capture: hands back the desktop screen source with loopback audio
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        if (sources.length) callback({ video: sources[0], audio: 'loopback' });
        else callback();
      })
      .catch(() => callback());
  }, { useSystemPicker: false });

  createMainWindow();
  loadStoredGoogleAuth();

  // Global Shortcuts (Cluely style)
  globalShortcut.register('CommandOrControl+Enter', () => {
    toggleOverlay();
  });

  globalShortcut.register('CommandOrControl+Shift+L', () => {
    if (isAssistActive) stopAssistSession();
    else launchAssist(currentMeetingContext);
  });

  // ---- Overlay & Assist IPC Handlers ----
  ipcMain.handle('bot:start', async (_event, params) => {
    const url = typeof params === 'string' ? params : (params?.url || '');
    const candidateName = params?.candidateName || '';
    const title = params?.title || (url ? `Meeting (${url})` : 'Meeting Assist');
    return launchAssist({ meetingUrl: url, candidateName, title, ...params });
  });

  ipcMain.handle('bot:stop', async () => {
    return stopAssistSession();
  });

  ipcMain.handle('capture:state', () => {
    return { active: isAssistActive };
  });

  ipcMain.handle('capture:toggle', () => {
    if (isAssistActive) stopAssistSession();
    else launchAssist(currentMeetingContext);
    return { active: isAssistActive };
  });

  ipcMain.on('capture:start', () => {
    if (!isAssistActive) launchAssist(currentMeetingContext);
  });

  ipcMain.handle('settings:get', () => {
    return {
      TEST_MEETING_URL: process.env.TEST_MEETING_URL || '',
      sttLanguage: process.env.STT_LANGUAGE || 'multi'
    };
  });

  ipcMain.handle('settings:set', (_event, patch) => {
    return patch || {};
  });

  ipcMain.on('log', (_event, msg) => {
    console.log('[Overlay Log]:', msg);
  });

  ipcMain.on('todo:sync', (_event, _todos) => {
    // Todos state sync
  });

  ipcMain.on('agent:takeover-approved', (_event, question) => {
    console.log('[Takeover Approved]:', question);
  });

  ipcMain.on('agent:takeover-denied', () => {
    console.log('[Takeover Denied]');
  });

  ipcMain.on('participants:request', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      const list = currentMeetingContext?.candidateName ? [currentMeetingContext.candidateName] : [];
      overlayWindow.webContents.send('participants:update', list);
    }
  });

  ipcMain.on('set-candidate', (_event, name) => {
    if (currentMeetingContext) currentMeetingContext.candidateName = name;
  });

  ipcMain.on('open-pane', (_event, paneUrl) => {
    if (typeof paneUrl === 'string' && paneUrl.startsWith('http')) {
      shell.openExternal(paneUrl);
    }
  });

  // ---- Dashboard IPC Handlers ----
  ipcMain.handle('launch-assist', async (_event, meetingData) => {
    return launchAssist(meetingData);
  });

  ipcMain.handle('stop-assist', async () => {
    return stopAssistSession();
  });

  ipcMain.handle('get-assist-state', () => {
    return { active: isAssistActive };
  });

  ipcMain.on('return-to-dashboard', () => {
    showDashboard();
  });

  ipcMain.on('mouse:ignore', (_event, ignore) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setIgnoreMouseEvents(ignore, { forward: true });
    }
  });

  // Audio PCM streaming from overlay renderer
  ipcMain.on('mic:pcm', (_event, arrayBuffer) => {
    if (audioMuxer && isAssistActive && arrayBuffer) {
      const int16 = new Int16Array(arrayBuffer);
      const floats = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) floats[i] = int16[i] / 32768.0;
      audioMuxer.pushUserMic(floats); // Channel 1 (User)
    }
  });

  ipcMain.on('system:pcm', (_event, arrayBuffer) => {
    if (audioMuxer && isAssistActive && arrayBuffer) {
      const int16 = new Int16Array(arrayBuffer);
      const floats = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) floats[i] = int16[i] / 32768.0;
      audioMuxer.pushMeetingAudio(floats); // Channel 2 (Meeting Participant)
    }
  });

  // Manual Ask / Prompt from overlay composer
  ipcMain.on('ask', async (_event, payload) => {
    if (!payload || !overlayWindow || overlayWindow.isDestroyed()) return;
    const text = payload.text || payload.mode || 'What should I ask next?';
    triggerAiFollowup(text);
  });

  // ---- Google OAuth & Calendar Handlers ----
  ipcMain.handle('get-calendar-status', () => {
    return {
      connected: !!(googleAuthData && googleAuthData.tokens),
      user: googleAuthData?.user || null
    };
  });

  ipcMain.handle('disconnect-calendar', () => {
    clearGoogleAuth();
    return { success: true };
  });

  ipcMain.handle('get-calendar-events', async (_event, params = {}) => {
    if (!googleAuthData || !googleAuthData.tokens) {
      return { connected: false, events: [] };
    }

    try {
      const timeMin = params.timeMin || new Date().toISOString();
      const timeMax = params.timeMax || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const calUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=50`;

      const res = await oauth2Client.request({ url: calUrl });
      const rawEvents = res.data?.items || [];

      const events = rawEvents.map((ev) => {
        const start = ev.start?.dateTime || ev.start?.date;
        const end = ev.end?.dateTime || ev.end?.date || start;
        const meetLink = ev.hangoutLink || ev.conferenceData?.entryPoints?.[0]?.uri || (ev.location && ev.location.startsWith('http') ? ev.location : null);
        const candidateName = ev.attendees?.[0]?.displayName || ev.attendees?.[0]?.email || '';

        return {
          id: ev.id,
          title: ev.summary || 'Meeting',
          description: ev.description || '',
          startTime: start,
          endTime: end,
          start,
          end,
          meetingUrl: meetLink,
          hangoutLink: meetLink,
          candidateName,
          participants: (ev.attendees || []).map((a) => a.displayName || a.email || '')
        };
      });

      return { connected: true, events };
    } catch (err) {
      console.error('[Google Calendar Error]:', err.message);
      if (/invalid_grant|401/i.test(err.message)) {
        clearGoogleAuth();
        return { connected: false, error: 'Google Calendar session expired. Please reconnect.', events: [] };
      }
      return { connected: true, error: err.message, events: [] };
    }
  });

  ipcMain.handle('login-with-google', async () => {
    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.VITE_GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret || clientId.includes('your_google_client_id') || clientId.includes('YOUR_GOOGLE_CLIENT_ID')) {
      return {
        error: 'Google OAuth credentials missing. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file.'
      };
    }

    oauth2Client._clientId = clientId;
    oauth2Client._clientSecret = clientSecret;

    return new Promise((resolve) => {
      if (authServer && authServer.listening) {
        authServer.close();
      }

      authServer = http.createServer(async (req, res) => {
        try {
          const parsedUrl = url.parse(req.url, true);

          if (parsedUrl.pathname === '/callback') {
            const code = parsedUrl.query.code;
            const error = parsedUrl.query.error;

            if (error) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end('<h1>Authentication Error</h1><p>Access was denied or canceled. You can close this window.</p>');
              authServer.close();
              resolve({ error });
              return;
            }

            const { tokens } = await oauth2Client.getToken(code);
            oauth2Client.setCredentials(tokens);

            let user = null;
            try {
              const userRes = await oauth2Client.request({ url: 'https://www.googleapis.com/oauth2/v2/userinfo' });
              user = userRes.data;
            } catch (e) {
              console.warn('[Google OAuth] Could not fetch user profile:', e.message);
            }

            saveGoogleAuth({ tokens, user });

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Connected</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; text-align: center; }
    .card { background: #1e293b; padding: 40px; border-radius: 16px; border: 1px solid #334155; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); max-width: 420px; }
    h1 { color: #38bdf8; margin: 0 0 12px; font-size: 24px; }
    p { color: #94a3b8; font-size: 14px; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>✓ Calendar Connected!</h1>
    <p>Google Calendar is now linked. You can close this tab and return to the SaaS Assistant.</p>
  </div>
</body>
</html>`);
            authServer.close();
            resolve({ success: true, tokens, user });
          } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
          }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error: ' + err.message);
        }
      });

      authServer.on('error', (e) => {
        console.error('[Google OAuth Server Error]:', e);
        if (e.code === 'EADDRINUSE') {
          resolve({ error: 'Port 3000 is in use. Please close whatever is using port 3000 and try again.' });
        }
      });

      authServer.listen(PORT, '127.0.0.1', () => {
        const authUrl = oauth2Client.generateAuthUrl({
          access_type: 'offline',
          prompt: 'consent',
          scope: [
            'https://www.googleapis.com/auth/calendar.readonly',
            'https://www.googleapis.com/auth/calendar.events.readonly',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/userinfo.email'
          ]
        });

        shell.openExternal(authUrl);
      });

      setTimeout(() => {
        if (authServer && authServer.listening) {
          authServer.close();
          resolve({ error: 'Authentication timed out. Please try again.' });
        }
      }, 5 * 60 * 1000);
    });
  });

  ipcMain.on('set-theme', (event, theme) => {
    if (mainWindow) {
      mainWindow.setTitleBarOverlay({
        color: theme === 'dark' ? '#000000' : '#ffffff',
        symbolColor: theme === 'dark' ? '#ffffff' : '#1f2937'
      });
    }
  });

  // ---- Custom Notifications ----
  ipcMain.on('show-custom-notification', (event, data) => {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
      notificationWindow.close();
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height, x: screenX, y: screenY } = primaryDisplay.workArea;
    const windowWidth = 420;
    const windowHeight = 180;

    const isMac = process.platform === 'darwin';
    const x = screenX + width - windowWidth - 24;
    const y = isMac ? screenY + 40 : screenY + height - windowHeight - 24;

    notificationWindow = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      x,
      y,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    const dataStr = encodeURIComponent(JSON.stringify(data));
    const notifUrl = app.isPackaged
      ? `file://${path.join(__dirname, 'dist', 'index.html')}#/notification-toast?data=${dataStr}`
      : `http://localhost:5178/#/notification-toast?data=${dataStr}`;

    notificationWindow.loadURL(notifUrl);

    notificationWindow.once('ready-to-show', () => {
      notificationWindow.showInactive();
    });
  });

  ipcMain.on('close-custom-notification', () => {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
      notificationWindow.close();
      notificationWindow = null;
    }
  });

  ipcMain.on('open-external', (event, openUrl) => {
    if (typeof openUrl === 'string' && openUrl.startsWith('http')) {
      shell.openExternal(openUrl).catch((err) => {
        console.error('Failed to open external URL:', err);
      });
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('open-url', (event, deepUrl) => {
  event.preventDefault();
  handleDeepLink(deepUrl);
});

app.on('window-all-closed', () => {
  if (appIsQuitting || (!isAssistActive && !tray)) {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
