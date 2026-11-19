function isMongoSessionId(sessionId) {
    return typeof sessionId === 'string' && /^[a-fA-F0-9]{24}$/.test(sessionId);
}

function resolveMongoSessionId(sessionId) {
    if (isMongoSessionId(sessionId)) return sessionId;
    const bot = global.activeBots && global.activeBots.get(sessionId);
    if (bot && isMongoSessionId(bot.mongoSessionId)) return String(bot.mongoSessionId);
    if (global.activeBots) {
        for (const manager of global.activeBots.values()) {
            if (manager && isMongoSessionId(manager.mongoSessionId)) {
                return String(manager.mongoSessionId);
            }
        }
    }
    return null;
}

function optionalAuthUser(req) {
    const header = req.headers && req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return null;
    try {
        const jwt = require('jsonwebtoken');
        return jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    } catch (e) {
        return null;
    }
}

module.exports = { isMongoSessionId, resolveMongoSessionId, optionalAuthUser };
