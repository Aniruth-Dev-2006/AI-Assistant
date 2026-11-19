const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    displayName: String,
    avatarUrl: String,
    provider: {
        type: String,
        enum: ['local', 'google', 'microsoft', 'zoom'],
        default: 'local',
        required: true
    },
    providerId: { type: String, required: true },
    passwordHash: { type: String, select: false },
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
    role: { type: String, enum: ['owner', 'admin', 'member'], default: 'member' },
    preferredLanguage: { type: String, default: 'multi' },
    botDisplayName: { type: String, default: 'Xobin' },
    salesModeActive: { type: Boolean, default: false },
    refreshToken: String,
    createdAt: { type: Date, default: Date.now }
});

userSchema.index({ orgId: 1 });
userSchema.index({ provider: 1, providerId: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);
