let ipcMain;
try {
    ipcMain = require('electron').ipcMain;
} catch (e) {
    // Running in Node.js environment (no electron available)
}
const WebSocket = require('ws');
const crypto = require('crypto');

class TTSEngine {
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.isSpeaking = false;
        // Prioritize API_KEY_2 since API_KEY_1 is out of credits!
        const key = process.env.CARTESIA_API_KEY_2 || process.env.CARTESIA_API_KEY_1 || process.env.CARTESIA_API_KEY || ''; 
        this.apiKey = key.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    }

    _broadcastSpeakingState(active, botInstance) {
        this.mainWindow?.webContents?.send('bot:speaking', { active });
        try {
            const pubsubAdapter = require('../../server/services/pubsub-adapter');
            pubsubAdapter.publish('llm-results', {
                sessionId: botInstance ? botInstance.sessionId : 'local-session',
                channel: 'bot:speaking',
                payload: { active }
            }).catch(e => console.error('[TTS] PubSub Error:', e));
        } catch (e) {
            console.error('[TTS] Failed to broadcast speaking state:', e);
        }
    }

    async speak(text, botInstance) {
        if (this.isSpeaking) return;
        this.isSpeaking = true;
        this._broadcastSpeakingState(true, botInstance);
        
        console.log('[TTS] Agent speaking via Cartesia WebSocket:', text);

        if (!this.apiKey) {
            console.error('[TTS] No CARTESIA_API_KEY found! Falling back to mock delay.');
            return new Promise(resolve => setTimeout(() => {
                this.isSpeaking = false;
                this._broadcastSpeakingState(false, botInstance);
                if (botInstance) botInstance.setMicMuted(true);
                resolve();
            }, text.split(' ').length * 300));
        }

        return new Promise((resolve, reject) => {
            try {
                const wsUrl = `wss://api.cartesia.ai/tts/websocket?cartesia_version=2024-06-10`;
                const ws = new WebSocket(wsUrl, {
                    headers: { 'X-API-Key': this.apiKey }
                });

                const contextId = crypto.randomUUID();

                ws.on('open', () => {
                    console.log('[TTS] WebSocket connected');
                    ws.send(JSON.stringify({
                        context_id: contextId,
                        model_id: 'sonic-3.5',
                        transcript: text,
                        voice: {
                            mode: 'id',
                            id: 'f786b574-daa5-4673-aa0c-cbe3e8534c02' // Katie
                        },
                        output_format: {
                            container: 'raw',
                            encoding: 'pcm_f32le', // Float32 for WebAudio API
                            sample_rate: 44100
                        },
                        continue: false
                    }));
                });

                let totalSamples = 0;
                let firstChunkTimeMs = null;

                ws.on('message', async (dataStr) => {
                    const msg = JSON.parse(dataStr);
                    
                    if (msg.type === 'chunk' && msg.data) {
                        if (!firstChunkTimeMs) {
                            firstChunkTimeMs = Date.now();
                        }
                        
                        // msg.data is base64 encoded pcm_f32le
                        const buffer = Buffer.from(msg.data, 'base64');
                        const samples = buffer.byteLength / 4;
                        totalSamples += samples;
                        
                        // Push chunk into the Google Meet bot page for WebRTC injection
                        const targetPage = botInstance?.bot?.page || botInstance?.page;
                        if (targetPage) {
                            targetPage.evaluate((b64) => {
                                if (window.pushBotAudioChunkBase64) {
                                    window.pushBotAudioChunkBase64(b64);
                                }
                            }, msg.data).catch(e => console.error('[TTS] Error injecting audio chunk:', e));
                        }
                    } else if (msg.type === 'done') {
                        console.log('[TTS] Received done signal, waiting for audio playback to finish...');
                        
                        if (firstChunkTimeMs && totalSamples > 0) {
                            const playbackDurationMs = (totalSamples / 44100) * 1000;
                            const elapsedMs = Date.now() - firstChunkTimeMs;
                            // Add 800ms buffer to ensure final words aren't cut off due to slight network/IPC delays
                            const waitTime = playbackDurationMs - elapsedMs + 800;
                            
                            if (waitTime > 0) {
                                await new Promise(r => setTimeout(r, waitTime));
                            }
                        }
                        
                        this.isSpeaking = false;
                        this._broadcastSpeakingState(false, botInstance);
                        if (botInstance) botInstance.setMicMuted(true);
                        ws.close();
                    } else if (msg.type === 'error') {
                        console.error('[TTS] Cartesia WebSocket error:', msg.error);
                        this.isSpeaking = false;
                        this._broadcastSpeakingState(false, botInstance);
                        if (botInstance) botInstance.setMicMuted(true);
                        ws.close();
                    }
                });

                ws.on('close', () => {
                    console.log('[TTS] WebSocket closed');
                    this.isSpeaking = false;
                    resolve();
                });

                ws.on('error', (err) => {
                    console.error('[TTS] WebSocket connection error:', err);
                    this.isSpeaking = false;
                    reject(err);
                });

            } catch (error) {
                console.error('[TTS] Failed to start WebSocket:', error);
                this.isSpeaking = false;
                reject(error);
            }
        });
    }
}

module.exports = TTSEngine;
