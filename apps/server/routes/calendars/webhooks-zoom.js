const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const CalendarConnection = require('../../db/models/CalendarConnection');
const zoomAdapter = require('../../services/calendars/zoom-adapter');

router.post('/', async (req, res) => {
    try {
        const { event, payload } = req.body;
        
        // 1. Endpoint Validation Handshake (Production Standard)
        if (event === 'endpoint.url_validation') {
            if (!process.env.ZOOM_WEBHOOK_SECRET_TOKEN) {
                console.error('[Zoom Webhook] ZOOM_WEBHOOK_SECRET_TOKEN is not set');
                return res.status(500).send('Webhook secret token not configured');
            }
            
            const plainToken = payload.plainToken;
            const hashForValidate = crypto.createHmac('sha256', process.env.ZOOM_WEBHOOK_SECRET_TOKEN)
                .update(plainToken)
                .digest('hex');
                
            return res.status(200).json({
                plainToken: plainToken,
                encryptedToken: hashForValidate
            });
        }

        // 2. Handle actual meeting events
        console.log(`[Zoom Webhook] Received event: ${event}`);
        
        // We can either parse the webhook payload to update/delete specific meetings,
        // or just trigger a re-sync for the user (similar to Google/Microsoft).
        // Since Zoom webhooks contain the account_id and user_id but not always our internal email,
        // we might need to look up the connection by providerId (which is the Zoom user ID).
        
        const zoomUserId = payload?.object?.host_id;
        
        if (zoomUserId) {
            const connection = await CalendarConnection.findOne({ providerId: zoomUserId, provider: 'zoom' });
            if (connection) {
                // Trigger an async sync
                zoomAdapter.syncMeetings(connection).catch(err => console.error('[Zoom Sync Error]', err));
            }
        }
        
        res.status(200).send('OK');

    } catch (error) {
        console.error('[Zoom Webhook] Error processing request:', error);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;
