// This script is injected into the meeting page before any other scripts load.
// It monkey-patches the WebRTC API to extract audio streams.

(function () {
    console.log('[Bot Interceptor] WebRTC Interceptor injected.');
    const OriginalRTCPeerConnection = window.RTCPeerConnection;

    // Save the native AudioContext BEFORE Google Meet can monkey-patch it.
    // We only use this for the getUserMedia bot-audio-output, NOT for capturing.
    const NativeAudioContext = window.AudioContext || window.webkitAudioContext;

    window.botAudioTrack = null;
    window.__botPCs = []; // Store all PeerConnections for periodic polling
    window.__botInterceptedTracks = new Set(); // Track IDs we've already processed
    window.__botRecorders = []; // Keep references to prevent GC
    window.__botDiagPcSeq = 0;
    window.__botDiagCapturePaths = [];
    window.__botDiagLastSdp = null;

    function diagEnabled() {
        return !!window.__DEBUG_WEBRTC_AUDIO;
    }

    function summarizeSdp(sdp) {
        if (!sdp || typeof sdp !== 'string') {
            return { audioMLines: 0, recvonlyAudio: 0, sendrecvAudio: 0, sendonlyAudio: 0, ssrcs: [], msids: [], note: 'no-sdp' };
        }
        const lines = sdp.split(/\r?\n/);
        let audioMLines = 0;
        let recvonlyAudio = 0;
        let sendrecvAudio = 0;
        let sendonlyAudio = 0;
        let inAudio = false;
        const ssrcs = new Set();
        const msids = new Set();
        for (const line of lines) {
            if (line.startsWith('m=')) {
                inAudio = line.startsWith('m=audio');
                if (inAudio) audioMLines++;
            }
            if (!inAudio) continue;
            if (line === 'a=recvonly') recvonlyAudio++;
            if (line === 'a=sendrecv') sendrecvAudio++;
            if (line === 'a=sendonly') sendonlyAudio++;
            const ssrcMatch = line.match(/^a=ssrc:(\d+)/);
            if (ssrcMatch) ssrcs.add(ssrcMatch[1]);
            const msidMatch = line.match(/^a=msid:(\S+)/);
            if (msidMatch) msids.add(msidMatch[1]);
            const ssrcMsid = line.match(/msid:(\S+)/);
            if (ssrcMsid) msids.add(ssrcMsid[1]);
        }
        return {
            audioMLines,
            recvonlyAudio,
            sendrecvAudio,
            sendonlyAudio,
            ssrcCount: ssrcs.size,
            ssrcs: Array.from(ssrcs).slice(0, 12),
            msidCount: msids.size,
            msids: Array.from(msids).slice(0, 12)
        };
    }

    function mapSources(list) {
        if (!list || !list.length) return [];
        return list.map((s) => ({
            source: s.source,
            timestamp: s.timestamp,
            rtpTimestamp: s.rtpTimestamp,
            audioLevel: typeof s.audioLevel === 'number' ? Number(s.audioLevel.toFixed(4)) : undefined
        }));
    }

    function snapshotPeerConnection(pc) {
        if (!pc || typeof pc.getReceivers !== 'function') return null;
        const pcId = pc.__botDiagId || 'unknown';
        const receivers = [];
        let audioTrackCount = 0;
        try {
            const list = pc.getReceivers() || [];
            const transceivers = (typeof pc.getTransceivers === 'function') ? pc.getTransceivers() : [];
            list.forEach((receiver, idx) => {
                const track = receiver.track;
                const kind = (track && track.kind) || receiver.track?.kind || 'unknown';
                if (kind === 'audio') audioTrackCount++;
                let mid = null;
                let direction = null;
                let currentDirection = null;
                const match = transceivers.find((t) => t.receiver === receiver);
                if (match) {
                    mid = match.mid;
                    direction = match.direction;
                    currentDirection = match.currentDirection;
                }
                let syncSources = [];
                let contribSources = [];
                try {
                    if (typeof receiver.getSynchronizationSources === 'function') {
                        syncSources = mapSources(receiver.getSynchronizationSources());
                    }
                } catch (e) { }
                try {
                    if (typeof receiver.getContributingSources === 'function') {
                        contribSources = mapSources(receiver.getContributingSources());
                    }
                } catch (e) { }
                receivers.push({
                    receiver: idx,
                    kind,
                    trackId: track ? track.id : null,
                    label: track ? track.label : null,
                    readyState: track ? track.readyState : null,
                    muted: track ? track.muted : null,
                    mid,
                    direction,
                    currentDirection,
                    syncSources,
                    contribSources
                });
            });
        } catch (e) {
            return { pcId, error: e.message };
        }
        return {
            pcId,
            signalingState: pc.signalingState,
            connectionState: pc.connectionState || null,
            iceConnectionState: pc.iceConnectionState,
            hasLocalDescription: !!pc.localDescription,
            hasRemoteDescription: !!pc.remoteDescription,
            receiverCount: receivers.length,
            audioTrackCount,
            receivers
        };
    }

    function emitDiag(reason) {
        if (!diagEnabled()) return;
        const peerConnections = (window.__botPCs || [])
            .filter((pc) => pc && pc.signalingState !== 'closed')
            .map(snapshotPeerConnection)
            .filter(Boolean);
        const payload = {
            ts: Date.now(),
            reason,
            platform: window.__BOT_PLATFORM || 'unknown',
            meetingUrl: window.__BOT_MEETING_URL || '',
            peerConnectionCount: peerConnections.length,
            peerConnections,
            mixerTrackIds: Array.from(window.__botInterceptedTracks || []),
            mixerTrackCount: (window.__botInterceptedTracks && window.__botInterceptedTracks.size) || 0,
            capturePaths: window.__botDiagCapturePaths.slice(),
            sdpSummary: window.__botDiagLastSdp,
            participantAudioMapping: 'NONE FOUND'
        };
        if (typeof window.reportWebRtcAudioDiag === 'function') {
            try { window.reportWebRtcAudioDiag(payload); } catch (e) { }
        } else {
            console.log('[WEBRTC_AUDIO_DIAG]', JSON.stringify(payload));
        }
    }

    function noteCapturePath(pathTag, trackId) {
        if (!diagEnabled()) return;
        window.__botDiagCapturePaths.push({ path: pathTag, trackId, ts: Date.now() });
        if (window.__botDiagCapturePaths.length > 40) {
            window.__botDiagCapturePaths = window.__botDiagCapturePaths.slice(-40);
        }
        emitDiag('capture:' + pathTag);
    }

    // =====================================================================
    // GLOBAL AUDIO MIXER
    // =====================================================================
    let mixerCtx = null;
    let mixerProcessor = null;

    function sendToNode(name, ...args) {
        try {
            if (typeof window[name] === 'function') {
                window[name](...args);
                return true;
            }
            if (window.top && window.top !== window && typeof window.top[name] === 'function') {
                window.top[name](...args);
                return true;
            }
        } catch (e) { }
        if (!window.__botMissingSendFns) window.__botMissingSendFns = {};
        if (!window.__botMissingSendFns[name]) {
            window.__botMissingSendFns[name] = true;
            console.warn('[Bot Interceptor] Bridge missing:', name);
        }
        return false;
    }

    function downsampleTo16k(inputData, inputSampleRate) {
        if (!inputSampleRate || inputSampleRate === 16000) return inputData;
        const ratio = inputSampleRate / 16000;
        const newLength = Math.round(inputData.length / ratio);
        const result = new Float32Array(newLength);
        let offsetResult = 0;
        let offsetBuffer = 0;
        while (offsetResult < result.length) {
            const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
            let accum = 0, count = 0;
            for (let i = offsetBuffer; i < nextOffsetBuffer && i < inputData.length; i++) {
                accum += inputData[i];
                count++;
            }
            result[offsetResult] = count > 0 ? accum / count : 0;
            offsetResult++;
            offsetBuffer = nextOffsetBuffer;
        }
        return result;
    }

    function initMixer() {
        if (mixerCtx) return;
        try {
            mixerCtx = new NativeAudioContext();
            mixerProcessor = mixerCtx.createScriptProcessor(4096, 1, 1);

            const realProto = Object.getPrototypeOf(mixerProcessor);
            const realConnect = realProto.connect;
            realConnect.call(mixerProcessor, mixerCtx.destination);

            let mixerCbCount = 0;
            let lastPeakLog = 0;
            mixerProcessor.onaudioprocess = function (e) {
                if (mixerCtx.state === 'suspended') {
                    mixerCtx.resume().catch(() => { });
                }
                const inputData = e.inputBuffer.getChannelData(0);
                const pcm16k = downsampleTo16k(inputData, mixerCtx.sampleRate);
                mixerCbCount++;
                let peak = 0;
                for (let i = 0; i < pcm16k.length; i++) {
                    const a = Math.abs(pcm16k[i]);
                    if (a > peak) peak = a;
                }
                if (mixerCbCount <= 3 || (peak > 0.01 && Date.now() - lastPeakLog > 5000)) {
                    lastPeakLog = Date.now();
                    console.log('[Bot Interceptor] Mixer callback #' + mixerCbCount + ' samples=' + pcm16k.length + ' peak=' + peak.toFixed(5));
                }
                sendToNode('sendAudioChunkBase64', float32ToB64(pcm16k));
            };

            if (mixerCtx.state === 'suspended') {
                mixerCtx.resume().catch(e => console.error('[Bot Interceptor] Could not resume mixerCtx', e));
            }
            setInterval(() => {
                if (mixerCtx && mixerCtx.state === 'suspended') {
                    mixerCtx.resume().catch(() => { });
                }
            }, 2000);

            console.log(`[Bot Interceptor] Global Audio Mixer initialized at native ${mixerCtx.sampleRate}Hz (downsampling to 16kHz for Deepgram).`);
        } catch (e) {
            console.error('[Bot Interceptor] Failed to initialize Global Audio Mixer', e);
        }
    }

    function float32ToB64(floatArray) {
        const uint8 = new Uint8Array(floatArray.buffer, floatArray.byteOffset, floatArray.byteLength);
        let binary = '';
        const len = uint8.byteLength;
        for (let i = 0; i < len; i += 1024) {
            binary += String.fromCharCode.apply(null, uint8.subarray(i, Math.min(i + 1024, len)));
        }
        return window.btoa(binary);
    }

    function attachPerTrackProcessor(source, track) {
        const processor = mixerCtx.createScriptProcessor(4096, 1, 1);
        const realProto = Object.getPrototypeOf(source);
        const realConnect = realProto.connect;
        realConnect.call(source, processor);
        realConnect.call(processor, mixerCtx.destination);
        // Also connect to the global mixer for mixed-audio fallback
        realConnect.call(source, mixerProcessor);

        const trackId = track.id;
        let cbCount = 0;
        processor.onaudioprocess = function (e) {
            if (mixerCtx.state === 'suspended') mixerCtx.resume().catch(() => { });
            const inputData = e.inputBuffer.getChannelData(0);
            const pcm16k = downsampleTo16k(inputData, mixerCtx.sampleRate);
            cbCount++;
            if (cbCount <= 2) {
                console.log('[Bot Interceptor] Track callback #' + cbCount + ' id=' + trackId + ' samples=' + pcm16k.length);
            }
            sendToNode('sendAudioTrackChunkBase64', trackId, float32ToB64(pcm16k));
        };
        window.__botRecorders.push({ processor, track });
        return processor;
    }

    function attachIncomingAudio(track, pathTag) {
        if (!track || track.kind !== 'audio') return;
        const tag = pathTag || 'rtc-track';
        const gmeetMulti = window.__BOT_MULTICHANNEL && window.__BOT_PLATFORM === 'gmeet';
        if (gmeetMulti && tag !== 'rtc-track') return;
        try {
            if (window.__botInterceptedTracks.has(track.id)) return;
            window.__botInterceptedTracks.add(track.id);

            initMixer();
            if (!mixerCtx) return;
            if (mixerCtx.state === 'suspended') mixerCtx.resume().catch(() => { });

            const stream = new MediaStream([track]);
            const source = mixerCtx.createMediaStreamSource(stream);
            const realProto = Object.getPrototypeOf(source);
            const realConnect = realProto.connect;

            const perTrack = window.__BOT_MULTICHANNEL && tag === 'rtc-track';
            if (perTrack) {
                attachPerTrackProcessor(source, track);
            }
            // Always feed the mixed mono mixer so DOM_MONO STT works even when
            // per-track capture is enabled for multichannel promotion.
            realConnect.call(source, mixerProcessor);

            window.__botRecorders.push({ source, track });
            console.log('[Bot Interceptor] Attached audio track to mixer' + (perTrack ? ' + per-track' : '') + ':', track.id, 'path=' + tag);
            noteCapturePath(tag, track.id);
        } catch (e) {
            console.error('[Bot Interceptor] AUDIO CAPTURE ERROR:', e);
            try {
                fallbackMediaRecorder(track);
            } catch (e2) {
                console.error('[Bot Interceptor] FALLBACK ALSO FAILED:', e2);
            }
        }
    }

    function fallbackMediaRecorder(track) {
        console.log('[Bot Interceptor] Trying MediaRecorder fallback...');
        const stream = new MediaStream([track]);
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

        recorder.ondataavailable = async function (event) {
            if (event.data.size > 0 && window.sendAudioBlobBase64) {
                // Send base64 blob data to Node.js
                const arrayBuffer = await event.data.arrayBuffer();
                const uint8 = new Uint8Array(arrayBuffer);
                let binary = '';
                const len = uint8.byteLength;
                for (let i = 0; i < len; i += 1024) {
                    binary += String.fromCharCode.apply(null, uint8.subarray(i, Math.min(i + 1024, len)));
                }
                window.sendAudioBlobBase64(window.btoa(binary));
            }
        };

        recorder.start(100); // Get data every 100ms
        window.__botRecorders.push(recorder);
        console.log('[Bot Interceptor] MediaRecorder fallback started for track:', track.id);
    }

    // Bulletproof polling: check all active PCs for un-intercepted audio tracks every second
    setInterval(() => {
        if (window.__botPCs) {
            for (const pc of window.__botPCs) {
                if (pc.signalingState !== 'closed') {
                    const receivers = pc.getReceivers();
                    for (const receiver of receivers) {
                        if (receiver.track && receiver.track.kind === 'audio' && !receiver.track.__botIntercepted) {
                            receiver.track.__botIntercepted = true;
                            console.log('[Bot Interceptor] Polling found un-intercepted audio track!');
                            attachIncomingAudio(receiver.track, 'rtc-track');
                        }
                    }
                }
            }
        }
    }, 1000);

    window.RTCPeerConnection = function (...args) {
        const pc = new OriginalRTCPeerConnection(...args);
        pc.__botDiagId = 'pc-' + (++window.__botDiagPcSeq);
        window.__botPCs.push(pc);
        if (diagEnabled()) emitDiag('pc-create');

        // Listen for remote tracks being added to the peer connection
        const handleTrack = async (event) => {
            console.log('[Bot Interceptor] Track event fired!', event.track.kind);
            if (event.track.kind === 'audio') {
                console.log('[Bot Interceptor] Intercepted remote audio track.');
                event.track.__botIntercepted = true;
                attachIncomingAudio(event.track, 'rtc-track');
            }
        };

        pc.addEventListener('track', handleTrack);

        // Fallback: Sometimes track events fire before we catch them or are handled differently
        const originalSetRemote = pc.setRemoteDescription;
        pc.setRemoteDescription = async function (...args) {
            const res = await originalSetRemote.apply(this, args);
            try {
                const desc = args[0];
                const sdp = desc && (desc.sdp || (typeof desc === 'string' ? desc : null));
                if (sdp) {
                    window.__botDiagLastSdp = summarizeSdp(sdp);
                    if (diagEnabled()) emitDiag('setRemoteDescription');
                }
            } catch (e) { }
            // Check receivers
            const receivers = pc.getReceivers();
            for (const receiver of receivers) {
                if (receiver.track && receiver.track.kind === 'audio') {
                    // Check if we already processed this track
                    if (!receiver.track.__botIntercepted) {
                        receiver.track.__botIntercepted = true;
                        console.log('[Bot Interceptor] Found audio track in receivers.');
                        attachIncomingAudio(receiver.track, 'rtc-track');
                    }
                }
            }
            return res;
        };

        return pc;
    };

    // Copy over static properties
    for (let key in OriginalRTCPeerConnection) {
        if (OriginalRTCPeerConnection.hasOwnProperty(key)) {
            window.RTCPeerConnection[key] = OriginalRTCPeerConnection[key];
        }
    }

    window.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;

    // Patch getUserMedia to inject our own audio
    // IMPORTANT: Uses a SEPARATE audio context (window.__botOutAudioContext) 
    // to avoid conflicts with the capture context above.
    function patchGetUserMedia() {
        if (!navigator.mediaDevices) {
            setTimeout(patchGetUserMedia, 50);
            return;
        }
        if (navigator.mediaDevices.__patched) return;
        navigator.mediaDevices.__patched = true;

        const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

        // Create a SEPARATE AudioContext for bot audio OUTPUT (what the bot "speaks" into the meeting)
        // This is intentionally different from the capture contexts above.
        window.__botOutAudioContext = new NativeAudioContext();
        window.__botAudioDest = window.__botOutAudioContext.createMediaStreamDestination();

        // Near-silent keep-alive so the virtual mic track stays live in headless Chrome
        try {
            const keepAlive = window.__botOutAudioContext.createOscillator();
            const keepGain = window.__botOutAudioContext.createGain();
            keepGain.gain.value = 0.00008;
            keepAlive.frequency.value = 20;
            keepAlive.connect(keepGain);
            keepGain.connect(window.__botAudioDest);
            keepAlive.start();
            window.__botMicKeepAlive = keepAlive;
        } catch (e) {
            console.log('[Bot Interceptor] mic keep-alive failed:', e && e.message);
        }

        let nextStartTime = 0;

        // Expose function for Node to push base64 PCM chunks
        window.pushBotAudioChunkBase64 = function (base64Str) {
            if (window.__botOutAudioContext.state === 'suspended') {
                window.__botOutAudioContext.resume();
            }

            const binary = window.atob(base64Str);
            const len = binary.length;
            const uint8 = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                uint8[i] = binary.charCodeAt(i);
            }
            const data = new Float32Array(uint8.buffer);

            const buffer = window.__botOutAudioContext.createBuffer(1, data.length, 44100);
            buffer.getChannelData(0).set(data);

            const source = window.__botOutAudioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(window.__botAudioDest);

            const currentTime = window.__botOutAudioContext.currentTime;
            if (nextStartTime < currentTime) {
                nextStartTime = currentTime + 0.05; // 50ms buffer
            }

            source.start(nextStartTime);
            nextStartTime += buffer.duration;
        };

        navigator.mediaDevices.getUserMedia = async function (constraints) {
            console.log('[Bot Interceptor] Intercepted getUserMedia', constraints);
            const stream = await originalGetUserMedia(constraints);

            if (constraints && constraints.audio) {
                console.log('[Bot Interceptor] Replacing audio track with Bot Audio Destination');

                const originalTrack = stream.getAudioTracks()[0];
                const customAudioTrack = window.__botAudioDest.stream.getAudioTracks()[0];

                if (originalTrack) {
                    stream.getAudioTracks().forEach(track => stream.removeTrack(track));
                }
                if (customAudioTrack) {
                    stream.addTrack(customAudioTrack);
                    console.log('[Bot Interceptor] Injected virtual microphone track');
                }

                // Ensure audio context is running (sometimes Chrome suspends it even with flags)
                // FIXED typo: it's __botOutAudioContext, not __botAudioContext
                if (window.__botOutAudioContext && window.__botOutAudioContext.state === 'suspended') {
                    window.__botOutAudioContext.resume().catch(e => console.log('Could not resume audio context:', e));
                }
            }

            return stream;
        };
    }

    patchGetUserMedia();

    // =====================================================================
    // WEB AUDIO API INTERCEPTOR (For Zoom Web WASM Audio)
    // Zoom Web Client decodes audio via WASM and plays it using AudioContext
    // instead of standard RTCPeerConnection audio tracks.
    // =====================================================================
    const OrigAudioNodeConnect = AudioNode.prototype.connect;

    // We keep track of which contexts we've already bridged to the mixer
    window.__botBridgedContexts = new Set();

    AudioNode.prototype.connect = function (...args) {
        const dest = args[0];

        // Check if this node is connecting to the main speakers (AudioDestinationNode)
        if (dest && dest.constructor && dest.constructor.name === 'AudioDestinationNode') {
            const ctx = this.context;

            // Ignore our own output context so the bot doesn't transcribe itself!
            if (window.__botOutAudioContext && ctx === window.__botOutAudioContext) {
                return OrigAudioNodeConnect.apply(this, args);
            }

            // Bridge WebAudio→mixer. Meet often plays remote audio via WebAudio even when
            // RTC tracks exist; skipping this path silences STT in headed/hidden Chrome.
            if (!window.__botBridgedContexts.has(ctx)) {
                window.__botBridgedContexts.add(ctx);
                console.log('[Bot Interceptor] Intercepted Web Audio API connection to speakers! Bridging to Global Mixer...');

                try {
                    initMixer();
                    if (mixerCtx) {
                        const streamDest = ctx.createMediaStreamDestination();
                        OrigAudioNodeConnect.call(this, streamDest);
                        const track = streamDest.stream.getAudioTracks()[0];
                        if (track) {
                            attachIncomingAudio(track, 'webaudio');
                            console.log('[Bot Interceptor] Bridged WebAudio stream to transcription mixer');
                        }
                    }
                } catch (e) {
                    console.error('[Bot Interceptor] Failed to bridge WebAudio context:', e);
                }
            }
        }

        // Always execute the original connection so the audio still plays normally
        return OrigAudioNodeConnect.apply(this, args);
    };

    // =====================================================================
    // HTML MEDIA ELEMENT INTERCEPTOR (For basic <audio> or <video> tags)
    // =====================================================================
    const origPlay = HTMLMediaElement.prototype.play;
    window.__botBridgedMediaElements = new WeakSet();

    HTMLMediaElement.prototype.play = function () {
        if (!window.__botBridgedMediaElements.has(this)) {
            window.__botBridgedMediaElements.add(this);
            if (window.__BOT_PLATFORM !== 'gmeet') {
                console.log('[Bot Interceptor] Intercepted HTMLMediaElement playback.');

                try {
                    initMixer();
                    if (mixerCtx) {
                        const source = mixerCtx.createMediaElementSource(this);

                        const realProto = Object.getPrototypeOf(source);
                        const realConnect = realProto.connect;
                        realConnect.call(source, mixerCtx.destination);

                        realConnect.call(source, mixerProcessor);
                        console.log('[Bot Interceptor] Bridged HTMLMediaElement to transcription mixer!');
                        noteCapturePath('html-media', this.src || this.currentSrc || 'media-element');
                    }
                } catch (e) {
                    console.warn('[Bot Interceptor] Could not bridge HTMLMediaElement (maybe already bridged):', e.message);
                }
            }
        }
        return origPlay.apply(this, arguments);
    };

    setInterval(() => {
        if (diagEnabled()) emitDiag('poll-3s');
    }, 3000);

})();

