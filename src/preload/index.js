import { contextBridge, ipcRenderer, webUtils, webFrame } from 'electron'

// The renderer only gets these calls. It cannot read arbitrary files.
contextBridge.exposeInMainWorld('api', {
  sessions: () => ipcRenderer.invoke('sessions'),
  readSession: (file, offset) => ipcRenderer.invoke('readSession', file, offset),
  list: (dir) => ipcRenderer.invoke('list', dir),
  children: (dir) => ipcRenderer.invoke('children', dir),
  exists: (p) => ipcRenderer.invoke('exists', p),
  roots: () => ipcRenderer.invoke('roots'),
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (s) => ipcRenderer.invoke('state:save', s),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  overlay: (dark) => ipcRenderer.invoke('overlay', dark),
  // a folder dragged in from Windows Explorer arrives as a File; this gives its real path
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) } catch { return '' } },
  hooks: (cmd) => ipcRenderer.invoke('hooks', cmd),
  pickFolder: () => ipcRenderer.invoke('pickFolder'),
  wikiProject: (id) => ipcRenderer.invoke('wiki:project', id),
  launchClaude: (folder, dirs) => ipcRenderer.invoke('launchClaude', folder, dirs),
  blocked: (since) => ipcRenderer.invoke('blocked', since),
  wikiPages: () => ipcRenderer.invoke('wiki:pages'),
  readText: (p) => ipcRenderer.invoke('readText', p),
  uiZoom: (cmd) => ipcRenderer.invoke('uiZoom', cmd),
  wikiIngest: (opts) => ipcRenderer.invoke('wiki:ingest', opts),
  wikiStop: () => ipcRenderer.invoke('wiki:stop'),
  wikiMemo: (slug, text) => ipcRenderer.invoke('wiki:memo', slug, text),
  onWiki: (fn) => ipcRenderer.on('wiki:progress', (_e, m) => fn(m)),
  // page zoom, like Ctrl+minus: the demo tour shrinks the whole screen so everything fits
  getZoom: () => webFrame.getZoomFactor(),
  setZoom: (f) => webFrame.setZoomFactor(f),
})
