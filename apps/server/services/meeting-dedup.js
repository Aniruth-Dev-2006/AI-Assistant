const Session = require('../db/models/Session');

class MeetingDeduplicator {
    /**
     * Normalizes a meeting URL into a consistent key for deduplication.
     */
    normalizeUrl(url) {
        try {
            const parsed = new URL(url);
            
            // Google Meet
            if (parsed.hostname.includes('meet.google.com')) {
                // e.g., https://meet.google.com/abc-defg-hij?authuser=0 -> gmeet:abc-defg-hij
                const pathParts = parsed.pathname.split('/').filter(p => p);
                if (pathParts.length > 0) {
                    return `gmeet:${pathParts[0]}`;
                }
            }
            
            // Zoom
            if (parsed.hostname.includes('zoom.us')) {
                // /j/123, /wc/join/123, /wc/123/start → zoom:123
                const m = parsed.pathname.match(/\/(?:j|wc\/join|wc)\/(\d+)/);
                if (m && m[1]) return `zoom:${m[1]}`;
            }
            
            // Microsoft Teams
            if (parsed.hostname.includes('teams.live.com') || parsed.hostname.includes('teams.microsoft.com')) {
                // e.g., https://teams.live.com/meet/934062593737?p=... -> teams:934062593737
                const pathParts = parsed.pathname.split('/').filter(p => p);
                if (pathParts.length >= 2 && pathParts[0] === 'meet') {
                    return `teams:${pathParts[1]}`;
                }
            }
            
            // Fallback: just use the full hostname + path
            return `unknown:${parsed.hostname}${parsed.pathname}`;
        } catch (e) {
            console.warn('[MeetingDeduplicator] Invalid URL passed:', url);
            return `invalid:${Date.now()}`;
        }
    }

    /**
     * Detects the platform from the URL
     */
    getPlatform(url) {
        if (url.includes('meet.google.com')) return 'gmeet';
        if (url.includes('zoom.us')) return 'zoom';
        if (url.includes('teams.live.com') || url.includes('teams.microsoft.com')) return 'teams';
        return 'gmeet'; // fallback
    }

    /**
     * Checks if a meeting is already active. If not, creates a new session.
     * Returns { session, isNew }
     */
    async getOrCreateSession(meetingUrl, orgId, userId, language, candidateName, botLocation) {
        const meetingKey = this.normalizeUrl(meetingUrl);
        const platform = this.getPlatform(meetingUrl);
        
        try {
            // First, try to find an existing active session
            let session = await Session.findOne({
                meetingKey: meetingKey,
                status: { $in: ['pending', 'joining', 'active'] }
            });

            if (session) {
                console.log(`[MeetingDeduplicator] Found existing active session for ${meetingKey}`);
                // Stale "active" sessions (failed hangup / bot crash) block new reports — recycle them.
                const ageMs = Date.now() - new Date(session.updatedAt || session.createdAt || 0).getTime();
                const hasLiveBot = global.activeBots && [...global.activeBots.values()].some(
                    (b) => b && String(b.mongoSessionId) === String(session._id)
                );
                if (!hasLiveBot && (session.status !== 'joining' || ageMs > 10 * 60 * 1000)) {
                    console.log(`[MeetingDeduplicator] Closing stale session ${session._id} and creating a fresh one`);
                    await Session.findByIdAndUpdate(session._id, {
                        $set: { status: 'completed', endedAt: new Date() }
                    });
                    try {
                        const { clearReportLock } = require('./report-service');
                        clearReportLock(session._id);
                    } catch (e) {}
                } else {
                    console.log(`[MeetingDeduplicator] Found existing active session for ${meetingKey}`);
                    const patch = {};
                    if (userId && !session.createdBy) patch.createdBy = userId;
                    if (orgId && !session.orgId) patch.orgId = orgId;
                    if (candidateName && !session.candidateName) patch.candidateName = candidateName;
                    if (Object.keys(patch).length) {
                        Object.assign(session, patch);
                        await session.save().catch(() => {});
                    }
                    return { session, isNew: false };
                }
            }

            // Create a new session. The unique index in MongoDB will throw a duplicate key error
            // if another request raced us and created it first.
            session = new Session({
                meetingUrl,
                meetingKey,
                platform,
                language,
                candidateName,
                botLocation,
                orgId,
                createdBy: userId,
                status: 'pending'
            });

            await session.save();
            console.log(`[MeetingDeduplicator] Created NEW session for ${meetingKey} (ID: ${session._id})`);
            
            return { session, isNew: true };
            
        } catch (error) {
            // 11000 is MongoDB's duplicate key error code
            if (error.code === 11000) {
                console.log(`[MeetingDeduplicator] Race condition handled! Another bot joined ${meetingKey} first.`);
                const existingSession = await Session.findOne({
                    meetingKey: meetingKey,
                    status: { $in: ['pending', 'joining', 'active'] }
                });
                if (existingSession) {
                    return { session: existingSession, isNew: false };
                }
            }
            throw error;
        }
    }
}

module.exports = new MeetingDeduplicator();
