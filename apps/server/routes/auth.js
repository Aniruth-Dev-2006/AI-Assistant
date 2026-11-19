const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const jwt = require('jsonwebtoken');
const User = require('../db/models/User');
const Organization = require('../db/models/Organization');
const { hashPassword, verifyPassword, assertPasswordStrength } = require('../services/password');
const { ensureUserOrganization, serializeOrg } = require('../services/org-service');
const { buildAuthSuccessPage } = require('./auth-success-page');

const router = express.Router();

function redirectAuthSuccess(res, { token, flow, provider }) {
    const html = buildAuthSuccessPage({ token, provider, flow });
    res.set('Cache-Control', 'no-store');
    res.set('X-MeetingAI-Auth', 'success-v2');
    return res.type('html').status(200).send(html);
}

const generateToken = (user) => {
    return jwt.sign(
        {
            userId: user._id,
            email: user.email,
            orgId: user.orgId || null,
            role: user.role || 'member'
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
    );
};

const publicUser = (user, org = null) => ({
    id: String(user._id),
    email: user.email,
    displayName: user.displayName || '',
    avatarUrl: user.avatarUrl || '',
    role: user.role || 'member',
    orgId: user.orgId ? String(user.orgId) : null,
    salesModeActive: !!user.salesModeActive,
    orgFeatureFlags: (org && Array.isArray(org.featureFlags)) ? org.featureFlags : [],
    organization: org ? serializeOrg(org) : null
});

// Generic OAuth callback handler
const handleOAuthProfile = async (req, provider, profile, accessToken, refreshToken, params, done) => {
    try {
        const email = profile.emails && profile.emails.length > 0 ? profile.emails[0].value : null;
        if (!email) return done(new Error(`No email returned from ${provider}`), null);
        let user;

        let integrationUserId = null;
        if (req.query && req.query.state) {
            try {
                const stateObj = JSON.parse(Buffer.from(req.query.state, 'base64').toString('utf-8'));
                if (stateObj.token) {
                    const decoded = jwt.verify(stateObj.token, process.env.JWT_SECRET);
                    integrationUserId = decoded.userId;
                }
            } catch (e) {
                console.error('[Auth] State decoding or JWT verification error:', e.message);
            }
        }

        if (integrationUserId) {
            // Integration flow: Link to existing user
            user = await User.findById(integrationUserId);
            if (!user) return done(new Error("Integration failed: User not found"), null);
            console.log(`[Auth] Linking ${provider} to existing user ${user.email}`);
        } else {
            // Standard login flow
            user = await User.findOne({ email });

            if (!user) {
                // Check if providerId is already registered
                user = await User.findOne({ providerId: profile.id, provider });
            }

            if (user) {
                // Update existing user just in case
                user.displayName = profile.displayName || user.displayName;
                user.avatarUrl = (profile.photos && profile.photos.length > 0) ? profile.photos[0].value : user.avatarUrl;
                user.providerId = profile.id;
                user.provider = provider;
                await user.save();
            } else {
                user = new User({
                    email,
                    displayName: profile.displayName,
                    avatarUrl: (profile.photos && profile.photos.length > 0) ? profile.photos[0].value : null,
                    provider,
                    providerId: profile.id
                });
                await user.save();
                await ensureUserOrganization(user, `${profile.displayName || email.split('@')[0]}'s Workspace`);
            }
        }

        if (user && !user.orgId && !integrationUserId) {
            await ensureUserOrganization(user, `${user.displayName || email.split('@')[0]}'s Workspace`);
        }

        // Upsert the CalendarConnection
        const CalendarConnection = require('../db/models/CalendarConnection');
        const tokenExpiry = params && params.expires_in ? new Date(Date.now() + params.expires_in * 1000) : null;
        
        const updateData = {
            providerEmail: email,
            accessToken: accessToken,
            enabled: true
        };
        if (refreshToken) updateData.refreshToken = refreshToken;
        if (tokenExpiry) updateData.tokenExpiry = tokenExpiry;

        const connection = await CalendarConnection.findOneAndUpdate(
            { userId: user._id, provider: provider },
            updateData,
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        if (provider === 'google') {
            const googleAdapter = require('../services/calendars/google-adapter');
            // Register webhook asynchronously so we don't block the OAuth flow
            googleAdapter.registerWebhook(connection).catch(err => console.error('[Webhook] Auto-register failed:', err.message));
        } else if (provider === 'microsoft') {
            const microsoftAdapter = require('../services/calendars/microsoft-adapter');
            microsoftAdapter.registerWebhook(connection).catch(err => console.error('[Microsoft Webhook] Auto-register failed:', err.message));
        }

        return done(null, user);
    } catch (e) {
        return done(e, null);
    }
};

// Configure Passport Strategies
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${process.env.API_BASE_URL || 'http://localhost:8080'}/auth/google/callback`,
        scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar.readonly'],
        passReqToCallback: true
    }, (req, accessToken, refreshToken, params, profile, done) => {
        handleOAuthProfile(req, 'google', profile, accessToken, refreshToken, params, done);
    }));
}

if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
    passport.use(new MicrosoftStrategy({
        clientID: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        callbackURL: `${process.env.API_BASE_URL || 'http://localhost:8080'}/auth/microsoft/callback`,
        scope: ['user.read', 'Calendars.Read', 'offline_access'],
        passReqToCallback: true
    }, (req, accessToken, refreshToken, profile, done) => {
        handleOAuthProfile(req, 'microsoft', profile, accessToken, refreshToken, null, done);
    }));
}

// Google Routes
router.get('/google', (req, res, next) => {
    const stateObj = { 
        ext: req.query.ext ? true : false,
        token: req.query.token,
        desktop: req.query.desktop ? true : false
    };
    const stateStr = Buffer.from(JSON.stringify(stateObj)).toString('base64');
    
    passport.authenticate('google', { 
        session: false,
        accessType: 'offline',
        prompt: 'consent',
        state: stateStr
    })(req, res, next);
});

router.get('/google/callback', passport.authenticate('google', { session: false, failureRedirect: '/login?error=auth_failed' }), (req, res) => {
    const token = generateToken(req.user);

    let stateObj = {};
    if (req.query.state) {
        try { stateObj = JSON.parse(Buffer.from(req.query.state, 'base64').toString('utf-8')); } catch (e) {}
    }

    let flow = 'login';
    if (stateObj.ext) flow = 'extension';
    else if (stateObj.token || stateObj.desktop) flow = 'integration';

    console.log('[Auth] google/callback → success page', { flow, hasToken: !!stateObj.token, desktop: !!stateObj.desktop });

    // Extension listens for /auth/success?token= in the tab URL
    if (flow === 'extension') {
        const q = new URLSearchParams({ token, flow, provider: 'google' });
        return res.redirect(`/auth/success?${q.toString()}`);
    }

    return redirectAuthSuccess(res, {
        token,
        flow,
        provider: flow === 'integration' ? 'google' : ''
    });
});

router.post('/register', async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');
        const displayName = String(req.body.displayName || '').trim().slice(0, 80);
        const organizationName = String(req.body.organizationName || req.body.orgName || '').trim().slice(0, 80);
        const inviteToken = String(req.body.inviteToken || '').trim();

        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: 'Valid email is required' });
        }
        const pwError = assertPasswordStrength(password);
        if (pwError) return res.status(400).json({ error: pwError });

        const existing = await User.findOne({ email });
        if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

        const passwordHash = await hashPassword(password);
        const user = new User({
            email,
            displayName: displayName || email.split('@')[0],
            provider: 'local',
            providerId: `local:${email}`,
            passwordHash,
            role: 'member'
        });
        await user.save();

        let org = null;
        if (inviteToken) {
            const OrgInvite = require('../db/models/OrgInvite');
            const invite = await OrgInvite.findOne({ token: inviteToken, status: 'pending' });
            if (!invite || invite.expiresAt < new Date()) {
                await User.deleteOne({ _id: user._id });
                return res.status(410).json({ error: 'Invite is invalid or expired' });
            }
            if (invite.email.toLowerCase() !== email) {
                await User.deleteOne({ _id: user._id });
                return res.status(403).json({ error: 'Invite email does not match' });
            }
            org = await Organization.findById(invite.orgId);
            if (!org) {
                await User.deleteOne({ _id: user._id });
                return res.status(404).json({ error: 'Organization no longer exists' });
            }
            user.orgId = org._id;
            user.role = invite.role;
            await user.save();
            invite.status = 'accepted';
            await invite.save();
        } else {
            org = await ensureUserOrganization(user, organizationName || `${user.displayName}'s Workspace`);
        }

        const token = generateToken(user);
        res.status(201).json({
            token,
            user: publicUser(user, org)
        });
    } catch (e) {
        console.error('[Auth] register failed:', e.message);
        res.status(500).json({ error: 'Failed to register' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await User.findOne({ email }).select('+passwordHash');
        if (!user || !user.passwordHash) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

        let org = null;
        if (user.orgId) {
            org = await Organization.findById(user.orgId);
        }
        if (!org) {
            org = await ensureUserOrganization(user, `${user.displayName || email.split('@')[0]}'s Workspace`);
        }

        res.json({
            token: generateToken(user),
            user: publicUser(user, org)
        });
    } catch (e) {
        console.error('[Auth] login failed:', e.message);
        res.status(500).json({ error: 'Failed to login' });
    }
});

