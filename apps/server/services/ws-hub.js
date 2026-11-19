const WebSocket = require('ws');

class WebSocketHub {
    constructor() {
        this.wss = null;
        // Map of sessionId -> Set of WebSocket clients
        this.rooms = new Map();
        this.pendingNotes = new Map();
    }

    init(server) {
        this.wss = new WebSocket.Server({ server, path: '/ws' });

        this.wss.on('connection', (ws, req) => {
            // Ideally, we authenticate the token in the query string here
            const url = new URL(req.url, `http://${req.headers.host}`);
            const requestedId = url.searchParams.get('sessionId');
            const meetUrl = url.searchParams.get('url');
            let sessionId = requestedId;
            const roomsToJoin = new Set();

            if (!sessionId) {
                console.warn('[WS Hub] Connection rejected: No sessionId provided');
                ws.close(4000, 'Missing sessionId');
                return;
            }

            roomsToJoin.add(sessionId);

            // Calendar bots run under local-session but publish with a mongo id.
            // Keep the client in local-session AND mirror into the mongo room so
            // reloads / MV3 SW restarts still receive transcript fan-out.
            if (sessionId === 'local-session' && meetUrl && global.activeBots) {
                let decodedMeetUrl = meetUrl;
                try { decodedMeetUrl = decodeURIComponent(meetUrl); } catch (e) {}
                const meetKey = this._meetUrlKey(decodedMeetUrl) || this._meetUrlKey(meetUrl);
                if (meetKey) {
                    for (const [activeSessionId, botManager] of global.activeBots.entries()) {
                        if (botManager.meetingUrl && this._meetUrlKey(botManager.meetingUrl) === meetKey) {
                            const linked = botManager.mongoSessionId || activeSessionId;
                            if (linked && linked !== sessionId) {
                                roomsToJoin.add(String(linked));
                                console.log(`[WS Hub] Linked extension to active bot session: ${linked} (also keeping ${sessionId})`);
                            }
                            break;
                        }
                    }
                }
            }

            const mgr = this._resolveBotManager(sessionId);
            if (mgr) {
                if (mgr.sessionId) roomsToJoin.add(String(mgr.sessionId));
                if (mgr.mongoSessionId) roomsToJoin.add(String(mgr.mongoSessionId));
            }

            ws._sessionRooms = [...roomsToJoin];
            ws._handleSessionId = sessionId;
            console.log(`[WS Hub] Client joined session room(s): ${ws._sessionRooms.join(', ')}`);
            for (const roomId of ws._sessionRooms) {
                this._joinRoom(roomId, ws, { announce: roomId === sessionId });
            }

            const leaveAll = () => {
                if (ws._leftRooms) return;
                ws._leftRooms = true;
                for (const roomId of (ws._sessionRooms || [sessionId])) {
                    this._leaveRoom(roomId, ws);
                }
            };

            ws.on('close', () => {
                console.log(`[WS Hub] Client left session room(s): ${(ws._sessionRooms || [sessionId]).join(', ')}`);
                leaveAll();
            });

            ws.on('error', (err) => {
                console.error(`[WS Hub] Client error in room ${sessionId}:`, err.message);
                leaveAll();
            });
            
            // Allow client to send manual messages (e.g., takeover request or OCR data)
            ws.on('message', (messageStr) => {
                try {
                    const data = JSON.parse(messageStr);
                    this._handleClientMessage(ws._handleSessionId || sessionId, data);
                } catch (e) {
                    console.error('[WS Hub] Failed to parse client message:', e.message);
                }
            });
        });

        console.log('[WS Hub] Initialized and listening for connections on /ws');
    }

    _meetUrlKey(urlStr) {
        try {
            const u = new URL(String(urlStr || ''));
            return `${u.hostname}${u.pathname.replace(/\/$/, '')}`.toLowerCase();
        } catch (e) {
            const raw = String(urlStr || '').split('?')[0].split('#')[0].toLowerCase();
            return raw || null;
        }
    }

