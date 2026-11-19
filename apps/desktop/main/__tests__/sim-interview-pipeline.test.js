const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const DeepgramSTT = require('../stt-deepgram');
const TranscriptManager = require('../transcript-manager');

const SIM_DIALOGUES = require('../../../../tools/diarization-lab/sim-dialogues.json');

function slotForRole(role) {
  return role === 'candidate' ? 'Speaker 1' : 'Speaker 0';
}

function wordsOf(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean);
}

function takeWords(text, n) {
  return wordsOf(text).slice(0, n).join(' ');
}

function progressive(text, checkpoints) {
  const words = wordsOf(text);
  const out = [];
  for (const n of checkpoints) {
    if (n >= words.length) break;
    out.push({ text: words.slice(0, n).join(' '), isFinal: false });
  }
  out.push({ text, isFinal: true });
  return out;
}

class SimPipeline {
  constructor() {
    this.stt = new DeepgramSTT();
    this.stt.setInterviewer('Speaker 0');
    this.stt.setCandidate('Speaker 1');
    this.tm = new TranscriptManager('sim-interview');
    this.emitted = [];
    this.stt.onTranscript = (speaker, text, blockId, isFinal) => {
      this.emitted.push({ speaker, text, isFinal: !!isFinal });
      this.tm.appendChunk(speaker, text, blockId, isFinal);
    };
  }

  force(role) {
    this.stt.setForcedSpeaker(role || null);
  }

  speakForced(role, text, { checkpoints = [5, 12, 20] } = {}) {
    if (this.tm.currentTurnText) this.tm.commitTurn();
    this.force(role);
    const speaker = role === 'candidate' ? 'Speaker 1' : 'Speaker 0';
    this.stt.reportDomSpeaker(speaker);
    for (const chunk of progressive(text, checkpoints)) {
      this.stt.onTranscript(this.stt._domSpeakerLabel(), chunk.text, `sim_${Date.now()}_${Math.random()}`, chunk.isFinal);
    }
  }

  speakPartial(role, text, wordCount, { asFinal = true } = {}) {
    if (this.tm.currentTurnText) this.tm.commitTurn();
    this.force(role);
    const partial = takeWords(text, wordCount);
    const speaker = role === 'candidate' ? 'Speaker 1' : 'Speaker 0';
    this.stt.reportDomSpeaker(speaker);
    this.stt.onTranscript(this.stt._domSpeakerLabel(), partial, `partial_${Date.now()}`, asFinal);
    return partial;
  }

  injectRaw(speaker, text, isFinal = true) {
    this.tm.appendChunk(speaker, text, `raw_${Date.now()}`, isFinal);
  }

  done() {
    this.tm.commitTurn();
    return this.tm.buffer.filter((t) => t.text && t.text.trim());
  }

  context() {
    return this.tm.getContext().filter((t) => t.text && t.text.trim());
  }
}

function assertExclusive(turn, includes, excludes, label) {
  assert.equal(turn.speaker, includes.speaker, `${label} speaker`);
  for (const phrase of includes.phrases || []) {
    assert.ok(
      turn.text.toLowerCase().includes(phrase.toLowerCase()),
      `${label} missing "${phrase}" in "${turn.text}"`
    );
  }
  for (const phrase of excludes || []) {
    assert.ok(
      !turn.text.toLowerCase().includes(phrase.toLowerCase()),
      `${label} leaked "${phrase}" into "${turn.text}"`
    );
  }
}

function llmContextBlob(turns) {
  return turns.map((t) => `${t.speaker}: ${t.text}`).join('\n');
}

