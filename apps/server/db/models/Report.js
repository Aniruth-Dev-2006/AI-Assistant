const mongoose = require('mongoose');

const reportActionSchema = new mongoose.Schema({
    id: String,
    text: String,
    done: { type: Boolean, default: false }
}, { _id: false });

const reportSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
    title: String,
    candidateName: String,
    jobRole: String,
    platform: String,
    meetingUrl: String,
    startedAt: Date,
    endedAt: Date,
    durationSecs: Number,
    participants: [String],
    status: {
        type: String,
        enum: ['pending', 'generating', 'ready', 'failed'],
        default: 'pending'
    },
    error: { type: String, default: '' },
    model: String,
    promptVersion: { type: String, default: 'report-v2' },
    generatedAt: Date,
    htmlContent: String,
    summary: String,
    recommendation: { type: String, enum: ['hire', 'maybe', 'pass'] },
    recommendationText: String,
    salesMode: { type: Boolean, default: false },
    overallScore: Number,
    totalScore: Number,
    maxScore: { type: Number, default: 100 },
    verifiedSkills: [String],
    strengths: [String],
    concerns: [String],
    actionItems: [reportActionSchema],
    topics: [String],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

reportSchema.index({ userId: 1, generatedAt: -1 });
reportSchema.index({ orgId: 1, generatedAt: -1 });
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ candidateName: 'text', title: 'text', jobRole: 'text', summary: 'text' });

module.exports = mongoose.model('Report', reportSchema);