    _isMongoSessionId(sessionId) {
        return typeof sessionId === 'string' && /^[a-fA-F0-9]{24}$/.test(sessionId);
    }

    _resolveBotManager(sessionId) {
        if (!global.activeBots || global.activeBots.size === 0) return null;
        if (global.activeBots.has(sessionId)) {
            return global.activeBots.get(sessionId);
        }
        for (const mgr of global.activeBots.values()) {
            if (!mgr) continue;
            if (mgr.mongoSessionId && String(mgr.mongoSessionId) === String(sessionId)) return mgr;
            if (mgr.sessionId && String(mgr.sessionId) === String(sessionId)) return mgr;
        }
        if (sessionId === 'local-session') {
            for (const mgr of global.activeBots.values()) {
                if (mgr.isRecording || mgr.isStarting) return mgr;
            }
            if (global.activeBots.size === 1) {
                return [...global.activeBots.values()][0];
            }
        }
        return null;
    }

    _broadcastSessionIds(sessionId) {
        const ids = new Set([sessionId, 'local-session']);
        const mgr = this._resolveBotManager(sessionId);
        if (mgr) {
            if (mgr.sessionId) ids.add(String(mgr.sessionId));
            if (mgr.mongoSessionId) ids.add(String(mgr.mongoSessionId));
        }
        return ids;
    }

    _notesMongoId(sessionId) {
        if (this._isMongoSessionId(sessionId)) return sessionId;
        const bot = this._resolveBotManager(sessionId);
        if (bot && this._isMongoSessionId(bot.mongoSessionId)) return bot.mongoSessionId;
        return null;
    }

    async _loadNotesFromDb(sessionId) {
        const Session = require('../db/models/Session');
        const meetingDedup = require('./meeting-dedup');
        const mongoId = this._notesMongoId(sessionId);
        if (mongoId) {
            const doc = await Session.findById(mongoId).select('interviewerNotes meetingKey').lean();
            // Never reuse the shared local:local-session notes bucket across meetings.
            if (doc && doc.meetingKey === 'local:local-session') return '';
            if (doc) return doc.interviewerNotes || '';
        }
        const bot = this._resolveBotManager(sessionId);
        const meetingUrl = bot && bot.meetingUrl;
        if (!meetingUrl) return '';
        const meetingKey = meetingDedup.normalizeUrl(meetingUrl);
        if (!meetingKey || meetingKey.startsWith('local:')) return '';
        const doc = await Session.findOne({
            meetingKey,
            status: { $in: ['pending', 'joining', 'active'] }
        }).sort({ createdAt: -1 }).select('_id interviewerNotes').lean();
        if (doc && bot) bot.mongoSessionId = String(doc._id);
        return doc?.interviewerNotes || '';
    }

    async _persistInterviewerNotes(sessionId, text) {
        const Session = require('../db/models/Session');
        const meetingDedup = require('./meeting-dedup');
        const bot = this._resolveBotManager(sessionId);
        if (bot) {
            bot.interviewerNotes = text;
            bot._notesHydrated = true;
        }

        const mongoId = this._notesMongoId(sessionId);
        if (mongoId) {
            const existing = await Session.findById(mongoId).select('meetingKey').lean();
            if (existing && existing.meetingKey === 'local:local-session') {
                // Don't keep writing into the shared bucket — require a real meeting session.
            } else {
                await Session.findByIdAndUpdate(mongoId, { $set: { interviewerNotes: text } });
                return;
            }
        }

        const meetingUrl = bot && bot.meetingUrl;
        if (!meetingUrl) {
            // Park notes until a real meeting session exists; never create local:local-session.
            this.pendingNotes.set(sessionId, text);
            return;
        }
        const meetingKey = meetingDedup.normalizeUrl(meetingUrl);
        const platform = meetingDedup.getPlatform(meetingUrl);

        let session = await Session.findOne({
            meetingKey,
            status: { $in: ['pending', 'joining', 'active'] }
        });
        if (!session) {
            session = new Session({
                meetingUrl: meetingUrl,
                meetingKey,
                platform,
                status: 'active',
                botLocation: 'local',
                interviewerNotes: text
            });
            await session.save();
        } else {
            session.interviewerNotes = text;
            await session.save();
        }
        if (bot) bot.mongoSessionId = String(session._id);
    }

