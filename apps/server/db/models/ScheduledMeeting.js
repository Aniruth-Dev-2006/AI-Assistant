const mongoose = require('mongoose');

const scheduledMeetingSchema = new mongoose.Schema({
    calendarConnectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'CalendarConnection', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
    externalId: { type: String, required: true }, // Event ID from provider
    title: { type: String },
    meetingUrl: { type: String }, // The join URL for the bot
    platform: { type: String, enum: ['gmeet', 'zoom', 'teams', 'unknown'] },
    startTime: { type: Date, required: true },
    endTime: { type: Date },
    participants: [{ name: String, email: String, self: Boolean }],
    organizerName: { type: String },
    organizerEmail: { type: String },
    candidateName: { type: String },
    jobRole: { type: String }, // Extracted role from title/summary
    jobDescription: { type: String }, // Extracted description
    botStatus: { 
        type: String, 
        enum: ['pending', 'scheduled', 'joining', 'joined', 'skipped', 'failed', 'cancelled'], 
        default: 'pending' 
    },
    sessionId: { type: String }, // Linked session once bot joins
    autoJoin: { type: Boolean, default: true }, // User can toggle per-meeting
    botJoinedAt: { type: Date },
    failReason: { type: String },
    preMeetingBrief: { type: mongoose.Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

scheduledMeetingSchema.index(
    { calendarConnectionId: 1, externalId: 1 }, 
    { unique: true } // Prevent duplicate entries for same external event
);
scheduledMeetingSchema.index({ startTime: 1, botStatus: 1 }); // Scheduler query index

module.exports = mongoose.model('ScheduledMeeting', scheduledMeetingSchema);
