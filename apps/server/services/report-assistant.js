async function askAboutReport({ report, transcriptTurns, question, history = [] }) {
    const groqKey = process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY;
    if (!groqKey) {
        throw new Error('AI assistant is not configured (missing GROQ_API_KEY)');
    }

    const transcriptText = (transcriptTurns || [])
        .map((t) => `${t.speaker || 'Speaker'}: ${t.text || ''}`)
        .join('\n')
        .slice(0, 24000);

    const skills = (report.verifiedSkills || [])
        .map((s) => (typeof s === 'string' ? s : s.name || s.skill || ''))
        .filter(Boolean)
        .join(', ');

    const strengths = (report.strengths || []).map((x) => (typeof x === 'string' ? x : x.text || '')).filter(Boolean);
    const concerns = (report.concerns || []).map((x) => (typeof x === 'string' ? x : x.text || '')).filter(Boolean);
    const actions = (report.actionItems || []).map((a) => (typeof a === 'string' ? a : a.text || '')).filter(Boolean);

    const context = [
        `Title: ${report.title || report.jobRole || 'Interview'}`,
        `Role: ${report.jobRole || 'n/a'}`,
        `Candidate: ${report.candidateName || 'n/a'}`,
        `Platform: ${report.platform || 'n/a'}`,
        `Recommendation: ${report.recommendation || 'n/a'}`,
        `Recommendation notes: ${report.recommendationText || ''}`,
        `Overall score: ${report.overallScore ?? 'n/a'}`,
        `Summary: ${report.summary || ''}`,
        `Verified skills: ${skills || 'none listed'}`,
        `Strengths: ${strengths.join('; ') || 'none listed'}`,
        `Concerns: ${concerns.join('; ') || 'none listed'}`,
        `Action items: ${actions.join('; ') || 'none listed'}`
    ].join('\n');

    const messages = [
        {
            role: 'system',
            content: `You are "imagine", a hiring assistant for one completed interview report.
Answer only from the report scorecard and transcript below. If evidence is missing, say so briefly.
Be concise, professional, and specific. Do not invent quotes or scores.

Formatting rules (always):
- Start with a short bold title line like **Strongest evidence supporting a hire**
- Use bullet lists with "- " for each point
- Bold category labels and key terms with **double asterisks** (e.g. **- Relevant technical experience:** … **RAG pipelines** …)
- Prefer bullets over long paragraphs; keep answers scannable`
        },
        {
            role: 'user',
            content: `REPORT CONTEXT\n${context}\n\nTRANSCRIPT\n${transcriptText || '(no transcript available)'}`
        }
    ];

    for (const turn of (history || []).slice(-8)) {
        const role = turn.role === 'assistant' || turn.role === 'ai' ? 'assistant' : 'user';
        const content = String(turn.text || turn.content || '').trim();
        if (content) messages.push({ role, content });
    }
    messages.push({ role: 'user', content: String(question).trim() });

    const model = process.env.GROQ_EVAL_MODEL || process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${groqKey}`
        },
        body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 700,
            messages
        })
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Groq request failed (${response.status}): ${errText.slice(0, 200)}`);
    }

    const data = await response.json();
    const answer = data?.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error('Empty response from AI assistant');
    return answer;
}

module.exports = { askAboutReport };
