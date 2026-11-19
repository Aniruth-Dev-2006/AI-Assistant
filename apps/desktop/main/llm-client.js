const http = require('http');

class LLMClient {
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.host = process.env.OLLAMA_HOST || '127.0.0.1';
        this.port = process.env.OLLAMA_PORT || 11434;
        this.path = '/v1/chat/completions';

        this.isGenerating = false;
        this.hasPendingRequest = false;
        this.pendingTranscript = null;
        this.pendingTodos = null;
        this.pendingInstruction = null;
    }

    async generateSuggestions(transcriptBuffer, todos, forceInstruction = null) {
        if (!this.mainWindow) return;

        if (this.isGenerating) {
            this.hasPendingRequest = true;
            this.pendingTranscript = [...transcriptBuffer];
            this.pendingTodos = [...todos];
            this.pendingInstruction = forceInstruction;
            return;
        }

        this.isGenerating = true;
        this.hasPendingRequest = false;

        let systemPrompt = `You are an elite AI Interview Assistant. Your goal is to analyze the ongoing interview transcript in real-time and tell the interviewer exactly what to say next.

Strict Output Formatting Rules:
1. OUTPUT EXACTLY ONE short suggestion the interviewer can speak aloud (1-2 sentences max).
2. NEVER OUTPUT PREAMBLE, INTRODUCTIONS, EXPLANATIONS, COMMENTARY, NUMBERED LISTS, OR MULTIPLE OPTIONS.
   - NEVER say "Here are a few follow-up questions you could ask:", "Based on the transcript...", or list options.
   - Do NOT start with "Say", labels, quotes-as-format, or bullet lists.
   - Begin immediately with the spoken line itself.
3. If the transcript is casual, greeting, or unclear, provide a polite, natural interview opening or icebreaker question directly.
4. If the user is asking YOU an informational question (e.g., "what role are we hiring for?", "summarize the interview"), answer them directly and concisely.
5. Keep suggestions short, natural to speak aloud, and punchy (1-2 sentences max).`;

        if (forceInstruction) {
            systemPrompt = `You are an autonomous AI Interview Agent.
The interviewer has explicitly triggered a TAKEOVER. You MUST formulate a question to ask the candidate directly based on the user's instruction.

CRITICAL RULES:
1. You MUST respond with EXACTLY ONE marker and absolutely NOTHING ELSE.
2. Format: [TAKEOVER_REQUEST: <question> : <reason>]
3. DO NOT output any bullet points, follow-up suggestions, or conversational filler.
4. The question MUST be natural and spoken directly to the candidate.

Example Output:
[TAKEOVER_REQUEST: Can you explain how you designed the database schema? : To evaluate system design skills]`;
        }
        let transcriptText = transcriptBuffer.map(t => `${t.speaker}: ${t.text}`).join('\n');

        /* TODO Logic Commented Out
        let todoSection = '';
        if (todos && todos.length > 0) {
            todoSection = '\n\nActive evaluation items:\n' + todos.map(t => {
                const scoreInfo = t.maxScore ? ` (score out of ${t.maxScore})` : '';
                return `- [ID:${t.id}] [${t.status}] ${t.text}${scoreInfo}${t.note ? ' | Note: ' + t.note : ''}`;
            }).join('\n');
        }
        */

        let userContent = '';
        if (transcriptText.trim()) {
            userContent += `Here is the live transcript so far:\n\n${transcriptText}\n\n`;
        } else {
            userContent += `No transcript is available yet.\n\n`;
        }
        if (forceInstruction) {
            userContent += `${forceInstruction}\n\nPlease respond directly to the request above.`;
        } else if (todos && todos.length > 0) {
            userContent += `Please suggest the next questions and evaluate any applicable todo items.`;
        } else {
            userContent += `Please suggest the best next interview question based on the transcript and context.`;
        }

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
        ];

        this.mainWindow.webContents.send('llm:start', { small: false });

        try {
            let data;
            try {
                console.log('[LLM] Sending request to Ollama at', `http://${this.host}:${this.port}${this.path}`);
                const ollamaRes = await fetch(`http://${this.host}:${this.port}${this.path}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'qwen2.5-coder-7b-instruct',
                        messages: messages,
                        stream: false,
                        temperature: 0.7
                    })
                });
                if (!ollamaRes.ok) throw new Error(`Ollama HTTP ${ollamaRes.status}`);
                data = await ollamaRes.json();
            } catch (ollamaErr) {
                console.warn('[LLM] Ollama failed:', ollamaErr.message, '- falling back to Groq');

                const groqKeys = [
                    process.env.GROQ_API_KEY_1,
                    process.env.GROQ_API_KEY_2,
                    process.env.GROQ_API_KEY_3
                ].filter(k => !!k);

                if (groqKeys.length === 0) {
                    throw new Error('Ollama failed and no Groq fallback keys available');
                }

                if (typeof this.currentGroqIndex !== 'number') this.currentGroqIndex = 0;
                const groqKey = groqKeys[this.currentGroqIndex];
                this.currentGroqIndex = (this.currentGroqIndex + 1) % groqKeys.length;

                console.log(`[LLM] Using Groq fallback (Key Index: ${this.currentGroqIndex})`);
                const modelToUse = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
                const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${groqKey}`
                    },
                    body: JSON.stringify({
                        model: modelToUse,
                        messages: messages,
                        stream: false,
                        temperature: 0.7
                    })
                });

                if (!groqRes.ok) {
                    const errText = await groqRes.text();
                    throw new Error(`Groq HTTP ${groqRes.status}: ${errText}`);
                }
                data = await groqRes.json();
            }

            if (data.error) {
                console.error('[LLM] API error:', data.error);
                this.mainWindow.webContents.send('llm:error', { message: data.error.message || JSON.stringify(data.error) });
                return;
            }

            if (data.choices && data.choices.length > 0) {
                let content = data.choices[0].message?.content || '';

                if (content) {
                    // Parse and strip TODO_EVAL markers
                    const evalRegex = /\[TODO_EVAL:(\d+):(\w+):(\d+):([^\]]+)\]/g;
                    let evalMatch;
                    while ((evalMatch = evalRegex.exec(content)) !== null) {
                        const evalData = {
                            id: parseInt(evalMatch[1]),
                            status: evalMatch[2],
                            score: parseInt(evalMatch[3]),
                            note: evalMatch[4]
                        };
                        console.log('[LLM] Todo evaluation:', evalData);
                        this.mainWindow.webContents.send('todo:evaluated', evalData);
                    }
                    content = content.replace(evalRegex, '').trim();

                    // Parse and strip TODO_CREATE markers
                    const createRegex = /\[TODO_CREATE:([^\]]+)\]/g;
                    let createMatch;
                    while ((createMatch = createRegex.exec(content)) !== null) {
                        console.log('[LLM] Agent creating todo:', createMatch[1]);
                        this.mainWindow.webContents.send('todo:agent-create', { text: createMatch[1].trim() });
                    }
                    content = content.replace(createRegex, '').trim();

                    // Parse and strip TAKEOVER_REQUEST markers
                    const takeoverRegex = /\[TAKEOVER_REQUEST:\s*(.*?)\s*:\s*(.*?)\s*\]/g;
                    let takeoverMatch;
                    while ((takeoverMatch = takeoverRegex.exec(content)) !== null) {
                        console.log('[LLM] Agent requests takeover:', takeoverMatch[1]);
                        this.mainWindow.webContents.send('agent:request-takeover', {
                            question: takeoverMatch[1].trim(),
                            reason: takeoverMatch[2].trim()
                        });
                    }
                    content = content.replace(takeoverRegex, '').trim();
                    content = content.replace(/^Say\s+/i, '').replace(/^["“]([\s\S]*)["”]$/, '$1').trim();

                    // Send cleaned response to UI
                    this.mainWindow.webContents.send('llm:token', { text: content });
                    this.mainWindow.webContents.send('llm:done');
                } else {
                    this.mainWindow.webContents.send('llm:error', { message: 'LLM returned empty content' });
                }
            } else {
                console.error('[LLM] No choices in response:', JSON.stringify(data).substring(0, 300));
                this.mainWindow.webContents.send('llm:error', { message: 'No response from LLM' });
            }
        } catch (e) {
            console.error('[LLM] Request failed:', e.message);
            this.mainWindow.webContents.send('llm:error', { message: 'Cannot connect to LLM: ' + e.message });
        } finally {
            this.isGenerating = false;
            if (this.hasPendingRequest) {
                this.generateSuggestions(this.pendingTranscript, this.pendingTodos, this.pendingInstruction);
            }
        }
    }
}

module.exports = LLMClient;
