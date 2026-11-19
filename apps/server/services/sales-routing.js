async function resolveSalesRouting(sessionId, jobData = {}) {
    const { resolveMongoSessionId } = require('./session-ids');
    const Session = require('../db/models/Session');
    const User = require('../db/models/User');
    const Organization = require('../db/models/Organization');

    const mongoId = resolveMongoSessionId(sessionId) || (String(sessionId).length === 24 ? sessionId : null);
    let sessionDoc = null;
    if (mongoId) {
        sessionDoc = await Session.findById(mongoId).populate('createdBy').populate('orgId');
    }

    let user = sessionDoc?.createdBy || null;
    let org = sessionDoc?.orgId || null;

    const bot = (() => {
        if (!global.activeBots || global.activeBots.size === 0) return null;
        if (global.activeBots.has(sessionId)) return global.activeBots.get(sessionId);
        for (const mgr of global.activeBots.values()) {
            if (mgr && String(mgr.mongoSessionId) === String(mongoId || '')) return mgr;
            if (mgr && (mgr.isRecording || mgr.isStarting)) return mgr;
        }
        return null;
    })();

    const userId =
        (user && user._id) ||
        jobData.userId ||
        (bot && bot.ownerUserId) ||
        null;
    const orgId =
        (org && org._id) ||
        jobData.orgId ||
        (bot && bot.ownerOrgId) ||
        (user && user.orgId) ||
        null;

    if (!user && userId) {
        user = await User.findById(userId);
    }
    if (!org && orgId) {
        org = await Organization.findById(orgId);
    }
    if (!org && user?.orgId) {
        org = await Organization.findById(user.orgId);
    }

    // Keep session ownership in sync for future turns / reports
    if (sessionDoc) {
        const patch = {};
        if (!sessionDoc.createdBy && userId) patch.createdBy = userId;
        if (!sessionDoc.orgId && (org?._id || orgId)) patch.orgId = org?._id || orgId;
        if (Object.keys(patch).length) {
            Session.findByIdAndUpdate(sessionDoc._id, { $set: patch }).catch(() => {});
            if (patch.createdBy) sessionDoc.createdBy = user;
            if (patch.orgId) sessionDoc.orgId = org;
        }
    }

    const orgSalesEnabled = !!(org && Array.isArray(org.featureFlags) && org.featureFlags.includes('salesMode'));
    const userSalesActive = !!(
        (user && user.salesModeActive) ||
        (bot && bot.salesModeActive) ||
        jobData.salesMode === true
    );

    let hubspotConnected = false;
    if (org && org._id) {
        const HubspotConnection = require('../db/models/HubspotConnection');
        hubspotConnected = !!(process.env.HUBSPOT_API_KEY || (await HubspotConnection.exists({ orgId: org._id })));
    }

    return {
        enabled: orgSalesEnabled && userSalesActive,
        sessionDoc,
        user,
        org,
        orgSalesEnabled,
        userSalesActive,
        hubspotConnected,
        reason: !orgSalesEnabled
            ? 'org salesMode flag off or missing org'
            : (!userSalesActive ? 'user salesModeActive is false' : 'ok')
    };
}

module.exports = { resolveSalesRouting };
