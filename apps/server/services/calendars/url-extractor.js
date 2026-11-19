/**
 * Production-Grade Meeting URL Extractor
 * Extracts Google Meet, Microsoft Teams, Zoom, and Webex join URLs from calendar events.
 * 
 * Supports:
 * - Structured provider fields (Google conferenceData, Microsoft onlineMeeting, Zoom join_url)
 * - Raw HTML <a> tag href attributes (prevents stripping links during HTML-to-text conversion)
 * - Decodes HTML entities (&amp;, &#x3D;, %3A, etc.)
 * - Deep searches event.location, event.description, event.summary, event.body, event.agenda
 * - Handles government / custom enterprise tenant domains
 */

function decodeHtmlEntities(str) {
    if (!str) return '';
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x2F;/g, '/')
        .replace(/&#x3D;/g, '=')
        .replace(/&#58;/g, ':');
}

function cleanUrl(rawUrl) {
    if (!rawUrl) return null;
    let url = rawUrl.trim();
    
    // Decode HTML entities
    url = decodeHtmlEntities(url);
    
    // Strip trailing punctuation often caught in regex
    url = url.replace(/[),.;:!>]+$/, '');
    
    // Strip surrounding quotes
    url = url.replace(/^['"]+|['"]+$/g, '');
    
    return url;
}

const PATTERNS = [
    // Google Meet
    {
        platform: 'gmeet',
        regex: /https?:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:\?[^\s<>"']*)?/i
    },
    {
        platform: 'gmeet',
        regex: /https?:\/\/meet\.google\.com\/[a-z0-9_-]+(?:\?[^\s<>"']*)?/i
    },
    
    // Microsoft Teams (Desktop, Web, Enterprise, Gov, Live)
    {
        platform: 'teams',
        regex: /https?:\/\/(?:[a-zA-Z0-9-]+\.)?teams\.(?:microsoft|live)\.(?:com|us)\/(?:#\/)?l\/meetup-join\/[^"'\s<>]+/i
    },
    {
        platform: 'teams',
        regex: /https?:\/\/(?:[a-zA-Z0-9-]+\.)?teams\.(?:microsoft|live)\.(?:com|us)\/meet\/[^"'\s<>]+/i
    },
    {
        platform: 'teams',
        regex: /https?:\/\/gov\.teams\.microsoft\.us\/l\/meetup-join\/[^"'\s<>]+/i
    },
    
    // Zoom (Standard, Custom Domains, Web Client, Gov)
    {
        platform: 'zoom',
        regex: /https?:\/\/(?:[a-zA-Z0-9-]+\.)?zoom\.(?:us|com|com\.cn)\/(?:j|my|w|wc|join)\/[0-9a-zA-Z?&=_%#+.-]+/i
    },
    {
        platform: 'zoom',
        regex: /https?:\/\/(?:[a-zA-Z0-9-]+\.)?zoomgov\.com\/(?:j|my|w)\/[0-9a-zA-Z?&=_%#+.-]+/i
    },
    
    // Cisco Webex
    {
        platform: 'webex',
        regex: /https?:\/\/(?:[a-zA-Z0-9-]+\.)?webex\.com\/(?:[a-zA-Z0-9-]+\/)?(?:j\.php|meet|m)\/[^"'\s<>]+/i
    }
];

function matchUrl(text) {
    if (!text || typeof text !== 'string') return null;

    // 1. First extract all href="..." URLs from HTML tags directly
    const hrefRegex = /href=["'](https?:\/\/[^"']+)["']/gi;
    let hrefMatch;
    while ((hrefMatch = hrefRegex.exec(text)) !== null) {
        const candidateUrl = cleanUrl(hrefMatch[1]);
        if (candidateUrl) {
            for (const { platform, regex } of PATTERNS) {
                if (regex.test(candidateUrl)) {
                    return { url: candidateUrl, platform };
                }
            }
        }
    }

    // 2. Search plain text / decoded text
    const decoded = decodeHtmlEntities(text);
    for (const { platform, regex } of PATTERNS) {
        const match = decoded.match(regex);
        if (match && match[0]) {
            const cleaned = cleanUrl(match[0]);
            if (cleaned) {
                return { url: cleaned, platform };
            }
        }
    }

    return null;
}

/**
 * Main extractor function
 * @param {Object} event - Raw calendar event from Google, Microsoft, or Zoom
 * @param {String} provider - 'google', 'microsoft', 'zoom'
 * @returns {Object|null} { url: string, platform: string }
 */
function extractMeetingUrl(event, provider) {
    if (!event) return null;

    // ── 1. Check Structured Provider Fields First ──
    if (provider === 'google' || !provider) {
        if (event.hangoutLink) {
            return { url: event.hangoutLink, platform: 'gmeet' };
        }
        if (event.conferenceData?.entryPoints) {
            const videoEntry = event.conferenceData.entryPoints.find(e => e.entryPointType === 'video' || e.uri);
            if (videoEntry?.uri) {
                const matched = matchUrl(videoEntry.uri);
                if (matched) return matched;
                return { url: videoEntry.uri, platform: 'gmeet' };
            }
        }
    }

    if (provider === 'microsoft' || !provider) {
        if (event.onlineMeeting?.joinUrl) {
            const matched = matchUrl(event.onlineMeeting.joinUrl);
            return matched || { url: event.onlineMeeting.joinUrl, platform: 'teams' };
        }
        if (event.onlineMeetingUrl) {
            const matched = matchUrl(event.onlineMeetingUrl);
            return matched || { url: event.onlineMeetingUrl, platform: 'teams' };
        }
    }

    if (provider === 'zoom' || !provider) {
        if (event.join_url) {
            return { url: event.join_url, platform: 'zoom' };
        }
    }

    // ── 2. Check Candidate Fields in Priority Order ──
    const candidateFields = [
        event.location,
        event.description,
        event.body?.content,
        event.body,
        event.summary,
        event.subject,
        event.agenda,
        event.notes
    ];

    for (const field of candidateFields) {
        if (field) {
            const result = matchUrl(String(field));
            if (result) return result;
        }
    }

    return null;
}

module.exports = { extractMeetingUrl, matchUrl };
