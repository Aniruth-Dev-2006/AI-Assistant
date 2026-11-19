const mongoose = require('mongoose');

const calendarConnectionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
    provider: { type: String, enum: ['google', 'microsoft', 'zoom'], required: true },
    providerEmail: { type: String }, // Email of the connected calendar account
    accessToken: { type: String, required: true },
    refreshToken: { type: String }, 
    tokenExpiry: { type: Date }, // When accessToken expires
    enabled: { type: Boolean, default: true },
    
    // V2: webhook channel tracking
    webhookChannelId: { type: String },
    webhookExpiry: { type: Date },
    
    // Sync state
    lastSyncAt: { type: Date },
    lastSyncError: { type: String },
    createdAt: { type: Date, default: Date.now }
});

// Ensure a user can only have one connection per provider
calendarConnectionSchema.index({ userId: 1, provider: 1 }, { unique: true });

module.exports = mongoose.model('CalendarConnection', calendarConnectionSchema);
