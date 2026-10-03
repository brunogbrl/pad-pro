const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onHUDUpdate: (callback) => {
    ipcRenderer.on('hud:update', (_, data) => callback(data));
  },
  resizeHUD: (width) => {
    ipcRenderer.send('hud:resize', width);
  }
});
