const { ipcMain, app, shell, globalShortcut } = require('electron');
const BotManager = require('./bot-manager');
const ScreenCaptureManager = require('./screen-capture');
const HybridClient = require('./hybrid-client');
const LLMClient = require('./llm-client');
const TTSEngine = require('./tts-engine');
const jwt = require('jsonwebtoken');

function registerIpcHandlers(mainWindow) {
    // ---- Cloud API client ----
    const hybridClient = new HybridClient(process.env.API_BASE_URL || 'https://truely-lu1a.onrender.com');
    const secret = process.env.JWT_SECRET || 'xobin12345secret987';
    const mockToken = jwt.sign({ 
        userId: '507f1f77bcf86cd799439011', 
        orgId: '507f1f77bcf86cd799439012' 
    }, secret, { expiresIn: '1y' });
    hybridClient.setToken(mockToken);

    // ---- Local LLM fallback (Ollama → Groq) ----
    const llmClient = new LLMClient(mainWindow);

    // ---- Bot Manager (new EventEmitter architecture) ----
    const ttsEngine = new TTSEngine(mainWindow);
    const botManager = new BotManager(null, ttsEngine);
    const screenCapture = new ScreenCaptureManager(mainWindow, llmClient);

    // ===============================================================
    // Forward LOCAL bot events → UI
    // ===============================================================
    botManager.on('transcript:update', (data) => {
        if (mainWindow) mainWindow.webContents.send('transcript:update', data);
    });

    botManager.on('turn:complete', (turn) => {
        hybridClient.postTranscript(turn).catch(e => {
            console.warn('[IPC] Cloud transcript post failed (will use local LLM):', e.message);
            if (turn.text.split(' ').length > 5 && turn.speakerRole === 'candidate') {
                const context = botManager.transcriptManager.getContext();
                llmClient.generateSuggestions(context, botManager.transcriptManager.todos || []);
            }
        });
    });

    botManager.on('session:started', () => {
        if (mainWindow) mainWindow.webContents.send('session:started');
    });

    botManager.on('session:stopped', () => {
        if (mainWindow) mainWindow.webContents.send('session:stopped');
    });

    botManager.on('participants:update', (list) => {
        if (mainWindow) mainWindow.webContents.send('participants:update', list);
    });

    // ===============================================================
    // Forward CLOUD events → UI (when cloud API responds via WebSocket)
    // ===============================================================
    hybridClient.on('llm:start', (data) => mainWindow.webContents.send('llm:start', data));
    hybridClient.on('llm:token', (data) => mainWindow.webContents.send('llm:token', data));
    hybridClient.on('llm:end', (data) => mainWindow.webContents.send('llm:done', data));
    hybridClient.on('llm:done', (data) => mainWindow.webContents.send('llm:done', data));
    hybridClient.on('llm:error', (data) => mainWindow.webContents.send('llm:error', data));
    hybridClient.on('llm:audio', (data) => mainWindow.webContents.send('llm:audio', data));
    hybridClient.on('todo:evaluated', (data) => mainWindow.webContents.send('todo:evaluated', data));
    hybridClient.on('todo:agent-create', (data) => mainWindow.webContents.send('todo:agent-create', data));
    hybridClient.on('agent:request-takeover', (data) => mainWindow.webContents.send('agent:request-takeover', data));
    hybridClient.on('evaluation:update', (data) => mainWindow.webContents.send('evaluation:update', data));

    // ===============================================================
    // IPC Handlers
    // ===============================================================

    ipcMain.handle('settings:get', () => ({
        TEST_MEETING_URL: process.env.TEST_MEETING_URL || ''
    }));

    ipcMain.handle('capture:state', () => {
        return { active: botManager.isRecording || false };
    });

    ipcMain.handle('bot:start', async (event, payload, legacyLanguage) => {
        try {
            let meetingUrl = payload;
            let language = legacyLanguage;
            let interviewerName = 'Interviewer';
            let deepgramKey = null;
            
            let candidateName = null;
            if (typeof payload === 'object') {
                meetingUrl = payload.url;
                language = payload.language;
                interviewerName = payload.interviewerName || 'Interviewer';
                candidateName = payload.candidateName || payload.candidate || null;
            }

            // Fetch Deepgram API Key from Server (No env/client-side keys!)
            try {
                deepgramKey = await hybridClient.getSttKey();
            } catch (err) {
                console.warn('[IPC] Failed to fetch STT key from server:', err.message);
                throw new Error('Could not fetch transcription API key from server. Are you online?');
            }
            
            // 1) Start bot FIRST — this must NOT depend on the cloud
            await botManager.startSession(meetingUrl, language, interviewerName, deepgramKey, candidateName);
            
            // 2) Register with Cloud API in background (non-blocking)
            hybridClient.startSession(meetingUrl, language, candidateName).catch(e => {
                console.warn('[IPC] Cloud session registration failed (non-fatal):', e.message);
                console.warn('[IPC] LLM will fall back to local Groq.');
            });

            return { success: true };
        } catch (error) {
            console.error('[IPC] Failed to start bot:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('bot:stop', async () => {
        try {
            await botManager.stopSession();
            hybridClient.stopSession().catch(() => {});
            return { success: true };
        } catch (error) {
            console.error('[IPC] Failed to stop bot:', error);
            return { success: false, error: error.message };
        }
    });

    // Handle mouse pass-through for the overlay
    ipcMain.on('mouse:ignore', (event, ignore) => {
        if (mainWindow) {
            mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
        }
    });

    // ---- Local LLM fallback function ----
    function runLocalLLM(payload) {
        const context = botManager.transcriptManager.getContext();

        if (payload && payload.mode === 'takeover') {
            const topic = payload.text || 'a follow up question';
            const forceInstruction = `CRITICAL INSTRUCTION: You MUST generate a [TAKEOVER_REQUEST] now based on this instruction: "${topic}". \nThe question MUST be a crisp, direct, natural conversational question that can be spoken aloud to the user. Do not output meta-descriptions like "Review the candidate's...". \nFORMAT STRICTLY AS: [TAKEOVER_REQUEST: <crisp conversational question> : <brief reason>]\nDO NOT output any other text or conversational filler.`;
            const todos = payload.todos || [];
            llmClient.generateSuggestions(context, todos, forceInstruction);
        } else {
            let forceInstruction = null;
            if (payload && payload.text) {
                context.push({ speaker: 'User', text: payload.text });
                forceInstruction = `[User Request]: ${payload.text}`;
            } else if (payload && payload.mode) {
                forceInstruction = `[System Command]: Please perform a ${payload.mode} analysis on the transcript.`;
            }
            const todos = payload && payload.todos ? payload.todos : [];
            llmClient.generateSuggestions(context, todos, forceInstruction);
        }
    }

    // Handle manual LLM requests from UI
    ipcMain.on('ask', (event, payload) => {
        if (!payload) return;

        try {
            if (botManager && botManager.transcriptManager) {
                botManager.transcriptManager.commitTurn();
            }
        } catch (e) {
            console.warn('[IPC] commitTurn on ask failed:', e.message);
        }

        // Try cloud API first, fall back to local LLM
        if (hybridClient.sessionId) {
            hybridClient.postAsk(payload).catch(e => {
                console.warn('[IPC] Cloud ask failed, falling back to local LLM:', e.message);
                runLocalLLM(payload);
            });
        } else {
            console.log('[IPC] No cloud session, using local LLM.');
            runLocalLLM(payload);
        }
    });

    ipcMain.on('todo:sync', (event, todos) => {
        botManager.transcriptManager.todos = todos;
    });

    ipcMain.on('agent:takeover-approved', (event, question) => {
        console.log('[Main] Agent takeover approved for:', question);
        botManager.speakQuestion(question);
    });

    ipcMain.on('agent:takeover-denied', (event) => {
        console.log('[Main] Agent takeover denied by interviewer.');
    });

    ipcMain.on('set-candidate', (event, name) => {
        console.log('[Main] Candidate set to:', name);
        botManager.candidateName = name;
        botManager.transcriptManager.setCandidate(name);
        if (botManager.stt) botManager.stt.setCandidate(name);
    });

    ipcMain.on('participants:request', (event) => {
        console.log('[Main] UI requested participant list refresh.');
        botManager.requestParticipants();
    });

    ipcMain.on('open-pane', (event, url) => {
        shell.openExternal(url).catch(() => {});
    });

    ipcMain.on('log', (event, msg) => {
        console.log('[Renderer]', msg);
    });
    
    // Shortcuts
    globalShortcut.register('CommandOrControl+Enter', () => {
        if (mainWindow) {
            mainWindow.webContents.send('shortcut:toggle-overlay');
        }
    });

    globalShortcut.register('CommandOrControl+Shift+X', () => {
        botManager.stopSession().then(() => app.quit());
    });
    
    // ===============================================================
    // Local Extension Bridge (for Ctrl+J shortcut)
    // ===============================================================
    try {
        const WebSocket = require('ws');
        const wss = new WebSocket.Server({ port: 8081 });
        wss.on('connection', (ws) => {
            ws.on('message', async (message) => {
                try {
                    const msg = JSON.parse(message);
                    if (msg.channel === 'bot:start' && msg.data && msg.data.url) {
                        console.log('[Extension Bridge] Received bot:start from Chrome Extension');
                        
                        // Default values
                        const language = msg.data.language || 'multi';
                        const interviewerName = msg.data.interviewerName || 'Interviewer';
                        const deepgramKey = null; // Fetched inside startSession or from env
                        
                        // Start the bot locally
                        botManager.startSession(msg.data.url, language, interviewerName, deepgramKey).catch(e => {
                            console.error('[Extension Bridge] Failed to start bot:', e);
                        });
                        
                        // Register with cloud non-blocking
                        hybridClient.startSession(msg.data.url, language, interviewerName).catch(() => {});
                        
                        // Send success response back to extension
                        if (msg.id) {
                            ws.send(JSON.stringify({ id: msg.id, response: { success: true } }));
                        }
                    }
                } catch (e) {
                    console.error('[Extension Bridge] Error parsing message:', e.message);
                }
            });
        });
        console.log('[Extension Bridge] Listening on ws://localhost:8081 for Chrome Extension');
    } catch (e) {
        console.warn('[Extension Bridge] Failed to start WebSocket server:', e.message);
    }
    
    return botManager;
}

module.exports = { registerIpcHandlers };
