// CoExplorer main process.
// Reads Claude Code session logs (~/.claude/projects), lists folders one level at a time,
// and keeps the map state in ~/.coexplorer/state.json. Original files are only read, never written.
import { app, BrowserWindow, ipcMain, shell, dialog, Menu, screen } from 'electron'
import { spawn } from 'child_process'
import { join, basename, dirname } from 'path'
import fs from 'fs'
import os from 'os'
import { ingest, stopIngest, listPages, setMemo, useProject } from './wiki.js'
import { hookStatus, installHooks, uninstallHooks, readBlocked, writeHookScript } from './hooks.js'

const HOME = os.homedir()
const PROJECTS = join(HOME, '.claude', 'projects')
const STORE_DIR = join(HOME, '.coexplorer')
const STORE = join(STORE_DIR, 'state.json')
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build', 'out', '.next', '.cache'])
const SYSTEM_DIRS = /^(windows|program files( \(x86\))?|programdata|appdata|\$recycle\.bin|system volume information)$/i

let win = null

function createWindow() {
  win = new BrowserWindow({
    icon: join(__dirname, '../../build/icon.png'),
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#f5f6f8',
    title: 'CoExplorer',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f5f6f8', symbolColor: '#5a606c', height: 40 },
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true },
  })
  win.on('ready-to-show', () => win.show())
  // App size: Ctrl + / Ctrl - / Ctrl 0 (handled in the page, saved in ui.json). The default menu could only
  // shrink the UI (Ctrl -) and needed Ctrl Shift = to grow it, so it is replaced by a hidden one.
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'App', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] }]))
  win.webContents.on('did-finish-load', () => { win.webContents.setZoomFactor(uiZoomSaved() || uiZoomDefault()); win.webContents.setVisualZoomLevelLimits(1, 1) })
  // never let a page inside the app navigate the window away
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))

  // dev aid: print renderer errors to the terminal, and optionally save a screenshot
  win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning') console.log(`[renderer ${e.level}] ${e.message}`) })
  // dev aid: run a script in the page and print what it returns
  if (process.env.COEX_EVAL) setTimeout(async () => { try { console.log('[eval]', JSON.stringify(await win.webContents.executeJavaScript(fs.readFileSync(process.env.COEX_EVAL, 'utf8')))) } catch (err) { console.log('[eval error]', String(err)) } }, 6000)
  // dev aid: save a frame every COEX_FRAMES_MS into the COEX_FRAMES folder (to check the demo tour)
  if (process.env.COEX_FRAMES) {
    let n = 0
    setInterval(async () => {
      if (!win || win.isDestroyed()) return
      const img = await win.webContents.capturePage()
      fs.writeFileSync(join(process.env.COEX_FRAMES, `f${String(n++).padStart(3, '0')}.png`), img.toPNG())
    }, Number(process.env.COEX_FRAMES_MS || 2000))
  }
  if (process.env.COEX_SHOT) {
    if (process.env.COEX_VIEW) setTimeout(() => win.webContents.executeJavaScript(`window.__setView && window.__setView(${JSON.stringify(process.env.COEX_VIEW)})`), 3500)
    setTimeout(async () => {
      const img = await win.webContents.capturePage()
      fs.writeFileSync(process.env.COEX_SHOT, img.toPNG())
      console.log('[shot] saved', process.env.COEX_SHOT)
      if (process.env.COEX_QUIT) app.quit()
    }, Number(process.env.COEX_DELAY || 8000))
  }
}

