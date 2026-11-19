const mongoose = require('mongoose');

const knowledgeDocumentSchema = new mongoose.Schema({
    title: { type: String, required: true },
    category: { type: String, default: 'general' },
    rawContent: { type: String, required: true },
    chunkCount: { type: Number, default: 0 },
    source: { type: String }, // e.g., filename or URL
    status: { type: String, enum: ['active', 'draft', 'archived'], default: 'active' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Update the updatedAt field before saving
knowledgeDocumentSchema.pre('save', function() {
    this.updatedAt = Date.now();
});

module.exports = mongoose.model('KnowledgeDocument', knowledgeDocumentSchema);
