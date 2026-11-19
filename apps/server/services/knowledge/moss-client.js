const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * MossClient - An in-process Vector Store for Node.js
 * Implements basic hybrid search (Dense Semantic + BM25 placeholder)
 */
class MossClient {
    constructor(options = {}) {
        this.storagePath = options.storagePath || path.join(__dirname, '../../../../data/moss-vectors.json');
        this.embeddingModel = options.embeddingModel || 'openai/text-embedding-3-small';
        this.hybridSearch = options.hybridSearch !== undefined ? options.hybridSearch : true;
        
        this.vectors = [];
        this.load();
    }

    /**
     * Load vectors from disk
     */
    load() {
        try {
            if (fs.existsSync(this.storagePath)) {
                const data = fs.readFileSync(this.storagePath, 'utf8');
                this.vectors = JSON.parse(data);
                console.log(`[Moss] Loaded ${this.vectors.length} vectors from disk.`);
            } else {
                // Ensure directory exists
                const dir = path.dirname(this.storagePath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
            }
        } catch (error) {
            console.error(`[Moss] Failed to load vectors from ${this.storagePath}:`, error.message);
            this.vectors = [];
        }
    }

    /**
     * Save vectors to disk
     */
    save() {
        try {
            fs.writeFileSync(this.storagePath, JSON.stringify(this.vectors, null, 2));
        } catch (error) {
            console.error(`[Moss] Failed to save vectors to ${this.storagePath}:`, error.message);
        }
    }

    /**
     * Compute cosine similarity between two vectors
     */
    cosineSimilarity(vecA, vecB) {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Insert chunks into Moss
     * @param {Array<{id: string, text: string, vector: number[], metadata: object}>} chunks 
     */
    async insert(chunks) {
        for (const chunk of chunks) {
            // Upsert based on ID
            const existingIndex = this.vectors.findIndex(v => v.id === chunk.id);
            if (existingIndex >= 0) {
                this.vectors[existingIndex] = chunk;
            } else {
                this.vectors.push({
                    id: chunk.id || crypto.randomUUID(),
                    text: chunk.text,
                    vector: chunk.vector,
                    metadata: chunk.metadata || {}
                });
            }
        }
        this.save();
        console.log(`[Moss] Inserted ${chunks.length} chunks. Total: ${this.vectors.length}`);
    }

    /**
     * Search Moss for top-k matches
     * @param {number[]} queryVector 
     * @param {object} options 
     * @returns {Array<{id, text, metadata, score}>}
     */
    async search(queryVector, options = {}) {
        const topK = options.topK || 5;
        const filter = options.filter || {}; // basic exact match filtering

        // 1. Filter
        let candidates = this.vectors;
        if (Object.keys(filter).length > 0) {
            candidates = candidates.filter(vec => {
                for (const [key, value] of Object.entries(filter)) {
                    if (vec.metadata[key] !== value) return false;
                }
                return true;
            });
        }

        // 2. Score (Dense)
        const scored = candidates.map(vec => {
            const score = this.cosineSimilarity(queryVector, vec.vector);
            return {
                id: vec.id,
                text: vec.text,
                metadata: vec.metadata,
                score
            };
        });

        // 3. Sort & Return topK
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK);
    }
}

module.exports = MossClient;