/* ---------------- app size (page zoom) ---------------- */
const UI_FILE = join(STORE_DIR, 'ui.json')
function uiZoomSaved() { try { const z = JSON.parse(fs.readFileSync(UI_FILE, 'utf8')).zoom; return typeof z === 'number' && z >= 0.5 && z <= 1.6 ? z : null } catch { return null } }
// the layout is drawn for about 1440 px; on a small or high-DPI screen start smaller so it fits
function uiZoomDefault() { const w = screen.getPrimaryDisplay().workAreaSize.width; return Math.max(0.6, Math.min(1, Math.floor((w / 1440) * 20) / 20)) }
ipcMain.handle('uiZoom', (_e, cmd) => {
  if (!win) return 1
  let z = win.webContents.getZoomFactor()
  z = cmd === 'in' ? z + 0.1 : cmd === 'out' ? z - 0.1 : uiZoomDefault()
  z = Math.round(Math.max(0.5, Math.min(1.6, z)) * 100) / 100
  win.webContents.setZoomFactor(z)
  try { fs.mkdirSync(STORE_DIR, { recursive: true }); fs.writeFileSync(UI_FILE, JSON.stringify({ zoom: z })) } catch { /* keep going */ }
  return z
})

/* ---------------- sessions ---------------- */
const metaCache = new Map() // file -> { mtimeMs, meta }

