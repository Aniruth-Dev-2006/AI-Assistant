function scheduleLiveEvaluation(sessionId, botManager) {
    if (!botManager || !botManager.transcriptManager) return;
    const ctx = botManager.transcriptManager.getContext();
    if (!Array.isArray(ctx) || !ctx.length) return;
    const transcriptText = ctx.map((t) => `${t.speaker}: ${t.text}`).join('\n');
    if (transcriptText.trim().length < 40) return;

    if (global.evalDebounceTimer) clearTimeout(global.evalDebounceTimer);
    global.evalDebounceTimer = setTimeout(() => {
        const activeMgr = (global.activeBots && global.activeBots.get(sessionId)) || botManager;
        if (!activeMgr || !activeMgr.transcriptManager) return;
        const fresh = activeMgr.transcriptManager.getContext();
        if (!Array.isArray(fresh) || !fresh.length) return;
        const text = fresh.map((t) => `${t.speaker}: ${t.text}`).join('\n');
        if (text.trim().length < 40) return;

        const groqKey = process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY;
        if (!groqKey) return;

        const llmWorker = require('../workers/llm-worker');
        llmWorker._evaluateCandidateBackground(
            groqKey,
            sessionId,
            text,
            activeMgr.jobRole || '',
            activeMgr.jobDescription || '',
            { salesMode: !!activeMgr.salesModeActive }
        ).catch((e) => console.error('[Evaluation] Scheduled eval failed:', e.message));
    }, 5000);
}

module.exports = { scheduleLiveEvaluation };
