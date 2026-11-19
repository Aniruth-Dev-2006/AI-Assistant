const { DeepgramClient } = require('@deepgram/sdk');
require('dotenv').config();

const BOT_NAME_RE = /^(xobin|xora|ai interview assistant|ai meet assistant)$/i;

class DeepgramSTT {
    constructor() {
        this.apiKey = process.env.DEEPGRAM_API_KEY;
        this.client = new DeepgramClient(this.apiKey);

        this.language = 'multi';
        this.connection = null;
        this.sampleRate = 16000;
        this.onTranscript = () => { };
        this.multichannel = false;
        this.speakerMode = 'dom';
        this.interviewerName = 'Interviewer';
        this.candidateName = '';
        this.botDisplayName = process.env.BOT_DISPLAY_NAME || 'Xobin';
        this._apiKeyOverride = null;

        this.currentActiveSpeaker = 'Speaker';
        this._sendCount = 0;
        this._blockCounter = 1000;
        this._forcedRole = null;
        this._closing = false;
        this.onPipelineError = () => {};
        this._channelNames = { 0: null, 1: null };
        this._lastDomSpeaker = '';
        this._lastDomAt = 0;
        this._lastChannelIndex = null;
    }

    _emitPipelineError(message) {
        const msg = String(message || '').trim();
        if (!msg) return;
        console.error('[Deepgram STT] Pipeline error:', msg);
        if (typeof this.onPipelineError === 'function') {
            try {
                this.onPipelineError(msg);
            } catch (e) {}
        }
    }

    _isGenericRoleName(name) {
        const n = String(name || '').trim().toLowerCase();
        return !n || n === 'interviewer' || n === 'candidate' || n === 'speaker' || /^speaker\s*\d*$/i.test(n);
    }

    setCandidate(name) {
        this.candidateName = name || '';
        if (this.candidateName && !this._isGenericRoleName(this.candidateName)) {
            this._channelNames[1] = this.candidateName;
        }
    }

    setInterviewer(name) {
        this.interviewerName = name || 'Interviewer';
        if (!this._isGenericRoleName(this.interviewerName)) {
            this._channelNames[0] = this.interviewerName;
        }
    }

    mapParticipants(participants) {
        const humans = (Array.isArray(participants) ? participants : [])
            .map((n) => String(n || '').replace(/\(Guest\)/gi, '').replace(/\(External\)/gi, '').trim())
            .filter((n) => n && !this._isBotName(n));
        if (!humans.length) return;

        if (this.candidateName) {
            const candNorm = this.candidateName.toLowerCase();
            const cand = humans.find((n) => n.toLowerCase() === candNorm) || this.candidateName;
            const other = humans.find((n) => n.toLowerCase() !== candNorm);
            if (cand && !this._isGenericRoleName(cand)) this._channelNames[1] = cand;
            if (other) this._channelNames[0] = other;
            console.log(`[Deepgram STT] Channel names from participants: ch0=${this._channelNames[0]} ch1=${this._channelNames[1]}`);
            return;
        }

        if (humans.length >= 1) this._channelNames[0] = this._channelNames[0] || humans[0];
        if (humans.length >= 2) this._channelNames[1] = this._channelNames[1] || humans[1];
        if (humans.length === 1 && !this.multichannel) {
            this.currentActiveSpeaker = humans[0];
        }
        console.log(`[Deepgram STT] Channel names from participants: ch0=${this._channelNames[0]} ch1=${this._channelNames[1]}`);
    }

    _isBotName(name) {
        const n = String(name || '').trim();
        if (!n) return true;
        if (BOT_NAME_RE.test(n)) return true;
        if (this.botDisplayName && n.toLowerCase() === String(this.botDisplayName).toLowerCase()) return true;
        if (/^xobin$/i.test(n)) return true;
        return false;
    }

