const { google } = require('googleapis');
const CalendarConnection = require('../../db/models/CalendarConnection');
const ScheduledMeeting = require('../../db/models/ScheduledMeeting');
const queueAdapter = require('../queue-adapter');
const { extractMeetingUrl } = require('./url-extractor');

class GoogleCalendarAdapter {
    getOAuthClient(connection) {
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET
        );
        oauth2Client.setCredentials({
            access_token: connection.accessToken,
            refresh_token: connection.refreshToken,
            expiry_date: connection.tokenExpiry ? connection.tokenExpiry.getTime() : null
        });

        // Auto-save refreshed tokens back to DB
        oauth2Client.on('tokens', async (tokens) => {
            await CalendarConnection.findByIdAndUpdate(connection._id, {
                accessToken: tokens.access_token,
                ...(tokens.expiry_date && { tokenExpiry: new Date(tokens.expiry_date) }),
                ...(tokens.refresh_token && { refreshToken: tokens.refresh_token })
            });
        });

        return oauth2Client;
    }

    async registerWebhook(connection) {
        try {
            // Do an initial sync first before attempting webhook
            await this.syncEvents(connection);

            const calendar = google.calendar({ version: 'v3', auth: this.getOAuthClient(connection) });
            const channelId = `xora-google-${connection.userId}-${Date.now()}`;
            
            // Note: process.env.WEBHOOK_BASE_URL must be an HTTPS public URL (e.g. ngrok or production domain)
            const webhookUrl = process.env.WEBHOOK_BASE_URL 
                ? `${process.env.WEBHOOK_BASE_URL}/calendars/google/webhook`
                : null;
                
            if (!webhookUrl) {
                console.log('[Google Calendar] Skipping webhook registration: WEBHOOK_BASE_URL not set');
                return;
            }

            const res = await calendar.events.watch({
                calendarId: 'primary',
                requestBody: {
                    id: channelId,
                    type: 'web_hook',
                    address: webhookUrl,
                    // Expire in 7 days
                    expiration: String(Date.now() + 7 * 24 * 60 * 60 * 1000)
                }
            });

            await CalendarConnection.findByIdAndUpdate(connection._id, {
                webhookChannelId: channelId,
                webhookExpiry: new Date(Number(res.data.expiration))
            });

            console.log(`[Google Calendar] Registered webhook ${channelId} for user ${connection.userId}`);
            
        } catch (e) {
            console.error(`[Google Calendar] Webhook registration failed for user ${connection.userId}:`, e.message);
        }
    }

    async syncEvents(connection) {
        try {
            const calendar = google.calendar({ version: 'v3', auth: this.getOAuthClient(connection) });
            const now = new Date();
            const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
            const inTwoDays = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

            const response = await calendar.events.list({
                calendarId: 'primary',
                timeMin: fourHoursAgo.toISOString(),
                timeMax: inTwoDays.toISOString(),
                singleEvents: true,
                orderBy: 'startTime',
                maxResults: 50,
                conferenceDataVersion: 1,
                showDeleted: true
            });

            const events = response.data.items || [];
            const activeExternalIds = new Set();
            
            for (const event of events) {
                if (event.status === 'cancelled') {
                    await ScheduledMeeting.findOneAndUpdate(
                        { calendarConnectionId: connection._id, externalId: event.id },
                        { botStatus: 'cancelled' }
                    );
                    continue;
                }

                const extracted = extractMeetingUrl(event, 'google');
                if (!extracted) continue; // No meeting URL found

                activeExternalIds.add(event.id);

                const startTime = new Date(event.start?.dateTime || event.start?.date);
                const endTime = new Date(event.end?.dateTime || event.end?.date);
                
                if (endTime < now) continue; // Already ended/past

                // Check if critical fields changed to reset status
                const existingMeeting = await ScheduledMeeting.findOne({ calendarConnectionId: connection._id, externalId: event.id });
                let resetStatus = false;
                if (existingMeeting) {
                    const oldStart = existingMeeting.startTime ? existingMeeting.startTime.getTime() : 0;
                    if (oldStart !== startTime.getTime() || existingMeeting.meetingUrl !== extracted.url) {
                        // If it was already joined/failed, but they moved it or changed the link, we must retry!
                        if (existingMeeting.botStatus !== 'pending' && existingMeeting.botStatus !== 'scheduled') {
                            resetStatus = true;
                        }
                    }
                }

                const organizerName = event.organizer?.displayName || null;
                const organizerEmail = event.organizer?.email || null;
                let candidateName = null;
                const attendees = event.attendees || [];
                const guest = attendees.find(a => !a.self && a.email !== event.organizer?.email);
                if (guest) {
                    candidateName = guest.displayName || null;
                }

                const updatePayload = {
                    userId: connection.userId,
                    orgId: connection.orgId,
                    title: event.summary,
                    meetingUrl: extracted.url,
                    platform: extracted.platform,
                    startTime: startTime,
                    endTime: endTime,
                    organizerName: organizerName,
                    organizerEmail: organizerEmail,
                    candidateName: candidateName,
                    jobDescription: event.description || '',
                    participants: attendees.map(a => ({
                        name: a.displayName || null,
                        email: a.email,
                        self: !!a.self
                    }))
                };

                if (resetStatus) {
                    updatePayload.botStatus = 'pending';
                    updatePayload.failReason = null;
                }

                const meeting = await ScheduledMeeting.findOneAndUpdate(
                    { calendarConnectionId: connection._id, externalId: event.id },
                    updatePayload,
                    { upsert: true, new: true, setDefaultsOnInsert: true }
                );

                if (meeting.botStatus === 'pending' && meeting.autoJoin) {
                    const claimed = await ScheduledMeeting.findOneAndUpdate(
                        { _id: meeting._id, botStatus: 'pending' },
                        { $set: { botStatus: 'scheduled', updatedAt: new Date() } },
                        { new: true }
                    );
                    if (claimed) {
                        this.scheduleBotDispatch(claimed);
                        this.runPreMeetingResearch(claimed, connection).catch((e) => {
                            console.warn(`[Google Calendar] Pre-meeting research failed for ${claimed._id}:`, e.message);
                        });
                    }
                } else if (
                    meeting.orgId
                    && ['pending', 'scheduled'].includes(meeting.botStatus)
                    && !(meeting.preMeetingBrief && meeting.preMeetingBrief.fetchedAt)
                ) {
                    this.runPreMeetingResearch(meeting, connection).catch((e) => {
                        console.warn(`[Google Calendar] Pre-meeting research failed for ${meeting._id}:`, e.message);
                    });
                }
            }

            // Cancel any orphaned meetings in MongoDB that were deleted from Google Calendar
            await ScheduledMeeting.updateMany(
                {
                    calendarConnectionId: connection._id,
                    startTime: { $gte: fourHoursAgo, $lte: inTwoDays },
                    botStatus: { $in: ['pending', 'scheduled'] },
                    externalId: { $nin: Array.from(activeExternalIds) }
                },
                { $set: { botStatus: 'cancelled' } }
            );
            
            await CalendarConnection.findByIdAndUpdate(connection._id, { lastSyncAt: new Date(), lastSyncError: null });
        } catch (e) {
            console.error(`[Google Calendar] Sync failed for user ${connection.userId}:`, e.message);
            await CalendarConnection.findByIdAndUpdate(connection._id, { lastSyncError: e.message });
        }
    }

    async listEvents(connection, timeMin, timeMax) {
        const calendar = google.calendar({ version: 'v3', auth: this.getOAuthClient(connection) });
        const response = await calendar.events.list({
            calendarId: 'primary',
            timeMin: timeMin.toISOString(),
            timeMax: timeMax.toISOString(),
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 250,
            conferenceDataVersion: 1
        });

        const items = response.data.items || [];
        return items
            .filter((event) => event.status !== 'cancelled')
            .map((event) => {
                const startRaw = event.start?.dateTime || event.start?.date;
                const endRaw = event.end?.dateTime || event.end?.date;
                if (!startRaw) return null;
                const extracted = extractMeetingUrl(event, 'google');
                return {
                    id: event.id,
                    title: event.summary || 'Untitled Event',
                    start: startRaw,
                    end: endRaw || startRaw,
                    allDay: !event.start?.dateTime,
                    hangoutLink: extracted?.url || event.hangoutLink || null,
                    platform: extracted?.platform || null,
                    description: event.description || '',
                    organizer: event.organizer?.displayName || event.organizer?.email || '',
                    attendees: (event.attendees || []).map((a) => a.displayName || a.email).filter(Boolean)
                };
            })
            .filter(Boolean);
    }

    async runPreMeetingResearch(meeting, connection) {
        if (!meeting || !meeting.orgId) return;
        const researchService = require('../research-service');
        const User = require('../../db/models/User');
        const [owner] = await Promise.all([
            meeting.userId
                ? User.findById(meeting.userId).select('email').lean().catch(() => null)
                : null
        ]);
        const lookup = researchService.pickLookupFromMeeting(meeting, {
            ownerEmail: owner && owner.email,
            calendarEmail: connection && connection.providerEmail,
            organizerEmail: meeting.organizerEmail
        });
        const brief = await researchService.research(meeting.orgId, lookup);
        await ScheduledMeeting.findByIdAndUpdate(meeting._id, {
            $set: { preMeetingBrief: brief, updatedAt: new Date() }
        });
        console.log(`[Google Calendar] Pre-meeting research saved for "${meeting.title}" (matched=${!!brief.matched})`);
    }

    scheduleBotDispatch(meeting) {
        const timeUntilStart = meeting.startTime.getTime() - Date.now();
        // Dispatch 2 minutes before start time
        const dispatchDelay = timeUntilStart - (2 * 60 * 1000);
        const platformName = (meeting.platform || 'unknown').toUpperCase();
        
        if (dispatchDelay <= 0) {
            // Already within 2 minutes of start time or ongoing, dispatch immediately!
            console.log(`[Google Calendar] Meeting "${meeting.title}" [${platformName}] is active/starting now! Dispatching bot immediately to ${meeting.meetingUrl}`);
            queueAdapter.enqueue('bot-dispatch', { meetingId: meeting._id });
        } else {
            // Schedule via BullMQ
            queueAdapter.enqueue('bot-dispatch', { meetingId: meeting._id }, { delay: dispatchDelay });
            console.log(`[Google Calendar] Scheduled bot dispatch for "${meeting.title}" [${platformName}] (${meeting.meetingUrl}) in ${Math.round(dispatchDelay/1000)}s`);
        }
    }
}

module.exports = new GoogleCalendarAdapter();
