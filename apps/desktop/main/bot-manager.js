const GoogleMeetBot = require('../../bot/platforms/google-meet');
const ZoomBot = require('../../bot/platforms/zoom');
const TeamsBot = require('../../bot/platforms/teams');
const DeepgramSTT = require('./stt-deepgram');
const TTSEngine = require('./tts-engine');
const TranscriptManager = require('./transcript-manager');
const {
    TranscriptSourceCoordinator,
    SOURCES,
    detectPlatform
} = require('./transcript-sources');
const EventEmitter = require('events');

class BotManager extends EventEmitter {
    constructor(sessionId, ttsEngine, transcriptManager) {
        super();
        this.sessionId = sessionId;
        this.interviewerNotes = '';
        this.bot = null;
        this.stt = new DeepgramSTT();
        this.trackBinder = null;
        this.coordinator = null;
        this._sourceSwitching = false;

        this.tts = ttsEngine || new TTSEngine();
        this.transcriptManager = transcriptManager || new TranscriptManager(this.sessionId);

        this.isRecording = false;
        this.isStarting = false;
        this._participantsInterval = null;
        this._aloneSince = null;
        this._hadHumans = false;
        this._joinedAt = 0;
        this._endingAlone = false;

        this.transcriptManager.on('turn:complete', (turn) => {
            this.emit('turn:complete', turn);
        });
        this.transcriptManager.on('transcript:update', (data) => {
            this.emit('transcript:update', data);
        });
    }

    _sttSourceHint() {
        return SOURCES.DOM_MONO;
    }

    _wireSttToCoordinator() {
        this.stt.onTranscript = (speakerId, text, blockId, isFinal) => {
            if (!this.coordinator) {
                this.transcriptManager.appendChunk(speakerId, text, blockId, isFinal);
                return;
            }
            this.coordinator.ingestStt(SOURCES.DOM_MONO, speakerId, text, blockId, isFinal);
        };
        this.stt.onSpeakerRenamed = (speakerId, realName) => {
            this.transcriptManager.updateCurrentSpeakerName(realName);
        };
        this.stt.onPipelineError = () => {};
    }

    async _applySourcePipeline() {
        if (this._sourceSwitching) return;
        this._sourceSwitching = true;
        try {
            if (this.trackBinder) {
                this.trackBinder.close();
                this.trackBinder = null;
            }
            this._wireAudioHandlers();
            if (this.stt.speakerMode !== 'dom' || this.stt.multichannel) {
                await this.stt.reconfigure({ multichannel: false, speakerMode: 'dom' });
                this._wireSttToCoordinator();
            }
        } finally {
            this._sourceSwitching = false;
        }
    }

    _wireAudioHandlers() {
        if (!this.bot) return;

        this.bot.onAudioChunk = (floatArray) => {
            if (!floatArray || !floatArray.length) return;
            if (this.coordinator) {
                let sum = 0;
                for (let i = 0; i < floatArray.length; i++) {
                    sum += floatArray[i] * floatArray[i];
                }
                const rms = Math.sqrt(sum / floatArray.length);
                this.coordinator.noteAudioFrame(rms > 0.008);
            }
            this.stt.appendAudioChunk(floatArray);
        };

        this.bot.onAudioTrackChunk = () => {};
    }