    reportDomSpeaker(name) {
        if (this.speakerMode === 'acoustic') return;
        const cleaned = String(name || '')
            .replace(/\(Guest\)/gi, '')
            .replace(/\(External\)/gi, '')
            .replace(/\bformat_size\b/gi, '')
            .replace(/[''"]+\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!cleaned || this._isBotName(cleaned)) return;
        if (/^[a-z]+(_[a-z0-9]+)+$/i.test(cleaned)) return;

        this._lastDomSpeaker = cleaned;
        this._lastDomAt = Date.now();

        if (this.multichannel) {
            if (this._lastChannelIndex === 0 || this._lastChannelIndex === 1) {
                this._channelNames[this._lastChannelIndex] = cleaned;
            }
            if (typeof this.onSpeakerRenamed === 'function') {
                this.onSpeakerRenamed(null, cleaned);
            }
            return;
        }

        if (this._forcedRole === 'candidate' && this.candidateName) {
            this.currentActiveSpeaker = this.candidateName;
        } else if (this._forcedRole === 'interviewer' && this.interviewerName) {
            this.currentActiveSpeaker = this.interviewerName;
        } else {
            this.currentActiveSpeaker = cleaned;
        }

        if (typeof this.onSpeakerRenamed === 'function') {
            this.onSpeakerRenamed(null, this.currentActiveSpeaker);
        }
    }

    setForcedSpeaker(role) {
        if (this.multichannel || this.speakerMode === 'acoustic') return;
        if (role === 'candidate' || role === 'interviewer') {
            this._forcedRole = role;
            if (role === 'candidate' && this.candidateName) {
                this.currentActiveSpeaker = this.candidateName;
            } else if (role === 'interviewer') {
                this.currentActiveSpeaker = this.interviewerName || 'Interviewer';
            }
            console.log(`[Deepgram STT] Forced speaker role ${role} -> ${this.currentActiveSpeaker}`);
        } else {
            this._forcedRole = null;
            console.log('[Deepgram STT] Forced speaker cleared');
        }
    }

    resolveSpeaker(speakerId) {
        if (this.multichannel) {
            const ch = typeof speakerId === 'number' ? speakerId : 0;
            const learned = this._channelNames[ch];
            if (learned) return learned;

            const domFresh = this._lastDomSpeaker && (Date.now() - this._lastDomAt) < 4000;
            if (domFresh) return this._lastDomSpeaker;

            if (ch === 1 && this.candidateName && !this._isGenericRoleName(this.candidateName)) {
                return this.candidateName;
            }
            if (ch === 0 && this.interviewerName && !this._isGenericRoleName(this.interviewerName)) {
                return this.interviewerName;
            }
            return `Speaker ${ch}`;
        }
        if (this.speakerMode === 'acoustic') {
            const ch = typeof speakerId === 'number' ? speakerId % 2 : 0;
            const learned = this._channelNames[ch];
            if (learned) return learned;
            const domFresh = this._lastDomSpeaker && (Date.now() - this._lastDomAt) < 4000;
            if (domFresh) return this._lastDomSpeaker;
            return `Speaker ${ch}`;
        }
        return this.currentActiveSpeaker || this._lastDomSpeaker || 'Speaker';
    }

    _domSpeakerLabel() {
        if (this._forcedRole === 'candidate' && this.candidateName) return this.candidateName;
        if (this._forcedRole === 'interviewer') return this.interviewerName || 'Interviewer';
        return this.currentActiveSpeaker || this._lastDomSpeaker || 'Speaker';
    }

    async reconfigure(options = {}) {
        await this.closeConnection();
        this._sendCount = 0;
        await this.init(this._apiKeyOverride, options);
    }

    async closeConnection() {
        this._closing = true;
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        if (this._keepAliveTimer) {
            clearInterval(this._keepAliveTimer);
            this._keepAliveTimer = null;
        }
        const conn = this.connection;
        this.connection = null;
        try {
            if (conn && typeof conn.finish === 'function') conn.finish();
            else if (conn && typeof conn.close === 'function') conn.close();
            else if (conn && conn.socket && typeof conn.socket.close === 'function') conn.socket.close();
        } catch (e) {}
    }

    async init(customKey = null, options = {}) {
        this._closing = false;
        const prevSpeaker = this.currentActiveSpeaker;
        const prevDom = this._lastDomSpeaker;
        const prevDomAt = this._lastDomAt;
        const prevChannels = { ...(this._channelNames || {}) };

        this.multichannel = !!options.multichannel || options.speakerMode === 'multichannel';
        if (options.speakerMode === 'acoustic') this.speakerMode = 'acoustic';
        else if (this.multichannel) this.speakerMode = 'multichannel';
        else this.speakerMode = options.speakerMode || 'dom';
        this._warnedFakeStereo = false;

        const modeLabel = this.multichannel
            ? 'multichannel=2 (no diarize)'
            : this.speakerMode === 'acoustic'
                ? 'mono+acoustic-diarize (last-resort)'
                : `mono+dom (speakerMode=${this.speakerMode}, no diarize)`;
        console.log(`[Deepgram STT] Initializing Streaming connection (${modeLabel})...`);

        this._forcedRole = null;
        this._channelNames = {
            0: prevChannels[0] || null,
            1: prevChannels[1] || null
        };
        this._lastDomSpeaker = prevDom || '';
        this._lastDomAt = prevDomAt || 0;
        this._lastChannelIndex = null;

        if (prevSpeaker && !this._isGenericRoleName(prevSpeaker) && !this._isBotName(prevSpeaker)) {
            this.currentActiveSpeaker = prevSpeaker;
        } else if (prevDom && !this._isGenericRoleName(prevDom) && !this._isBotName(prevDom)) {
            this.currentActiveSpeaker = prevDom;
        } else if (!this.multichannel) {
            this.currentActiveSpeaker = 'Speaker';
        }

        if (customKey) {
            this._apiKeyOverride = customKey;
            this.apiKey = customKey;
            this.client = new DeepgramClient(this.apiKey);
        }

        if (!this.apiKey) {
            const msg = 'DEEPGRAM_API_KEY is missing';
            console.error('[Deepgram STT] FATAL:', msg);
            this._emitPipelineError(msg);
            return;
        }

        try {
            const connectOpts = {
                model: "nova-3",
                language: this.language || "multi",
                punctuate: "true",
                interim_results: "true",
                encoding: "linear16",
                sample_rate: this.sampleRate,
                smart_format: "true",
                endpointing: this.multichannel ? 500 : 300,
                utterance_end_ms: this.multichannel ? 1200 : 1000,
                keepalive: "true"
            };

            if (this.multichannel) {
                connectOpts.channels = 2;
                connectOpts.multichannel = "true";
            } else {
                connectOpts.channels = 1;
                if (this.speakerMode === 'acoustic') {
                    connectOpts.diarize = "true";
                }
            }

            this.connection = await this.client.listen.v1.connect(connectOpts);

            this.connection.on("open", () => {
                console.log("[Deepgram STT] WebSocket connection opened");
                if (this._keepAliveTimer) clearInterval(this._keepAliveTimer);
                this._keepAliveTimer = setInterval(() => {
                    if (this._closing || !this.connection) return;
                    try {
                        if (typeof this.connection.keepAlive === 'function') {
                            this.connection.keepAlive();
                        } else if (typeof this.connection.send === 'function') {
                            this.connection.send(JSON.stringify({ type: "KeepAlive" }));
                        }
                    } catch(e) {}
                }, 3000);
            });

            const handleResult = (result) => {
                if (this._closing || !this.connection) return;
                if (!result || result.type !== "Results" && !result.channel) return;

                const isFinal = result.is_final;
                const alt = result.channel?.alternatives?.[0];
                if (!alt) return;
                const transcript = alt.transcript;
                if (!transcript || transcript.trim() === '') return;

                if (!this._blockCounter) this._blockCounter = 1000;

                if (this.multichannel) {
                    const channelIndex = Array.isArray(result.channel_index)
                        ? result.channel_index[0]
                        : 0;
                    this._lastChannelIndex = channelIndex;
                    const domFresh = this._lastDomSpeaker && (Date.now() - this._lastDomAt) < 4000;
                    if (domFresh) {
                        this._channelNames[channelIndex] = this._lastDomSpeaker;
                    }
                    const speakerName = this.resolveSpeaker(channelIndex);
                    this.currentActiveSpeaker = speakerName;
                    if (!isFinal) {
                        this.onTranscript(speakerName, transcript.trim(), `interim_ch${channelIndex}_${this._blockCounter}`, false);
                        return;
                    }
                    const blockId = `dg_ch${channelIndex}_${this._blockCounter}`;
                    console.log(`[Deepgram STT] Final (${speakerName} <- channel ${channelIndex}): ${transcript.trim()}`);
                    this.onTranscript(speakerName, transcript.trim(), blockId, true);
                    this._blockCounter++;
                    return;
                }

                if (this.speakerMode === 'acoustic') {
                    let speakerId = 0;
                    if (alt.words && alt.words.length) {
                        const counts = new Map();
                        for (const w of alt.words) {
                            const s = typeof w.speaker === 'number' ? w.speaker : 0;
                            counts.set(s, (counts.get(s) || 0) + 1);
                        }
                        let best = 0;
                        let bestN = -1;
                        for (const [s, n] of counts) {
                            if (n > bestN) {
                                best = s;
                                bestN = n;
                            }
                        }
                        speakerId = best % 2;
                    }
                    const speakerName = this.resolveSpeaker(speakerId);
                    this.currentActiveSpeaker = speakerName;
                    if (!isFinal) {
                        this.onTranscript(speakerName, transcript.trim(), `interim_ac_${this._blockCounter}`, false);
                        return;
                    }
                    const blockId = `dg_ac_${this._blockCounter}_s${speakerId}`;
                    console.log(`[Deepgram STT] Final (${speakerName} <- acoustic): ${transcript.trim()}`);
                    this.onTranscript(speakerName, transcript.trim(), blockId, true);
                    this._blockCounter++;
                    return;
                }

                const speakerName = this._domSpeakerLabel();
                if (!isFinal) {
                    this.onTranscript(speakerName, transcript.trim(), `interim_${this._blockCounter}`, false);
                    return;
                }

                const blockId = `dg_dom_${this._blockCounter}`;
                console.log(`[Deepgram STT] Final (${speakerName} <- dom): ${transcript.trim()}`);
                this.onTranscript(speakerName, transcript.trim(), blockId, true);
                this._blockCounter++;
            };

            this.connection.on("message", (data) => {
                let result = data;
                if (typeof data === 'string') {
                    try { result = JSON.parse(data); } catch (e) { }
                }

                if (result.type === "Results") {
                    handleResult(result);
                } else if (result.type === "UtteranceEnd") {
                    console.log("[Deepgram STT] UtteranceEnd event received");
                    this._blockCounter++;
                } else if (result.type === "Error") {
                    console.error("[Deepgram STT] API Error:", result.message);
                    this._emitPipelineError(result.message || 'Deepgram API error');
                }
            });

            this.connection.on("Results", (data) => {
                handleResult(data);
            });

            this.connection.on("UtteranceEnd", () => {
                this._blockCounter++;
            });

            this.connection.on("error", (error) => {
                const msg = error && (error.message || String(error));
                console.error("[Deepgram STT] WebSocket Error:", msg);
                if (/401|403|unauthoriz|invalid.*key|quota|credit|billing/i.test(msg)) {
                    this._emitPipelineError(msg);
                }
            });

            this.connection.on("close", () => {
                if (this._closing) {
                    console.log("[Deepgram STT] Stream ended (intentional close).");
                    return;
                }
                console.log("[Deepgram STT] Stream ended unexpectedly.");
                if (this._reconnectTimer) return;
                this._reconnectTimer = setTimeout(() => {
                    this._reconnectTimer = null;
                    if (this._closing) return;
                    console.log("[Deepgram STT] Reconnecting after unexpected close...");
                    this.reconfigure({
                        multichannel: this.multichannel,
                        speakerMode: this.speakerMode
                    }).catch((e) => {
                        console.error("[Deepgram STT] Reconnect failed:", e.message);
                        this._emitPipelineError(e.message || 'Deepgram reconnect failed');
                    });
                }, 1200);
            });

            if (typeof this.connection.connect === 'function') {
                this.connection.connect();
            }
            if (typeof this.connection.waitForOpen === 'function') {
                await this.connection.waitForOpen();
            }

        } catch (e) {
            console.error('[Deepgram STT] Initialization failed:', e);
            this._emitPipelineError(e.message || 'Deepgram initialization failed');
        }
    }

    appendInterleavedInt16(int16Array) {
        if (!this.connection || !int16Array || !int16Array.length) return;
        if (!this.multichannel) return;
        if (this.connection.socket && this.connection.socket.readyState !== 1) return;

        this._lastInterleavedAt = Date.now();

        const buffer = Buffer.from(int16Array.buffer, int16Array.byteOffset, int16Array.byteLength);
        if (!this._sendCount) this._sendCount = 0;
        this._sendCount++;
        if (this._sendCount <= 3) {
            console.log(`[Deepgram STT] Sending multichannel chunk #${this._sendCount}, buffer size: ${buffer.length} bytes`);
        }
        try {
            if (this.connection.send) this.connection.send(buffer);
            else if (this.connection.socket && this.connection.socket.send) this.connection.socket.send(buffer);
        } catch (e) {
            console.error('[Deepgram STT] Send error:', e.message);
        }
    }

    appendAudioChunk(floatArray) {
        if (!this.connection) return;

        if (this.connection.socket && this.connection.socket.readyState !== 1) {
            return;
        }

        let int16Array;
        if (this.multichannel) {
            // Drop mixed audio while interleaved per-track PCM is flowing.
            if (this._lastInterleavedAt && Date.now() - this._lastInterleavedAt < 2000) {
                return;
            }
            // Do NOT fabricate stereo from mono — identical L/R audio makes Deepgram
            // emit both channels as speech and fragments the transcript by speaker.
            if (!this._warnedFakeStereo) {
                this._warnedFakeStereo = true;
                console.warn('[Deepgram STT] Multichannel mode has no bound tracks — requesting failover');
                this._emitPipelineError('multichannel_no_interleaved_audio');
            }
            return;
        }

        int16Array = new Int16Array(floatArray.length);
        for (let i = 0; i < floatArray.length; i++) {
            const s = Math.max(-1, Math.min(1, floatArray[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const buffer = Buffer.from(int16Array.buffer);

        if (!this._sendCount) this._sendCount = 0;
        this._sendCount++;
        if (this._sendCount <= 3) {
            console.log(`[Deepgram STT] Sending audio chunk #${this._sendCount}, buffer size: ${buffer.length} bytes`);
        }

        try {
            if (this.connection.send) {
                this.connection.send(buffer);
            } else if (this.connection.socket && this.connection.socket.send) {
                this.connection.socket.send(buffer);
            }
        } catch (e) {
            console.error('[Deepgram STT] Send error:', e.message);
        }
    }
}

module.exports = DeepgramSTT;
