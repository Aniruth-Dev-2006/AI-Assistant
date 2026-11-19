const express = require('express');
const requireAuth = require('../middleware/auth');
const Report = require('../db/models/Report');
const Session = require('../db/models/Session');
const TranscriptTurn = require('../db/models/TranscriptTurn');
const { ownerQuery, startReportGeneration } = require('../services/report-service');
const { askAboutReport } = require('../services/report-assistant');

const router = express.Router();

function reportScope(user) {
    // Strict tenant isolation: never leak null-owner / other-users' reports.
    return ownerQuery(user);
}

function canAccess(report, user) {
    if (!report || !user) return false;
    if (user.userId && report.userId && String(report.userId) === String(user.userId)) return true;
    if (user.orgId && report.orgId && String(report.orgId) === String(user.orgId)) return true;
    return false;
}

function formatMs(ms) {
    if (!Number.isFinite(ms)) return '00:00';
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60).toString().padStart(2, '0');
    const s = (total % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function recommendationStatus(key, salesMode) {
    if (salesMode) {
        if (key === 'hire') return 'Advance';
        if (key === 'pass') return 'Disqualify';
        return 'Nurture';
    }
    if (key === 'hire') return 'Hire';
    if (key === 'pass') return 'No Hire';
    return 'Maybe';
}

router.get('/', requireAuth, async (req, res) => {
    try {
        const { q, recommendation, status, limit = 50, skip = 0 } = req.query;
        const filter = { ...reportScope(req.user) };
        if (recommendation && ['hire', 'maybe', 'pass'].includes(recommendation)) {
            filter.recommendation = recommendation;
        }
        if (status) {
            const statuses = String(status).split(',').map((s) => s.trim())
                .filter((s) => ['pending', 'generating', 'ready', 'failed'].includes(s));
            if (statuses.length === 1) filter.status = statuses[0];
            else if (statuses.length > 1) filter.status = { $in: statuses };
        }
        if (q && String(q).trim()) {
            const rx = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            filter.$and = (filter.$and || []).concat([{
                $or: [
                    { candidateName: rx },
                    { title: rx },
                    { jobRole: rx },
                    { summary: rx }
                ]
            }]);
        }

        const [items, total] = await Promise.all([
            Report.find(filter).sort({ generatedAt: -1, createdAt: -1 }).skip(Number(skip)).limit(Math.min(100, Number(limit))).lean(),
            Report.countDocuments(filter)
        ]);

        const sessionIds = items.filter((r) => !r.salesMode && r.sessionId).map((r) => r.sessionId);
        let salesBySession = new Map();
        if (sessionIds.length) {
            const sessions = await Session.find({ _id: { $in: sessionIds } }).select('salesMode').lean();
            salesBySession = new Map(sessions.map((s) => [String(s._id), !!s.salesMode]));
        }

        res.json({
            total,
            reports: items.map((r) => {
                const salesMode = !!(r.salesMode || salesBySession.get(String(r.sessionId)));
                return {
                    id: String(r._id),
                    sessionId: r.sessionId,
                    title: r.title || r.jobRole || (salesMode ? 'Sales call' : 'Interview'),
                    candidateName: r.candidateName || '',
                    jobRole: r.jobRole || '',
                    platform: r.platform || 'Google Meet',
                    date: r.endedAt || r.generatedAt || r.createdAt,
                    overallScore: r.overallScore,
                    recommendation: r.recommendation,
                    recommendationLabel: recommendationStatus(r.recommendation, salesMode),
                    recommendationText: r.recommendationText,
                    salesMode,
                    status: r.status,
                    summary: r.summary || '',
                    error: r.error || ''
                };
            })
        });
    } catch (e) {
        console.error('[Reports] list failed:', e);
        res.status(500).json({ error: 'Failed to load reports' });
    }
});

router.get('/:sessionId', requireAuth, async (req, res) => {
    try {
        const report = await Report.findOne({ sessionId: req.params.sessionId }).lean();
        if (!report || !canAccess(report, req.user)) {
            return res.status(404).json({ error: 'Report not found' });
        }

        let turns = await TranscriptTurn.find({ sessionId: req.params.sessionId }).sort({ turnIndex: 1 }).lean();
        if (!turns.length) {
            turns = await TranscriptTurn.find({ sessionId: 'local-session' }).sort({ turnIndex: 1 }).lean();
        }
        const session = await Session.findById(req.params.sessionId).select('interviewerNotes startedAt salesMode').lean();
        const startMs = session && session.startedAt ? new Date(session.startedAt).getTime() : (turns[0] && turns[0].timestampMs);
        const salesMode = !!(report.salesMode || (session && session.salesMode));

        res.json({
            sessionId: report.sessionId,
            status: report.status,
            error: report.error || '',
            title: report.title || report.jobRole || (salesMode ? 'Sales call' : 'Interview'),
            url: report.meetingUrl,
            platform: report.platform || 'Google Meet',
            date: report.endedAt || report.generatedAt || report.createdAt,
            startTime: report.startedAt,
            endTime: report.endedAt,
            durationSecs: report.durationSecs,
            participants: report.participants || [],
            candidateName: report.candidateName || '',
            jobRole: report.jobRole || '',
            organizer: (report.participants && report.participants[0]) || '',
            description: report.jobRole || '',
            salesMode,
            recommendation: {
                status: recommendationStatus(report.recommendation, salesMode),
                key: report.recommendation,
                text: report.recommendationText || ''
            },
            overallScore: report.overallScore,
            summary: report.summary || '',
            verifiedSkills: report.verifiedSkills || [],
            strengths: report.strengths || [],
            concerns: report.concerns || [],
            actionItems: report.actionItems || [],
            topics: report.topics || [],
            notes: (session && session.interviewerNotes) || '',
            transcript: turns.map((t) => ({
                speaker: t.speaker,
                time: formatMs(t.timestampMs - (startMs || t.timestampMs)),
                text: t.text
            }))
        });
    } catch (e) {
        console.error('[Reports] detail failed:', e);
        res.status(500).json({ error: 'Failed to load report' });
    }
});

router.post('/:sessionId/regenerate', requireAuth, async (req, res) => {
    try {
        const report = await Report.findOne({ sessionId: req.params.sessionId });
        if (!report || !canAccess(report.toObject(), req.user)) {
            return res.status(404).json({ error: 'Report not found' });
        }
        await startReportGeneration(req.params.sessionId, {
            userId: req.user.userId,
            orgId: req.user.orgId
        });
        res.json({ success: true, status: 'pending' });
    } catch (e) {
        console.error('[Reports] regenerate failed:', e);
        res.status(500).json({ error: e.message });
    }
});

router.patch('/:sessionId/notes', requireAuth, async (req, res) => {
    try {
        const report = await Report.findOne({ sessionId: req.params.sessionId }).lean();
        if (!report || !canAccess(report, req.user)) {
            return res.status(404).json({ error: 'Report not found' });
        }
        const text = typeof req.body.notes === 'string' ? req.body.notes : '';
        await Session.findByIdAndUpdate(req.params.sessionId, {
            $set: { interviewerNotes: text }
        });
        res.json({ success: true, notes: text });
    } catch (e) {
        console.error('[Reports] notes save failed:', e);
        res.status(500).json({ error: 'Failed to save notes' });
    }
});

router.post('/:sessionId/ask', requireAuth, async (req, res) => {
    try {
        const question = String(req.body?.question || '').trim();
        if (!question) return res.status(400).json({ error: 'Question is required' });
        if (question.length > 2000) return res.status(400).json({ error: 'Question is too long' });

        const report = await Report.findOne({ sessionId: req.params.sessionId }).lean();
        if (!report || !canAccess(report, req.user)) {
            return res.status(404).json({ error: 'Report not found' });
        }

        let turns = await TranscriptTurn.find({ sessionId: req.params.sessionId })
            .sort({ turnIndex: 1 })
            .select('speaker text')
            .lean();
        if (!turns.length) {
            turns = await TranscriptTurn.find({ sessionId: 'local-session' })
                .sort({ turnIndex: 1 })
                .select('speaker text')
                .lean();
        }

        const history = Array.isArray(req.body?.history) ? req.body.history : [];
        const answer = await askAboutReport({
            report,
            transcriptTurns: turns,
            question,
            history
        });
        res.json({ answer });
    } catch (e) {
        console.error('[Reports] ask failed:', e);
        res.status(500).json({ error: e.message || 'Failed to answer question' });
    }
});

module.exports = router;
