const ScheduledMeeting = require('../../db/models/ScheduledMeeting');
const CalendarConnection = require('../../db/models/CalendarConnection');
const { extractMeetingUrl } = require('./url-extractor');
const queueAdapter = require('../queue-adapter');

async function refreshAccessToken(connection) {
    if (!connection.refreshToken) throw new Error('No refresh token available');
    if (connection.tokenExpiry && connection.tokenExpiry > new Date()) return connection.accessToken;

    try {
        const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.MICROSOFT_CLIENT_ID,
                client_secret: process.env.MICROSOFT_CLIENT_SECRET,
                refresh_token: connection.refreshToken,
                grant_type: 'refresh_token'
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error_description || 'Failed to refresh token');

        connection.accessToken = data.access_token;
        if (data.refresh_token) connection.refreshToken = data.refresh_token;
        connection.tokenExpiry = new Date(Date.now() + (data.expires_in || 3600) * 1000);
        await connection.save();

        return connection.accessToken;
    } catch (err) {
        console.error(`[Microsoft Adapter] Refresh token failed for ${connection.providerEmail}:`, err.message);
        throw err;
    }
}

async function registerWebhook(connection) {
    if (!process.env.WEBHOOK_BASE_URL) {
        console.warn(`[Microsoft Adapter] WEBHOOK_BASE_URL not set. Skipping webhook registration for ${connection.providerEmail}`);
        return;
    }

    try {
        const token = await refreshAccessToken(connection);
        
        // Microsoft Graph limit is 4230 minutes (~2.93 days). We set it to 4200 minutes just to be safe.
        const expirationDateTime = new Date(Date.now() + 4200 * 60 * 1000).toISOString();
        
        const response = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                changeType: 'created,updated,deleted',
                notificationUrl: `${process.env.WEBHOOK_BASE_URL}/api/calendars/webhooks-microsoft`,
                resource: '/me/events',
                expirationDateTime: expirationDateTime,
                clientState: connection.userId.toString() // We pass userId as clientState for validation
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log(`[Microsoft Adapter] Registered webhook for ${connection.providerEmail}. Expires: ${expirationDateTime}`);
        
        connection.webhookId = data.id;
        connection.webhookResourceId = connection.userId.toString(); 
        connection.webhookExpiration = new Date(expirationDateTime);
        await connection.save();

        // Perform an initial sync right after registration
        await syncEvents(connection);
    } catch (err) {
        console.error(`[Microsoft Adapter] Failed to register webhook for ${connection.providerEmail}:`, err.message);
        throw err;
    }
}

async function syncEvents(connection) {
    try {
        console.log(`[Microsoft Adapter] Syncing events for ${connection.providerEmail}`);
        const token = await refreshAccessToken(connection);
        
        const now = new Date();
        const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
        const twoDaysFromNow = new Date(now.getTime() + 48 * 60 * 60 * 1000);
        
        // CalendarView expands recurring events and returns active ongoing meetings
        const startDateTime = encodeURIComponent(fourHoursAgo.toISOString());
        const endDateTime = encodeURIComponent(twoDaysFromNow.toISOString());
        
        const response = await fetch(`https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${startDateTime}&endDateTime=${endDateTime}&$top=50`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `HTTP ${response.status}`);
        }

        const data = await response.json();
        const events = data.value || [];

        for (const event of events) {
            const extracted = extractMeetingUrl(event, 'microsoft');
            if (extracted) {
                // MS Graph often returns UTC like "2024-03-20T14:00:00.0000000" in event.start.dateTime without a Z
                // if we don't append Z, JS Date parser might treat it as local time depending on OS
                const startStr = event.start.dateTime.endsWith('Z') ? event.start.dateTime : event.start.dateTime + 'Z';
                const endStr = event.end.dateTime.endsWith('Z') ? event.end.dateTime : event.end.dateTime + 'Z';

                const startTime = new Date(startStr);
                const endTime = new Date(endStr);
                
                // Only queue if it's in the future
                if (startTime > new Date()) {
                    await scheduleBotDispatch(connection, event, extracted, startTime, endTime);
                }
            }
        }
        
        console.log(`[Microsoft Adapter] Sync complete for ${connection.providerEmail}. Processed ${events.length} events.`);
    } catch (err) {
        console.error(`[Microsoft Adapter] Sync failed for ${connection.providerEmail}:`, err.message);
    }
}

async function scheduleBotDispatch(connection, event, extracted, startTime, endTime) {
    const existing = await ScheduledMeeting.findOne({
        userId: connection.userId,
        eventId: event.id,
        provider: 'microsoft'
    });

    if (!existing) {
        const meeting = new ScheduledMeeting({
            userId: connection.userId,
            provider: 'microsoft',
            eventId: event.id,
            title: event.subject || 'Untitled Meeting',
            startTime,
            endTime,
            meetingUrl: extracted.url,
            platform: extracted.platform
        });
        await meeting.save();
        
        // Dispatch to BullMQ. Delay is ms until start time
        const delay = startTime.getTime() - Date.now();
        console.log(`[Microsoft Adapter] Scheduling bot for event: ${meeting.title} in ${Math.round(delay/60000)} mins`);
        
        await queueAdapter.enqueue('bot-dispatch', {
            userId: connection.userId,
            meetingId: meeting._id,
            url: meeting.meetingUrl,
            platform: meeting.platform
        }, {
            delay,
            jobId: `microsoft-${event.id}` // Prevents duplicates
        });
    } else {
        // Handle updates to existing events
        if (existing.startTime.getTime() !== startTime.getTime() || existing.meetingUrl !== extracted.url) {
            existing.startTime = startTime;
            existing.endTime = endTime;
            existing.meetingUrl = extracted.url;
            existing.platform = extracted.platform;
            existing.title = event.subject || existing.title;
            await existing.save();
            
            const delay = startTime.getTime() - Date.now();
            console.log(`[Microsoft Adapter] Rescheduling bot for event: ${existing.title} in ${Math.round(delay/60000)} mins`);
            
            // Remove old job and create new one
            await queueAdapter.getQueue('bot-dispatch').remove(`microsoft-${event.id}`);
            await queueAdapter.enqueue('bot-dispatch', {
                userId: connection.userId,
                meetingId: existing._id,
                url: existing.meetingUrl,
                platform: existing.platform
            }, {
                delay,
                jobId: `microsoft-${event.id}`
            });
        }
    }
}

module.exports = {
    refreshAccessToken,
    registerWebhook,
    syncEvents
};
