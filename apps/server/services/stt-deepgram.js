const { DeepgramClient } = require('@deepgram/sdk');
require('dotenv').config();

class DeepgramSTT {
    constructor() {
        this.apiKey = process.env.DEEPGRAM_API_KEY;
        this.client = this.apiKey ? new DeepgramClient(this.apiKey) : null;
        
        this.language = 'multi';
        this.connection = null;
        this.sampleRate = 16000;
        this.onTranscript = () => {};
        
        // Speaker Diarization Mapping
        this.speakerMap = new Map(); // speakerId (0, 1, 2) -> "Mystery Music", "Interviewer"
        this.speakerLockCount = new Map(); // speakerId -> sync vote count
        this.currentActiveDomSpeaker = null;
        this.candidateName = null;
        
        this._sendCount = 0;
        this._blockCounter = 1000; // Deepgram blockId counter
    }

    setCandidate(name) {
        this.candidateName = name ? name.trim() : null;
    }

    reportDomSpeaker(name) {
        if (!name || name === 'Speaker' || name.startsWith('Speaker ')) return;
        this.currentActiveDomSpeaker = name.trim();
    }

    getSpeakerLabel(speakerId) {
        return `Speaker ${speakerId + 1}`;
    }

    async init(customKey = null, customLanguage = null) {
        if (customKey) {
            this.apiKey = customKey;
        } else if (!this.apiKey) {
            this.apiKey = process.env.DEEPGRAM_API_KEY;
        }
        
        if (customLanguage) {
            this.language = customLanguage;
        }

        if (!this.apiKey) {
            console.warn('[Deepgram STT] DEEPGRAM_API_KEY is missing. Audio transcription will be disabled unless key is provided.');
            return;
        }

        this.client = new DeepgramClient(this.apiKey);
        console.log(`[Deepgram STT] Initializing Streaming connection (Model: nova-3, Language: ${this.language}, Diarization: ON)...`);

        try {
            this.connection = await this.client.listen.v1.connect({
                model: "nova-3",
                language: this.language || "multi",
                punctuate: "true",
                interim_results: "true",
                encoding: "linear16",
                sample_rate: this.sampleRate,
                channels: 1,
                diarize: "true",
                smart_format: "true",
                keepalive: "true"
            });

            this.connection.on("open", () => {
                console.log("[Deepgram STT] WebSocket connection opened with Speaker Diarization active.");
            });

            this.connection.on("message", (data) => {
                if (!data) return;

                if (data.type === "Results" || data.channel) {
                    const isFinal = data.is_final;
                    const alt = data.channel?.alternatives?.[0];
                    if (!alt) return;

                    const transcript = alt.transcript?.trim();
                    if (!transcript) return;

                    // Extract dominant speaker from diarized words
                    let speakerId = 0;
                    if (alt.words && alt.words.length > 0) {
                        const speakerCounts = {};
                        for (const w of alt.words) {
                            if (typeof w.speaker === 'number') {
                                speakerCounts[w.speaker] = (speakerCounts[w.speaker] || 0) + 1;
                            }
                        }
                        let maxCount = 0;
                        for (const [sId, count] of Object.entries(speakerCounts)) {
                            if (count > maxCount) {
                                maxCount = count;
                                speakerId = parseInt(sId, 10);
                            }
                        }
                    }

                    const speakerName = this.getSpeakerLabel(speakerId);
                    const blockId = `dg_${speakerId}_${this._blockCounter}`;

                    console.log(`[Deepgram STT] ${isFinal ? 'Final' : 'Interim'} [${speakerName}]: ${transcript}`);

                    if (isFinal) {
                        this._blockCounter++;
                    }

                    if (this.onTranscript) {
                        this.onTranscript(speakerName, transcript, blockId);
                    }
                } else if (data.type === "Error") {
                    console.error("[Deepgram STT] API Error:", data.message);
                }
            });

            this.connection.on("error", (error) => {
                console.error("[Deepgram STT] WebSocket Error:", error);
            });

            this.connection.on("close", () => {
                console.log("[Deepgram STT] Stream ended.");
            });

            if (typeof this.connection.connect === 'function') {
                this.connection.connect();
            }

        } catch (e) {
            console.error('[Deepgram STT] Initialization failed:', e);
        }
    }

    appendAudioChunk(floatArray) {
        if (!this.connection) return;

        const int16Array = new Int16Array(floatArray.length);
        for (let i = 0; i < floatArray.length; i++) {
            const s = Math.max(-1, Math.min(1, floatArray[i]));
            int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const buffer = Buffer.from(int16Array.buffer);

        if (!this._sendCount) this._sendCount = 0;
        this._sendCount++;

        if (this._sendCount === 1 || this._sendCount % 50 === 0) {
            console.log(`[Deepgram STT] Streaming audio chunk #${this._sendCount} (${buffer.length} bytes) to Deepgram socket...`);
        }

        try {
            if (typeof this.connection.sendMedia === 'function') {
                this.connection.sendMedia(buffer);
            } else if (typeof this.connection.sendBinary === 'function') {
                this.connection.sendBinary(buffer);
            } else if (this.connection.socket && this.connection.socket.send) {
                this.connection.socket.send(buffer);
            }
        } catch (e) {
            console.error('[Deepgram STT] Send error:', e.message);
        }
    }
}

module.exports = DeepgramSTT;
