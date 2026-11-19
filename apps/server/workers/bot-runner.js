const Session = require('../db/models/Session');
const BotManager = require('../../desktop/main/bot-manager');

class BotRunner {
    constructor() {
        this.activeBots = new Map(); // sessionId -> BotManager
    }

    async processJob(jobData) {
        const { action, sessionId, meetingUrl, platform, language, candidateName } = jobData;

        if (action === 'start') {
            await this.startBot(sessionId, meetingUrl, language, candidateName);
        } else if (action === 'stop') {
            await this.stopBot(sessionId);
        } else {
            console.error(`[BotRunner] Unknown action: ${action}`);
        }
    }

    async startBot(sessionId, meetingUrl, language, candidateName) {
        console.log(`[BotRunner] Starting cloud bot for session ${sessionId}...`);
        
        if (this.activeBots.has(sessionId)) {
            console.warn(`[BotRunner] Bot already running for session ${sessionId}`);
            return;
        }

        try {
            // Update session status to joining
            await Session.findByIdAndUpdate(sessionId, { status: 'joining' });

            const botManager = new BotManager(sessionId);
            botManager.mongoSessionId = String(sessionId);
            try {
                const session = await Session.findById(sessionId).select('interviewerNotes').lean();
                if (session && session.interviewerNotes) {
                    botManager.interviewerNotes = session.interviewerNotes;
                }
                botManager._notesHydrated = true;
            } catch (e) {
                console.error('[BotRunner] Failed to load interviewer notes:', e.message);
            }
            if (candidateName) {
                botManager.transcriptManager.setCandidate(candidateName);
            }

            // Register event listeners to update DB and Pub/Sub
            botManager.on('session:started', async () => {
                await Session.findByIdAndUpdate(sessionId, { 
                    status: 'active',
                    startedAt: new Date()
                });
            });

            botManager.on('session:error', async (error) => {
                console.error(`[BotRunner] Session error for ${sessionId}:`, error);
                await Session.findByIdAndUpdate(sessionId, { status: 'failed' });
                this.activeBots.delete(sessionId);
                if (global.activeBots) global.activeBots.delete(sessionId);
            });

            botManager.on('session:stopped', async () => {
                this.activeBots.delete(sessionId);
                if (global.activeBots) global.activeBots.delete(sessionId);
                try {
                    const TranscriptTurn = require('../db/models/TranscriptTurn');
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
                    await new Promise((r) => setTimeout(r, 600));
                    const { startReportGeneration } = require('../services/report-service');
                    await startReportGeneration(botManager.mongoSessionId || sessionId, {
                        candidateName: botManager.candidateName,
                        jobRole: botManager.jobRole,
                        participants: Array.isArray(botManager._lastParticipants) ? botManager._lastParticipants : undefined
                    });
                } catch (e) {
                    console.error('[BotRunner] Failed to enqueue report:', e.message);
                    await Session.findByIdAndUpdate(sessionId, {
                        status: 'completed',
                        endedAt: new Date()
                    }).catch(() => {});
                }
            });

            botManager.on('participants:update', async (participants) => {
                const wsHub = require('../services/ws-hub');
                wsHub.broadcastToRoom(sessionId, 'participants:update', participants);
                botManager._lastParticipants = Array.isArray(participants) ? participants : [];
                try {
                    if (sessionId !== 'local-session' && Array.isArray(participants) && participants.length) {
                        const docs = participants.map((p) =>
                            typeof p === 'string' ? { name: p } : { name: (p && p.name) || String(p), isCandidate: !!(p && p.isCandidate) }
                        ).filter((p) => p.name);
                        await Session.findByIdAndUpdate(sessionId, { participants: docs });
                    }
                } catch (e) {
                    console.error('[BotRunner] Failed to update session participants in DB:', e.message);
                }
            });

            botManager.on('transcript:update', (data) => {
                const pubsubAdapter = require('../services/pubsub-adapter');
                pubsubAdapter.publish('transcript-events', {
                    sessionId,
                    channel: 'transcript:update',
                    payload: data
                });
            });

            botManager.on('turn:complete', async (turn) => {
                const TranscriptTurn = require('../db/models/TranscriptTurn');
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
                ).catch((e) => console.error('[BotRunner] Failed to save transcript turn:', e.message));

                const { scheduleLiveEvaluation } = require('../services/live-evaluation');
                scheduleLiveEvaluation(sessionId, botManager);

                const { isAutopilotEligible } = require('../services/autopilot');
                const sales = !!botManager.salesModeActive;
                const wordCount = String(turn.text || '').trim().split(/\s+/).filter(Boolean).length;
                const autopilotEligible = isAutopilotEligible(turn, { salesMode: sales });

                if (!autopilotEligible && turn.speakerRole !== 'candidate') {
                    console.log(`[BotRunner Autopilot] Skip — silence after ${turn.speakerRole || 'panel'} (${turn.speaker})`);
                }

                if (autopilotEligible) {
                    if (global.manualAskInFlight || (global.manualAskCooldownUntil && Date.now() < global.manualAskCooldownUntil)) {
                        console.log('[BotRunner Autopilot] Suppressed — manual ask active/cooldown');
                    } else {
                    try {
                        const queueAdapter = require('../services/queue-adapter');
                        console.log(`[BotRunner Autopilot] Enqueueing turn ${turn.turnIndex} (${wordCount} words, sales=${sales})`);
                        await queueAdapter.enqueue('llm-process', {
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
                        });
                    } catch (e) {
                        console.error('[BotRunner] Failed to enqueue LLM job:', e.message);
                    }
                    }
                }
            });

            this.activeBots.set(sessionId, botManager);
            
            // CRITICAL: Also register in global.activeBots so WS Hub can find the
            // live transcript when the user manually types questions in the overlay
            if (!global.activeBots) global.activeBots = new Map();
            global.activeBots.set(sessionId, botManager);

            // Start the bot
            await botManager.startSession(meetingUrl, language);

        } catch (error) {
            console.error(`[BotRunner] Failed to start bot for ${sessionId}:`, error);
            await Session.findByIdAndUpdate(sessionId, { status: 'failed' });
            this.activeBots.delete(sessionId);
        }
    }

    async stopBot(sessionId) {
        console.log(`[BotRunner] Stopping cloud bot for session ${sessionId}...`);
        
        const botManager = this.activeBots.get(sessionId);
        if (botManager) {
            await botManager.stopSession();
            this.activeBots.delete(sessionId);
        } else {
            console.warn(`[BotRunner] No active bot found for session ${sessionId}`);
        }
    }
}

module.exports = new BotRunner();
