require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const connectDB = require('./db/mongo');
const wsHub = require('./services/ws-hub');
const pubsubAdapter = require('./services/pubsub-adapter');

if (process.env.DEBUG_WEBRTC_AUDIO === '1') {
    console.log('[API Server] DEBUG_WEBRTC_AUDIO=1 (WebRTC metadata diagnostics enabled)');
}

// Import routes
const authRoutes = require('./routes/auth');
const sessionRoutes = require('./routes/sessions');
const meetingsRoutes = require('./routes/meetings');
const reportsRoutes = require('./routes/reports');
const knowledgeRoutes = require('./routes/knowledge');
const organizationRoutes = require('./routes/organizations');
const hubspotRoutes = require('./routes/hubspot');

const app = express();
app.use(express.json({ limit: '10mb' }));

// Basic CORS middleware to allow Chrome Extension injection
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-worker-token');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Health check endpoint for Cloud Run / Railway / Render
app.get('/health', (req, res) => res.status(200).send('OK'));

app.get('/api/config', (req, res) => {
    const publicUrl = (process.env.PUBLIC_URL || process.env.API_BASE_URL || '').replace(/\/$/, '')
        || `${req.protocol}://${req.get('host')}`;
    res.json({
        publicUrl,
        wsUrl: publicUrl.replace(/^http/, 'ws') + '/ws'
    });
});

// Google Site Verification Route
app.get('/', (req, res) => {
    const dashIndex = path.resolve(__dirname, '../dashboard/dist/index.html');
    if (fs.existsSync(dashIndex)) {
        return res.redirect('/app/');
    }
    res.send('<html><head><meta name="google-site-verification" content="bL8YYSzHDLu6S4u-l3CBJ-RVxAEufxL3KGUTDPba1NU" /></head><body>AI Meet API</body></html>');
});

// API Routes
app.use('/auth', authRoutes);
app.use('/organizations', organizationRoutes);
app.use('/sessions', sessionRoutes);
app.use('/meetings', meetingsRoutes);
app.use('/reports', reportsRoutes);
app.use('/knowledge', knowledgeRoutes);
app.use('/hubspot', hubspotRoutes);

const calendarRoutes = require('./routes/calendars');
const webhookRoutes = require('./routes/calendars/webhooks');
const webhookMicrosoftRoutes = require('./routes/calendars/webhooks-microsoft');
const webhookZoomRoutes = require('./routes/calendars/webhooks-zoom');
// Webhooks must mount before auth-gated /calendars routes (requireAuth would 401 Google/MS/Zoom)
app.use('/calendars', webhookRoutes);
app.use('/calendars', webhookMicrosoftRoutes);
app.use('/calendars', webhookZoomRoutes);
app.use('/calendars', calendarRoutes);

const workerRoutes = require('./workers/index');
app.use('/workers', workerRoutes);

const { scheduleLiveEvaluation } = require('./services/live-evaluation');

