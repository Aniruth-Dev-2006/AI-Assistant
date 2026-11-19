const EventEmitter = require('events');
const { SOURCES, PLATFORMS } = require('./constants');
const { ladderFor, detectPlatform } = require('./ladders');
const HealthMonitor = require('./health-monitor');

/**
 * Production transcript path: dom_mono only.
 * Mixed meeting audio + DOM active-speaker labels → Deepgram → TranscriptManager.
 * No CC / multichannel / acoustic failover (those caused duplicate turns).
 */
class TranscriptSourceCoordinator extends EventEmitter {
    constructor({
        platform,
        language = 'multi',
        onUtterance = () => {},
        onSourceChange = null
    } = {}) {
        super();
        this.platform = platform || PLATFORMS.UNKNOWN;
        this.language = language;
        this.ladder = ladderFor(this.platform, { language });
        this.health = new HealthMonitor();
        this.onUtterance = onUtterance;
        this.onSourceChange = onSourceChange;

        this.activeSource = SOURCES.DOM_MONO;
        this._closed = false;

        console.log(
            `[TranscriptSources] platform=${this.platform} source=${this.activeSource} (dom_mono only)`
        );
    }

    start() {}

    stop() {
        this._closed = true;
    }

    getActiveSource() {
        return SOURCES.DOM_MONO;
    }

    noteAudioFrame(isLive = false) {
        this.health.noteAudioFrame(isLive);
    }

    noteMeetTracksBound() {}
    noteMeetTracksSeen() {}
    noteMultichannelFailure() {}

    noteDomSpeaker(name) {
        this.health.noteDomSpeaker(name);
    }

    ingestStt(_sourceHint, speaker, text, blockId, isFinal) {
        if (this._closed || !text) return;
        if (isFinal) this.health.noteSttFinal();
        this.onUtterance(speaker, text, blockId, isFinal);
    }

    ingestCc() {
        // Intentionally ignored — CC dual-feed caused repeated turns.
    }

    evaluate() {}

    forceSource() {}
}

module.exports = TranscriptSourceCoordinator;
module.exports.SOURCES = SOURCES;
module.exports.PLATFORMS = PLATFORMS;
module.exports.detectPlatform = detectPlatform;
module.exports.ladderFor = ladderFor;
module.exports.HealthMonitor = HealthMonitor;
