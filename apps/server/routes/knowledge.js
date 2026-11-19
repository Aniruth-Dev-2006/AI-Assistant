const express = require('express');
const router = express.Router();
const multer = require('multer');
const requireAuth = require('../middleware/auth');
const User = require('../db/models/User');
const KnowledgeDocument = require('../db/models/KnowledgeDocument');
const chunker = require('../services/knowledge/chunker');
const retriever = require('../services/knowledge/retriever');
const pdfParse = require('pdf-parse');

// Use memory storage for fast processing of small docs
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB limit

// Ensure user has Sales Mode feature flag enabled
const requireSalesOrg = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.userId).populate('orgId');
        if (!user || !user.orgId || !user.orgId.featureFlags.includes('salesMode')) {
            return res.status(403).json({ error: 'Sales Mode not enabled for this organization' });
        }
        req.orgId = user.orgId._id.toString();
        next();
    } catch (e) {
        res.status(500).json({ error: 'Authorization error' });
    }
};

router.use(requireAuth);
router.use(requireSalesOrg);

// List all documents for the org
router.get('/', async (req, res) => {
    try {
        const docs = await KnowledgeDocument.find({ organizationId: req.user.orgId }).sort({ createdAt: -1 });
        res.json(docs);
    } catch (e) {
        console.error('[Knowledge API] GET error:', e);
        res.status(500).json({ error: 'Failed to fetch knowledge documents' });
    }
});

// Upload and process a new document
router.post('/', upload.single('file'), async (req, res) => {
    try {
        const { title, description } = req.body;
        if (!req.file && !req.body.text) {
            return res.status(400).json({ error: 'No file or text provided' });
        }

        let content = req.body.text || '';
        let originalFilename = 'Pasted Text';
        
        if (req.file) {
            originalFilename = req.file.originalname;
            const isPdf = originalFilename.toLowerCase().endsWith('.pdf') || 
                          req.file.mimetype === 'application/pdf' || 
                          req.file.buffer.toString('utf-8', 0, 4) === '%PDF';
            
            if (isPdf) {
                try {
                    const pdfData = await pdfParse(req.file.buffer);
                    content = pdfData.text;
                } catch (err) {
                    console.error('[Knowledge API] PDF parse error:', err);
                    return res.status(400).json({ error: 'Failed to parse PDF document.' });
                }
            } else {
                content = req.file.buffer.toString('utf-8');
            }
        }

        if (!content.trim()) {
            return res.status(400).json({ error: 'Document is empty' });
        }

        // 1. Chunk the document
        console.log(`[Knowledge API] Chunking document "${title || originalFilename}"...`);
        const chunks = chunker.chunkMarkdown(content, { maxTokens: 400 });
        
        // 2. Save metadata to MongoDB
        const doc = await KnowledgeDocument.create({
            title: title || originalFilename,
            category: 'general',
            rawContent: content,
            chunkCount: chunks.length,
            source: req.file ? originalFilename : 'Pasted Text',
            status: 'active',
            createdBy: req.user.userId,
            organizationId: req.user.orgId
        });

        // 3. Upsert to Moss asynchronously
        setTimeout(async () => {
            try {
                const chunksToStore = [];
                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    chunksToStore.push({
                        text: chunk.text,
                        metadata: {
                            documentId: doc._id.toString(),
                            organizationId: req.user.orgId,
                            source: doc.title,
                            chunkIndex: i
                        }
                    });
                }
                
                await retriever.store(chunksToStore);
                await KnowledgeDocument.findByIdAndUpdate(doc._id, { status: 'active' });
                console.log(`[Knowledge API] Successfully activated document ${doc._id} with ${chunks.length} chunks.`);
            } catch (err) {
                console.error(`[Knowledge API] Failed to process document ${doc._id}:`, err);
                await KnowledgeDocument.findByIdAndUpdate(doc._id, { status: 'failed', 'metadata.error': err.message });
            }
        }, 0);

        res.status(201).json(doc);
    } catch (e) {
        console.error('[Knowledge API] POST error:', e);
        res.status(500).json({ error: 'Failed to upload document' });
    }
});

// Delete a document
router.delete('/:id', async (req, res) => {
    try {
        const doc = await KnowledgeDocument.findOne({ _id: req.params.id, organizationId: req.user.orgId });
        if (!doc) {
            return res.status(404).json({ error: 'Document not found' });
        }

        // 1. Remove from Moss
        console.log(`[Knowledge API] Deleting document ${doc._id} from Moss...`);
        // We will implement vector deletion from moss later when moss supports it
        // For now, it's an in-memory store so it will clear on restart anyway.

        // 2. Remove from DB
        await KnowledgeDocument.findByIdAndDelete(doc._id);
        
        res.json({ success: true });
    } catch (e) {
        console.error('[Knowledge API] DELETE error:', e);
        res.status(500).json({ error: 'Failed to delete document' });
    }
});

module.exports = router;
