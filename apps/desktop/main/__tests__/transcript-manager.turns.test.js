const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const TranscriptManager = require('../transcript-manager');

describe('TranscriptManager speaker-change turns', () => {
  it('speaker 1 interrupt closes speaker 0 turn without glue', () => {
    const tm = new TranscriptManager('t1');
    tm.appendChunk('Speaker 0', 'Hi Alex, thanks for joining us today for the interview.', 'a', true);
    tm.appendChunk('Speaker 1', 'Hi Dinesh, glad to be here.', 'b', true);
    tm.commitTurn();

    const turns = tm.buffer.filter((t) => t.text && t.text.trim());
    assert.equal(turns.length, 2);
    assert.equal(turns[0].speaker, 'Speaker 0');
    assert.equal(turns[1].speaker, 'Speaker 1');
    assert.ok(turns[0].text.includes('Hi Alex'));
    assert.ok(!turns[0].text.includes('Dinesh'));
    assert.ok(turns[1].text.includes('Hi Dinesh'));
    assert.ok(!turns[1].text.includes('Hi Alex'));
  });

  it('micro interrupt still starts a new turn', () => {
    const tm = new TranscriptManager('t2');
    tm.appendChunk('Speaker 0', 'So tell me about your background in distributed systems.', 'a', true);
    tm.appendChunk('Speaker 1', 'Sure.', 'b', true);
    tm.appendChunk('Speaker 1', 'Sure. I spent three years on Kafka pipelines.', 'c', true);
    tm.commitTurn();

    const turns = tm.buffer.filter((t) => t.text && t.text.trim());
    assert.equal(turns.length, 2);
    assert.equal(turns[0].speaker, 'Speaker 0');
    assert.equal(turns[1].speaker, 'Speaker 1');
    assert.ok(!turns[0].text.includes('Sure'));
    assert.ok(turns[1].text.toLowerCase().includes('kafka'));
  });

  it('S0 → S1 → S0 creates three exclusive turns', () => {
    const tm = new TranscriptManager('t3');
    tm.appendChunk('Speaker 0', 'Hi Alex, welcome.', 'a', true);
    tm.appendChunk('Speaker 1', 'Hi, I am the candidate.', 'b', true);
    tm.appendChunk('Speaker 0', 'Great, let’s talk about RAG.', 'c', true);
    tm.commitTurn();

    const turns = tm.buffer.filter((t) => t.text && t.text.trim());
    assert.equal(turns.length, 3);
    assert.deepEqual(turns.map((t) => t.speaker), ['Speaker 0', 'Speaker 1', 'Speaker 0']);
    assert.ok(!turns[0].text.includes('candidate'));
    assert.ok(!turns[1].text.includes('RAG'));
    assert.ok(!turns[2].text.includes('candidate'));
  });

  it('same speaker chunks still merge into one turn', () => {
    const tm = new TranscriptManager('t4');
    tm.appendChunk('Speaker 0', 'I led the migration.', 'a', true);
    tm.appendChunk('Speaker 0', 'I led the migration to event-driven services.', 'b', true);
    tm.commitTurn();

    const turns = tm.buffer.filter((t) => t.text && t.text.trim());
    assert.equal(turns.length, 1);
    assert.equal(turns[0].speaker, 'Speaker 0');
    assert.ok(turns[0].text.includes('event-driven'));
  });

  it('unrelated same-speaker finals become separate turns (no glue)', () => {
    const tm = new TranscriptManager('t5');
    tm.appendChunk(
      'Speaker 0',
      'Myself Aniruth as admin agent I work with Robin the agent.',
      'a',
      true
    );
    tm.appendChunk(
      'Speaker 0',
      'Hello Anil? What are you doing? Nothing. There is somebody.',
      'b',
      true
    );
    tm.commitTurn();

    const turns = tm.buffer.filter((t) => t.text && t.text.trim());
    assert.equal(turns.length, 2);
    assert.ok(turns[0].text.toLowerCase().includes('aniruth') || turns[0].text.toLowerCase().includes('robin'));
    assert.ok(!turns[0].text.toLowerCase().includes('what are you doing'));
    assert.ok(turns[1].text.toLowerCase().includes('what are you doing'));
    assert.ok(!turns[1].text.toLowerCase().includes('admin agent'));
  });

  it('DOM names Dinesh then Monish stack exclusive turns', () => {
    const tm = new TranscriptManager('t6');
    tm.appendChunk('Dinesh', 'Can you hear me?', 'a', true);
    tm.appendChunk('Monish', 'Yes, loud and clear.', 'b', true);
    tm.appendChunk('Dinesh', "Okay, let's start the interview.", 'c', true);
    tm.commitTurn();

    const turns = tm.buffer.filter((t) => t.text && t.text.trim());
    assert.equal(turns.length, 3);
    assert.deepEqual(turns.map((t) => t.speaker), ['Dinesh', 'Monish', 'Dinesh']);
    assert.ok(!turns[0].text.includes('loud'));
    assert.ok(!turns[1].text.includes('interview'));
    assert.ok(!turns[2].text.includes('loud'));
  });

  it('same speaker continues into one turn after silence finalize', () => {
    const tm = new TranscriptManager('t8');
    tm.appendChunk("Dinesh '", 'Hello? Are you there?', 'a', true);
    tm._finalizeCurrentTurn('silence');
    tm.appendChunk('Dinesh', 'Are you there? Are there?', 'b', true);
    tm.commitTurn();

    const turns = tm.buffer.filter((t) => t.text && t.text.trim());
    assert.equal(turns.length, 1);
    assert.equal(tm._normSpeakerName(turns[0].speaker), 'dinesh');
    assert.ok(turns[0].text.toLowerCase().includes('hello'));
    assert.ok(turns[0].text.toLowerCase().includes('are there'));
  });

  it('Pavan finished sentences stay as separate turns (no reopen/replace)', () => {
    const tm = new TranscriptManager('t9');
    tm.appendChunk('Pavan', 'Can you hear me?', 'a', true);
    tm._finalizeCurrentTurn('silence');
    tm.appendChunk('Pavan', 'What about today?', 'b', true);
    tm._finalizeCurrentTurn('silence');
    tm.appendChunk('Pavan', 'Tonight before sunset.', 'c', true);
    tm.commitTurn();

    const turns = tm.buffer.filter((t) => t.text && t.text.trim());
    assert.ok(turns.length >= 2 && turns.length <= 3);
    assert.ok(turns.some((t) => t.text.toLowerCase().includes('hear me')));
    assert.ok(turns.some((t) => /today|sunset/i.test(t.text)));
    assert.ok(turns.every((t) => tm._normSpeakerName(t.speaker) === 'pavan'));
  });

  it('drops trailing Deepgram echo after turn finalize', () => {
    const tm = new TranscriptManager('t7');
    const long =
      'So I will introduce myself. My name is Pawan. I am still in full stack development. And the engineer';
    tm.appendChunk('pAVAN', long, 'a', true);
    tm.commitTurn();
    tm.appendChunk('pAVAN', 'And the engineer.', 'b', true);
    tm.appendChunk('pAVAN', 'And the engineer', 'c', false);

    const turns = tm.buffer.filter((t) => t.text && t.text.trim());
    assert.equal(turns.length, 1);
    assert.ok(turns[0].text.toLowerCase().includes('full stack'));
    assert.equal(tm.currentSpeaker, null);
    assert.equal(tm.currentTurnText, '');
  });

  it('fuzzy STT rewrite replaces instead of gluing near-duplicates', () => {
    const tm = new TranscriptManager('t10');
    tm.appendChunk('Rahul G', 'Vring around 2000 candidate every month.', 'a', true);
    tm.appendChunk('Rahul G', 'We are arriving around 2,000 candidate every month.', 'b', true);
    tm.commitTurn();
    const turns = tm.buffer.filter((t) => t.text && t.text.trim());
    assert.equal(turns.length, 1);
    const n = turns[0].text.toLowerCase();
    assert.ok(n.includes('2000') || n.includes('2,000'));
    assert.ok(!(n.includes('vring') && n.includes('arriving')));
  });

  it('cumulative caption growth keeps only new words once', () => {
    const tm = new TranscriptManager('t11');
    tm.appendChunk('Rahul G', 'We currently use a rank for coding assessment.', 'a', false);
    tm.appendChunk(
      'Rahul G',
      'We currently use a rank for coding assessment. Need coding, assessment, proctoring?',
      'a',
      false
    );
    tm.commitTurn();
    const turns = tm.buffer.filter((t) => t.text && t.text.trim());
    assert.equal(turns.length, 1);
    const n = turns[0].text.toLowerCase();
    const first = n.indexOf('we currently use');
    const second = n.indexOf('we currently use', first + 1);
    assert.equal(second, -1);
    assert.ok(n.includes('proctoring'));
  });

  it('commitTurn seals turn so Assist/ask cannot reopen same bubble', () => {
    const tm = new TranscriptManager('t12');
    tm.appendChunk('Dinesh R', 'Is there any problem? Transcript has been repeating.', 'a', true);
    tm.commitTurn();
    assert.equal(tm.buffer[0].isComplete, true);
    assert.ok(tm._actionSealedTurnIds.has(tm.buffer[0].turnIndex));

    tm.appendChunk('Dinesh R', 'Is there any problem? Transcript has been repeating for multiple length.', 'b', true);
    const turns = tm.buffer.filter((t) => t.text && t.text.trim());
    assert.equal(turns.length, 2);
    assert.equal(turns[0].isComplete, true);
    assert.ok(turns[0].text.toLowerCase().includes('repeating'));
    assert.ok(!turns[0].text.toLowerCase().includes('multiple length'));
    assert.ok(turns[1].text.toLowerCase().includes('multiple length'));
  });

  it('generic Speaker after named finalize starts a new turn (not glued into Dinesh)', () => {
    const tm = new TranscriptManager('t13');
    tm.appendChunk('Dinesh', 'Near me. So we can start the meeting, right?', 'a', true);
    tm.commitTurn();
    assert.equal(tm.currentSpeaker, null);

    tm.appendChunk('', 'Yeah sure, I am ready to discuss pricing.', 'b', false);
    tm.updateCurrentSpeakerName('Rahul G');
    tm.appendChunk('Rahul G', 'Yeah sure, I am ready to discuss pricing and timeline.', 'b', false);
    tm.commitTurn();

    const turns = tm.buffer.filter((t) => t.text && t.text.trim());
    assert.ok(turns.length >= 2, `expected >=2 turns, got ${turns.length}: ${JSON.stringify(turns.map(t => [t.speaker, t.text]))}`);
    assert.equal(tm._normSpeakerName(turns[0].speaker), 'dinesh');
    assert.ok(turns[0].text.includes('start the meeting'));
    assert.ok(!turns[0].text.toLowerCase().includes('pricing'));
    const rahul = turns.find((t) => tm._normSpeakerName(t.speaker) === 'rahul g' || tm._normSpeakerName(t.speaker) === 'speaker');
    assert.ok(rahul, 'Rahul/Speaker turn missing');
    assert.ok(rahul.text.toLowerCase().includes('pricing'));
  });

  it('rejects icon noise like Delete. and does not drop Dinesh when he speaks after Rahul', () => {
    const tm = new TranscriptManager('t14');
    tm.appendChunk('Dinesh', "Can you hear me? Okay, then let's restart the meeting. Let's wait until the calendar.", 'a', true);
    tm.commitTurn();

    tm.appendChunk('Rahul G', 'Hello! When you see? Plastic name Delhi.', 'b', true);
    tm.commitTurn();

    tm.appendChunk('Dinesh', 'Delete.', 'c', true);

    tm.appendChunk('Dinesh', 'Can you hear me now? Yes, I can hear you.', 'd', true);
    tm.commitTurn();

    const turns = tm.buffer.filter((t) => t.text && t.text.trim());
    assert.equal(turns.length, 3, `Expected exactly 3 turns, got ${turns.length}: ${JSON.stringify(turns.map(t => [t.speaker, t.text]))}`);
    assert.equal(tm._normSpeakerName(turns[0].speaker), 'dinesh');
    assert.equal(tm._normSpeakerName(turns[1].speaker), 'rahul g');
    assert.equal(tm._normSpeakerName(turns[2].speaker), 'dinesh');
    assert.ok(!turns.some(t => t.text.toLowerCase() === 'delete.'));
    assert.ok(turns[2].text.includes('Can you hear me now?'));
  });

  it('Speaker → Rahul rename mid-utterance keeps one turnId (no ladder)', () => {
    const tm = new TranscriptManager('t15');
    const ids = [];
    tm.on('transcript:update', (u) => ids.push(u.turnId));

    tm.appendChunk('Speaker', 'start the meeting.', 'a', false);
    tm.appendChunk('Rahul G', 'start the meeting.', 'a', false);
    tm.appendChunk('Rahul G', 'start the meeting. I think.', 'a', false);
    tm.appendChunk('Rahul G', 'start the meeting. I guess we can start them now.', 'a', false);
    tm.commitTurn();

    const unique = [...new Set(ids)];
    assert.equal(unique.length, 1, `expected 1 turnId, got ${unique.join(',')}`);
    assert.equal(tm.buffer.length, 1);
    assert.equal(tm._normSpeakerName(tm.buffer[0].speaker), 'rahul g');
    assert.ok(tm.buffer[0].text.toLowerCase().includes('start them now'));
  });

  it('Dinesh interrupt then Rahul continues as one new turn (no ladder of copies)', () => {
    const tm = new TranscriptManager('t16');
    const ids = [];
    tm.on('transcript:update', (u) => { if (!u.isComplete) ids.push(u.turnId); });

    tm.appendChunk('Rahul G', 'start the meeting.', 'a', false);
    tm.appendChunk('Dinesh', 'Then we can start the meeting.', 'b', false);
    tm.commitTurn();

    const afterInterrupt = [...new Set(ids)];
    ids.length = 0;

    tm.appendChunk('Speaker', 'start the meeting.', 'c', false);
    tm.appendChunk('Rahul G', 'start the meeting.', 'c', false);
    tm.appendChunk('Rahul G', 'start the meeting. I think.', 'c', false);
    tm.appendChunk('Rahul G', 'start the meeting. I guess we can start them now.', 'c', false);
    tm.commitTurn();

    const rahulIds = [...new Set(ids)];
    assert.equal(rahulIds.length, 1, `Rahul post-interrupt should be 1 turnId, got ${rahulIds.join(',')}`);
    const turns = tm.buffer.filter((t) => t.text && t.text.trim());
    assert.ok(turns.length >= 2);
    assert.ok(!turns.some((t) => (turns.filter((x) => x.text === t.text).length > 2)));
  });
});
