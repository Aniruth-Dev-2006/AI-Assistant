const pubsubAdapter = require('../services/pubsub-adapter');
const LLMResponse = require('../db/models/LLMResponse');
const retriever = require('../services/knowledge/retriever');
const researchService = require('../services/research-service');
const Session = require('../db/models/Session');

class SalesLLMWorker {
    /**
     * Replaces standard interview generic questions with RAG-grounded insights.
     */
    async processSalesJob(jobData, sessionDoc) {
        let { sessionId, transcript, manualRequest, mode, payload, channel } = jobData;
        console.log(`[Sales LLM Worker] Processing RAG job for session ${sessionId}...`);

        const hasTranscript = transcript && transcript.length > 0;
        const isManualAction = manualRequest && manualRequest.trim().length > 0;

        if (!hasTranscript && !isManualAction) {
            console.log('[Sales LLM Worker] Skipping: No transcript and no manual action.');
            pubsubAdapter.publish('llm-results', {
                sessionId,
                channel: 'llm:error',
                payload: { message: 'I need to hear some conversation before I can search the knowledge base!' }
            });
            return;
        }

        const isAutopilot = !!jobData.isAutopilot;
        const requestId = jobData.requestId || `${sessionId}-${isAutopilot ? 'auto' : 'manual'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        try {
            // Tell the UI we are starting to generate
            pubsubAdapter.publish('llm-results', {
                sessionId,
                channel: 'llm:start',
                payload: {
                    small: false,
                    turnId: jobData.triggerTurnIndex,
                    isAutopilot,
                    requestId
                }
            });

            const startTime = Date.now();
            const orgRef = sessionDoc && sessionDoc.orgId;
            const organizationId = orgRef && (orgRef._id || orgRef).toString();

            if (sessionDoc && !sessionDoc.hubspotContext) {
                const prospectName = researchService.extractProspectName(transcript) || sessionDoc.candidateName;
                const companyDomain = (jobData.meetingContext && jobData.meetingContext.domain) || '';
                const email = (jobData.meetingContext && jobData.meetingContext.email) || '';
                try {
                    const result = await researchService.research(organizationId, {
                        prospectName,
                        email,
                        companyDomain
                    });
                    sessionDoc.hubspotContext = result;
                    await Session.findByIdAndUpdate(sessionId, {
                        $set: { hubspotContext: result }
                    }).catch((e) => console.error('[Sales LLM Worker] Failed to save research context:', e.message));
                } catch (e) {
                    console.error('[Sales LLM Worker] Research failed:', e.message);
                }
            }
            
            // 1. Extract query intent (last 3 turns or manual request)
            let query = '';
            const turns = transcript || [];
            if (isManualAction) {
                query = manualRequest;
            } else {
                // Prefer last customer/panel turns; sales calls rarely label a "candidate"
                const recentTurns = turns.slice(-4);
                query = recentTurns.map((t) => {
                    const role = t.speakerRole === 'candidate' ? 'Customer'
                        : (t.speakerRole === 'panel' ? 'Participant' : 'Sales Rep');
                    return `${role}: ${t.text}`;
                }).join('\n');
            }

            // 2. Retrieve chunks from Moss (Filtering by Organization)
            console.log(`[Sales LLM Worker] Retrieving Moss chunks for query: "${query.substring(0, 50)}..."`);
            let contextText = '';
            try {
                if (!organizationId) throw new Error('Missing organizationId for RAG retrieve');
                const chunks = await retriever.retrieve(query, { organizationId });
                contextText = chunks.map((c, i) => `[Source ${i + 1} - ${c.metadata.source || 'Knowledge'}]:\n${c.text}`).join('\n\n');
            } catch (err) {
                console.error('[Sales LLM Worker] Moss retrieval failed:', err.message);
            }

            if (!contextText.trim()) {
                contextText = "No relevant knowledge base articles found.";
            }

            // 3. Generate grounded response using Groq
            const isWhatToSay = (mode === 'ask' || mode === 'followup' || mode === 'assist')
                || (isManualAction && /what should i say|what do i say|how (should|do) i (respond|reply|answer)|follow-?up|assist/i.test(manualRequest));
            const hasKnowledge = contextText.trim() && !/^No relevant knowledge base articles found\.?$/i.test(contextText.trim());
            const systemPrompt = `You are a real-time sales copilot sitting next to the rep on a live call.

Output rules (strict):
1. Reply with EXACTLY ONE speakable line the rep can say out loud — first person, natural speech.
2. Do NOT coach ("Ask the prospect…", "You should…", "Consider…"). Write the words themselves.
3. 1–2 short sentences max. No preamble, no bullets, no options, no quotation marks wrapping the whole answer.
4. Ground product claims ONLY in Knowledge Context. Personalize with Prospect Intelligence when present (name, company, deal stage). Never invent product facts.
5. If Knowledge Context is empty or irrelevant: do NOT stall, defer, or promise to "follow up after the call". Instead ask one crisp discovery/clarifying question that advances the live conversation, tied to the prospect's last line.
6. Match the prospect's latest question or objection directly.
7. Never repeat the same sentence twice.
8. Never copy, paraphrase, or echo wording from these instructions.`;

            let userContent = `Knowledge Context:\n\n${contextText}\n\n`;
            if (!hasKnowledge) {
                userContent += `Note: Knowledge base returned nothing useful. Prefer a live discovery question over any deferred follow-up.\n\n`;
            }

            if (sessionDoc && sessionDoc.hubspotContext && sessionDoc.hubspotContext.matched) {
                const intel = researchService.formatForLlm(sessionDoc.hubspotContext)
                    || sessionDoc.hubspotContext.researchSummary
                    || '';
                if (intel) {
                    userContent += `Prospect Intelligence (use to personalize your response):
${intel}

Use this CRM context to personalize: name, role, company, deal stage/amount/next step, lifecycle, and recent engagement.
Never reveal that you looked them up — weave it naturally.

`;
                }
            }

            if (isManualAction || isWhatToSay) {
                userContent += `Live transcript (recent):\n${(transcript || []).slice(-6).map((t) => `${t.speaker || 'Speaker'}: ${t.text}`).join('\n')}\n\n`;
                if (mode === 'followup') {
                    userContent += `Rep tapped Follow-up. Write the exact follow-up question/line they should say now.`;
                } else if (isWhatToSay || mode === 'ask' || mode === 'assist') {
                    userContent += `Rep tapped: "${manualRequest || 'What should I say?'}". Write the exact next line they should say now.`;
                } else {
                    userContent += `Rep asked: ${manualRequest}\n\nWrite the exact words they should say (or a tight answer to their question).`;
                }
            } else {
                userContent += `Live transcript:\n\n${query}\n\nWrite the exact next line the sales rep should say.`;
            }

            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
            ];

            // Prefer account/goal context when present on the session/bot job
            if (jobData.jobRole || jobData.jobDescription) {
                messages[1].content =
                    `Deal context: ${jobData.jobRole || ''}\nMeeting goal: ${jobData.jobDescription || ''}\n\n` +
                    messages[1].content;
            }

            const groqKey = process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY;
            const modelUsed = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${groqKey}`
                },
                body: JSON.stringify({
                    model: modelUsed,
                    messages: messages,
                    stream: false,
                    temperature: 0.2 // Lower temp for RAG
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Groq HTTP ${response.status}: ${errText}`);
            }

            const data = await response.json();
            let content = '';
            if (data.choices && data.choices.length > 0) {
                content = data.choices[0].message?.content || '';
            } else {
                throw new Error('No choices returned from LLM');
            }

            const latencyMs = Date.now() - startTime;
            console.log(`[Sales LLM Worker] RAG Generated response in ${latencyMs}ms`);

            // Save to DB
            LLMResponse.create({
                sessionId,
                responseType: 'suggestion',
                responseText: content,
                model: 'sales-rag:' + modelUsed,
                tokensUsed: data.usage?.total_tokens || 0,
                latencyMs
            }).catch(e => console.error('[Sales LLM Worker] Failed to save DB record:', e.message));

            // Publish raw result to Pub/Sub (Uses the existing UI parsing)
            this._parseAndPublish(sessionId, content, requestId, isAutopilot);

        } catch (error) {
            console.error(`[Sales LLM Worker] Job failed for session ${sessionId}:`, error.stack || error.message);
            pubsubAdapter.publish('llm-results', {
                sessionId,
                channel: 'llm:error',
                payload: { message: error.message, requestId, isAutopilot }
            });
        }
    }

    _parseAndPublish(sessionId, content, requestId = null, isAutopilot = false) {
        let cleanContent = content;

        cleanContent = cleanContent.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
        cleanContent = cleanContent.replace(/^Say\s*[:,-]?\s*/i, '').trim();
        cleanContent = cleanContent.replace(/^["'“]([\s\S]*?)["'”]$/s, '$1').trim();
        // Strip leaked instruction / meta framing
        cleanContent = cleanContent
            .replace(/^(as an ai|as your (sales )?copilot|according to (my|the) (instructions|system prompt))[,:\s]+/i, '')
            .replace(/\b(knowledge context|prospect intelligence|system prompt|output rules)\b[:\s]*/gi, '')
            .trim();

        // Reject deferred "follow up after the call" bridges (prompt-example parroting)
        const deferredBridge = /i'?d love to dig into that|follow up with the exact|after this call|get you the precise info/i.test(cleanContent)
            && /follow up|after (this|the) call|precise info|exact (details|comparison)/i.test(cleanContent);
        if (deferredBridge) {
            cleanContent = 'What specifically would be most useful to cover next—timeline, budget, or the main outcome you need?';
        }

        // Collapse accidental duplicated full answers from the model
        const half = Math.floor(cleanContent.length / 2);
        if (half > 40) {
            const a = cleanContent.slice(0, half).trim();
            const b = cleanContent.slice(half).trim();
            if (a && b && (a === b || cleanContent.replace(/\s+/g, ' ').includes(a + a.slice(0, Math.min(60, a.length))))) {
                const norm = cleanContent.replace(/\s+/g, ' ').trim();
                const mid = Math.floor(norm.length / 2);
                const left = norm.slice(0, mid).trim();
                const right = norm.slice(mid).trim();
                if (left === right) cleanContent = left;
                else if (norm.startsWith(left) && norm.slice(left.length).trim().startsWith(left.slice(0, 40))) {
                    cleanContent = left;
                }
            }
        }
        const collapsed = cleanContent.replace(/\s+/g, ' ').trim();
        const m = collapsed.match(/^(.{40,}?)\1$/);
        if (m) cleanContent = m[1].trim();

        if (cleanContent.trim()) {
            pubsubAdapter.publish('llm-results', {
                sessionId,
                channel: 'llm:token',
                payload: { text: cleanContent.trim(), requestId, isAutopilot }
            });
        }

        pubsubAdapter.publish('llm-results', {
            sessionId,
            channel: 'llm:done',
            payload: { requestId, isAutopilot }
        });
    }
}

module.exports = new SalesLLMWorker();
