const express = require('express');
const jwt = require('jsonwebtoken');
const hubspot = require('@hubspot/api-client');
const requireAuth = require('../middleware/auth');
const HubspotConnection = require('../db/models/HubspotConnection');
const hubspotClient = require('../services/hubspot-client');
const { buildAuthSuccessPage } = require('./auth-success-page');

const router = express.Router();

function defaultRedirectUri() {
    const base = (process.env.API_BASE_URL || process.env.PUBLIC_URL || 'http://localhost:8080').replace(/\/$/, '');
    return process.env.HUBSPOT_REDIRECT_URI || `${base}/hubspot/callback`;
}

router.get('/auth', requireAuth, (req, res) => {
    if (process.env.HUBSPOT_API_KEY) {
        const token = req.authToken || req.query.token || '';
        const html = buildAuthSuccessPage({ token, provider: 'hubspot', flow: 'integration' });
        res.set('Cache-Control', 'no-store');
        return res.type('html').status(200).send(html);
    }

    const clientId = process.env.HUBSPOT_CLIENT_ID;
    if (!clientId) {
        return res.status(500).send(
            'HubSpot is not configured. Set HUBSPOT_API_KEY (private app token) or HUBSPOT_CLIENT_ID/SECRET for OAuth, then restart the server.'
        );
    }

    const redirectUri = defaultRedirectUri();
    const scopes = 'crm.objects.contacts.read crm.objects.companies.read crm.objects.deals.read';
    const token = req.authToken || req.query.token || '';
    const state = Buffer.from(JSON.stringify({ token })).toString('base64');

    const authUrl = `https://app.hubspot.com/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}`;
    res.redirect(authUrl);
});

router.get('/callback', async (req, res) => {
    const { code, state } = req.query;

    if (!code) {
        return res.status(400).send('Missing authorization code');
    }

    let userId;
    let orgId;
    let stateToken = '';
    try {
        const stateObj = JSON.parse(Buffer.from(String(state || ''), 'base64').toString('utf-8'));
        stateToken = stateObj.token || '';
        const decoded = jwt.verify(stateToken, process.env.JWT_SECRET);
        userId = decoded.userId;
        orgId = decoded.orgId;
    } catch (e) {
        console.error('[HubSpot] State decoding error:', e.message);
        return res.status(400).send('Invalid state or expired token');
    }

    if (!orgId) {
        return res.status(400).send('User must belong to an organization to connect HubSpot');
    }

    const clientId = process.env.HUBSPOT_CLIENT_ID;
    const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
    const redirectUri = defaultRedirectUri();

    try {
        const hubspotSdk = new hubspot.Client();
        const tokens = await hubspotSdk.oauth.tokensApi.create(
            'authorization_code',
            code,
            redirectUri,
            clientId,
            clientSecret
        );

        const tempClient = new hubspot.Client({ accessToken: tokens.accessToken });
        const portalInfo = await tempClient.apiRequest({
            method: 'GET',
            path: '/account-info/v3/details'
        });
        const hubId = portalInfo.body?.portalId || portalInfo.portalId;

        await HubspotConnection.findOneAndUpdate(
            { orgId },
            {
                $set: {
                    accessToken: hubspotClient.encrypt(tokens.accessToken),
                    refreshToken: hubspotClient.encrypt(tokens.refreshToken),
                    expiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
                    hubId,
                    connectedBy: userId,
                    scopes: ['crm.objects.contacts.read', 'crm.objects.companies.read', 'crm.objects.deals.read']
                }
            },
            { upsert: true, new: true }
        );

        const html = buildAuthSuccessPage({ token: stateToken, provider: 'hubspot', flow: 'integration' });
        res.set('Cache-Control', 'no-store');
        return res.type('html').status(200).send(html);
    } catch (e) {
        console.error('[HubSpot] OAuth callback error:', e.message);
        return res.status(500).send('Failed to connect HubSpot');
    }
});

router.get('/status', requireAuth, async (req, res) => {
    try {
        const orgId = req.user.orgId;
        if (!orgId) return res.json({ connected: false });

        if (process.env.HUBSPOT_API_KEY) {
            return res.json({ connected: true, hubId: 'LOCAL_DEV_OVERRIDE', mode: 'api_key' });
        }

        const conn = await HubspotConnection.findOne({ orgId });
        if (conn) {
            return res.json({ connected: true, hubId: conn.hubId, mode: 'oauth' });
        }
        res.json({ connected: false });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.delete('/disconnect', requireAuth, async (req, res) => {
    try {
        const orgId = req.user.orgId;
        if (!orgId) return res.status(400).json({ error: 'No org' });

        await HubspotConnection.findOneAndDelete({ orgId });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
