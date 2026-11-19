const WebSocket = require('ws');

/**
 * DeepgramMultichannelSTT: Streams 2-channel linear16 PCM audio directly to Deepgram WebSocket.
 * Channel 0: User Mic
 * Channel 1: Meeting Participant Audio
 */
class DeepgramMultichannelSTT {
    constructor(apiKey, options = {}) {
        this.apiKey = apiKey || process.env.DEEPGRAM_API_KEY || '';
        this.sampleRate = options.sampleRate || 16000;
        this.language = options.language || 'multi';
        this.model = options.model || 'nova-3';
        
        this.ws = null;
        this.isConnected = false;
        this._keepAliveTimer = null;
        this._closing = false;
        
        this.onTranscript = options.onTranscript || (() => {});
        this.onError = options.onError || (() => {});
        this.onOpen = options.onOpen || (() => {});
        this.onClose = options.onClose || (() => {});
    }

    setApiKey(key) {
        this.apiKey = key;
    }

    connect() {
        if (!this.apiKey) {
            console.warn('[Deepgram STT] No DEEPGRAM_API_KEY provided; transcription will operate in mock/local mode.');
            return false;
        }

        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return true;
        }

        this._closing = false;
        const params = new URLSearchParams({
            model: this.model,
            language: this.language,
            punctuate: 'true',
            interim_results: 'true',
            encoding: 'linear16',
            sample_rate: String(this.sampleRate),
            smart_format: 'true',
            channels: '2',
            multichannel: 'true',
            endpointing: '500',
            utterance_end_ms: '1200'
        });

        const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
        console.log('[Deepgram STT] Connecting to multichannel WebSocket endpoint...');

        try {
            this.ws = new WebSocket(url, {
                headers: {
                    Authorization: `Token ${this.apiKey}`
                }
            });

            this.ws.on('open', () => {
                this.isConnected = true;
                console.log('[Deepgram STT] WebSocket connected. Real-time 2-channel audio streaming active.');
                this.onOpen();

                this._keepAliveTimer = setInterval(() => {
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
                    }
                }, 5000);
            });

            this.ws.on('message', (data) => {
                try {
                    const res = JSON.parse(data.toString());
                    if (res.type === 'Results' && res.channel && res.channel.alternatives?.[0]) {
                        const alt = res.channel.alternatives[0];
                        const text = alt.transcript;
                        if (!text || !text.trim()) return;

                        const channelIdx = Array.isArray(res.channel_index) ? res.channel_index[0] : 0;
                        const isFinal = !!res.is_final;
                        const speaker = channelIdx === 0 ? 'You' : 'Participant';

                        this.onTranscript({
                            channel: channelIdx,
                            speaker,
                            text: text.trim(),
                            isFinal,
                            timestamp: Date.now()
                        });
                    }
                } catch (e) {
                    console.error('[Deepgram STT] Failed to parse message:', e.message);
                }
            });

            this.ws.on('error', (err) => {
                console.error('[Deepgram STT] WebSocket error:', err.message);
                this.onError(err);
            });

            this.ws.on('close', (code, reason) => {
                this.isConnected = false;
                if (this._keepAliveTimer) {
                    clearInterval(this._keepAliveTimer);
                    this._keepAliveTimer = null;
                }
                console.log(`[Deepgram STT] Connection closed (${code}: ${reason})`);
                this.onClose();
            });

            return true;
        } catch (err) {
            console.error('[Deepgram STT] Initialization failed:', err.message);
            this.onError(err);
            return false;
        }
    }

    sendAudio(buffer) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        try {
            this.ws.send(buffer);
        } catch (err) {
            console.warn('[Deepgram STT] Audio send failed:', err.message);
        }
    }

    close() {
        this._closing = true;
        if (this._keepAliveTimer) {
            clearInterval(this._keepAliveTimer);
            this._keepAliveTimer = null;
        }
        if (this.ws) {
            try {
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({ type: 'CloseStream' }));
                    this.ws.close();
                }
            } catch (e) {}
            this.ws = null;
        }
        this.isConnected = false;
    }
}

module.exports = DeepgramMultichannelSTT;
