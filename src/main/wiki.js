// LLM wiki: Claude Code reads the folders on the map and writes GBrain-style topic pages.
// Page = one markdown file: frontmatter (title, type, sources, updated) + compiled truth
// (one claim per line with its source) + <!-- timeline --> + "## 사람 메모" that Claude never edits.
// Steps 1-3 (scan, hash, link extraction) are rules and cost nothing; only reading and writing use the model.
import { spawn } from 'child_process'
import { join, basename, extname } from 'path'
import fs from 'fs'
import os from 'os'
import crypto from 'crypto'

const ROOT = join(process.env.COEX_HOME || join(os.homedir(), '.coexplorer'), 'wiki') // COEX_HOME: tests
// each project keeps its own wiki; the first (default) project uses the root folder
export let WIKI = ROOT
let PAGES = join(WIKI, 'pages')
let MANIFEST = join(WIKI, 'manifest.json') // source path -> hash at last ingest
let LOG = join(WIKI, 'ingest-log.json')
export function useProject(id) {
  WIKI = !id || id === 'default' ? ROOT : join(ROOT, 'projects', String(id).replace(/[^\w-]/g, ''))
  PAGES = join(WIKI, 'pages'); MANIFEST = join(WIKI, 'manifest.json'); LOG = join(WIKI, 'ingest-log.json')
  return join(WIKI, 'index.md')
}
const TEXT = new Set(['.md', '.txt', '.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.yaml', '.yml', '.toml', '.html', '.css', '.csv', '.r', '.ipynb', '.tex', '.sh'])
const SKIP = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build', 'out', '.next', '.cache', '.claude'])
const SECRET = /(^\.env|\.pem$|\.key$|^id_rsa|credential|secret|token|_key$|apikey)/i

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return d } }
const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)
const under = (p, dir) => { const a = p.replace(/\//g, '\\').toLowerCase(), b = dir.replace(/\//g, '\\').toLowerCase().replace(/\\+$/, ''); return a === b || a.startsWith(b + '\\') }

/* step 1-2: scan + hash (rules only) */
function scan(folders, rules, limit, fresh) {
  const files = []
  const walk = (dir, depth) => {
    if (depth > 4 || files.length > 4000) return
    let ents = []
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const d of ents) {
      const full = join(dir, d.name)
      if (rules.hidden.some((h) => under(full, h))) continue // people hid it: never read
      if (d.isDirectory()) { if (!SKIP.has(d.name)) walk(full, depth + 1); continue }
      if (!TEXT.has(extname(d.name).toLowerCase()) || SECRET.test(d.name)) continue
      let st
      try { st = fs.statSync(full) } catch { continue }
      if (st.size === 0 || st.size > 80 * 1024) continue
      files.push({ path: full, size: st.size, mtime: st.mtimeMs })
    }
  }
  for (const f of folders) walk(f, 0)
  // prefer pinned files, then notes, then recent
  const pinned = new Set(rules.pins.map((p) => p.toLowerCase()))
  const rank = (f) => (pinned.has(f.path.toLowerCase()) ? 3 : 0) + (/\.(md|txt)$/i.test(f.path) ? 1 : 0)
  files.sort((a, b) => rank(b) - rank(a) || b.mtime - a.mtime)
  const manifest = fresh ? {} : readJSON(MANIFEST, {}) // no pages yet: old hashes mean nothing
  for (const f of files) { try { f.hash = sha(fs.readFileSync(f.path)) } catch { f.hash = '' } f.changed = manifest[f.path] !== f.hash }
  return { all: files, pick: files.filter((f) => f.changed).slice(0, limit) }
}

/* step 3: link extraction (rules only) — [[slug]] and markdown links between pages */
export function extractLinks(text) { return [...text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim()) }

// English pages for an English app. Markers ([source: ...], ## Human notes) are parsed in either language.
function promptEn(listFile, mode, existing) {
  const day = new Date().toISOString().slice(0, 10)
  return `You are the wiki writer for CoExplorer, a PC map that a person and Claude Code share. Build an LLM wiki in GBrain format. Write everything in English, even when the sources are in another language. Keep file and folder names exactly as they are.

Sources to read: ${listFile} (one absolute path per line). Read only the files in this list, with Read. Do not read anything else.
Write only to the ${PAGES} folder and ${join(WIKI, 'index.md')}. Never change a source file.
${mode === 'update' ? `This is an update. Only changed sources are in the list. First read the existing pages (${existing.join(', ') || 'none'}), rewrite the compiled truth of the related pages, and add one line to their timeline. Make a new page only when a new topic is needed.` : 'This is the first build. Read the sources, choose 3 to 6 topics, and write one page per topic.'}

Page format (pages/<english-lowercase-slug>.md):
---
title: Topic name in English
type: concept or project
sources:
  - absolute path of a source you actually read
updated: ${day}
---
## Compiled truth
- One fact per line. End each line with the source file name as [source: file name]. With no source, write [source: none].
- Link related topics with [[slug]].

<!-- timeline -->
## Timeline
- **${day}** | ingest — one line on what was read and what was written

## Human notes
(If the page already exists, keep this section as it is. For a new page, leave it empty.)

index.md: list the topic pages as [[slug]] — one-line description.
Rules: do not invent anything that is not in the sources. Never copy passwords, API keys or token values. Never delete or change the "## Human notes" section. Keep each page under 30 lines.`
}

function prompt(listFile, mode, existing, lang) {
  if (lang === 'en') return promptEn(listFile, mode, existing)
  return `너는 CoExplorer의 위키 작성자다. 사람과 Claude Code가 함께 쓰는 PC 지도의 LLM 위키를 GBrain 형식으로 만든다.

읽을 원본 목록: ${listFile} (한 줄에 절대 경로 하나). 이 목록의 파일만 Read로 읽는다. 목록에 없는 파일은 읽지 않는다.
쓰는 곳: ${PAGES} 폴더와 ${join(WIKI, 'index.md')}. 원본 파일은 절대 고치지 않는다.
${mode === 'update' ? `이번은 갱신이다. 바뀐 원본만 목록에 있다. 이미 있는 페이지(${existing.join(', ') || '없음'})를 먼저 읽고, 관련 페이지의 현재 판단을 다시 쓰고 기록에 한 줄을 덧붙인다. 새 주제가 필요할 때만 새 페이지를 만든다.` : '이번은 첫 구축이다. 원본을 읽고 주제 3~6개를 정해 페이지를 만든다.'}

페이지 형식 (pages/<영문-소문자-슬러그>.md):
---
title: 주제 이름(한국어)
type: concept 또는 project
sources:
  - 실제로 읽은 원본의 절대 경로
updated: ${new Date().toISOString().slice(0, 10)}
---
## 현재 판단
- 한 줄에 사실 하나. 줄 끝에 근거 원본 파일 이름을 [출처: 파일이름] 형식으로 붙인다. 근거가 없으면 [출처: 없음].
- 다른 주제와 관련되면 [[슬러그]]로 잇는다.

<!-- timeline -->
## 기록
- **${new Date().toISOString().slice(0, 10)}** | 흡수 — 무엇을 읽고 무엇을 정리했는지 한 줄

## 사람 메모
(이미 있는 페이지라면 이 절을 그대로 둔다. 새 페이지면 비워 둔다.)

index.md: 주제 페이지 목록을 [[슬러그]] — 한 줄 설명 형식으로 쓴다.
규칙: 원본에 없는 내용을 지어내지 않는다. 비밀번호, API 키, 토큰 값은 옮기지 않는다. "## 사람 메모" 절은 지우거나 고치지 않는다. 각 페이지는 30줄 이내로 짧게 쓴다.`
}

let child = null
export function stopIngest() { if (child) { try { process.platform === 'win32' ? spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']) : child.kill() } catch { /* gone */ } child = null } }

export function ingest({ folders, mode = 'first', rules = { hidden: [], pins: [] }, model: forced, lang = 'ko' }, send) {
  if (child) return { ok: false, error: 'busy' }
  fs.mkdirSync(PAGES, { recursive: true })
  const model = forced || (mode === 'first' ? 'sonnet' : 'haiku') // strong model once, cheap model for updates
  const existing = fs.readdirSync(PAGES).filter((f) => f.endsWith('.md'))
  const { all, pick } = scan(folders, rules, mode === 'first' ? 30 : 12, !existing.length)
  const entry = { when: new Date().toISOString(), mode, trigger: mode === 'first' ? 'first' : 'auto', model, folders, scanned: all.length, hashed: all.length, changed: all.filter((f) => f.changed).length, picked: pick.map((f) => f.path), reads: [], writes: [], linksFound: 0, cost: null, tokens: null, ok: false }
  send({ type: 'start', entry })
  if (!pick.length) { entry.ok = true; entry.note = 'nothing changed'; saveLog(entry); send({ type: 'done', entry }); return { ok: true } }
  const listFile = join(WIKI, '.ingest-list.txt')
  fs.writeFileSync(listFile, pick.map((f) => f.path).join('\n'), 'utf8')
  // the prompt goes in on stdin so Windows quoting never mangles it
  const args = ['-p', '--model', model, '--output-format', 'stream-json', '--verbose',
    '--permission-mode', 'acceptEdits', '--add-dir', WIKI, ...folders,
    '--allowedTools', 'Read', 'Glob', 'Grep', 'Write', 'Edit', 'MultiEdit',
    '--disallowedTools', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'NotebookEdit']
  const exe = join(os.homedir(), '.local', 'bin', 'claude.exe')
  child = fs.existsSync(exe)
    ? spawn(exe, args, { cwd: folders[0], windowsHide: true })
    : spawn('claude', args, { cwd: folders[0], shell: true, windowsHide: true })
  child.stdin.end(prompt(listFile, mode, existing, lang), 'utf8')
  child.on('error', (err) => { send({ type: 'log', text: String(err) }) })
  let buf = ''
  const pending = new Map() // tool_use id -> { name, p }
  const timer = setTimeout(stopIngest, 12 * 60 * 1000)
  child.stdout.on('data', (d) => {
    buf += d.toString('utf8')
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      let o; try { o = JSON.parse(line) } catch { continue }
      if (o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
        for (const c of o.message.content) {
          if (c.type !== 'tool_use' || !c.input) continue
          const p = c.input.file_path || c.input.path
          if (!p) continue
          if (c.name === 'Read' && under(p, WIKI)) continue // its own task list and existing pages are not sources
          if (c.name === 'Read' || c.name === 'Write' || c.name === 'Edit' || c.name === 'MultiEdit') pending.set(c.id, { name: c.name, p })
        }
      }
      if (o.type === 'user' && o.message && Array.isArray(o.message.content)) {
        for (const c of o.message.content) {
          if (c.type !== 'tool_result' || !pending.has(c.tool_use_id)) continue
          const { name, p } = pending.get(c.tool_use_id); pending.delete(c.tool_use_id)
          if (c.is_error) { entry.denied = (entry.denied || 0) + 1; continue } // denied or failed: not read
          if (name === 'Read') { if (!entry.reads.includes(p)) entry.reads.push(p); send({ type: 'step', kind: 'read', path: p, n: entry.reads.length, total: pick.length }) }
          else { if (!entry.writes.includes(p)) entry.writes.push(p); send({ type: 'step', kind: 'write', path: p }) }
        }
      }
      if (o.type === 'result') { entry.cost = o.total_cost_usd ?? null; const u = o.usage || {}; entry.tokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0); entry.ok = !o.is_error; entry.result = String(o.result || '').slice(0, 400) }
    }
  })
  child.stderr.on('data', (d) => send({ type: 'log', text: d.toString('utf8').slice(0, 300) }))
  child.on('close', (code) => {
    clearTimeout(timer); child = null
    const wrote = entry.writes.some((w) => under(w, PAGES))
    if (!wrote) { entry.ok = false; entry.note = 'no pages' }
    else {
      const manifest = readJSON(MANIFEST, {})
      for (const f of pick) if (entry.reads.some((r) => r.toLowerCase() === f.path.toLowerCase())) manifest[f.path] = f.hash
      fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1))
      entry.ok = true
    }
    entry.linksFound = listPages().pages.reduce((a, p) => a + p.links.length, 0)
    saveLog(entry)
    send({ type: 'done', entry })
  })
  return { ok: true }
}
function saveLog(entry) { const log = readJSON(LOG, []); log.unshift(entry); fs.writeFileSync(LOG, JSON.stringify(log.slice(0, 50), null, 1)) }

