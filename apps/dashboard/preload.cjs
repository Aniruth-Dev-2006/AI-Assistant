const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loginWithGoogle: () => ipcRenderer.invoke('login-with-google'),
  getCalendarStatus: () => ipcRenderer.invoke('get-calendar-status'),
  getCalendarEvents: (params) => ipcRenderer.invoke('get-calendar-events', params),
  disconnectCalendar: () => ipcRenderer.invoke('disconnect-calendar'),
  setTheme: (theme) => ipcRenderer.send('set-theme', theme),
  showCustomNotification: (data) => ipcRenderer.send('show-custom-notification', data),
  closeCustomNotification: () => ipcRenderer.send('close-custom-notification'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  launchAssist: (meetingData) => ipcRenderer.invoke('launch-assist', meetingData),
  stopAssist: () => ipcRenderer.invoke('stop-assist'),
  getAssistState: () => ipcRenderer.invoke('get-assist-state'),
  onAssistStateChange: (cb) => {
    ipcRenderer.on('assist-state-change', (_e, state) => cb(state));
  }
});
