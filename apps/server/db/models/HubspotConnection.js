const mongoose = require('mongoose');

const hubspotConnectionSchema = new mongoose.Schema({
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, unique: true },
    accessToken: { type: String, required: true },
    refreshToken: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    hubId: { type: Number },
    connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    scopes: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

hubspotConnectionSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('HubspotConnection', hubspotConnectionSchema);
