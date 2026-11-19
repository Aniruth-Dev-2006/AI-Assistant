const express = require('express');
const jwt = require('jsonwebtoken');
const requireAuth = require('../middleware/auth');
const User = require('../db/models/User');
const Organization = require('../db/models/Organization');
const OrgInvite = require('../db/models/OrgInvite');
const {
    canManageOrg,
    canManageMembers,
    serializeOrg,
    serializeMember,
    createOrganizationForUser,
    ensureUserOrganization,
    getOrgMembers,
    listPendingInvites
} = require('../services/org-service');

const router = express.Router();

function issueToken(user) {
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
}

async function loadActor(req) {
    const user = await User.findById(req.user.userId);
    if (!user) return null;
    return user;
}

router.use(requireAuth);

router.get('/me', async (req, res) => {
    try {
        const user = await loadActor(req);
        if (!user) return res.status(404).json({ error: 'User not found' });

        let org = null;
        if (user.orgId) {
            org = await Organization.findById(user.orgId);
        }

        res.json({
            organization: serializeOrg(org),
            membership: {
                role: user.role || 'member',
                userId: String(user._id),
                email: user.email,
                displayName: user.displayName || ''
            },
            needsOrganization: !org
        });
    } catch (e) {
        console.error('[Org] GET /me failed:', e.message);
        res.status(500).json({ error: 'Failed to load organization' });
    }
});

router.post('/', async (req, res) => {
    try {
        const user = await loadActor(req);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.orgId) {
            const existing = await Organization.findById(user.orgId);
            if (existing) {
                return res.status(409).json({ error: 'You already belong to an organization', organization: serializeOrg(existing) });
            }
        }

        const name = String(req.body.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Organization name is required' });

        const org = await createOrganizationForUser(user, name);
        res.status(201).json({
            organization: serializeOrg(org),
            membership: { role: 'owner', userId: String(user._id) },
            token: issueToken(user)
        });
    } catch (e) {
        console.error('[Org] POST / failed:', e.message);
        res.status(500).json({ error: 'Failed to create organization' });
    }
});

router.patch('/me', async (req, res) => {
    try {
        const user = await loadActor(req);
        if (!user || !user.orgId) return res.status(404).json({ error: 'No organization' });
        if (!canManageOrg(user.role)) return res.status(403).json({ error: 'Only owners and admins can update the organization' });

        const org = await Organization.findById(user.orgId);
        if (!org) return res.status(404).json({ error: 'Organization not found' });

        if (typeof req.body.name === 'string' && req.body.name.trim()) {
            org.name = req.body.name.trim().slice(0, 80);
        }
        if (typeof req.body.maxConcurrent === 'number' && req.body.maxConcurrent >= 1 && req.body.maxConcurrent <= 100) {
            org.maxConcurrent = Math.floor(req.body.maxConcurrent);
        }
        await org.save();
        res.json({ organization: serializeOrg(org) });
    } catch (e) {
        console.error('[Org] PATCH /me failed:', e.message);
        res.status(500).json({ error: 'Failed to update organization' });
    }
});

router.get('/me/members', async (req, res) => {
    try {
        const user = await loadActor(req);
        if (!user || !user.orgId) return res.status(404).json({ error: 'No organization' });
        const members = await getOrgMembers(user.orgId);
        res.json({ members });
    } catch (e) {
        console.error('[Org] GET members failed:', e.message);
        res.status(500).json({ error: 'Failed to list members' });
    }
});

router.patch('/me/members/:userId', async (req, res) => {
    try {
        const user = await loadActor(req);
        if (!user || !user.orgId) return res.status(404).json({ error: 'No organization' });
        if (!canManageMembers(user.role)) return res.status(403).json({ error: 'Insufficient permissions' });

        const targetId = req.params.userId;
        const nextRole = String(req.body.role || '').trim();
        if (!['admin', 'member'].includes(nextRole)) {
            return res.status(400).json({ error: 'Role must be admin or member' });
        }
        if (String(user._id) === String(targetId)) {
            return res.status(400).json({ error: 'Cannot change your own role here' });
        }

        const target = await User.findOne({ _id: targetId, orgId: user.orgId });
        if (!target) return res.status(404).json({ error: 'Member not found' });
        if (target.role === 'owner') return res.status(403).json({ error: 'Cannot change the owner role' });
        if (user.role !== 'owner' && target.role === 'admin') {
            return res.status(403).json({ error: 'Only the owner can change admin roles' });
        }

        target.role = nextRole;
        await target.save();
        res.json({ member: serializeMember(target) });
    } catch (e) {
        console.error('[Org] PATCH member failed:', e.message);
        res.status(500).json({ error: 'Failed to update member' });
    }
});

router.delete('/me/members/:userId', async (req, res) => {
    try {
        const user = await loadActor(req);
        if (!user || !user.orgId) return res.status(404).json({ error: 'No organization' });
        if (!canManageMembers(user.role)) return res.status(403).json({ error: 'Insufficient permissions' });

        const targetId = req.params.userId;
        if (String(user._id) === String(targetId)) {
            return res.status(400).json({ error: 'Leave the organization instead of removing yourself' });
        }

        const target = await User.findOne({ _id: targetId, orgId: user.orgId });
        if (!target) return res.status(404).json({ error: 'Member not found' });
        if (target.role === 'owner') return res.status(403).json({ error: 'Cannot remove the owner' });
        if (user.role !== 'owner' && target.role === 'admin') {
            return res.status(403).json({ error: 'Only the owner can remove admins' });
        }

        target.orgId = undefined;
        target.role = 'member';
        await target.save();
        res.json({ ok: true });
    } catch (e) {
        console.error('[Org] DELETE member failed:', e.message);
        res.status(500).json({ error: 'Failed to remove member' });
    }
});