router.post('/google-token', async (req, res) => {
    try {
        const accessToken = req.body.access_token || req.body.accessToken;
        if (!accessToken || accessToken === 'dummy_token') {
            return res.status(400).json({ error: 'Missing Google access token' });
        }
        const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!profileRes.ok) {
            return res.status(401).json({ error: 'Invalid Google token' });
        }
        const profile = await profileRes.json();
        const email = profile.email;
        if (!email) return res.status(400).json({ error: 'No email on Google profile' });

        let user = await User.findOne({ email });
        if (!user) {
            user = await User.findOne({ providerId: String(profile.id), provider: 'google' });
        }
        if (user) {
            user.displayName = profile.name || user.displayName;
            user.avatarUrl = profile.picture || user.avatarUrl;
            user.providerId = String(profile.id);
            user.provider = 'google';
            await user.save();
        } else {
            user = new User({
                email,
                displayName: profile.name,
                avatarUrl: profile.picture,
                provider: 'google',
                providerId: String(profile.id)
            });
            await user.save();
        }

        const org = await ensureUserOrganization(user, `${user.displayName || email.split('@')[0]}'s Workspace`);
        res.json({
            token: generateToken(user),
            user: publicUser(user, org)
        });
    } catch (e) {
        console.error('[Auth] google-token failed:', e);
        res.status(500).json({ error: 'Failed to exchange Google token' });
    }
});

