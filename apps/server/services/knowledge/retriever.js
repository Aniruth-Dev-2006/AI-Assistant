const MossClient = require('./moss-client');
const moss = new MossClient();

/**
 * Helper to fetch embeddings using OpenAI API directly via fetch
 * Requires OPENAI_API_KEY in environment variables.
 */
async function generateEmbedding(text) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.warn("[Knowledge API] OPENAI_API_KEY missing. Falling back to dummy vectors (Groq does not provide embedding models). Retrieval accuracy will be random.");
        // Generate a pseudo-random deterministic vector of length 1536
        const dummyVector = new Array(1536).fill(0).map((_, i) => Math.sin(text.length + i));
        return dummyVector;
    }

    const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: text
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenAI Embedding Error: ${err}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
}



class Retriever {
    /**
     * Retrieve chunks relevant to the query
     * @param {string} query 
     * @param {object} filter 
     * @returns {Promise<Array<{text, metadata, score}>>}
     */
    async retrieve(query, filter = {}) {
        // 1. Generate query embedding
        const queryVector = await generateEmbedding(query);

        // 2. Query Moss
        const results = await moss.search(queryVector, { filter, topK: 5 });
        return results;
    }
    
    /**
     * Store new chunks into the Moss vector db
     * @param {Array<{text, metadata}>} chunks 
     */
    async store(chunks) {
        const vectorsToInsert = [];
        for (const chunk of chunks) {
            const vector = await generateEmbedding(chunk.text);
            vectorsToInsert.push({
                text: chunk.text,
                vector: vector,
                metadata: chunk.metadata
            });
        }
        await moss.insert(vectorsToInsert);
    }
}

module.exports = new Retriever();
