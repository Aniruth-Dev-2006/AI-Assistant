const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const KEYLEN = 64;

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = await scrypt(String(password), salt, KEYLEN);
    return `${salt}:${derived.toString('hex')}`;
}

async function verifyPassword(password, stored) {
    if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const derived = await scrypt(String(password), salt, KEYLEN);
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(derived.toString('hex'), 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function assertPasswordStrength(password) {
    const p = String(password || '');
    if (p.length < 8) return 'Password must be at least 8 characters';
    if (p.length > 128) return 'Password is too long';
    return null;
}

module.exports = { hashPassword, verifyPassword, assertPasswordStrength };
