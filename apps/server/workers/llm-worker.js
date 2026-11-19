                                                                                                                                                                                                                                            const pubsubAdapter = require('../services/pubsub-adapter');
const LLMResponse = require('../db/models/LLMResponse');

class LLMWorker {
    async processJob(jobData) {
        let { sessionId, transcript, todos, manualRequest, mode, payload, channel, jobRole, jobDescription } = jobData;
        console.log(`[LLM Worker] Processing job for session ${sessionId}...`);
        console.log(`[LLM Worker] Transcript turns: ${(transcript || []).length}, Manual request: ${manualRequest ? 'yes' : 'no'}, Channel: ${channel || 'ask'}`);

        if ((!jobRole || !jobDescription) && global.activeBots && global.activeBots.has(sessionId)) {
            const bot = global.activeBots.get(sessionId);
            jobRole = jobRole || bot.jobRole || '';
            jobDescription = jobDescription || bot.jobDescription || '';
        }

        // Check if this session should be routed to the Sales RAG Worker
        try {
            const { resolveSalesRouting } = require('../services/sales-routing');
            const routing = await resolveSalesRouting(sessionId, jobData);
            if (routing.enabled && channel !== 'ocr:process') {
                console.log(`[LLM Worker] Routing session ${sessionId} to Sales RAG Worker...`);
                const salesWorker = require('./sales-llm-worker');
                return await salesWorker.processSalesJob(jobData, routing.sessionDoc || { orgId: routing.org });
            }
            if (routing.enabled && channel === 'ocr:process') {
                console.log(`[LLM Worker] Keeping vision/OCR on interview LLM path (not sales RAG)`);
            }
            console.log(`[LLM Worker] Sales Mode not active for ${sessionId}: ${routing.reason}`);
        } catch (err) {
            console.error('[LLM Worker] Error checking sales routing:', err.message);
        }

        // Guard: Skip LLM if transcript is empty AND no manual input AND no screenshot AND not 'ask' mode
        const hasTranscript = transcript && transcript.length > 0;
        const hasManualRequest = manualRequest && manualRequest.trim().length > 0;
        const hasImage = channel === 'ocr:process' && payload && payload.image;
        const isManualAction = hasManualRequest || !!mode || channel === 'ocr:process';

        if (!hasTranscript && !isManualAction) {
            console.log('[LLM Worker] Skipping: No transcript and no manual action.');
            pubsubAdapter.publish('llm-results', {
                sessionId,
                channel: 'llm:error',
                payload: { message: 'I need to hear some conversation first before I can suggest follow-up!' }
            });
            return;
        }

        const isAutopilotEarly = !!jobData.isAutopilot;
        const requestId = jobData.requestId || `${sessionId}-${isAutopilotEarly ? 'auto' : 'manual'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        try {
            const isAutopilot = isAutopilotEarly;
            const turns = transcript || [];
            const candidateTurns = turns.filter((t) => t.speakerRole === 'candidate' && String(t.text || '').trim());
            const lastCandidateTurn = candidateTurns.length ? candidateTurns[candidateTurns.length - 1] : null;
            const triggerTurn = jobData.triggerTurnIndex != null
                ? turns.find((t) => t.turnIndex === jobData.triggerTurnIndex)
                : null;
            const candidateJustAnswered = triggerTurn || lastCandidateTurn;
            const interviewInProgress = candidateTurns.some(
                (t) => String(t.text || '').trim().split(/\s+/).filter(Boolean).length >= 8
            );

            let systemPrompt = `You are an elite AI Interview Assistant. Your goal is to analyze the ongoing interview transcript in real-time and suggest what the interviewer should say next.

Strict Output Formatting Rules:
1. OUTPUT EXACTLY ONE short suggestion the interviewer can speak aloud (1-2 sentences max).
2. NEVER OUTPUT PREAMBLE, INTRODUCTIONS, EXPLANATIONS, COMMENTARY, NUMBERED LISTS, OR MULTIPLE OPTIONS.
   - NEVER say "Here are a few follow-up questions you could ask:", "Based on the transcript...", or list options.
   - Do NOT start with "Say", labels, quotes-as-format, or bullet lists.
   - Begin immediately with the spoken line itself.
3. Opening/intro questions ("tell me about yourself", "what attracted you to this role") are ONLY allowed when no substantive candidate answer exists yet. If the candidate has already answered technical or behavioral questions, NEVER restart with an intro — continue from where the conversation left off.
4. STT may garble words — infer intent from context (e.g. "Kafka", "middleware", "queue") rather than treating noise as "no conversation yet".
5. If the user is asking YOU an informational question (e.g., "what role are we hiring for?", "summarize the interview"), answer them directly and concisely.
6. Keep suggestions short, natural to speak aloud, and punchy (1-2 sentences max).`;

            let transcriptText = turns.map(t => `${t.speaker}: ${t.text}`).join('\n');
            let userContent = '';
        if (jobRole || jobDescription) {
            userContent += `Context: Interviewing for ${jobRole || 'a position'}.\n`;
            if (jobDescription) {
                userContent += `Job Description: ${jobDescription}\n\n`;
            }
        }

        if (hasTranscript) {
            userContent += `Here is the live transcript so far:\n\n${transcriptText}\n\n`;
        } else if (isManualAction) {
            userContent += `The interview has just started or no transcript is available yet.\n\n`;
        }

            if (isAutopilot && candidateJustAnswered) {
                userContent += `The candidate just finished answering. Focus on their latest response:\n"${candidateJustAnswered.text.trim()}"\n\n`;
                userContent += `Suggest the single best follow-up question the interviewer should ask next. Probe specifics from that answer, clarify trade-offs they mentioned, or cover the highest-priority uncovered job requirement. Do NOT ask an opening or background question — the interview is already in progress.`;
            } else if (mode === 'followup' && hasTranscript) {
                if (lastCandidateTurn) {
                    userContent += `Focus on the candidate's most recent answer:\n"${lastCandidateTurn.text.trim()}"\n\n`;
                }
                userContent += `Suggest the single best follow-up question based on what the candidate just said and the job requirements. Do NOT restart with intro questions if substantive answers already exist.`;
            } else if (mode === 'ask') {
                if (!hasTranscript || !interviewInProgress) {
                    userContent += `Since the interview just started, please suggest an excellent opening question to introduce the candidate and assess them for the ${jobRole || 'role'}.`;
                } else {
                    userContent += `Based on the transcript and job requirements, please suggest the best next question to ask. Do NOT restart with intro questions.`;
                }
                if (manualRequest) {
                    userContent += `\n\nInterviewer's custom request: ${manualRequest}`;
                }
            } else {
                if (hasTranscript && interviewInProgress) {
                    if (lastCandidateTurn) {
                        userContent += `The candidate's latest answer:\n"${lastCandidateTurn.text.trim()}"\n\n`;
                    }
                    userContent += `Suggest the single best next question — follow up on the candidate's latest answer or cover an important uncovered topic. Do NOT ask an opening/background question.`;
                } else if (hasTranscript) {
                    userContent += `Please tell the interviewer exactly what single question to say next based on the transcript.`;
                } else {
                    userContent += `Please tell the interviewer the exact single opening question to say to start the interview.`;
                }
                if (manualRequest) {
                    userContent += `\n\nInterviewer's custom request: ${manualRequest}`;
                }
            }

            let messages = [
                { role: 'system', content: systemPrompt }
            ];

            if (channel === 'ocr:process' && payload && payload.image) {
                // Use Vision model for Circle to Search
                userContent = `Here is the live transcript so far:\n\n${transcriptText}\n\nI just captured this screenshot of the meeting. Please analyze the screen context along with the transcript to suggest the next best interview questions.`;
                messages.push({
                    role: 'user',
                    content: [
                        { type: 'text', text: userContent },
                        { type: 'image_url', image_url: { url: payload.image } }
                    ]
                });

                // For debugging: Save the image to disk so the user can verify it!
                try {
                    const fs = require('fs');
                    const path = require('path');
                    const tempDir = path.join(__dirname, '..', 'temp');
                    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
                    // Extract base64 data (remove data:image/png;base64, prefix)
                    const base64Data = payload.image.replace(/^data:image\/\w+;base64,/, "");
                    const debugPath = path.join(tempDir, 'debug_screenshot.png');
                    fs.writeFileSync(debugPath, base64Data, 'base64');
                    console.log(`[LLM Worker] Debug: Saved captured screenshot to ${debugPath}`);
                } catch (e) {
                    console.error('[LLM Worker] Failed to save debug screenshot:', e);
                }

            } else {
                messages.push({ role: 'user', content: userContent });
            }

            // Tell the UI we are starting to generate
            pubsubAdapter.publish('llm-results', {
                sessionId,
                channel: 'llm:start',
                payload: {
                    small: false,
                    turnId: jobData.triggerTurnIndex,
                    isAutopilot: !!jobData.isAutopilot,
                    requestId,
                    userBubble: channel === 'ocr:process' ? 'Assist' : undefined
                }
            });

            const startTime = Date.now();
            let content = '';
            let modelUsed = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
            const isVision = channel === 'ocr:process' && payload && payload.image;
            if (isVision) {
                // Vision requires a multimodal Groq model; text-only models return 4xx.
                modelUsed = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
            }

            const groqKey = process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY;
            const llmTemperature = isAutopilot ? 0.25 : 0.7;

            const callGroq = async (model) => {
                const body = {
                    model,
                    messages,
                    stream: false,
                    temperature: llmTemperature,
                    max_tokens: isVision ? 400 : 500
                };
                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${groqKey}`
                    },
                    body: JSON.stringify(body)
                });
                return response;
            };

            let response = await callGroq(modelUsed);
            if (!response.ok && response.status === 429 && isVision && modelUsed !== (process.env.GROQ_MODEL || 'openai/gpt-oss-120b')) {
                modelUsed = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
                response = await callGroq(modelUsed);
            }

            if (!response.ok) {
                const errText = await response.text();
                const friendly = isVision && (response.status === 403 || response.status === 400)
                    ? `Vision model rejected the request (${response.status}). Set GROQ_VISION_MODEL to a multimodal Groq model.`
                    : `Groq HTTP ${response.status}: ${errText}`;
                throw new Error(friendly);
            }

            const data = await response.json();
            if (data.choices && data.choices.length > 0) {
                content = data.choices[0].message?.content || '';
            } else {
                throw new Error('No choices returned from LLM');
            }

            // FIRE PARALLEL JSON ACTION ITEM & EVALUATION EXTRACTION
            this._extractActionItemsBackground(groqKey, sessionId, transcriptText);
            this._evaluateCandidateBackground(groqKey, sessionId, transcriptText, jobRole, jobDescription, {
                salesMode: !!jobData.salesMode
            });

            const latencyMs = Date.now() - startTime;
            console.log(`[LLM Worker] Generated response in ${latencyMs}ms using ${modelUsed}`);

            // Save to DB (Fire and forget, or await)
            LLMResponse.create({
                sessionId,
                responseType: 'suggestion',
                responseText: content,
                model: modelUsed,
                tokensUsed: data.usage?.total_tokens || 0,
                latencyMs
            }).catch(e => console.error('[LLM Worker] Failed to save DB record:', e.message));

            // Publish raw result to Pub/Sub
            this._parseAndPublish(sessionId, content, requestId, isAutopilot);

        } catch (error) {
            console.error(`[LLM Worker] Job failed for session ${sessionId}:`, error.stack || error.message);
            pubsubAdapter.publish('llm-results', {
                sessionId,
                channel: 'llm:error',
                payload: { message: error.message, requestId, isAutopilot: isAutopilotEarly }
            });
            throw error;
        }
    }

    _parseAndPublish(sessionId, content, requestId = null, isAutopilot = false) {
        let cleanContent = content;

        // Strip <think> tags (used by Qwen and reasoning models), including unclosed tags.
        // This is the industry-standard approach for cleaning outputs from reasoning 
        // models like DeepSeek-R1 or Qwen when returning a full (non-streaming) completion.
        cleanContent = cleanContent.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '');
        cleanContent = cleanContent.replace(/^Say\s*[:,-]?\s*/i, '').trim();
        cleanContent = cleanContent.replace(/^["'“]([\s\S]*?)["'”]$/s, '$1').trim();

        // Send text tokens if any
        if (cleanContent.trim()) {
            pubsubAdapter.publish('llm-results', {
                sessionId,
                channel: 'llm:token',
                payload: { text: cleanContent.trim(), requestId, isAutopilot }
            });
        }

        // Always emit done to close the loading bubble
        pubsubAdapter.publish('llm-results', {
            sessionId,
            channel: 'llm:done',
            payload: { requestId, isAutopilot }
        });
    }

    _parseJsonObject(content) {
        let text = String(content || '').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim();
        const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fence) text = fence[1].trim();
        const brace = text.match(/\{[\s\S]*\}/);
        if (brace) text = brace[0];
        try {
            return JSON.parse(text);
        } catch (e) {
            return null;
        }
    }

    async _extractActionItemsBackground(groqKey, sessionId, transcriptText) {
        try {
            console.log(`[LLM Worker] Spawning background JSON action item extraction...`);

            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${groqKey}`
                },
                body: JSON.stringify({
                    model: process.env.GROQ_EVAL_MODEL || 'openai/gpt-oss-20b',
                    response_format: { type: 'json_object' },
                    temperature: 0.1,
                    messages: [
                        {
                            role: "system",
                            content: "You extract ONLY real post-meeting commitments from an interview transcript. An action item is a concrete follow-up someone agreed to do (send resume, schedule next round, share portfolio, email references). NEVER invent interview questions, probing suggestions, or 'ask the candidate to…' items. If none were explicitly agreed, return { \"actionItems\": [] }. Output strict JSON only."
                        },
                        { role: "user", content: `Transcript:\n${transcriptText}` }
                    ]
                })
            });

            if (!response.ok) {
                throw new Error(`Groq HTTP ${response.status}`);
            }

            const data = await response.json();
            const content = data.choices[0]?.message?.content || '{}';
            const parsed = JSON.parse(content);
            const items = parsed.actionItems || [];

            if (items.length > 0) {
                const ActionItem = require('../db/models/ActionItem');
                for (const actionText of items) {
                    pubsubAdapter.publish('llm-results', {
                        sessionId,
                        channel: 'llm:action-item',
                        payload: { text: actionText }
                    });
                    await ActionItem.create({ sessionId, text: actionText, source: 'auto' })
                        .catch(e => console.error('[ActionItem] DB save failed:', e.message));
                    console.log(`[ActionItem] JSON LLM extracted: "${actionText}"`);
                }
            }
        } catch (error) {
            console.error(`[LLM Worker] Background action item extraction failed:`, error.message);
        }
    }

    async _evaluateCandidateBackground(groqKey, sessionId, transcriptText, jobRole, jobDescription, opts = {}) {
        if (!transcriptText || transcriptText.trim().length < 15) return;
        try {
            const salesMode = !!opts.salesMode;
            console.log(`[LLM Worker] Spawning background real-time ${salesMode ? 'sales' : 'candidate'} evaluation...`);

            const roleContext = jobRole
                ? (salesMode ? `Account / deal context: ${jobRole}` : `Meeting / role context: ${jobRole}`)
                : (salesMode
                    ? 'Account / deal context: Infer from the sales call transcript.'
                    : 'Meeting / role context: Infer the purpose from the transcript (interview, screening, sales, support, etc.). Do not assume a software-engineering interview.');
            const jdContext = jobDescription
                ? (salesMode
                    ? `Meeting goal / agenda (authoritative when present):\n${jobDescription}`
                    : `Requirements / JD / agenda (authoritative when present):\n${jobDescription}`)
                : (salesMode
                    ? 'Meeting goal: none provided — score deal health from discovery signals in the transcript.'
                    : 'Requirements / JD / agenda: none provided — evaluate only against goals that emerge in the transcript.');

            const interviewSystem = `You are a production hiring / meeting quality assessor for a LIVE conversation that may still be in progress.
Score like Greenhouse/Lever-style scorecards: evidence-only, role-agnostic, no hardcoded engineering rubrics.

Return strict JSON:
{
  "score": <number 0-100 overall fit based ONLY on assessed evidence>,
  "confidence": <number 0-100 how much of the role/agenda has been assessed so far>,
  "matchLevel": "<'Strong Fit' | 'Promising' | 'Moderate' | 'Needs Focus' | 'Underqualified' | 'Insufficient Evidence'>",
  "trend": "<'up' | 'down' | 'stable'>",
  "dimensions": [
    {
      "name": "<short criterion derived from JD/agenda/transcript — not a fixed list>",
      "score": <0-100 or null if not yet assessed>,
      "status": "<'assessed' | 'not_assessed'>",
      "note": "<one short evidence note or why not assessed>"
    }
  ],
  "strengths": ["<1-sentence evidenced strengths only; empty array if none yet; max 3>"],
  "gaps": ["<1-sentence evidenced risks/concerns OR clean open items like 'Still need signal on X'; max 4>"],
  "verifiedSkills": ["<short skills/topics clearly evidenced; max 8; empty if none>"],
  "recommendedProbe": "<one high-value next question for the interviewer>",
  "aiSuggestion": "<1-2 sentences for the interviewer on what to do next>"
}

Rules:
- Derive 3–6 dimensions from the JD/agenda when present; otherwise from the conversation. Never force Technical Depth / System Design / Problem Solving / Communication unless those topics are actually relevant.
- overall score = quality of assessed evidence only. Do NOT invent a floor (e.g. 70). Thin intros with no assessed depth → low-to-mid score + matchLevel "Insufficient Evidence" + low confidence.
- confidence rises as more dimensions move to status "assessed". Early chat → confidence often 10–40.
- Do NOT use phrases like "not yet covered", "still need to verify", "lacks X" for topics never discussed. For open items use: "Still need signal on <topic>."
- Put real failures/contradictions in gaps as concerns. Put unassessed must-haves as open items with the clean phrasing above.
- verifiedSkills must appear in the transcript. Do not invent.
- aiSuggestion must be actionable and honest about evidence thinness without capping the score.
Only output JSON.`;

            const salesSystem = `You are a live sales coach scoring DEAL HEALTH on an ongoing sales call (not a hiring interview).
Never say "candidate". Speak about prospect, buyer, deal, and rep performance.

Return strict JSON:
{
  "score": <number 0-100 deal health / likelihood to progress based ONLY on assessed evidence>,
  "confidence": <number 0-100 how much discovery has been covered so far>,
  "matchLevel": "<'Hot Opportunity' | 'Promising' | 'Moderate' | 'At Risk' | 'Unqualified' | 'Insufficient Evidence'>",
  "trend": "<'up' | 'down' | 'stable'>",
  "dimensions": [
    {
      "name": "<short sales criterion e.g. Pain, Budget, Authority, Timeline, Competition, Product Fit>",
      "score": <0-100 or null if not yet assessed>,
      "status": "<'assessed' | 'not_assessed'>",
      "note": "<one short evidence note or why not assessed>"
    }
  ],
  "strengths": ["<1-sentence positive deal/rep signals only; empty if none; max 3>"],
  "gaps": ["<1-sentence risks OR open discovery items like 'Still need signal on budget'; max 4>"],
  "verifiedSkills": ["<short topics/pain points/product interests evidenced; max 8; empty if none>"],
  "recommendedProbe": "<one high-value next question the rep should ask>",
  "aiSuggestion": "<1-2 sentences coaching the rep on what to do next — not 'encourage the candidate'>"
}

Rules:
- Derive 3–6 dimensions from BANT/MEDDIC-ish signals present in the call; do not force unused ones.
- Thin small-talk → low confidence + Insufficient Evidence.
- verifiedSkills = evidenced pains, products of interest, competitors, buying triggers — not interview skills.
- aiSuggestion must be sales-coach language (rep / prospect / deal), never hiring language.
Only output JSON.`;

            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${groqKey}`
                },
                body: JSON.stringify({
                    model: process.env.GROQ_EVAL_MODEL || 'openai/gpt-oss-20b',
                    response_format: { type: 'json_object' },
                    temperature: 0.15,
                    messages: [
                        {
                            role: 'system',
                            content: salesMode ? salesSystem : interviewSystem
                        },
                        {
                            role: 'user',
                            content: `${roleContext}\n${jdContext}\n\nLive Transcript:\n${transcriptText}`
                        }
                    ]
                })
            });

            if (!response.ok) {
                throw new Error(`Groq HTTP ${response.status}`);
            }

            const data = await response.json();
            const content = data.choices[0]?.message?.content || '{}';
            const parsed = this._parseJsonObject(content);
            const score = Number(parsed && parsed.score);
            if (parsed && Number.isFinite(score)) {
                parsed.score = Math.max(0, Math.min(100, Math.round(score)));
                this._normalizeEvaluation(parsed, transcriptText, { salesMode });
                pubsubAdapter.publish('llm-results', {
                    sessionId,
                    channel: 'evaluation:update',
                    payload: parsed
                });
                const { resolveMongoSessionId } = require('../services/session-ids');
                const Session = require('../db/models/Session');
                const mongoId = resolveMongoSessionId(sessionId) || (String(sessionId).length === 24 ? sessionId : null);
                if (mongoId) {
                    Session.findByIdAndUpdate(mongoId, { $set: { lastEvaluation: parsed, salesMode } })
                        .catch((e) => console.error('[Evaluation] Failed to persist lastEvaluation:', e.message));
                }
                console.log(`[Evaluation] Live score: ${parsed.score}% confidence=${parsed.confidence}% (${parsed.matchLevel || 'Active'}) sales=${salesMode}`);
            } else {
                console.warn('[Evaluation] Ignored payload without a numeric score:', String(content).slice(0, 200));
            }
        } catch (error) {
            console.error(`[LLM Worker] Background evaluation failed:`, error.message);
        }
    }

    _cleanEvalLine(s) {
        return String(s || '')
            .replace(/^\s*[-•*]+\s*/, '')
            .replace(/\bnot yet covered\s*\/\s*still need to verify\b[:\s-]*/gi, '')
            .replace(/\bstill need to verify\b[:\s-]*/gi, '')
            .replace(/\bnot yet covered\b[:\s-]*/gi, '')
            .trim();
    }

    _normalizeEvaluation(parsed, transcriptText, opts = {}) {
        const salesMode = !!opts.salesMode;
        const words = String(transcriptText || '').trim().split(/\s+/).filter(Boolean).length;
        parsed.score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));

        let confidence = Number(parsed.confidence);
        if (!Number.isFinite(confidence)) {
            confidence = Math.max(8, Math.min(95, Math.round(words / 8)));
        }
        parsed.confidence = Math.max(0, Math.min(100, Math.round(confidence)));

        const dims = Array.isArray(parsed.dimensions) ? parsed.dimensions : (Array.isArray(parsed.categories) ? parsed.categories : []);
        parsed.dimensions = dims.slice(0, 8).map((d) => {
            const name = String((d && d.name) || '').trim();
            if (!name) return null;
            const status = d.status === 'assessed' || (d.score != null && Number.isFinite(Number(d.score)))
                ? 'assessed'
                : 'not_assessed';
            const rawScore = Number(d.score);
            return {
                name,
                score: status === 'assessed' && Number.isFinite(rawScore)
                    ? Math.max(0, Math.min(100, Math.round(rawScore)))
                    : null,
                status,
                note: this._cleanEvalLine(d.note || '')
            };
        }).filter(Boolean);
        parsed.categories = parsed.dimensions.map((d) => ({
            name: d.name,
            score: d.score == null ? 0 : d.score
        }));

        parsed.strengths = (Array.isArray(parsed.strengths) ? parsed.strengths : [])
            .map((s) => this._cleanEvalLine(s))
            .filter(Boolean)
            .slice(0, 3);

        parsed.gaps = (Array.isArray(parsed.gaps) ? parsed.gaps : [])
            .map((s) => this._cleanEvalLine(s))
            .filter(Boolean)
            .filter((s) => !/^(technical depth|system design|problem solving|communication)$/i.test(s))
            .slice(0, 4);

        parsed.verifiedSkills = (Array.isArray(parsed.verifiedSkills) ? parsed.verifiedSkills : [])
            .map((s) => this._cleanEvalLine(s))
            .filter(Boolean)
            .slice(0, 8);

        const interviewLevels = new Set(['Strong Fit', 'Promising', 'Moderate', 'Needs Focus', 'Underqualified', 'Insufficient Evidence']);
        const salesLevels = new Set(['Hot Opportunity', 'Promising', 'Moderate', 'At Risk', 'Unqualified', 'Insufficient Evidence']);
        const levels = salesMode ? salesLevels : interviewLevels;
        if (!levels.has(parsed.matchLevel)) {
            if (parsed.confidence < 35 || words < 120) parsed.matchLevel = 'Insufficient Evidence';
            else if (salesMode) {
                if (parsed.score >= 85) parsed.matchLevel = 'Hot Opportunity';
                else if (parsed.score >= 70) parsed.matchLevel = 'Promising';
                else if (parsed.score >= 55) parsed.matchLevel = 'Moderate';
                else if (parsed.score >= 40) parsed.matchLevel = 'At Risk';
                else parsed.matchLevel = 'Unqualified';
            } else if (parsed.score >= 85) parsed.matchLevel = 'Strong Fit';
            else if (parsed.score >= 70) parsed.matchLevel = 'Promising';
            else if (parsed.score >= 55) parsed.matchLevel = 'Moderate';
            else if (parsed.score >= 40) parsed.matchLevel = 'Needs Focus';
            else parsed.matchLevel = 'Underqualified';
        }

        if (!['up', 'down', 'stable'].includes(parsed.trend)) parsed.trend = 'stable';

        let suggestion = this._cleanEvalLine(parsed.aiSuggestion || parsed.recommendedProbe || '');
        if (!suggestion) {
            suggestion = salesMode
                ? (parsed.confidence < 40
                    ? 'Discovery is still thin. Clarify pain, budget, and timeline before pitching hard.'
                    : 'Probe the biggest open deal risk next, then advance a clear next step.')
                : (parsed.confidence < 40
                    ? 'Evidence is still limited. Continue the conversation and cover the highest-priority open criteria before treating the score as final.'
                    : 'Probe the highest-priority open criterion next, then reassess fit.');
        }
        parsed.aiSuggestion = suggestion;
        if (parsed.recommendedProbe) {
            parsed.recommendedProbe = this._cleanEvalLine(parsed.recommendedProbe);
        }
        parsed.mode = salesMode ? 'sales' : 'interview';
        return parsed;
    }
}

module.exports = new LLMWorker();
