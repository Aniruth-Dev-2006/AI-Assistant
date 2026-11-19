/**
 * Structure-aware chunking for Knowledge Base documents.
 * Instead of just splitting by token count, this attempts to keep Markdown headings and their content together.
 */

class Chunker {
    constructor(options = {}) {
        this.maxChunkSize = options.maxChunkSize || 1500; // characters
        this.overlap = options.overlap || 200;
    }

    /**
     * Chunks markdown content by headings, falling back to paragraphs if sections are too large.
     * @param {string} text 
     * @param {object} metadata Base metadata to attach to all chunks
     * @returns {Array<{text: string, metadata: object}>}
     */
    chunkMarkdown(text, metadata = {}) {
        const chunks = [];
        // Split roughly by headings H1-H3
        const sections = text.split(/(?=\n#{1,3}\s)/g).map(s => s.trim()).filter(Boolean);

        for (const section of sections) {
            if (section.length <= this.maxChunkSize) {
                chunks.push({ text: section, metadata: { ...metadata } });
            } else {
                // If a section is too long, split by paragraphs
                const paragraphs = section.split(/\n\s*\n/).filter(Boolean);
                let currentChunk = '';

                for (const p of paragraphs) {
                    if ((currentChunk.length + p.length) > this.maxChunkSize && currentChunk.length > 0) {
                        chunks.push({ text: currentChunk.trim(), metadata: { ...metadata } });
                        currentChunk = p;
                    } else {
                        currentChunk += (currentChunk.length ? '\n\n' : '') + p;
                    }
                }
                
                if (currentChunk.length > 0) {
                    chunks.push({ text: currentChunk.trim(), metadata: { ...metadata } });
                }
            }
        }

        return chunks;
    }
}

module.exports = new Chunker();
