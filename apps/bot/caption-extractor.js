/**
 * Caption Extractor Module
 * Standalone scrapers for Google Meet, Microsoft Teams, and Zoom closed captions.
 */

const MATERIAL_ICON_RE = /^(format_size|mic|mic_off|videocam|videocam_off|present_to_all|more_vert|more_horiz|call_end|closed_caption|captions|settings|people|chat|back_hand|pan_tool|volume_up|volume_off|screen_share|stop_screen_share|fullscreen|fullscreen_exit|add|close|check|arrow_drop_down|keyboard_arrow_down|info|help|search|send|edit|delete|content_copy|done|warning|error|push_pin|keep|keep_off|mood|emoji_emotions|devices|cast|hd|speed|tune|visibility|visibility_off)[.!?…,;:\s]*$/i;

const ICON_NOISE_RE = /\b(format_size|mic_off|videocam_off|present_to_all|more_vert|more_horiz|call_end|closed_caption|screen_share|stop_screen_share|fullscreen_exit|arrow_drop_down|keyboard_arrow_down|content_copy|emoji_emotions|visibility_off|push_pin|keep_off|delete)\b/gi;

function cleanMeetName(name) {
    return String(name || '')
        .replace(/\(You\)/gi, '')
        .replace(/\(Guest\)/gi, '')
        .replace(/\(External\)/gi, '')
        .replace(/Meeting host/gi, '')
        .replace(ICON_NOISE_RE, '')
        .replace(/[''"]+\s*$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isJunkSpeaker(name) {
    const n = cleanMeetName(name);
    if (!n) return true;
    if (MATERIAL_ICON_RE.test(n)) return true;
    if (/^[a-z]+(_[a-z0-9]+)+$/i.test(n)) return true;
    if (/^(speaker|unknown|you|host|guest)$/i.test(n)) return true;
    if (n.length > 48) return true;
    return false;
}

function isCaptionNoiseText(text) {
    const tx = String(text || '').replace(/\s+/g, ' ').trim();
    if (!tx) return true;
    if (MATERIAL_ICON_RE.test(tx)) return true;
    if (/^[a-z]+(_[a-z0-9]+)+$/i.test(tx)) return true;
    // Meet captions language / caption-size settings panel scraped as "speech"
    if (/\bBETA\b/.test(tx) && (tx.match(/\bBETA\b/g) || []).length >= 2) return true;
    if (/\b(Afrikaans|Albanian|Amharic|Default|Tiny|Small|Medium|Large|Huge|Jumbo)\b/i.test(tx)
        && /\b(English|French|Spanish|German|Hindi|Arabic)\b/i.test(tx)
        && tx.length > 80) return true;
    if (/\b(caption size|captions language|turn on captions|turn off captions)\b/i.test(tx)) return true;
    if (tx.length > 280 && (tx.match(/,/g) || []).length >= 8) return true;
    return false;
}

function splitSpeakerFromText(speaker, text) {
    let sp = cleanMeetName(speaker);
    let tx = String(text || '')
        .replace(ICON_NOISE_RE, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!tx) return { speaker: isJunkSpeaker(sp) ? 'Speaker' : (sp || 'Speaker'), text: '' };

    const colon = tx.match(/^([^:]{1,40}):\s*(.+)$/);
    if (colon) {
        const maybeName = cleanMeetName(colon[1]);
        if (maybeName && !isJunkSpeaker(maybeName) && !/^speaker(\s+\d+)?$/i.test(maybeName)) {
            if (!sp || isJunkSpeaker(sp) || /^speaker(\s+\d+)?$/i.test(sp)) sp = maybeName;
            tx = colon[2].trim();
        } else if (isJunkSpeaker(maybeName) || MATERIAL_ICON_RE.test(maybeName)) {
            tx = colon[2].trim();
        }
    }

    if (isJunkSpeaker(sp)) sp = 'Speaker';

    if (sp && sp.length >= 2 && !/^speaker(\s+\d+)?$/i.test(sp)) {
        const re = new RegExp(`^${sp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:\\-–]?\\s*`, 'i');
        tx = tx.replace(re, '').trim();
    }

    tx = tx.replace(ICON_NOISE_RE, ' ').replace(/\s+/g, ' ').trim();

    // Drop name-only scrapes like speaker=format_size text="Dinesh '"
    if (tx && !/[.!?…]/.test(tx) && tx.split(/\s+/).filter(Boolean).length <= 2) {
        const txName = cleanMeetName(tx);
        if (txName && (txName.toLowerCase() === sp.toLowerCase() || /^[A-Z][a-zA-Z'.\- ]{0,30}$/.test(tx))) {
            // Keep short real speech ("Am I", "Why?") — drop bare display names only when no verb-like tokens
            if (!/\b(am|is|are|was|were|do|does|did|can|could|will|would|why|what|how|when|where|who|the|a|an|to|of|in|on|for|with|my|your|me|you|i|we|they|it|this|that|not|no|yes|ok|okay|hi|hello|hey)\b/i.test(tx)) {
                return { speaker: sp || 'Speaker', text: '' };
            }
        }
    }

    if (isCaptionNoiseText(tx)) return { speaker: sp || 'Speaker', text: '' };

    return { speaker: sp || 'Speaker', text: tx };
}

class CaptionExtractor {
    static async setupGoogleMeet(page, onCaption) {
        try {
            await page.exposeFunction('reportCaptionGMeet', (speaker, text, blockId) => {
                if (onCaption) onCaption(speaker, text, blockId);
            }).catch(() => {});

            await page.evaluate(() => {
                let lastEmittedText = '';
                const ICON_RE = /^(format_size|mic|mic_off|videocam|videocam_off|present_to_all|more_vert|more_horiz|call_end|closed_caption|captions|settings|people|chat|back_hand|pan_tool|volume_up|volume_off|screen_share|stop_screen_share|fullscreen|fullscreen_exit|add|close|check|arrow_drop_down|keyboard_arrow_down|info|help|search|send|edit|delete|content_copy|done|warning|error|push_pin|keep|keep_off|mood|emoji_emotions|devices|cast|hd|speed|tune|visibility|visibility_off)[.!?…,;:\s]*$/i;
                const ICON_NOISE = /\b(format_size|mic_off|videocam_off|present_to_all|more_vert|more_horiz|call_end|closed_caption|screen_share|stop_screen_share|fullscreen_exit|arrow_drop_down|keyboard_arrow_down|content_copy|emoji_emotions|visibility_off|push_pin|keep_off|delete)\b/gi;

                const cleanName = (name) => String(name || '')
                    .replace(/\(You\)/gi, '')
                    .replace(/Meeting host/gi, '')
                    .replace(ICON_NOISE, '')
                    .replace(/[''"]+\s*$/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();

                const isJunk = (name) => {
                    const n = cleanName(name);
                    if (!n) return true;
                    if (ICON_RE.test(n)) return true;
                    if (/^[a-z]+(_[a-z0-9]+)+$/i.test(n)) return true;
                    return false;
                };

                const visibleText = (el) => {
                    if (!el) return '';
                    const parts = [];
                    const walk = (node) => {
                        if (!node) return;
                        if (node.nodeType === 3) {
                            const t = String(node.textContent || '').trim();
                            if (t && !ICON_RE.test(t)) parts.push(t);
                            return;
                        }
                        if (node.nodeType !== 1) return;
                        const tag = (node.tagName || '').toLowerCase();
                        if (tag === 'script' || tag === 'style') return;
                        const cls = String(node.className || '');
                        if (/\b(google-symbols|material-icons|notranslate)\b/i.test(cls)) return;
                        if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') return;
                        for (const child of node.childNodes) walk(child);
                    };
                    walk(el);
                    return parts.join(' ').replace(/\s+/g, ' ').trim();
                };

                setInterval(() => {
                    try {
                        const containers = document.querySelectorAll(
                            '.nMcdL, .a4cQT, [jscontroller="D1tHje"]'
                        );
                        containers.forEach((container, idx) => {
                            const speakerEl = container.querySelector('.NWpY1d, .zs7s8d, .jnnxkc, .YTbUkc, .YTbUzc');
                            let textEl = container.querySelector('.ygicle, .VbkSUe, .CNusmb');
                            if (textEl && speakerEl && textEl.contains(speakerEl)) {
                                textEl = null;
                            }

                            let speaker = cleanName(speakerEl ? visibleText(speakerEl) || speakerEl.innerText : '');
                            if (isJunk(speaker)) speaker = '';

                            let text = visibleText(textEl || container);
                            text = text.replace(ICON_NOISE, ' ').replace(/\s+/g, ' ').trim();
                            if (speaker && text.toLowerCase().startsWith(speaker.toLowerCase())) {
                                text = text.slice(speaker.length).replace(/^[\s:\-–]+/, '').trim();
                            }
                            if (!speaker) speaker = 'Speaker';
                            if (!text || ICON_RE.test(text)) return;
                            if (/\bBETA\b/.test(text) && (text.match(/\bBETA\b/g) || []).length >= 2) return;
                            if (text.length > 280 && (text.match(/,/g) || []).length >= 8) return;
                            if (/\b(Default|Tiny|Small|Medium|Large|Huge|Jumbo)\b/.test(text)
                                && /\b(Afrikaans|English|French|Spanish)\b/i.test(text)) return;
                            if (text && text !== lastEmittedText) {
                                const prev = lastEmittedText;
                                lastEmittedText = text;
                                let emitText = text;
                                if (prev) {
                                    const pn = prev.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
                                    const tn = text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
                                    if (pn && tn.startsWith(pn) && tn.length > pn.length) {
                                        const rest = text.slice(prev.length).replace(/^[\s.!?…,;:\-–]+/, '').trim();
                                        if (rest.split(/\s+/).filter(Boolean).length >= 2) emitText = rest;
                                    }
                                }
                                if (window.reportCaptionGMeet) {
                                    window.reportCaptionGMeet(speaker, emitText, 'gmeet_cc_' + idx);
                                }
                            }
                        });
                    } catch (e) {}
                }, 250);
            });
        } catch (e) {
            console.warn('[CaptionExtractor] Google Meet setup error:', e.message);
        }
    }

    static async setupTeams(page, onCaption) {
        try {
            await page.exposeFunction('reportCaptionTeams', (speaker, text, blockId) => {
                if (onCaption) onCaption(speaker, text, blockId);
            }).catch(() => {});

            await page.evaluate(() => {
                let lastEmittedText = '';
                let lastAuthor = 'Speaker';
                setInterval(() => {
                    try {
                        const items = document.querySelectorAll('.fui-ChatMessageCompact, [data-tid="closed-caption-item"], [data-tid="closed-caption-v2-item"]');
                        items.forEach((item, idx) => {
                            const authorEl = item.querySelector('.fui-ChatMessageCompact__author, [data-tid="closed-caption-author"]');
                            const bodyEl = item.querySelector('.fui-ChatMessageCompact__body, [data-tid="closed-caption-body"]') || item;
                            if (authorEl && authorEl.innerText.trim()) {
                                lastAuthor = authorEl.innerText.trim();
                            }
                            const speaker = lastAuthor.replace(/\(Guest\)/gi, '').replace(/\(External\)/gi, '').replace(/[''"]+\s*$/g, '').trim() || 'Speaker';
                            let text = bodyEl ? bodyEl.innerText.trim() : '';
                            if (speaker && text.toLowerCase().startsWith(speaker.toLowerCase())) {
                                text = text.slice(speaker.length).replace(/^[\s:\-–]+/, '').trim();
                            }
                            if (text && text !== lastEmittedText) {
                                lastEmittedText = text;
                                if (window.reportCaptionTeams) {
                                    window.reportCaptionTeams(speaker, text, 'teams_cc_' + idx);
                                }
                            }
                        });
                    } catch (e) {}
                }, 250);
            });
        } catch (e) {
            console.warn('[CaptionExtractor] Teams setup error:', e.message);
        }
    }

    static async setupZoom(page, onCaption) {
        try {
            await page.exposeFunction('reportCaptionZoom', (speaker, text, blockId) => {
                if (onCaption) onCaption(speaker, text, blockId);
            }).catch(() => {});

            await page.evaluate(() => {
                let lastEmittedText = '';
                setInterval(() => {
                    try {
                        const items = document.querySelectorAll('.cc-container .subtitle-text, .live-transcription-subtitle');
                        items.forEach((item, idx) => {
                            const text = item.innerText.trim();
                            if (text && text !== lastEmittedText) {
                                lastEmittedText = text;
                                let speaker = 'Speaker';
                                let content = text;
                                const colonIndex = text.indexOf(':');
                                if (colonIndex > 0 && colonIndex < 40) {
                                    speaker = text.slice(0, colonIndex).replace(/[''"]+\s*$/g, '').trim() || 'Speaker';
                                    content = text.slice(colonIndex + 1).trim();
                                }
                                if (window.reportCaptionZoom) {
                                    window.reportCaptionZoom(speaker, content, 'zoom_cc_' + idx);
                                }
                            }
                        });
                    } catch (e) {}
                }, 250);
            });
        } catch (e) {
            console.warn('[CaptionExtractor] Zoom setup error:', e.message);
        }
    }
}

CaptionExtractor.splitSpeakerFromText = splitSpeakerFromText;
CaptionExtractor.cleanMeetName = cleanMeetName;
CaptionExtractor.isJunkSpeaker = isJunkSpeaker;
CaptionExtractor.isCaptionNoiseText = isCaptionNoiseText;

module.exports = CaptionExtractor;