// Direct Bot Spawning Endpoint (No Electron/Redis required)
app.post('/bot/start', async (req, res) => {
    if (!req.body.blocking) {
        console.log('[Server] Redirecting /bot/start to bot-run-now worker queue...');
        const queueAdapter = require('./services/queue-adapter');
        queueAdapter.enqueue('bot-run-now', req.body).catch(e => console.error('[Server] Failed to enqueue bot:', e));
        return res.status(200).json({ success: true, message: 'Bot queued via workers' });
    }

    try {
        const { optionalAuthUser } = require('./services/session-ids');
        const user = optionalAuthUser(req);
        let { language, interviewerName, sessionId = 'local-session' } = req.body;
        const ownerUserId = (user && user.userId) || req.body.userId || null;
        const ownerOrgId = (user && user.orgId) || req.body.orgId || null;

        let url = req.body.url;
        // If URL is missing or just a generic homepage, prioritize the .env test URL
        if (!url || url.endsWith('/gather') || url.endsWith('/v2/') || url === 'https://teams.live.com/' || url === 'https://teams.microsoft.com/') {
            if (process.env.TEST_MEETING_URL) {
                console.log(`[REST] Generic or missing URL detected. Using TEST_MEETING_URL: ${process.env.TEST_MEETING_URL}`);
                url = process.env.TEST_MEETING_URL;
            }
        }

        if (!url) return res.status(400).json({ error: 'Missing meeting url' });

        console.log(`[Server] Received request to start headless bot for ${url}`);

        // Import BotManager locally to avoid breaking pure REST deployments
        if (!global.activeBots) global.activeBots = new Map();

        // If the backend auto-joined this meeting via Calendar, the bot is ALREADY running!
        if (global.activeBots.has(sessionId)) {
            const existingBot = global.activeBots.get(sessionId);
            
            // If it's for the same meeting URL, the user is just logging into the extension 
            // and providing the Candidate Name / Job Role! We shouldn't start a second bot.
            if (existingBot.meetingUrl === url || !existingBot.meetingUrl) {
                console.log(`[Server] Bot already running for ${url}. Extension is attaching context.`);
                
                // Update context on the existing bot (keep calendar title; job role is separate)
                if (req.body.title) existingBot.meetingTitle = req.body.title;
                if (req.body.jobRole != null) existingBot.jobRole = req.body.jobRole;
                if (req.body.jobDescription != null) existingBot.jobDescription = req.body.jobDescription;
                
                if (req.body.candidateName && existingBot.transcriptManager) {
                    existingBot.transcriptManager.setCandidate(req.body.candidateName);
                    existingBot.candidateName = req.body.candidateName;
                    if (existingBot.stt) existingBot.stt.setCandidate(req.body.candidateName);
                }

                if (existingBot.mongoSessionId) {
                    const Session = require('./db/models/Session');
                    const patch = {};
                    if (req.body.title) patch.title = req.body.title;
                    if (req.body.jobRole != null) patch.jobRole = req.body.jobRole;
                    if (req.body.jobDescription != null) patch.jobDescription = req.body.jobDescription;
                    if (req.body.candidateName) patch.candidateName = req.body.candidateName;
                    if (ownerUserId) {
                        existingBot.ownerUserId = ownerUserId;
                        patch.createdBy = ownerUserId;
                    }
                    if (ownerOrgId) {
                        existingBot.ownerOrgId = ownerOrgId;
                        patch.orgId = ownerOrgId;
                    }
                    if (ownerUserId) {
                        try {
                            const User = require('./db/models/User');
                            const prefs = await User.findById(ownerUserId).select('salesModeActive orgId').lean();
                            existingBot.salesModeActive = !!prefs?.salesModeActive;
                            if (!ownerOrgId && prefs?.orgId) {
                                existingBot.ownerOrgId = String(prefs.orgId);
                                patch.orgId = prefs.orgId;
                            }
                        } catch (e) {}
                    }
                    if (Object.keys(patch).length) {
                        Session.findByIdAndUpdate(existingBot.mongoSessionId, { $set: patch }).catch(() => {});
                    }
                }

                scheduleLiveEvaluation(sessionId, existingBot);

                return res.status(200).json({ success: true, message: 'Bot context updated successfully. Attached to active bot.' });
            } else {
                console.log(`[Server] Stopping existing bot to join new URL...`);
                if (existingBot.bot) await existingBot.bot.leave();
                global.activeBots.delete(sessionId);
            }
        }

        const BotManager = require('../desktop/main/bot-manager');
        const botManager = new BotManager(sessionId);

        // Store Job metadata early so the LLM worker can access it when the first turn completes
        botManager.meetingTitle = req.body.title || '';
        botManager.jobRole = req.body.jobRole || '';
        botManager.jobDescription = req.body.jobDescription || '';
        botManager.botDisplayName = req.body.botDisplayName || process.env.BOT_DISPLAY_NAME || 'Xobin';
        botManager.ownerUserId = ownerUserId || null;
        botManager.ownerOrgId = ownerOrgId || null;
        botManager.salesModeActive = false;
        botManager.meetingEndAt = req.body.meetingEndAt
            ? new Date(req.body.meetingEndAt).getTime()
            : null;
        if (ownerUserId) {
            try {
                const User = require('./db/models/User');
                const prefs = await User.findById(ownerUserId)
                    .select('preferredLanguage botDisplayName salesModeActive orgId')
                    .lean();
                if (prefs?.preferredLanguage && !language) language = prefs.preferredLanguage;
                if (prefs?.botDisplayName && !req.body.botDisplayName) botManager.botDisplayName = prefs.botDisplayName;
                botManager.salesModeActive = !!prefs?.salesModeActive;
                if (!ownerOrgId && prefs?.orgId) {
                    ownerOrgId = String(prefs.orgId);
                    botManager.ownerOrgId = ownerOrgId;
                }
                if (botManager.salesModeActive) {
                    console.log(`[Server] Sales Mode active for user ${ownerUserId} (org ${botManager.ownerOrgId || 'n/a'})`);
                }
            } catch (e) {}
        }
        if (req.body.candidateName && botManager.transcriptManager) {
            botManager.transcriptManager.setCandidate(req.body.candidateName);
            botManager.candidateName = req.body.candidateName;
            if (botManager.stt) botManager.stt.setCandidate(req.body.candidateName);
        }
        try {
            const meetingDedup = require('./services/meeting-dedup');
            const { session } = await meetingDedup.getOrCreateSession(
                url, ownerOrgId, ownerUserId, language || 'multi', req.body.candidateName, 'local'
            );
            botManager.mongoSessionId = String(session._id);
            try {
                const { clearReportLock } = require('./services/report-service');
                clearReportLock(session._id);
            } catch (e) {}
            if (ownerUserId && !session.createdBy) {
                session.createdBy = ownerUserId;
            }
            if (ownerOrgId && !session.orgId) {
                session.orgId = ownerOrgId;
            }
            const meetingTitle = String(req.body.title || '').trim();
            if (meetingTitle) session.title = meetingTitle;
            if (req.body.jobRole) session.jobRole = req.body.jobRole;
            if (req.body.jobDescription) session.jobDescription = req.body.jobDescription;
            if (req.body.candidateName) session.candidateName = req.body.candidateName;
            session.salesMode = !!botManager.salesModeActive;
            // Prefer calendar event name when job role was never set
            if (!session.title && session.jobRole) session.title = session.jobRole;
            if (meetingTitle || req.body.jobRole || req.body.jobDescription || req.body.candidateName || ownerUserId || ownerOrgId || botManager.salesModeActive) {
                await session.save();
            }
            if (req.body.scheduledMeetingId) {
                const ScheduledMeeting = require('./db/models/ScheduledMeeting');
                const scheduled = await ScheduledMeeting.findById(req.body.scheduledMeetingId).catch(() => null);
                if (scheduled) {
                    scheduled.sessionId = String(session._id);
                    scheduled.updatedAt = new Date();
                    if (!botManager.meetingEndAt && scheduled.endTime) {
                        botManager.meetingEndAt = new Date(scheduled.endTime).getTime();
                    }
                    if (scheduled.preMeetingBrief && !session.hubspotContext) {
                        session.hubspotContext = scheduled.preMeetingBrief;
                        await session.save();
                    } else if (!session.hubspotContext && (session.salesMode || botManager.salesModeActive)) {
                        try {
                            const researchService = require('./services/research-service');
                            const orgId = session.orgId || ownerOrgId;
                            if (orgId) {
                                const User = require('./db/models/User');
                                const CalendarConnection = require('./db/models/CalendarConnection');
                                const [owner, cal] = await Promise.all([
                                    scheduled.userId
                                        ? User.findById(scheduled.userId).select('email').lean().catch(() => null)
                                        : null,
                                    scheduled.calendarConnectionId
                                        ? CalendarConnection.findById(scheduled.calendarConnectionId).select('providerEmail').lean().catch(() => null)
                                        : null
                                ]);
                                const lookup = researchService.pickLookupFromMeeting(scheduled, {
                                    prospectName: req.body.candidateName || scheduled.candidateName,
                                    ownerEmail: owner && owner.email,
                                    calendarEmail: cal && cal.providerEmail,
                                    organizerEmail: scheduled.organizerEmail
                                });
                                const brief = await researchService.research(orgId, lookup);
                                scheduled.preMeetingBrief = brief;
                                session.hubspotContext = brief;
                                await session.save();
                            }
                        } catch (researchErr) {
                            console.warn('[Server] Pre-call research failed:', researchErr.message);
                        }
                    }
                    await scheduled.save().catch(() => {});
                }
            } else if ((session.salesMode || botManager.salesModeActive) && !session.hubspotContext) {
                try {
                    const researchService = require('./services/research-service');
                    const orgId = session.orgId || ownerOrgId;
                    if (orgId) {
                        const attendees = Array.isArray(req.body.participants) ? req.body.participants : [];
                        const emailFromBody = attendees.map((p) => (typeof p === 'string' ? '' : (p && p.email))).find(Boolean);
                        const brief = await researchService.research(orgId, {
                            prospectName: req.body.candidateName || session.candidateName || '',
                            email: emailFromBody || '',
                            companyDomain: researchService.domainFromEmail(emailFromBody || '')
                        });
                        session.hubspotContext = brief;
                        await session.save();
                    }
                } catch (researchErr) {
                    console.warn('[Server] Session research seed failed:', researchErr.message);
                }
            }
            const wsHub = require('./services/ws-hub');
            // Never carry notes parked under local-session into a different Meet link.
            const pending = wsHub.pendingNotes && wsHub.pendingNotes.get(sessionId);
            if (pending && typeof pending === 'string' && pending.trim()) {
                wsHub.pendingNotes.delete(sessionId);
                // Only apply pending notes when this Mongo session is brand new / empty.
                if (!session.interviewerNotes) {
                    session.interviewerNotes = pending;
                    botManager.interviewerNotes = pending;
                    await session.save();
                }
            } else if (session.interviewerNotes && session.meetingKey && !String(session.meetingKey).startsWith('local:')) {
                botManager.interviewerNotes = session.interviewerNotes;
            } else {
                botManager.interviewerNotes = '';
                if (session.meetingKey && String(session.meetingKey).startsWith('local:')) {
                    session.interviewerNotes = '';
                }
            }
            botManager._notesHydrated = true;
            wsHub.pushSessionNotes(sessionId).catch(() => {});
            if (session.status === 'pending') {
                session.status = 'joining';
                await session.save();
            }
        } catch (e) {
            console.error('[Server] Failed to attach Mongo session for notes:', e.message);
        }

        // Forward live transcript updates to the UI via Pub/Sub -> WS Hub
        botManager.on('transcript:update', (data) => {
            if (
                global.pendingAutopilotTurn != null &&
                data &&
                data.turnId === global.pendingAutopilotTurn &&
                data.isComplete === false
            ) {
                if (global.llmDebounceTimer) {
                    clearTimeout(global.llmDebounceTimer);
                    global.llmDebounceTimer = null;
                }
                global.pendingAutopilotTurn = null;
            }
            const pubsubAdapter = require('./services/pubsub-adapter');
            const publishSessionId = botManager.mongoSessionId || sessionId;
            pubsubAdapter.publish('transcript-events', {
                sessionId: publishSessionId,
                channel: 'transcript:update',
                payload: data
            });
        });

        botManager.on('participants:update', (participants) => {
            const pubsubAdapter = require('./services/pubsub-adapter');
            pubsubAdapter.publish('session-lifecycle', {
                sessionId: sessionId,
                channel: 'participants:update',
                payload: participants
            });
            if (botManager.mongoSessionId && Array.isArray(participants) && participants.length) {
                const Session = require('./db/models/Session');
                const docs = participants.map((p) =>
                    typeof p === 'string' ? { name: p } : { name: (p && p.name) || String(p), isCandidate: !!(p && p.isCandidate) }
                ).filter((p) => p.name);
                Session.findByIdAndUpdate(botManager.mongoSessionId, { participants: docs })
                    .catch((e) => console.error('[Server] Failed to save participants:', e.message));
            }
        });

        botManager.on('turn:complete', (turn) => {
            const queueAdapter = require('./services/queue-adapter');
            const TranscriptTurn = require('./db/models/TranscriptTurn');
            const persistId = botManager.mongoSessionId || sessionId;
            TranscriptTurn.findOneAndUpdate(
                { sessionId: persistId, turnIndex: turn.turnIndex },
                {
                    $set: {
                        speaker: turn.speaker,
                        speakerRole: turn.speakerRole,
                        text: turn.text,
                        timestampMs: turn.timestamp
                    }
                },
                { upsert: true, new: true }
            ).catch(e => console.error('[MongoDB] Failed to save transcript turn:', e.message));

            scheduleLiveEvaluation(sessionId, botManager);

            const { isAutopilotEligible } = require('./services/autopilot');
            const sales = !!botManager.salesModeActive;
            const wordCount = String(turn.text || '').trim().split(/\s+/).filter(Boolean).length;
            const autopilotEligible = isAutopilotEligible(turn, { salesMode: sales });

            if (!autopilotEligible && turn.speakerRole !== 'candidate') {
                console.log(`[Autopilot] Skip — silence after ${turn.speakerRole || 'panel'} (${turn.speaker}), waiting for customer/candidate`);
            }

            if (autopilotEligible) {
                if (global.manualAskInFlight) {
                    console.log('[Autopilot] Suppressed — manual Assist/ask in flight');
                    return;
                }
                if (global.manualAskCooldownUntil && Date.now() < global.manualAskCooldownUntil) {
                    console.log('[Autopilot] Suppressed — cooldown after manual ask');
                    return;
                }
                const turnKey = `${sessionId}:${turn.turnIndex}`;
                const textSig = `${turnKey}:${String(turn.text || '').trim().length}`;
                // Allow re-fire when the same turn grew a lot after a premature silence finalize
                if (global.lastAutopilotSig === textSig) return;
                if (global.lastAutopilotTurn === turnKey) {
                    const prevLen = Number(global.lastAutopilotTextLen) || 0;
                    const curLen = String(turn.text || '').trim().length;
                    if (curLen < prevLen + 40) return;
                }
                if (global.llmDebounceTimer) clearTimeout(global.llmDebounceTimer);
                global.pendingAutopilotTurn = turn.turnIndex;
                const enqueueAutopilot = () => {
                    if (global.manualAskInFlight || (global.manualAskCooldownUntil && Date.now() < global.manualAskCooldownUntil)) {
                        console.log('[Autopilot] Dropped debounced job — manual ask active/cooldown');
                        return;
                    }
                    if (global.llmInFlight) {
                        global.queuedAutopilot = { sessionId, turn, botManager, turnKey, textSig };
                        console.log('[Autopilot] LLM busy — queued follow-up for after current job');
                        return;
                    }
                    global.lastAutopilotTurn = turnKey;
                    global.lastAutopilotSig = textSig;
                    global.lastAutopilotTextLen = String(turn.text || '').trim().length;
                    global.pendingAutopilotTurn = null;
                    global.llmInFlight = true;
                    console.log(`[Autopilot] Enqueueing suggestion for turn ${turn.turnIndex} (${wordCount} words, sales=${sales})`);
                    queueAdapter.enqueue('llm-process', {
                        sessionId,
                        channel: 'ask',
                        transcript: botManager.transcriptManager.getContext(),
                        todos: [],
                        isAutopilot: true,
                        triggerTurnIndex: turn.turnIndex,
                        jobRole: botManager.jobRole || '',
                        jobDescription: botManager.jobDescription || '',
                        salesMode: sales,
                        userId: botManager.ownerUserId || null,
                        orgId: botManager.ownerOrgId || null,
                        requestId: `${sessionId}-auto-${turn.turnIndex}-${Date.now()}`
                    }).catch(e => {
                        global.llmInFlight = false;
                        console.error('[Queue] Failed to enqueue LLM job:', e);
                    });
                };
                // Wait for same-speaker stacking to settle before suggesting
                global.llmDebounceTimer = setTimeout(enqueueAutopilot, 2500);
            }
        });

        global.activeBots.set(sessionId, botManager);

        botManager.on('session:stopped', async () => {
            if (global.activeBots && global.activeBots.get(sessionId) === botManager) {
                global.activeBots.delete(sessionId);
            }
            try {
                const TranscriptTurn = require('./db/models/TranscriptTurn');
                const persistId = botManager.mongoSessionId || sessionId;
                const buf = botManager.transcriptManager
                    ? (typeof botManager.transcriptManager.getAllTurns === 'function'
                        ? botManager.transcriptManager.getAllTurns()
                        : botManager.transcriptManager.getContext())
                    : [];
                const flush = Array.isArray(buf) ? buf.filter((t) => t && t.text) : [];
                await Promise.all(flush.map((turn) =>
                    TranscriptTurn.findOneAndUpdate(
                        { sessionId: persistId, turnIndex: turn.turnIndex },
                        {
                            $set: {
                                speaker: turn.speaker,
                                speakerRole: turn.speakerRole,
                                text: turn.text,
                                timestampMs: turn.timestamp
                            }
                        },
                        { upsert: true, new: true }
                    ).catch(() => null)
                ));
                // Brief settle so last async turn writes land before the worker reads.
                await new Promise((r) => setTimeout(r, 600));

                const { startReportGeneration } = require('./services/report-service');
                const humans = Array.isArray(botManager._lastParticipants)
                    ? botManager._lastParticipants
                    : undefined;
                await startReportGeneration(botManager.mongoSessionId || sessionId, {
                    userId: ownerUserId || (user && user.userId),
                    orgId: ownerOrgId || (user && user.orgId),
                    candidateName: botManager.candidateName,
                    jobRole: botManager.jobRole,
                    title: botManager.meetingTitle || botManager.jobRole || '',
                    participants: humans
                });
            } catch (e) {
                console.error('[Server] Failed to enqueue report after hangup:', e.message);
            }
            const pubsubAdapter = require('./services/pubsub-adapter');
            pubsubAdapter.publish('session-lifecycle', {
                sessionId,
                channel: 'bot:status',
                payload: { status: 'stopped' }
            });
        });

        // Start the bot asynchronously or synchronously based on blocking flag
        const startPromise = botManager.startSession(url, language || 'multi', interviewerName || 'Interviewer', process.env.DEEPGRAM_API_KEY).then(() => {
            const pubsubAdapter = require('./services/pubsub-adapter');
            pubsubAdapter.publish('session-lifecycle', {
                sessionId,
                channel: 'bot:status',
                payload: { status: 'active', salesMode: !!botManager.salesModeActive }
            });
            pubsubAdapter.publish('session-lifecycle', {
                sessionId,
                channel: 'session:started',
                payload: {}
            });
        }).catch(e => {
            console.error('[Server BotManager] Error:', e.message);
            global.activeBots.delete(sessionId);
            const pubsubAdapter = require('./services/pubsub-adapter');
            pubsubAdapter.publish('session-lifecycle', {
                sessionId,
                channel: 'bot:status',
                payload: { status: 'error', error: e.message }
            });
            throw e;
        });

        if (req.body.blocking) {
            console.log(`[Server] Blocking HTTP request for meeting ${sessionId} to prevent Cloud Run CPU throttling...`);
            await startPromise;
            // Wait for session to stop
            await new Promise(resolve => botManager.on('session:stopped', resolve));
            console.log(`[Server] Meeting ${sessionId} finished, unblocking HTTP request.`);
            return res.status(200).json({ success: true, message: 'Meeting finished' });
        } else {
            return res.status(200).json({ success: true, message: 'Bot started in background' });
        }
    } catch (e) {
        console.error('[Server] Failed to start bot:', e);
        res.status(500).json({ error: e.message });
    }
});

