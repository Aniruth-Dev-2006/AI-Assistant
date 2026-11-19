// Platform Strategy Interface
// {
//   getInterviewerName(): string,
//   getCaptionElements(): NodeList | Array,
//   extractCaptionText(el): string,
//   extractCaptionSpeaker(el): string,
//   startCaptionObserver(callback): void // Optional: if mutation observer is needed instead of setInterval
// }

class GoogleMeetStrategy {
    getInterviewerName() {
        let interviewerName = 'Interviewer';
        
        // Strategy 1: Extract from Google Account profile button tooltip
        const profileBtn = document.querySelector('a[aria-label^="Google Account:"]');
        if (profileBtn) {
            const match = profileBtn.getAttribute('aria-label').match(/Google Account:\s*([^\n]+)/);
            if (match && match[1]) interviewerName = match[1].trim();
        }
        
        // Strategy 2: Fallback to scraping the "You" tile
        if (interviewerName === 'Interviewer') {
            const tiles = document.querySelectorAll('div[data-self-name]');
            for (const tile of tiles) {
                let name = tile.getAttribute('data-self-name') || '';
                if (name.includes('(You)') || name.endsWith('You')) {
                    interviewerName = name.replace(/\(You\)/gi, '').replace(/You$/, '').trim();
                    break;
                }
            }
        }
        return interviewerName;
    }

    getCaptionElements() {
        return document.querySelectorAll('.a4cQT'); // Typical Google Meet caption class
    }

    extractCaptionText(el) {
        return el.innerText.trim();
    }

    extractCaptionSpeaker(el) {
        const nameEl = el.querySelector('.zs7s8d, .jnnxkc'); 
        return nameEl ? nameEl.innerText.trim() : 'Speaker';
    }

}

class ZoomStrategy {
    getInterviewerName() {
        // Zoom web client often has video tiles with spans containing names.
        // The current user usually has "(Me)" appended to their name in the participants list or video tile.
        let interviewerName = 'Interviewer';
        
        // Strategy: Look for the participants list or a self video tile
        const selfTag = document.querySelector('.participants-item__me-tag');
        if (selfTag && selfTag.parentElement) {
            const nameEl = selfTag.parentElement.querySelector('.participants-item__display-name');
            if (nameEl) interviewerName = nameEl.innerText.trim();
        } else {
            // Fallback: look for video tile name with "(Me)"
            const nameTags = document.querySelectorAll('.speaker-active-container__name, .video-avatar__name');
            for (const tag of nameTags) {
                if (tag.innerText.includes('(Me)')) {
                    interviewerName = tag.innerText.replace(/\(Me\)/gi, '').trim();
                    break;
                }
            }
        }
        return interviewerName;
    }

    getCaptionElements() {
        // Zoom web client closed captions typically appear in a specific container
        return document.querySelectorAll('.cc-container .subtitle-text, .live-transcription-subtitle');
    }

    extractCaptionText(el) {
        return el.innerText.trim();
    }

    extractCaptionSpeaker(el) {
        // In Zoom, the speaker name is sometimes prepended with a colon, e.g., "John Doe: Hello"
        // Or in a separate span.
        const text = el.innerText.trim();
        const colonIndex = text.indexOf(':');
        if (colonIndex > 0 && colonIndex < 30) { // arbitrary length check for name
            return text.substring(0, colonIndex).trim();
        }
        return 'Speaker';
    }

}

class TeamsStrategy {
    getInterviewerName() {
        // Teams web client usually has an avatar or profile button
        let interviewerName = 'Interviewer';
        
        // Attempt to find profile picture aria-label
        const profileBtn = document.querySelector('button[data-tid="personDropdown"], button[id="personDropdown"]');
        if (profileBtn) {
            const ariaLabel = profileBtn.getAttribute('aria-label');
            if (ariaLabel) {
                // e.g., "Profile settings for John Doe"
                const match = ariaLabel.match(/for\s+(.*)/i);
                if (match && match[1]) interviewerName = match[1].trim();
            }
        }
        
        // Fallback: looking for self video tile
        if (interviewerName === 'Interviewer') {
            const selfVideo = document.querySelector('div[data-tid="calling-roster-item-me"]');
            if (selfVideo) {
                const nameEl = selfVideo.querySelector('.ui-text');
                if (nameEl) interviewerName = nameEl.innerText.trim();
            }
        }
        
        return interviewerName;
    }

    getCaptionElements() {
        // Teams Live Captions usually use ui-chat__message__content or specific aria-live regions
        return document.querySelectorAll('[data-tid="closed-captions-text"], .ui-chat__message__content');
    }

    extractCaptionText(el) {
        // Teams sometimes includes the name inside the same element, we handle this in speaker extraction
        let text = el.innerText.trim();
        const colonIndex = text.indexOf(':');
        if (colonIndex > 0 && colonIndex < 30) {
            text = text.substring(colonIndex + 1).trim();
        }
        return text;
    }

    extractCaptionSpeaker(el) {
        // If there's a specific name element nearby
        const nameEl = el.parentElement && el.parentElement.querySelector('.ui-chat__message__author');
        if (nameEl) {
            return nameEl.innerText.trim();
        }
        
        // Fallback: "Name: Text" format
        const text = el.innerText.trim();
        const colonIndex = text.indexOf(':');
        if (colonIndex > 0 && colonIndex < 30) {
            return text.substring(0, colonIndex).trim();
        }
        
        return 'Speaker';
    }

}

// Global detection logic
window.PlatformDetector = {
    getStrategy: () => {
        const hostname = window.location.hostname;
        if (hostname.includes('meet.google.com')) {
            console.log('[MeetingAI] Platform detected: Google Meet');
            return new GoogleMeetStrategy();
        } else if (hostname.includes('zoom.us')) {
            console.log('[MeetingAI] Platform detected: Zoom');
            return new ZoomStrategy();
        } else if (hostname.includes('teams.microsoft.com') || hostname.includes('teams.live.com')) {
            console.log('[MeetingAI] Platform detected: Microsoft Teams');
            return new TeamsStrategy();
        } else {
            console.log('[MeetingAI] Unknown platform, defaulting to Google Meet Strategy');
            return new GoogleMeetStrategy(); // Fallback
        }
    }
};
