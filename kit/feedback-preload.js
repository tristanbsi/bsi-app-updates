const { contextBridge, ipcRenderer } = require('electron');
const arg = k => { const a = process.argv.find(x => x.startsWith('--fb-' + k + '=')); return a ? decodeURIComponent(a.split('=').slice(1).join('=')) : ''; };
let palette = { light: {}, dark: {} };
try { palette = JSON.parse(arg('palette') || '{}') || palette; } catch {}
contextBridge.exposeInMainWorld('feedback', {
  context: arg('context'), appName: arg('app'), appId: arg('appid'), palette,
  send: (message, context) => ipcRenderer.invoke('feedback:send', message, context),
  close: () => ipcRenderer.send('feedback:close'),
});
