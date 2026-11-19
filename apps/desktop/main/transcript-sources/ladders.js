const { SOURCES, PLATFORMS } = require('./constants');

function ladderFor(_platform, _opts = {}) {
    return [SOURCES.DOM_MONO];
}

function detectPlatform(meetingUrl) {
    const u = String(meetingUrl || '').toLowerCase();
    if (u.includes('meet.google')) return PLATFORMS.GMEET;
    if (u.includes('zoom.')) return PLATFORMS.ZOOM;
    if (u.includes('teams.microsoft') || u.includes('teams.live')) return PLATFORMS.TEAMS;
    return PLATFORMS.UNKNOWN;
}

module.exports = { ladderFor, detectPlatform };
