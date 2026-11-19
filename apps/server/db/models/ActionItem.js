const mongoose = require('mongoose');

const actionItemSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, index: true },
    text: { type: String, required: true },
    status: { type: String, enum: ['pending', 'done'], default: 'pending' },
    source: { type: String, enum: ['auto', 'manual'], default: 'auto' },
    createdAt: { type: Date, default: Date.now }
});

actionItemSchema.index({ sessionId: 1, createdAt: 1 });

module.exports = mongoose.model('ActionItem', actionItemSchema);
