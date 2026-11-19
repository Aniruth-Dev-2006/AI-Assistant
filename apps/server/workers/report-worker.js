const TranscriptTurn = require('../db/models/TranscriptTurn');
const Report = require('../db/models/Report');
const Session = require('../db/models/Session');
const ActionItem = require('../db/models/ActionItem');
const pubsubAdapter = require('../services/pubsub-adapter');
const { snapshotFromSession, PROMPT_VERSION } = require('../services/report-service');

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

class ReportWorker {
    async _loadTurns(sessionId) {
        let turns = await TranscriptTurn.find({ sessionId: String(sessionId) }).sort({ turnIndex: 1 }).exec();
        if (turns && turns.length) return turns;
        // Local/dev bots sometimes persisted under local-session before mongo id was known
        turns = await TranscriptTurn.find({ sessionId: 'local-session' }).sort({ turnIndex: 1 }).exec();
        return turns || [];
    }

    async processJob(jobData) {
        const { sessionId } = jobData;
        console.log(`[Report Worker] Generating report for session ${sessionId}...`);
        const modelUsed = process.env.GROQ_EVAL_MODEL || process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

        try {
            await Report.findOneAndUpdate(
                { sessionId: String(sessionId) },
                { $set: { status: 'generating', error: '', model: modelUsed, promptVersion: PROMPT_VERSION, updatedAt: new Date() } },
                { upsert: true }
            );

            let turns = [];
            for (let attempt = 0; attempt < 5; attempt++) {
                turns = await this._loadTurns(sessionId);
                if (turns.length) break;
                await sleep(800 * (attempt + 1));
            }

            const session = await Session.findById(sessionId);
            const actionDocs = await ActionItem.find({ sessionId: String(sessionId) }).sort({ createdAt: 1 }).lean();
            const notes = (session && session.interviewerNotes) || '';
            const evalSnap = (session && session.lastEvaluation) || {};
            const snap = snapshotFromSession(session, {
                userId: session && session.createdBy,
                orgId: session && session.orgId
            });

            if (!turns.length) {
                const report = await Report.findOneAndUpdate(
                    { sessionId: String(sessionId) },
                    {
                        $set: {
                            ...snap,
                            status: 'ready',
                            error: '',
                            summary: notes
                                ? `Meeting ended with interviewer notes but no captured transcript.\n\nNotes:\n${notes}`
                                : 'Meeting ended before a usable transcript was captured.',
                            recommendation: 'maybe',
                            recommendationText: 'Insufficient transcript evidence to score this meeting.',
                            overallScore: 0,
                            totalScore: 0,
                            maxScore: 100,
                            verifiedSkills: [],
                            strengths: [],
                            concerns: ['No transcript was available at report time.'],
                            actionItems: [],
                            topics: [],
                            model: modelUsed,
                            promptVersion: PROMPT_VERSION,
                            generatedAt: new Date(),
                            updatedAt: new Date()
                        },
                        $setOnInsert: { sessionId: String(sessionId), createdAt: new Date() }
                    },
                    { upsert: true, new: true }
                );
                console.log(`[Report Worker] Ready stub report for ${sessionId} (empty transcript).`);
                pubsubAdapter.publish('session-lifecycle', {
                    sessionId,
                    channel: 'report:ready',
                    payload: { reportId: report._id, status: 'ready' }
                });
                return;
            }

            const comments = turns
                .flatMap((t) => (t.comments || []).map((c) => `[${t.speaker} @ turn ${t.turnIndex}] ${c.text}`))
                .filter(Boolean);

            const transcriptText = turns.map((t) => `${t.speaker}: ${t.text}`).join('\n');
            const groqKey = process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY;

            let seeded;
            try {
                const parsed = await this._generateScorecard({
                    groqKey,
                    modelUsed,
                    transcriptText,
                    notes,
                    comments,
                    actionDocs,
                    session,
                    evalSnap
                });
                seeded = this._seedFromEval(parsed, evalSnap, actionDocs);
            } catch (llmErr) {
                console.error(`[Report Worker] LLM scorecard failed, saving transcript-backed stub:`, llmErr.message);
                seeded = {
                    summary: transcriptText.slice(0, 1200) || notes || 'Meeting completed.',
                    recommendation: 'maybe',
                    recommendationText: 'Report generated from transcript without full LLM scorecard.',
                    overallScore: Number.isFinite(Number(evalSnap && evalSnap.score))
                        ? Math.round((Number(evalSnap.score) / 10) * 10) / 10
                        : 0,
                    totalScore: 0,
                    maxScore: 100,
                    verifiedSkills: Array.isArray(evalSnap.verifiedSkills) ? evalSnap.verifiedSkills : [],
                    strengths: Array.isArray(evalSnap.strengths) ? evalSnap.strengths : [],
                    concerns: ['Full AI scorecard unavailable; transcript was preserved.'],
                    actionItems: actionDocs.map((a, i) => ({
                        id: String(a._id || i + 1),
                        text: a.text,
                        done: a.status === 'done'
                    })),
                    topics: []
                };
                seeded.totalScore = Math.round(seeded.overallScore * 10);
            }

            const report = await Report.findOneAndUpdate(
                { sessionId: String(sessionId) },
                {
                    $set: {
                        ...snap,
                        ...seeded,
                        status: 'ready',
                        error: '',
                        model: modelUsed,
                        promptVersion: PROMPT_VERSION,
                        generatedAt: new Date(),
                        updatedAt: new Date()
                    }
                },
                { upsert: true, new: true }
            );

            console.log(`[Report Worker] Saved report for session ${sessionId} (${seeded.recommendation}, ${seeded.overallScore}/10)`);

            pubsubAdapter.publish('session-lifecycle', {
                sessionId,
                channel: 'report:ready',
                payload: { reportId: report._id, status: 'ready' }
            });
        } catch (error) {
            console.error(`[Report Worker] Job failed for session ${sessionId}:`, error.message);
            // Last-resort ready report so SaaS never leaves a permanent failed state
            try {
                const session = await Session.findById(sessionId).catch(() => null);
                const snap = snapshotFromSession(session, {});
                const report = await Report.findOneAndUpdate(
                    { sessionId: String(sessionId) },
                    {
                        $set: {
                            ...snap,
                            status: 'ready',
                            error: '',
                            summary: `Meeting ended. Report generation recovered after: ${error.message}`,
                            recommendation: 'maybe',
                            recommendationText: 'Partial report saved so the session is not lost.',
                            overallScore: 0,
                            totalScore: 0,
                            maxScore: 100,
                            verifiedSkills: [],
                            strengths: [],
                            concerns: [],
                            actionItems: [],
                            topics: [],
                            promptVersion: PROMPT_VERSION,
                            generatedAt: new Date(),
                            updatedAt: new Date()
                        },
                        $setOnInsert: { sessionId: String(sessionId), createdAt: new Date() }
                    },
                    { upsert: true, new: true }
                );
                pubsubAdapter.publish('session-lifecycle', {
                    sessionId,
                    channel: 'report:ready',
                    payload: { reportId: report._id, status: 'ready' }
                });
            } catch (e2) {
                await Report.findOneAndUpdate(
                    { sessionId: String(sessionId) },
                    { $set: { status: 'failed', error: error.message, updatedAt: new Date() } }
                ).catch(() => {});
                throw error;
            }
        }
    }

