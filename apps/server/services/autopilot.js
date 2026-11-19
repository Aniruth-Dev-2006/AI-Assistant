function wordCount(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Autopilot / silence-triggered LLM only after the counterparty speaks
 * (candidate / customer / prospect). Never after interviewer / sales-rep turns.
 */
function isAutopilotEligible(turn, { salesMode = false } = {}) {
    if (!turn || turn.speakerRole !== 'candidate') return false;
    const wc = wordCount(turn.text);
    return salesMode ? wc >= 3 : wc > 5;
}

module.exports = { isAutopilotEligible, wordCount };
