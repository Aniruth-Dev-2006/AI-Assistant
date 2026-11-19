const Organization = require('../db/models/Organization');
const User = require('../db/models/User');
const OrgInvite = require('../db/models/OrgInvite');

const ADMIN_ROLES = new Set(['owner', 'admin']);

function canManageOrg(role) {
    return ADMIN_ROLES.has(String(role || ''));
}

function canManageMembers(role) {
    return ADMIN_ROLES.has(String(role || ''));
}

function serializeOrg(org) {
    if (!org) return null;
    const o = org.toObject ? org.toObject() : org;
    return {
        id: String(o._id),
        name: o.name,
        plan: o.plan || 'free',
        maxConcurrent: o.maxConcurrent ?? 5,
        featureFlags: Array.isArray(o.featureFlags) ? o.featureFlags : [],
        ownerUserId: o.ownerUserId ? String(o.ownerUserId) : null,
        createdAt: o.createdAt
    };
}

function serializeMember(user) {
    return {
        id: String(user._id),
        email: user.email,
        displayName: user.displayName || '',
        avatarUrl: user.avatarUrl || '',
        role: user.role || 'member',
        provider: user.provider || 'local',
        createdAt: user.createdAt
    };
}

async function createOrganizationForUser(user, name) {
    const orgName = String(name || '').trim() || `${user.displayName || user.email.split('@')[0]}'s Workspace`;
    const org = await Organization.create({
        name: orgName.slice(0, 80),
        ownerUserId: user._id,
        plan: 'free',
        featureFlags: []
    });
    user.orgId = org._id;
    user.role = 'owner';
    await user.save();
    return org;
}

async function ensureUserOrganization(user, fallbackName) {
    if (user.orgId) {
        const existing = await Organization.findById(user.orgId);
        if (existing) return existing;
    }
    return createOrganizationForUser(user, fallbackName);
}

async function getOrgMembers(orgId) {
    const users = await User.find({ orgId })
        .select('email displayName avatarUrl role provider createdAt')
        .sort({ role: 1, createdAt: 1 })
        .lean();
    return users.map(serializeMember);
}

async function listPendingInvites(orgId) {
    const invites = await OrgInvite.find({ orgId, status: 'pending', expiresAt: { $gt: new Date() } })
        .select('email role token expiresAt createdAt invitedBy')
        .sort({ createdAt: -1 })
        .lean();
    return invites.map((inv) => ({
        id: String(inv._id),
        email: inv.email,
        role: inv.role,
        token: inv.token,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
        invitedBy: inv.invitedBy ? String(inv.invitedBy) : null
    }));
}

module.exports = {
    canManageOrg,
    canManageMembers,
    serializeOrg,
    serializeMember,
    createOrganizationForUser,
    ensureUserOrganization,
    getOrgMembers,
    listPendingInvites
};