    async _generateScorecard({ groqKey, modelUsed, transcriptText, notes, comments, actionDocs, session, evalSnap }) {
        const salesMode = !!(session && session.salesMode) || !!(evalSnap && evalSnap.mode === 'sales');
        const roleContext = session && session.jobRole
            ? (salesMode ? `Account / deal: ${session.jobRole}` : `Target Role: ${session.jobRole}`)
            : '';
        const jdContext = session && session.jobDescription
            ? (salesMode ? `Meeting goal:\n${session.jobDescription}` : `Job Description:\n${session.jobDescription}`)
            : '';
        const notesBlock = notes ? (salesMode ? `Rep notes:\n${notes}` : `Interviewer notes:\n${notes}`) : '';
        const commentsBlock = comments.length ? `Per-turn comments:\n${comments.join('\n')}` : '';
        const actionsBlock = actionDocs.length
            ? `Tracked action items:\n${actionDocs.map((a) => `- [${a.status}] ${a.text}`).join('\n')}`
            : '';
        const evalBlock = evalSnap && evalSnap.score != null
            ? `Live ${salesMode ? 'deal-health' : 'interview'} evaluation snapshot:\n${JSON.stringify(evalSnap)}`
            : '';

        const interviewPrompt = `You are writing a post-meeting scorecard for hiring or general professional evaluation.
Be role-agnostic: derive criteria from the JD/agenda/transcript — do not assume software-engineering rubrics.
Return a strict JSON object with this schema:
{
  "summary": "<2-4 sentence executive summary>",
  "recommendation": "hire" | "maybe" | "pass",
  "recommendationText": "<1-2 sentences explaining the decision>",
  "overallScore": <number 0-10 with one decimal allowed>,
  "verifiedSkills": ["<short skills/topics evidenced, max 8>"],
  "strengths": ["<1-sentence evidenced strengths, max 3>"],
  "concerns": ["<1-sentence evidenced risks OR clean open items like 'Still need signal on X'; max 4>"],
  "actionItems": [{ "text": "<only explicit post-meeting commitments someone agreed to do; never interview questions or 'ask the candidate…'>", "done": false }],
  "topics": ["<topics covered, max 6>"]
}
Use the live evaluation snapshot so the report agrees with in-meeting Insights (including confidence and dimensions when present).
Do not invent skills. Do not use phrases like "not yet covered" or "still need to verify".
Thin evidence → lower overallScore and recommendation "maybe" or "pass" with honest recommendationText — never inflate scores.
actionItems must be empty if no concrete follow-up was agreed.
Only output JSON.`;

        const salesPrompt = `You are writing a post-call sales deal scorecard for a B2B sales team (not hiring).
Never use candidate/hire language. Use prospect, buyer, deal, next step.
Return a strict JSON object with this schema:
{
  "summary": "<2-4 sentence deal summary>",
  "recommendation": "hire" | "maybe" | "pass",
  "recommendationText": "<1-2 sentences: hire=advance/strong opportunity, maybe=nurture, pass=disqualify/no fit>",
  "overallScore": <number 0-10 deal health>,
  "verifiedSkills": ["<pains, product interests, competitors, buying triggers evidenced; max 8>"],
  "strengths": ["<what went well on the call; max 3>"],
  "concerns": ["<deal risks or missing discovery signals; max 4>"],
  "actionItems": [{ "text": "<explicit post-call commitments only>", "done": false }],
  "topics": ["<topics covered, max 6>"]
}
Map recommendation values for storage compatibility: hire=Advance, maybe=Nurture, pass=Disqualify — but still output only hire|maybe|pass.
Align with the live deal-health evaluation snapshot when present.
Only output JSON.`;

        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${groqKey}`
            },
            body: JSON.stringify({
                model: modelUsed,
                response_format: { type: 'json_object' },
                temperature: 0.2,
                messages: [
                    {
                        role: 'system',
                        content: salesMode ? salesPrompt : interviewPrompt
                    },
                    {
                        role: 'user',
                        content: [roleContext, jdContext, evalBlock, notesBlock, commentsBlock, actionsBlock, `Transcript:\n${transcriptText}`]
                            .filter(Boolean)
                            .join('\n\n')
                    }
                ]
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Groq HTTP ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content || '{}';
        try {
            return JSON.parse(content);
        } catch (e) {
            const brace = String(content).match(/\{[\s\S]*\}/);
            if (brace) return JSON.parse(brace[0]);
            throw new Error('Failed to parse report JSON');
        }
    }

    _seedFromEval(parsed, evalSnap, actionDocs) {
        const rec = ['hire', 'maybe', 'pass'].includes(parsed.recommendation) ? parsed.recommendation : 'maybe';
        let overall = Number(parsed.overallScore);
        if (!Number.isFinite(overall) && Number.isFinite(Number(evalSnap && evalSnap.score))) {
            overall = Math.round((Number(evalSnap.score) / 10) * 10) / 10;
        }
        if (!Number.isFinite(overall)) overall = 0;
        overall = Math.max(0, Math.min(10, Math.round(overall * 10) / 10));

        const skills = Array.isArray(parsed.verifiedSkills) && parsed.verifiedSkills.length
            ? parsed.verifiedSkills
            : (Array.isArray(evalSnap.verifiedSkills) ? evalSnap.verifiedSkills : []);
        const strengths = Array.isArray(parsed.strengths) && parsed.strengths.length
            ? parsed.strengths
            : (Array.isArray(evalSnap.strengths) ? evalSnap.strengths : []);
        const concerns = Array.isArray(parsed.concerns) && parsed.concerns.length
            ? parsed.concerns
            : (Array.isArray(evalSnap.gaps) ? evalSnap.gaps : []);

        let actionItems = Array.isArray(parsed.actionItems)
            ? parsed.actionItems.map((a, i) => ({
                id: String(a.id || i + 1),
                text: typeof a === 'string' ? a : String(a.text || ''),
                done: !!(a && a.done)
            })).filter((a) => a.text)
            : [];
        if (!actionItems.length && actionDocs.length) {
            actionItems = actionDocs.map((a, i) => ({
                id: String(a._id || i + 1),
                text: a.text,
                done: a.status === 'done'
            }));
        }

        return {
            summary: parsed.summary || '',
            recommendation: rec,
            recommendationText: parsed.recommendationText || '',
            overallScore: overall,
            totalScore: Math.round(overall * 10),
            maxScore: 100,
            verifiedSkills: skills.map((s) => String(s).trim()).filter(Boolean).slice(0, 8),
            strengths: strengths.map((s) => String(s).trim()).filter(Boolean).slice(0, 3),
            concerns: concerns.map((s) => String(s).trim()).filter(Boolean).slice(0, 3),
            actionItems,
            topics: Array.isArray(parsed.topics) ? parsed.topics.map((t) => String(t).trim()).filter(Boolean).slice(0, 6) : []
        };
    }
}

module.exports = new ReportWorker();
