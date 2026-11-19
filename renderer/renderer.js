/* cue renderer — UI state, mic capture, IPC, streaming render. */
(function () {
  const { icon } = window.ICONS;
  const cue = window.cue; // exposed by preload
  const $ = (s) => document.querySelector(s);

  // ---- paint icons -------------------------------------------------------
  $('#island-logo').innerHTML = icon('mic', { size: 20 });
  $('#island-mute').innerHTML = icon('mic-off', { size: 24 });
  $('#island-stop').innerHTML = icon('phone-off', { size: 24 });
  $('#island-hide').innerHTML = icon('eye-off', { size: 24 });
  document.querySelector('.act[data-mode="probe"] .ic').innerHTML = icon('message-circle', { size: 16 });
  document.querySelector('.act[data-mode="analyze"] .ic').innerHTML = icon('code', { size: 16 });
  document.querySelector('.act[data-mode="evaluate"] .ic').innerHTML = icon('bar-chart-2', { size: 16 });
  $('#smart-toggle .ic').innerHTML = icon('zap', { size: 14 });
  $('#more-btn').innerHTML = icon('more-horizontal', { size: 18 });
  $('#send-btn').innerHTML = icon('play', { size: 15 });

  // ---- state -------------------------------------------------------------
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
    aiEl = document.createElement('div');
    aiEl.className = 'ai-text' + (small ? ' small' : '');
    aiEl.dataset.raw = '';
    caretEl = document.createElement('span');
    caretEl.className = 'ai-caret';
    aiEl.appendChild(caretEl);
    messages.appendChild(aiEl);
  }

  function appendToken(t) {
    if (!aiEl) startAi(false);
    aiEl.dataset.raw += t;
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = t;
    aiEl.insertBefore(span, caretEl);
  }

  function finalizeAi() {
    if (!aiEl) return;
    const raw = aiEl.dataset.raw || '';
    aiEl.innerHTML = renderMarkdown(raw);
    aiEl = null; caretEl = null;
  }

  function setBusy(v) { busy = v; $('#send-btn').classList.toggle('busy', v); }

  // ---- actions -----------------------------------------------------------
  function runMode(mode, text) {
    if (busy) return;
    setBusy(true);
    cue.ask({ mode, text: text || '' });
  }

  document.querySelectorAll('.act').forEach((btn) => {
    btn.addEventListener('click', () => runMode(btn.dataset.mode, ''));
  });

  const input = $('#input');
  const placeholder = $('#placeholder');
  const composer = $('#composer');

  function syncPlaceholder() {
    placeholder.classList.toggle('hidden', input.value.length > 0 || document.activeElement === input);
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }
  input.addEventListener('input', syncPlaceholder);
  input.addEventListener('focus', () => { composer.classList.add('focused'); placeholder.classList.add('hidden'); });
  input.addEventListener('blur', () => { composer.classList.remove('focused'); syncPlaceholder(); });
  $('#input-area').addEventListener('click', () => input.focus());

  function send() {
    const text = input.value.trim();
    if (!text) { runMode('assist', ''); return; }
    input.value = ''; syncPlaceholder();
    runMode('ask', text);
  }
  $('#send-btn').addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) { e.preventDefault(); send(); }
    if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); runMode('assist', ''); }
  });

  // Smart toggle
  const smartBtn = $('#smart-toggle');
  smartBtn.addEventListener('click', async () => {
    settings.smart = !settings.smart;
    smartBtn.classList.toggle('on', settings.smart);
    await cue.settingsSet({ smart: settings.smart });
  });

  // Hide / collapse panel
  $('#island-hide').addEventListener('click', () => {
    const collapsed = $('#panel').classList.toggle('collapsed');
    $('#live-dot').style.display = collapsed ? 'none' : '';
  });

  // Stop listening
  $('#island-stop').addEventListener('click', () => {
    // Ends the session
    cue.captureToggle();
  });

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

  cue.on('capture:state', ({ active }) => {
    $('#live-dot').classList.toggle('off', !active);
    if (siriOrb) siriOrb.setState(active);
    if (active) { startMic(); startSystemAudio(); } else { stopMic(); stopSystemAudio(); }
  });
  cue.on('llm:start', ({ userBubble, small }) => {
    clearMessages();
    if (userBubble) addUserBubble(userBubble);
    startAi(!!small);
    setBusy(true);
  });
  cue.on('llm:token', ({ text }) => appendToken(text));
  cue.on('llm:done', () => { finalizeAi(); setBusy(false); });
  cue.on('llm:error', ({ message }) => {
    if (!aiEl) startAi(true);
    aiEl.dataset.raw = message; finalizeAi(); setBusy(false);
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

  // Settings removed

  // Example removed

  // ---- interactions ---------------------------------------------
  const panelWrap = $('#panel-wrap');
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
    if (e.target.closest('button')) return; // ignore button clicks
    
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

  // Panel Dragging
  panelDragHandle.addEventListener('mousedown', (e) => {
    isPanelDragging = true;
    startY = e.clientY - panelY;
    startX = e.clientX - panelX;
    panelWrap.style.transition = 'none';
  });

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
      panelY = e.clientY - startY;
      panelX = e.clientX - startX;
      panelWrap.style.transform = `translate(calc(-50% + ${panelX}px), ${panelY - 70}px)`;
    }
  });

  window.addEventListener('mouseup', (e) => {
    clearTimeout(pressTimer);

    if (isIslandDragging) {
      isIslandDragging = false;
    }

    if (isPanelDragging) {
      isPanelDragging = false;
      
      // Magnetic Snap back to Island if released close enough
      const targetPanelY = islandY + 56;
      const targetPanelX = islandX;
      
      const distY = Math.abs(panelY - targetPanelY);
      const distX = Math.abs(panelX - targetPanelX);

      if (distY < 80 && distX < 100) {
        panelY = targetPanelY;
        panelX = targetPanelX;
        panelWrap.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
        panelWrap.style.transform = `translate(calc(-50% + ${panelX}px), ${panelY - 70}px)`;
      }
    }
  });

  // ---- global keys -------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    // Escape removed
  });

  // ---- click-through: only the UI blocks the mouse; empty gaps pass to your screen ----
  let ignoring = null;
  function setIgnore(v) { if (v !== ignoring) { ignoring = v; cue.setIgnoreMouse(v); } }
  document.addEventListener('mousemove', (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const overUI = !!(el && el.closest && el.closest('#toolbar, #panel-wrap'));
    setIgnore(!overUI);
  });
  setIgnore(true); // start fully click-through; hovering the panel re-enables it

  // Onboarding removed

  // ---- boot --------------------------------------------------------------
  (async function boot() {
    syncPlaceholder();
    const st = await cue.captureState();
    $('#live-dot').classList.toggle('off', !st.active);
    if (siriOrb) siriOrb.setState(st.active);
  })();
})();
