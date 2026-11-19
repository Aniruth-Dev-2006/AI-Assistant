const express = require('express');
const requireAuth = require('../middleware/auth');
const meetingDedup = require('../services/meeting-dedup');
const queueAdapter = require('../services/queue-adapter');
const pubsubAdapter = require('../services/pubsub-adapter');
const Session = require('../db/models/Session');
const TranscriptTurn = require('../db/models/TranscriptTurn');

const router = express.Router();

/**
 * POST /sessions/start
 * Called by Extension or Desktop app to start recording a meeting.
 */
router.post('/start', requireAuth, async (req, res) => {
    try {
        const { url, language, candidateName, botLocation } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'Missing meeting URL' });
        }

        // 1. Enforce 1-bot-per-meeting deduplication
        const { session, isNew } = await meetingDedup.getOrCreateSession(
            url, 
            req.user.orgId, 
            req.user.userId, 
            language, 
            candidateName, 
            botLocation || 'cloud' // Hybrid mode support
        );

        // 2. If it's a NEW session and botLocation is 'cloud', we must dispatch a worker job
        if (isNew && session.botLocation === 'cloud') {
            console.log(`[API] Dispatching cloud bot for session ${session._id}`);
            await queueAdapter.enqueue('bot-lifecycle', {
                action: 'start',
                sessionId: session._id,
                meetingUrl: session.meetingUrl,
                platform: session.platform,
                language: session.language,
                candidateName: session.candidateName
            });
        } else if (isNew && session.botLocation === 'local') {
            console.log(`[API] Local desktop bot will handle session ${session._id}`);
            // We don't dispatch to cloud tasks, the desktop app spins it up itself.
            // The desktop app just needed the API to register the deduplicated session ID in MongoDB.
        }

        return res.json({ 
            success: true, 
            sessionId: session._id, 
            isNew,
            botLocation: session.botLocation
        });
        
    } catch (e) {
        console.error('[API] Error starting session:', e);
        res.status(500).json({ error: 'Failed to start session' });
    }
});

/**
 * POST /sessions/:id/transcript
 * Called by Desktop app to push a completed transcript turn to the cloud.
 */
router.post('/:id/transcript', requireAuth, async (req, res) => {
    try {
        const sessionId = req.params.id;
        const turn = req.body;

        if (!turn || !turn.text) {
            return res.status(400).json({ error: 'Missing transcript turn data' });
        }

        const session = await Session.findById(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        // Save to DB
        await TranscriptTurn.create({
            sessionId: session._id,
            turnIndex: turn.turnIndex,
            speaker: turn.speaker,
            speakerRole: turn.speakerRole,
            text: turn.text,
            timestampMs: turn.timestamp
        });

        // Publish event for live UI/websocket updates
        pubsubAdapter.publish('transcript-events', {
            sessionId: session._id.toString(),
            channel: 'transcript:update',
            payload: {
                turnId: turn.turnIndex,
                speaker: turn.speaker,
                text: turn.text,
                timestamp: turn.timestamp,
                isComplete: true
            }
        });

        // Fetch recent context for LLM
        const recentTurns = await TranscriptTurn.find({ sessionId: session._id })
            .sort({ timestampMs: 1 })
            .limit(20);

        const context = recentTurns.map(t => ({
            speaker: t.speaker,
            text: t.text,
            timestamp: t.timestampMs
        }));

        // Enqueue LLM processing
        if (turn.text.split(' ').length > 5 && turn.speakerRole === 'candidate') {
            await queueAdapter.enqueue('llm-process', {
                sessionId: session._id.toString(),
                transcript: context,
                todos: [] // Optional: fetch todos from session or send from desktop
            });
        }

        res.json({ success: true });
    } catch (e) {
        console.error('[API] Error saving transcript:', e);
        res.status(500).json({ error: 'Failed to process transcript' });
    }
});

/**
 * POST /sessions/:id/ask
 * Called by Desktop app for manual queries, OCR, and analysis
 */
router.post('/:id/ask', requireAuth, async (req, res) => {
    try {
        const sessionId = req.params.id;
        const { text, mode, todos, forceInstruction } = req.body;

        const session = await Session.findById(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        // Fetch recent context for LLM
        const recentTurns = await TranscriptTurn.find({ sessionId: session._id })
            .sort({ timestampMs: 1 })
            .limit(20);

        const context = recentTurns.map(t => ({
            speaker: t.speaker,
            text: t.text,
            timestamp: t.timestampMs
        }));

        let manualRequest = '';
        if (mode === 'takeover') {
            manualRequest = forceInstruction || `CRITICAL INSTRUCTION: You MUST generate a [TAKEOVER_REQUEST] now based on this instruction: "${text || 'a follow up question'}". \nThe question MUST be a crisp, direct, natural conversational question that can be spoken aloud to the user. Do not output meta-descriptions like "Review the candidate's...". \nFORMAT STRICTLY AS: [TAKEOVER_REQUEST: <crisp conversational question> : <brief reason>]\nDO NOT output any other text or conversational filler.`;
        } else {
            if (text) {
                manualRequest = `[User Request]: ${text}`;
            } else if (mode) {
                manualRequest = `[System Command]: Please perform a ${mode} analysis on the transcript.`;
            }
        }

        // Enqueue high priority LLM processing
        await queueAdapter.enqueue('llm-process', {
            sessionId: session._id.toString(),
            transcript: context,
            todos: todos || [],
            manualRequest: manualRequest,
            mode: mode,
            isAutopilot: false,
            requestId: `${session._id.toString()}-manual-${Date.now()}`
        });
        global.manualAskInFlight = true;
        global.queuedAutopilot = null;

        res.json({ success: true });
    } catch (e) {
        console.error('[API] Error handling manual ask:', e);
        res.status(500).json({ error: 'Failed to process manual ask' });
    }
});

/**
 * POST /sessions/:id/stop
 */
router.post('/:id/stop', requireAuth, async (req, res) => {
    try {
        const session = await Session.findById(req.params.id);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        
        // Authorization check (only creator or admin can stop)
        if (session.createdBy.toString() !== req.user.userId) {
             return res.status(403).json({ error: 'Unauthorized to stop this session' });
        }

        // Mark as completed
        session.status = 'completed';
        session.endedAt = new Date();
        await session.save();

        if (session.botLocation === 'cloud') {
            // Tell the cloud bot to gracefully terminate
            await queueAdapter.enqueue('bot-lifecycle', {
                action: 'stop',
                sessionId: session._id
            });
        }

        const { startReportGeneration } = require('../services/report-service');
        await startReportGeneration(String(session._id), {
            userId: req.user.userId,
            orgId: req.user.orgId
        });

        res.json({ success: true, message: 'Session stopped' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * GET /sessions/:id/status
 */
router.get('/:id/status', requireAuth, async (req, res) => {
    try {
        const session = await Session.findById(req.params.id);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        
        res.json({ 
            status: session.status,
            botLocation: session.botLocation,
            participants: session.participants
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
/**
 * GET /sessions/stt-key
 * Fetch the Deepgram API key from the server so the client doesn't need it in .env
 */
router.get('/stt-key', requireAuth, async (req, res) => {
    try {
        const key = process.env.DEEPGRAM_API_KEY;
        if (!key) return res.status(500).json({ error: 'DEEPGRAM_API_KEY not configured on server' });
        res.json({ key });
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch STT key' });
    }
});

module.exports = router;
