/* cue renderer — UI state, mic capture, IPC, streaming render. */
(function () {
  const cue = window.cue; // exposed by preload
  window.addEventListener('error', (e) => {
    if (cue && cue.log) cue.log('[Renderer Error] ' + e.message + ' at ' + e.filename + ':' + e.lineno);
  });
  const { icon } = window.ICONS;
  const $ = (s) => document.querySelector(s);

  // ---- new island actions ------------------------------------------------
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
  if (btnTogglePanel) btnTogglePanel.onclick = toggleOverlay;
  if (cue) cue.on('shortcut:toggle-overlay', toggleOverlay);
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
  const btnSearch = document.querySelector('.act[data-mode="search"]');
  const btnFollowup = document.querySelector('.act[data-mode="followup"]');
  const btnEval = document.querySelector('.act[data-mode="evaluate"]');
  if (btnSearch) btnSearch.querySelector('.ic').innerHTML = icon('selection-pointer', { size: 16 });
  if (btnFollowup) btnFollowup.querySelector('.ic').innerHTML = icon('message-circle', { size: 16 });
  if (btnEval) btnEval.querySelector('.ic').innerHTML = icon('bar-chart-2', { size: 16 });
  
  const sendBtn = $('#send-btn');
  if (sendBtn) sendBtn.innerHTML = icon('arrow-up', { size: 18, strokeWidth: 3 });

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
    btnSettingsDropdown.onclick = () => {
      $('#more-menu-dropdown').classList.add('hidden');
      $('#chat-settings-modal').classList.remove('hidden');
    };
  }

  const btnChatSettingsBack = $('#btn-chat-settings-back');
  if (btnChatSettingsBack) {
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

  const btnShortcutsDropdown = $('#btn-shortcuts-dropdown');
  if (btnShortcutsDropdown) {
    btnShortcutsDropdown.querySelector('.ic').innerHTML = icon('keyboard', { size: 16 });
    btnShortcutsDropdown.onclick = () => {
      $('#more-menu-dropdown').classList.add('hidden');
      // trigger shortcuts overlay if it exists, or just open a URL/dialog
      if (cue && cue.openPane) {
        // Fallback for now if shortcuts UI isn't built yet
        console.log("Shortcuts clicked");
      }
    };
  }

  // Dynamic Island Buttons
  const btnMic = $('#btn-mic');
  const btnVision = $('#btn-vision');
  const btnSettings = $('#btn-settings');
  const btnEnd = $('#btn-end');

  // Inline Settings
  const btnSettingsBack = $('#btn-settings-back');
  const islandMainView = $('#island-main-view');
  const islandSettingsView = $('#island-settings-view');
  const islandShortcutNote = $('#island-shortcut-note');
  
  if (btnSettingsBack) btnSettingsBack.innerHTML = icon('chevron-left', { size: 16 });

  if (btnMic) btnMic.innerHTML = icon('mic', { size: 20 });
  if (btnVision) btnVision.innerHTML = icon('selection-pointer', { size: 20 });
  if (btnSettings) btnSettings.innerHTML = icon('sliders-2', { size: 20 });
  if (btnEnd) btnEnd.innerHTML = icon('stop-square', { size: 20 });

  // Event Listeners for Dynamic Island
  if (btnMic) btnMic.addEventListener('click', () => {
    btnMic.classList.toggle('danger');
    btnMic.innerHTML = btnMic.classList.contains('danger') ? icon('mic-off', { size: 20 }) : icon('mic', { size: 20 });
  });
  if (btnVision) btnVision.addEventListener('click', () => {
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

  setupCustomSelect('island-stt-language-container', 'sttLanguage');

  if (btnEnd) btnEnd.addEventListener('click', () => {
    cue.botStop();
    showStatus('🤖 Disconnecting and generating final report...');
  });

  // Tabs removed

  // ---- events from main -------------------------------------------------------------
  let settings = null;
  let busy = false;
  let aiEl = null;       // current streaming <div class="ai-text">
  let caretEl = null;

  const messages = $('#messages');

  function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // minimal, safe markdown: fenced code, bullets, inline code, bold, paragraphs
  function renderMarkdown(text) {
    const lines = text.split('\n');
    let html = '', inCode = false, inList = false, buf = [];
    const flushP = () => { if (buf.length) { html += '<p>' + inline(buf.join(' ')) + '</p>'; buf = []; } };
    const inline = (s) => esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    for (const raw of lines) {
      const line = raw;
      if (/^```/.test(line.trim())) {
        if (!inCode) { flushP(); if (inList) { html += '</ul>'; inList = false; } html += '<pre><code>'; inCode = true; }
        else { html += '</code></pre>'; inCode = false; }
        continue;
      }
      if (inCode) { html += esc(line) + '\n'; continue; }
      if (/^\s*[-*]\s+/.test(line)) { flushP(); if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inline(line.replace(/^\s*[-*]\s+/, '')) + '</li>'; continue; }
      if (line.trim() === '') { flushP(); if (inList) { html += '</ul>'; inList = false; } continue; }
      buf.push(line.trim());
    }
    flushP(); if (inList) html += '</ul>'; if (inCode) html += '</code></pre>';
    return html;
  }



  function clearMessages() { messages.innerHTML = ''; aiEl = null; caretEl = null; }

  function addUserBubble(text) {
    const b = document.createElement('div');
    b.className = 'user-bubble';
    b.textContent = text;
    messages.appendChild(b);
  }

  function startAi(small) {
    messages.querySelectorAll('.ai-text').forEach((el) => el.remove());
    aiEl = document.createElement('div');
    aiEl.className = 'ai-text' + (small ? ' small' : '');
    aiEl.dataset.raw = '';
    const thinkEl = document.createElement('div');
    thinkEl.className = 'thinking-indicator';
    thinkEl.innerHTML = '<div class="pixel-spinner"><div class="px-1"></div><div class="px-2"></div><div class="px-3"></div><div class="px-4"></div></div><span class="think-text">Thinking</span>';
    aiEl.appendChild(thinkEl);
    caretEl = null;
    messages.appendChild(aiEl);
    messages.scrollTop = messages.scrollHeight;
  }

  let _tokenCount = 0;
  function appendToken(t) {
    if (!aiEl) startAi(false);
    // Remove thinking indicator on first token
    const thinkEl = aiEl.querySelector('.thinking-indicator');
    if (thinkEl) { thinkEl.remove(); _tokenCount = 0; }
    aiEl.dataset.raw += t;
    const span = document.createElement('span');
    span.className = 'w';
    // stagger blur per word so they flow in sequentially
    const delay = Math.min(_tokenCount * 18, 180);
    span.style.animationDelay = delay + 'ms';
    _tokenCount++;
    span.textContent = t;
    aiEl.appendChild(span);
    messages.scrollTop = messages.scrollHeight;
  }

  function finalizeAi() {
    if (!aiEl) return;
    const thinkEl = aiEl.querySelector('.thinking-indicator');
    if (thinkEl) thinkEl.remove();
    const raw = aiEl.dataset.raw || '';
    aiEl.innerHTML = renderMarkdown(raw);
    aiEl = null; caretEl = null;
    messages.scrollTop = messages.scrollHeight;
  }

  function setBusy(v) { busy = v; $('#send-btn').classList.toggle('busy', v); }

  let activeActionBtn = null;

  // ---- actions -----------------------------------------------------------
  function runMode(mode, text, btnElement = null) {
    if (busy) return;
    if (mode === 'search') {
      cue.captureStart();
      return;
    }
    // No longer clearing messages, treat as continuous chat
    if (text) {
      addUserBubble(text);
    } else if (btnElement) {
      const btnLabel = btnElement.innerText.trim();
      if (btnLabel) {
        addUserBubble(`⚡ ${btnLabel}`);
      }
    }
    setBusy(true);
    
    // UI state for button
    if (btnElement) {
        btnElement.classList.add('active');
        activeActionBtn = btnElement;
    }

    const currentTodos = typeof todoList !== 'undefined' ? todoList : [];
    cue.ask({ mode, text: text || '', todos: currentTodos });
  }

  document.querySelectorAll('.act').forEach((btn) => {
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
    
    cue.on('participants:update', (list) => {
      // Remove old dynamic items
      cmdMenu.querySelectorAll('.cmd-item.dynamic-participant').forEach(el => el.remove());
      
      // Append new ones
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
      syncPlaceholder(); // force refresh of command list
    });
  }

  input.addEventListener('input', syncPlaceholder);
  input.addEventListener('focus', () => { composer.classList.add('focused'); placeholder.classList.add('hidden'); });
  input.addEventListener('blur', () => { 
    composer.classList.remove('focused'); 
    syncPlaceholder(); 
    // Delay hiding so clicks register
    setTimeout(() => { if(cmdMenu) cmdMenu.classList.add('hidden'); }, 150);
  });
  $('#input-area').addEventListener('click', () => input.focus());

  // ---- Todo Agent State ----
  const todoList = [];
  let todoIdCounter = 0;

  function addTodo(text, maxScore, source) {
    const todo = {
      id: ++todoIdCounter,
      text: text,
      status: 'pending',
      score: null,
      maxScore: maxScore || null,
      note: '',
      source: source || 'user',
      createdAt: Date.now()
    };
    todoList.push(todo);
    renderTodoRow(todo);
    syncTodosToMain();
    return todo;
  }

  function renderTodoRow(todo) {
    const row = document.createElement('div');
    row.className = 'todo-row';
    row.dataset.todoId = todo.id;
    _buildTodoRowInner(row, todo);
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
  }

  function _buildTodoRowInner(row, todo) {
    const isDone = todo.status === 'done';
    const check = isDone ? '☑' : '☐';
    const score = (todo.maxScore !== null && todo.score !== null) ? ` ${todo.score}/${todo.maxScore}` : '';
    row.dataset.status = todo.status;
    row.innerHTML = `<span class="td-chk">${check}</span><span class="td-txt${isDone ? ' done' : ''}">${esc(todo.text)}${score ? '<span class="td-sc">' + score + '</span>' : ''}</span>`;
  }

  function updateTodoCard(id, updates) {
    const todo = todoList.find(t => t.id === id);
    if (!todo) return;
    Object.assign(todo, updates);
    
    // Update in-place without removing — avoids re-render flash
    const row = messages.querySelector(`[data-todo-id="${id}"]`);
    if (row) {
      row.dataset.status = todo.status;
      _buildTodoRowInner(row, todo);
    }
    syncTodosToMain();
  }

  function syncTodosToMain() {
    cue.log('[TodoAgent] Syncing ' + todoList.length + ' todos');
    if (cue.syncTodos) cue.syncTodos(todoList);
  }

  function handleCommand(text) {
    // /todo <text>
    const todoMatch = text.match(/^\/todo\s+(.+)/i);
    if (todoMatch) {
      addTodo(todoMatch[1].trim(), null, 'user');
      return true;
    }
    // /rubric <criteria> /<max>
    const rubricMatch = text.match(/^\/rubric\s+(.+?)\s+\/(\d+)\s*$/i);
    if (rubricMatch) {
      addTodo(rubricMatch[1].trim(), parseInt(rubricMatch[2]), 'user');
      return true;
    }
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

  // Smart toggle removed — production mode always on

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
    } else if (isCapturing) {
      siriOrb.setState(1.0);
    } else {
      siriOrb.setState(0.0);
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
    if (active) { startMic(); startSystemAudio(); } else { stopMic(); stopSystemAudio(); }
  });
  cue.on('llm:start', ({ userBubble, small } = {}) => {
    if (userBubble) addUserBubble(userBubble);
    startAi(!!small);
    setBusy(true);
  });
  cue.on('llm:token', ({ text }) => appendToken(text));
  cue.on('llm:done', () => { 
      finalizeAi(); 
      setBusy(false); 
      if (activeActionBtn) {
          activeActionBtn.classList.remove('active');
          activeActionBtn = null;
      }
  });
  cue.on('llm:error', ({ message }) => {
    if (!aiEl) startAi(true);
    aiEl.dataset.raw = message; finalizeAi(); setBusy(false);
    if (activeActionBtn) {
        activeActionBtn.classList.remove('active');
        activeActionBtn = null;
    }
  });

  // ---- Todo Agent events from LLM ----
  cue.on('todo:evaluated', (evalData) => {
    cue.log('[TodoAgent] Evaluation received: ' + JSON.stringify(evalData));
    updateTodoCard(evalData.id, {
      status: evalData.status,
      score: evalData.score || null,
      note: evalData.note || ''
    });
  });

  cue.on('todo:agent-create', ({ text }) => {
    cue.log('[TodoAgent] Agent created todo: ' + text);
    addTodo(text, null, 'agent');
  });

  // ---- Agent Takeover ----
  cue.on('agent:request-takeover', ({ question, reason }) => {
    cue.log('[Agent] Takeover requested for: ' + question);
    
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

    const composer = document.getElementById('composer');
    composer.style.display = 'none';

    // Insert card into the panel, replacing the composer area
    const panel = document.getElementById('panel');
    panel.insertBefore(card, document.getElementById('resize-handle'));

    // Timeout logic (30s)
    let timeLeft = 30;
    const timeoutBar = card.querySelector('.permission-timeout');
    
    const cleanupTakeover = () => {
      card.remove();
      composer.style.display = 'flex';
    };
    
    const timer = setInterval(() => {
      timeLeft -= 0.1;
      timeoutBar.style.transform = `scaleX(${Math.max(0, timeLeft / 30)})`;
      if (timeLeft <= 0) {
        clearInterval(timer);
        cue.takeoverDenied();
        cleanupTakeover();
        addTodo(question, null, 'agent'); // Added as follow-up
      }
    }, 100);

    card.querySelector('.btn-allow').addEventListener('click', () => {
      clearInterval(timer);
      cue.takeoverApproved(question);
      cleanupTakeover();
      showStatus('Agent active');
    });

    card.querySelector('.btn-deny').addEventListener('click', () => {
      clearInterval(timer);
      cue.takeoverDenied();
      cleanupTakeover();
      addTodo(question, null, 'agent'); // Added as follow-up
    });
  });
  let statusTimer = null;
  function showStatus(message) {
    let el = document.getElementById('cue-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cue-status';
      const panel = document.getElementById('panel');
      panel.insertBefore(el, document.getElementById('action-row'));
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.classList.remove('show'), 11000);
  }
  cue.on('status', ({ message }) => { cue.log('[status] ' + message); showStatus(message); });

  cue.on('ocr:result', ({ text, image }) => {
    // Pixel spinner from startAi() handles the loading state - no extra bubble needed
    
    const messagesEl = document.getElementById('messages');
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    
    // Log extracted text to terminal for debugging
    cue.log('[OCR] Extracted text: ' + text);
    
    // Instead of sending text, send the raw image to the backend Vision model
    cue.send('ocr:process', { image: image });
  });

  // ---- settings -----------------------------------------------------------
  const opacitySlider = $('#opacity-slider');
  const panelWrap = $('#panel-wrap');
  
  if (opacitySlider && panelWrap) {
    opacitySlider.addEventListener('input', (e) => {
      panelWrap.style.opacity = e.target.value;
    });
  }

  // ---- bot session --------------------------------------------------------
  const messagesView = $('#messages');

  cue.on('session:started', () => {
    cue.log('Bot session active.');
  });

  cue.on('session:stopped', () => {
    cue.log('Bot session stopped.');
  });

  const transcriptBubbles = new Map();

  cue.on('transcript:update', ({ turnId, speaker, text, timestamp, isComplete }) => {
    let textEl = transcriptBubbles.get(turnId);
    
    if (!textEl) {
      textEl = document.createElement('div');
      textEl.className = 'transcript-text-plain';
      textEl.style.color = 'rgba(255,255,255,0.7)';
      textEl.style.fontSize = '13px';
      textEl.style.margin = '4px 0';
      textEl.style.lineHeight = '1.4';
      if (aiEl && aiEl.parentNode === messagesView) {
        messagesView.insertBefore(textEl, aiEl);
      } else {
        messagesView.appendChild(textEl);
      }
      transcriptBubbles.set(turnId, textEl);
    }
    
    textEl.innerHTML = ''; // clear old content
    const strEl = document.createElement('strong');
    strEl.style.opacity = '0.8';
    strEl.style.fontWeight = '600';
    strEl.textContent = speaker + ': ';
    
    const spanEl = document.createElement('span');
    spanEl.textContent = text;
    
    textEl.appendChild(strEl);
    textEl.appendChild(spanEl);
    
    // Keep the map entry so same-speaker continuations update this line in place.
    
    messagesView.scrollTop = messagesView.scrollHeight;
  });

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

  let isExpanded = true;
  let pressTimer = null;
  let hasDraggedIsland = false;
  
  if (toolbar) {
    toolbar.classList.add('expanded');
  }

  // Island Long-Press / Dragging
  toolbar.addEventListener('mousedown', (e) => {
    if (e.target.closest('button') || e.target.closest('input')) return; // ignore button and slider clicks
    
    isIslandDragging = true;
    hasDraggedIsland = false;
    startY = e.clientY - islandY;
    startX = e.clientX - islandX;

    pressTimer = setTimeout(() => {
      if (!hasDraggedIsland) {
        // Toggle expanded state
        isExpanded = !isExpanded;
        if (isExpanded) {
          toolbar.classList.add('expanded');
        } else {
          toolbar.classList.remove('expanded');
        }
        isIslandDragging = false; // Stop dragging if we just toggled state
      }
    }, 300);
  });

  // Click outside to collapse Island
  document.addEventListener('mousedown', (e) => {
    // Only collapse if clicked outside the island
    if (isExpanded && !e.target.closest('#toolbar')) {
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
    if (btnTogglePanel) {
      btnTogglePanel.style.display = val ? 'none' : 'flex';
    }
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

  // Initialize attach state now that lockPosition is defined
  setAttached(true);
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
  const panelHeader = document.querySelector('.panel-header');
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
      startResizeX = e.clientX;
      startResizeY = e.clientY;
      const rect = panelWrap.getBoundingClientRect();
      startResizeW = rect.width;
      startResizeH = rect.height;
      
      // Allow overriding the CSS max-height: 60vh constraint during manual resize
      panelWrap.style.maxHeight = 'none';
      
      e.stopPropagation();
    });
  }

  window.addEventListener('mousemove', (e) => {
    if (isIslandDragging) {
      const dx = e.clientX - startX - islandX;
      const dy = e.clientY - startY - islandY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasDraggedIsland = true;
        clearTimeout(pressTimer);
      }
      
      islandY = e.clientY - startY;
      islandX = e.clientX - startX;
      toolbar.style.transform = `translate(calc(-50% + ${islandX}px), ${islandY - 14}px)`;
    }

    if (isPanelDragging) {
      panelWrap.style.left = (e.clientX - startX) + 'px';
      panelWrap.style.top = (e.clientY - startY) + 'px';
    }

    if (isResizing) {
      const newWidth = Math.max(320, startResizeW + (e.clientX - startResizeX));
      
      // Prevent resizing past the bottom edge of the window
      const rect = panelWrap.getBoundingClientRect();
      const currentTop = rect.top;
      const maxAllowedHeight = window.innerHeight - currentTop - 20; // 20px padding
      
      let newHeight = Math.max(240, startResizeH + (e.clientY - startResizeY));
      
      // Also respect max-height from CSS by getting the computed style or just bounding to maxAllowedHeight
      newHeight = Math.min(newHeight, maxAllowedHeight);
      
      panelWrap.style.width = newWidth + 'px';
      panelWrap.style.height = newHeight + 'px';
    }
  });

  window.addEventListener('mouseup', (e) => {
    clearTimeout(pressTimer);

    if (isIslandDragging) {
      isIslandDragging = false;
      const tRect = toolbar.getBoundingClientRect();
      const pRect = panelWrap.getBoundingClientRect();
      if (!isAttached && Math.abs(pRect.top - tRect.bottom) < 100 && pRect.left > tRect.left - 250 && pRect.right < tRect.right + 250) {
        setAttached(true);
      }
    }

    if (isPanelDragging) {
      isPanelDragging = false;
      const tRect = toolbar.getBoundingClientRect();
      const pRect = panelWrap.getBoundingClientRect();
      if (Math.abs(pRect.top - tRect.bottom) < 100 && pRect.left > tRect.left - 250 && pRect.right < tRect.right + 250) {
        setAttached(true);
      } else {
        setAttached(false);
      }
    }
    
    if (isResizing) {
      isResizing = false;
    }
  });
  
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

  // Onboarding removed

  // ---- setup screen ------------------------------------------------------
  const btnStartSession = $('#btn-start-session');
  const setupScreen = $('#setup-screen');
  
  if (btnStartSession) {
    btnStartSession.onclick = () => {
      const url = $('#setup-meeting-url').value.trim();
      if (!url) return alert('Please enter a meeting URL');
      
      localStorage.setItem('lastMeetingUrl', url);
      
      const sttLang = localStorage.getItem('sttLanguage') || 'multi';
      
      // Pass url to backend. The backend / desktop main process will handle deepgram auth
      cue.botStart({ url, language: sttLang, deepgramKey: null });
      
      btnStartSession.innerText = 'Connecting...';
      btnStartSession.disabled = true;
    };
  }

  if (cue) {
    cue.on('session:started', () => {
      if (setupScreen) setupScreen.style.display = 'none';
      if ($('#messages')) $('#messages').style.display = 'flex';
      if ($('#action-row')) $('#action-row').style.display = 'flex';
      if ($('#composer')) $('#composer').style.display = 'flex';
      if (btnStartSession) {
        btnStartSession.innerText = 'Join Meeting';
        btnStartSession.disabled = false;
      }
    });
    
    cue.on('session:error', (err) => {
      alert('Failed to join meeting: ' + (err.message || 'Unknown error'));
      if (btnStartSession) {
        btnStartSession.innerText = 'Join Meeting';
        btnStartSession.disabled = false;
      }
    });
  }

  // ---- boot --------------------------------------------------------------
  (async function boot() {
    syncPlaceholder();
    
    const lastUrl = localStorage.getItem('lastMeetingUrl');
    
    if (lastUrl && $('#setup-meeting-url')) $('#setup-meeting-url').value = lastUrl;
    
    // We don't auto-start anymore. The user must click Join.
    
    const st = await cue.captureState();
    $('#live-dot').classList.toggle('off', !st.active);
    if (siriOrb) siriOrb.setState(st.active);
    
    // If it's already active (page refreshed), hide setup
    if (st.active) {
      if (setupScreen) setupScreen.style.display = 'none';
      if ($('#messages')) $('#messages').style.display = 'flex';
      if ($('#action-row')) $('#action-row').style.display = 'flex';
      if ($('#composer')) $('#composer').style.display = 'flex';
    }
  })();
})();
