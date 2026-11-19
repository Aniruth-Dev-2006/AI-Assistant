const TranscriptManager = require('./transcript-manager');
const tm = new TranscriptManager('t8');
const foreign = 'Hello? Are you there?';
const incoming = 'Are you there? Are there?';
console.log('stripForeign', JSON.stringify(tm._stripForeignText(incoming, foreign)));
console.log('includes?', tm._normalizeForPrefix(foreign).includes(tm._normalizeForPrefix(incoming)));
console.log('rev includes?', tm._normalizeForPrefix(incoming).includes(tm._normalizeForPrefix(foreign)));
