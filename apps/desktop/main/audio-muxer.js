class AudioMuxer {
    constructor({ frameSamples = 1024, onFrame = () => {} } = {}) {
        this.frameSamples = frameSamples;
        this.onFrame = onFrame;
        this.ch0 = [];
        this.ch1 = [];
        this._closed = false;
    }

    reset() {
        this.ch0 = [];
        this.ch1 = [];
        this._closed = false;
    }

    close() {
        this._closed = true;
        this.ch0 = [];
        this.ch1 = [];
    }

    pushInterviewer(floatArray) {
        if (this._closed || !floatArray || !floatArray.length) return;
        for (let i = 0; i < floatArray.length; i++) this.ch0.push(floatArray[i]);
        this._flush();
    }

    pushCandidate(floatArray) {
        if (this._closed || !floatArray || !floatArray.length) return;
        for (let i = 0; i < floatArray.length; i++) this.ch1.push(floatArray[i]);
        this._flush();
    }

    _flush() {
        while (this.ch0.length >= this.frameSamples || this.ch1.length >= this.frameSamples) {
            if (this.ch0.length < this.frameSamples && this.ch1.length < this.frameSamples) break;

            const n = this.frameSamples;
            const left = new Float32Array(n);
            const right = new Float32Array(n);

            if (this.ch0.length >= n) {
                for (let i = 0; i < n; i++) left[i] = this.ch0.shift();
            } else if (this.ch1.length >= n) {
                // interviewer late — pad silence on ch0
            }

            if (this.ch1.length >= n) {
                for (let i = 0; i < n; i++) right[i] = this.ch1.shift();
            } else if (this.ch0.length >= n || left.some((v) => v !== 0)) {
                // candidate late — pad silence on ch1 (already zeros)
            } else {
                break;
            }

            // Only emit when at least one side had real samples for this frame
            const hasAudio = left.some((v) => v !== 0) || right.some((v) => v !== 0);
            if (!hasAudio && this.ch0.length < n && this.ch1.length < n) break;

            const interleaved = new Int16Array(n * 2);
            for (let i = 0; i < n; i++) {
                interleaved[i * 2] = this._toInt16(left[i]);
                interleaved[i * 2 + 1] = this._toInt16(right[i]);
            }
            this.onFrame(interleaved);
        }
    }

    _toInt16(s) {
        const x = Math.max(-1, Math.min(1, s || 0));
        return x < 0 ? x * 0x8000 : x * 0x7fff;
    }
}

module.exports = AudioMuxer;
