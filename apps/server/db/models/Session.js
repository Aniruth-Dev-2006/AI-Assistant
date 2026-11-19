const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
    name: String,
    isCandidate: { type: Boolean, default: false },
    joinedAt: { type: Date, default: Date.now }
}, { _id: false });

const sessionSchema = new mongoose.Schema({
    meetingUrl: { type: String, required: true },
    meetingKey: { type: String, required: true }, // Normalized key for dedup
    platform: { type: String, enum: ['gmeet', 'zoom', 'teams'], required: true },
    status: { type: String, enum: ['pending', 'joining', 'active', 'completed', 'failed'], default: 'pending' },
    botName: { type: String, default: 'Xobin' },
    language: { type: String, default: 'multi' },
    candidateName: String,
    botLocation: { type: String, enum: ['cloud', 'local'], default: 'cloud' },
    workerId: String,
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    participants: [participantSchema],
    startedAt: Date,
    endedAt: Date,
    durationSecs: Number,
    interviewerNotes: { type: String, default: '' },
    title: { type: String, default: '' },
    jobRole: { type: String, default: '' },
    jobDescription: { type: String, default: '' },
    lastEvaluation: { type: mongoose.Schema.Types.Mixed, default: null },
    salesMode: { type: Boolean, default: false },
    hubspotContext: { type: mongoose.Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now }
});

// Enforce 1-bot-per-meeting via a partial unique index
sessionSchema.index(
    { meetingKey: 1 }, 
    { 
        unique: true, 
        partialFilterExpression: { status: { $in: ['pending', 'joining', 'active'] } },
        name: 'unique_active_meeting'
    }
);

sessionSchema.index({ orgId: 1, createdAt: -1 });
sessionSchema.index({ createdBy: 1 });
sessionSchema.index({ status: 1 });

module.exports = mongoose.model('Session', sessionSchema);
