/* cue renderer â€” UI state, mic capture, IPC, streaming render. */
window.initRenderer = function () {
  const cue = window.cue; // exposed by preload
  window.addEventListener('error', (e) => {
    if (cue && cue.log) cue.log('[Renderer Error] ' + e.message + ' at ' + e.filename + ':' + e.lineno);
  });
  const { icon } = window.ICONS || {};
  const shadow = window.__MEETINGAI_SHADOW__ || document;
  const $ = (s) => shadow.querySelector(s);
  const $$ = (s) => shadow.querySelectorAll(s);

  // ---- new island actions ------------------------------------------------
  const logoImg = $('#island-logo');
  if (logoImg && window.chrome && chrome.runtime && chrome.runtime.getURL) {
    logoImg.src = chrome.runtime.getURL('ui/logo.png');
  }

  const panelMain = $('#panel');
  const btnAskHide = $('#btn-ask-hide');
  if (btnAskHide && panelMain) {
    btnAskHide.addEventListener('click', () => {
      if (panelMain.style.display === 'none') {
        panelMain.style.display = 'flex';
        btnAskHide.style.background = 'rgba(255,255,255,0.05)';
        btnAskHide.style.boxShadow = 'none';
        btnAskHide.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.8"><polyline points="6 9 12 15 18 9"></polyline></svg> Hide`;
      } else {
        panelMain.style.display = 'none';
        btnAskHide.style.background = 'linear-gradient(180deg, #1860d5 0%, #0a4699 100%)';
        btnAskHide.style.boxShadow = 'inset 0 1px 1px rgba(255,255,255,0.3)';
        btnAskHide.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L11.5 7.5L16 9L11.5 10.5L10 15L8.5 10.5L4 9L8.5 7.5z"></path><path d="M19 15L19.8 17.2L22 18L19.8 18.8L19 21L18.2 18.8L16 18L18.2 17.2z"></path></svg> Ask`;
      }
    });
  }

  const btnToggleListen = $('#island-toggle-listen');
  const btnTogglePanel = $('#btn-toggle-panel');
  const liveDot = $('#live-dot');

  function toggleOverlay() {
    const panel = $('#panel');
    if (!panel) return;
    panel.classList.toggle('collapsed');
    const isCollapsed = panel.classList.contains('collapsed');
    if (btnTogglePanel) {
      btnTogglePanel.innerHTML = icon(isCollapsed ? 'eye-off' : 'eye', { size: 20 });
    }
  }

  // Set initial icon
  if (btnTogglePanel) {
    btnTogglePanel.innerHTML = icon('eye', { size: 20 });
  }

  if (btnTogglePanel) btnTogglePanel.onclick = toggleOverlay;
  if (liveDot) {
    liveDot.style.cursor = 'pointer';
    liveDot.onclick = toggleOverlay;
  }


  // ---- call timer --------------------------------------------------------
  let meetingSeconds = 0;
  const timeEl = $('#island-time');
  if (timeEl) {
    setInterval(() => {
      meetingSeconds++;
      const m = Math.floor(meetingSeconds / 60).toString().padStart(2, '0');
      const s = (meetingSeconds % 60).toString().padStart(2, '0');
      timeEl.textContent = `${m}:${s}`;
    }, 1000);
  }

  // ---- icon bindings -----------------------------------------------------
  const btnSearch = document.querySelector('.act[data-mode="search"] .ic');
  if (btnSearch) btnSearch.innerHTML = icon('monitor', { size: 16 });
  const btnFollowup = document.querySelector('.act[data-mode="followup"] .ic');
  if (btnFollowup) btnFollowup.innerHTML = icon('message-circle', { size: 16 });
  const btnAsk = document.querySelector('.act[data-mode="ask"] .ic');
  if (btnAsk) btnAsk.innerHTML = icon('help-circle', { size: 16 });
  const btnEval = $('.act[data-mode="evaluate"]');
  if (btnEval) btnEval.querySelector('.ic').innerHTML = icon('bar-chart-2', { size: 16 });

  const sendBtn = $('#send-btn');
  if (sendBtn) sendBtn.innerHTML = icon('arrow-up', { size: 18, strokeWidth: 3 });

  const btnCandidates = $('#btn-candidates');
  if (btnCandidates) {
    btnCandidates.querySelector('.ic').innerHTML = icon('users', { size: 16 });
    btnCandidates.onclick = (e) => {
      e.stopPropagation();
      const dropdown = $('#candidates-dropdown');
      dropdown.classList.toggle('hidden');
      if (!dropdown.classList.contains('hidden')) {
        dropdown.innerHTML = '<div class="dropdown-item" style="opacity: 0.5">Loading...</div>';
        if (window.cue && cue.requestParticipants) cue.requestParticipants();
      }
    };
  }

  // Handle document click to close candidate dropdown
  document.addEventListener('mousedown', (e) => {
    const dropdown = $('#setup-candidates-dropdown');
    if (dropdown && !dropdown.classList.contains('hidden')) {
      if (!e.target.closest('#setup-candidate-btn') && !e.target.closest('#setup-candidates-dropdown')) {
        dropdown.classList.add('hidden');
      }
    }
  });

  const setupCandidateBtn = $('#setup-candidate-btn');
  if (setupCandidateBtn) {
    setupCandidateBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const dropdown = $('#setup-candidates-dropdown');
      if (dropdown) {
        dropdown.classList.toggle('hidden');
        if (!dropdown.classList.contains('hidden')) {
          if (window.cue && cue.requestParticipants) cue.requestParticipants();
        }
      }
    });
  }

  window.__salesModeUi = false;
  function applyInsightsMode(isSales) {
    // Prefer stable IDs (Shadow DOM safe). Attribute selectors can miss if HTML is stale/cached.
    const suggestionTitle = $('#insights-ai-suggestion')?.previousElementSibling
      || $('[data-insights-title="suggestion"]');
    const skillsTitle = $('#insights-skills')?.previousElementSibling
      || $('[data-insights-title="skills"]');
    const strengthsTitle = $('#insights-strengths')?.previousElementSibling
      || $('[data-insights-title="strengths"]');
    const gapsTitle = $('#insights-gaps')?.previousElementSibling
      || $('[data-insights-title="gaps"]');
    const trend = $('#insights-trend');
    const liveFitBtn = $('#live-fit-btn');
    const followupBtn = $('.act[data-mode="followup"]');
    const followupSep = followupBtn && followupBtn.previousElementSibling && followupBtn.previousElementSibling.classList.contains('sep')
      ? followupBtn.previousElementSibling
      : null;

    if (suggestionTitle && suggestionTitle.classList.contains('insights-section-title')) {
      suggestionTitle.textContent = isSales ? 'Coach Tip' : 'AI Suggestion';
    }
    if (skillsTitle && skillsTitle.classList.contains('insights-section-title')) {
      skillsTitle.textContent = isSales ? 'Topics & Pain Points' : 'Verified Skills';
    }
    if (strengthsTitle && strengthsTitle.classList.contains('insights-section-title')) {
      strengthsTitle.textContent = isSales ? 'What Went Well' : 'Key Strengths';
    }
    if (gapsTitle && gapsTitle.classList.contains('insights-section-title')) {
      gapsTitle.textContent = isSales ? 'Risks & Next Steps' : 'Risks & Open Items';
    }
    if (liveFitBtn) liveFitBtn.setAttribute('aria-label', isSales ? 'Deal health' : 'Candidate fit');
    if (followupBtn) followupBtn.style.display = isSales ? 'none' : '';
    if (followupSep) followupSep.style.display = isSales ? 'none' : '';
    if (trend) {
      const t = trend.textContent || '';
      if (/Live fit|Live deal health/i.test(t) || !t.trim()) {
        trend.textContent = isSales ? 'Live deal health' : 'Live fit';
      }
    }
    const suggestionEl = $('#insights-ai-suggestion');
    if (suggestionEl) {
      const body = suggestionEl.textContent || '';
      if (/Continue the conversation|reliable fit|deal-health|deal health|Keep the call going|Keep discovery moving/i.test(body)
        || /gather enough evidence/i.test(body)) {
        suggestionEl.textContent = isSales
          ? 'Keep the call going to build a reliable deal-health signal.'
          : 'Continue the conversation to gather enough evidence for a reliable fit score.';
      }
    }
    const strengthsEmpty = $('#insights-strengths');
    if (strengthsEmpty && strengthsEmpty.children.length === 1) {
      const only = strengthsEmpty.children[0].textContent || '';
      if (/No strengths evidenced yet|No positive signals yet/i.test(only)) {
        strengthsEmpty.children[0].textContent = isSales ? 'No positive signals yet' : 'No strengths evidenced yet';
      }
    }
    const gapsEmpty = $('#insights-gaps');
    if (gapsEmpty && gapsEmpty.children.length === 1) {
      const only = gapsEmpty.children[0].textContent || '';
      if (/No risks/i.test(only)) {
        gapsEmpty.children[0].textContent = isSales ? 'No risks or next steps yet' : 'No risks or open items yet';
      }
    }
  }

  function applySetupMode(isSales) {
    window.__salesModeUi = !!isSales;
    const subtitle = $('#setup-subtitle');
    const personLabel = $('#setup-person-label');
    const display = $('#setup-candidate-display');
    const roleWrap = $('#setup-interview-role-wrap');
    const jdWrap = $('#setup-interview-jd-wrap');
    const accountWrap = $('#setup-sales-account-wrap');
    const goalWrap = $('#setup-sales-goal-wrap');
    if (subtitle) {
      subtitle.textContent = isSales
        ? 'Sales Mode — ground answers in your knowledge base'
        : 'Configure your AI assistant for this session';
    }
    if (personLabel) personLabel.textContent = isSales ? 'Customer / Prospect' : 'Candidate';
    if (display && (display.style.opacity === '0.6' || /select (candidate|customer)/i.test(display.textContent || ''))) {
      display.textContent = isSales ? 'Select Customer...' : 'Select Candidate...';
      display.style.opacity = '0.6';
    }
    if (roleWrap) roleWrap.style.display = isSales ? 'none' : 'flex';
    if (jdWrap) jdWrap.style.display = isSales ? 'none' : 'flex';
    if (accountWrap) {
      accountWrap.classList.toggle('hidden', !isSales);
      accountWrap.style.display = isSales ? 'flex' : 'none';
    }
    if (goalWrap) {
      goalWrap.classList.toggle('hidden', !isSales);
      goalWrap.style.display = isSales ? 'flex' : 'none';
    }
    applyInsightsMode(isSales);
  }

  function refreshSalesSetupMode() {
    const applyFromPrefs = (prefs) => {
      const orgOk = !!(prefs && Array.isArray(prefs.orgFeatureFlags) && prefs.orgFeatureFlags.includes('salesMode'));
      const userOk = !!(prefs && prefs.salesModeActive);
      const enabled = orgOk && userOk;
      if (enabled) {
        applySetupMode(true);
        chrome.storage.local.set({ sales_mode_active: 'true' });
        return;
      }
      // Never downgrade an already-active sales UI from a prefs miss
      if (window.__salesModeUi) return;
      chrome.storage.local.get(['sales_mode_active'], (stored) => {
        if (stored.sales_mode_active === 'true') applySetupMode(true);
      });
    };

    // Fast path from last login / preferences cache
    chrome.storage.local.get(['sales_mode_active'], (stored) => {
      if (stored.sales_mode_active === 'true') applySetupMode(true);
    });

    chrome.runtime.sendMessage({
      type: 'FETCH_PROXY',
      url: 'http://localhost:8080/auth/preferences',
      options: { method: 'GET', headers: { 'Content-Type': 'application/json' } }
    }, (res) => {
      if (chrome.runtime.lastError) {
        console.warn('[MeetingAI] preferences fetch error:', chrome.runtime.lastError.message);
        return;
      }
      if (res && res.error) {
        console.warn('[MeetingAI] preferences failed:', res.error, res.status);
        // Keep cached sales UI if we already flipped it on.
        return;
      }
      applyFromPrefs(res && res.data ? res.data : null);
    });
  }
  refreshSalesSetupMode();
  // Preferences may load after auth_token is ready; retry once.
  setTimeout(refreshSalesSetupMode, 1500);
  setTimeout(() => applyInsightsMode(!!window.__salesModeUi), 200);
  setTimeout(() => applyInsightsMode(!!window.__salesModeUi), 2000);

  if (window.cue && window.cue.on) {
    window.cue.on('bot:status', (data) => {
      if (data && typeof data.salesMode === 'boolean') {
        applySetupMode(!!data.salesMode);
      }
    });
  }

  const setupStartBtn = $('#setup-start-btn');
  if (setupStartBtn) {
    setupStartBtn.addEventListener('click', () => {
      const roleInput = $('#setup-role');
      const role = roleInput ? roleInput.value.trim() : '';
      const candidate = window.selectedCandidateName || '';
      const isSales = !!window.__salesModeUi;
      const account = $('#setup-account') ? $('#setup-account').value.trim() : '';
      const goal = $('#setup-goal') ? $('#setup-goal').value.trim() : '';

      if (!candidate) {
        const toast = $('#toast');
        if (toast) {
          toast.textContent = isSales ? 'Please select a Customer / Prospect.' : 'Please select a Candidate.';
          toast.classList.remove('hidden');
          toast.style.background = 'rgba(239, 68, 68, 0.9)';
          if (window.toastTimeout) clearTimeout(window.toastTimeout);
          window.toastTimeout = setTimeout(() => {
            toast.classList.add('hidden');
            toast.style.background = '';
          }, 3000);
        }
        return;
      }
      if (!isSales && !role) {
        const toast = $('#toast');
        if (toast) {
          toast.textContent = 'Please select a Candidate and enter a Job Role.';
          toast.classList.remove('hidden');
          toast.style.background = 'rgba(239, 68, 68, 0.9)';
          if (window.toastTimeout) clearTimeout(window.toastTimeout);
          window.toastTimeout = setTimeout(() => {
            toast.classList.add('hidden');
            toast.style.background = '';
          }, 3000);
        }
        return;
      }

      $('#pre-meeting-view').style.display = 'none';
      const mainChat = $('#main-chat-view');
      mainChat.classList.remove('hidden');
      mainChat.style.display = 'flex';

      const setupPayload = isSales
        ? { candidate, role: account || 'Sales call', jd: goal, salesMode: true, account, goal }
        : { candidate, role, jd: $('#setup-jd') ? $('#setup-jd').value : '', salesMode: false };
      if (window.cue && window.cue.emit) {
        window.cue.emit('session:setup', setupPayload);
      }
      if (window.cue && cue.setCandidate) cue.setCandidate(candidate);
    });
  }

  const moreMenuBtn = $('#more-menu-btn');
  if (moreMenuBtn) {
    moreMenuBtn.innerHTML = icon('more-horizontal', { size: 18 });
    moreMenuBtn.onclick = (e) => {
      e.stopPropagation();
      $('#more-menu-dropdown').classList.toggle('hidden');
    };
  }

  // Close dropdown if clicked outside
  document.addEventListener('mousedown', (e) => {
    const dropdown = $('#more-menu-dropdown');
    if (dropdown && !dropdown.classList.contains('hidden')) {
      if (!e.target.closest('.more-menu-container')) {
        dropdown.classList.add('hidden');
      }
    }
  });

  const btnSettingsDropdown = $('#btn-settings-dropdown');
  if (btnSettingsDropdown) {
    btnSettingsDropdown.querySelector('.ic').innerHTML = icon('settings', { size: 16 });
    // Use mousedown instead of onclick so it fires before the document mousedown hides it
    btnSettingsDropdown.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      $('#more-menu-dropdown').classList.add('hidden');
      $('#chat-settings-modal').classList.remove('hidden');
    });
  }

  const btnChatSettingsBack = $('#btn-chat-settings-back');
  if (btnChatSettingsBack) {
    btnChatSettingsBack.querySelector('.ic').innerHTML = icon('chevron-left', { size: 14 });
    btnChatSettingsBack.addEventListener('click', () => {
      $('#chat-settings-modal').classList.add('hidden');
    });
  }

  function setupCustomSelect(containerId, storageKey) {
    const container = $(`#${containerId}`);
    if (!container) return;

    const trigger = container.querySelector('.custom-select-trigger');
    const valueEl = container.querySelector('.custom-select-value');
    const optionsPanel = container.querySelector('.custom-select-options');
    const options = container.querySelectorAll('.custom-select-option');

    const savedVal = localStorage.getItem(storageKey) || 'multi';
    const initOpt = Array.from(options).find(o => o.dataset.value === savedVal);
    if (initOpt) valueEl.textContent = initOpt.textContent;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      optionsPanel.classList.toggle('hidden');
    });

    options.forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = opt.dataset.value;
        const text = opt.textContent;
        valueEl.textContent = text;
        localStorage.setItem(storageKey, val);
        optionsPanel.classList.add('hidden');

        const otherId = containerId === 'island-stt-language-container' ? 'chat-stt-language-container' : 'island-stt-language-container';
        const otherContainer = $(`#${otherId}`);
        if (otherContainer) {
          const otherOpt = Array.from(otherContainer.querySelectorAll('.custom-select-option')).find(o => o.dataset.value === val);
          if (otherOpt) {
            otherContainer.querySelector('.custom-select-value').textContent = otherOpt.textContent;
          }
        }
      });
    });

    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) {
        optionsPanel.classList.add('hidden');
      }
    });
  }

  setupCustomSelect('chat-stt-language-container', 'sttLanguage');

  // Removed btnShortcutsDropdown logic

  // Dynamic Island Buttons
  const btnVision = $('#btn-vision');
  const btnSettings = $('#btn-settings');
  const btnEnd = $('#btn-end');

  // Inline Settings
  const btnSettingsBack = $('#btn-settings-back');
  const islandMainView = $('#island-main-view');
  const islandSettingsView = $('#island-settings-view');
  const islandShortcutNote = $('#island-shortcut-note');

  if (btnSettingsBack) btnSettingsBack.innerHTML = icon('chevron-left', { size: 16 });

  if (btnVision) btnVision.innerHTML = icon('selection-pointer', { size: 20 });
  if (btnSettings) btnSettings.innerHTML = icon('sliders-2', { size: 20 });
  if (btnEnd) btnEnd.innerHTML = icon('play', { size: 20 });

  // Event Listeners for Dynamic Island
  if (btnVision) btnVision.addEventListener('click', () => {
    if (busy) return;
    setBusy(true);
    cue.captureStart();
  });
  if (btnSettings) btnSettings.addEventListener('click', () => {
    if (islandMainView) islandMainView.classList.add('hidden');
    if (islandShortcutNote) islandShortcutNote.classList.add('hidden');
    if (islandSettingsView) islandSettingsView.classList.remove('hidden');
  });
  if (btnSettingsBack) btnSettingsBack.addEventListener('click', () => {
    if (islandSettingsView) islandSettingsView.classList.add('hidden');
    if (islandMainView) islandMainView.classList.remove('hidden');
    if (islandShortcutNote) islandShortcutNote.classList.remove('hidden');
  });

  if (btnEnd) {
    btnEnd.addEventListener('click', () => {
      if (window.cue && window.cue.botToggle) {
        const isActive = window.cue.botToggle();
        if (isActive) {
          btnEnd.classList.add('danger');
          btnEnd.innerHTML = icon('stop-square', { size: 20 });
          btnEnd.title = "End Session";
        } else {
          btnEnd.classList.remove('danger');
          btnEnd.innerHTML = icon('play', { size: 20 });
          btnEnd.title = "Start Session";
        }
      }
    });

    cue.on('bot:status', (data) => {
      if (data && data.status === 'stopped' || data.status === 'error' || data.status === 'failed') {
        btnEnd.classList.remove('danger');
        btnEnd.innerHTML = icon('play', { size: 20 });
        btnEnd.title = "Start Session";
      } else if (data && data.status === 'active') {
        btnEnd.classList.add('danger');
        btnEnd.innerHTML = icon('stop-square', { size: 20 });
        btnEnd.title = "End Session";
      }
    });
  }

  function switchOverlayTab(tabId) {
    $$('.overlay-tab').forEach((btn) => {
      const on = btn.dataset.tab === tabId;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.overlay-tab-pane').forEach((pane) => {
      const on = pane.dataset.pane === tabId;
      pane.classList.toggle('active', on);
      pane.classList.toggle('hidden', !on);
    });
    if (tabId === 'insights') applyInsightsMode(!!window.__salesModeUi);
  }

  $$('.overlay-tab').forEach((btn) => {
    btn.addEventListener('click', () => switchOverlayTab(btn.dataset.tab));
  });

  // ---- events from main -------------------------------------------------------------
  let settings = null;
  let busy = false;
  let aiEl = null;       // current streaming <div class="ai-text">
  let caretEl = null;
  let activeRequestId = null;
  let activeStreamKind = null;

  const messages = $('#messages');
  const messagesView = messages;
  let stickTranscriptToBottom = true;

  function isNearBottom(el, threshold = 96) {
    if (!el) return true;
    return (el.scrollHeight - el.scrollTop - el.clientHeight) <= threshold;
  }

  function scrollMessagesToBottom(force = false) {
    if (!messages) return;
    if (!force && !stickTranscriptToBottom) return;
    messages.scrollTop = messages.scrollHeight;
  }

  if (messages) {
    messages.addEventListener('scroll', () => {
      stickTranscriptToBottom = isNearBottom(messages);
    }, { passive: true });
  }
  const transcriptBubbles = new Map();

  function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function sanitizeAiDisplayText(text) {
    let s = String(text || '');
    s = s.replace(/\{[^{}]{0,400}?"(?:COMPLETED_JOB|UTTER_[A-Z0-9_]+|job_id|task_id)"[^{}]{0,400}\}/gi, '');
    s = s.replace(/\bCOMPLETED_JOB\b[^\n]{0,120}/gi, '');
    s = s.replace(/\bUTTER_[A-Z0-9_]+\b/gi, '');
    s = s.replace(/\n{3,}/g, '\n\n').trim();
    return s;
  }

  const ICON_WORD_RE = /^(format_size|mic|mic_off|videocam|videocam_off|present_to_all|more_vert|more_horiz|call_end|closed_caption|captions|settings|people|chat|back_hand|pan_tool|volume_up|volume_off|screen_share|stop_screen_share|fullscreen|fullscreen_exit|add|close|check|arrow_drop_down|keyboard_arrow_down|info|help|search|send|edit|delete|content_copy|done|warning|error|push_pin|keep|keep_off|mood|emoji_emotions|devices|cast|hd|speed|tune|visibility|visibility_off)[.!?…,;:\s]*$/i;

  function isJunkTranscriptText(text) {
    const s = String(text || '').trim();
    if (!s) return true;
    if (ICON_WORD_RE.test(s)) return true;
    if (/^\s*\{[\s\S]*"COMPLETED_JOB"/i.test(s)) return true;
    if (/^\s*\{[\s\S]*"UTTER_/i.test(s)) return true;
    if (/^\s*\{\s*"[^"]+"\s*:/.test(s) && s.includes('}') && s.length < 400) return true;
    return false;
  }

  function sealLiveTranscriptTurns() {
    if (!messages) return;
    messages.querySelectorAll('.transcript-text-plain').forEach((el) => {
      if (el.dataset.complete === '1') return;
      el.dataset.complete = '1';
      el.dataset.sealed = '1';
      el.classList.remove('active');
      el.classList.add('complete');
    });
  }

  // minimal, safe markdown: fenced code, bullets, numbered lists, inline code, bold, paragraphs
  function renderMarkdown(text) {
    text = sanitizeAiDisplayText(text);
    text = text.replace(/(?:\s|^)([•\-*]\s+)/g, '\n$1');
    text = text.replace(/(?:\s|^)(\d+\.\s+)/g, '\n$1');

    const lines = text.split('\n');
    let html = '', inCode = false, inList = false, listType = '', buf = [];

    const flushP = () => { if (buf.length) { html += '<p>' + inline(buf.join(' ')) + '</p>'; buf = []; } };
    const inline = (s) => esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    for (const raw of lines) {
      const line = raw;
      if (/^```/.test(line.trim())) {
        if (!inCode) { flushP(); if (inList) { html += `</${listType}>`; inList = false; } html += '<pre><code>'; inCode = true; }
        else { html += '</code></pre>'; inCode = false; }
        continue;
      }
      if (inCode) { html += esc(line) + '\n'; continue; }

      const isBullet = /^\s*[-*â€¢]\s+/.test(line);
      const isNumbered = /^\s*\d+\.\s+/.test(line);

      if (isBullet || isNumbered) {
        flushP();
        if (!inList) {
          listType = isBullet ? 'ul' : 'ol';
          html += `<${listType}>`;
          inList = true;
        }
        html += '<li>' + inline(line.replace(/^\s*[-*â€¢]\s+/, '').replace(/^\s*\d+\.\s+/, '')) + '</li>';
        continue;
      }

      if (line.trim() === '') { flushP(); if (inList) { html += `</${listType}>`; inList = false; } continue; }
      buf.push(line.trim());
    }
    flushP(); if (inList) html += `</${listType}>`; if (inCode) html += '</code></pre>';
    return html;
  }



  function clearMessages() {
    messages.innerHTML = '';
    aiEl = null;
    caretEl = null;
    activeRequestId = null;
    activeStreamKind = null;
  }

  function addUserBubble(text) {
    const wrap = document.createElement('div');
    wrap.className = 'manual-turn';
    wrap.dataset.awaitingAi = '1';
    const b = document.createElement('div');
    b.className = 'user-bubble';
    b.textContent = text;
    wrap.appendChild(b);
    messages.appendChild(wrap);
    return wrap;
  }

  function placeManualAi(el) {
    const pending = messages.querySelector('.manual-turn[data-awaiting-ai="1"]');
    const wrap = pending || [...messages.querySelectorAll('.manual-turn')].pop();
    if (!wrap) return false;
    wrap.removeAttribute('data-awaiting-ai');
    wrap.appendChild(el);
    return true;
  }

  function isTranscriptHidden() {
    return messages && messages.classList.contains('transcript-hidden');
  }

  function isAiFinal(el) {
    return !!(el && el.dataset.final === '1');
  }

  function clearIncompleteAutopilot(exceptEl = null) {
    if (!messages) return;
    messages.querySelectorAll('.ai-text[data-kind="autopilot"]').forEach((el) => {
      if (el === exceptEl || isAiFinal(el) || el.closest('.manual-turn')) return;
      el.remove();
    });
  }

  function purgeSpotlightAi(exceptEl = null) {
    if (!messages) return;
    messages.querySelectorAll('.ai-text').forEach((el) => {
      if (el === exceptEl || el.closest('.manual-turn') || isAiFinal(el)) return;
      el.remove();
    });
  }

  function syncAiSpotlight() {
    if (!messages) return;

    if (!isTranscriptHidden()) {
      messages.classList.remove('spotlight-mode');
      messages.querySelectorAll('.ai-text').forEach((el) => {
        el.classList.remove('ai-spotlight-current', 'ai-spotlight-exit', 'ai-spotlight-archived');
      });
      return;
    }

    messages.classList.add('spotlight-mode');
    const candidates = [...messages.querySelectorAll('.ai-text')].filter((el) => !el.closest('.manual-turn'));
    const latest = aiEl
      || messages.querySelector('.ai-text.ai-spotlight-current')
      || candidates[candidates.length - 1]
      || null;
    if (!latest) return;

    messages.querySelectorAll('.ai-text').forEach((el) => {
      if (el === latest) {
        el.classList.add('ai-spotlight-current');
        el.classList.remove('ai-spotlight-exit', 'ai-spotlight-archived');
      } else if (!el.closest('.manual-turn') && !isAiFinal(el)) {
        el.remove();
      } else if (el !== latest && !el.closest('.manual-turn')) {
        el.classList.remove('ai-spotlight-current');
        el.classList.add('ai-spotlight-archived');
      }
    });
  }

  function retireActiveStreamShell() {
    if (!aiEl || !aiEl.parentNode) {
      aiEl = null;
      caretEl = null;
      return;
    }
    const empty = !(aiEl.dataset.raw || '').trim() && !aiEl.querySelector('.w');
    if (empty && !isAiFinal(aiEl)) aiEl.remove();
    aiEl = null;
    caretEl = null;
  }

  function startAi(small, turnId, opts = {}) {
    const manual = !!opts.manual;
    const kind = manual ? 'manual' : 'autopilot';
    const requestId = opts.requestId || `${kind}-${Date.now()}`;

    if (turnId != null && !manual) {
      const existing = messages.querySelector(`.ai-text[data-for-turn="${turnId}"]:not([data-final="1"])`);
      if (existing) existing.remove();
    }

    retireActiveStreamShell();
    if (!manual) clearIncompleteAutopilot();

    aiEl = document.createElement('div');
    aiEl.className = 'ai-text' + (small ? ' small' : '');
    aiEl.dataset.raw = '';
    aiEl.dataset.kind = kind;
    aiEl.dataset.requestId = requestId;
    if (turnId != null) aiEl.dataset.forTurn = String(turnId);
    const thinkEl = document.createElement('div');
    thinkEl.className = 'thinking-indicator';
    thinkEl.innerHTML = '<div class="pixel-spinner"><div class="px-1"></div><div class="px-2"></div><div class="px-3"></div><div class="px-4"></div></div><span class="think-text">Thinking</span>';
    aiEl.appendChild(thinkEl);
    caretEl = null;
    activeRequestId = requestId;
    activeStreamKind = kind;

    if (isTranscriptHidden()) {
      if (!manual) purgeSpotlightAi(aiEl);
      messages.classList.add('spotlight-mode');
      aiEl.classList.add('ai-spotlight-current');
      if (manual && placeManualAi(aiEl)) {
        // placed inside .manual-turn
      } else {
        messages.appendChild(aiEl);
      }
    } else if (manual || (turnId == null && messages.querySelector('.manual-turn[data-awaiting-ai="1"]'))) {
      if (!placeManualAi(aiEl)) messages.appendChild(aiEl);
    } else {
      messages.appendChild(aiEl);
    }
    if (!isTranscriptHidden()) scrollMessagesToBottom();
  }

  function appendToken(t, requestId = null) {
    if (!t) return;
    if (requestId && activeRequestId && requestId !== activeRequestId) return;
    if (!aiEl) startAi(false, null, { requestId: requestId || activeRequestId });
    if (requestId && aiEl.dataset.requestId && requestId !== aiEl.dataset.requestId) return;
    const thinkEl = aiEl.querySelector('.thinking-indicator');
    if (thinkEl) thinkEl.remove();
    let chunk = sanitizeAiDisplayText(String(t));
    if (!chunk) return;
    const raw = aiEl.dataset.raw || '';
    if (chunk && raw && (raw.endsWith(chunk) || chunk === raw || (chunk.length > 40 && raw.includes(chunk)))) {
      return;
    }
    if (chunk.length > 40 && raw.length > 40 && chunk.startsWith(raw) && chunk.length > raw.length) {
      const rest = chunk.slice(raw.length);
      aiEl.dataset.raw = chunk;
      const span = document.createElement('span');
      span.className = 'w';
      span.textContent = rest;
      aiEl.appendChild(span);
    } else {
      aiEl.dataset.raw += chunk;
      const span = document.createElement('span');
      span.className = 'w';
      span.textContent = chunk;
      aiEl.appendChild(span);
    }
    if (!isTranscriptHidden()) scrollMessagesToBottom();
  }

  function finalizeAi(requestId = null) {
    if (requestId && activeRequestId && requestId !== activeRequestId) return;
    if (!aiEl) return;
    if (requestId && aiEl.dataset.requestId && requestId !== aiEl.dataset.requestId) return;
    const thinkEl = aiEl.querySelector('.thinking-indicator');
    if (thinkEl) thinkEl.remove();
    const raw = sanitizeAiDisplayText(aiEl.dataset.raw || '');
    aiEl.dataset.raw = raw;
    if (!raw.trim()) {
      aiEl.remove();
      aiEl = null; caretEl = null;
      activeRequestId = null;
      activeStreamKind = null;
      syncAiSpotlight();
      return;
    }
    aiEl.innerHTML = renderMarkdown(raw);
    aiEl.dataset.final = '1';
    aiEl = null; caretEl = null;
    activeRequestId = null;
    activeStreamKind = null;
    syncAiSpotlight();
    if (!isTranscriptHidden()) scrollMessagesToBottom();
  }

  function clearOrphanThinking() {
    if (!messages) return;
    messages.querySelectorAll('.thinking-indicator').forEach((el) => el.remove());
    messages.querySelectorAll('.ai-text').forEach((el) => {
      if (!(el.dataset.raw || '').trim() && !el.querySelector('.w') && !el.innerText.trim()) {
        el.remove();
      }
    });
    messages.querySelectorAll('.manual-turn[data-awaiting-ai="1"]').forEach((el) => {
      if (!el.querySelector('.ai-text')) el.removeAttribute('data-awaiting-ai');
    });
  }

  function finishAssistStatus(state, label) {
    if (!messages) return;
    messages.querySelectorAll('.assist-status:not(.is-done):not(.is-error)').forEach((el) => {
      el.classList.remove('is-done', 'is-error');
      if (state === 'error') el.classList.add('is-error');
      else el.classList.add('is-done');
      const labelEl = el.querySelector('.assist-status-label');
      if (labelEl) labelEl.textContent = label;
      else el.appendChild(Object.assign(document.createElement('span'), {
        className: 'assist-status-label',
        textContent: label
      }));
    });
  }

  function openImageModal(src) {
    if (!src) return;
    const root = shadow || document;
    const existing = root.querySelector('.image-modal-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.className = 'image-modal-overlay';
    const img = document.createElement('img');
    img.className = 'image-modal-content';
    img.src = src;
    img.alt = 'Captured screen';
    overlay.appendChild(img);
    overlay.addEventListener('click', () => overlay.remove());
    root.appendChild(overlay);
  }

  function setBusy(v) { busy = v; $('#send-btn').classList.toggle('busy', v); }

  let activeActionBtn = null;

  // ---- actions -----------------------------------------------------------
  function runMode(mode, text, btnElement = null) {
    if (busy) return;
    sealLiveTranscriptTurns();
    if (mode === 'search') {
      setBusy(true);
      cue.captureStart();
      return;
    }
    // No longer clearing messages, treat as continuous chat
    if (text) {
      addUserBubble(text);
    } else if (btnElement) {
      const btnLabel = btnElement.innerText.trim();
      if (btnLabel) {
        addUserBubble(`${btnLabel}`);
      }
    }
    setBusy(true);

    // UI state for button
    if (btnElement) {
      btnElement.classList.add('active');
      activeActionBtn = btnElement;
    }

    cue.ask({ mode, text: text || '', todos: [] });

    // Safety fallback: If no response in 10s, reset UI to prevent permanent hang
    setTimeout(() => {
      if (busy && (!aiEl || (aiEl && !aiEl.dataset.raw && !aiEl.querySelector('.w')))) {
        setBusy(false);
        if (activeActionBtn) {
          activeActionBtn.classList.remove('active');
          activeActionBtn = null;
        }
        if (!aiEl) {
          addUserBubble('Backend did not respond in time.');
        }
      }
    }, 10000);
  }

  $$('.act').forEach((btn) => {
    if (btn.id === 'btn-candidates' || btn.id === 'action-items-btn') return;
    btn.addEventListener('click', () => runMode(btn.dataset.mode, '', btn));
  });

  const input = $('#input');
  const placeholder = $('#placeholder');
  const composer = $('#composer');
  const cmdMenu = $('#command-menu');
  let cmdSelectedIdx = 0;

  function syncPlaceholder() {
    placeholder.classList.toggle('hidden', input.value.length > 0 || document.activeElement === input);
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';

    // Command menu logic
    if (cmdMenu && input.value.startsWith('/')) {
      const val = input.value.toLowerCase();
      let hasVisible = false;
      const items = Array.from(cmdMenu.querySelectorAll('.cmd-item'));

      items.forEach((item) => {
        const cmd = item.dataset.cmd.toLowerCase();
        // Show if input is a partial match of the command, but hide if they've already typed past it
        let matches = cmd.startsWith(val) && val.length < cmd.length;

        // Clutter fix: hide dynamic participants from the root menu unless they've typed /candidate
        if (item.classList.contains('dynamic-participant') && !val.startsWith('/candidate ')) {
          matches = false;
        }

        if (matches) {
          item.style.display = 'flex';
          hasVisible = true;
        } else {
          item.style.display = 'none';
        }
      });

      if (hasVisible) {
        cmdMenu.classList.remove('hidden');
        cmdSelectedIdx = 0; // reset to first visible
        updateCmdSelection();
      } else {
        cmdMenu.classList.add('hidden');
      }
    } else if (cmdMenu) {
      cmdMenu.classList.add('hidden');
    }
  }

  function updateCmdSelection() {
    const visibleItems = Array.from(cmdMenu.querySelectorAll('.cmd-item')).filter(i => i.style.display !== 'none');
    visibleItems.forEach((item, i) => {
      item.classList.toggle('selected', i === cmdSelectedIdx);
    });
  }

  function bindCmdItem(item) {
    item.addEventListener('mouseenter', () => {
      if (!cmdMenu) return;
      const visibleItems = Array.from(cmdMenu.querySelectorAll('.cmd-item')).filter(i => i.style.display !== 'none');
      const idx = visibleItems.indexOf(item);
      if (idx !== -1) {
        cmdSelectedIdx = idx;
        updateCmdSelection();
      }
    });
    item.addEventListener('click', () => {
      input.value = item.dataset.cmd;
      if (!item.dataset.cmd.endsWith(' ')) {
        send(); // Execute immediately
      } else {
        input.focus();
        syncPlaceholder();
      }
    });
  }

  if (cmdMenu) {
    cmdMenu.querySelectorAll('.cmd-item').forEach(bindCmdItem);
  }

  cue.on('participants:update', (list) => {
    const candidatesDropdown = $('#setup-candidates-dropdown');
    const mainCandidatesDropdown = $('#candidates-dropdown');

    if (list && list.error) {
      const hasRealItems = (el) => el && el.querySelector('.dropdown-item span:not(:empty)');
      if (!hasRealItems(candidatesDropdown) && !hasRealItems(mainCandidatesDropdown)) {
        if (candidatesDropdown) {
          candidatesDropdown.innerHTML = `<div class="dropdown-item" style="opacity: 0.5; text-align: center; padding: 12px;">${list.error}</div>`;
        }
        if (mainCandidatesDropdown) {
          mainCandidatesDropdown.innerHTML = `<div class="dropdown-item" style="opacity: 0.5; text-align: center; padding: 12px;">${list.error}</div>`;
        }
      }
      return;
    }

    if (!Array.isArray(list)) return;

    // Clean names and exclude bot ('xobin')
    list = list
      .map(name => (typeof name === 'string' ? name.trim() : ''))
      .filter(name => name && !name.toLowerCase().includes('xobin'));

    // If cmdMenu exists, update slash command suggestions
    if (cmdMenu) {
      cmdMenu.querySelectorAll('.cmd-item.dynamic-participant').forEach(el => el.remove());
      list.forEach(name => {
        const item = document.createElement('div');
        item.className = 'cmd-item dynamic-participant';
        item.dataset.cmd = '/candidate ' + name;
        item.innerHTML = `
          <div class="cmd-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="7" r="4"/><path d="M5.5 21a8.38 8.38 0 0 1 13 0"/></svg></div>
          <div class="cmd-text">
            <span class="cmd-name">/candidate ${name}</span>
            <span class="cmd-desc">Set the candidate to ${name}</span>
          </div>
        `;
        bindCmdItem(item);
        cmdMenu.appendChild(item);
      });
      syncPlaceholder();
    }

    // Helper to render dropdown items with checkmark
    const renderItemContent = (itemName) => {
      let content = `<span>${itemName}</span>`;
      if (itemName === window.selectedCandidateName) {
        content += `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.9;"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      }
      return content;
    };

    const populateDropdown = (dropdownEl, isSetupView) => {
      if (!dropdownEl) return;
      dropdownEl.innerHTML = '';
      if (list.length === 0) {
        dropdownEl.innerHTML = '<div class="dropdown-item" style="opacity: 0.5; text-align: center; padding: 12px;">No participants found</div>';
        return;
      }

      list.forEach(name => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        item.innerHTML = renderItemContent(name);

        item.onmousedown = (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.selectedCandidateName = name;

          if (isSetupView) {
            const displaySpan = $('#setup-candidate-display');
            if (displaySpan) {
              displaySpan.textContent = name;
              displaySpan.style.opacity = '1';
            }
          }

          dropdownEl.classList.add('hidden');

          // Refresh all dropdowns
          [candidatesDropdown, mainCandidatesDropdown].forEach(dd => {
            if (dd) {
              Array.from(dd.children).forEach(child => {
                const childSpan = child.querySelector('span');
                if (childSpan) {
                  child.innerHTML = renderItemContent(childSpan.textContent);
                }
              });
            }
          });

          if (window.cue && cue.setCandidate) cue.setCandidate(name);

          const toast = $('#toast');
          if (toast) {
            toast.textContent = 'Candidate set successfully';
            toast.classList.remove('hidden');
            if (window.toastTimeout) clearTimeout(window.toastTimeout);
            window.toastTimeout = setTimeout(() => {
              toast.classList.add('hidden');
            }, 2000);
          }
        };

        dropdownEl.appendChild(item);
      });
    };

    // Update both Setup modal dropdown and Main chat dropdown
    populateDropdown(candidatesDropdown, true);
    populateDropdown(mainCandidatesDropdown, false);
  });

  input.addEventListener('input', syncPlaceholder);

  // Prevent Google Meet from intercepting keys (like '/' to search)
  const stopKeys = (e) => e.stopPropagation();
  input.addEventListener('keydown', stopKeys);
  input.addEventListener('keyup', stopKeys);
  input.addEventListener('keypress', stopKeys);

  input.addEventListener('focus', () => { composer.classList.add('focused'); placeholder.classList.add('hidden'); });
  input.addEventListener('blur', () => {
    composer.classList.remove('focused');
    syncPlaceholder();
    // Delay hiding so clicks register
    setTimeout(() => { if (cmdMenu) cmdMenu.classList.add('hidden'); }, 150);
  });
  $('#input-area').addEventListener('click', () => input.focus());

  // ---- Action Items State ----
  // States: 'done' | 'in-progress' | 'pending'
  const actionItems = [];
  let actionItemIdCounter = 0;

  const actionItemsBtn = $('#action-items-btn');
  const actionItemsBadge = $('#action-items-badge');
  let actionPopoverEl = null;

  if (actionItemsBtn) {
    actionItemsBtn.querySelector('.ic').innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="15" y2="12"/><line x1="4" y1="18" x2="10" y2="18"/></svg>';
    actionItemsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleActionPopover();
    });
  }

  function addActionItem(text, fromServer = false) {
    if (actionItems.some(i => i.text.toLowerCase() === text.toLowerCase())) return;
    const item = { id: ++actionItemIdCounter, text, status: 'pending' };
    actionItems.push(item);
    updateActionBadge();
    if (actionPopoverEl) { renderActionPopoverList(); refreshPopoverHeader(); }
    if (!fromServer) syncActionItemsToDB();
  }

  function markActionDone(id) {
    const item = actionItems.find(i => i.id === id);
    if (item && item.status !== 'done') {
      item.status = 'done';
      updateActionBadge();
      if (actionPopoverEl) { renderActionPopoverList(); refreshPopoverHeader(); }
      syncActionItemsToDB();
    }
  }

  function syncActionItemsToDB() {
    cue.send('action-items:sync', { items: actionItems.map(i => ({ text: i.text, status: i.status })) });
  }

  function updateActionBadge() {
    if (!actionItemsBadge) return;
    const pending = actionItems.filter(i => i.status !== 'done').length;
    if (pending > 0) {
      actionItemsBadge.textContent = pending;
      actionItemsBadge.classList.remove('hidden');
    } else if (actionItems.length > 0) {
      actionItemsBadge.textContent = '✓';
      actionItemsBadge.classList.remove('hidden');
    } else {
      actionItemsBadge.classList.add('hidden');
    }
  }

  function toggleActionPopover() {
    if (actionPopoverEl) { closeActionPopover(); return; }

    actionPopoverEl = document.createElement('div');
    actionPopoverEl.className = 'action-popover';
    actionPopoverEl.addEventListener('mousedown', e => e.stopPropagation());

    const header = document.createElement('div');
    header.className = 'action-popover-header';
    actionPopoverEl.appendChild(header);

    const progress = document.createElement('div');
    progress.className = 'action-popover-progress';
    progress.innerHTML = '<div class="action-popover-progress-bar"></div>';
    actionPopoverEl.appendChild(progress);

    const list = document.createElement('ul');
    list.className = 'action-items-list';
    list.id = 'action-popover-list';
    actionPopoverEl.appendChild(list);

    const inputRow = document.createElement('div');
    inputRow.className = 'action-input-row';
    const actionInput = document.createElement('input');
    actionInput.type = 'text';
    actionInput.className = 'action-input';
    actionInput.placeholder = 'Add action item...';
    actionInput.spellcheck = false;
    ['keydown', 'keyup', 'keypress', 'mousedown'].forEach(evt => actionInput.addEventListener(evt, e => e.stopPropagation()));
    const submitInput = () => {
      const val = actionInput.value.trim();
      if (val) { addActionItem(val); actionInput.value = ''; }
    };
    actionInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitInput(); } });
    const addBtnEl = document.createElement('button');
    addBtnEl.className = 'action-input-add';
    addBtnEl.innerHTML = icon('plus', { size: 14 });
    addBtnEl.addEventListener('mousedown', e => e.stopPropagation());
    addBtnEl.addEventListener('click', submitInput);
    inputRow.appendChild(actionInput);
    inputRow.appendChild(addBtnEl);
    actionPopoverEl.appendChild(inputRow);

    refreshPopoverHeader();
    renderActionPopoverList();

    const panel = $('#panel');
    panel.appendChild(actionPopoverEl);
    actionItemsBtn.classList.add('active');

    const dismiss = (e) => {
      if (!actionPopoverEl) { document.removeEventListener('mousedown', dismiss); return; }
      if (e.target === actionItemsBtn || actionItemsBtn.contains(e.target)) return;
      closeActionPopover();
      document.removeEventListener('mousedown', dismiss);
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 50);
  }

  function closeActionPopover() {
    if (actionPopoverEl) { actionPopoverEl.remove(); actionPopoverEl = null; }
    if (actionItemsBtn) actionItemsBtn.classList.remove('active');
  }

  function refreshPopoverHeader() {
    if (!actionPopoverEl) return;
    const total = actionItems.length;
    const done = actionItems.filter(i => i.status === 'done').length;
    const hdr = actionPopoverEl.querySelector('.action-popover-header');
    const bar = actionPopoverEl.querySelector('.action-popover-progress-bar');
    if (hdr) hdr.innerHTML = `<span class="action-popover-title">Action List</span><span class="action-popover-count">${total > 0 ? done + ' of ' + total : ''}</span>`;
    if (bar) bar.style.width = `${total > 0 ? (done / total) * 100 : 0}%`;
  }

  function renderActionPopoverList() {
    if (!actionPopoverEl) return;
    const list = actionPopoverEl.querySelector('#action-popover-list');
    if (!list) return;
    list.innerHTML = '';

    if (actionItems.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'action-item-empty';
      empty.textContent = 'No action items yet';
      list.appendChild(empty);
      return;
    }

    actionItems.forEach(item => {
      const li = document.createElement('li');
      li.className = 'action-item ' + item.status;

      let iconHtml;
      if (item.status === 'done') {
        iconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg>';
      } else {
        iconHtml = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="6"/></svg>';
      }

      const iconDiv = document.createElement('div');
      iconDiv.className = 'action-item-icon';
      iconDiv.innerHTML = iconHtml;

      const textSpan = document.createElement('span');
      textSpan.className = 'action-item-text';
      textSpan.textContent = item.text;

      li.appendChild(iconDiv);
      li.appendChild(textSpan);

      iconDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        item.status = item.status === 'done' ? 'pending' : 'done';
        updateActionBadge();
        renderActionPopoverList();
        refreshPopoverHeader();
        syncActionItemsToDB();
      });

      textSpan.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const editInput = document.createElement('input');
        editInput.type = 'text';
        editInput.className = 'action-edit-input';
        editInput.value = item.text;
        ['keydown', 'keyup', 'keypress'].forEach(evt => editInput.addEventListener(evt, ev => ev.stopPropagation()));
        const commitEdit = () => {
          const val = editInput.value.trim();
          if (val) item.text = val;
          renderActionPopoverList();
        };
        editInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') commitEdit(); if (ev.key === 'Escape') renderActionPopoverList(); });
        editInput.addEventListener('blur', commitEdit);
        textSpan.replaceWith(editInput);
        editInput.focus();
        editInput.select();
      });

      list.appendChild(li);
    });
  }

  cue.on('llm:action-item', ({ text }) => {
    cue.log('[ActionItem] Received: ' + text);
    addActionItem(text);
  });

  cue.on('action-item:done', ({ id }) => {
    markActionDone(id);
  });

  // ---- Realtime Evaluation Gauge & Scorecard State ----
  let lastEvalData = null;
  let extraSkills = [];

  function normalizeSkill(name) {
    return String(name || '')
      .replace(/^[✓✔✅☑☒✔︎\u2713\u2714\u2705\u2611\s•\-–—*]+/u, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function mergedSkills(llmSkills) {
    const seen = new Set();
    const out = [];
    [...(Array.isArray(llmSkills) ? llmSkills : []), ...extraSkills].forEach((s) => {
      const n = normalizeSkill(s);
      if (!n) return;
      const key = n.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(n);
    });
    return out;
  }

  function setInsightList(ul, items, fallback) {
    if (!ul) return;
    ul.innerHTML = '';
    const list = Array.isArray(items) && items.length > 0 ? items : [fallback];
    list.forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      ul.appendChild(li);
    });
  }

  function renderInsightsSkills(llmSkills) {
    const wrap = $('#insights-skills');
    if (!wrap) return;
    wrap.innerHTML = '';
    mergedSkills(llmSkills).forEach((name) => {
      const pill = document.createElement('span');
      pill.className = 'insights-pill';
      pill.textContent = name;
      wrap.appendChild(pill);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'insights-pill insights-pill-add';
    addBtn.textContent = '+ Add';
    addBtn.addEventListener('click', () => startAddSkill(llmSkills));
    wrap.appendChild(addBtn);
  }

  function startAddSkill(llmSkills) {
    const wrap = $('#insights-skills');
    if (!wrap) return;
    const addBtn = wrap.querySelector('.insights-pill-add');
    if (!addBtn) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'insights-pill-input';
    input.placeholder = 'Skill…';
    const shell = document.createElement('span');
    shell.className = 'insights-pill';
    shell.appendChild(input);
    addBtn.replaceWith(shell);
    input.focus();

    let cancelled = false;
    const commit = () => {
      if (!cancelled) {
        const name = normalizeSkill(input.value);
        const skills = lastEvalData?.verifiedSkills || llmSkills;
        if (name) {
          const exists = mergedSkills(skills).some((s) => s.toLowerCase() === name.toLowerCase());
          if (!exists) extraSkills.push(name);
        }
      }
      renderInsightsSkills(lastEvalData?.verifiedSkills || llmSkills);
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        cancelled = true;
        input.blur();
      }
    });
  }

  function fitStrokeColor(score) {
    if (score >= 75) return '#34d399';
    if (score >= 50) return '#fbbf24';
    return '#fb7185';
  }

  function setFitArc(el, score) {
    if (!el) return;
    el.style.stroke = fitStrokeColor(score);
    el.style.strokeDashoffset = String(100 - score);
  }

  function updateEvaluationUI(data) {
    if (!data) return;
    const parsedScore = Number(data.score);
    if (!Number.isFinite(parsedScore)) return;
    const score = Math.max(0, Math.min(100, Math.round(parsedScore)));
    const confidence = Number.isFinite(Number(data.confidence))
      ? Math.max(0, Math.min(100, Math.round(Number(data.confidence))))
      : null;

    lastEvalData = data;
    const sales = !!(window.__salesModeUi || data.mode === 'sales');
    if (data.mode === 'sales') window.__salesModeUi = true;
    applyInsightsMode(sales);

    const match = data.matchLevel || (sales ? 'Deal Health' : 'Candidate Fit');
    const trendBase = data.trend === 'up' ? 'Trending up' : data.trend === 'down' ? 'Trending down' : (sales ? 'Live deal health' : 'Live fit');
    const trend = confidence != null ? `${trendBase} · ${confidence}% evidence` : trendBase;

    const iScore = $('#insights-score-num');
    const iLabel = $('#insights-score-label');
    const iTrend = $('#insights-trend');
    if (iScore) iScore.textContent = `${score}%`;
    if (iLabel) iLabel.textContent = match;
    if (iTrend) iTrend.textContent = trend;
    setFitArc($('#insights-fit-arc'), score);
    setFitArc($('#live-fit-arc'), score);
    const liveNum = $('#live-fit-num');
    if (liveNum) {
      liveNum.textContent = String(score);
      liveNum.hidden = false;
    }

    const popNum = $('#live-fit-pop-num');
    const popLabel = $('#live-fit-pop-label');
    const popTrend = $('#live-fit-pop-trend');
    const popStrength = $('#live-fit-pop-strength');
    const popGap = $('#live-fit-pop-gap');
    if (popNum) popNum.textContent = `${score}%`;
    if (popLabel) popLabel.textContent = match;
    if (popTrend) popTrend.textContent = trend;
    if (popStrength) popStrength.textContent = Array.isArray(data.strengths) && data.strengths[0] ? data.strengths[0] : '';
    if (popGap) popGap.textContent = Array.isArray(data.gaps) && data.gaps[0] ? data.gaps[0] : '';

    const suggestionEl = $('#insights-ai-suggestion');
    if (suggestionEl) {
      const suggestion = String(data.aiSuggestion || data.recommendedProbe || '').trim()
        || (sales
          ? 'Keep discovery moving — clarify budget, timeline, and the main buying trigger.'
          : 'Continue the conversation to gather enough evidence for a reliable fit score.');
      suggestionEl.textContent = suggestion;
    }

    renderInsightsSkills(data.verifiedSkills);
    setInsightList($('#insights-strengths'), data.strengths, sales ? 'No positive signals yet' : 'No strengths evidenced yet');
    setInsightList($('#insights-gaps'), data.gaps, sales ? 'No risks or next steps yet' : 'No risks or open items yet');
  }

  const liveFitBtn = $('#live-fit-btn');
  const liveFitPop = $('#live-fit-pop');
  if (liveFitBtn && liveFitPop) {
    liveFitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      liveFitPop.classList.toggle('hidden');
    });
    const openInsights = $('#live-fit-open-insights');
    if (openInsights) {
      openInsights.addEventListener('click', () => {
        liveFitPop.classList.add('hidden');
        switchOverlayTab('insights');
      });
    }
    document.addEventListener('click', (e) => {
      if (liveFitPop.classList.contains('hidden')) return;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (path.includes(liveFitBtn) || path.includes(liveFitPop)) return;
      liveFitPop.classList.add('hidden');
    });
  }

  renderInsightsSkills();

  cue.on('evaluation:update', (data) => {
    cue.log('[Evaluation] Received live update: ' + JSON.stringify(data));
    updateEvaluationUI(data);
  });

  const notesEditor = $('#session-notes-editor');
  const notesSaveStatus = $('#notes-save-status');
  let notesSaveTimer = null;
  let lastSavedNotes = '';
  let notesApplyingRemote = false;
  let notesSavedFadeTimer = null;
  let notesAckTimer = null;

  function setNotesSaveState(state) {
    if (!notesSaveStatus) return;
    notesSaveStatus.dataset.state = state;
    if (state === 'saving') notesSaveStatus.textContent = 'Saving';
    else if (state === 'saved') notesSaveStatus.textContent = 'Saved';
    else if (state === 'error') notesSaveStatus.textContent = 'Couldn’t save';
    else notesSaveStatus.textContent = '';
  }

  function queueNotesSave() {
    if (!notesEditor || notesApplyingRemote) return;
    setNotesSaveState('saving');
    clearTimeout(notesSaveTimer);
    notesSaveTimer = setTimeout(() => {
      notesSaveTimer = null;
      lastSavedNotes = notesEditor.value;
      if (cue && cue.send) cue.send('session:notes-sync', { text: lastSavedNotes });
      clearTimeout(notesAckTimer);
      notesAckTimer = setTimeout(() => {
        if (notesSaveStatus && notesSaveStatus.dataset.state === 'saving') setNotesSaveState('error');
      }, 5000);
    }, 400);
  }

  function notesLineRange(value, caret) {
    const start = value.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
    const nl = value.indexOf('\n', caret);
    const end = nl === -1 ? value.length : nl;
    return { start, end, line: value.slice(start, end) };
  }

  function replaceNotesLine(nextLine) {
    if (!notesEditor) return;
    const value = notesEditor.value;
    const caret = notesEditor.selectionStart;
    const { start, end } = notesLineRange(value, caret);
    notesEditor.value = value.slice(0, start) + nextLine + value.slice(end);
    const pos = start + nextLine.length;
    notesEditor.setSelectionRange(pos, pos);
    notesEditor.focus();
    queueNotesSave();
  }

  function stripNotesPrefix(line) {
    return line.replace(/^(☐ |☑ |• |# )/, '');
  }

  function applyNotesCommand(cmd) {
    if (!notesEditor) return;
    notesEditor.focus();
    const { line } = notesLineRange(notesEditor.value, notesEditor.selectionStart);
    if (cmd === 'checklist') {
      if (line.startsWith('☐ ')) replaceNotesLine('☑ ' + line.slice(2));
      else if (line.startsWith('☑ ')) replaceNotesLine(stripNotesPrefix(line));
      else replaceNotesLine('☐ ' + stripNotesPrefix(line));
      return;
    }
    if (cmd === 'bullet') {
      replaceNotesLine(line.startsWith('• ') ? stripNotesPrefix(line) : '• ' + stripNotesPrefix(line));
      return;
    }
    if (cmd === 'heading') {
      replaceNotesLine(line.startsWith('# ') ? stripNotesPrefix(line) : '# ' + stripNotesPrefix(line));
      return;
    }
    if (cmd === 'divider') {
      const value = notesEditor.value;
      const caret = notesEditor.selectionStart;
      const { end } = notesLineRange(value, caret);
      const insert = (end === 0 ? '' : '\n') + '---\n';
      notesEditor.value = value.slice(0, end) + insert + value.slice(end);
      const pos = end + insert.length;
      notesEditor.setSelectionRange(pos, pos);
      notesEditor.focus();
      queueNotesSave();
    }
  }

  $$('.notes-action').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => applyNotesCommand(btn.dataset.notesCmd));
  });

  if (notesEditor) {
    notesEditor.addEventListener('input', queueNotesSave);
    notesEditor.addEventListener('click', () => {
      const caret = notesEditor.selectionStart;
      const { start, line } = notesLineRange(notesEditor.value, caret);
      if (caret - start > 2) return;
      if (line.startsWith('☐ ') || line.startsWith('☑ ')) applyNotesCommand('checklist');
    });
    notesEditor.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      const { line } = notesLineRange(notesEditor.value, notesEditor.selectionStart);
      if (line.startsWith('☐ ') || line.startsWith('☑ ')) {
        e.preventDefault();
        const rest = line.slice(2);
        if (!rest.trim()) {
          replaceNotesLine('');
          return;
        }
        const value = notesEditor.value;
        const caret = notesEditor.selectionStart;
        const { end } = notesLineRange(value, caret);
        const insert = '\n☐ ';
        notesEditor.value = value.slice(0, end) + insert + value.slice(end);
        const pos = end + insert.length;
        notesEditor.setSelectionRange(pos, pos);
        queueNotesSave();
      }
    });
  }

  cue.on('session:notes', ({ text } = {}) => {
    if (!notesEditor) return;
    const incoming = typeof text === 'string' ? text : '';
    const pendingLocal = notesSaveTimer != null;
    const dirty = notesEditor.value !== lastSavedNotes;
    const focused = (shadow.activeElement || document.activeElement) === notesEditor;
    if ((pendingLocal || (dirty && focused)) && incoming !== notesEditor.value) return;
    notesApplyingRemote = true;
    notesEditor.value = incoming;
    lastSavedNotes = incoming;
    notesApplyingRemote = false;
    setNotesSaveState('idle');
  });

  cue.on('session:notes-saved', ({ ok } = {}) => {
    clearTimeout(notesAckTimer);
    clearTimeout(notesSavedFadeTimer);
    if (ok === false) {
      setNotesSaveState('error');
      return;
    }
    setNotesSaveState('saved');
    notesSavedFadeTimer = setTimeout(() => {
      if (notesSaveStatus && notesSaveStatus.dataset.state === 'saved') setNotesSaveState('idle');
    }, 1600);
  });

  if (cue && cue.send) cue.send('session:notes-request', {});

  cue.on('action-item:check-done', ({ turnText }) => {
    if (!turnText || actionItems.length === 0) return;
    const lower = turnText.toLowerCase();
    actionItems.forEach(item => {
      if (item.status === 'done') return;
      const keywords = item.text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const matchCount = keywords.filter(kw => lower.includes(kw)).length;
      if (keywords.length > 0 && matchCount >= Math.ceil(keywords.length * 0.5)) {
        cue.log('[ActionItem] Auto-completed: ' + item.text);
        markActionDone(item.id);
      }
    });
  });

  function handleCommand(text) {
    // /agent [instruction]
    const agentMatch = text.match(/^\/agent(?:\s+(.+))?$/i);
    if (agentMatch) {
      const instruction = agentMatch[1] ? agentMatch[1].trim() : "Generate a follow up question";
      runMode('takeover', instruction);
      return true;
    }
    // /candidate [name]
    const candidateMatch = text.match(/^\/candidate\s+(.+)$/i);
    if (candidateMatch) {
      const name = candidateMatch[1].trim();
      cue.log('[Candidate] Changed to: ' + name);
      if (window.cue && cue.setCandidate) cue.setCandidate(name);
      addUserBubble('Candidate set to: ' + name);
      return true;
    }

    // Exact match for /candidate with no args: expand for autocomplete
    if (/^\/candidate\s*$/i.test(text)) {
      input.value = '/candidate ';
      input.focus();
      if (window.cue && cue.requestParticipants) cue.requestParticipants();
      syncPlaceholder();
      return true;
    }

    return false;
  }

  function send() {
    const text = input.value.trim();
    if (!text) { runMode('assist', ''); return; }
    input.value = ''; syncPlaceholder();

    // Check for commands first
    if (handleCommand(text)) return;

    runMode('ask', text);
  }
  $('#send-btn').addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (cmdMenu && !cmdMenu.classList.contains('hidden')) {
      const visibleItems = Array.from(cmdMenu.querySelectorAll('.cmd-item')).filter(i => i.style.display !== 'none');
      if (visibleItems.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          cmdSelectedIdx = (cmdSelectedIdx + 1) % visibleItems.length;
          updateCmdSelection();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          cmdSelectedIdx = (cmdSelectedIdx - 1 + visibleItems.length) % visibleItems.length;
          updateCmdSelection();
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          visibleItems[cmdSelectedIdx].click();
          return;
        }
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) { e.preventDefault(); send(); }
    if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); runMode('assist', ''); }
  });

  // Smart toggle removed â€” production mode always on

  // Legacy buttons removed to prevent null pointer exceptions

  // ---- capture: mic (renderer side) --------------------------------------
  let audioCtx = null, micStream = null, micNode = null, micProc = null;
  async function startMic() {
    if (micStream) return;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      audioCtx = new AudioContext({ sampleRate: 16000 });
      micNode = audioCtx.createMediaStreamSource(micStream);
      micProc = audioCtx.createScriptProcessor(4096, 1, 1);
      const sink = audioCtx.createGain(); sink.gain.value = 0; // run processor silently
      micNode.connect(micProc); micProc.connect(sink); sink.connect(audioCtx.destination);
      micProc.onaudioprocess = (e) => {
        const f = e.inputBuffer.getChannelData(0);
        const out = new Int16Array(f.length);
        for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
        cue.micPcm(out.buffer);
      };
    } catch (err) {
      cue.log('mic error: ' + (err && err.message));
    }
  }
  function stopMic() {
    if (micProc) { micProc.disconnect(); micProc.onaudioprocess = null; micProc = null; }
    if (micNode) { micNode.disconnect(); micNode = null; }
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
  }

  // ---- capture: system/meeting audio (getDisplayMedia loopback, in cue's process) ----
  let sysStream = null, sysCtx = null, sysNode = null, sysProc = null;
  async function startSystemAudio() {
    if (sysStream) return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      stream.getVideoTracks().forEach((t) => t.stop()); // we only want the audio
      const tracks = stream.getAudioTracks();
      if (!tracks.length) { cue.log('system audio: no loopback track (macOS loopback unsupported here)'); stream.getTracks().forEach((t) => t.stop()); return; }
      sysStream = stream;
      sysCtx = new AudioContext({ sampleRate: 16000 });
      sysNode = sysCtx.createMediaStreamSource(new MediaStream(tracks));
      sysProc = sysCtx.createScriptProcessor(4096, 1, 1);
      const sink = sysCtx.createGain(); sink.gain.value = 0;
      sysNode.connect(sysProc); sysProc.connect(sink); sink.connect(sysCtx.destination);
      sysProc.onaudioprocess = (e) => {
        const f = e.inputBuffer.getChannelData(0);
        const out = new Int16Array(f.length);
        for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
        cue.systemPcm(out.buffer);
      };
      cue.log('system audio: capturing loopback');
    } catch (err) {
      cue.log('system audio error: ' + (err && err.message));
    }
  }
  function stopSystemAudio() {
    if (sysProc) { sysProc.disconnect(); sysProc.onaudioprocess = null; sysProc = null; }
    if (sysNode) { sysNode.disconnect(); sysNode = null; }
    if (sysCtx) { sysCtx.close(); sysCtx = null; }
    if (sysStream) { sysStream.getTracks().forEach((t) => t.stop()); sysStream = null; }
  }

  // ---- events from main --------------------------------------------------
  const siriCanvas = $('#siri-canvas');
  let siriOrb = null;
  if (window.SiriWave && siriCanvas) {
    siriOrb = new SiriWave(siriCanvas, { size: 44, renderScale: 2.0 });
  }

  let isCapturing = false;
  let isBotSpeaking = false;

  function updateSiriState() {
    if (!siriOrb) return;
    if (isBotSpeaking) {
      siriOrb.setState(2.0);
      siriOrb.setSpeed(0.08);
      siriOrb.setAmplitude(1.5);
    } else if (isCapturing) {
      siriOrb.setState(0.0);
      siriOrb.setSpeed(0.04);
      siriOrb.setAmplitude(0.6);
    } else {
      siriOrb.setState(0.0);
      siriOrb.setSpeed(0.01);
      siriOrb.setAmplitude(0.1);
    }
  }

  cue.on('bot:speaking', ({ active }) => {
    isBotSpeaking = active;
    updateSiriState();
  });

  cue.on('capture:state', ({ active }) => {
    isCapturing = active;
    $('#live-dot').classList.toggle('off', !active);
    updateSiriState();
  });

  cue.on('research:context', () => {});

  cue.on('llm:start', ({ userBubble, small, turnId, isAutopilot, requestId } = {}) => {
    const manual = !isAutopilot;
    const rid = requestId || `${manual ? 'manual' : 'auto'}-${Date.now()}`;

    // Never let autopilot interrupt an in-flight manual Assist / What should I say?
    if (!manual && activeStreamKind === 'manual' && aiEl && !isAiFinal(aiEl)) {
      return;
    }
    // Manual always wins over incomplete autopilot
    if (manual && activeStreamKind === 'autopilot' && aiEl && !isAiFinal(aiEl)) {
      retireActiveStreamShell();
    }

    if (userBubble && manual && !messages.querySelector('.manual-turn[data-awaiting-ai="1"]')) {
      addUserBubble(userBubble);
    }
    startAi(!!small, isAutopilot ? turnId : null, { manual, requestId: rid });
    setBusy(true);
  });
  cue.on('llm:token', ({ text, requestId } = {}) => appendToken(text, requestId || null));
  cue.on('llm:done', ({ requestId } = {}) => {
    finalizeAi(requestId || null);
    clearOrphanThinking();
    finishAssistStatus('done', 'Image analysed');
    setBusy(false);
    if (activeActionBtn) {
      activeActionBtn.classList.remove('active');
      activeActionBtn = null;
    }
  });
  cue.on('llm:error', ({ message, requestId } = {}) => {
    if (requestId && activeRequestId && requestId !== activeRequestId) return;
    if (!aiEl) startAi(true, null, { manual: true, requestId: requestId || activeRequestId });
    if (aiEl) aiEl.dataset.raw = message || 'Something went wrong.';
    finalizeAi(requestId || null);
    clearOrphanThinking();
    finishAssistStatus('error', 'Image analysis failed');
    setBusy(false);
    if (activeActionBtn) {
      activeActionBtn.classList.remove('active');
      activeActionBtn = null;
    }
  });

  // ---- Agent Takeover ----
  // Store active timer to clear it if a new takeover arrives
  let activeTakeoverTimer = null;

  cue.on('agent:request-takeover', ({ question, reason }) => {
    cue.log('[Agent] Takeover requested for: ' + question);

    // Cleanup any existing takeover cards to prevent overlap
    const existingCards = document.querySelectorAll('.permission-card');
    existingCards.forEach(c => c.remove());
    if (activeTakeoverTimer) clearInterval(activeTakeoverTimer);

    const card = document.createElement('div');
    card.className = 'permission-card';
    card.innerHTML = `
      <div class="permission-header">
        <div class="permission-icon">${icon('mic', { size: 14 })}</div>
        <span class="permission-title">Agent requests to speak</span>
      </div>
      <div class="permission-question">"${esc(question)}"</div>
      <div class="permission-actions">
        <button class="btn-allow">Allow</button>
        <button class="btn-deny">Deny</button>
      </div>
      <div class="permission-timeout"></div>
    `;

    const composer = $('#composer');
    composer.style.display = 'none';

    // Insert card into the panel, replacing the composer area
    const panel = $('#panel');
    panel.insertBefore(card, $('#resize-handle'));

    // Timeout logic (30s)
    let timeLeft = 30;
    const timeoutBar = card.querySelector('.permission-timeout');

    const cleanupTakeover = () => {
      card.remove();
      composer.style.display = 'flex';
    };

    activeTakeoverTimer = setInterval(() => {
      timeLeft -= 0.1;
      timeoutBar.style.transform = `scaleX(${Math.max(0, timeLeft / 30)})`;
      if (timeLeft <= 0) {
        clearInterval(activeTakeoverTimer);
        cue.takeoverDenied();
        cleanupTakeover();
        addActionItem(question);
      }
    }, 100);

    card.querySelector('.btn-deny').addEventListener('click', () => {
      clearInterval(activeTakeoverTimer);
      // Fallback if cue.takeoverDenied doesn't exist
      if (cue.takeoverDenied) cue.takeoverDenied();
      cleanupTakeover();
      addActionItem(question);
    });

    card.querySelector('.btn-allow').addEventListener('click', () => {
      clearInterval(activeTakeoverTimer);
      cue.send('agent:approve-takeover', { question });
      cleanupTakeover();
    });
  });
  let statusTimer = null;
  function showStatus(message) {
    let el = $('#cue-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cue-status';
      const panel = $('#panel');
      panel.insertBefore(el, $('#action-row'));
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.classList.remove('show'), 11000);
  }
  cue.on('status', ({ message }) => { cue.log('[status] ' + message); showStatus(message); });

  cue.on('assist:preview', ({ image } = {}) => {
    if (!image || !messages) return;
    sealLiveTranscriptTurns();
    messages.querySelectorAll('.assist-status:not(.is-done):not(.is-error)').forEach((el) => el.remove());
    clearOrphanThinking();
    messages.querySelectorAll('.manual-turn[data-awaiting-ai="1"]').forEach((wrap) => {
      const emptyAi = wrap.querySelector('.ai-text');
      if (emptyAi && !(emptyAi.dataset.raw || '').trim()) emptyAi.remove();
      wrap.removeAttribute('data-awaiting-ai');
    });
    addUserBubble('Assist');
    const el = document.createElement('div');
    el.className = 'assist-status';
    const thumb = document.createElement('img');
    thumb.className = 'assist-status-thumb';
    thumb.src = image;
    thumb.alt = 'Captured screen';
    thumb.title = 'Click to enlarge';
    thumb.addEventListener('click', (e) => {
      e.stopPropagation();
      openImageModal(image);
    });
    const label = document.createElement('span');
    label.className = 'assist-status-label';
    label.textContent = 'Analysing image…';
    el.appendChild(thumb);
    el.appendChild(label);
    messages.appendChild(el);
    scrollMessagesToBottom(true);

    setTimeout(() => {
      if (!busy) return;
      const pending = messages.querySelector('.assist-status:not(.is-done):not(.is-error)');
      if (!pending) return;
      finishAssistStatus('error', 'Image analysis timed out');
      clearOrphanThinking();
      setBusy(false);
      if (activeActionBtn) {
        activeActionBtn.classList.remove('active');
        activeActionBtn = null;
      }
    }, 45000);
  });

  cue.on('ocr:result', ({ text } = {}) => {
    cue.log('[OCR] Extracted text: ' + (text || ''));
  });

  // ---- settings -----------------------------------------------------------
  const opacitySlider = $('#opacity-slider');
  const chatOpacitySlider = $('#chat-opacity-slider');
  const panelWrap = $('#panel-wrap');
  const root = shadow === document ? document.documentElement : shadow.host || document.documentElement;

  function setPanelOpacity(val) {
    panelWrap.style.setProperty('--panel-opacity', val);
    if (opacitySlider) opacitySlider.value = val;
    if (chatOpacitySlider) chatOpacitySlider.value = val;
  }

  if (opacitySlider) {
    opacitySlider.addEventListener('input', (e) => setPanelOpacity(e.target.value));
  }
  if (chatOpacitySlider) {
    chatOpacitySlider.addEventListener('input', (e) => setPanelOpacity(e.target.value));
  }

  // ---- bot session --------------------------------------------------------

  const btnToggleTranscript = $('#btn-toggle-transcript');
  const TRANSCRIPT_VISIBLE_KEY = 'transcriptVisible';

  function applyTranscriptVisibility(visible) {
    if (!messagesView) return;
    messagesView.classList.toggle('transcript-hidden', !visible);
    messagesView.classList.toggle('spotlight-mode', !visible);
    if (btnToggleTranscript) {
      btnToggleTranscript.setAttribute('aria-pressed', visible ? 'true' : 'false');
      btnToggleTranscript.title = visible ? 'Hide live transcript' : 'Show live transcript';
      const label = btnToggleTranscript.querySelector('.transcript-toggle-label');
      if (label) label.textContent = visible ? 'Transcript' : 'Show transcript';
    }
    if (visible && messagesView) {
      stickTranscriptToBottom = true;
      scrollMessagesToBottom(true);
    } else if (messagesView) {
      messagesView.scrollTop = 0;
    }
    syncAiSpotlight();
  }

  applyTranscriptVisibility(true);
  localStorage.setItem(TRANSCRIPT_VISIBLE_KEY, 'true');

  if (btnToggleTranscript) {
    btnToggleTranscript.addEventListener('click', () => {
      const nextVisible = messagesView && messagesView.classList.contains('transcript-hidden');
      applyTranscriptVisibility(nextVisible);
      localStorage.setItem(TRANSCRIPT_VISIBLE_KEY, nextVisible ? 'true' : 'false');
    });
  }

  cue.on('session:started', () => {
    cue.log('Bot session active.');
    isCapturing = true;
    $('#live-dot').classList.remove('off');
    updateSiriState();
  });

  cue.on('session:stopped', () => {
    cue.log('Bot session stopped.');
    isCapturing = false;
    $('#live-dot').classList.add('off');
    updateSiriState();
  });

  const transcriptNotes = new Map();

  function cleanSpeakerLabel(name) {
    return String(name || '')
      .replace(/\b(format_size|mic_off|videocam_off|more_vert|closed_caption)\b/gi, '')
      .replace(/^speaker\s*\d*\s*:\s*/i, '')
      .replace(/[''"]+\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Speaker';
  }

  function markCommentBtn(textEl, turnId) {
    const btn = textEl.querySelector('.transcript-comment-btn');
    if (!btn) return;
    const notes = transcriptNotes.get(turnId);
    if (notes && notes.length > 0) {
      btn.classList.add('has-notes');
      btn.style.opacity = '1';
    } else {
      btn.classList.remove('has-notes');
      btn.style.opacity = '';
    }
  }

  cue.on('transcript:update', ({ turnId, speaker, text, timestamp, isComplete }) => {
    let cleanText = String(text || '').replace(/\bformat_size\b/gi, '').replace(/\s+/g, ' ').trim();
    if (!cleanText || isJunkTranscriptText(cleanText)) return;
    let label = cleanSpeakerLabel(speaker);
    if (/^[a-z]+(_[a-z0-9]+)+$/i.test(label) || /^format_size$/i.test(label)) return;
    // Drop the meeting bot's own name / self-echo in the live transcript
    if (/^xobi(n)?$/i.test(label) || /^meetingai$/i.test(label)) return;
    if (/^xobi(n)?[.!?…,]*$/i.test(cleanText)) return;

    // Drop filler-only turns ("Um.", "Uh", "Hmm")
    const fillerOnly = /^(um+|uh+|uhm+|hmm+|mm+|mhm+|ah+|oh+|er+|erm+|yeah|yep|ok|okay|right|so|well)[.!?…,]*$/i.test(cleanText);
    if (fillerOnly) return;

    // Drop icon-leak rows that are just a display name
    if (cleanText.length < 40 && !/[.!?…]/.test(cleanText) && cleanText.split(/\s+/).length <= 2) {
      const nameOnly = cleanText.replace(/[''"]+\s*$/g, '').trim();
      if (nameOnly && !/\b(am|is|are|why|what|how|can|do|the|a|i|you|me|ok|hi|yes|no)\b/i.test(cleanText)) {
        return;
      }
    }

    // Action-sealed turns are frozen (Assist / What should I say).
    const key = turnId == null ? '' : String(turnId);
    let existing = key ? (transcriptBubbles.get(key) || transcriptBubbles.get(turnId)) : null;
    if (existing && existing.dataset.sealed === '1') {
      if (isComplete) existing.dataset.complete = '1';
      return;
    }
    // Never rewrite a finished bubble with a new live stream (stale turnId reuse).
    if (existing && existing.dataset.complete === '1' && !isComplete) {
      transcriptBubbles.delete(key);
      if (turnId != null) transcriptBubbles.delete(turnId);
      existing = null;
    }

    const normLabel = (s) => String(s || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    const isGeneric = (s) => {
      const n = normLabel(s);
      return !n || n === 'speaker' || n === 'unknown' || /^speaker\s*\d+$/.test(n);
    };
    const sameNamedPerson = (a, b) => {
      const na = normLabel(a);
      const nb = normLabel(b);
      if (!na || !nb || isGeneric(a) || isGeneric(b)) return false;
      return na === nb;
    };

    // Drop exact duplicate of the last completed bubble (guards against re-broadcasts)
    if (isComplete) {
      const bubbles = [...messagesView.querySelectorAll('.transcript-text-plain')];
      const last = bubbles[bubbles.length - 1];
      if (last && last.dataset.complete === '1') {
        const lastLabel = (last.querySelector('strong')?.textContent || '').replace(/:\s*$/, '').trim();
        const lastText = (last.querySelector('span')?.textContent || '').trim();
        if (sameNamedPerson(lastLabel, label) && normLabel(lastText) === normLabel(cleanText)) {
          return;
        }
      }
    }

    // One live bubble per turnId. Never reuse another speaker's row for "Speaker"/new turnId.
    let textEl = existing;
    if (!textEl) {
      const live = messagesView.querySelector('.transcript-text-plain[data-live="1"]:not([data-sealed="1"])');
      if (live) {
        const liveTurnId = live.dataset.turnId || '';
        const liveLabel = (live.querySelector('strong')?.textContent || '').replace(/:\s*$/, '').trim();
        const sameTurn = key && liveTurnId && (liveTurnId === key || liveTurnId === String(turnId));
        if (sameTurn || (key && sameNamedPerson(liveLabel, label) && liveTurnId === key)) {
          textEl = live;
        } else if (!isComplete) {
          live.dataset.complete = '1';
          live.classList.add('complete');
          delete live.dataset.live;
        }
      }
    }
    if (!textEl) {
      textEl = document.createElement('div');
      textEl.className = 'transcript-text-plain';
      messagesView.appendChild(textEl);
    }
    if (key) {
      textEl.dataset.turnId = key;
      transcriptBubbles.set(key, textEl);
    }
    if (isComplete) {
      textEl.dataset.complete = '1';
      textEl.classList.add('complete');
      delete textEl.dataset.live;
    } else if (textEl.dataset.sealed !== '1') {
      delete textEl.dataset.complete;
      textEl.classList.remove('complete');
      textEl.dataset.live = '1';
    }
    textEl.dataset.updatedAt = String(Date.now());

    textEl.innerHTML = '';
    const strEl = document.createElement('strong');
    strEl.style.opacity = '0.8';
    strEl.style.fontWeight = '600';
    strEl.textContent = label + ': ';
    const spanEl = document.createElement('span');
    spanEl.textContent = cleanText;
    textEl.appendChild(strEl);
    textEl.appendChild(spanEl);

    if (isComplete && !textEl.querySelector('.transcript-comment-btn')) {
      const commentBtn = document.createElement('button');
      commentBtn.className = 'transcript-comment-btn';
      commentBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>';
      commentBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openCommentPopover(textEl, turnId);
      });
      textEl.appendChild(commentBtn);
      markCommentBtn(textEl, turnId);
    }

    if (!isTranscriptHidden()) {
      stickTranscriptToBottom = true;
      scrollMessagesToBottom(true);
    }
  });

  let activePopover = null;
  function openCommentPopover(parentEl, turnId) {
    if (activePopover) { activePopover.remove(); activePopover = null; }

    const popover = document.createElement('div');
    popover.className = 'comment-popover';
    popover.addEventListener('mousedown', e => e.stopPropagation());

    const existing = (transcriptNotes.get(turnId) || [])[0] || '';

    const textarea = document.createElement('textarea');
    textarea.className = 'comment-textarea';
    textarea.placeholder = 'Add a note...';
    textarea.spellcheck = false;
    textarea.value = existing;
    ['keydown', 'keyup', 'keypress', 'mousedown'].forEach(evt => textarea.addEventListener(evt, e => e.stopPropagation()));

    const actions = document.createElement('div');
    actions.className = 'comment-popover-actions';

    const clearBtn = document.createElement('button');
    clearBtn.className = 'comment-clear-btn';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('mousedown', e => e.stopPropagation());
    clearBtn.addEventListener('click', () => {
      transcriptNotes.delete(turnId);
      cue.send('transcript:notes-sync', { turnId, notes: [] });
      markCommentBtn(parentEl, turnId);
      popover.remove(); activePopover = null;
    });

    const doneBtn = document.createElement('button');
    doneBtn.className = 'comment-done-btn';
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('mousedown', e => e.stopPropagation());
    doneBtn.addEventListener('click', () => {
      const val = textarea.value.trim();
      if (val) {
        transcriptNotes.set(turnId, [val]);
        cue.send('transcript:comment', { turnId, text: val });
        cue.send('transcript:notes-sync', { turnId, notes: [val] });
      } else {
        transcriptNotes.delete(turnId);
        cue.send('transcript:notes-sync', { turnId, notes: [] });
      }
      markCommentBtn(parentEl, turnId);
      popover.remove(); activePopover = null;
    });

    textarea.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doneBtn.click();
      }
    });

    actions.appendChild(clearBtn);
    actions.appendChild(doneBtn);
    popover.appendChild(textarea);
    popover.appendChild(actions);
    parentEl.appendChild(popover);
    activePopover = popover;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    const dismiss = (e) => {
      if (!popover.contains(e.target) && e.target !== popover) {
        popover.remove(); activePopover = null;
        document.removeEventListener('mousedown', dismiss);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 50);
  }

  // Example removed

  // ---- interactions ---------------------------------------------
  const panelDragHandle = $('#panel-drag-handle');
  const toolbar = $('#toolbar');

  let isPanelDragging = false;
  let isIslandDragging = false;

  let startY = 0, startX = 0;

  // Panel position
  let panelY = 70, panelX = 0; // defaults

  // Island position
  let islandY = 14, islandX = 0; // defaults

  let isExpanded = false;
  let pressTimer = null;
  let hasDraggedIsland = false;

  // Island Long-Press / Dragging
  toolbar.addEventListener('mousedown', (e) => {
    if (e.target.closest('button') || e.target.closest('input')) return; // ignore button and slider clicks

    // Instead of dragging island separately, drag the whole panel
    startDrag(e);
  });

  // Click outside to collapse Island
  document.addEventListener('mousedown', (e) => {
    // Only collapse if clicked outside the island
    const path = e.composedPath();
    if (isExpanded && !path.includes(toolbar) && !path.includes(panelWrap)) {
      isExpanded = false;
      toolbar.classList.remove('expanded');
    }
  });

  // Attach / Detach state
  let isAttached = true;
  let attachedLoopId = null;

  function updateAttachedPosition() {
    if (!isAttached || isPanelDragging) {
      if (attachedLoopId) { cancelAnimationFrame(attachedLoopId); attachedLoopId = null; }
      return;
    }
    const tRect = toolbar.getBoundingClientRect();
    panelWrap.style.left = (tRect.left + tRect.width / 2 - panelWrap.offsetWidth / 2) + 'px';
    panelWrap.style.top = (tRect.bottom + 12) + 'px';
    attachedLoopId = requestAnimationFrame(updateAttachedPosition);
  }

  function setAttached(val) {
    isAttached = val;
    // Always keep the toggle button visible so user can hide the overlay anytime
    if (val && !attachedLoopId) {
      lockPosition();
      // Add a smooth transition so it visually "snaps" into place
      panelWrap.style.transition = 'top 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.2), left 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.2)';
      updateAttachedPosition();
    } else if (!val) {
      // Remove transition when detached so it drags smoothly
      panelWrap.style.transition = 'none';
    }
  }

  // Convert initial centered state to absolute Left/Top so dragging & resizing is natural
  let isPositionLocked = false;
  function lockPosition() {
    if (isPositionLocked) return;
    const rect = panelWrap.getBoundingClientRect();
    panelWrap.style.left = rect.left + 'px';
    panelWrap.style.top = rect.top + 'px';
    panelWrap.style.transform = 'none';
    panelWrap.style.margin = '0';
    isPositionLocked = true;
  }

  // Initialize attach state — double rAF so layout is fully settled
  isAttached = false;
  requestAnimationFrame(() => requestAnimationFrame(() => lockPosition()));

  // Panel Dragging
  const startDrag = (e) => {
    // Ignore clicks on buttons/inputs within the header
    if (e.target.closest('button') || e.target.closest('input')) return;

    lockPosition();
    isPanelDragging = true;
    setAttached(false); // Detach immediately when dragging starts
    const rect = panelWrap.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    panelWrap.style.transition = 'none';
  };

  panelDragHandle.addEventListener('mousedown', startDrag);
  const panelHeader = $('.panel-header');
  if (panelHeader) {
    panelHeader.addEventListener('mousedown', startDrag);
    panelHeader.style.cursor = 'grab';
  }

  const resizeHandle = $('#resize-handle');
  let isResizing = false;
  let startResizeX, startResizeY, startResizeW, startResizeH;

  if (resizeHandle) {
    resizeHandle.addEventListener('mousedown', (e) => {
      lockPosition();
      isResizing = true;
      panelWrap.style.transition = 'none'; // Fix sluggish resize
      startResizeX = e.clientX;
      startResizeY = e.clientY;
      const rect = panelWrap.getBoundingClientRect();
      startResizeW = rect.width;
      startResizeH = rect.height;
      e.stopPropagation();
    });
  }

  window.addEventListener('mousemove', (e) => {
    // BULLETPROOF FIX: If moving the mouse but NO buttons are pressed, release all drag/resize locks!
    // This catches missed mouseup events (e.g. released outside the window or blocked by Zoom)
    if (e.buttons === 0) {
      isIslandDragging = false;
      isPanelDragging = false;
      isResizing = false;
    }

    if (isIslandDragging) {
      const dx = e.clientX - startX - islandX;
      const dy = e.clientY - startY - islandY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasDraggedIsland = true;
        clearTimeout(pressTimer);
      }

      islandY = e.clientY - startY;
      islandX = e.clientX - startX;
      const tbRect = toolbar.getBoundingClientRect();
      const clampedY = Math.max(0, Math.min(islandY, window.innerHeight - tbRect.height));
      toolbar.style.transform = `translate(calc(-50% + ${islandX}px), ${clampedY - 14}px)`;
    }

    if (isPanelDragging) {
      const rect = panelWrap.getBoundingClientRect();
      let newLeft = e.clientX - startX;
      let newTop = e.clientY - startY;
      newLeft = Math.max(-rect.width + 60, Math.min(newLeft, window.innerWidth - 60));
      newTop = Math.max(0, Math.min(newTop, window.innerHeight - 40));
      panelWrap.style.left = newLeft + 'px';
      panelWrap.style.top = newTop + 'px';
    }

    if (isResizing) {
      const maxW = window.innerWidth - panelWrap.getBoundingClientRect().left - 10;
      const maxH = window.innerHeight - panelWrap.getBoundingClientRect().top - 10;
      const newWidth = Math.min(Math.max(320, startResizeW + (e.clientX - startResizeX)), maxW);
      const newHeight = Math.min(Math.max(240, startResizeH + (e.clientY - startResizeY)), maxH);
      panelWrap.style.width = newWidth + 'px';
      panelWrap.style.height = newHeight + 'px';
      panelWrap.style.maxHeight = newHeight + 'px';
    }
  }, { capture: true });

  window.addEventListener('mouseup', (e) => {
    clearTimeout(pressTimer);

    if (isIslandDragging) {
      isIslandDragging = false;
    }

    if (isPanelDragging) {
      isPanelDragging = false;
    }

    if (isResizing) {
      isResizing = false;
      if (isAttached) {
        panelWrap.style.transition = 'top 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.2), left 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.2)';
      }
    }
  }, { capture: true });

  // click-through
  let ignoring = null;
  function setIgnore(v) { if (v !== ignoring) { ignoring = v; cue.setIgnoreMouse(v); } }
  document.addEventListener('mousemove', (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const overUI = !!(el && el.closest && el.closest('#toolbar, #panel-wrap, .image-modal-overlay'));
    setIgnore(!overUI);
  });
  setIgnore(true);

  // ---- global keys -------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    // Escape removed
  });

  // ---- click-through: only the UI blocks the mouse; empty gaps pass to your screen ----
  // (Removed duplicate ignoring block)
  setIgnore(true); // start fully click-through; hovering the panel re-enables it

  // ---- boot --------------------------------------------------------------
  (async function boot() {
    syncPlaceholder();

    const settings = await cue.settingsGet();
    if (settings && settings.TEST_MEETING_URL) {
      const sttLang = localStorage.getItem('sttLanguage') || 'multi';
      cue.botStart({ url: settings.TEST_MEETING_URL, language: sttLang });
    }

    const st = await cue.captureState();
    $('#live-dot').classList.toggle('off', !st.active);
    if (siriOrb) siriOrb.setState(st.active);
  })();
};
