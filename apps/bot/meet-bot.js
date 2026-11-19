const { chromium } = require('playwright');

const path = require('path');

/**
 * Automates joining a Google Meet session.
 * Usage: node meet-bot.js "https://meet.google.com/xxx-xxxx-xxx" "Bot Name"
 * To login: node meet-bot.js login
 */
async function joinMeet(meetUrl, botName = "Xobin") {
  const userDataDir = path.join(__dirname, 'user_data');
  console.log(`[Bot] Launching persistent browser session in ${userDataDir}...`);
  
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true, // Set to true if you don't want the browser window to show
    executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    permissions: ['camera', 'microphone'],
    args: [
      '--use-fake-ui-for-media-stream', // Auto-accept camera/mic permissions
      '--use-fake-device-for-media-stream', // Use fake video/audio
      '--disable-blink-features=AutomationControlled' // Helps bypass bot detection
    ]
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  if (meetUrl === 'login') {
    console.log('[Bot] Navigating to Google Login...');
    console.log('[Bot] Please sign into your Google account in the opened browser window.');
    console.log('[Bot] Once you are signed in, you can close the browser window or kill this terminal process.');
    await page.goto('https://accounts.google.com', { waitUntil: 'networkidle' });
    return; // Leave it open for the user to login
  }

  try {
    console.log('[Bot] Navigating to Google Meet...');
    await page.goto(meetUrl, { waitUntil: 'networkidle' });

    console.log('[Bot] Waiting for the entry screen...');
    
    // Try to find the name input
    const nameInput = page.getByPlaceholder('Your name');
    const nameInputAlt = page.locator('input[type="text"]');
    
    if (await nameInput.isVisible()) {
        await nameInput.fill(botName);
    } else if (await nameInputAlt.count() > 0) {
        // Fallback to the first text input on the entry screen
        await nameInputAlt.first().fill(botName);
    } else {
        console.log('[Bot] Could not find name input, might be logged in or layout changed.');
    }

    // Turn off camera and mic just in case the fake streams are transmitting.
    console.log('[Bot] Muting microphone and camera...');
    try {
        const micBtn = page.getByRole('button', { name: /Turn off microphone/i });
        if (await micBtn.isVisible()) await micBtn.click();
        
        const camBtn = page.getByRole('button', { name: /Turn off camera/i });
        if (await camBtn.isVisible()) await camBtn.click();
    } catch(e) {
        console.log('[Bot] Mic/Cam buttons not found or already off.');
    }

    // Click "Ask to join" or "Join now"
    console.log(`[Bot] Attempting to join as "${botName}"...`);
    const joinBtn = page.getByRole('button', { name: /(Ask to join|Join now)/i });
    
    if (await joinBtn.isVisible()) {
        await joinBtn.click();
        console.log('[Bot] Clicked Join! Waiting to be admitted by the host...');
    } else {
        console.log('[Bot] Join button not found. Dumping page text for debug:');
        console.log(await page.textContent('body'));
    }

    // --- NEW: Wait for admission and turn on captions ---
    console.log('[Bot] Waiting for meeting controls (admission)...');
    
    // The "Turn on captions" button appears once we are in the meeting
    const captionsBtn = page.getByRole('button', { name: /Turn on captions/i });
    await captionsBtn.waitFor({ state: 'visible', timeout: 0 }); // Wait indefinitely until admitted
    
    console.log('[Bot] Admitted to meeting! Turning on captions...');
    await captionsBtn.click();

    // Expose Node.js callback for transcripts
    await page.exposeFunction('onNewTranscript', (speaker, text) => {
        console.log(`\n[Transcript] ${speaker}: ${text}`);
    });

    // Inject Mutation Observer to scrape captions
    await page.evaluate(() => {
        let lastSpeakerText = '';
        
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                // Google Meet appends new spans or text nodes as people speak
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    // A much more robust way based on the exact DOM structure
                    // 1. Find the captions container
                    const container = document.querySelector('div[jsname="dsyhDe"]') || document.querySelector('[aria-label="Captions"]');
                    if (!container) continue; // Captions not active or found
                    
                    // 2. Find the last caption block added (the most recent speaker)
                    const avatars = container.querySelectorAll('img');
                    if (avatars.length === 0) continue;
                    
                    const lastAvatar = avatars[avatars.length - 1];
                    const header = lastAvatar.parentElement; // <div class="adE6rb">
                    if (!header) continue;
                    
                    const block = header.parentElement; // <div class="nMcdL">
                    if (!block) continue;
                    
                    // 3. Extract speaker name
                    const nameSpan = header.querySelector('span');
                    const currentSpeaker = nameSpan ? nameSpan.innerText.trim() : 'Unknown';
                    
                    // 4. Extract text
                    let currentText = '';
                    for (const child of block.children) {
                        if (child !== header && child.innerText) {
                            currentText += child.innerText.trim() + ' ';
                        }
                    }
                    currentText = currentText.trim();
                    
                    // 5. Send if updated
                    if (currentText && currentText !== lastSpeakerText) {
                        lastSpeakerText = currentText;
                        
                        // Clear the previous timer
                        if (window.transcriptTimeout) clearTimeout(window.transcriptTimeout);
                        
                        // Set a new timer to wait 800ms before sending the finalized text
                        window.transcriptTimeout = setTimeout(() => {
                            window.onNewTranscript(currentSpeaker, currentText);
                        }, 800);
                    }
                }
            }
        });
        
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        console.log('[Bot DOM] MutationObserver injected for captions.');
    });
    
    console.log('[Bot] Setup complete. Listening for transcripts...');

  } catch (error) {
    console.error('[Bot] Error during automation:', error);
    await context.close();
  }
}

const url = process.argv[2];
const name = process.argv[3] || "AI Meeting Assistant";

if (!url) {
  console.log("Usage: node meet-bot.js <google-meet-url> [bot-name]");
  console.log("To login: node meet-bot.js login");
  process.exit(1);
}

joinMeet(url, name);
