const Session = require('../db/models/Session');
const Report = require('../db/models/Report');
const queueAdapter = require('./queue-adapter');
const { resolveMongoSessionId, isMongoSessionId } = require('./session-ids');

const PROMPT_VERSION = 'report-v2';

function platformLabel(platform) {
    if (platform === 'zoom') return 'Zoom';
    if (platform === 'teams') return 'Microsoft Teams';
    return 'Google Meet';
}

function toParticipantDocs(list) {
    if (!Array.isArray(list)) return [];
    return list.map((p) => {
        if (typeof p === 'string') {
            const name = p.trim();
            return name ? { name } : null;
        }
        if (p && typeof p === 'object') {
            const name = String(p.name || '').trim();
            return name ? { name, isCandidate: !!p.isCandidate } : null;
        }
        return null;
    }).filter(Boolean);
}

function snapshotFromSession(session, extras = {}) {
    if (!session) return extras;
    const participants = Array.isArray(session.participants)
        ? session.participants.map((p) => (typeof p === 'string' ? p : p.name)).filter(Boolean)
        : [];
    return {
        userId: session.createdBy || extras.userId || undefined,
        orgId: session.orgId || extras.orgId || undefined,
        title: extras.title || session.title || session.jobRole || session.candidateName || (session.salesMode ? 'Sales call' : 'Interview'),
        candidateName: session.candidateName || extras.candidateName || '',
        jobRole: session.jobRole || extras.jobRole || '',
        platform: platformLabel(session.platform),
        meetingUrl: session.meetingUrl || '',
        startedAt: session.startedAt || session.createdAt,
        endedAt: session.endedAt,
        durationSecs: session.durationSecs,
        participants,
        salesMode: !!(session.salesMode)
    };
}

function clearReportLock(mongoId) {
    if (!global._reportEnqueueLocks || !mongoId) return;
    global._reportEnqueueLocks.delete(String(mongoId));
}

async function startReportGeneration(sessionId, extras = {}) {
    const mongoId = resolveMongoSessionId(sessionId) || (isMongoSessionId(String(sessionId)) ? String(sessionId) : null);
    if (!mongoId) {
        throw new Error('No Mongo session id available for report generation');
    }

    if (!global._reportEnqueueLocks) global._reportEnqueueLocks = new Map();
    const lockKey = String(mongoId);
    const existing = global._reportEnqueueLocks.get(lockKey);
    if (existing && (Date.now() - existing) < 120000) {
        console.log(`[ReportService] Report already enqueued for ${mongoId}, skipping duplicate`);
        await Session.findByIdAndUpdate(mongoId, {
            $set: { status: 'completed', endedAt: new Date() }
        }).catch(() => {});
        return String(mongoId);
    }

    global._reportEnqueueLocks.set(lockKey, Date.now());

    try {
        const now = new Date();
        const session = await Session.findById(mongoId);
        if (session) {
            const started = session.startedAt || session.createdAt;
            const durationSecs = started ? Math.max(0, Math.round((now - started) / 1000)) : (session.durationSecs || 0);
            const patch = {
                status: 'completed',
                endedAt: now,
                durationSecs
            };
            if (extras.userId && !session.createdBy) patch.createdBy = extras.userId;
            if (extras.orgId && !session.orgId) patch.orgId = extras.orgId;
            if (extras.title && !session.title) patch.title = extras.title;
            const participantDocs = toParticipantDocs(extras.participants);
            if (participantDocs.length) patch.participants = participantDocs;
            await Session.findByIdAndUpdate(mongoId, { $set: patch });
            session.status = 'completed';
            session.endedAt = now;
            session.durationSecs = durationSecs;
            if (patch.createdBy) session.createdBy = patch.createdBy;
            if (patch.orgId) session.orgId = patch.orgId;
            if (patch.title) session.title = patch.title;
            if (participantDocs.length) session.participants = participantDocs;
        }

        const snap = snapshotFromSession(session, {
            ...extras,
            participants: toParticipantDocs(extras.participants).map((p) => p.name)
        });
        await Report.findOneAndUpdate(
            { sessionId: String(mongoId) },
            {
                $set: {
                    ...snap,
                    status: 'pending',
                    error: '',
                    promptVersion: PROMPT_VERSION,
                    updatedAt: now
                },
                $setOnInsert: { sessionId: String(mongoId), createdAt: now }
            },
            { upsert: true, new: true }
        );

        await queueAdapter.enqueue('report-generate', { sessionId: String(mongoId) });
        return String(mongoId);
    } catch (e) {
        clearReportLock(mongoId);
        throw e;
    }
}

function ownerQuery(user) {
    if (!user || !user.userId) return { userId: '__none__' };
    // List endpoints are personal by default. Org-wide team feeds can opt in later.
    return { userId: user.userId };
}

function teamOwnerQuery(user) {
    if (!user) return { userId: '__none__' };
    const clauses = [];
    if (user.userId) clauses.push({ userId: user.userId });
    if (user.orgId) clauses.push({ orgId: user.orgId, userId: { $exists: true, $ne: null } });
    if (clauses.length === 0) return { userId: '__none__' };
    return { $or: clauses };
}

module.exports = {
    startReportGeneration,
    ownerQuery,
    teamOwnerQuery,
    clearReportLock,
    toParticipantDocs,
    platformLabel,
    snapshotFromSession,
    PROMPT_VERSION
};