router.get('/me/invites', async (req, res) => {
    try {
        const user = await loadActor(req);
        if (!user || !user.orgId) return res.status(404).json({ error: 'No organization' });
        if (!canManageMembers(user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
        const invites = await listPendingInvites(user.orgId);
        res.json({ invites });
    } catch (e) {
        console.error('[Org] GET invites failed:', e.message);
        res.status(500).json({ error: 'Failed to list invites' });
    }
});

router.post('/me/invites', async (req, res) => {
    try {
        const user = await loadActor(req);
        if (!user || !user.orgId) return res.status(404).json({ error: 'No organization' });
        if (!canManageMembers(user.role)) return res.status(403).json({ error: 'Insufficient permissions' });

        const email = String(req.body.email || '').trim().toLowerCase();
        const role = String(req.body.role || 'member').trim();
        if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email is required' });
        if (!['admin', 'member'].includes(role)) return res.status(400).json({ error: 'Role must be admin or member' });
        if (role === 'admin' && user.role !== 'owner') {
            return res.status(403).json({ error: 'Only the owner can invite admins' });
        }

        const existingMember = await User.findOne({ email, orgId: user.orgId });
        if (existingMember) return res.status(409).json({ error: 'User is already a member' });

        await OrgInvite.updateMany(
            { orgId: user.orgId, email, status: 'pending' },
            { $set: { status: 'revoked' } }
        );

        const token = OrgInvite.createToken();
        const invite = await OrgInvite.create({
            orgId: user.orgId,
            email,
            role,
            token,
            invitedBy: user._id,
            expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
        });

        res.status(201).json({
            invite: {
                id: String(invite._id),
                email: invite.email,
                role: invite.role,
                token: invite.token,
                expiresAt: invite.expiresAt,
                createdAt: invite.createdAt
            }
        });
    } catch (e) {
        console.error('[Org] POST invite failed:', e.message);
        res.status(500).json({ error: 'Failed to create invite' });
    }
});

router.delete('/me/invites/:inviteId', async (req, res) => {
    try {
        const user = await loadActor(req);
        if (!user || !user.orgId) return res.status(404).json({ error: 'No organization' });
        if (!canManageMembers(user.role)) return res.status(403).json({ error: 'Insufficient permissions' });

        const invite = await OrgInvite.findOne({ _id: req.params.inviteId, orgId: user.orgId, status: 'pending' });
        if (!invite) return res.status(404).json({ error: 'Invite not found' });
        invite.status = 'revoked';
        await invite.save();
        res.json({ ok: true });
    } catch (e) {
        console.error('[Org] DELETE invite failed:', e.message);
        res.status(500).json({ error: 'Failed to revoke invite' });
    }
});

router.post('/invites/accept', async (req, res) => {
    try {
        const user = await loadActor(req);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const token = String(req.body.token || '').trim();
        if (!token) return res.status(400).json({ error: 'Invite token is required' });

        const invite = await OrgInvite.findOne({ token, status: 'pending' });
        if (!invite) return res.status(404).json({ error: 'Invite not found or already used' });
        if (invite.expiresAt < new Date()) {
            invite.status = 'expired';
            await invite.save();
            return res.status(410).json({ error: 'Invite has expired' });
        }
        if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
            return res.status(403).json({ error: 'This invite was sent to a different email address' });
        }
        if (user.orgId && String(user.orgId) !== String(invite.orgId)) {
            return res.status(409).json({ error: 'Leave your current organization before accepting this invite' });
        }

        const org = await Organization.findById(invite.orgId);
        if (!org) return res.status(404).json({ error: 'Organization no longer exists' });

        user.orgId = org._id;
        user.role = invite.role;
        await user.save();
        invite.status = 'accepted';
        await invite.save();

        res.json({
            organization: serializeOrg(org),
            membership: { role: user.role, userId: String(user._id) },
            token: issueToken(user)
        });
    } catch (e) {
        console.error('[Org] accept invite failed:', e.message);
        res.status(500).json({ error: 'Failed to accept invite' });
    }
});

router.post('/me/feature-flags', async (req, res) => {
    try {
        const user = await loadActor(req);
        if (!user || !user.orgId) return res.status(404).json({ error: 'No organization' });
        if (user.role !== 'owner') return res.status(403).json({ error: 'Only the owner can change feature flags' });

        const flag = String(req.body.flag || '').trim();
        const enabled = !!req.body.enabled;
        if (!flag || !/^[a-zA-Z][a-zA-Z0-9_]{1,40}$/.test(flag)) {
            return res.status(400).json({ error: 'Invalid feature flag name' });
        }

        const org = await Organization.findById(user.orgId);
        if (!org) return res.status(404).json({ error: 'Organization not found' });

        const set = new Set(org.featureFlags || []);
        if (enabled) set.add(flag);
        else set.delete(flag);
        org.featureFlags = [...set];
        await org.save();

        res.json({ organization: serializeOrg(org) });
    } catch (e) {
        console.error('[Org] feature-flags failed:', e.message);
        res.status(500).json({ error: 'Failed to update feature flags' });
    }
});

router.post('/me/ensure', async (req, res) => {
    try {
        const user = await loadActor(req);
        if (!user) return res.status(404).json({ error: 'User not found' });
        const org = await ensureUserOrganization(user, req.body?.name);
        res.json({
            organization: serializeOrg(org),
            membership: { role: user.role || 'owner', userId: String(user._id) },
            token: issueToken(user)
        });
    } catch (e) {
        console.error('[Org] ensure failed:', e.message);
        res.status(500).json({ error: 'Failed to ensure organization' });
    }
});

module.exports = router;