    async startSession(meetingUrl, language, interviewerName = 'Interviewer', deepgramKey = null, candidateName = null) {
        if (this.isRecording || this.isStarting) {
            console.log('[BotManager] Session already running or starting.');
            return;
        }

        this.isStarting = true;
        this.meetingUrl = meetingUrl;
        if (candidateName) {
            this.candidateName = candidateName;
        }
        try {
            const platform = detectPlatform(meetingUrl);

            this.coordinator = new TranscriptSourceCoordinator({
                platform,
                language: language || 'multi',
                onUtterance: (speaker, text, blockId, isFinal) => {
                    this.transcriptManager.appendChunk(speaker, text, blockId, isFinal);
                }
            });
            this.coordinator.start();

            console.log(
                '[BotManager] Starting new session for:',
                meetingUrl,
                'Language:', language,
                'Interviewer:', interviewerName,
                'Candidate:', this.candidateName,
                'Platform:', platform,
                'ActiveSource:', SOURCES.DOM_MONO
            );

            if (language) this.stt.language = language;
            this.stt.setInterviewer(interviewerName);
            if (this.candidateName) {
                this.stt.setCandidate(this.candidateName);
                this.transcriptManager.setCandidate(this.candidateName);
            }

            await this.stt.init(deepgramKey, {
                multichannel: false,
                speakerMode: 'dom'
            });
            this._wireSttToCoordinator();

            let BotClass = GoogleMeetBot;
            if (platform === 'zoom') BotClass = ZoomBot;
            else if (platform === 'teams') BotClass = TeamsBot;

            this.bot = new BotClass({
                meetingUrl: meetingUrl,
                botName: this.botDisplayName || process.env.BOT_DISPLAY_NAME || 'Xobin',
                executablePath: process.env.BROWSER_EXECUTABLE_PATH
            });

            await this.bot.init();
            await this._applySourcePipeline();

            // CC intentionally not wired — dual STT+CC feed caused repeated turns.
            this.bot.onTranscript = () => {};

            this.bot.onActiveSpeaker = (speakerName) => {
                if (this.coordinator) this.coordinator.noteDomSpeaker(speakerName);
                this.transcriptManager.onDomSpeakerChange(speakerName);
                this.stt.reportDomSpeaker(speakerName);
            };

            this.bot.onParticipantsUpdate = (participants) => {
                const list = Array.isArray(participants) ? participants : [];
                if (!list.length && Array.isArray(this._lastParticipants) && this._lastParticipants.length) {
                    this._maybeEndIfAlone([]);
                    return;
                }
                this.bot._lastParticipants = list;
                if (this.stt && typeof this.stt.mapParticipants === 'function') {
                    this.stt.mapParticipants(list);
                }
                this.emit('participants:update', list);
                this._maybeEndIfAlone(list);
                this._lastParticipants = list;
            };

            this.bot.onMeetingEnded = () => {
                if (!this.isRecording) return;
                console.log('[BotManager] Call ended in the meeting. Stopping session...');
                this.stopSession().catch((e) => console.error('[BotManager] Auto-stop failed:', e.message));
            };

            await this.bot.join();
            if (this.bot && typeof this.bot.startMeetingEndWatcher === 'function') {
                this.bot.startMeetingEndWatcher();
            }

            this.isRecording = true;
            this.isStarting = false;
            this._joinedAt = Date.now();
            this._aloneSince = null;
            this._hadHumans = false;
            this._endingAlone = false;

            this.emit('session:started');
            console.log('[BotManager] Session successfully started and bot joined.');

            this._participantsInterval = setInterval(() => {
                if (this.bot) this.requestParticipants();
            }, 5000);

            setTimeout(() => this.requestParticipants(), 3000);

        } catch (error) {
            this.isStarting = false;
            this.isRecording = false;
            console.error('[BotManager] Error starting session:', error);
            this.emit('session:error', { message: error.message });
            throw error;
        }
    }

    _isBotParticipantName(name) {
        const n = String(name || '')
            .replace(/\(You\)/gi, '')
            .replace(/\(Me\)/gi, '')
            .replace(/\(Host,\s*me\)/gi, '')
            .replace(/\(Host\)/gi, '')
            .replace(/\(Co-host\)/gi, '')
            .trim();
        if (!n) return true;
        const bot = String(process.env.BOT_DISPLAY_NAME || 'Xobin').trim();
        if (bot && n.toLowerCase() === bot.toLowerCase()) return true;
        return /^(xobin|xora|ai interview assistant|ai meet assistant)$/i.test(n);
    }

    _humanParticipantCount(participants) {
        const list = Array.isArray(participants) ? participants : [];
        let n = 0;
        for (const p of list) {
            const name = typeof p === 'string' ? p : (p && p.name);
            if (!this._isBotParticipantName(name)) n += 1;
        }
        return n;
    }

