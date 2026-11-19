const EventEmitter = require('events');

const MICRO_TURN_MAX_WORDS = 5;
const OVERLAP_MIN_WORDS = 3;
const SAME_UTTERANCE_MIN_WORDS = 4;
const CONTINUATION_WINDOW_MS = 5000;
const SILENCE_FINALIZE_MS = 2800;
const TOPIC_BREAK_MIN_WORDS = 10;

class TranscriptManager extends EventEmitter {
    constructor(sessionId) {
        super();
        this.sessionId = sessionId;
        this.buffer = [];
        this.todos = [];
        
        this.currentSpeaker = null;
        this.currentTurnText = '';
        this.turnStartTime = 0;
        this.turnId = 0;
        this.activeTurnBlocks = new Map();
        
        this._committedTurnIds = new Set();
        this._actionSealedTurnIds = new Set();
        this._silenceTimer = null;
        this._lastChunkTimestamp = 0;
        this._lastOtherSpeakerText = '';
        this._lastCommittedBySpeaker = new Map();
        this._lastSubstantialBySpeaker = new Map();
        this._lastLlmSig = '';
        
        this.candidateName = null;
    }

    setCandidate(name) {
        this.candidateName = name ? name.trim() : null;
    }

    _normSpeakerName(name) {
        return String(name || '')
            .toLowerCase()
            .replace(/\s*\(you\)\s*$/i, '')
            .replace(/[''"]+\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    _speakerMatchesCandidate(speaker) {
        if (!this.candidateName) return false;
        return this._normSpeakerName(speaker) === this._normSpeakerName(this.candidateName);
    }

    updateCurrentSpeakerName(speakerName) {
        if (!speakerName || this._isPlaceholderSpeaker(speakerName)) return;
        if (/^[a-z]+(_[a-z0-9]+)+$/i.test(String(speakerName).trim())) return;
        if (/format_size/i.test(String(speakerName))) return;
        // Only rename an open live turn — never invent a speaker or rewrite finished turns.
        if (!this.currentTurnText || !String(this.currentTurnText).trim()) return;
        if (this._committedTurnIds.has(this.turnId)) return;

        const current = this.currentSpeaker || '';
        if (!(this._isPlaceholderSpeaker(current) || current === 'Interviewer' || current === 'Candidate')) {
            return;
        }
        console.log(`[TranscriptManager] Retroactively updating '${current}' to '${speakerName}'`);
        this.currentSpeaker = speakerName;

        const last = this.buffer[this.buffer.length - 1];
        if (last && last.turnIndex === this.turnId && !last.isComplete) {
            last.speaker = speakerName;
        }

        this.emit('transcript:update', {
            turnId: this.turnId,
            speaker: this.currentSpeaker,
            text: this.currentTurnText.trim(),
            timestamp: this.turnStartTime,
            isComplete: false
        });
    }

    _abandonGhostSpeaker() {
        if (!this.currentSpeaker) return;
        if (this.currentTurnText && String(this.currentTurnText).trim() && !this._committedTurnIds.has(this.turnId)) {
            return;
        }
        this.currentSpeaker = null;
        this.currentTurnText = '';
        this.activeTurnBlocks.clear();
    }

    _tokenize(text) {
        return String(text).trim().split(/\s+/).filter(Boolean);
    }

    _normalizeWord(word) {
        return String(word).toLowerCase().replace(/[^\w']/g, '');
    }

    _normalizeForPrefix(text) {
        return String(text).toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    }

    _isTextPrefix(a, b) {
        const x = this._normalizeForPrefix(a);
        const y = this._normalizeForPrefix(b);
        if (!x || !y) return false;
        return y.startsWith(x) || x.startsWith(y);
    }

    _isMicroTurn(text) {
        return this._tokenize(text).length <= MICRO_TURN_MAX_WORDS;
    }

    _countOverlap(prevWords, nextWords) {
        const prevNorm = prevWords.map(w => this._normalizeWord(w)).filter(Boolean);
        const nextNorm = nextWords.map(w => this._normalizeWord(w)).filter(Boolean);
        const max = Math.min(prevNorm.length, nextNorm.length);
        for (let n = max; n >= 1; n--) {
            let match = true;
            for (let i = 0; i < n; i++) {
                const pw = prevNorm[prevNorm.length - n + i];
                const nw = nextNorm[i];
                if (pw === nw) continue;
                if (i === n - 1 && pw.length >= 2 && nw.startsWith(pw)) continue;
                match = false;
                break;
            }
            if (match) return n;
        }
        return 0;
    }

    _wordSet(text) {
        return new Set(this._tokenize(text).map(w => this._normalizeWord(w)).filter(w => w.length > 2));
    }

    _contentOverlapRatio(a, b) {
        const aw = this._wordSet(a);
        const bw = this._wordSet(b);
        if (aw.size === 0 || bw.size === 0) return 0;
        let inter = 0;
        for (const w of aw) {
            if (bw.has(w)) inter++;
        }
        return inter / Math.min(aw.size, bw.size);
    }

    _isSameUtterance(a, b) {
        if (!a || !b) return false;
        if (this._isTextPrefix(a, b)) return true;
        const an = this._normalizeForPrefix(a);
        const bn = this._normalizeForPrefix(b);
        if (an.length >= 12 && bn.length >= 12 && (an.includes(bn) || bn.includes(an))) return true;

        const aw = this._tokenize(a);
        const bw = this._tokenize(b);
        const overlap = this._countOverlap(aw, bw);
        if (overlap >= OVERLAP_MIN_WORDS) return true;

        const aHead = aw.slice(0, 3).map(w => this._normalizeWord(w)).join(' ');
        const bHead = bw.slice(0, 3).map(w => this._normalizeWord(w)).join(' ');
        if (aHead && aHead === bHead && aw.length >= 3 && bw.length >= 3) return true;

        const shorter = Math.min(aw.length, bw.length);
        if (shorter >= SAME_UTTERANCE_MIN_WORDS && this._contentOverlapRatio(a, b) >= 0.5) return true;
        return false;
    }

    _collapseRepeatedNgrams(words) {
        const norm = (w) => this._normalizeWord(w);
        const w = words.slice();
        let changed = true;
        while (changed) {
            changed = false;
            const maxN = Math.min(8, Math.floor(w.length / 2));
            outer:
            for (let n = maxN; n >= 2; n--) {
                for (let i = 0; i + 2 * n <= w.length; i++) {
                    let same = true;
                    for (let k = 0; k < n; k++) {
                        if (norm(w[i + k]) !== norm(w[i + n + k])) {
                            same = false;
                            break;
                        }
                    }
                    if (same) {
                        w.splice(i + n, n);
                        changed = true;
                        break outer;
                    }
                }
            }
        }
        return w;
    }

    _dedupeRepeats(text) {
        if (!text) return '';
        const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
        const kept = [];
        for (const sentence of sentences) {
            const n = this._normalizeForPrefix(sentence);
            if (!n) continue;
            if (kept.length) {
                const prev = kept[kept.length - 1];
                const pn = this._normalizeForPrefix(prev);
                if (pn === n) continue;
                const prevWords = this._tokenize(prev).length;
                const nextWords = this._tokenize(sentence).length;
                // Only collapse near-duplicate full sentences (not short continuations)
                if (prevWords >= 5 && nextWords >= 5 && this._contentOverlapRatio(prev, sentence) >= 0.78) {
                    const lenRatio = Math.min(prevWords, nextWords) / Math.max(prevWords, nextWords);
                    if (lenRatio >= 0.65) {
                        if (sentence.length >= prev.length) kept[kept.length - 1] = sentence;
                        continue;
                    }
                }
                if (prevWords >= 4 && nextWords >= 4 && (pn.includes(n) || n.includes(pn))) {
                    if (sentence.length > prev.length) kept[kept.length - 1] = sentence;
                    else if (pn.includes(n)) continue;
                }
            }
            kept.push(sentence);
        }
        const joined = kept.join(' ').trim();
        return this._collapseRepeatedNgrams(this._tokenize(joined)).join(' ');
    }

    _isGenericSpeaker(name) {
        const n = String(name || '').trim();
        if (!n || n === 'Speaker' || n === 'Unknown') return true;
        if (/^[a-z]+(_[a-z0-9]+)+$/i.test(n)) return true;
        if (/^(format_size|mic|mic_off|videocam|closed_caption|more_vert|settings)$/i.test(n)) return true;
        return false;
    }

    _isPlaceholderSpeaker(name) {
        const n = String(name || '').trim();
        return this._isGenericSpeaker(n) || /^speaker\s*\d+$/i.test(n);
    }

    _canonicalSpeaker(name) {
        const cleaned = String(name || '').trim().replace(/[''"]+\s*$/g, '').trim();
        if (this._isGenericSpeaker(cleaned)) {
            return this.currentSpeaker && !this._isPlaceholderSpeaker(this.currentSpeaker)
                ? this.currentSpeaker
                : (cleaned || 'Speaker');
        }
        return cleaned;
    }

    _speakersMatch(a, b) {
        if (!a || !b) return false;
        if (a === b) return true;
        const na = this._normSpeakerName(a);
        const nb = this._normSpeakerName(b);
        if (na && nb && na === nb) return true;
        return false;
    }

    /**
     * Industry-standard caption identity: renaming Speaker → "Rahul G" must NOT
     * close the open turn. Only a real named↔named switch is a speaker-change.
     * Returns the label to use, or null when a true speaker-change is required.
     */
    _resolveOpenSpeaker(label) {
        if (!this.currentSpeaker) return label;
        if (this._speakersMatch(label, this.currentSpeaker)) return this.currentSpeaker;

        const curPh = this._isPlaceholderSpeaker(this.currentSpeaker);
        const inPh = this._isPlaceholderSpeaker(label);

        if (curPh && !inPh) {
            this.currentSpeaker = label;
            return label;
        }
        if (!curPh && inPh) {
            return this.currentSpeaker;
        }
        return null;
    }

    _stripPhrase(words, phraseWords) {
        if (phraseWords.length < 4 || words.length < 4) return words;
        const wNorm = words.map(w => this._normalizeWord(w));
        const pNorm = phraseWords.map(w => this._normalizeWord(w)).filter(Boolean);
        if (pNorm.length < 4) return words;
        for (let len = pNorm.length; len >= 4; len--) {
            for (let ps = 0; ps <= pNorm.length - len; ps++) {
                const needle = pNorm.slice(ps, ps + len);
                for (let i = 0; i + len <= wNorm.length; i++) {
                    let match = true;
                    for (let k = 0; k < len; k++) {
                        if (wNorm[i + k] !== needle[k]) {
                            match = false;
                            break;
                        }
                    }
                    if (match) {
                        const next = words.slice(0, i).concat(words.slice(i + len));
                        return this._stripPhrase(next, phraseWords);
                    }
                }
            }
        }
        return words;
    }

    _stripForeignText(incoming, foreignText) {
        if (!incoming || !foreignText) return incoming;
        const foreignN = this._normalizeForPrefix(foreignText);
        const inN = this._normalizeForPrefix(incoming);
        if (foreignN.length >= 8 && (inN === foreignN || foreignN.includes(inN))) return '';
        const stripped = this._stripPhrase(this._tokenize(incoming), this._tokenize(foreignText));
        return stripped.join(' ').trim();
    }

    _findAlignIndex(existW, inW) {
        const en = existW.map(w => this._normalizeWord(w));
        const inn = inW.map(w => this._normalizeWord(w));
        for (let head = Math.min(5, inn.length); head >= 3; head--) {
            const needle = inn.slice(0, head).join(' ');
            if (!needle.trim()) continue;
            for (let i = 0; i <= en.length - head; i++) {
                if (en.slice(i, i + head).join(' ') === needle) return i;
            }
        }
        return -1;
    }

    _mergeUtterance(existing, incoming) {
        if (!existing) return this._dedupeRepeats(incoming);
        if (!incoming) return this._dedupeRepeats(existing);

        const existN = this._normalizeForPrefix(existing);
        const inN = this._normalizeForPrefix(incoming);
        if (existN.includes(inN)) return this._dedupeRepeats(existing);
        if (inN.includes(existN)) return this._dedupeRepeats(incoming);

        const existW = this._tokenize(existing);
        const inW = this._tokenize(incoming);
        const overlapRatio = this._contentOverlapRatio(existing, incoming);

        // Same-line STT rewrite (similar head + high overlap) — replace, don't glue
        const aHead = existW.slice(0, 3).map((w) => this._normalizeWord(w)).join(' ');
        const bHead = inW.slice(0, 3).map((w) => this._normalizeWord(w)).join(' ');
        const headSame = aHead && bHead && (aHead === bHead || this._wordsMatchLoose(aHead.split(' ')[0], bHead.split(' ')[0]));
        const lenRatio = Math.min(existW.length, inW.length) / Math.max(existW.length, inW.length);
        if (headSame && overlapRatio >= 0.55 && lenRatio >= 0.5) {
            return this._dedupeRepeats(incoming.length >= existing.length ? incoming : existing);
        }
        if (this._isTextPrefix(existing, incoming)) {
            return this._dedupeRepeats(incoming.length >= existing.length ? incoming : existing);
        }

        const align = this._findAlignIndex(existW, inW);
        if (align > 0) {
            const prefix = existW.slice(0, align).join(' ');
            return this._dedupeRepeats(`${prefix} ${incoming}`);
        }

        const overlap = this._countOverlap(existW, inW);
        if (overlap >= 2) {
            const uniquePrefix = existW.slice(0, existW.length - overlap).join(' ');
            return this._dedupeRepeats(uniquePrefix ? `${uniquePrefix} ${incoming}` : incoming);
        }

        return this._dedupeRepeats(`${existing} ${incoming}`);
    }

    _isDuplicateOf(text, other) {
        if (!text || !other) return false;
        const a = this._normalizeForPrefix(text);
        const b = this._normalizeForPrefix(other);
        if (!a || !b) return false;
        const aLen = this._tokenize(text).length;
        const bLen = this._tokenize(other).length;
        if (aLen > bLen) return false;
        if (b.includes(a)) return true;
        if (b.endsWith(a) || aLen >= 2 && b.endsWith(` ${a}`)) return true;
        return this._contentOverlapRatio(text, other) >= 0.85 && aLen <= bLen + 3;
    }

    _isEchoOfLastCommitted(text, speaker) {
        if (!text) return false;
        const last = this.buffer[this.buffer.length - 1];
        if (last && last.isComplete && last.text) {
            // Only consider trailing echo if it arrived within 2.5s of the same speaker's finalized turn
            const age = Date.now() - (last.timestamp || 0);
            if (age < 2500 && this._speakersMatch(last.speaker, speaker)) {
                const a = this._normalizeForPrefix(text);
                const b = this._normalizeForPrefix(last.text);
                if (a && b && a === b) return true;
                if (this._isDuplicateOf(text, last.text) && this._tokenize(text).length <= this._tokenize(last.text).length) {
                    return true;
                }
            }
        }
        return false;
    }

    _isFillerOnly(text) {
        const t = String(text || '').trim().toLowerCase().replace(/[^\w\s']/g, '').trim();
        if (!t) return true;
        return /^(um+|uh+|uhm+|hmm+|mm+|mhm+|ah+|oh+|er+|erm+|like|yeah|yep|yup|ok|okay|right|so|well|and|but)$/i.test(t);
    }

    _wordsMatchLoose(a, b) {
        const x = String(a || '').toLowerCase().replace(/[^a-z0-9']/g, '');
        const y = String(b || '').toLowerCase().replace(/[^a-z0-9']/g, '');
        if (!x || !y) return false;
        if (x === y) return true;
        if (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))) return true;
        // mild STT drift: plan/pan, pricing/price
        if (x.length >= 4 && y.length >= 4) {
            let diff = 0;
            const n = Math.min(x.length, y.length);
            for (let i = 0; i < n; i++) if (x[i] !== y[i]) diff++;
            diff += Math.abs(x.length - y.length);
            if (diff <= 2) return true;
        }
        return false;
    }

    _stripHistoryPrefix(speaker, incoming) {
        if (!incoming) return incoming;
        if (this._isPlaceholderSpeaker(speaker)) return incoming;

        // ONLY strip cumulative caption repeats from the immediately preceding turn
        // if it belongs to the same speaker and finished recently (< 6000ms ago).
        // NEVER strip words against older conversation history!
        const last = this.buffer[this.buffer.length - 1];
        if (!last || !last.isComplete || !this._speakersMatch(last.speaker, speaker)) {
            return incoming;
        }
        const age = Date.now() - (last.timestamp || 0);
        if (age > 6000) {
            return incoming;
        }

        const candidates = [last.text];
        let text = incoming;
        let safety = 0;
        while (safety++ < 4) {
            const inWords = this._tokenize(text);
            if (inWords.length < 3) break;

            let bestRest = null;
            let bestMatchWords = 0;

            for (const prev of candidates) {
                if (!prev) continue;
                const prevWords = this._tokenize(prev);
                if (prevWords.length < 3) continue;

                let matchLen = 0;
                const limit = Math.min(prevWords.length, inWords.length);
                for (let i = 0; i < limit; i++) {
                    if (this._wordsMatchLoose(prevWords[i], inWords[i])) matchLen++;
                    else break;
                }

                const longIncoming = inWords.length >= prevWords.length + 2;
                const need = longIncoming
                    ? Math.max(3, Math.floor(prevWords.length * 0.5))
                    : Math.max(4, Math.floor(prevWords.length * 0.7));
                if (matchLen >= need && matchLen > bestMatchWords) {
                    bestMatchWords = matchLen;
                    bestRest = inWords.slice(matchLen).join(' ').trim();
                }

                const prevN = this._normalizeForPrefix(prev);
                const inN = this._normalizeForPrefix(text);
                if (prevN && inN && inN.startsWith(prevN) && inN.length > prevN.length) {
                    let rest = text.slice(prev.length).replace(/^[\s.!?…,;:\-–]+/, '').trim();
                    if (!rest) rest = inWords.slice(prevWords.length).join(' ').trim();
                    if (prevWords.length > bestMatchWords) {
                        bestMatchWords = prevWords.length;
                        bestRest = rest;
                    }
                }
            }

            if (bestRest === null) break;
            text = bestRest.replace(/^(um+|uh+|uhm+|hmm+|ah+|oh+|er+|erm+)[,.\s]+/i, '').trim();
            if (!text || text === incoming) break;
        }

        return text || incoming;
    }

    _stripCommittedPrefix(incoming) {
        const last = this._lastOtherSpeakerText;
        if (!last || !incoming) return incoming;
        const lastN = this._normalizeForPrefix(last);
        const inN = this._normalizeForPrefix(incoming);
        if (!lastN || !inN || !inN.startsWith(lastN) || inN.length <= lastN.length) return incoming;
        let rest = incoming.slice(last.length).replace(/^[\s.!?…,;:\-–]+/, '').trim();
        if (!rest) {
            const words = this._tokenize(incoming);
            const drop = this._tokenize(last).length;
            rest = words.slice(drop).join(' ').trim();
        }
        return rest || incoming;
    }

    _stripTrailingOverlap(existing, incoming) {
        if (!existing || !incoming) return existing;
        const overlap = this._countOverlap(this._tokenize(existing), this._tokenize(incoming));
        if (overlap < 2) return existing;
        const kept = this._tokenize(existing).slice(0, this._tokenize(existing).length - overlap);
        return kept.join(' ').trim() || existing;
    }

    _buildTurn(isComplete = false) {
        let speakerRole = 'panel';
        if (this.candidateName) {
            speakerRole = this._speakerMatchesCandidate(this.currentSpeaker) ? 'candidate' : 'panel';
        }
        return {
            speaker: this.currentSpeaker,
            speakerRole,
            text: this.currentTurnText.trim(),
            timestamp: this.turnStartTime || Date.now(),
            turnIndex: this.turnId,
            isComplete
        };
    }

    _upsertOpenTurn() {
        const text = this.currentTurnText ? this.currentTurnText.trim() : '';
        if (!text || !this.currentSpeaker) return null;
        const last = this.buffer[this.buffer.length - 1];
        if (last && last.turnIndex === this.turnId) {
            // Never rewrite a finalized row — live updates must use a new turnId.
            if (last.isComplete || this._committedTurnIds.has(this.turnId)) {
                return last;
            }
            last.text = text;
            last.speaker = this.currentSpeaker;
            return last;
        }
        if (this._committedTurnIds.has(this.turnId)) {
            return null;
        }
        const turn = this._buildTurn(false);
        this.buffer.push(turn);
        return turn;
    }

    _emitLiveUpdate() {
        this.emit('transcript:update', {
            turnId: this.turnId,
            speaker: this.currentSpeaker,
            text: this.currentTurnText,
            timestamp: this.turnStartTime,
            isComplete: false
        });
    }

    _scheduleSilenceLlm(now) {
        this._lastChunkTimestamp = now;
        this._upsertOpenTurn();
        this._emitLiveUpdate();
        if (this._silenceTimer) clearTimeout(this._silenceTimer);
        this._silenceTimer = setTimeout(() => {
            this._finalizeCurrentTurn('silence');
        }, SILENCE_FINALIZE_MS);
    }

    _startTurn(speakerName, text, blockId, now) {
        this.turnId += 1;
        while (this._committedTurnIds.has(this.turnId)) this.turnId += 1;
        this.activeTurnBlocks.clear();
        this.currentSpeaker = speakerName;
        this.turnStartTime = now;
        this.activeTurnBlocks.set(blockId, text);
        this.currentTurnText = text;
        this._committedTurnIds.delete(this.turnId);
    }

    _startTextAfterSpeakerChange(fullText) {
        const prev = String(this._lastOtherSpeakerText || '').trim();
        if (!fullText) return '';
        if (!prev) return fullText;
        const split = this._splitCumulativeCaption(prev, fullText);
        if (split) return split;
        const prevN = this._normalizeForPrefix(prev);
        const inN = this._normalizeForPrefix(fullText);
        if (prevN && inN && inN.startsWith(prevN) && inN.length > prevN.length) {
            const rest = this._tokenize(fullText).slice(this._tokenize(prev).length).join(' ').trim();
            if (rest) return rest;
        }
        // Do not phrase-strip — that chops new speech mid-sentence when captions overlap loosely.
        if (prevN && inN && (inN === prevN || prevN.includes(inN))) return '';
        return fullText;
    }

    _canContinueLastTurn(speaker, text, now = Date.now()) {
        const last = this.buffer[this.buffer.length - 1];
        if (!last || !last.isComplete || !last.text) return false;
        if (this._actionSealedTurnIds.has(last.turnIndex)) return false;
        if (this._isPlaceholderSpeaker(last.speaker) || this._isPlaceholderSpeaker(speaker)) return false;
        if (!this._speakersMatch(last.speaker, speaker)) return false;

        const age = now - (last.timestamp || 0);
        if (age > CONTINUATION_WINDOW_MS) return false;

        const lastText = last.text.trim();
        const nextText = String(text || '').trim();
        if (!nextText) return false;
        if (this._normalizeForPrefix(nextText) === this._normalizeForPrefix(lastText)) return false;

        // Exact / near duplicate of the finished line — ignore, don't reopen
        if (this._isDuplicateOf(nextText, lastText) && this._tokenize(nextText).length <= this._tokenize(lastText).length) {
            return false;
        }

        const lastN = this._normalizeForPrefix(lastText);
        const nextN = this._normalizeForPrefix(nextText);

        // Growing caption / STT rewrite of the same line → continue
        if (nextN.startsWith(lastN) || lastN.startsWith(nextN)) return true;

        // Finished sentence + new content → always a new turn (never reopen/replace)
        if (/[.!?…]$/.test(lastText) && !this._isSameUtterance(lastText, nextText)) {
            return false;
        }

        // Incomplete prior turn: only stack if overlap / shared head suggests same utterance
        if (
            this._isSameUtterance(lastText, nextText) ||
            this._contentOverlapRatio(lastText, nextText) >= 0.4 ||
            this._isTextPrefix(lastText, nextText)
        ) {
            return true;
        }
        return false;
    }

    _splitCumulativeCaption(lastText, nextText) {
        if (!lastText || !nextText) return null;
        const lastN = this._normalizeForPrefix(lastText);
        const nextN = this._normalizeForPrefix(nextText);
        if (!lastN || !nextN || !nextN.startsWith(lastN) || nextN.length <= lastN.length) return null;
        let rest = nextText.slice(lastText.length).replace(/^[\s.!?…,;:\-–]+/, '').trim();
        if (!rest) {
            const drop = this._tokenize(lastText).length;
            rest = this._tokenize(nextText).slice(drop).join(' ').trim();
        }
        if (!rest || this._tokenize(rest).length < 2) return null;
        return rest;
    }

    _reopenLastTurn(speaker, text, blockId, now) {
        const last = this.buffer[this.buffer.length - 1];
        if (!last) return false;
        if (this._actionSealedTurnIds.has(last.turnIndex)) return false;

        this.turnId = last.turnIndex;
        this.currentSpeaker = speaker;
        this.turnStartTime = last.timestamp || now;
        this.currentTurnText = this._mergeUtterance(last.text, text);
        last.text = this.currentTurnText;
        last.speaker = speaker;
        last.isComplete = false;
        this._committedTurnIds.delete(this.turnId);
        const key = this._normSpeakerName(speaker);
        if (key) this._lastCommittedBySpeaker.delete(key);
        this.activeTurnBlocks.clear();
        this.activeTurnBlocks.set(blockId, text);
        return true;
    }

    _applyToCurrentTurn(blockId, text) {
        this.activeTurnBlocks.clear();
        this.activeTurnBlocks.set(blockId, text);
        this.currentTurnText = text;
    }

    appendChunk(speakerName, text, blockId, isFinal = true) {
        if (!text) return;
        let fullText = String(text)
            .replace(/\bformat_size\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!fullText) return;
        if (/^[a-z]+(_[a-z0-9]+)+$/i.test(fullText)) return;
        if (/\bBETA\b/.test(fullText) && (fullText.match(/\bBETA\b/g) || []).length >= 2) return;
        if (fullText.length > 280 && (fullText.match(/,/g) || []).length >= 8) return;
        // Never transcribe standalone Google Meet material icons (delete, mic_off, etc.)
        if (/^(format_size|mic|mic_off|videocam|videocam_off|present_to_all|more_vert|more_horiz|call_end|closed_caption|captions|settings|people|chat|back_hand|pan_tool|volume_up|volume_off|screen_share|stop_screen_share|fullscreen|fullscreen_exit|add|close|check|arrow_drop_down|keyboard_arrow_down|info|help|search|send|edit|delete|content_copy|done|warning|error|push_pin|keep|keep_off|mood|emoji_emotions|devices|cast|hd|speed|tune|visibility|visibility_off)[.!?…,;:\s]*$/i.test(fullText)) {
            return;
        }

        let rawSpeaker = String(speakerName || '').trim();
        if (/format_size/i.test(rawSpeaker) || /^[a-z]+(_[a-z0-9]+)+$/i.test(rawSpeaker)) {
            rawSpeaker = this.currentSpeaker || 'Speaker';
        }
        if (!rawSpeaker) rawSpeaker = 'Speaker';
        if (/^xobi(n)?$/i.test(this._normSpeakerName(rawSpeaker)) || /^meetingai$/i.test(this._normSpeakerName(rawSpeaker))) {
            return;
        }
        if (/^xobi(n)?[.!?…,]*$/i.test(fullText)) return;

        const now = Date.now();
        this._abandonGhostSpeaker();
        let label = this._canonicalSpeaker(rawSpeaker);

        if (this._isEchoOfLastCommitted(fullText, label)) return;

        // Meet/STT often replays this speaker's earlier utterance + new words.
        fullText = this._stripHistoryPrefix(label, fullText);
        if (!fullText) return;
        if (this._isFillerOnly(fullText) && !this.currentSpeaker) return;
        if (this._isEchoOfLastCommitted(fullText, label)) return;

        if (!isFinal) {
            fullText = this._stripCommittedPrefix(fullText);
            fullText = this._stripHistoryPrefix(label, fullText);
            if (!fullText) return;
            if (this._isFillerOnly(fullText) && !this.currentSpeaker) return;
            if (!this.currentSpeaker) {
                if (this._canContinueLastTurn(label, fullText, now) && this._reopenLastTurn(label, fullText, `interim_${this.turnId}`, now)) {
                    // continued sealed-safe reopen
                } else {
                    this.turnId += 1;
                    while (this._committedTurnIds.has(this.turnId)) this.turnId += 1;
                    this.currentSpeaker = label;
                    this.turnStartTime = now;
                    this.currentTurnText = fullText;
                    this._committedTurnIds.delete(this.turnId);
                }
                this._upsertOpenTurn();
                this._emitLiveUpdate();
                if (this._silenceTimer) clearTimeout(this._silenceTimer);
                this._silenceTimer = setTimeout(() => {
                    this._finalizeCurrentTurn('silence');
                }, SILENCE_FINALIZE_MS);
                this._lastChunkTimestamp = now;
                return;
            }

            const resolved = this._resolveOpenSpeaker(label);
            if (resolved == null) {
                this._finalizeCurrentTurn('speaker-change');
                let startText = this._startTextAfterSpeakerChange(fullText);
                startText = this._stripHistoryPrefix(label, startText || fullText);
                if (!startText || this._isFillerOnly(startText)) return;
                if (this._isEchoOfLastCommitted(startText, label)) return;
                this._startTurn(label, startText, `interim_${this.turnId}`, now);
                this._emitLiveUpdate();
                if (this._silenceTimer) clearTimeout(this._silenceTimer);
                this._silenceTimer = setTimeout(() => {
                    this._finalizeCurrentTurn('silence');
                }, SILENCE_FINALIZE_MS);
                this._lastChunkTimestamp = now;
                return;
            }
            label = resolved;

            // Captions / STT partials are usually replacements of a growing utterance.
            const existN = this._normalizeForPrefix(this.currentTurnText);
            const inN = this._normalizeForPrefix(fullText);
            if (inN && existN && (inN.startsWith(existN) || existN.startsWith(inN) || inN.includes(existN))) {
                this.currentTurnText = inN.length >= existN.length ? fullText : this.currentTurnText;
            } else {
                this.currentTurnText = this.currentTurnText
                    ? this._mergeUtterance(this.currentTurnText, fullText)
                    : fullText;
            }
            this._upsertOpenTurn();
            this._emitLiveUpdate();
            if (this._silenceTimer) clearTimeout(this._silenceTimer);
            this._silenceTimer = setTimeout(() => {
                this._finalizeCurrentTurn('silence');
            }, SILENCE_FINALIZE_MS);
            this._lastChunkTimestamp = now;
            return;
        }

        const effectiveBlockId = (typeof blockId === 'string' || typeof blockId === 'number')
            ? blockId
            : `blk_${this.turnId}_${this.activeTurnBlocks.size}`;

        fullText = this._dedupeRepeats(fullText);
        if (!fullText) return;
        fullText = this._stripHistoryPrefix(label, fullText);
        if (!fullText) return;
        if (this._isFillerOnly(fullText) && !this.currentSpeaker) return;
        if (this._isEchoOfLastCommitted(fullText, label)) return;

        const prevText = this.currentTurnText ? this.currentTurnText.trim() : '';
        if (this.currentSpeaker) {
            const resolved = this._resolveOpenSpeaker(label);
            if (resolved != null) label = resolved;
        }
        const sameSpeaker = !!this.currentSpeaker && this._speakersMatch(label, this.currentSpeaker);

        if (sameSpeaker && this._isDuplicateOf(fullText, prevText)) return;
        if (this.currentSpeaker && !sameSpeaker && this._isDuplicateOf(fullText, this._lastOtherSpeakerText)) return;

        if (!this.currentSpeaker) {
            let startText = this._startTextAfterSpeakerChange(fullText);
            startText = this._stripHistoryPrefix(label, startText || fullText);
            if (!startText || this._isFillerOnly(startText)) return;
            if (this._canContinueLastTurn(label, startText || fullText, now)
                && this._reopenLastTurn(label, startText || fullText, effectiveBlockId, now)) {
                this._scheduleSilenceLlm(now);
                return;
            }
            this._startTurn(label, startText || fullText, effectiveBlockId, now);
            this._scheduleSilenceLlm(now);
            return;
        }

        if (sameSpeaker) {
            // Only break into a new turn for a true topic shift (rare). Prefer stacking.
            if (
                prevText &&
                this._tokenize(prevText).length >= TOPIC_BREAK_MIN_WORDS &&
                this._tokenize(fullText).length >= TOPIC_BREAK_MIN_WORDS &&
                /[.!?…]$/.test(prevText) &&
                !this._isSameUtterance(prevText, fullText) &&
                !this._isTextPrefix(prevText, fullText) &&
                !this._isTextPrefix(fullText, prevText) &&
                this._contentOverlapRatio(prevText, fullText) < 0.08
            ) {
                this._finalizeCurrentTurn('topic-break');
                const nextOnly = this._stripHistoryPrefix(label, fullText) || fullText;
                if (!nextOnly || this._isFillerOnly(nextOnly)) return;
                this._startTurn(label, nextOnly, effectiveBlockId, now);
                this._scheduleSilenceLlm(now);
                return;
            }

            let incoming = fullText;
            if (prevText) {
                const growth = this._splitCumulativeCaption(prevText, incoming);
                if (growth) {
                    this._applyToCurrentTurn(effectiveBlockId, this._dedupeRepeats(`${prevText} ${growth}`));
                    this._scheduleSilenceLlm(now);
                    return;
                }
                const strippedOpen = this._stripHistoryPrefix(label, incoming);
                const prevN = this._normalizeForPrefix(prevText);
                const inN = this._normalizeForPrefix(incoming);
                if (
                    strippedOpen &&
                    strippedOpen !== incoming &&
                    this._tokenize(strippedOpen).length < this._tokenize(incoming).length &&
                    prevN &&
                    inN.includes(prevN) &&
                    this._tokenize(prevText).length >= 4
                ) {
                    this._applyToCurrentTurn(effectiveBlockId, this._mergeUtterance(prevText, strippedOpen));
                    this._scheduleSilenceLlm(now);
                    return;
                }
                if (this._isSameUtterance(prevText, incoming) || this._contentOverlapRatio(prevText, incoming) >= 0.6) {
                    this._applyToCurrentTurn(effectiveBlockId, this._mergeUtterance(prevText, incoming));
                    this._scheduleSilenceLlm(now);
                    return;
                }
            }
            if (this._lastOtherSpeakerText) {
                const stripped = this._stripForeignText(incoming, this._lastOtherSpeakerText);
                if (stripped) incoming = this._dedupeRepeats(stripped);
            }
            this._applyToCurrentTurn(effectiveBlockId, this._mergeUtterance(prevText, incoming || fullText));
            this._scheduleSilenceLlm(now);
            return;
        }

        const cleanedPrev = this._stripTrailingOverlap(prevText, fullText);
        if (cleanedPrev && cleanedPrev !== prevText) {
            this.currentTurnText = cleanedPrev;
        }
        this._finalizeCurrentTurn('speaker-change');
        let startText = this._startTextAfterSpeakerChange(fullText);
        startText = this._stripHistoryPrefix(label, startText || fullText);
        if (!startText || this._isFillerOnly(startText)) return;
        this._startTurn(label, startText, effectiveBlockId, now);
        this._scheduleSilenceLlm(now);
    }

    /**
     * DOM active-speaker flipped to a different named person — close the open
     * turn immediately so the next STT chunks become a new bubble (not a replace).
     */
    onDomSpeakerChange(speakerName) {
        const next = String(speakerName || '').trim().replace(/[''"]+\s*$/g, '').trim();
        if (!next || this._isPlaceholderSpeaker(next)) return;
        if (!this.currentSpeaker || !this.currentTurnText) return;
        if (this._speakersMatch(this.currentSpeaker, next)) return;
        if (this._isPlaceholderSpeaker(this.currentSpeaker)) {
            this.updateCurrentSpeakerName(next);
            return;
        }
        this._finalizeCurrentTurn('dom-speaker-change');
    }

    _finalizeCurrentTurn(reason = 'speaker-change') {
        if (this._silenceTimer) {
            clearTimeout(this._silenceTimer);
            this._silenceTimer = null;
        }

        const text = this.currentTurnText ? this.currentTurnText.trim() : '';
        if (!text || !this.currentSpeaker) return;

        if (this._isFillerOnly(text)) {
            this.activeTurnBlocks.clear();
            this.currentSpeaker = null;
            this.currentTurnText = '';
            return;
        }

        // Hold micro / unfinished fragments until more speech arrives
        if (reason === 'silence') {
            const words = this._tokenize(text).length;
            const incomplete = !/[.!?…]$/.test(text);
            if (this._isMicroTurn(text) || (incomplete && words < 8)) {
                this._silenceHoldCount = (this._silenceHoldCount || 0) + 1;
                if (this._silenceHoldCount < 2) {
                    this._scheduleSilenceLlm(Date.now());
                    return;
                }
            }
            this._silenceHoldCount = 0;
        } else {
            this._silenceHoldCount = 0;
        }

        if (this._committedTurnIds.has(this.turnId)) {
            this._upsertOpenTurn();
            return;
        }
        this._committedTurnIds.add(this.turnId);

        this._lastOtherSpeakerText = text;
        const speakerKey = this._normSpeakerName(this.currentSpeaker);
        if (speakerKey) {
            this._lastCommittedBySpeaker.set(speakerKey, text);
            if (this._tokenize(text).length >= 4) {
                this._lastSubstantialBySpeaker.set(speakerKey, text);
            }
        }
        const turn = this._upsertOpenTurn();
        if (!turn) return;
        turn.isComplete = true;
        turn.timestamp = Date.now();

        console.log(`[TranscriptManager] Turn finalized: [${turn.speakerRole}] ${turn.speaker}: ${turn.text}`);

        this.emit('transcript:update', {
            turnId: this.turnId,
            speaker: turn.speaker,
            text: turn.text,
            timestamp: turn.timestamp,
            isComplete: true
        });

        this.activeTurnBlocks.clear();
        this.currentSpeaker = null;
        this.currentTurnText = '';
        this.emit('turn:complete', { ...turn, reason });
    }

    commitTurn() {
        if (this._silenceTimer) {
            clearTimeout(this._silenceTimer);
            this._silenceTimer = null;
        }

        this._finalizeCurrentTurn('manual-action');

        const last = this.buffer[this.buffer.length - 1];
        if (last && last.turnIndex != null) {
            this._actionSealedTurnIds.add(last.turnIndex);
            this._committedTurnIds.add(last.turnIndex);
            if (!last.isComplete) {
                last.isComplete = true;
                this.emit('transcript:update', {
                    turnId: last.turnIndex,
                    speaker: last.speaker,
                    text: last.text,
                    timestamp: last.timestamp,
                    isComplete: true
                });
            }
        } else if (this.turnId) {
            this._actionSealedTurnIds.add(this.turnId);
        }

        this.activeTurnBlocks.clear();
        this.currentSpeaker = null;
        this.currentTurnText = '';
    }

    getContext() {
        this._upsertOpenTurn();
        return this.buffer.slice(-20);
    }

    getAllTurns() {
        this._upsertOpenTurn();
        return this.buffer.slice();
    }
}

module.exports = TranscriptManager;
