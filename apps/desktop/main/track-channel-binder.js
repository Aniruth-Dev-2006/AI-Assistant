const AudioMuxer = require('./audio-muxer');

const RMS_LIVE = 0.008;
const REBIND_COOLDOWN_MS = 2500;

class TrackChannelBinder {
    constructor({ onInterleavedFrame = () => {} } = {}) {
        this.muxer = new AudioMuxer({ frameSamples: 1024, onFrame: onInterleavedFrame });
        this.tracks = new Map();
        this.slot0 = null;
        this.slot1 = null;
        this._lastRebindAt = 0;
    }

    reset() {
        this.tracks.clear();
        this.slot0 = null;
        this.slot1 = null;
        this._lastRebindAt = 0;
        this.muxer.reset();
    }

    close() {
        this.muxer.close();
        this.tracks.clear();
        this.slot0 = null;
        this.slot1 = null;
    }

    push(trackId, floatArray) {
        if (!trackId || !floatArray || !floatArray.length) return;

        let sum = 0;
        for (let i = 0; i < floatArray.length; i++) {
            const s = floatArray[i];
            sum += s * s;
        }
        const rms = Math.sqrt(sum / floatArray.length);
        let meta = this.tracks.get(trackId);
        if (!meta) {
            meta = { rmsEma: 0, peakRms: 0, lastTs: 0, firstTs: Date.now() };
            this.tracks.set(trackId, meta);
        }
        meta.rmsEma = meta.rmsEma * 0.85 + rms * 0.15;
        if (rms > meta.peakRms) meta.peakRms = rms;
        meta.lastTs = Date.now();

        this._maybeAssignSlots();
        this._maybeRebindQuietSlots();

        if (trackId === this.slot0) this.muxer.pushInterviewer(floatArray);
        else if (trackId === this.slot1) this.muxer.pushCandidate(floatArray);
    }

    boundSlotCount() {
        return (this.slot0 ? 1 : 0) + (this.slot1 ? 1 : 0);
    }

    activeTrackCount() {
        const now = Date.now();
        let n = 0;
        for (const meta of this.tracks.values()) {
            if (now - meta.lastTs < 10000) n++;
        }
        return n;
    }

    _recentTracks() {
        const now = Date.now();
        return [...this.tracks.entries()]
            .filter(([, m]) => now - m.lastTs < 10000)
            .sort((a, b) => {
                const liveA = a[1].rmsEma >= RMS_LIVE ? 1 : 0;
                const liveB = b[1].rmsEma >= RMS_LIVE ? 1 : 0;
                if (liveB !== liveA) return liveB - liveA;
                if (b[1].peakRms !== a[1].peakRms) return b[1].peakRms - a[1].peakRms;
                return a[1].firstTs - b[1].firstTs;
            });
    }

    _maybeAssignSlots() {
        if (this.slot0 && !this.tracks.has(this.slot0)) this.slot0 = null;
        if (this.slot1 && !this.tracks.has(this.slot1)) this.slot1 = null;

        const recent = this._recentTracks().filter(([, m]) => m.peakRms >= RMS_LIVE || m.rmsEma >= RMS_LIVE);
        for (const [id] of recent) {
            if (!this.slot0 && id !== this.slot1) {
                this.slot0 = id;
                console.log(`[TrackBinder] channel 0 (interviewer) <- track ${id}`);
            } else if (!this.slot1 && id !== this.slot0) {
                this.slot1 = id;
                console.log(`[TrackBinder] channel 1 (candidate) <- track ${id}`);
            }
            if (this.slot0 && this.slot1) break;
        }
    }

    _maybeRebindQuietSlots() {
        const now = Date.now();
        if (now - this._lastRebindAt < REBIND_COOLDOWN_MS) return;
        if (!this.slot0 && !this.slot1) return;

        const recent = this._recentTracks();
        const liveUnbound = recent.filter(([id, m]) =>
            id !== this.slot0 && id !== this.slot1 && m.rmsEma >= RMS_LIVE
        );
        if (!liveUnbound.length) return;

        const slotQuiet = (id) => {
            if (!id) return true;
            const m = this.tracks.get(id);
            return !m || m.rmsEma < RMS_LIVE;
        };

        let changed = false;
        if (slotQuiet(this.slot0) && liveUnbound.length) {
            const [id] = liveUnbound.shift();
            console.log(`[TrackBinder] rebind channel 0: ${this.slot0} → ${id} (prefer live audio)`);
            this.slot0 = id;
            changed = true;
        }
        if (slotQuiet(this.slot1) && liveUnbound.length) {
            const next = liveUnbound.find(([id]) => id !== this.slot0);
            if (next) {
                console.log(`[TrackBinder] rebind channel 1: ${this.slot1} → ${next[0]} (prefer live audio)`);
                this.slot1 = next[0];
                changed = true;
            }
        }
        if (changed) this._lastRebindAt = now;
    }
}

module.exports = TrackChannelBinder;