function readSlice(file, start, len) {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(len)
    const n = fs.readSync(fd, buf, 0, len, start)
    return buf.subarray(0, n).toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

function textOf(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.filter((c) => c && c.type === 'text').map((c) => c.text).join(' ')
  return ''
}

function sessionMeta(file, st) {
  const hit = metaCache.get(file)
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.meta
  let cwd = '', title = '', firstPrompt = ''
  const head = readSlice(file, 0, Math.min(st.size, 96 * 1024))
  for (const line of head.split('\n')) {
    if (!line.trim()) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    if (!cwd && o.cwd) cwd = o.cwd
    if (!firstPrompt && o.type === 'user' && !o.isMeta && o.message) {
      const tx = textOf(o.message.content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      if (tx && !tx.startsWith('Caveat')) firstPrompt = tx.slice(0, 60)
    }
    if (cwd && firstPrompt) break
  }
  // titles are appended later in the file, so read the tail
  const tailLen = Math.min(st.size, 256 * 1024)
  const tail = readSlice(file, st.size - tailLen, tailLen)
  for (const line of tail.split('\n')) {
    if (!line.includes('title') && !line.includes('summary')) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    if (o.type === 'custom-title' && o.customTitle) title = o.customTitle
    else if (o.type === 'ai-title' && o.aiTitle && !title) title = o.aiTitle
    else if (o.type === 'summary' && o.summary && !title) title = o.summary
  }
  const meta = { cwd, title: title || firstPrompt || basename(file, '.jsonl').slice(0, 8) }
  metaCache.set(file, { mtimeMs: st.mtimeMs, meta })
  return meta
}

ipcMain.handle('sessions', () => {
  const out = []
  let dirs = []
  try { dirs = fs.readdirSync(PROJECTS, { withFileTypes: true }).filter((d) => d.isDirectory()) } catch { return [] }
  for (const d of dirs) {
    const pdir = join(PROJECTS, d.name)
    let files = []
    try { files = fs.readdirSync(pdir).filter((f) => f.endsWith('.jsonl')) } catch { continue }
    for (const f of files) {
      const file = join(pdir, f)
      try { const st = fs.statSync(file); out.push({ file, st }) } catch { /* gone */ }
    }
  }
  out.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
  return out.slice(0, 40).map(({ file, st }) => {
    let meta = { cwd: '', title: basename(file) }
    try { meta = sessionMeta(file, st) } catch { /* unreadable */ }
    return { id: basename(file, '.jsonl'), file, mtime: st.mtimeMs, size: st.size, ...meta }
  })
})

const PATH_KEYS = { Read: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path', Glob: 'path', Grep: 'path' }
const KIND = { Read: 'read', Edit: 'edit', MultiEdit: 'edit', Write: 'write', NotebookEdit: 'edit', Glob: 'search', Grep: 'search' }

// Claude often opens files through the shell (cd "X"; cat "a/b.md"; head ...). Pull those paths out:
// quoted strings and bare tokens, resolved against the latest cd, kept only if they really exist.
const TMP = os.tmpdir().toLowerCase(), CLAUDE_DIR = join(HOME, '.claude').toLowerCase()
function shellPaths(cmd, cwd) {
  const toWin = (p) => { const m = p.match(/^\/([a-zA-Z])(\/.*|$)/); if (m) p = m[1].toUpperCase() + ':' + (m[2] || '\\'); return p.replace(/\//g, '\\') }
  const isAbs = (p) => /^[a-zA-Z]:[\\/]/.test(p) || /^\/[a-zA-Z]\//.test(p)
  const looksPath = (p) => p.length > 1 && p.length < 400 && !/[*?$={}<>|`\n]|^-|^https?:/.test(p) && (isAbs(p) || /[\\/]/.test(p) || /\.[A-Za-z0-9]{1,6}$/.test(p))
  const out = new Map()
  let base = cwd || ''
  let prev = ''
  for (const m of String(cmd).matchAll(/"([^"\n]*)"|'([^'\n]*)'|([^\s;|&<>()"']+)/g)) {
    const tok = (m[1] ?? m[2] ?? m[3] ?? '').trim()
    const was = prev; prev = tok.toLowerCase()
    if (!tok) continue
    const isCd = was === 'cd' || was === 'set-location' || was === 'pushd'
    if (!isCd && !looksPath(tok)) continue
    let p = isAbs(tok) ? toWin(tok) : base ? join(base, tok.replace(/\//g, '\\')) : ''
    if (!p) continue
    p = p.replace(/\\+$/, '') || p
    let st; try { st = fs.statSync(p) } catch { continue }
    if (isCd) { if (st.isDirectory()) base = p; continue }
    const low = p.toLowerCase()
    if (low.startsWith(TMP) || low.startsWith(CLAUDE_DIR)) continue // scratch files and Claude's own logs are noise
    if (!out.has(low)) out.set(low, { path: p, dir: st.isDirectory() })
    if (out.size >= 24) break
  }
  return [...out.values()]
}

// Read new bytes of a session log from `offset`. Returns tool events that touch a path.
ipcMain.handle('readSession', (_e, file, offset = 0) => {
  let st
  try { st = fs.statSync(file) } catch { return { events: [], next: offset, reset: false } }
  let reset = false
  if (st.size < offset) { offset = 0; reset = true } // the log was replaced
  const max = 8 * 1024 * 1024
  const len = Math.min(st.size - offset, max)
  if (len <= 0) return { events: [], next: offset, reset }
  const chunk = readSlice(file, offset, len)
  const lastNl = chunk.lastIndexOf('\n')
  if (lastNl < 0) return { events: [], next: offset, reset }
  const body = chunk.slice(0, lastNl)
  const next = offset + Buffer.byteLength(body, 'utf8') + 1
  const events = []
  let ended = null // true when the newest turn in this chunk ended after its last tool call
  for (const line of body.split('\n')) {
    if (line.includes('"stop_reason":"end_turn"')) { try { const z = JSON.parse(line); if (z.type === 'assistant' && z.message && z.message.stop_reason === 'end_turn' && !z.isSidechain) ended = true } catch { /* partial */ } }
    if (!line.includes('tool_use')) continue
    let o
    try { o = JSON.parse(line) } catch { continue }
    if (o.type !== 'assistant' || !o.message || !Array.isArray(o.message.content)) continue
    for (const c of o.message.content) {
      if (c.type === 'tool_use' && (c.name === 'Bash' || c.name === 'PowerShell') && c.input && c.input.command) {
        const at = Date.parse(o.timestamp) || Date.now()
        ended = false
        for (const x of shellPaths(c.input.command, o.cwd)) events.push({ tool: c.name, kind: x.dir ? 'search' : 'read', path: x.path, at, agent: o.isSidechain ? 'sub' : 'main' })
        continue
      }
      if (c.type !== 'tool_use' || !PATH_KEYS[c.name] || !c.input) continue
      let p = c.input[PATH_KEYS[c.name]]
      if (!p && (c.name === 'Glob' || c.name === 'Grep')) p = o.cwd
      if (!p || typeof p !== 'string') continue
      ended = false
      events.push({ tool: c.name, kind: KIND[c.name], path: p.replace(/\//g, '\\'), at: Date.parse(o.timestamp) || Date.now(), agent: o.isSidechain ? 'sub' : 'main' })
    }
  }
  return { events, next, reset, ended }
})

/* ---------------- folders ---------------- */
function countEntries(dir) {
  try { return fs.readdirSync(dir).length } catch { return 0 }
}

// The "This PC" tree only needs folder names: one readdir, no stats, no counts.
ipcMain.handle('children', async (_e, dir) => {
  try {
    const ents = await fs.promises.readdir(dir, { withFileTypes: true })
    return ents.filter((d) => d.isDirectory() && !d.isSymbolicLink() && !d.name.startsWith('$') && !SKIP_DIRS.has(d.name))
      .map((d) => ({ name: d.name, path: join(dir, d.name), system: SYSTEM_DIRS.test(d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  } catch { return [] }
})

// A box on the map: one level only. Async so a big folder never freezes the window.
ipcMain.handle('list', async (_e, dir) => {
  let ents = []
  try { ents = await fs.promises.readdir(dir, { withFileTypes: true }) } catch (err) { return { dir, error: String(err.code || err), dirs: [], files: [] } }
  const dirEnts = ents.filter((d) => d.isDirectory() && !SKIP_DIRS.has(d.name))
  const fileEnts = ents.filter((d) => d.isFile()).slice(0, 3000)
  const dirs = await Promise.all(dirEnts.map(async (d) => {
    const full = join(dir, d.name)
    let n = 0
    try { n = (await fs.promises.readdir(full)).length } catch { /* unreadable */ }
    return { name: d.name, path: full, n, system: SYSTEM_DIRS.test(d.name) }
  }))
  const files = await Promise.all(fileEnts.map(async (d) => {
    const full = join(dir, d.name)
    try { const st = await fs.promises.stat(full); return { name: d.name, path: full, size: st.size, mtime: st.mtimeMs } } catch { return { name: d.name, path: full, size: 0, mtime: 0 } }
  }))
  dirs.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  files.sort((a, b) => b.mtime - a.mtime)
  return { dir, dirs, files }
})

ipcMain.handle('exists', (_e, p) => { try { return fs.statSync(p).isDirectory() ? 'dir' : 'file' } catch { return null } })

ipcMain.handle('roots', () => {
  const pick = (...c) => c.find((p) => { try { return fs.statSync(p).isDirectory() } catch { return false } })
  const one = join(HOME, 'OneDrive')
  return [
    { key: 'desktop', path: pick(join(HOME, 'Desktop'), join(one, 'Desktop'), join(one, '바탕 화면')) },
    { key: 'documents', path: pick(join(HOME, 'Documents'), join(one, 'Documents'), join(one, '문서')) },
    { key: 'downloads', path: pick(join(HOME, 'Downloads')) },
    { key: 'home', path: HOME },
  ].filter((r) => r.path)
})

/* ---------------- state ---------------- */
ipcMain.handle('state:load', () => { try { return JSON.parse(fs.readFileSync(STORE, 'utf8')) } catch { return null } })
ipcMain.handle('state:save', (_e, state) => {
  fs.mkdirSync(STORE_DIR, { recursive: true })
  const tmp = STORE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1), 'utf8')
  fs.renameSync(tmp, STORE) // atomic replace
  return true
})

/* ---------------- shell ---------------- */
ipcMain.handle('reveal', (_e, p) => { shell.showItemInFolder(p); return true })
ipcMain.handle('overlay', (_e, dark) => {
  if (!win) return
  try { win.setTitleBarOverlay(dark ? { color: '#0e0f12', symbolColor: '#a5aab4' } : { color: '#f5f6f8', symbolColor: '#5a606c' }) } catch { /* not supported */ }
  win.setBackgroundColor(dark ? '#0e0f12' : '#f5f6f8')
})
ipcMain.handle('dirname', (_e, p) => dirname(p))

/* ---------------- LLM wiki ---------------- */
ipcMain.handle('wiki:pages', () => listPages())
const READ_EXT = /\.(md|markdown|txt|csv|tsv|json|ya?ml|toml|py|js|mjs|cjs|ts|tsx|jsx|html|css|tex|r|sh|log|ini|cfg)$/i
ipcMain.handle('readText', async (_e, p) => {
  if (typeof p !== 'string' || !READ_EXT.test(p)) return { error: 'type' }
  try {
    const st = await fs.promises.stat(p)
    const cap = 400 * 1024
    if (st.size <= cap) return { text: await fs.promises.readFile(p, 'utf8'), size: st.size, mtime: st.mtimeMs }
    const fd = await fs.promises.open(p, 'r'); const buf = Buffer.alloc(cap); await fd.read(buf, 0, cap, 0); await fd.close()
    return { text: buf.toString('utf8'), size: st.size, mtime: st.mtimeMs, cut: true }
  } catch (err) { return { error: String(err.code || err) } }
})
ipcMain.handle('wiki:ingest', (_e, opts) => ingest(opts, (m) => { if (win && !win.isDestroyed()) win.webContents.send('wiki:progress', m) }))
ipcMain.handle('wiki:stop', () => { stopIngest(); return true })
ipcMain.handle('wiki:memo', (_e, slug, text) => setMemo(slug, text))
ipcMain.handle('wiki:project', (_e, id) => useProject(id))

/* ---------------- new project session ---------------- */
ipcMain.handle('pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'CoExplorer · 프로젝트 폴더 고르기' })
  return r.canceled ? null : r.filePaths[0]
})
// opens Claude Code in its own terminal window, working in the project folder
// The map folders and the wiki go in as --add-dir, so Claude can read them without a prompt per file.
// Paths carry Korean and spaces, so the command goes into a small UTF-8 .cmd file instead of the command line.
ipcMain.handle('launchClaude', (_e, folder, dirs = []) => {
  try {
    const extra = [...new Set([...(Array.isArray(dirs) ? dirs : []), WIKI].filter((d) => typeof d === 'string' && d && !/["%\r\n]/.test(d) && fs.existsSync(d)))]
    const launcher = join(STORE_DIR, 'launch-claude.cmd')
    fs.mkdirSync(STORE_DIR, { recursive: true })
    fs.writeFileSync(launcher, ['@echo off', 'chcp 65001 >nul', `cd /d "${folder}"`, `claude ${extra.map((d) => `--add-dir "${d}"`).join(' ')}`, ''].join('\r\n'), 'utf8')
    const wt = join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'wt.exe')
    if (process.platform === 'win32' && fs.existsSync(wt)) {
      spawn(wt, ['-d', folder, '--title', 'Claude Code', 'cmd', '/k', launcher], { detached: true, stdio: 'ignore' }).unref()
    } else if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '"Claude Code"', 'cmd', '/k', launcher], { cwd: folder, detached: true, stdio: 'ignore', shell: false }).unref()
    } else {
      spawn('open', ['-a', 'Terminal', folder], { detached: true, stdio: 'ignore' }).unref()
    }
    return { ok: true }
  } catch (err) { return { ok: false, error: String(err) } }
})

/* ---------------- Claude Code hooks ---------------- */
// installs into the user's global Claude Code settings only when the person flips the switch
ipcMain.handle('hooks', (_e, cmd) => {
  if (cmd === 'install') return installHooks()
  if (cmd === 'uninstall') return uninstallHooks()
  const s = hookStatus()
  if (s.installed) try { writeHookScript() } catch { /* keep the script current */ }
  return s
})
ipcMain.handle('blocked', (_e, since) => readBlocked(since || 0))
app.on('before-quit', () => stopIngest())

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
