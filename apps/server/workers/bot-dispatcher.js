const ScheduledMeeting = require('../db/models/ScheduledMeeting');


class BotDispatcher {
    async processJob(jobData) {
        const { meetingId } = jobData;
        console.log(`[BotDispatcher] Triggered for scheduled meeting: ${meetingId}`);

        try {
            const meeting = await ScheduledMeeting.findById(meetingId);
            if (!meeting) {
                console.error(`[BotDispatcher] Meeting ${meetingId} not found`);
                return;
            }

            // Check if meeting is already joined/skipped/failed
            if (meeting.botStatus !== 'pending' && meeting.botStatus !== 'scheduled') {
                console.log(`[BotDispatcher] Meeting ${meetingId} already processed (status: ${meeting.botStatus})`);
                return;
            }

            if (!meeting.meetingUrl) {
                console.error(`[BotDispatcher] Meeting ${meetingId} missing meetingUrl`);
                meeting.botStatus = 'failed';
                meeting.failReason = 'Missing meetingUrl';
                await meeting.save();
                return;
            }

            const now = Date.now();
            const timeUntilStart = meeting.startTime.getTime() - now;

            if (meeting.endTime && meeting.endTime.getTime() < now) {
                console.log(`[BotDispatcher] Meeting ${meetingId} has already ended. Ignoring dispatch job.`);
                meeting.botStatus = 'skipped';
                await meeting.save();
                return;
            }

            // If the meeting is more than 5 minutes away, this is a stale job from before a calendar update.
            // The webhook has already scheduled a new job for the correct time, so safely ignore this one.
            if (timeUntilStart > 5 * 60 * 1000) {
                console.log(`[BotDispatcher] Meeting ${meetingId} was rescheduled. Ignoring stale dispatch job.`);
                return;
            }

            const claimed = await ScheduledMeeting.findOneAndUpdate(
                { _id: meetingId, botStatus: { $in: ['pending', 'scheduled'] } },
                { $set: { botStatus: 'joining', updatedAt: new Date() } },
                { new: true }
            );
            if (!claimed) {
                console.log(`[BotDispatcher] Meeting ${meetingId} already claimed by another dispatch`);
                return;
            }
            meeting.botStatus = 'joining';

            console.log(`[BotDispatcher] Dispatching bot to ${meeting.meetingUrl}...`);

            let language = 'multi';
            let botDisplayName = 'Xobin';
            let userId = meeting.userId ? String(meeting.userId) : undefined;
            let orgId = meeting.orgId ? String(meeting.orgId) : undefined;
            if (meeting.userId) {
                try {
                    const User = require('../db/models/User');
                    const user = await User.findById(meeting.userId)
                        .select('preferredLanguage botDisplayName salesModeActive orgId')
                        .lean();
                    if (user?.preferredLanguage) language = user.preferredLanguage;
                    if (user?.botDisplayName) botDisplayName = user.botDisplayName;
                    if (!orgId && user?.orgId) orgId = String(user.orgId);
                } catch (e) {
                    console.warn('[BotDispatcher] Could not load user prefs:', e.message);
                }
            }

            const fetchLib = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
            const response = await fetchLib(`${process.env.API_BASE_URL || 'http://localhost:8080'}/bot/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: meeting.meetingUrl,
                    sessionId: 'local-session',
                    language,
                    botDisplayName,
                    interviewerName: meeting.organizerName || 'Interviewer',
                    candidateName: meeting.candidateName || null,
                    title: meeting.title || '',
                    role: meeting.jobRole || meeting.title || '',
                    jd: meeting.jobDescription || '',
                    jobRole: meeting.jobRole || '',
                    jobDescription: meeting.jobDescription || '',
                    userId,
                    orgId,
                    scheduledMeetingId: String(meeting._id),
                    meetingEndAt: meeting.endTime ? new Date(meeting.endTime).toISOString() : null,
                    blocking: true
                })
            });

            if (!response.ok) {
                throw new Error(`Bot API failed: ${response.statusText}`);
            }

            meeting.botStatus = 'joined';
            meeting.botJoinedAt = new Date();
            await meeting.save();
            console.log(`[BotDispatcher] Bot successfully dispatched for meeting ${meetingId}`);

        } catch (e) {
            console.error(`[BotDispatcher] Failed to dispatch bot: ${e.message}`);
            const reason = String(e.message || '');
            const skipped = /timed out waiting to be admitted|still in lobby|not admitted/i.test(reason);
            await ScheduledMeeting.findByIdAndUpdate(meetingId, {
                botStatus: skipped ? 'skipped' : 'failed',
                failReason: reason
            });
        }
    }
}

module.exports = new BotDispatcher();
