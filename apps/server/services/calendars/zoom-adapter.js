const fetch = require('node-fetch'); // Native fetch in Node 18+ or polyfill
const CalendarConnection = require('../../db/models/CalendarConnection');
const Meeting = require('../../db/models/ScheduledMeeting');

async function getValidToken(connection) {
    if (!connection.tokenExpiry || connection.tokenExpiry.getTime() <= Date.now() + 60000) {
        console.log(`[Zoom] Refreshing token for ${connection.providerEmail}`);
        const authHeader = 'Basic ' + Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString('base64');
        
        try {
            const response = await fetch(`https://zoom.us/oauth/token?grant_type=refresh_token&refresh_token=${connection.refreshToken}`, {
                method: 'POST',
                headers: { 'Authorization': authHeader }
            });
            const tokenData = await response.json();
            
            if (tokenData.error) {
                throw new Error(`Refresh failed: ${tokenData.error}`);
            }

            connection.accessToken = tokenData.access_token;
            connection.refreshToken = tokenData.refresh_token;
            connection.tokenExpiry = new Date(Date.now() + (tokenData.expires_in * 1000));
            await connection.save();
        } catch (error) {
            console.error('[Zoom] Token refresh error:', error);
            connection.enabled = false;
            await connection.save();
            throw error;
        }
    }
    return connection.accessToken;
}

async function syncMeetings(connection) {
    try {
        const token = await getValidToken(connection);
        
        // Zoom requires a type parameter. 'upcoming' fetches future scheduled meetings.
        const response = await fetch(`https://api.zoom.us/v2/users/me/meetings?type=upcoming&page_size=100`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (data.code === 124) {
            console.error('[Zoom] Access token expired or invalid');
            return;
        }

        const meetings = data.meetings || [];

        for (const event of meetings) {
            // Check if meeting is already over or hasn't started yet
            const startTime = new Date(event.start_time);
            const durationMs = (event.duration || 60) * 60000;
            const endTime = new Date(startTime.getTime() + durationMs);

            const meetingData = {
                title: event.topic,
                startTime: startTime,
                endTime: endTime,
                meetingUrl: event.join_url,
                platform: 'zoom',
                status: 'scheduled',
                source: 'zoom',
                externalEventId: event.id.toString(),
                userId: connection.userId
            };

            await Meeting.findOneAndUpdate(
                { externalEventId: event.id.toString(), userId: connection.userId },
                meetingData,
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
        }
        console.log(`[Zoom] Synced ${meetings.length} upcoming meetings for ${connection.providerEmail}`);

    } catch (error) {
        console.error(`[Zoom] Failed to sync meetings for ${connection.providerEmail}:`, error.message);
    }
}

async function registerWebhook(connection) {
    // Zoom webhooks are configured globally in the Zoom App Marketplace Dashboard.
    // We don't need to dynamically register them per user via API like Google/Microsoft.
    // We just do an initial sync so the database is populated.
    console.log(`[Zoom Webhook] Initiating first-time sync for ${connection.providerEmail}`);
    await syncMeetings(connection);
}

module.exports = {
    getValidToken,
    syncMeetings,
    registerWebhook
};
