const express = require('express');
const requireAuth = require('../middleware/auth');
const CalendarConnection = require('../db/models/CalendarConnection');

const router = express.Router();
router.use(requireAuth);

router.get('/connections', async (req, res) => {
    try {
        const userId = req.user.userId || req.user._id;
        const connections = await CalendarConnection.find({ userId })
            .select('-accessToken -refreshToken')
            .sort('-createdAt')
            .lean();
        res.status(200).json(connections);
    } catch (e) {
        console.error('[Calendars API] Error fetching connections:', e);
        res.status(500).json({ error: 'Failed to fetch calendar connections' });
    }
});

router.delete('/connections/:id', async (req, res) => {
    try {
        const connectionId = req.params.id;
        const userId = req.user.userId || req.user._id;
        const result = await CalendarConnection.findOneAndDelete({
            _id: connectionId,
            userId
        });

        if (!result) {
            return res.status(404).json({ error: 'Connection not found' });
        }

        const ScheduledMeeting = require('../db/models/ScheduledMeeting');
        await ScheduledMeeting.deleteMany({ calendarConnectionId: connectionId });

        res.status(200).json({ success: true, message: 'Calendar disconnected successfully' });
    } catch (e) {
        console.error('[Calendars API] Error disconnecting calendar:', e);
        res.status(500).json({ error: 'Failed to disconnect calendar' });
    }
});

router.get('/events', async (req, res) => {
    try {
        const userId = req.user.userId || req.user._id;
        const connection = await CalendarConnection.findOne({
            userId,
            provider: 'google',
            enabled: true
        });

        if (!connection) {
            return res.status(200).json({
                events: [],
                connected: false,
                error: null
            });
        }

        const timeMin = req.query.timeMin ? new Date(req.query.timeMin) : (() => {
            const d = new Date();
            d.setMonth(d.getMonth() - 1);
            return d;
        })();
        const timeMax = req.query.timeMax ? new Date(req.query.timeMax) : (() => {
            const d = new Date();
            d.setMonth(d.getMonth() + 3);
            return d;
        })();

        if (Number.isNaN(timeMin.getTime()) || Number.isNaN(timeMax.getTime())) {
            return res.status(400).json({ error: 'Invalid timeMin/timeMax' });
        }

        const googleAdapter = require('../services/calendars/google-adapter');
        const events = await googleAdapter.listEvents(connection, timeMin, timeMax);
        await CalendarConnection.findByIdAndUpdate(connection._id, {
            lastSyncAt: new Date(),
            lastSyncError: null
        });

        res.status(200).json({
            events,
            connected: true,
            providerEmail: connection.providerEmail || null,
            lastSyncAt: new Date(),
            error: null
        });
    } catch (e) {
        console.error('[Calendars API] Error fetching events:', e.message);
        const userId = req.user.userId || req.user._id;
        await CalendarConnection.findOneAndUpdate(
            { userId, provider: 'google' },
            { lastSyncError: e.message }
        ).catch(() => {});

        const needsReconnect = /invalid_grant|invalid_client|unauthorized|401/i.test(e.message || '');
        res.status(needsReconnect ? 401 : 500).json({
            events: [],
            connected: true,
            error: needsReconnect
                ? 'Google Calendar access expired. Reconnect under Integrations.'
                : (e.message || 'Failed to load calendar events')
        });
    }
});

router.post('/sync', async (req, res) => {
    try {
        const userId = req.user.userId || req.user._id;
        const connection = await CalendarConnection.findOne({ userId, provider: 'google', enabled: true });
        if (!connection) {
            return res.status(404).json({ error: 'Google Calendar not connected' });
        }
        const googleAdapter = require('../services/calendars/google-adapter');
        await googleAdapter.syncEvents(connection);
        const fresh = await CalendarConnection.findById(connection._id).select('lastSyncAt lastSyncError').lean();
        if (fresh && fresh.lastSyncError) {
            return res.status(400).json({ error: fresh.lastSyncError, lastSyncAt: fresh.lastSyncAt });
        }
        res.status(200).json({ success: true, lastSyncAt: fresh && fresh.lastSyncAt });
    } catch (e) {
        console.error('[Calendars API] Sync failed:', e.message);
        res.status(500).json({ error: e.message || 'Sync failed' });
    }
});

module.exports = router;
