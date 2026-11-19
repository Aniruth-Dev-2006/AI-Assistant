const mongoose = require('mongoose');
const crypto = require('crypto');

const orgInviteSchema = new mongoose.Schema({
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
    token: { type: String, required: true, unique: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'revoked', 'expired'], default: 'pending' },
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now }
});

orgInviteSchema.index({ orgId: 1, email: 1, status: 1 });

orgInviteSchema.statics.createToken = function () {
    return crypto.randomBytes(24).toString('hex');
};

module.exports = mongoose.model('OrgInvite', orgInviteSchema);