    _maybeEndIfAlone(participants) {
        if (!this.isRecording || this._endingAlone) return;
        if (this.bot && this.bot.inLobby && !this.bot.admitted) return;
        if (this.bot && this.bot.admitted === false) {
            const lobbyGraceMs = 130000;
            if (Date.now() - (this._joinedAt || Date.now()) < lobbyGraceMs) return;
        }

        const list = Array.isArray(participants) ? participants : [];
        // Empty scrape usually means the Participants panel closed / DOM failed — not that humans left.
        if (list.length === 0) {
            this._emptyParticipantScrapes = (this._emptyParticipantScrapes || 0) + 1;
            if (this._emptyParticipantScrapes === 1 || this._emptyParticipantScrapes % 6 === 0) {
                console.log(`[BotManager] Empty participant scrape (#${this._emptyParticipantScrapes}) — treating as UI miss, not alone.`);
            }
            if (this.bot && typeof this.bot.openParticipantsPanel === 'function' && this._emptyParticipantScrapes % 3 === 1) {
                this.bot.openParticipantsPanel().catch(() => {});
            }
            return;
        }
        this._emptyParticipantScrapes = 0;

        const humans = this._humanParticipantCount(list);
        const now = Date.now();
        const graceMs = 45000;
        const aloneHoldMs = 180000;

        if (humans > 0) {
            this._hadHumans = true;
            this._aloneSince = null;
            return;
        }

        // Only bot visible in a successful scrape
        if (!this._hadHumans && now - (this._joinedAt || now) < graceMs) return;

        if (!this._aloneSince) {
            this._aloneSince = now;
            console.log('[BotManager] Only bot visible in participants — waiting before auto-end…');
            return;
        }

        if (now - this._aloneSince < aloneHoldMs) return;

        this._endingAlone = true;
        console.log('[BotManager] Alone in meeting (humans left). Ending session + report…');
        this.stopSession().catch((e) => {
            this._endingAlone = false;
            console.error('[BotManager] Alone-end stop failed:', e.message);
        });
    }

    async requestParticipants() {
        if (this.bot && typeof this.bot.getParticipants === 'function') {
            try {
                const list = await this.bot.getParticipants();
                const names = Array.isArray(list) ? list : [];
                if (!names.length && Array.isArray(this._lastParticipants) && this._lastParticipants.length) {
                    this._maybeEndIfAlone([]);
                    return;
                }
                if (this.bot) this.bot._lastParticipants = names;
                this._lastParticipants = names;
                this.emit('participants:update', names);
                this._maybeEndIfAlone(names);
            } catch (e) {
                console.error('[BotManager] Failed to request participants:', e.message);
            }
        } else if (this.bot) {
            const list = await this.bot.getParticipants();
            this._lastParticipants = Array.isArray(list) ? list : [];
            this.emit('participants:update', list);
            this._maybeEndIfAlone(list);
        } else {
            this.emit('participants:update', { error: 'Please wait for the bot to join the meeting.' });
        }
    }

    async stopSession() {
        if (!this.isRecording) return;

        console.log('[BotManager] Stopping session...');
        this.isRecording = false;

        if (this._participantsInterval) {
            clearInterval(this._participantsInterval);
            this._participantsInterval = null;
        }

        if (this.coordinator) {
            this.coordinator.stop();
            this.coordinator = null;
        }

        if (this.trackBinder) {
            this.trackBinder.close();
            this.trackBinder = null;
        }

        if (this.stt) {
            await this.stt.closeConnection().catch(() => {});
        }

        if (this.bot) {
            await this.bot.close();
            this.bot = null;
        }

        await this.transcriptManager.commitTurn();

        this.emit('session:stopped');
        console.log('[BotManager] Session stopped.');
    }

    async speakQuestion(text) {
        if (!this.bot || !this.isRecording) {
            console.log('[BotManager] Cannot speak, bot is not active.');
            return;
        }

        console.log('[BotManager] Unmuting bot to speak...');
        await this.bot.setMicMuted(false);
        await new Promise(r => setTimeout(r, 500));
        await this.tts.speak(text, this);
        console.log('[BotManager] Muting bot after speaking.');
        await this.bot.setMicMuted(true);
    }

    async setMicMuted(mute) {
        if (this.bot && typeof this.bot.setMicMuted === 'function') {
            await this.bot.setMicMuted(mute);
        }
    }
}

module.exports = BotManager;
