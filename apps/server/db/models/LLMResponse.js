const mongoose = require('mongoose');

const llmResponseSchema = new mongoose.Schema({
    sessionId: { type: String, required: true },
    responseType: { type: String, enum: ['suggestion', 'takeover', 'todo_eval', 'report'], required: true },
    responseText: { type: String, required: true },
    model: String,
    tokensUsed: Number,
    latencyMs: Number,
    createdAt: { type: Date, default: Date.now }
});

llmResponseSchema.index({ sessionId: 1, createdAt: -1 });

module.exports = mongoose.model('LLMResponse', llmResponseSchema);
