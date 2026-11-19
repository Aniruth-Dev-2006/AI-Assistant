const GoogleMeetBot = require('./platforms/google-meet');
const LocalWhisperSTT = require('../desktop/main/stt-whisper');

async function main() {
    const url = process.argv[2];
    if (!url) {
        console.error('Usage: node run-bot.js <meeting-url>');
        process.exit(1);
    }

    console.log('[Runner] Starting Phase 1 End-to-End Test (WebRTC + Local Whisper STT)');

    // 1. Initialize local STT
    const stt = new LocalWhisperSTT();
    
    // We want to test speaker output in terminal
    stt.onTranscript = (speakerId, text, isFinal) => {
        console.log(`\n[TRANSCRIPT] Speaker ${speakerId}: ${text}\n`);
    };

    await stt.init();

    // 2. Initialize Bot
    const bot = new GoogleMeetBot({
        meetingUrl: url,
        botName: 'Xobin',
        onAudioChunk: (buffer) => {
            // Buffer contains Int16 array representation
            // We convert back to Int16Array
            const pcm16Array = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
            stt.appendAudioChunk(Array.from(pcm16Array));
        }
    });

    console.log('[Runner] Initializing bot...');
    const shouldContinue = await bot.init(false); // not login mode
    if (shouldContinue) {
        await bot.join();
    }
}

main().catch(console.error);