describe('Sim interview pipeline (extension dialogues)', () => {
  it('loads all 7 extension sim dialogues', () => {
    assert.equal(SIM_DIALOGUES.length, 7);
    assert.equal(SIM_DIALOGUES[0].role, 'interviewer');
    assert.equal(SIM_DIALOGUES[1].role, 'candidate');
    assert.ok(SIM_DIALOGUES[1].text.includes('Dinesh'));
    assert.ok(SIM_DIALOGUES[3].text.includes('Cohere'));
  });

  it('clean full interview stacks 7 turns with no cross-speaker leak', () => {
    const pipe = new SimPipeline();
    for (const step of SIM_DIALOGUES) {
      pipe.speakForced(step.role, step.text);
    }
    const turns = pipe.done();
    assert.equal(turns.length, 7, 'expected one turn per sim step');

    for (let i = 0; i < SIM_DIALOGUES.length; i++) {
      const step = SIM_DIALOGUES[i];
      const other = SIM_DIALOGUES.filter((s) => s.role !== step.role);
      assert.equal(turns[i].speaker, slotForRole(step.role), `step ${step.step} speaker`);
      assert.ok(
        turns[i].text.toLowerCase().includes(wordsOf(step.text).slice(0, 4).join(' ').toLowerCase()),
        `step ${step.step} should keep its own opening`
      );
      for (const o of other) {
        const marker = wordsOf(o.text).slice(0, 5).join(' ');
        if (marker.length < 12) continue;
        assert.ok(
          !turns[i].text.toLowerCase().includes(marker.toLowerCase()),
          `step ${step.step} leaked other opening "${marker}"`
        );
      }
    }

    const blob = llmContextBlob(turns);
    assert.ok(blob.includes('Speaker 0:'));
    assert.ok(blob.includes('Speaker 1:'));
    assert.ok(blob.includes('Qdrant'));
    assert.ok(blob.includes('PagedAttention'));
  });

  it('interrupt interviewer intro with candidate — each turn exclusive', () => {
    const intro = SIM_DIALOGUES[0];
    const answer = SIM_DIALOGUES[1];
    const pipe = new SimPipeline();

    const partial = pipe.speakPartial(intro.role, intro.text, 10, { asFinal: true });
    pipe.speakForced(answer.role, answer.text);

    const turns = pipe.done();
    assert.equal(turns.length, 2);

    assertExclusive(
      turns[0],
      { speaker: 'Speaker 0', phrases: ['Hi Alex', 'joining'] },
      ['Hi Dinesh', 'Qdrant', 'Llama'],
      'interrupted interviewer'
    );
    assertExclusive(
      turns[1],
      { speaker: 'Speaker 1', phrases: ['Hi Dinesh', 'RAG engine', 'QLoRA'] },
      ['Hi Alex', 'machine learning?'],
      'candidate after interrupt'
    );

    assert.ok(partial.split(/\s+/).length <= 10);
    assert.ok(!turns[0].text.includes('Qdrant'));
  });

  it('interrupt candidate mid-answer with next interviewer question', () => {
    const answer = SIM_DIALOGUES[1];
    const followup = SIM_DIALOGUES[2];
    const pipe = new SimPipeline();

    pipe.speakForced(SIM_DIALOGUES[0].role, SIM_DIALOGUES[0].text);
    pipe.speakPartial(answer.role, answer.text, 18, { asFinal: true });
    pipe.speakForced(followup.role, followup.text);

    const turns = pipe.done();
    assert.equal(turns.length, 3);

    assertExclusive(
      turns[0],
      { speaker: 'Speaker 0', phrases: ['Hi Alex'] },
      ['Hi Dinesh', 'hallucinations'],
      'full intro'
    );
    assertExclusive(
      turns[1],
      { speaker: 'Speaker 1', phrases: ['Hi Dinesh', 'computer science'] },
      ["That's great", 'hallucinations', 'embedding selection'],
      'partial candidate'
    );
    assertExclusive(
      turns[2],
      { speaker: 'Speaker 0', phrases: ["That's great", 'chunking', 'hallucinations'] },
      ['Hi Dinesh', 'QLoRA', 'Qdrant'],
      'interviewer follow-up'
    );
  });

  it('double interrupt S0 → S1 → S0 keeps three exclusive turns', () => {
    const pipe = new SimPipeline();
    pipe.speakPartial('interviewer', SIM_DIALOGUES[0].text, 8, { asFinal: true });
    pipe.speakPartial('candidate', SIM_DIALOGUES[1].text, 12, { asFinal: true });
    pipe.speakForced('interviewer', SIM_DIALOGUES[2].text);

    const turns = pipe.done();
    assert.equal(turns.length, 3);
    assert.equal(turns[0].speaker, 'Speaker 0');
    assert.equal(turns[1].speaker, 'Speaker 1');
    assert.equal(turns[2].speaker, 'Speaker 0');

    assert.ok(turns[0].text.toLowerCase().includes('hi alex'));
    assert.ok(!turns[0].text.toLowerCase().includes('dinesh'));
    assert.ok(turns[1].text.toLowerCase().includes('dinesh'));
    assert.ok(!turns[1].text.toLowerCase().includes("that's great"));
    assert.ok(turns[2].text.toLowerCase().includes('rag system'));
    assert.ok(!turns[2].text.toLowerCase().includes('dinesh'));
  });

  it('wrong-speaker interim during forced candidate does not glue interviewer text', () => {
    const pipe = new SimPipeline();
    pipe.speakForced('candidate', SIM_DIALOGUES[1].text);
    pipe.injectRaw('Speaker 0', SIM_DIALOGUES[2].text, false);
    pipe.speakForced('interviewer', SIM_DIALOGUES[2].text);

    const turns = pipe.done();
    assert.ok(turns.length >= 2);
    assertExclusive(
      turns[0],
      { speaker: 'Speaker 1', phrases: ['Hi Dinesh', 'LangChain'] },
      ["That's great", 'hallucinations during retrieval'],
      'candidate turn'
    );
    assertExclusive(
      turns[turns.length - 1],
      { speaker: 'Speaker 0', phrases: ["That's great", 'chunking'] },
      ['Hi Dinesh', 'LangChain'],
      'interviewer after'
    );
  });

  it('bleed copy on speaker change strips prior utterance from new turn', () => {
    const pipe = new SimPipeline();
    const a = SIM_DIALOGUES[0].text;
    const b = SIM_DIALOGUES[1].text;
    pipe.force('interviewer');
    pipe.stt.onTranscript('Speaker 0', a, 'a', true);
    pipe.force('candidate');
    pipe.stt.onTranscript('Speaker 1', `${takeWords(a, 8)} ${b}`, 'b', true);

    const turns = pipe.done();
    assert.equal(turns.length, 2);
    assert.ok(turns[1].text.toLowerCase().includes('dinesh'));
    assert.ok(!turns[1].text.toLowerCase().includes('hi alex, thanks for joining'));
  });

  it('LLM context alternates roles and keeps fingerprints per turn', () => {
    const pipe = new SimPipeline();
    for (const step of SIM_DIALOGUES.slice(0, 4)) {
      pipe.speakForced(step.role, step.text);
    }
    const ctx = pipe.done();
    assert.equal(ctx.length, 4);

    const fingerprints = [
      { i: 0, must: 'machine learning', mustNot: 'Qdrant' },
      { i: 1, must: 'Qdrant', mustNot: 'hallucinations during retrieval' },
      { i: 2, must: 'hallucinations', mustNot: 'Cohere reranker' },
      { i: 3, must: 'Cohere reranker', mustNot: 'Hi Alex' }
    ];

    for (const fp of fingerprints) {
      const t = ctx[fp.i];
      assert.ok(t.text.toLowerCase().includes(fp.must.toLowerCase()), `ctx[${fp.i}] missing ${fp.must}`);
      assert.ok(!t.text.toLowerCase().includes(fp.mustNot.toLowerCase()), `ctx[${fp.i}] has ${fp.mustNot}`);
    }

    const roles = ctx.map((t) => t.speaker);
    assert.deepEqual(roles, ['Speaker 0', 'Speaker 1', 'Speaker 0', 'Speaker 1']);
  });

  it('same-speaker back-to-back candidate steps stay separate turns after force re-entry', () => {
    const pipe = new SimPipeline();
    pipe.speakForced('candidate', SIM_DIALOGUES[5].text);
    pipe.force(null);
    pipe.force('candidate');
    pipe.speakForced('candidate', SIM_DIALOGUES[6].text);

    const turns = pipe.done();
    assert.ok(turns.length >= 1);
    const blob = turns.map((t) => t.text).join(' ');
    assert.ok(blob.includes('vLLM') || blob.toLowerCase().includes('vllm'));
    assert.ok(blob.toLowerCase().includes('deployment pipeline'));
  });
});