router.get('/success', (req, res) => {
    const token = String(req.query.token || '');
    const flow = String(req.query.flow || (req.query.provider ? 'integration' : 'login'));
    const provider = String(req.query.provider || '');
    return redirectAuthSuccess(res, { token, flow, provider });
});

// Microsoft Routes
router.get('/microsoft', (req, res, next) => {
    const stateObj = { 
        ext: req.query.ext ? true : false,
        token: req.query.token
    };
    const stateStr = Buffer.from(JSON.stringify(stateObj)).toString('base64');

    passport.authenticate('microsoft', { 
        session: false,
        prompt: 'consent',
        state: stateStr
    })(req, res, next);
});

router.get('/microsoft/callback', passport.authenticate('microsoft', { session: false, failureRedirect: '/login?error=auth_failed' }), (req, res) => {
    const token = generateToken(req.user);

    let stateObj = {};
    if (req.query.state) {
        try { stateObj = JSON.parse(Buffer.from(req.query.state, 'base64').toString('utf-8')); } catch (e) {}
    }

    let flow = 'login';
    if (stateObj.ext) flow = 'extension';
    else if (stateObj.token) flow = 'integration';

    return redirectAuthSuccess(res, {
        token,
        flow,
        provider: flow === 'integration' || flow === 'extension' ? 'microsoft' : ''
    });
});

