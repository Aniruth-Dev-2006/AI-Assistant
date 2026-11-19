const jwt = require('jsonwebtoken');

const requireAuth = (req, res, next) => {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
        token = String(req.query.token);
    }

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        req.authToken = token;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Unauthorized: Token expired or invalid' });
    }
};

module.exports = requireAuth;
