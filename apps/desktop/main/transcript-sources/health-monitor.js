const { SOURCES } = require('./constants');

const MIN_AUDIO_FRAMES_FOR_DOM_PROBE = 40;
const MIN_STT_FINALS_FOR_DOM_PROBE = 3;

class HealthMonitor {
    constructor() {
        this.reset();
    }

    reset() {
        this.startedAt = Date.now();
        this.audioFrameCount = 0;
        this.lastAudioAt = 0;
        this.liveAudioFrameCount = 0;
        this.lastLiveAudioAt = 0;
        this.sttFinalCount = 0;
        this.lastSttFinalAt = 0;
        this.domHumanEver = false;
        this.domEventCount = 0;
        this.lastDomAt = 0;
        this.lastSourceChangeAt = 0;
    }

    noteAudioFrame(isLive = false) {
        this.audioFrameCount += 1;
        this.lastAudioAt = Date.now();
        if (isLive) {
            this.liveAudioFrameCount += 1;
            this.lastLiveAudioAt = Date.now();
        }
    }

    noteSttFinal() {
        this.sttFinalCount += 1;
        this.lastSttFinalAt = Date.now();
    }

    noteDomSpeaker(name) {
        const n = String(name || '').trim();
        if (!n || /^speaker(\s+\d+)?$/i.test(n)) return;
        this.domHumanEver = true;
        this.domEventCount += 1;
        this.lastDomAt = Date.now();
    }

    noteCc() {}
    noteMeetTracksBound() {}
    noteMeetTracksSeen() {}
    noteMultichannelFailure() {}

    snapshot() {
        const now = Date.now();
        return {
            ageMs: now - this.startedAt,
            audioFrameCount: this.audioFrameCount,
            audioFramesOk: this.audioFrameCount > 0 && (now - this.lastAudioAt) < 8000,
            audioEver: this.audioFrameCount > 0,
            liveAudioFrameCount: this.liveAudioFrameCount || 0,
            sttFinalCount: this.sttFinalCount,
            sttFinalsOk: this.sttFinalCount > 0 && (now - this.lastSttFinalAt) < 30000,
            domHumanEver: this.domHumanEver,
            domEventCount: this.domEventCount,
            ccNamedRecent: 0,
            ccHealthy: false,
            ccRecent: false,
            meetTracksBound: 0,
            meetTracksSeen: 0,
            multichannelFailed: false,
            multichannelFailureReason: ''
        };
    }

    isDomIdentityBroken(snap = this.snapshot()) {
        return (
            !snap.domHumanEver &&
            snap.audioFrameCount >= MIN_AUDIO_FRAMES_FOR_DOM_PROBE &&
            snap.sttFinalCount >= MIN_STT_FINALS_FOR_DOM_PROBE
        );
    }

    isMultichannelViable() {
        return false;
    }

    canChangeSource() {
        return false;
    }

    markSourceChanged() {
        this.lastSourceChangeAt = Date.now();
    }

    pickBest() {
        return SOURCES.DOM_MONO;
    }
}

module.exports = HealthMonitor;
module.exports.MIN_AUDIO_FRAMES_FOR_DOM_PROBE = MIN_AUDIO_FRAMES_FOR_DOM_PROBE;
module.exports.MIN_STT_FINALS_FOR_DOM_PROBE = MIN_STT_FINALS_FOR_DOM_PROBE;
module.exports.MIN_NAMED_CC_EVENTS = 3;
