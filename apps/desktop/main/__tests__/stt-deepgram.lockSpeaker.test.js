const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const DeepgramSTT = require('../stt-deepgram');

describe('DeepgramSTT DOM speaker mode', () => {
  it('reportDomSpeaker sets label used for finals', () => {
    const stt = new DeepgramSTT();
    const emitted = [];
    stt.onTranscript = (speaker, text, blockId, isFinal) => {
      emitted.push({ speaker, text, isFinal });
    };
    stt.multichannel = false;
    stt.speakerMode = 'dom';
    stt.reportDomSpeaker('Dinesh');

    const handle = (text, isFinal) => {
      const speakerName = stt._domSpeakerLabel();
      stt.onTranscript(speakerName, text, `t_${emitted.length}`, isFinal);
    };
    handle('Can you hear me?', true);
    stt.reportDomSpeaker('Monish');
    handle('Yes I can.', true);

    assert.equal(emitted.length, 2);
    assert.equal(emitted[0].speaker, 'Dinesh');
    assert.equal(emitted[1].speaker, 'Monish');
  });

  it('ignores bot display name', () => {
    const stt = new DeepgramSTT();
    stt.reportDomSpeaker('Dinesh');
    stt.reportDomSpeaker('Xobin');
    assert.equal(stt.currentActiveSpeaker, 'Dinesh');
  });

  it('forced candidate role uses candidate name', () => {
    const stt = new DeepgramSTT();
    stt.setCandidate('Monish');
    stt.setInterviewer('Dinesh');
    stt.setForcedSpeaker('candidate');
    assert.equal(stt._domSpeakerLabel(), 'Monish');
    stt.setForcedSpeaker('interviewer');
    assert.equal(stt._domSpeakerLabel(), 'Dinesh');
  });

  it('multichannel uses real names not generic Interviewer', () => {
    const stt = new DeepgramSTT();
    stt.multichannel = true;
    stt.setInterviewer('Interviewer');
    stt.setCandidate('pAVAN');
    assert.equal(stt.resolveSpeaker(1), 'pAVAN');
    assert.equal(stt.resolveSpeaker(0), 'Speaker 0');
    stt.mapParticipants(['Xobin', "Dinesh '", 'pAVAN']);
    assert.equal(stt.resolveSpeaker(0), "Dinesh '");
    assert.equal(stt.resolveSpeaker(1), 'pAVAN');
  });

  it('multichannel learns channel name from DOM speaker', () => {
    const stt = new DeepgramSTT();
    stt.multichannel = true;
    stt._lastChannelIndex = 0;
    stt.reportDomSpeaker("Dinesh '");
    assert.equal(stt.resolveSpeaker(0), "Dinesh '");
  });
});
