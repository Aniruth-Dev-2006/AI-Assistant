const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    plan: { type: String, enum: ['free', 'pro', 'enterprise'], default: 'free' },
    maxConcurrent: { type: Number, default: 5 },
    featureFlags: { type: [String], default: [] },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
});

organizationSchema.index({ ownerUserId: 1 });

module.exports = mongoose.model('Organization', organizationSchema);
