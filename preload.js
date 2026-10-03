const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  resetConfig: () => ipcRenderer.invoke('config:reset'),
  exportConfig: (config) => ipcRenderer.invoke('config:export', config),
  importConfig: () => ipcRenderer.invoke('config:import'),

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // Serial & Hardware
  listPorts: () => ipcRenderer.invoke('serial:list'),
  getSerialStatus: () => ipcRenderer.invoke('pad:get-serial-status'),
  reconnectSerial: () => ipcRenderer.invoke('pad:reconnect'),
  setHardwareLayer: (layer) => ipcRenderer.invoke('pad:set-layer', layer),
  syncEncoder: (data) => ipcRenderer.invoke('pad:sync-encoder', data),
  syncCustomization: (data) => ipcRenderer.invoke('pad:sync-customization', data),
  testOledBoot: () => ipcRenderer.invoke('pad:test-oled-boot'),
  testOledUpdating: () => ipcRenderer.invoke('pad:test-oled-updating'),
  forceSyncPad: () => ipcRenderer.invoke('pad:force-sync'),
  getRecentLogs: () => ipcRenderer.invoke('pad:get-logs'),
  exportSerialLogs: (text) => ipcRenderer.invoke('serial:export-logs', text),
  onSerialStatus: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('pad:serial-status', listener);
    return () => ipcRenderer.removeListener('pad:serial-status', listener);
  },
  onLogMessage: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('log:message', listener);
    return () => ipcRenderer.removeListener('log:message', listener);
  },
  onPadEvent: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('pad:event', listener);
    return () => ipcRenderer.removeListener('pad:event', listener);
  },

  // HUD Controls
  toggleHUD: (enabled) => ipcRenderer.invoke('hud:toggle', enabled),
  getHUDState: () => ipcRenderer.invoke('hud:state'),
  setHUDMode: (mode) => ipcRenderer.invoke('hud:set-mode', mode),
  getHUDMode: () => ipcRenderer.invoke('hud:get-mode'),
  resetHUDPosition: () => ipcRenderer.invoke('hud:reset-position'),
  notifyHUD: (data) => ipcRenderer.send('hud:notify', data),
  onHUDStateChange: (callback) => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on('hud:state-changed', listener);
    return () => ipcRenderer.removeListener('hud:state-changed', listener);
  },
  onHUDModeChange: (callback) => {
    const listener = (_, mode) => callback(mode);
    ipcRenderer.on('hud:mode-changed', listener);
    return () => ipcRenderer.removeListener('hud:mode-changed', listener);
  },

  // System & Settings
  openURL: (url) => ipcRenderer.invoke('system:open-url', url),
  setLoginItem: (enabled) => ipcRenderer.invoke('system:set-login-item', enabled),
  getLoginItem: () => ipcRenderer.invoke('system:get-login-item'),
  setCloseToTray: (enabled) => ipcRenderer.invoke('system:set-close-to-tray', enabled),
  setStartMinimized: (enabled) => ipcRenderer.invoke('system:set-start-minimized', enabled),

  // Soundpad
  checkSoundpad: () => ipcRenderer.invoke('soundpad:check'),
  getSoundTitleForShortcut: (shortcut) => ipcRenderer.invoke('soundpad:get-title-for-shortcut', shortcut),
  getSoundpadCache: () => ipcRenderer.invoke('soundpad:get-cache'),
  resolveSoundpadKeys: (shortcuts) => ipcRenderer.invoke('soundpad:resolve-keys', shortcuts),
  refreshSoundpad: () => ipcRenderer.invoke('soundpad:refresh'),
  onSoundpadUpdated: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('soundpad:updated', listener);
    return () => ipcRenderer.removeListener('soundpad:updated', listener);
  },
  onSoundPlaying: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('soundpad:playing', listener);
    return () => ipcRenderer.removeListener('soundpad:playing', listener);
  },

  // Discord
  getDiscordStatus: () => ipcRenderer.invoke('discord:status'),
  onDiscordStatus: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('discord:status-changed', listener);
    return () => ipcRenderer.removeListener('discord:status-changed', listener);
  },

  // Tray controls
  updateTrayColor: (color, name) => ipcRenderer.invoke('tray:update-color', { color, name }),

  // Auto-Updater
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  getAppVersion: () => ipcRenderer.invoke('updater:get-version'),
  onUpdaterStatus: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  }
});

