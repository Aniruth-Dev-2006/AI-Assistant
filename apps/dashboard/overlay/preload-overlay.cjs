const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cue', {
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings:set', patch),
  ask: (payload) => ipcRenderer.send('ask', payload),
  captureToggle: () => ipcRenderer.invoke('capture:toggle'),
  captureState: () => ipcRenderer.invoke('capture:state'),
  captureStart: () => ipcRenderer.send('capture:start'),
  syncTodos: (todos) => ipcRenderer.send('todo:sync', todos),
  micPcm: (arrayBuffer) => ipcRenderer.send('mic:pcm', arrayBuffer),
  systemPcm: (arrayBuffer) => ipcRenderer.send('system:pcm', arrayBuffer),
  setIgnoreMouse: (v) => ipcRenderer.send('mouse:ignore', v),
  openPane: (url) => ipcRenderer.send('open-pane', url),
  log: (msg) => ipcRenderer.send('log', msg),
  botStart: (params) => ipcRenderer.invoke('bot:start', params),
  botStop: () => ipcRenderer.invoke('bot:stop'),
  takeoverApproved: (question) => ipcRenderer.send('agent:takeover-approved', question),
  takeoverDenied: () => ipcRenderer.send('agent:takeover-denied'),
  setCandidate: (name) => ipcRenderer.send('set-candidate', name),
  requestParticipants: () => ipcRenderer.send('participants:request'),
  returnToDashboard: () => ipcRenderer.send('return-to-dashboard'),
  on: (channel, cb) => {
    const allowed = [
      'participants:update', 'capture:state', 'llm:start', 'llm:token',
      'llm:done', 'llm:error', 'status', 'transcript', 'transcript:new',
      'transcript:update', 'session:started', 'session:stopped', 'ocr:result',
      'todo:evaluated', 'todo:agent-create', 'agent:request-takeover',
      'agent:play-audio', 'bot:speaking', 'shortcut:toggle-overlay'
    ];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  }
});