// Zoom Routes
router.get('/zoom', (req, res, next) => {
    const stateObj = { 
        ext: req.query.ext ? true : false,
        token: req.query.token
    };
    const stateStr = Buffer.from(JSON.stringify(stateObj)).toString('base64');
    
    const zoomAuthUrl = new URL('https://zoom.us/oauth/authorize');
    zoomAuthUrl.searchParams.append('response_type', 'code');
    zoomAuthUrl.searchParams.append('client_id', process.env.ZOOM_CLIENT_ID);
    zoomAuthUrl.searchParams.append('redirect_uri', `${process.env.API_BASE_URL || 'http://localhost:8080'}/auth/zoom/callback`);
    zoomAuthUrl.searchParams.append('state', stateStr);
    
    res.redirect(zoomAuthUrl.toString());
});

router.get('/zoom/callback', async (req, res, next) => {
    const { code, state } = req.query;
    
    if (!code) {
        return res.redirect('/login?error=zoom_auth_failed');
    }

    try {
        const redirectUri = `${process.env.API_BASE_URL || 'http://localhost:8080'}/auth/zoom/callback`;
        const authHeader = 'Basic ' + Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString('base64');
        
        // Exchange code for token
        const tokenResponse = await fetch(`https://zoom.us/oauth/token?grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(redirectUri)}`, {
            method: 'POST',
            headers: {
                'Authorization': authHeader
            }
        });
        
        const tokenData = await tokenResponse.json();
        
        if (tokenData.error) {
            console.error('[Zoom] Token Error:', tokenData);
            return res.redirect('/login?error=zoom_token_failed');
        }

        const { access_token, refresh_token, expires_in } = tokenData;

        // Fetch Zoom user profile
        const profileResponse = await fetch('https://api.zoom.us/v2/users/me', {
            headers: {
                'Authorization': `Bearer ${access_token}`
            }
        });
        const profile = await profileResponse.json();

        // Decode state
        let stateObj = {};
        if (state) {
            try { stateObj = JSON.parse(Buffer.from(state, 'base64').toString('utf-8')); } catch(e){}
        }

        let user;
        let integrationUserId = null;
        if (stateObj.token) {
            try {
                const decoded = jwt.verify(stateObj.token, process.env.JWT_SECRET);
                integrationUserId = decoded.userId;
            } catch(e) {}
        }

        if (integrationUserId) {
            user = await User.findById(integrationUserId);
            if (!user) throw new Error("User not found for integration");
        } else {
            // Standalone login via Zoom
            user = await User.findOne({ email: profile.email });
            if (!user) {
                user = await User.findOne({ providerId: profile.id, provider: 'zoom' });
            }
            if (user) {
                user.displayName = profile.first_name + ' ' + profile.last_name;
                user.avatarUrl = profile.pic_url || user.avatarUrl;
                user.providerId = profile.id;
                user.provider = 'zoom';
                await user.save();
            } else {
                user = new User({
                    email: profile.email,
                    displayName: profile.first_name + ' ' + profile.last_name,
                    avatarUrl: profile.pic_url || null,
                    provider: 'zoom',
                    providerId: profile.id
                });
                await user.save();
            }
        }

        // Upsert CalendarConnection
        const CalendarConnection = require('../db/models/CalendarConnection');
        const tokenExpiry = new Date(Date.now() + (expires_in || 3600) * 1000);
        
        const connection = await CalendarConnection.findOneAndUpdate(
            { userId: user._id, provider: 'zoom' },
            {
                providerEmail: profile.email,
                accessToken: access_token,
                refreshToken: refresh_token,
                tokenExpiry: tokenExpiry,
                enabled: true
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        // Fetch initial meetings and configure webhook if possible
        const zoomAdapter = require('../services/calendars/zoom-adapter');
        zoomAdapter.registerWebhook(connection).catch(err => console.error('[Zoom Webhook] Auto-register failed:', err.message));

        const appToken = generateToken(user);
        
        if (stateObj.ext || stateObj.token) {
            return redirectAuthSuccess(res, {
                token: appToken,
                flow: stateObj.ext ? 'extension' : 'integration',
                provider: 'zoom'
            });
        }
        res.send(`
            <script>
                if (window.opener) {
                    window.opener.postMessage({ type: 'AUTH_SUCCESS', token: '${appToken}' }, '*');
                    window.close();
                } else {
                    document.write('Authentication successful! Token: ${appToken}');
                }
            </script>
        `);
    } catch (e) {
        console.error('[Zoom OAuth Error]:', e);
        res.redirect('/login?error=zoom_internal_error');
    }
});

const requireAuth = require('../middleware/auth');

router.get('/preferences', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).populate('orgId').lean();
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({
            preferredLanguage: user.preferredLanguage || 'multi',
            botDisplayName: user.botDisplayName || 'Xobin',
            displayName: user.displayName || '',
            email: user.email || '',
            avatarUrl: user.avatarUrl || '',
            provider: user.provider || '',
            salesModeActive: user.salesModeActive || false,
            role: user.role || 'member',
            orgId: user.orgId?._id ? String(user.orgId._id) : (user.orgId ? String(user.orgId) : null),
            orgName: user.orgId?.name || '',
            orgPlan: user.orgId?.plan || 'free',
            orgFeatureFlags: user.orgId?.featureFlags || []
        });
    } catch (e) {
        console.error('[Auth] preferences get failed:', e.message);
        res.status(500).json({ error: 'Failed to load preferences' });
    }
});