// HTTP REST endpoint for fetching participants (bypasses WebSocket entirely)
app.get('/bot/participants', async (req, res) => {
    const sessionId = req.query.sessionId || 'local-session';
    const wsHub = require('./services/ws-hub');
    const botManager = wsHub._resolveBotManager(sessionId);
    if (botManager && (botManager.isRecording || botManager.isStarting) && botManager.bot) {
        try {
            const list = await botManager.bot.getParticipants();
            res.json({ participants: list, botActive: true });
        } catch (e) {
            res.json({ participants: [], botActive: true, error: e.message });
        }
    } else {
        res.json({ participants: null, botActive: false });
    }
});

app.post('/bot/stop', async (req, res) => {
    try {
        const { optionalAuthUser } = require('./services/session-ids');
        optionalAuthUser(req);
        let sessionId = (req.body && req.body.sessionId) || 'local-session';
        let botManager = global.activeBots && global.activeBots.get(sessionId);
        if (!botManager && global.activeBots && global.activeBots.size === 1) {
            const [id, mgr] = [...global.activeBots.entries()][0];
            sessionId = id;
            botManager = mgr;
        }
        if (!botManager) {
            return res.status(404).json({ error: 'Bot not found' });
        }

        console.log(`[Server] Received request to stop bot for ${sessionId}`);
        // stopSession emits session:stopped → report enqueue lives only there (avoid double enqueue / cast races)
        await botManager.stopSession();
        if (global.activeBots && global.activeBots.get(sessionId) === botManager) {
            global.activeBots.delete(sessionId);
        }

        res.status(200).json({ success: true, message: 'Bot stopped successfully' });
    } catch (e) {
        console.error('[Server] Failed to stop bot:', e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/report/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const Report = require('./db/models/Report');
        const report = await Report.findOne({ sessionId });

        if (report && report.status === 'failed') {
            return res.status(200).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px"><h2>Report failed</h2><p>${report.error || 'Unknown error'}</p></body></html>`);
        }

        if (report && report.status === 'ready' && report.htmlContent) {
            res.send(report.htmlContent);
        } else if (report && report.status === 'ready') {
            res.json({
                summary: report.summary,
                recommendation: report.recommendation,
                overallScore: report.overallScore,
                strengths: report.strengths,
                concerns: report.concerns
            });
        } else {
            // Serve a sleek auto-refreshing loading state
            res.send(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Generating Report...</title>
                    <meta http-equiv="refresh" content="3">
                    <style>
                        body {
                            background-color: #09090b;
                            color: #fafafa;
                            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            justify-content: center;
                            height: 100vh;
                            margin: 0;
                        }
                        .loader {
                            border: 3px solid rgba(255, 255, 255, 0.1);
                            border-top: 3px solid #3b82f6;
                            border-radius: 50%;
                            width: 40px;
                            height: 40px;
                            animation: spin 1s linear infinite;
                            margin-bottom: 20px;
                        }
                        @keyframes spin {
                            0% { transform: rotate(0deg); }
                            100% { transform: rotate(360deg); }
                        }
                        h2 { font-weight: 500; font-size: 1.2rem; }
                        p { color: #a1a1aa; font-size: 0.95rem; }
                    </style>
                </head>
                <body>
                    <div class="loader"></div>
                    <h2>Generating your session report...</h2>
                    <p>This usually takes 10 to 30 seconds.</p>
                </body>
                </html>
            `);
        }
    } catch (e) {
        res.status(500).send('Internal Server Error: ' + e.message);
    }
});

// Pub/Sub Push Webhook endpoint (for Cloud Run production)
app.post('/pubsub/push', async (req, res) => {
    try {
        const message = req.body.message;
        if (!message) return res.status(400).send('Bad Request');

        const data = JSON.parse(Buffer.from(message.data, 'base64').toString());
        // We will decode and pass this to our ws-hub to broadcast
        if (data.sessionId && data.channel) {
            wsHub.broadcastToRoom(data.sessionId, data.channel, data.payload);
        }

        res.status(204).send();
    } catch (e) {
        console.error('[API Server] Pub/Sub Push error:', e.message);
        res.status(500).send();
    }
});

const server = http.createServer(app);

// Initialize WebSocket Hub
wsHub.init(server);

const dashDist = path.resolve(__dirname, '../dashboard/dist');
if (fs.existsSync(dashDist)) {
    app.use('/app', express.static(dashDist));
    app.use('/app', (req, res) => {
        res.sendFile(path.join(dashDist, 'index.html'));
    });
    console.log('[API Server] Dashboard static files mounted at /app');
}

// Start Server
const PORT = process.env.PORT || 8080;
connectDB().then(() => {
    server.listen(PORT, '0.0.0.0', async () => {
        console.log(`[API Server] Running on port ${PORT}`);

        // Listen to PubSub (Redis) locally to broadcast to WS clients
        if (!pubsubAdapter.isCloud) {
            console.log('[API Server] Subscribing to local Redis Pub/Sub...');
            pubsubAdapter.subscribe('transcript-events', (msg) => wsHub.broadcastToRoom(msg.sessionId, msg.channel, msg.payload));
            pubsubAdapter.subscribe('llm-results', (msg) => {
                wsHub.broadcastToRoom(msg.sessionId, msg.channel, msg.payload);
                if (msg.channel === 'llm:done' || msg.channel === 'llm:error') {
                    const payload = msg.payload || {};
                    const doneIsAutopilot = !!payload.isAutopilot;
                    global.llmInFlight = false;
                    if (!doneIsAutopilot) {
                        global.manualAskInFlight = false;
                        global.queuedAutopilot = null;
                        global.manualAskCooldownUntil = Date.now() + 12000;
                        console.log('[Autopilot] Manual ask finished — cleared queue + 12s cooldown');
                        return;
                    }
                    if (global.manualAskInFlight) {
                        console.log('[Autopilot] Ignoring autopilot done while manual ask in flight');
                        return;
                    }
                    const queued = global.queuedAutopilot;
                    if (queued && queued.sessionId) {
                        global.queuedAutopilot = null;
                        const turn = queued.turn;
                        if (turn && turn.text) {
                            const { isAutopilotEligible } = require('./services/autopilot');
                            const salesQ = !!(queued.botManager && queued.botManager.salesModeActive);
                            const ok = isAutopilotEligible(turn, { salesMode: salesQ });
                            if (ok) {
                            const queueAdapter = require('./services/queue-adapter');
                            global.lastAutopilotTurn = queued.turnKey;
                            global.lastAutopilotSig = queued.textSig;
                            global.lastAutopilotTextLen = String(turn.text || '').trim().length;
                            global.llmInFlight = true;
                            console.log('[Autopilot] Running queued follow-up after prior LLM finished');
                            queueAdapter.enqueue('llm-process', {
                                sessionId: queued.sessionId,
                                channel: 'ask',
                                transcript: queued.botManager.transcriptManager.getContext(),
                                todos: [],
                                isAutopilot: true,
                                triggerTurnIndex: turn.turnIndex,
                                jobRole: queued.botManager.jobRole || '',
                                jobDescription: queued.botManager.jobDescription || '',
                                salesMode: salesQ,
                                userId: queued.botManager.ownerUserId || null,
                                orgId: queued.botManager.ownerOrgId || null,
                                requestId: `${queued.sessionId}-auto-${turn.turnIndex}-${Date.now()}`
                            }).catch(e => {
                                global.llmInFlight = false;
                                console.error('[Queue] Failed to enqueue queued autopilot:', e);
                            });
                            }
                        }
                    }
                }
            });
            pubsubAdapter.subscribe('session-lifecycle', (msg) => {
                if (msg.channel === 'participants:update') {
                    console.log(`[PubSub->WS] Received participants:update for session ${msg.sessionId}. Forwarding to WS Hub...`);
                }
                wsHub.broadcastToRoom(msg.sessionId, msg.channel, msg.payload);
                if (msg.channel === 'bot:status' && msg.payload && msg.payload.status === 'active') {
                    wsHub.pushSessionNotes(msg.sessionId);
                }
            });
        }

        // --- Startup Routine: Sync all calendars to reconcile meetings and catch changes ---
        const CalendarConnection = require('./db/models/CalendarConnection');

        // Sync Google
        const googleConnections = await CalendarConnection.find({ enabled: true, provider: 'google' });
        if (googleConnections.length > 0) {
            const googleAdapter = require('./services/calendars/google-adapter');
            for (const conn of googleConnections) {
                try {
                    await googleAdapter.syncEvents(conn);
                } catch (e) {
                    console.error(`[Startup] Failed to sync Google calendar for ${conn.providerEmail}:`, e.message);
                }
            }
        }

        // Sync Microsoft
        const microsoftConnections = await CalendarConnection.find({ enabled: true, provider: 'microsoft' });
        if (microsoftConnections.length > 0) {
            const microsoftAdapter = require('./services/calendars/microsoft-adapter');
            for (const conn of microsoftConnections) {
                try {
                    await microsoftAdapter.syncEvents(conn);
                } catch (e) {
                    console.error(`[Startup] Failed to sync Microsoft calendar for ${conn.providerEmail}:`, e.message);
                }
            }
        }

        // Sync Zoom
        const zoomConnections = await CalendarConnection.find({ enabled: true, provider: 'zoom' });
        if (zoomConnections.length > 0) {
            const zoomAdapter = require('./services/calendars/zoom-adapter');
            for (const conn of zoomConnections) {
                try {
                    await zoomAdapter.syncMeetings(conn);
                } catch (e) {
                    console.error(`[Startup] Failed to sync Zoom meetings for ${conn.providerEmail}:`, e.message);
                }
            }
        }
        // --------------------------------------------------------------------
    });
});
