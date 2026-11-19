const express = require('express');
const CalendarConnection = require('../../db/models/CalendarConnection');
const googleAdapter = require('../../services/calendars/google-adapter');

const router = express.Router();

/**
 * POST /calendars/google/webhook
 * Google pushes notifications here when a user's calendar changes.
 */
router.post('/google/webhook', async (req, res) => {
    try {
        const channelId = req.headers['x-goog-channel-id'];
        const resourceState = req.headers['x-goog-resource-state'];
        
        // Respond immediately per Google's webhook requirements
        res.status(200).send('OK');

        if (resourceState === 'sync') {
            // Initial sync notification - ignore or handle if needed
            return;
        }

        if (!channelId) return;

        // Find which user this webhook belongs to
        const connection = await CalendarConnection.findOne({ webhookChannelId: channelId, provider: 'google' });
        
        if (connection) {
            console.log(`[Google Webhook] Received update for user ${connection.userId}`);
            // Fetch the latest events and schedule bots
            await googleAdapter.syncEvents(connection);
        }
    } catch (e) {
        console.error('[Google Webhook] Error processing webhook:', e.message);
    }
});

module.exports = router;