router.patch('/preferences', requireAuth, async (req, res) => {
    try {
        const patch = {};
        if (typeof req.body.preferredLanguage === 'string' && req.body.preferredLanguage.trim()) {
            patch.preferredLanguage = req.body.preferredLanguage.trim().slice(0, 16);
        }
        if (typeof req.body.botDisplayName === 'string' && req.body.botDisplayName.trim()) {
            patch.botDisplayName = req.body.botDisplayName.trim().slice(0, 64);
        }
        if (typeof req.body.displayName === 'string') {
            const name = req.body.displayName.trim().slice(0, 80);
            if (name) patch.displayName = name;
        }
        if (typeof req.body.avatarUrl === 'string') {
            const avatar = req.body.avatarUrl.trim();
            if (!avatar) {
                patch.avatarUrl = '';
            } else if (avatar.startsWith('https://') || avatar.startsWith('http://')) {
                patch.avatarUrl = avatar.slice(0, 2048);
            } else if (avatar.startsWith('data:image/')) {
                if (avatar.length > 900000) {
                    return res.status(400).json({ error: 'Avatar image is too large (max ~650KB)' });
                }
                patch.avatarUrl = avatar;
            } else {
                return res.status(400).json({ error: 'Invalid avatar' });
            }
        }
        if (typeof req.body.salesModeActive === 'boolean') {
            patch.salesModeActive = req.body.salesModeActive;
        }
        if (!Object.keys(patch).length) {
            return res.status(400).json({ error: 'No preferences to update' });
        }
        const user = await User.findByIdAndUpdate(req.user.userId, { $set: patch }, { new: true }).populate('orgId').lean();
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({
            preferredLanguage: user.preferredLanguage || 'multi',
            botDisplayName: user.botDisplayName || 'Xobin',
            displayName: user.displayName || '',
            email: user.email || '',
            avatarUrl: user.avatarUrl || '',
            provider: user.provider || '',
            salesModeActive: user.salesModeActive || false,
            role: user.role || 'member',
            orgId: user.orgId?._id ? String(user.orgId._id) : (user.orgId ? String(user.orgId) : null),
            orgName: user.orgId?.name || '',
            orgPlan: user.orgId?.plan || 'free',
            orgFeatureFlags: user.orgId?.featureFlags || []
        });
    } catch (e) {
        console.error('[Auth] preferences patch failed:', e.message);
        res.status(500).json({ error: 'Failed to save preferences' });
    }
});

module.exports = router;
