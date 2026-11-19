const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    TranscriptSourceCoordinator,
    HealthMonitor,
    SOURCES,
    ladderFor,
    detectPlatform
} = require('../transcript-sources');

describe('transcript-sources ladders', () => {
    it('detects platforms', () => {
        assert.equal(detectPlatform('https://meet.google.com/abc'), 'gmeet');
        assert.equal(detectPlatform('https://us05web.zoom.us/j/1'), 'zoom');
        assert.equal(detectPlatform('https://teams.live.com/meet/1'), 'teams');
    });

    it('all platforms use dom_mono only', () => {
        assert.deepEqual(ladderFor('gmeet'), [SOURCES.DOM_MONO]);
        assert.deepEqual(ladderFor('zoom'), [SOURCES.DOM_MONO]);
        assert.deepEqual(ladderFor('teams', { language: 'en' }), [SOURCES.DOM_MONO]);
        assert.deepEqual(ladderFor('teams', { language: 'multi' }), [SOURCES.DOM_MONO]);
    });
});

describe('HealthMonitor', () => {
    it('tracks DOM speakers and STT finals', () => {
        const h = new HealthMonitor();
        h.noteDomSpeaker('Dinesh');
        h.noteAudioFrame(true);
        h.noteSttFinal();
        assert.equal(h.snapshot().domHumanEver, true);
        assert.equal(h.snapshot().sttFinalCount, 1);
        assert.equal(h.pickBest(), SOURCES.DOM_MONO);
        assert.equal(h.isMultichannelViable(), false);
    });
});

describe('TranscriptSourceCoordinator', () => {
    it('always stays on dom_mono and ignores CC', () => {
        const kept = [];
        const c = new TranscriptSourceCoordinator({
            platform: 'gmeet',
            language: 'multi',
            onUtterance: (speaker, text) => kept.push({ speaker, text })
        });
        assert.equal(c.getActiveSource(), SOURCES.DOM_MONO);
        c.ingestStt(SOURCES.DOM_MONO, 'Dinesh', 'hello', '1', true);
        c.ingestCc('Pavan', 'from captions', 'cc1', true);
        c.noteMeetTracksBound(4);
        c.evaluate();
        assert.equal(c.getActiveSource(), SOURCES.DOM_MONO);
        assert.equal(kept.length, 1);
        assert.equal(kept[0].speaker, 'Dinesh');
    });

    it('never promotes away from dom_mono', () => {
        const changes = [];
        const c = new TranscriptSourceCoordinator({
            platform: 'gmeet',
            onUtterance: () => {},
            onSourceChange: (e) => changes.push(e)
        });
        for (let i = 0; i < 100; i++) c.noteAudioFrame(true);
        for (let i = 0; i < 10; i++) c.ingestStt(SOURCES.DOM_MONO, 'Speaker', `line ${i}`, `b${i}`, true);
        c.noteMeetTracksBound(4);
        c.evaluate();
        assert.equal(c.getActiveSource(), SOURCES.DOM_MONO);
        assert.equal(changes.length, 0);
    });
});