/* a person's memo goes into the page itself, so the next Claude session reads it */
export function setMemo(slug, text) {
  const file = join(PAGES, slug.replace(/[^\w\-가-힣]/g, '') + '.md')
  if (!fs.existsSync(file)) return false
  const src = fs.readFileSync(file, 'utf8')
  const ko = src.lastIndexOf('## 사람 메모'), en = src.lastIndexOf('## Human notes')
  const i = Math.max(ko, en), head = en > ko ? '## Human notes' : '## 사람 메모'
  const next = (i >= 0 ? src.slice(0, i) : src.trimEnd() + '\n\n') + head + '\n' + String(text || '').trim() + '\n'
  fs.writeFileSync(file, next, 'utf8')
  return true
}

/* read pages back for the topic and wiki tabs */
function parsePage(file) {
  const text = fs.readFileSync(file, 'utf8')
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const meta = { title: basename(file, '.md'), type: 'concept', sources: [], updated: '' }
  if (fm) {
    let cur = null
    for (const line of fm[1].split(/\r?\n/)) {
      const kv = line.match(/^(\w+):\s*(.*)$/)
      if (kv) { cur = kv[1]; if (kv[2]) meta[cur] = kv[2].trim().replace(/^["']|["']$/g, ''); else meta[cur] = [] }
      else { const li = line.match(/^\s*-\s+(.*)$/); if (li && cur && Array.isArray(meta[cur])) meta[cur].push(li[1].trim().replace(/^["']|["']$/g, '')) }
    }
  }
  const body = fm ? text.slice(fm[0].length) : text
  const [truthPart, rest = ''] = body.split('<!-- timeline -->')
  const memoM = rest.match(/## (?:사람 메모|Human notes)/)
  const memoIdx = memoM ? memoM.index : -1
  const timelinePart = memoIdx >= 0 ? rest.slice(0, memoIdx) : rest
  const memo = memoIdx >= 0 ? rest.slice(memoIdx + memoM[0].length).trim() : ''
  const claims = truthPart.split(/\r?\n/).filter((l) => /^\s*[-*]\s+/.test(l)).map((l) => {
    const s = l.replace(/^\s*[-*]\s+/, '')
    const srcs = [...s.matchAll(/\[(?:출처|source):\s*([^\]]+)\]/gi)].map((m) => m[1].trim()).filter((x) => x !== '없음' && x.toLowerCase() !== 'none')
    return { text: s.replace(/\[(?:출처|source):[^\]]+\]/gi, '').trim(), src: srcs }
  })
  const timeline = timelinePart.split(/\r?\n/).filter((l) => /^\s*-\s+/.test(l)).map((l) => l.replace(/^\s*-\s+/, '').replace(/\*\*/g, ''))
  let mtime = 0; try { mtime = fs.statSync(file).mtimeMs } catch { /* */ }
  return { slug: basename(file, '.md'), file, ...meta, sources: Array.isArray(meta.sources) ? meta.sources : [meta.sources], claims, timeline, memo, links: extractLinks(body), mtime }
}
export function listPages() {
  let pages = []
  try { pages = fs.readdirSync(PAGES).filter((f) => f.endsWith('.md')).map((f) => parsePage(join(PAGES, f))) } catch { /* no wiki yet */ }
  // health check: stale = a source changed after the page; broken = [[link]] to no page
  const slugs = new Set(pages.map((p) => p.slug.toLowerCase()))
  for (const p of pages) {
    p.stale = p.sources.filter((s) => { try { return fs.statSync(s).mtimeMs > p.mtime } catch { return false } })
    p.broken = p.links.filter((l) => !slugs.has(l.toLowerCase()))
  }
  const linked = new Set(pages.flatMap((p) => p.links.map((l) => l.toLowerCase())))
  let index = ''; try { index = fs.readFileSync(join(WIKI, 'index.md'), 'utf8') } catch { /* */ }
  for (const l of extractLinks(index)) linked.add(l.toLowerCase())
  for (const p of pages) p.orphan = !linked.has(p.slug.toLowerCase())
  return { dir: WIKI, pages, log: readJSON(LOG, []), running: !!child }
}
