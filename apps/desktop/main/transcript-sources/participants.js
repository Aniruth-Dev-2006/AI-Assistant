const BOT_NAME_ALIASES = new Set([
    'xobin',
    'xora',
    'xobin',
    'ai interview assistant',
    'ai meet assistant'
]);

function isBotParticipantName(name, extraBotNames = []) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return true;
    if (BOT_NAME_ALIASES.has(n)) return true;
    const display = String(process.env.BOT_DISPLAY_NAME || 'Xobin').trim().toLowerCase();
    if (display && n === display) return true;
    for (const extra of extraBotNames) {
        const e = String(extra || '').trim().toLowerCase();
        if (e && (n === e || n.includes(e))) return true;
    }
    return false;
}

function countHumanParticipants(names, extraBotNames = []) {
    if (!Array.isArray(names)) return 0;
    let count = 0;
    for (const raw of names) {
        const n = String(raw || '').trim();
        if (!n || n.length < 2) continue;
        if (isBotParticipantName(n, extraBotNames)) continue;
        count += 1;
    }
    return count;
}

module.exports = { countHumanParticipants, isBotParticipantName, BOT_NAME_ALIASES };
