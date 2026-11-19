const WebSocket = require('ws');
const { net } = require('electron'); // For HTTP requests
const EventEmitter = require('events');

class HybridClient extends EventEmitter {
    constructor(apiBaseUrl) {
        super();
        this.apiBaseUrl = apiBaseUrl || 'http://localhost:8080';
        this.wsUrl = this.apiBaseUrl.replace('http', 'ws');
        this.jwtToken = null;
        this.sessionId = null;
        this.ws = null;
    }

    setToken(token) {
        this.jwtToken = token;
    }

    async startSession(meetingUrl, language, candidateName) {
        if (!this.jwtToken) throw new Error('Not authenticated');

        const request = net.request({
            method: 'POST',
            url: `${this.apiBaseUrl}/sessions/start`,
        });
        request.setHeader('Authorization', `Bearer ${this.jwtToken}`);
        request.setHeader('Content-Type', 'application/json');

        return new Promise((resolve, reject) => {
            request.on('response', (response) => {
                let data = '';
                response.on('data', chunk => data += chunk.toString());
                response.on('end', () => {
                    if (response.statusCode >= 200 && response.statusCode < 300) {
                        try {
                            const result = JSON.parse(data);
                            this.sessionId = result.sessionId;
                            this._connectWebSocket();
                            resolve(result);
                        } catch (e) {
                            reject(e);
                        }
                    } else {
                        reject(new Error(`API Error ${response.statusCode}: ${data}`));
                    }
                });
            });
            
            request.on('error', (err) => reject(err));
            
            request.write(JSON.stringify({
                url: meetingUrl,
                language,
                candidateName,
                botLocation: 'local' // Tell API we are handling the bot locally
            }));
            request.end();
        });
    }

    async stopSession() {
        if (!this.sessionId || !this.jwtToken) return;

        const request = net.request({
            method: 'POST',
            url: `${this.apiBaseUrl}/sessions/${this.sessionId}/stop`,
        });
        request.setHeader('Authorization', `Bearer ${this.jwtToken}`);

        return new Promise((resolve, reject) => {
            request.on('response', (response) => {
                if (response.statusCode === 200) {
                    if (this.ws) {
                        this.ws.close();
                        this.ws = null;
                    }
                    this.sessionId = null;
                    resolve(true);
                } else {
                    reject(new Error(`API Error ${response.statusCode}`));
                }
            });
            request.on('error', (err) => reject(err));
            request.end();
        });
    }

    async postTranscript(turnData) {
        if (!this.sessionId || !this.jwtToken) return;

        const request = net.request({
            method: 'POST',
            url: `${this.apiBaseUrl}/sessions/${this.sessionId}/transcript`,
        });
        request.setHeader('Authorization', `Bearer ${this.jwtToken}`);
        request.setHeader('Content-Type', 'application/json');

        return new Promise((resolve, reject) => {
            request.on('response', (response) => {
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    resolve(true);
                } else {
                    reject(new Error(`API Error ${response.statusCode}`));
                }
            });
            request.on('error', (err) => reject(err));
            request.write(JSON.stringify(turnData));
            request.end();
        });
    }

    async postAsk(payload) {
        if (!this.sessionId || !this.jwtToken) return;

        const request = net.request({
            method: 'POST',
            url: `${this.apiBaseUrl}/sessions/${this.sessionId}/ask`,
        });
        request.setHeader('Authorization', `Bearer ${this.jwtToken}`);
        request.setHeader('Content-Type', 'application/json');

        return new Promise((resolve, reject) => {
            request.on('response', (response) => {
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    resolve(true);
                } else {
                    reject(new Error(`API Error ${response.statusCode}`));
                }
            });
            request.on('error', (err) => reject(err));
            request.write(JSON.stringify(payload));
            request.end();
        });
    }

    _connectWebSocket() {
        if (!this.sessionId) return;
        
        this.ws = new WebSocket(`${this.wsUrl}/ws?sessionId=${this.sessionId}`);

        this.ws.on('open', () => {
            console.log('[HybridClient] Connected to API WebSocket room for session', this.sessionId);
        });

        this.ws.on('message', (messageStr) => {
            try {
                const data = JSON.parse(messageStr);
                // Emit events received from Cloud Tasks/PubSub down to the desktop UI
                this.emit(data.channel, data.data || data.payload);
            } catch (e) {
                console.error('[HybridClient] Failed to parse WS message:', e);
            }
        });

        this.ws.on('close', () => {
            console.log('[HybridClient] Disconnected from API WebSocket');
        });
    }
    async getSttKey() {
        if (!this.jwtToken) throw new Error('Not authenticated');

        const request = net.request({
            method: 'GET',
            url: `${this.apiBaseUrl}/sessions/stt-key`,
        });
        request.setHeader('Authorization', `Bearer ${this.jwtToken}`);

        return new Promise((resolve, reject) => {
            request.on('response', (response) => {
                let data = '';
                response.on('data', chunk => data += chunk.toString());
                response.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.key) resolve(parsed.key);
                        else reject(new Error(parsed.error || 'Failed to fetch STT key'));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            request.on('error', reject);
            request.end();
        });
    }
}

module.exports = HybridClient;
