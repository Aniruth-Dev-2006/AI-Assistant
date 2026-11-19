const express = require('express');
const requireAuth = require('../middleware/auth');
const ScheduledMeeting = require('../db/models/ScheduledMeeting');
const Session = require('../db/models/Session');
const Report = require('../db/models/Report');
const researchService = require('../services/research-service');
const hubspotClient = require('../services/hubspot-client');
const { platformLabel } = require('../services/report-service');

const router = express.Router();

const BRIEF_TTL_MS = 6 * 60 * 60 * 1000;

function briefIsFresh(brief) {
    if (!brief || !brief.fetchedAt) return false;
    if (brief.connected === false) return false;
    const t = new Date(brief.fetchedAt).getTime();
    return Number.isFinite(t) && (Date.now() - t) < BRIEF_TTL_MS;
}

function sessionScope(user) {
    // Past meetings on the personal dashboard are only what THIS user ran/owned.
    if (user && user.userId) return { createdBy: user.userId };
    return { createdBy: '__none__' };
}

function scheduledScope(user) {
    // Calendar meetings are personal to the connected account — do not mix org-mates' calendars.
    if (user && user.userId) return { userId: user.userId };
    return { userId: '__none__' };
}

router.get('/upcoming', requireAuth, async (req, res) => {
    try {
        const scope = scheduledScope(req.user);
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const meetings = await ScheduledMeeting.find({
            ...scope,
            startTime: { $gte: startOfToday },
            botStatus: { $nin: ['cancelled'] }
        }).sort({ startTime: 1 }).limit(100).lean();

        res.json({
            meetings: meetings.map((m) => ({
                id: String(m._id),
                kind: 'upcoming',
                title: m.title || m.jobRole || 'Upcoming interview',
                candidateName: m.candidateName || '',
                jobRole: m.jobRole || '',
                platform: platformLabel(m.platform),
                meetingUrl: m.meetingUrl || '',
                startTime: m.startTime,
                endTime: m.endTime,
                participants: (m.participants || []).map((p) => p.name || p.email).filter(Boolean),
                organizerName: m.organizerName || '',
                botStatus: m.botStatus,
                sessionId: m.sessionId || null,
                reportStatus: null
            }))
        });
    } catch (e) {
        console.error('[Meetings] upcoming failed:', e);
        res.status(500).json({ error: 'Failed to load upcoming meetings' });
    }
});

router.get('/:id/brief', requireAuth, async (req, res) => {
    try {
        const meeting = await ScheduledMeeting.findOne({
            _id: req.params.id,
            ...scheduledScope(req.user)
        });
        if (!meeting) {
            return res.status(404).json({ error: 'Meeting not found' });
        }

        const orgId = meeting.orgId || req.user.orgId;
        const connected = await hubspotClient.isConnected(orgId).catch(() => false);
        const force = String(req.query.refresh || '') === '1';

        if (!force && briefIsFresh(meeting.preMeetingBrief)) {
            return res.json({
                meetingId: String(meeting._id),
                connected,
                cached: true,
                brief: meeting.preMeetingBrief
            });
        }

        if (!orgId) {
            return res.json({
                meetingId: String(meeting._id),
                connected: false,
                cached: false,
                brief: {
                    contact: null,
                    company: null,
                    deals: [],
                    companyScrape: null,
                    researchSummary: 'Join an organization and connect HubSpot to research prospects.',
                    fetchedAt: new Date().toISOString(),
                    connected: false,
                    matched: false
                }
            });
        }

        if (!connected) {
            const brief = {
                contact: null,
                company: null,
                deals: [],
                companyScrape: null,
                researchSummary: 'HubSpot is not connected.',
                fetchedAt: new Date().toISOString(),
                connected: false,
                matched: false
            };
            meeting.preMeetingBrief = brief;
            meeting.updatedAt = new Date();
            await meeting.save();
            return res.json({ meetingId: String(meeting._id), connected: false, cached: false, brief });
        }

        const User = require('../db/models/User');
        const CalendarConnection = require('../db/models/CalendarConnection');
        const [owner, cal] = await Promise.all([
            User.findById(req.user.userId).select('email').lean().catch(() => null),
            meeting.calendarConnectionId
                ? CalendarConnection.findById(meeting.calendarConnectionId).select('providerEmail').lean().catch(() => null)
                : null
        ]);
        const lookup = researchService.pickLookupFromMeeting(meeting, {
            ownerEmail: owner && owner.email,
            calendarEmail: cal && cal.providerEmail,
            organizerEmail: meeting.organizerEmail
        });
        const brief = await researchService.research(orgId, lookup);
        meeting.preMeetingBrief = brief;
        meeting.updatedAt = new Date();
        await meeting.save();

        if (meeting.sessionId && brief && brief.matched) {
            Session.findByIdAndUpdate(meeting.sessionId, {
                $set: { hubspotContext: brief }
            }).catch(() => {});
        }

        res.json({
            meetingId: String(meeting._id),
            connected: true,
            cached: false,
            lookup,
            brief
        });
    } catch (e) {
        console.error('[Meetings] brief failed:', e);
        res.status(500).json({ error: 'Failed to load meeting brief' });
    }
});

router.get('/past', requireAuth, async (req, res) => {
    try {
        const sessions = await Session.find({
            ...sessionScope(req.user),
            status: { $in: ['completed', 'failed'] }
        }).sort({ endedAt: -1, createdAt: -1 }).limit(100).lean();

        const ids = sessions.map((s) => String(s._id));
        const reports = await Report.find({ sessionId: { $in: ids } }).lean();
        const bySession = new Map(reports.map((r) => [String(r.sessionId), r]));

        res.json({
            meetings: sessions.map((s) => {
                const report = bySession.get(String(s._id));
                return {
                    id: String(s._id),
                    kind: 'past',
                    sessionId: String(s._id),
                    title: s.title || s.jobRole || s.candidateName || 'Interview',
                    candidateName: s.candidateName || '',
                    jobRole: s.jobRole || '',
                    platform: platformLabel(s.platform),
                    meetingUrl: s.meetingUrl || '',
                    startTime: s.startedAt || s.createdAt,
                    endTime: s.endedAt,
                    durationSecs: s.durationSecs,
                    participants: (s.participants || []).map((p) => (typeof p === 'string' ? p : p.name)).filter(Boolean),
                    summary: (report && report.summary) || '',
                    verifiedSkills: (report && report.verifiedSkills) || (s.lastEvaluation && s.lastEvaluation.verifiedSkills) || [],
                    actionItems: (report && report.actionItems) || [],
                    score: report ? Math.round((report.overallScore || 0) * 10) : (s.lastEvaluation && s.lastEvaluation.score) || null,
                    reportStatus: report ? report.status : null,
                    recommendation: report ? report.recommendation : null
                };
            })
        });
    } catch (e) {
        console.error('[Meetings] past failed:', e);
        res.status(500).json({ error: 'Failed to load past meetings' });
    }
});

module.exports = router;
