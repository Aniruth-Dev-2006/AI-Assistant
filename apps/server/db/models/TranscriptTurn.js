const mongoose = require('mongoose');

const transcriptTurnSchema = new mongoose.Schema({
    sessionId: { type: String, required: true },
    turnIndex: { type: Number, required: true },
    speaker: { type: String, required: true },
    speakerRole: { type: String, enum: ['candidate', 'panel', 'bot', null], default: null },
    text: { type: String, required: true },
    timestampMs: { type: Number, required: true },
    comments: [{
        text: { type: String, required: true },
        timestamp: { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now }
});

transcriptTurnSchema.index({ sessionId: 1, turnIndex: 1 });

module.exports = mongoose.model('TranscriptTurn', transcriptTurnSchema);
