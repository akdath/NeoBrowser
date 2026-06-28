'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window
  windowMinimize:    ()   => ipcRenderer.send('window-minimize'),
  windowMaximize:    ()   => ipcRenderer.send('window-maximize'),
  windowClose:       ()   => ipcRenderer.send('window-close'),
  onWindowMaximized: (cb) => ipcRenderer.on('window-maximized', (_,v) => cb(v)),

  // Settings
  getSettings:      ()   => ipcRenderer.invoke('get-settings'),
  saveSettings:     (d)  => ipcRenderer.invoke('save-settings', d),

  // Bookmarks
  getBookmarks:     ()   => ipcRenderer.invoke('get-bookmarks'),
  saveBookmarks:    (d)  => ipcRenderer.invoke('save-bookmarks', d),

  // History
  getHistory:       ()   => ipcRenderer.invoke('get-history'),
  saveHistory:      (d)  => ipcRenderer.invoke('save-history', d),
  clearHistory:     ()   => ipcRenderer.invoke('clear-history'),

  // Sidebar sites
  getSidebarSites:  ()   => ipcRenderer.invoke('get-sidebar-sites'),
  saveSidebarSites: (d)  => ipcRenderer.invoke('save-sidebar-sites', d),

  // Cookies
  getCookies:       ()          => ipcRenderer.invoke('get-cookies'),
  deleteCookie:     (url, name) => ipcRenderer.invoke('delete-cookie', { url, name }),
  clearCookies:     ()          => ipcRenderer.invoke('clear-cookies'),

  // AI tools
  aiSpellCorrect:      (word) => ipcRenderer.invoke('ai-spell-correct', word),
  aiClassify:          (text) => ipcRenderer.invoke('ai-classify', text),
  aiPhishingDetect:    (url)  => ipcRenderer.invoke('ai-phishing-detect', url),
  showPhishingWarning: (p)    => ipcRenderer.invoke('show-phishing-warning', p),

  // Neo AI — streaming
  aiHealth: ()        => ipcRenderer.invoke('ai:health'),
  aiChat:   (payload) => ipcRenderer.invoke('ai:chat', payload),

  onAIToken: (cb) => ipcRenderer.on('ai:token', (_,token) => cb(token)),
  onAIDone:  (cb) => ipcRenderer.on('ai:done',  (_,err)   => cb(err)),
  offAIToken: () => ipcRenderer.removeAllListeners('ai:token'),
  offAIDone:  () => ipcRenderer.removeAllListeners('ai:done'),

  // Downloads
  onDownloadStarted:  (cb) => ipcRenderer.on('download-started',  (_, d) => cb(d)),
  onDownloadComplete: (cb) => ipcRenderer.on('download-complete',  (_, d) => cb(d)),
  onDownloadFailed:   (cb) => ipcRenderer.on('download-failed',    (_, d) => cb(d)),
  hookPartition: (partition) => ipcRenderer.invoke('hook-partition', partition),
  printWebview: () => ipcRenderer.invoke('print-webview'),

  // Open private windows
  openIncognitoWindow: () => ipcRenderer.invoke('open-incognito-window'),
  openTorWindow:       () => ipcRenderer.invoke('open-tor-window'),

  // Window mode (read from URL query param, exposed for convenience)
  getWindowMode: () => {
    const params = new URLSearchParams(window.location.search);
    return params.get('windowMode') || 'normal';
  },
});