    async _resolveInterviewerNotes(sessionId) {
        const bot = global.activeBots && global.activeBots.get(sessionId);
        if (bot && bot._notesHydrated && typeof bot.interviewerNotes === 'string') {
            return bot.interviewerNotes;
        }
        if (this.pendingNotes.has(sessionId)) {
            const pending = this.pendingNotes.get(sessionId);
            this.pendingNotes.delete(sessionId);
            if (bot) {
                bot.interviewerNotes = pending;
                bot._notesHydrated = true;
            }
            return pending;
        }
        try {
            const fromDb = await this._loadNotesFromDb(sessionId);
            if (bot) {
                bot.interviewerNotes = fromDb;
                bot._notesHydrated = true;
            }
            return fromDb;
        } catch (e) {
            console.error('[WS Hub] Failed to load interviewer notes:', e.message);
            return (bot && bot.interviewerNotes) || '';
        }
    }

    async pushSessionNotes(sessionId, ws = null) {
        const text = await this._resolveInterviewerNotes(sessionId);
        const payload = { channel: 'session:notes', data: { text } };
        if (ws) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(payload));
            }
            return;
        }
        this.broadcastToRoom(sessionId, 'session:notes', { text });
    }

    async _pushLiveEvaluation(sessionId, ws = null) {
        try {
            const Session = require('../db/models/Session');
            const mongoId = this._notesMongoId(sessionId);
            if (!mongoId) return;
            const doc = await Session.findById(mongoId).select('lastEvaluation').lean();
            const evalPayload = doc && doc.lastEvaluation;
            if (!evalPayload || typeof evalPayload !== 'object') return;
            if (!Number.isFinite(Number(evalPayload.score))) return;
            const payload = { channel: 'evaluation:update', data: evalPayload };
            if (ws) {
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
                return;
            }
            this.broadcastToRoom(sessionId, 'evaluation:update', evalPayload);
        } catch (e) {
            console.error('[WS Hub] Failed to push live evaluation:', e.message);
        }
    }

    _joinRoom(sessionId, ws, opts = {}) {
        const announce = opts.announce !== false;
        if (!this.rooms.has(sessionId)) {
            this.rooms.set(sessionId, new Set());
        }
        this.rooms.get(sessionId).add(ws);

        if (announce) {
            const botManager = this._resolveBotManager(sessionId);
            if (botManager && (botManager.isRecording || botManager.isStarting)) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        channel: 'bot:status',
                        data: {
                            status: 'active',
                            salesMode: !!botManager.salesModeActive
                        }
                    }));
                }
                if (botManager.requestParticipants) {
                    botManager.requestParticipants();
                }
            }
            this.pushSessionNotes(sessionId, ws);
            this._pushLiveEvaluation(sessionId, ws).catch(() => {});
        }
    }

    _leaveRoom(sessionId, ws) {
        if (this.rooms.has(sessionId)) {
            const room = this.rooms.get(sessionId);
            room.delete(ws);
            if (room.size === 0) {
                this.rooms.delete(sessionId);
            }
        }
    }

    _handleClientMessage(sessionId, data) {
        // Forward client messages (like takeover or manual ask) to the Pub/Sub 
        // or directly to the Queue adapter.
        console.log(`[WS Hub] Received message from client in ${sessionId}:`, data.channel);
        
        const QueueAdapter = require('./queue-adapter');
        if (data.channel === 'ask' || data.channel === 'ocr:process') {
             let transcript = [];
             let todos = data.data.todos || [];
             let jobRole = '';
             let jobDescription = '';
             const botManager = this._resolveBotManager(sessionId);
             if (botManager) {
                 if (botManager.transcriptManager) {
                     try {
                         botManager.transcriptManager.commitTurn();
                     } catch (e) {
                         console.warn('[WS Hub] commitTurn failed:', e.message);
                     }
                     transcript = botManager.transcriptManager.getContext();
                 }
                 jobRole = botManager.jobRole || '';
                 jobDescription = botManager.jobDescription || '';
             }

             const { text, mode, forceInstruction } = data.data || {};
             let manualRequest = '';
             if (mode === 'takeover') {
                 manualRequest = forceInstruction || `CRITICAL INSTRUCTION: You MUST generate a [TAKEOVER_REQUEST] now based on this instruction: "${text || 'a follow up question'}". \nThe question MUST be a crisp, direct, natural conversational question that can be spoken aloud to the user. Do not output meta-descriptions like "Review the candidate's...". \nFORMAT STRICTLY AS: [TAKEOVER_REQUEST: <crisp conversational question> : <brief reason>]\nDO NOT output any other text or conversational filler.`;
             } else if (text) {
                 manualRequest = `[User Request]: ${text}`;
             } else if (mode === 'ask') {
                 manualRequest = 'What should I say?';
             } else if (mode === 'followup') {
                 manualRequest = 'Suggest a strong follow-up the rep should say next.';
             } else if (mode === 'assist' || mode === 'search') {
                 manualRequest = 'Assist: give the best next line for the rep.';
             } else if (mode) {
                 manualRequest = `[System Command]: Please perform a ${mode} analysis on the transcript.`;
             }

             QueueAdapter.enqueue('llm-process', {
                 sessionId,
                 channel: data.channel,
                 payload: data.data,
                 transcript,
                 todos,
                 manualRequest,
                 mode: mode,
                 jobRole,
                 jobDescription,
                 salesMode: !!(botManager && botManager.salesModeActive),
                 userId: (botManager && botManager.ownerUserId) || null,
                 orgId: (botManager && botManager.ownerOrgId) || null,
                 isAutopilot: false,
                 requestId: `${sessionId}-manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
             });
             global.manualAskInFlight = true;
             global.queuedAutopilot = null;
             if (global.llmDebounceTimer) {
                 clearTimeout(global.llmDebounceTimer);
                 global.llmDebounceTimer = null;
             }
        } else if (data.channel === 'session:setup') {
             const botManager = this._resolveBotManager(sessionId);
             if (botManager) {
                 botManager.jobRole = data.data.role;
                 botManager.jobDescription = data.data.jd;
                 botManager.candidateName = data.data.candidate;
                 if (data.data.candidate && botManager.transcriptManager) {
                     botManager.transcriptManager.setCandidate(data.data.candidate);
                 }
                if (data.data.candidate && botManager.stt) {
                    botManager.stt.setCandidate(data.data.candidate);
                    if (botManager.bot && botManager.bot._lastParticipants) {
                        botManager.stt.mapParticipants(botManager.bot._lastParticipants);
                    }
                }
             }
             const { resolveMongoSessionId } = require('./session-ids');
             const Session = require('../db/models/Session');
             const mongoId = resolveMongoSessionId(sessionId);
             if (mongoId) {
                 Session.findByIdAndUpdate(mongoId, {
                     $set: {
                         jobRole: data.data.role || '',
                         jobDescription: data.data.jd || '',
                         candidateName: data.data.candidate || ''
                     }
                 }).catch((e) => console.error('[WS Hub] Failed to persist session setup:', e.message));

                 // If session has no calendar title yet, use role as display title once
                 Session.updateOne(
                     { _id: mongoId, $or: [{ title: { $exists: false } }, { title: '' }, { title: null }] },
                     { $set: { title: data.data.role || 'Interview' } }
                 ).catch(() => {});
             }
        } else if (data.channel === 'bot:start') {
             console.log(`[WS Hub] Received request to start Headless Bot for session ${sessionId}`);
             const BotRunner = require('../workers/bot-runner');
             
             let meetingUrl = data.data.url;
             // As requested: If TEST_MEETING_URL is set in .env, always prioritize it 
             // since some platforms (like Teams) hide the real join URL from the address bar.
             if (process.env.TEST_MEETING_URL) {
                 console.log(`[WS Hub] process.env.TEST_MEETING_URL is set. Overriding browser URL: ${meetingUrl} -> ${process.env.TEST_MEETING_URL}`);
                 meetingUrl = process.env.TEST_MEETING_URL;
             } else if (!meetingUrl || meetingUrl.endsWith('/gather') || meetingUrl.endsWith('/v2/') || meetingUrl === 'https://teams.live.com/' || meetingUrl === 'https://teams.microsoft.com/') {
                 console.log(`[WS Hub] Generic URL detected (${meetingUrl}) but TEST_MEETING_URL is not set.`);
             }
             
             // Trigger the headless bot to join the meeting URL provided by the extension
             BotRunner.processJob({
                 action: 'start',
                 sessionId: sessionId,
                 meetingUrl: meetingUrl,
                 language: data.data.language,
                 candidateName: data.data.interviewerName
             }).then(() => {
                 if (data.id && ws.readyState === WebSocket.OPEN) {
                     ws.send(JSON.stringify({ id: data.id, response: { success: true } }));
                 }
             }).catch(err => {
                 if (data.id && ws.readyState === WebSocket.OPEN) {
                     ws.send(JSON.stringify({ id: data.id, error: err.message }));
                 }
             });
             return;
        } else if (data.channel === 'agent:approve-takeover') {
             const botManager = this._resolveBotManager(sessionId);
             if (botManager) {
                 console.log(`[WS Hub] Takeover approved for session ${sessionId}. Speaking...`);
                 botManager.speakQuestion(data.data.question).catch(e => console.error('[WS Hub] BotManager speakQuestion failed:', e));
             }
        } else if (data.channel === 'agent:deny-takeover') {
             console.log(`[WS Hub] Takeover denied by user for session ${sessionId}.`);
        } else if (data.channel === 'candidate:set') {
             const botManager = this._resolveBotManager(sessionId);
             if (botManager) {
                 console.log(`[WS Hub] Candidate set to ${data.data.name} for session ${sessionId}`);
                 botManager.candidateName = data.data.name;
                 if (botManager.transcriptManager) {
                     botManager.transcriptManager.setCandidate(data.data.name);
                 }
                 if (botManager.stt) {
                     botManager.stt.setCandidate(data.data.name);
                     if (botManager.bot && botManager.bot._lastParticipants) {
                         botManager.stt.mapParticipants(botManager.bot._lastParticipants);
                     }
                 }
                 const { scheduleLiveEvaluation } = require('../services/live-evaluation');
                 scheduleLiveEvaluation(sessionId, botManager);
             }
        } else if (data.channel === 'transcript:comment') {
             const TranscriptTurn = require('../db/models/TranscriptTurn');
             const { turnId, text } = data.data || {};
             if (turnId && text) {
                 TranscriptTurn.findOneAndUpdate(
                     { sessionId, turnIndex: parseInt(turnId) },
                     { $push: { comments: { text, timestamp: new Date() } } }
                 ).catch(e => console.error('[WS Hub] Failed to save transcript comment:', e.message));
                 console.log(`[WS Hub] Comment saved for turn ${turnId} in session ${sessionId}`);
             }
        } else if (data.channel === 'transcript:notes-sync') {
             const TranscriptTurn = require('../db/models/TranscriptTurn');
             const { turnId, notes } = data.data || {};
             if (turnId != null) {
                 TranscriptTurn.findOneAndUpdate(
                     { sessionId, turnIndex: parseInt(turnId) },
                     { $set: { comments: (notes || []).map(t => ({ text: t, timestamp: new Date() })) } }
                 ).catch(e => console.error('[WS Hub] Failed to sync notes:', e.message));
             }
        } else if (data.channel === 'session:notes-sync') {
             const text = typeof data.data?.text === 'string' ? data.data.text : '';
             const botManager = this._resolveBotManager(sessionId);
             if (botManager) {
                 botManager.interviewerNotes = text;
                 this.pendingNotes.delete(sessionId);
             } else {
                 this.pendingNotes.set(sessionId, text);
             }
             this._persistInterviewerNotes(sessionId, text)
                 .then(() => this.broadcastToRoom(sessionId, 'session:notes-saved', { ok: true }))
                 .catch((e) => {
                     console.error('[WS Hub] Failed to save interviewer notes:', e.message);
                     this.broadcastToRoom(sessionId, 'session:notes-saved', { ok: false });
                 });
        } else if (data.channel === 'session:notes-request') {
             this.pushSessionNotes(sessionId);
        } else if (data.channel === 'action-items:sync') {
             const ActionItem = require('../db/models/ActionItem');
             const items = data.data?.items || [];
             ActionItem.deleteMany({ sessionId }).then(() => {
                 if (items.length > 0) {
                     return ActionItem.insertMany(items.map(i => ({
                         sessionId,
                         text: i.text,
                         status: i.status || 'pending',
                         source: 'manual'
                     })));
                 }
             }).catch(e => console.error('[WS Hub] Failed to sync action items:', e.message));
        } else if (data.channel === 'participants:request') {
             const botManager = this._resolveBotManager(sessionId);
             if (botManager && botManager.requestParticipants) {
                 console.log(`[WS Hub] Requesting participants for session ${sessionId} from Headless Bot.`);
                 botManager.requestParticipants();
             } else {
                 console.log(`[WS Hub] Cannot request participants: bot not active for session ${sessionId}`);
                 this.broadcastToRoom(sessionId, 'participants:update', { error: 'Please wait for the bot to join the meeting.' });
             }
        }
    }

    /**
     * Broadcasts a message to all clients in a specific session room
     */
    broadcastToRoom(sessionId, channel, data) {
        const BROADCAST_ALL_ROOMS = new Set([
            'participants:update', 'bot:status', 'session:started', 'evaluation:update',
            'transcript:update', 'llm:start', 'llm:token', 'llm:done', 'llm:error'
        ]);
        const roomIds = BROADCAST_ALL_ROOMS.has(channel)
            ? this._broadcastSessionIds(sessionId)
            : new Set([sessionId]);

        const messageStr = JSON.stringify({ channel, data });
        // Clients join both local-session + mongo room — never send the same event twice.
        const seen = new Set();
        let sentCount = 0;
        let clientCount = 0;

        for (const roomId of roomIds) {
            if (!this.rooms.has(roomId)) continue;
            const clients = this.rooms.get(roomId);
            clientCount += clients.size;
            clients.forEach(client => {
                if (seen.has(client)) return;
                seen.add(client);
                if (client.readyState === WebSocket.OPEN) {
                    client.send(messageStr);
                    sentCount++;
                }
            });
        }

        if (channel === 'participants:update' || channel === 'transcript:update' || channel === 'llm:token') {
            console.log(`[WS Hub] broadcastToRoom(${sessionId}, ${channel}): Sent to ${sentCount} unique clients across ${roomIds.size} room id(s)`);
        }

        if (![...roomIds].some((id) => this.rooms.has(id))) {
            console.log(`[WS Hub] broadcastToRoom(${sessionId}, ${channel}): NO ROOM EXISTS. Available rooms: [${Array.from(this.rooms.keys()).join(', ')}]`);
        }
    }
}

module.exports = new WebSocketHub();
