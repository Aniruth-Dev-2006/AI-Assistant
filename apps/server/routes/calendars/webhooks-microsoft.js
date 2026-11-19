const express = require('express');
const router = express.Router();
const CalendarConnection = require('../../db/models/CalendarConnection');
const microsoftAdapter = require('../../services/calendars/microsoft-adapter');

router.post('/', async (req, res) => {
    // 1. Validation phase (Microsoft sends a validation token to verify endpoint ownership)
    if (req.query && req.query.validationToken) {
        console.log('[Microsoft Webhook] Received validation request');
        // Microsoft requires the endpoint to respond with a 200 OK and the plain text validationToken
        return res.status(200).type('text/plain').send(req.query.validationToken);
    }

    // 2. Notification phase (Microsoft sends change events)
    // Send a 202 Accepted immediately as per Microsoft Graph API requirements
    res.status(202).send();

    if (req.body && req.body.value && Array.isArray(req.body.value)) {
        for (const notification of req.body.value) {
            try {
                // The clientState we passed was the userId
                const userId = notification.clientState;
                if (!userId) continue;

                // Find the associated calendar connection
                const connection = await CalendarConnection.findOne({
                    userId: userId,
                    provider: 'microsoft',
                    enabled: true
                });

                if (connection) {
                    console.log(`[Microsoft Webhook] Received update for user ${userId}`);
                    // Resync all events for this user (simpler than processing individual deltas for now)
                    await microsoftAdapter.syncEvents(connection);
                } else {
                    console.warn(`[Microsoft Webhook] No active connection found for user ${userId}`);
                }
            } catch (err) {
                console.error('[Microsoft Webhook] Error processing notification:', err);
            }
        }
    }
});

module.exports = router;
