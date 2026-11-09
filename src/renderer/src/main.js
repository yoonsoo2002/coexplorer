// CoExplorer renderer: whiteboard map of real folders + live Claude Code session activity.
import './style.css'
import { I } from './i18n.js'
import { initDemo } from './demo.js'

const api = window.api
const $ = (id) => document.getElementById(id)
let L = 'ko'
const t = (k, ...a) => { const v = I[L][k]; return typeof v === 'function' ? v(...a) : v ?? k }

/* ---------------- paths ---------------- */
const norm = (p) => (p || '').replace(/\//g, '\\').replace(/(.)\\+$/, '$1')
const K = (p) => norm(p).toLowerCase()
const base = (p) => { const n = norm(p); const i = n.lastIndexOf('\\'); return i < 0 ? n : n.slice(i + 1) || n }
const parentOf = (p) => { const n = norm(p); const i = n.lastIndexOf('\\'); if (i < 0) return ''; if (i === 2 && n[1] === ':') return n.length > 3 ? n.slice(0, 3) : ''; return n.slice(0, i) }
const under = (p, dir) => { const a = K(p), b = K(dir); return a === b || a.startsWith(b.endsWith('\\') ? b : b + '\\') }
const extOf = (n) => (n.match(/\.([^.\\]+)$/) || [, ''])[1].toLowerCase()
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const ago = (ms) => t('ago', Math.max(0, Math.round((Date.now() - ms) / 1000)))

/* ---------------- state ---------------- */
// ST is saved to ~/.coexplorer/state.json. R is runtime only.
const ST = { boxes: {}, pins: {}, hidden: {}, locked: {}, links: [], seen: {}, openL: true, openR: true, theme: 'light', lang: 'ko', guideOpen: false, follow: true }
const R = {
  sessions: [], cur: null, offset: 0, events: [], touch: {}, dir: {}, loading: {},
  view: 'map', sel: null, hover: null, reading: null, readingAt: 0, showPath: false, more: {}, fan: {},
  left: 's', pcOpen: {}, roots: [], linkFrom: null, cam: { x: 330, y: 120, z: 0.9 }, raw: false, booted: false,
}
// while the demo tour runs, nothing is saved and live session reading pauses
const DM = { on: false }
let saveTimer = null
const save = () => {
  if (DM.on) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (ST.projects && ST.projects[ST.curProj]) Object.assign(ST.projects[ST.curProj], { boxes: ST.boxes, cam: R.cam })
    api.saveState({ ...ST, cam: R.cam })
  }, 350)
}

/* ---------------- icons ---------------- */
const ICO = {
  folder: '<svg class="i" viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>',
  lock: '<svg class="i" style="width:12px;height:12px" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
  eyeoff: '<svg class="i" style="width:13px;height:13px" viewBox="0 0 24 24"><path d="M3 3l18 18M6.1 6.1A12.4 12.4 0 002 12c1 2.5 5 7 10 7a9.6 9.6 0 004-.9M9.9 5.1A9.8 9.8 0 0112 5c5 0 9 4.5 10 7a12.6 12.6 0 01-3 4"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M9 3h6l-1 6 4 4H6l4-4z"/><path d="M12 13v8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  pinI: '<svg class="i" viewBox="0 0 24 24"><path d="M9 3h6l-1 6 4 4H6l4-4zM12 13v8"/></svg>',
  link: '<svg class="i" viewBox="0 0 24 24"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/></svg>',
  linkS: '<svg class="i" style="width:11px;height:11px" viewBox="0 0 24 24"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/></svg>',
  arrowR: '<svg class="i" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  arrowL: '<svg class="i" viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  read: '<svg class="i" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  stack: '<svg class="i" viewBox="0 0 24 24"><rect x="4" y="7" width="13" height="13" rx="2"/><path d="M8 3h10a2 2 0 012 2v10"/></svg>',
  spark: '<svg class="i" viewBox="0 0 24 24" style="stroke:#fff"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/></svg>',
  sun: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg class="i" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg>',
  panelL: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>',
  panelR: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/></svg>',
}
const fileIc = (name) => `<div class="ic">${esc(extOf(name).slice(0, 4).toUpperCase() || '·')}</div>`

/* ---------------- link types: each one is a behavior Claude follows ---------------- */
const LT = {
  use: { ko: '함께 읽기', en: 'Read together', rule: '한쪽을 읽으면 다른 쪽도 함께 읽을 것', ruleEn: 'When you read one, read the other too', color: 'var(--ink)', dash: '' },
  replace: { ko: '대체', en: 'Replaces', rule: '앞쪽이 뒤쪽을 대체함. 뒤쪽은 건너뛸 것', ruleEn: 'The first replaces the second. Skip the second', color: 'var(--ink)', dash: '6 4' },
  related: { ko: '참고', en: 'Reference', rule: '관련 있음. 참고만 할 것', ruleEn: 'Related. Use for reference only', color: 'var(--ink-2)', dash: '' },
  flow: { ko: '넘김', en: 'Feeds into', rule: '앞쪽의 결과가 뒤쪽의 입력. 이 순서로 찾아갈 것', ruleEn: 'The output of the first feeds the second. Follow this order', color: '#7a5cff', dash: '' },
  basis: { ko: '근거', en: 'Basis', rule: '앞쪽이 판단 기준. 작업 전에 먼저 확인할 것', ruleEn: 'The first is the basis. Check it before you start', color: '#2f6bff', dash: '' },
}
const ltOf = (l) => LT[l.type] || LT.related
const ltName = (l) => ltOf(l)[L]
// the rule as shown on screen; the Korean `rule` is what is stored and sent
const ruleText = (v) => (L === 'en' ? v.ruleEn : v.rule)
const linksOf = (p) => ST.links.filter((l) => K(l.a) === K(p) || K(l.b) === K(p))
const lkh = (p) => `<span class="lkh" data-lkh="${esc(p)}" draggable="false" title="${t('lkhTip')}">${ICO.linkS}</span>`
const linkBadge = (p) => { const n = linksOf(p).length; return n ? `<span class="lk" title="${n}">${ICO.linkS}${n}</span>` : '' }

/* ---------------- data helpers ---------------- */
function ensureDir(path) {
  const k = K(path)
  if (R.dir[k] || R.loading[k]) return
  R.loading[k] = true
  api.list(path).then((res) => {
    R.dir[k] = res; delete R.loading[k]; scheduleRender()
    if (R.left === 'pc') scheduleLeft() // the "This PC" tree was waiting for this folder
    // frame the map once the first folders have real content
    if (R.needFit && ST.boxes[k] && !Object.keys(R.loading).length) { R.needFit = false; setTimeout(fitAll, 60) }
  })
}
function refreshDir(path) { const k = K(path); delete R.dir[k]; ensureDir(path) }
const boxOf = (p) => ST.boxes[K(p)]
const isOpenBox = (p) => { const b = boxOf(p); return b && !b.folded }
/* nearest box (open or folded) that contains this path */
function ownerBox(p) { let x = parentOf(p); while (x) { if (boxOf(x)) return x; x = parentOf(x) } return null }
const hiddenBy = (p) => { let x = norm(p); while (x) { if (ST.hidden[K(x)]) return x; x = parentOf(x) } return null }
const lockedBy = (p) => { let x = norm(p); while (x) { if (ST.locked[K(x)]) return x; x = parentOf(x) } return null }
const isNewUnseen = (p) => { const tc = R.touch[K(p)]; return tc && tc.created && !ST.seen[K(p)] }

// version stacks: files whose names differ only by a version token
// real names seen: _최종, _최종본, (최종), _최종(진), final_final, (1)_(1), _2차수정, -v2, _260130_152542
const S = '(?:^|[_\\-\\s.])', E = '(?=$|[_\\-\\s.(])'
const VTOK = [
  /\(\s*(?:\d+|최종|진|final|수정)\s*\)/gi, /\[\s*\d+\s*\]/g,
  new RegExp(S + '(?:v|ver\\.?|rev\\.?)\\s?\\d+(?:\\.\\d+)*' + E, 'gi'),
  /\d+차\s?수정본?/g, /진짜\s?최종|최최종|최종본?|수정본|초안|복사본|사본|백업/g,
  new RegExp(S + '(?:final|draft|copy|backup|bak|old|edited|revised)(?=$|[_\\-\\s.(\\d])', 'gi'),
  new RegExp(S + '\\d{6}(?:[_\\-]\\d{4,6})?' + E, 'g'), new RegExp(S + '\\d{8}' + E, 'g'), new RegExp(S + '\\d{4}-\\d{2}-\\d{2}' + E, 'g'),
]
const squash = (s) => s.replace(/[_\-\s.]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()
function stemOf(name) {
  const m = name.match(/^(.*?)(\.[^.]+)?$/)
  let st = m[1]
  for (const re of VTOK) st = st.replace(re, '_')
  st = squash(st)
  return st && st !== squash(m[1]) ? st + (m[2] || '').toLowerCase() : null
}
// a file with no version mark joins the stack of its marked siblings (보고서.pptx + 보고서_v2.pptx)
const plainKey = (name) => { const m = name.match(/^(.*?)(\.[^.]+)?$/); return squash(m[1]) + (m[2] || '').toLowerCase() }
const verKey = (name, stems) => stemOf(name) || (stems.has(plainKey(name)) ? plainKey(name) : null)
// folders named v1, v2, v5_비정형, v7_v4비정형 are one line of versions; the highest number goes in front
const VNUM = /(?:^|[_\-\s.])v(?:er\.?)?\s?(\d+)/i
const verNum = (n) => { const m = n.match(VNUM); return m ? +m[1] : -1 }
const dirKey = (name, stems) => { const m = name.match(VNUM); return m ? squash(name.slice(0, m.index)) + '#v' : verKey(name, stems) }
function groupVersions(list, isDir, parent) {
  const stems = new Set(list.map((x) => stemOf(x.name)).filter(Boolean))
  const g = {}
  for (const x of list) { const k = isDir ? dirKey(x.name, stems) : verKey(x.name, stems); if (k) (g[k] = g[k] || []).push(x) }
  return Object.entries(g).filter(([, a]) => a.length >= 2).map(([key, items]) => {
    items.sort((a, b) => (isDir ? verNum(b.name) - verNum(a.name) : 0) || (b.mtime || 0) - (a.mtime || 0))
    return { key: K(parent) + '|' + (isDir ? 'd:' : 'f:') + key, files: items, front: items.find((x) => ST.pins[K(x.path)]) || items[0], dir: isDir }
  })
}
// the stack a file or folder belongs to, if any
function verGroupOf(p) {
  const d = R.dir[K(parentOf(p))]; if (!d || d.error) return null
  const isDir = d.dirs.some((x) => K(x.path) === K(p))
  return groupVersions(isDir ? d.dirs : d.files, isDir, d.path).find((g) => g.files.some((x) => K(x.path) === K(p))) || null
}

/* ---------------- session reading ---------------- */
function applyEvents(evs, live) {
  for (const e of evs) {
    R.events.push(e)
    const k = K(e.path)
    const tc = R.touch[k] || (R.touch[k] = { path: e.path, read: 0, write: 0, edit: 0, search: 0, created: false, first: e.kind, last: 0 })
    tc[e.kind] = (tc[e.kind] || 0) + 1
    if (tc.first === 'write' && e.kind === 'write') tc.created = true
    tc.last = e.at
    if (live && (e.kind === 'write' || e.kind === 'edit')) refreshDir(parentOf(e.path))
  }
  if (live && evs.length) { R.reading = evs[evs.length - 1].path; R.readingAt = Date.now() }
}
async function openSession(s) {
  R.cur = s; R.offset = 0; R.events = []; R.touch = {}; R.reading = null
  // read the whole log first (in chunks), then follow it live
  for (let i = 0; i < 50; i++) {
    const res = await api.readSession(s.file, R.offset)
    applyEvents(res.events, false)
    if (res.next === R.offset) break
    R.offset = res.next
  }
  R.needFit = true
  renderAll()
  requestAnimationFrame(fitAll)
}
async function poll() {
  if (R.cur && !DM.on) {
    const res = await api.readSession(R.cur.file, R.offset)
    if (res.reset) { R.events = []; R.touch = {} }
    // live activity only changes the map, the selection and the feed; leave the panels alone
    if (res.events.length) {
      if (!R.turnSteps) R.turnStart = R.events.length // first step of a new piece of work
      if (R.pathAuto) { R.pathAuto = false; R.showPath = false; renderStatic() }
      applyEvents(res.events, true); R.turnSteps = (R.turnSteps || 0) + res.events.length; scheduleRender(); renderFeed()
    }
    // the turn ended: replay where Claude went, numbered, until new work starts
    if (res.ended && R.turnSteps) {
      const n = R.turnSteps; R.turnSteps = 0
      R.pathAuto = true; startPath()
      const msg = t('pathDone', n); R.prog = { done: true, text: msg }; showToast()
      setTimeout(() => { if (R.prog && R.prog.text === msg) { R.prog = null; showToast() } }, 5000)
    }
    R.offset = res.next
  }
  if (R.reading && Date.now() - R.readingAt > 2600) { R.reading = null; scheduleRender() }
}
/* sessions that belong to the current project (cwd inside its root folder) */
const projRoot = () => (ST.projects && ST.projects[ST.curProj] && ST.projects[ST.curProj].root) || ''
const inProject = (s) => !projRoot() || (s.cwd && under(s.cwd, projRoot()))
async function pollSessions() {
  if (DM.on) return
  R.sessions = await api.sessions()
  const mine = R.sessions.filter(inProject)
  if (ST.follow && mine[0] && (!R.cur || mine[0].file !== R.cur.file)) await openSession(mine[0])
  if (R.left === 's') renderLeft()
}

/* ---------------- boxes ---------------- */
function addTopBox(path, x, y) {
  const k = K(path)
  if (ST.boxes[k]) return
  if (x === undefined) {
    const xs = Object.values(ST.boxes).map((b) => b.x + b.w)
    x = xs.length ? Math.max(...xs) + 50 : 0; y = 0
  }
  ST.boxes[k] = { path: norm(path), x, y, w: 560, folded: false, child: false, spawn: true }
  save()
}
function pullOut(path) {
  const k = K(path)
  if (ST.boxes[k]) {
    for (const kk of Object.keys(ST.boxes)) if (ST.boxes[kk].child && under(ST.boxes[kk].path, path)) delete ST.boxes[kk]
    save(); renderMap(); return
  }
  const pk = ownerBox(path); const pb = pk && boxOf(pk)
  const row = $('world').querySelector(`.frow[data-k="${CSS.escape(k)}"]`)
  const y = row ? wpos(row).y - 20 : pb ? pb.y + 60 : 0
  ST.boxes[k] = { path: norm(path), x: pb ? pb.x + pb.w + 50 : 0, y: Math.round(y), w: 400, folded: false, child: true, spawn: true }
  save(); renderMap()
}

/* ---------------- render: map ---------------- */
const selK = () => (R.sel ? K(R.sel) : '')
function cardHTML(f, surfaced) {
  const k = K(f.path), tc = R.touch[k]
  const day = (ms) => (ms ? new Date(ms).toLocaleDateString(L === 'ko' ? 'ko-KR' : 'en-US', { month: 'short', day: 'numeric' }) : '')
  const sub = surfaced ? esc(parentOf(f.path).split('\\').slice(-2).join(' › ')) : esc(day(f.mtime))
  return `<div class="card${surfaced ? ' sf' : ''}${selK() === k ? ' sel' : ''}" data-k="${esc(k)}" data-p="${esc(f.path)}" data-act="sel">${fileIc(f.name)}<div class="tx"><span class="t">${esc(f.name)}</span><span class="s">${sub}</span></div>${linkBadge(f.path)}${isNewUnseen(f.path) ? '<span class="ydot"></span>' : ''}${ST.pins[k] ? `<span class="pin">${ICO.pin}</span>` : ''}${lkh(f.path)}</div>`
}
function stackHTML(g) {
  const fr = g.front
  if (g.dir) {
    const backsD = g.files.filter((x) => x !== fr)
    return `<div class="stackw dir"><div class="frow bk b2"></div><div class="frow bk b1"></div>${rowHTML(fr, g)}</div><div class="fan${R.fan[g.key] ? ' open' : ''}">${backsD.map((b) => `<div class="frow" data-act="ver" data-p="${esc(b.path)}" data-k="${esc(K(b.path))}"><span class="fi">${ICO.folder}</span><span class="nm">${esc(b.name)}</span><span class="cnt">${t('aPin')} →</span></div>`).join('')}</div>`
  }
  const pinned = !!ST.pins[K(fr.path)]
  const backs = g.files.filter((x) => x !== fr)
  return `<div class="stackw"><div class="card bk b2">${fileIc(fr.name)}</div><div class="card bk b1">${fileIc(fr.name)}</div>
    <div class="card fr${selK() === K(fr.path) ? ' sel' : ''}" data-k="${esc(K(fr.path))}" data-p="${esc(fr.path)}" data-act="stack" data-g="${esc(g.key)}">${fileIc(fr.name)}<div class="tx"><span class="t">${esc(fr.name)}</span><span class="s">${t('versions', g.files.length)}</span></div>${pinned ? `<span class="pin">${ICO.pin}</span>` : `<span class="autot">${t('auto')}</span>`}<span class="count" data-act="fan" data-g="${esc(g.key)}" data-p="${esc(fr.path)}">+${g.files.length - 1}</span>${lkh(fr.path)}${isNewUnseen(fr.path) ? '<span class="ydot" style="position:absolute;bottom:9px;left:34px"></span>' : ''}</div>
  </div><div class="fan${R.fan[g.key] ? ' open' : ''}">${backs.map((b) => `<div class="card" data-act="ver" data-p="${esc(b.path)}" data-k="${esc(K(b.path))}">${fileIc(b.name)}<div class="tx"><span class="t">${esc(b.name)}</span><span class="s">${t('aPin')} →</span></div></div>`).join('')}</div>`
}
function rowHTML(d, g) {
  const k = K(d.path), out = !!ST.boxes[k]
  const newIn = Object.values(R.touch).some((tc) => tc.created && !ST.seen[K(tc.path)] && under(tc.path, d.path))
  const badges = `${ST.locked[k] ? `<span class="bdg">${ICO.lock}${t('locked')}</span>` : ''}${ST.hidden[k] ? `<span class="bdg">${ICO.eyeoff}${t('hidden')}</span>` : ''}${d.system ? `<span class="bdg">${t('system')}</span>` : ''}${newIn && !out ? '<span class="ydot"></span>' : ''}`
  const stk = g ? `<span class="count" data-act="fan" data-g="${esc(g.key)}" data-p="${esc(d.path)}" title="${t('versions', g.files.length)}">+${g.files.length - 1}</span>${ST.pins[k] ? `<span class="pin">${ICO.pin}</span>` : ''}` : ''
  return `<div class="frow${g ? ' fr' : ''}${out ? ' out' : ''}${selK() === k ? ' sel' : ''}${ST.hidden[k] ? ' dimmed' : ''}${d.system ? ' sys' : ''}" data-k="${esc(k)}" data-p="${esc(d.path)}" data-act="sel"${d.system ? '' : ` draggable="true" data-dragpath="${esc(d.path)}"`}><span class="fi">${ICO.folder}</span><span class="nm">${esc(d.name)}</span><span class="cnt">${t('items', d.n)}<span class="badges">${badges}${linkBadge(d.path)}</span></span>${d.system ? '' : `<span class="go" data-act="out" data-p="${esc(d.path)}" title="${t('openOut')}">${out ? '×' : ICO.arrowR}</span>`}${stk}${d.system ? '' : lkh(d.path)}</div>`
}
function surfacedFor(boxPath) {
  const out = [], seen = new Set()
  const lensPage = R.lens && R.wiki.pages.find((x) => x.slug === R.lens)
  const lensPaths = lensPage ? members(lensPage).filter((m) => m.st !== 'removed').map((m) => m.path) : []
  const cands = [...Object.values(R.touch).map((x) => x.path), ...Object.values(ST.pins), ...lensPaths]
  for (const p of cands) {
    const k = K(p); if (seen.has(k)) continue; seen.add(k)
    if (!under(p, boxPath) || K(parentOf(p)) === K(boxPath)) continue
    if (K(ownerBox(p) || '') !== K(boxPath)) continue // a deeper box shows it
    const tc = R.touch[k]
    // surface: pinned, created or edited files, and files read in the latest 40 tool calls
    const recent = tc && R.events.length - R.events.findLastIndex((e) => K(e.path) === k) < 40
    const inLens = lensPaths.some((x) => K(x) === k)
    if (!(ST.pins[k] || inLens || (tc && (tc.write || tc.edit || tc.created)) || (tc && tc.read && recent))) continue
    out.push({ name: base(p), path: p, last: tc ? tc.last : 0 })
  }
  return out.sort((a, b) => b.last - a.last).slice(0, 8)
}
function bodyHTML(b) {
  const d = R.dir[K(b.path)]
  if (!d) { ensureDir(b.path); return `<div class="empty">${t('loading')}</div>` }
  if (d.error) return `<div class="empty">${t('cantOpen')} · ${esc(d.error)}</div>`
  let h = ''
  const sec = (title, items, cls = '') => (items.length ? `<div class="sec ${cls}"><div class="sech">${title}</div><div class="tiles">${items.join('')}</div></div>` : '')
  const sf = surfacedFor(b.path)
  h += sec(t('secNow'), sf.map((f) => cardHTML(f, true)), 'now')
  const dstacks = groupVersions(d.dirs, true, d.path)
  const inD = new Set(dstacks.flatMap((g) => g.files.map((x) => x.path)))
  h += sec(t('secFolders', d.dirs.length), [...d.dirs.filter((x) => !inD.has(x.path)).map((x) => rowHTML(x)), ...dstacks.map(stackHTML)])
  // files: version stacks first, then the important ones, then bundles / more
  const stacks = groupVersions(d.files, false, d.path)
  const inStack = new Set(stacks.flatMap((s) => s.files.map((f) => f.path)))
  const rest = d.files.filter((f) => !inStack.has(f.path))
  const score = (f) => (ST.pins[K(f.path)] ? 4 : 0) + (isNewUnseen(f.path) ? 3 : 0) + (R.touch[K(f.path)] ? 2 : 0)
  rest.sort((a, b2) => score(b2) - score(a) || b2.mtime - a.mtime)
  const shown = rest.slice(0, Math.max(0, 6 - stacks.length))
  h += sec(t('secFiles', d.files.length), [...stacks.map(stackHTML), ...shown.map((f) => cardHTML(f, false))])
  const remain = rest.slice(shown.length)
  const byExt = {}
  for (const f of remain) (byExt[extOf(f.name) || '·'] = byExt[extOf(f.name) || '·'] || []).push(f)
  const bundles = Object.entries(byExt).filter(([, fs]) => fs.length >= 25)
  const bundled = new Set(bundles.flatMap(([, fs]) => fs.map((f) => f.path)))
  h += bundles.map(([e, fs]) => `<div class="bundle"><span class="stk"><i></i><i></i><i></i></span><span>${t('bundle', e, fs.length)}</span><span style="margin-left:auto;font-size:10.5px;color:var(--ink-3)">${t('bundleSub')}</span></div>`).join('')
  const left = remain.filter((f) => !bundled.has(f.path))
  if (left.length) {
    const k = K(b.path)
    h += `<button class="more" data-act="more" data-p="${esc(b.path)}">${R.more[k] ? t('less') : t('more', left.length)}</button>`
    if (R.more[k]) h += `<div class="morelist">${left.slice(0, 60).map((f) => `<span data-act="sel" data-p="${esc(f.path)}" data-k="${esc(K(f.path))}">${esc(f.name)}</span>`).join('')}${left.length > 60 ? `<span>${t('restIn')}</span>` : ''}</div>`
  }
  // far zoom summary
  const nNew = Object.values(R.touch).filter((tc) => tc.created && !ST.seen[K(tc.path)] && under(tc.path, b.path)).length
  const nTouch = Object.values(R.touch).filter((tc) => under(tc.path, b.path)).length
  h += `<div class="bsum"><span>${ICO.folder} ${d.dirs.length}</span><span>${t('items', d.files.length)}</span>${nTouch ? `<span style="color:var(--blue)">${ICO.read} ${nTouch}</span>` : ''}${nNew ? `<span><i class="ydot" style="display:inline-block"></i> ${nNew}</span>` : ''}</div>`
  return h || `<div class="empty">${t('empty')}</div>`
}
function boxHTML(k) {
  const b = ST.boxes[k]
  const d = R.dir[k]
  const meta = d && !d.error ? t('items', d.dirs.length + d.files.length) : ''
  const crumb = b.child ? `<div class="crumb">${esc(parentOf(b.path).split('\\').slice(-3).join(' › '))} ›</div>` : ''
  const newIn = Object.values(R.touch).some((tc) => tc.created && !ST.seen[K(tc.path)] && under(tc.path, b.path))
  const badges = `${linkBadge(b.path)}${ST.locked[k] ? `<span class="bdg">${ICO.lock}${t('locked')}</span>` : ''}${ST.hidden[k] ? `<span class="bdg">${ICO.eyeoff}${t('hidden')}</span>` : ''}${newIn ? '<span class="ydot"></span>' : ''}<span class="x" data-act="close" data-p="${esc(b.path)}" title="${t('close')}">×</span>`
  return `<div class="box${b.spawn ? ' spawn' : ''}${selK() === k ? ' sel' : ''}${ST.hidden[k] ? ' dimmed' : ''}" data-box="${esc(k)}" data-k="${esc(k)}" data-p="${esc(b.path)}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px">
    <div class="bh" data-drag="${esc(k)}"><span class="cv${b.folded ? '' : ' open'}" data-act="fold" data-p="${esc(b.path)}">›</span>${ICO.folder}<span class="nm" title="${esc(b.path)}">${esc(base(b.path))}</span><span class="meta">${meta}</span><span class="badges">${badges}</span></div>
    ${crumb}${b.folded ? '' : `<div class="body">${bodyHTML(b)}</div>`}</div>`
}
function outsideHTML() {
  const files = Object.values(R.touch).filter((tc) => tc.search === 0 || tc.read || tc.write || tc.edit).filter((tc) => !ownerBox(tc.path) && !boxOf(tc.path)).sort((a, b) => b.last - a.last).slice(0, 10)
  if (!files.length) return ''
  const xs = Object.values(ST.boxes).map((b) => b.x + b.w)
  const x = xs.length ? Math.max(...xs) + 60 : 0
  return `<div class="box outside" data-box="__out" style="left:${x}px;top:0;width:380px"><div class="bh"><span class="nm">${t('outside')}</span><span class="meta">${files.length}</span></div><div class="crumb" style="margin-left:12px">${t('outsideSub')}</div><div class="body"><div class="sec"><div class="tiles">${files.map((tc) => cardHTML({ name: base(tc.path), path: tc.path }, true)).join('')}</div></div></div></div>`
}
// "This PC" tree: folder names only, cached per folder
R.tree = {}; const treeLoading = {}
function loadTree(path) {
  const k = K(path); if (R.tree[k] || treeLoading[k]) return
  treeLoading[k] = true
  api.children(path).then((kids) => { R.tree[k] = kids; delete treeLoading[k]; scheduleLeft() })
}
let leftQueued = false
function scheduleLeft() { if (leftQueued) return; leftQueued = true; requestAnimationFrame(() => { leftQueued = false; renderLeft() }) }
let renderQueued = false
function scheduleRender() {
  if (renderQueued) return
  if (drag && drag.moved) { drag.pending = true; return } // no re-render mid-drag
  renderQueued = true
  requestAnimationFrame(() => { renderQueued = false; renderMap(); renderSel() })
}
function renderMap() {
  if (R.view === 'topic') return renderTopicBoard()
  if (R.view !== 'map') return
  const w = $('world')
  $('emptyHint').classList.toggle('show', !Object.keys(ST.boxes).length)
  w.innerHTML = '<svg class="wedges" id="wedges"></svg>' + Object.keys(ST.boxes).map(boxHTML).join('') + outsideHTML()
  for (const k in ST.boxes) delete ST.boxes[k].spawn
  // topic lens: only the topic's files stay bright
  const lp = R.lens && R.wiki.pages.find((x) => x.slug === R.lens)
  w.classList.toggle('lens', !!lp)
  $('linkPill').classList.toggle('show', !!R.linkFrom)
  if (R.linkFrom) $('linkPill').innerHTML = `${ICO.linkS} ${t('linkPick', esc(base(R.linkFrom)))}<button id="linkOff">${t('cancel')}</button>`
  $('lensPill').classList.toggle('show', !!lp)
  if (lp) {
    $('lensPill').innerHTML = `✳ ${t('lensOn', esc(lp.title))}<button id="lensOff">${t('lensOff')}</button>`
    for (const m of members(lp)) if (m.st !== 'removed') { const el = anchorEl(m.path); if (el) { el.classList.add('tp'); el.closest('.box') && el.closest('.box').classList.add('tbox') } }
  }
  for (const [k, at] of Object.entries(R.blocked)) {
    if (Date.now() - at > 8000) { delete R.blocked[k]; continue }
    const el = anchorEl(k); if (el) el.classList.add('blockedfx')
  }
  if (R.reading) {
    const el = anchorEl(R.reading); if (el) el.classList.add('reading')
    let top = parentOf(R.reading); while (top && !boxOf(top)) top = parentOf(top)
    const tb = top ? w.querySelector(`[data-box="${CSS.escape(K(top))}"]`) : w.querySelector('[data-box="__out"]')
    if (tb) tb.classList.add('reading')
  }
  resolveOverlap(); applyCam(); requestAnimationFrame(drawEdges)
}
function anchorEl(p) {
  let x = norm(p)
  while (x) {
    const el = $('world').querySelector(`.body [data-k="${CSS.escape(K(x))}"], [data-box="${CSS.escape(K(x))}"]`)
    if (el && el.getClientRects().length) return el
    x = parentOf(x)
  }
  return $('world').querySelector('[data-box="__out"]')
}
function resolveOverlap() {
  const ks = Object.keys(ST.boxes).sort((a, b) => ST.boxes[a].y - ST.boxes[b].y)
  const el = (k) => $('world').querySelector(`[data-box="${CSS.escape(k)}"]`)
  for (let i = 0; i < ks.length; i++) {
    const a = ST.boxes[ks[i]], ae = el(ks[i]); if (!ae) continue
    for (let j = i + 1; j < ks.length; j++) {
      const b = ST.boxes[ks[j]], be = el(ks[j]); if (!be || b.y < a.y || b.manual) continue // never move a box a person placed
      const xo = a.x < b.x + b.w && b.x < a.x + a.w
      if (xo && b.y < a.y + ae.offsetHeight + 14) { b.y = a.y + ae.offsetHeight + 14; be.style.top = b.y + 'px' }
    }
  }
}

/* ---------------- camera ---------------- */
let zoomLevel = ''
function applyCam() {
  const w = $('world')
  const lvl = R.cam.z < 0.34 ? 'far' : R.cam.z < 0.6 ? 'mid' : ''
  w.style.setProperty('--k', String(Math.min(2.6, Math.max(1, 0.5 / R.cam.z))))
  if (lvl !== zoomLevel) { w.classList.remove('far', 'mid'); if (lvl) w.classList.add(lvl); zoomLevel = lvl; requestAnimationFrame(() => { resolveOverlap(); drawEdges() }) }
  w.style.transform = `translate(${R.cam.x}px,${R.cam.y}px) scale(${R.cam.z})`
  $('zl').textContent = Math.round(R.cam.z * 100) + '%'
  const c = $('canvas'); const bs = 22 * R.cam.z
  c.style.backgroundSize = `${bs}px ${bs}px, 100% 100%, 100% 100%, 100% 100%`
  c.style.backgroundPosition = `${R.cam.x}px ${R.cam.y}px, 0 0, 0 0, 0 0`
}
function zoomAt(f, cx, cy) { const z0 = R.cam.z, z1 = Math.min(1.8, Math.max(0.25, z0 * f)); R.cam.x = cx - (cx - R.cam.x) * (z1 / z0); R.cam.y = cy - (cy - R.cam.y) * (z1 / z0); R.cam.z = z1; applyCam(); drawEdges(); save() }
const viewRect = () => ({ l: ST.openL ? 304 : 56, r: innerWidth - (ST.openR ? 336 : 56), t: 104, b: innerHeight - 56 })
function fitAll() {
  const els = [...$('world').querySelectorAll('.box, .tcl')]; if (!els.length) return
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
  for (const b of els) { x0 = Math.min(x0, b.offsetLeft); y0 = Math.min(y0, b.offsetTop); x1 = Math.max(x1, b.offsetLeft + b.offsetWidth); y1 = Math.max(y1, b.offsetTop + b.offsetHeight) }
  const v = viewRect(); const W = v.r - v.l, H = v.b - v.t
  const z = Math.min(1, Math.max(0.25, Math.min(W / (x1 - x0 + 60), H / (y1 - y0 + 60))))
  R.cam = { z, x: v.l + (W - (x1 - x0) * z) / 2 - x0 * z, y: v.t + (H - (y1 - y0) * z) / 2 - y0 * z }
  applyCam(); drawEdges(); save()
}
function wpos(el) { const wr = $('world').getBoundingClientRect(); const r = el.getBoundingClientRect(); const z = R.cam.z; return { x: (r.left + r.width / 2 - wr.left) / z, y: (r.top + r.height / 2 - wr.top) / z, w: r.width / z, h: r.height / z } }

/* ---------------- lines: only for what you picked or point at ---------------- */
function curveH(p, q) { const dx = Math.max(40, Math.abs(q.x - p.x) / 2); return `M${p.x},${p.y} C${p.x + dx},${p.y} ${q.x - dx},${q.y} ${q.x},${q.y}` }
function label(x, y, text) { const w = text.length * 6.8 + 24; return `<g transform="translate(${x},${y})"><rect x="${-w / 2}" y="-11" width="${w}" height="22" rx="11" style="fill:var(--card);stroke:var(--hair-2)"/><text y="4" text-anchor="middle" font-size="10.5" font-weight="600" style="fill:var(--ink)" font-family="Pretendard Variable,sans-serif">${esc(text)}</text></g>` }
// start (or replay) the path animation: line draws, a dot travels, cards light up in order
function startPath() {
  R.showPath = true
  const svg = $('wedges'); R.pathT0 = svg && svg.getCurrentTime ? svg.getCurrentTime() + 0.05 : 0
  renderStatic(); drawEdges()
  clearTimeout(R.pathTimer); (R.pathHits || []).forEach(clearTimeout)
  const plan = R.pathPlan; if (!plan) return
  R.pathHits = plan.trail.map((p, i) => setTimeout(() => { const el = anchorEl(p); if (el) { el.classList.remove('pathhit'); void el.offsetWidth; el.classList.add('pathhit'); setTimeout(() => el.classList.remove('pathhit'), 900) } }, (0.05 + plan.frac[i] * plan.dur) * 1000))
}
function drawEdges() {
  const svg = $('wedges'); if (!svg) return
  let h = '<defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9" fill="none" style="stroke:var(--ink)" stroke-width="1.6"/></marker></defs>'
  const focus = [R.sel, R.hover].filter(Boolean).map(K)
  const near = (p) => focus.includes(K(p))
  for (const b of Object.values(ST.boxes)) {
    if (!b.child || !near(b.path)) continue
    const row = $('world').querySelector(`.frow[data-k="${CSS.escape(K(b.path))}"]`); const bx = $('world').querySelector(`[data-box="${CSS.escape(K(b.path))}"]`)
    if (!row || !bx) continue
    const a = wpos(row), c = wpos(bx)
    const p = { x: a.x + a.w / 2, y: a.y }, q = { x: c.x - c.w / 2, y: c.y - c.h / 2 + 20 }
    h += `<path d="${curveH(p, q)}" fill="none" style="stroke:var(--ink-3)" stroke-opacity=".7" stroke-width="1.2"/><circle cx="${q.x}" cy="${q.y}" r="3" style="fill:var(--ink-3)"/>`
  }
  // links: the picked item's links, or all of them when "show links" is on
  for (const l of ST.links) {
    if (!R.showLinks && !near(l.a) && !near(l.b)) continue
    const ea = anchorEl(l.a), eb = anchorEl(l.b); if (!ea || !eb || ea === eb) continue
    const a = wpos(ea), b = wpos(eb); const right = b.x >= a.x
    const p = { x: a.x + (right ? a.w / 2 : -a.w / 2), y: a.y }, q = { x: b.x + (right ? -b.w / 2 : b.w / 2), y: b.y }
    const lt = ltOf(l)
    h += `<path d="${curveH(p, q)}" fill="none" style="stroke:${lt.color}" stroke-width="1.7" ${lt.dash ? `stroke-dasharray="${lt.dash}"` : ''} marker-end="url(#arr)"/>` + label((p.x + q.x) / 2, (p.y + q.y) / 2, ltName(l))
  }
  if (R.linkDrag && R.linkDrag.moved) {
    const el = anchorEl(R.linkDrag.from)
    if (el) { const a = wpos(el); h += `<path d="${curveH({ x: a.x + a.w / 2, y: a.y }, { x: R.linkDrag.x, y: R.linkDrag.y })}" fill="none" style="stroke:var(--blue)" stroke-width="2" stroke-dasharray="6 4"/><circle cx="${R.linkDrag.x}" cy="${R.linkDrag.y}" r="4" style="fill:var(--blue)"/>` }
  }
  if (R.showPath) {
    const trail = []
    const from = R.pathAuto ? R.turnStart || 0 : 0
    for (let i = R.events.length - 1; i >= from && trail.length < 12; i--) { const p = R.events[i].path; if (R.events[i].kind !== 'search' && (!trail.length || K(trail[0]) !== K(p))) trail.unshift(p) }
    const pts = trail.map((p) => { const el = anchorEl(p); return el ? wpos(el) : null }).filter(Boolean)
    if (pts.length > 1) {
      const d = pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ')
      // where along the line each step sits (0..1), so the numbers pop exactly when the line reaches them
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
      const total = cum[cum.length - 1] || 1, frac = cum.map((c) => c / total)
      const dur = Math.max(1.4, Math.min(6, 0.5 * pts.length))
      const t0 = R.pathT0 != null ? R.pathT0 : -100 // svg clock time the replay started; -100 = already finished
      R.pathPlan = { frac, dur, trail }
      h += `<path d="${d}" pathLength="1000" fill="none" style="stroke:var(--blue)" stroke-opacity=".75" stroke-width="2.2" stroke-linejoin="round" stroke-dasharray="1000" stroke-dashoffset="1000"><animate attributeName="stroke-dashoffset" from="1000" to="0" begin="${t0}s" dur="${dur}s" fill="freeze"/></path>`
      h += `<circle r="7" style="fill:var(--blue)" opacity="0"><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.05;.9;1" begin="${t0}s" dur="${dur}s" fill="freeze"/><animateMotion path="${d}" begin="${t0}s" dur="${dur}s" fill="freeze"/></circle>`
      pts.forEach((p, i) => {
        const b = t0 + frac[i] * dur
        h += `<g transform="translate(${p.x},${p.y})" opacity="0"><animate attributeName="opacity" from="0" to="1" begin="${b}s" dur=".25s" fill="freeze"/><circle r="11" fill="#101217" stroke="#fff" stroke-width="1.5"><animate attributeName="r" values="4;15;11" begin="${b}s" dur=".4s" fill="freeze"/></circle><text y="3.8" text-anchor="middle" font-size="10.5" font-weight="700" fill="#fff" font-family="Pretendard Variable,sans-serif">${i + 1}</text></g>`
      })
    }
  }
  svg.innerHTML = h
}

/* ---------------- right panels ---------------- */
function relations(p, isDir) {
  const out = []
  const par = parentOf(p)
  if (par) out.push({ ic: ICO.folder, k: t('rLoc'), v: t('rIn', `<b>${esc(base(par))}</b>`), go: par })
  if (isDir) { const d = R.dir[K(p)]; if (d && !d.error) out.push({ ic: ICO.folder, k: t('rHold'), v: t('rHoldX', d.dirs.length, d.files.length) }) }
  const tc = R.touch[K(p)]
  if (tc && (tc.read || tc.write || tc.edit)) out.push({ ic: ICO.read, cls: 'b', k: t('rAct'), v: t('rActX', tc.read, tc.created ? 1 : 0, tc.edit) })
  const vg = verGroupOf(p)
  if (vg) out.push({ ic: ICO.stack, k: t('rVer'), v: t('rVerX', vg.files.length, !!ST.pins[K(p)]) + ' · ' + t('rVerFront', base(vg.front.path)) })
  ST.links.forEach((l, i) => {
    if (K(l.a) === K(p)) out.push({ ic: ICO.arrowR, k: t('rOut'), v: `<b>${esc(base(l.b))}</b> · <span class="ltag" data-editlink="${i}">${ltName(l)}</span>`, go: l.b, rm: i })
    if (K(l.b) === K(p)) out.push({ ic: ICO.arrowL, k: t('rInL'), v: `<b>${esc(base(l.a))}</b> · <span class="ltag" data-editlink="${i}">${ltName(l)}</span>`, go: l.a, rm: i })
  })
  const hb = hiddenBy(p), lb = lockedBy(p)
  if (hb && K(hb) !== K(p)) out.push({ ic: ICO.eyeoff, k: t('rRule'), v: t('rHidFrom', `<b>${esc(base(hb))}</b>`), go: hb })
  if (lb && K(lb) !== K(p)) out.push({ ic: ICO.lock, k: t('rRule'), v: t('rLockFrom', `<b>${esc(base(lb))}</b>`), go: lb })
  return out
}
function isDirPath(p) { const k = K(p); if (ST.boxes[k] || R.dir[k]) return true; const d = R.dir[K(parentOf(p))]; return !!(d && d.dirs.some((x) => K(x.path) === k)) }
function renderSel() {
  const box = $('selBox')
  if (!R.sel) { box.innerHTML = `<p class="hint" style="margin:0">${t('nothing')}</p>`; document.querySelectorAll('.act').forEach((b) => b.classList.add('off')); $('revealBtn').style.display = 'none'; $('selHint').textContent = ''; return }
  const p = R.sel, isDir = isDirPath(p)
  const rel = relations(p, isDir)
  box.innerHTML = `<div class="selhead"><div class="tile">${isDir ? ICO.folder : esc(extOf(p).slice(0, 4).toUpperCase())}</div><div style="min-width:0"><div class="n">${esc(base(p))}</div><div class="p">${esc(p)}</div></div></div>
    <ul class="rels">${rel.map((r, i) => `<li class="rel${r.go ? ' go' : ''}" data-ri="${i}"><span class="ri ${r.cls || ''}">${r.ic}</span><span><span class="rk">${r.k}</span>${r.v}</span>${r.rm !== undefined ? `<button class="relx" data-rmlink="${r.rm}" title="×">×</button>` : ''}</li>`).join('')}</ul>
    ${R.editLink != null && ST.links[R.editLink] ? `<div class="ledit"><div class="rk">${t('linkKind')} · ${esc(base(ST.links[R.editLink].a))} → ${esc(base(ST.links[R.editLink].b))}</div><div class="ltypes">${Object.entries(LT).map(([k, v]) => `<button class="${ST.links[R.editLink].type === k ? 'on' : ''}" data-ltype="${k}" title="${esc(ruleText(v))}"><i style="background:${v.color}"></i>${v[L]}</button>`).join('')}</div><div class="hint" style="margin:6px 0 0">${esc(ruleText(ltOf(ST.links[R.editLink])))}</div></div>` : ''}`
  box.onclick = (e) => {
    const rm = e.target.closest('[data-rmlink]')
    if (rm) { ST.links.splice(+rm.dataset.rmlink, 1); R.editLink = null; save(); return renderAll() }
    const ed = e.target.closest('[data-editlink]')
    if (ed) { R.editLink = +ed.dataset.editlink; return renderSel() }
    const ty = e.target.closest('[data-ltype]')
    if (ty && ST.links[R.editLink]) { const l = ST.links[R.editLink]; l.type = ty.dataset.ltype; l.rule = LT[l.type].rule; save(); renderSel(); renderGuide(); return drawEdges() }
    const li = e.target.closest('[data-ri]'); if (li && rel[+li.dataset.ri].go) { R.sel = rel[+li.dataset.ri].go; R.editLink = null; renderAll() }
  }
  const k = K(p)
  document.querySelectorAll('.act').forEach((b) => {
    const a = b.dataset.a
    b.classList.toggle('off', isDir ? a === 'pin' : a === 'hide' || a === 'lock') // folders can be linked too
    b.classList.toggle('on', (a === 'pin' && !!ST.pins[k]) || (a === 'hide' && !!ST.hidden[k]) || (a === 'lock' && !!ST.locked[k]) || (a === 'link' && R.linkFrom && K(R.linkFrom) === k))
  })
  $('revealBtn').style.display = ''
  $('selHint').textContent = R.linkFrom ? t('hintLink') : isDir ? t('hintFolder') : t('hintFile')
}
function buildRules() {
  const r = []
  for (const k of Object.keys(ST.hidden)) if (ST.hidden[k]) r.push({ ico: ICO.eyeoff, lab: t('rHide'), nm: ST.hidden[k], x: t('rHideX'), raw: (L === 'en' ? 'Hidden (never open or search): ' : '숨김 (열거나 검색하지 말 것): ') + ST.hidden[k] })
  for (const k of Object.keys(ST.locked)) if (ST.locked[k]) r.push({ ico: ICO.lock, lab: t('rLock'), nm: ST.locked[k], x: t('rLockX'), raw: (L === 'en' ? 'Locked (read only, never edit): ' : '잠금 (읽기만, 고치지 말 것): ') + ST.locked[k] })
  for (const k of Object.keys(ST.pins)) if (ST.pins[k]) r.push({ ico: ICO.pinI, lab: t('rPin'), nm: ST.pins[k], x: t('rPinX'), raw: (L === 'en' ? 'Pinned (the reference; skip other versions): ' : '고정 (기준 파일, 다른 버전은 건너뛸 것): ') + ST.pins[k] })
  for (const l of ST.links) r.push({ ico: ICO.link, lab: `${t('rLink')} · ${ltName(l)}`, nm: `${base(l.a)} → ${base(l.b)}`, x: ruleText(ltOf(l)), raw: `${L === 'en' ? 'Link' : '연결'}: ${l.a} → ${l.b} (${ruleText(ltOf(l))})` })
  return r
}
let lastRaw = ''
function renderGuide() {
  const r = buildRules(), sum = $('guideSum')
  sum.textContent = t('rules', r.length)
  $('guide').classList.toggle('open', ST.guideOpen); $('guideCv').classList.toggle('open', ST.guideOpen)
  $('rules').innerHTML = r.length ? r.map((x) => `<li class="rule"><span class="ri">${x.ico}</span><span class="rt"><b>${x.lab}</b> · <span class="rn">${esc(base(x.nm))}</span><span class="rx">${x.x}</span></span></li>`).join('') : `<li class="hint">${t('noRules')}</li>`
  const raw = ['[CoExplorer]', ...r.map((x) => x.raw)].join('\n')
  $('raw').textContent = raw; $('raw').classList.toggle('show', R.raw); $('rawLbl').textContent = R.raw ? t('rawHide') : t('rawShow')
  if (lastRaw && lastRaw !== raw) { sum.classList.add('pulse'); setTimeout(() => sum.classList.remove('pulse'), 350) }
  lastRaw = raw
}
function renderFeed() {
  $('feed').innerHTML = R.events.slice(-40).reverse().map((e) => `<li data-p="${esc(e.path)}"><span class="tool ${e.kind === 'write' ? 'w' : e.kind === 'edit' ? 'e' : e.kind === 'blocked' ? 'x' : ''}" title="${esc(e.reason || '')}">${e.kind === 'blocked' ? t('blockedTag') : e.tool}</span><span class="nm">${esc(base(e.path))}</span><span class="at">${ago(e.at)}</span></li>`).join('')
  const main = R.events.filter((e) => e.agent === 'main').length, sub = R.events.length - main
  $('agents').innerHTML = `<li class="row agent"><span class="dot" style="background:var(--blue)"></span><div class="tx"><span class="t">Claude · ${t('mainAgent')}</span><span class="s">${t('events', main)}</span></div></li>` + (sub ? `<li class="row agent"><span class="dot" style="background:#14b8a6"></span><div class="tx"><span class="t">${t('subAgent')}</span><span class="s">${t('events', sub)}</span></div></li>` : '')
}

/* ---------------- left ---------------- */
async function renderLeft() {
  document.querySelectorAll('#leftSeg button').forEach((b) => b.classList.toggle('on', b.dataset.k === R.left))
  $('segDesc').textContent = R.left === 's' ? t('descS') : t('descPC')
  $('followRow').style.display = R.left === 's' ? '' : 'none'
  $('followCb').checked = ST.follow
  const list = $('leftList')
  $('allRow').style.display = R.left === 's' && projRoot() ? '' : 'none'
  if (R.left === 's') {
    list.className = 'rows'
    const shown = R.showAll ? R.sessions : R.sessions.filter(inProject)
    if (!shown.length && projRoot()) { list.innerHTML = `<li class="hint">${t('waitFirst')}</li>`; return }
    list.innerHTML = shown.length ? shown.map((s) => `<li class="row${R.cur && R.cur.file === s.file ? ' on' : ''}" data-sf="${esc(s.file)}"><div class="tile">✳</div><div class="tx"><span class="t">${esc(s.title)}</span><span class="s">${esc(base(s.cwd || ''))} · ${ago(s.mtime)}</span></div>${Date.now() - s.mtime < 90000 ? '<span class="pill live">live</span>' : ''}</li>`).join('') : `<li class="hint">${t('noSession')}</li>`
  } else {
    list.className = 'rows tree'
    const rows = []
    const walk = (path, name, depth, sys) => {
      const k = K(path), open = R.pcOpen[k], onMap = !!ST.boxes[k]
      rows.push(`<li class="row${sys ? ' blocked' : ''}" style="padding-left:${6 + depth * 14}px" data-pc="${esc(path)}"${sys ? '' : ` draggable="true" data-dragpath="${esc(path)}"`}><span class="chev">${sys ? '' : open ? '▾' : '▸'}</span>${ICO.folder}<div class="tx"><span class="t">${esc(name)}</span></div>${sys ? `<span class="pill">${t('pcBlock')}</span>` : onMap ? `<span class="pill live">${t('pcOn')}</span>` : `<span class="pill add" data-pcadd="${esc(path)}">${t('pcAdd')}</span>`}</li>`)
      if (open && !sys) {
        const kids = R.tree[k]
        if (!kids) { loadTree(path); rows.push(`<li class="hint" style="padding-left:${26 + depth * 14}px">${t('loading')}</li>`) }
        else if (!kids.length) rows.push(`<li class="hint" style="padding-left:${26 + depth * 14}px">${t('empty')}</li>`)
        else for (const c of kids) walk(c.path, c.name, depth + 1, c.system)
      }
    }
    for (const r of R.roots) walk(r.path, I[L].roots[r.key] || base(r.path), 0, false)
    list.innerHTML = rows.join('')
  }
}

/* ---------------- chrome ---------------- */
function layoutChrome() {
  $('leftSide').classList.toggle('closed', !ST.openL); $('rightSide').classList.toggle('closed', !ST.openR)
  $('dockL').classList.toggle('closed', !ST.openL); $('dockR').classList.toggle('closed', !ST.openR)
  $('topbar').style.left = (ST.openL ? 342 : 54) + 'px'; $('topbar').style.right = (ST.openR ? 374 : 54) + 'px'
  $('legend').style.left = (ST.openL ? 304 : 12) + 'px'; $('zoomBox').style.right = (ST.openR ? 336 : 12) + 'px'
  $('demoBtn').style.right = (ST.openR ? 336 : 12) + 40 + 'px'
  $('dockL').innerHTML = ICO.panelL; $('dockR').innerHTML = ICO.panelR
}
function renderStatic() {
  document.documentElement.lang = L
  renderConn(); if (ST.projects) renderProjects()
  document.querySelectorAll('[data-t]').forEach((e) => { e.textContent = t(e.dataset.t) })
  document.querySelectorAll('#langSeg button').forEach((b) => b.classList.toggle('on', b.dataset.l === L))
  $('themeBtn').innerHTML = ST.theme === 'light' ? ICO.moon : ICO.sun
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === R.view))
  $('projName').textContent = R.cur ? R.cur.title : '—'
  $('projPath').textContent = R.cur ? R.cur.cwd : ''
  $('winsub').textContent = R.cur ? `— ${R.cur.title} · ${base(R.cur.cwd || '')}` : ''
  $('pathBtn').classList.toggle('on', R.showPath)
  $('linksBtn').classList.toggle('on', !!R.showLinks)
  $('legend').innerHTML = `<span><i class="lg-g"></i>${t('lgRead')}</span><span><i class="lg-y"></i>${t('lgNew')}</span><span><i class="lg-h"></i>${t('lgHuman')}</span><span><i class="lg-o"></i>${t('lgOut')}</span>${ST.links.length ? Object.values(LT).map((x) => `<span><i class="lg-t" style="border-top:2px ${x.dash ? 'dashed' : 'solid'} ${x.color}"></i>${x[L]}</span>`).join('') : ''}`
  // topics live on the whiteboard; the wiki is a reading view; both need a built wiki
  const noWiki = R.view !== 'map' && !R.wiki.pages.length
  const wikiView = R.view === 'wiki' && !noWiki
  $('soon').classList.toggle('show', noWiki)
  $('wikiv').classList.toggle('show', wikiView)
  $('canvas').style.visibility = noWiki || wikiView ? 'hidden' : ''
  $('legend').style.display = R.view === 'map' ? '' : 'none'
  $('zoomBox').style.display = noWiki || wikiView ? 'none' : ''
  $('emptyHint').style.display = R.view === 'map' ? '' : 'none'
  $('wikiv').style.left = (ST.openL ? 304 : 54) + 'px'; $('wikiv').style.right = (ST.openR ? 336 : 54) + 'px'
  if (noWiki) {
    $('soonOrb').innerHTML = ICO.spark
    $('soonT').textContent = t(R.view === 'topic' ? 'topicSoon' : 'wikiSoon')
    $('soonX').textContent = t('noWikiX')
    $('soonBtn').textContent = R.wiki.running ? t('building') : t('buildWiki')
    $('soonBtn').disabled = R.wiki.running || !Object.keys(ST.boxes).length
  }
}
function renderAll() { renderStatic(); layoutChrome(); renderLeft(); renderMap(); if (R.view === 'wiki') renderWiki(); renderSel(); renderGuide(); renderFeed() }

/* ---------------- events ---------------- */
function select(p) {
  // finishing a link: files and folders both work; folder pairs default to "feeds into"
  if (R.linkFrom && K(p) !== K(R.linkFrom)) {
    const type = isDirPath(p) && isDirPath(R.linkFrom) ? 'flow' : 'use'
    ST.links.push({ a: R.linkFrom, b: norm(p), type, rule: LT[type].rule })
    R.editLink = ST.links.length - 1; R.linkFrom = null; ST.openR = true; save() // the type picker lives in the right panel
    R.sel = norm(p); return renderAll()
  }
  R.editLink = null
  R.sel = norm(p)
  if (isNewUnseen(p)) { ST.seen[K(p)] = true; save() }
  renderAll()
}
const world = $('world'), canvas = $('canvas')
let swallowClick = false
world.addEventListener('click', (e) => {
  if (swallowClick) { e.stopPropagation(); return }
  const a = e.target.closest('[data-act]'); if (!a) return
  e.stopPropagation()
  const p = a.dataset.p, act = a.dataset.act
  if (act === 'out') return pullOut(p)
  if (act === 'close') { const k = K(p); if (ST.boxes[k] && ST.boxes[k].child) return pullOut(p); delete ST.boxes[k]; save(); return renderMap() }
  if (act === 'fold') { const b = boxOf(p); b.folded = !b.folded; save(); return renderMap() }
  if (act === 'more') { R.more[K(p)] = !R.more[K(p)]; return renderMap() }
  if (act === 'fan') { R.fan[a.dataset.g] = !R.fan[a.dataset.g]; return renderMap() }
  if (act === 'stack') { const g = a.dataset.g; if (R.sel && K(R.sel) === K(p)) R.fan[g] = !R.fan[g]; return select(p) }
  if (act === 'ver') { // pin this version: it moves to the front of its stack
    const vg = verGroupOf(p)
    if (vg) for (const x of vg.files) delete ST.pins[K(x.path)]
    ST.pins[K(p)] = norm(p); R.fan = {}; save(); return select(p)
  }
  if (act === 'sel') return select(p)
})
world.addEventListener('dblclick', (e) => { const r = e.target.closest('.frow'); if (r && !r.classList.contains('sys')) pullOut(r.dataset.p) })
let hoverRaf = 0
world.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-p]'); const p = el ? el.dataset.p : null
  if (p === R.hover) return
  R.hover = p; cancelAnimationFrame(hoverRaf); hoverRaf = requestAnimationFrame(drawEdges)
})
let drag = null
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  const lh = e.target.closest('[data-lkh]')
  if (lh) { e.preventDefault(); e.stopPropagation(); drag = { kind: 'link', from: lh.dataset.lkh, sx: e.clientX, sy: e.clientY, moved: false }; R.linkDrag = drag; return }
  const h = e.target.closest('[data-drag]')
  if (h && !e.target.closest('[data-act]')) { const k = h.dataset.drag; drag = { kind: 'box', k, sx: e.clientX, sy: e.clientY, ox: ST.boxes[k].x, oy: ST.boxes[k].y, moved: false, el: h.closest('.box') }; return }
  if (e.target.closest('.box, .tcl')) return
  drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: R.cam.x, oy: R.cam.y, moved: false }
})
addEventListener('pointermove', (e) => {
  if (!drag) return
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
  if (!drag.moved) return
  if (drag.kind === 'link') {
    drag.x = (e.clientX - R.cam.x) / R.cam.z; drag.y = (e.clientY - R.cam.y) / R.cam.z
    const over = document.elementFromPoint(e.clientX, e.clientY); const tg = over && over.closest('#world [data-p]')
    world.querySelectorAll('.lktarget').forEach((x) => x.classList.remove('lktarget'))
    if (tg && K(tg.dataset.p) !== K(drag.from)) tg.classList.add('lktarget')
    return drawEdges()
  }
  if (drag.kind === 'pan') { canvas.classList.add('panning'); R.cam.x = drag.ox + dx; R.cam.y = drag.oy + dy; applyCam() }
  else {
    const el = $('world').querySelector(`[data-box="${CSS.escape(drag.k)}"]`) || drag.el
    drag.el = el; el.classList.add('dragging')
    const b = ST.boxes[drag.k]; b.x = drag.ox + dx / R.cam.z; b.y = drag.oy + dy / R.cam.z; b.manual = true
    el.style.left = b.x + 'px'; el.style.top = b.y + 'px'; drawEdges()
  }
})
addEventListener('pointerup', (e) => {
  if (!drag) return
  canvas.classList.remove('panning')
  const d = drag; drag = null
  if (d.kind === 'link') {
    R.linkDrag = null; world.querySelectorAll('.lktarget').forEach((x) => x.classList.remove('lktarget'))
    swallowClick = true; setTimeout(() => { swallowClick = false }, 0)
    const over = document.elementFromPoint(e.clientX, e.clientY); const tg = over && over.closest('#world [data-p]')
    if (d.moved && tg && K(tg.dataset.p) !== K(d.from)) { R.linkFrom = d.from; select(tg.dataset.p) } // dropped on another card: link made
    else if (!d.moved) { R.sel = norm(d.from); R.linkFrom = d.from; renderAll() } // clicked: pick the target next
    else drawEdges()
    return
  }
  if (d.kind === 'box') { d.el.classList.remove('dragging'); if (!d.moved) select(ST.boxes[d.k].path) }
  else if (!d.moved && Object.values(R.fan).some(Boolean)) { R.fan = {}; renderMap() }
  if (d.moved) save()
  if (d.pending) scheduleRender() // catch up on what arrived during the drag
  drawEdges()
})
// zoom follows how far the wheel moved, so trackpads and mice both feel gentle
canvas.addEventListener('wheel', (e) => {
  e.preventDefault()
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY // lines -> pixels
  const f = Math.exp(-Math.max(-60, Math.min(60, dy)) * 0.0012)
  zoomAt(f, e.clientX, e.clientY)
}, { passive: false })
$('zin').onclick = () => { const v = viewRect(); zoomAt(1.15, (v.l + v.r) / 2, (v.t + v.b) / 2) }
$('zout').onclick = () => { const v = viewRect(); zoomAt(1 / 1.15, (v.l + v.r) / 2, (v.t + v.b) / 2) }
$('fitBtn').onclick = fitAll
$('linksBtn').onclick = () => { R.showLinks = !R.showLinks; renderStatic(); drawEdges() }
$('pathBtn').onclick = () => { R.pathAuto = false; if (!R.showPath) return startPath(); R.showPath = false; renderStatic(); drawEdges() }
document.querySelectorAll('.act').forEach((b) => b.addEventListener('click', () => {
  if (!R.sel) return
  const a = b.dataset.a, p = R.sel, k = K(p)
  if (a === 'pin') { if (ST.pins[k]) delete ST.pins[k]; else ST.pins[k] = p }
  if (a === 'hide') { if (ST.hidden[k]) delete ST.hidden[k]; else ST.hidden[k] = p }
  if (a === 'lock') { if (ST.locked[k]) delete ST.locked[k]; else ST.locked[k] = p }
  if (a === 'link') R.linkFrom = R.linkFrom ? null : p
  save(); renderAll()
}))
$('revealBtn').onclick = () => R.sel && api.reveal(R.sel)
$('guideHead').onclick = () => { ST.guideOpen = !ST.guideOpen; save(); renderGuide() }
$('rawTog').onclick = () => { R.raw = !R.raw; renderGuide() }
$('feed').onclick = (e) => { const li = e.target.closest('[data-p]'); if (li) select(li.dataset.p) }
document.querySelectorAll('#leftSeg button').forEach((b) => b.addEventListener('click', () => { R.left = b.dataset.k; renderLeft() }))
$('followCb').onchange = (e) => { ST.follow = e.target.checked; save(); if (ST.follow) pollSessions() }
$('leftList').addEventListener('click', (e) => {
  const sf = e.target.closest('[data-sf]')
  if (sf) { ST.follow = false; save(); const s = R.sessions.find((x) => x.file === sf.dataset.sf); if (s) openSession(s); return }
  const add = e.target.closest('[data-pcadd]')
  if (add) { addTopBox(add.dataset.pcadd); renderAll(); requestAnimationFrame(fitAll); folderAdded(add.dataset.pcadd); return }
  const r = e.target.closest('[data-pc]')
  if (r && !r.classList.contains('blocked')) { const k = K(r.dataset.pc); R.pcOpen[k] = !R.pcOpen[k]; if (R.pcOpen[k]) loadTree(r.dataset.pc); renderLeft() }
})
document.querySelectorAll('#viewSeg button').forEach((b) => b.addEventListener('click', () => { R.view = b.dataset.v; renderAll(); if (R.view !== 'wiki') requestAnimationFrame(fitAll) }))
document.querySelectorAll('#langSeg button').forEach((b) => b.addEventListener('click', () => { L = ST.lang = b.dataset.l; save(); renderAll() }))
$('themeBtn').onclick = () => { ST.theme = ST.theme === 'light' ? 'dark' : 'light'; applyTheme(); save(); renderAll() }
$('dockL').onclick = () => { ST.openL = !ST.openL; save(); layoutChrome() }
$('dockR').onclick = () => { ST.openR = !ST.openR; save(); layoutChrome() }
addEventListener('resize', () => drawEdges())

/* ---------------- drag folders onto the whiteboard ---------------- */
// sources: rows in the "This PC" tree, folder tiles inside boxes, and folders from Windows Explorer
document.addEventListener('dragstart', (e) => {
  if (e.target.closest && e.target.closest('[data-lkh]')) { e.preventDefault(); return }
  const el = e.target.closest && e.target.closest('[data-dragpath]')
  if (!el) return
  e.dataTransfer.setData('text/coex-path', el.dataset.dragpath)
  e.dataTransfer.effectAllowed = 'copyMove'
})
const canDrop = (e) => R.view === 'map' && (e.dataTransfer.types.includes('text/coex-path') || e.dataTransfer.types.includes('Files'))
canvas.addEventListener('dragover', (e) => { if (!canDrop(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; $('dropZone').classList.add('show') })
canvas.addEventListener('dragleave', (e) => { if (e.target === canvas) $('dropZone').classList.remove('show') })
document.addEventListener('dragend', () => $('dropZone').classList.remove('show'))
canvas.addEventListener('drop', async (e) => {
  $('dropZone').classList.remove('show')
  if (!canDrop(e)) return
  e.preventDefault()
  let p = e.dataTransfer.getData('text/coex-path')
  if (!p && e.dataTransfer.files.length) p = api.pathForFile(e.dataTransfer.files[0])
  if (!p) return
  const kind = await api.exists(p)
  if (!kind) return
  let pick = null
  if (kind === 'file') { pick = norm(p); p = parentOf(p) }
  const x = (e.clientX - R.cam.x) / R.cam.z - 60, y = (e.clientY - R.cam.y) / R.cam.z - 20
  const k = K(p)
  if (ST.boxes[k]) Object.assign(ST.boxes[k], { x, y, child: false, folded: false, manual: true })
  else ST.boxes[k] = { path: norm(p), x, y, w: 560, folded: false, child: false, spawn: true, manual: true }
  save()
  if (pick) R.sel = pick
  renderAll()
  folderAdded(p)
})
$('clearBtn').onclick = () => { if (!Object.keys(ST.boxes).length || confirm(t('clearConfirm'))) { ST.boxes = {}; save(); renderAll() } }
$('emptyOpenPC').onclick = () => { R.left = 'pc'; ST.openL = true; save(); renderAll() }
/* called when a folder lands on the map; the wiki step hooks in here */
function folderAdded(p) { if (!DM.on && window.__onFolderAdded) window.__onFolderAdded(p) }
function applyTheme() { document.documentElement.dataset.theme = ST.theme; api.overlay(ST.theme === 'dark') }

/* ================= LLM wiki: topics and the wiki view ================= */
R.wiki = { pages: [], log: [], running: false }
R.topen = {}; R.wsel = null; R.wsTab = 'log'; R.lens = null; R.prog = null
const rulesForIngest = () => ({ hidden: Object.values(ST.hidden), pins: Object.values(ST.pins) })
async function loadWiki() { R.wiki = await api.wikiPages(); if (!R.wsel && R.wiki.pages[0]) R.wsel = R.wiki.pages[0].slug }
// sources in pages are absolute paths; claims cite file names
const srcPath = (page, name) => page.sources.find((s) => base(s).toLowerCase() === String(name).toLowerCase()) || page.sources.find((s) => K(s).includes(String(name).toLowerCase())) || ''
const tedit = (slug) => (ST.tedits = ST.tedits || {})[slug] || (ST.tedits[slug] = { removed: {}, added: {}, hist: [] })
function members(page) {
  const e = tedit(page.slug)
  const list = page.sources.filter((s) => s).map((s) => ({ path: s, st: e.removed[K(s)] ? 'removed' : 'ok' }))
  for (const k of Object.keys(e.added)) list.push({ path: e.added[k], st: 'human' })
  return list
}
/* what a person added to a topic: explicit topic edits + rules set on its members */
function touches(page) {
  const out = [], seen = new Set()
  const push = (ic, txt, at) => { if (!seen.has(txt)) { seen.add(txt); out.push({ ic, txt, at }) } }
  const e = tedit(page.slug)
  for (const h of e.hist) push(h.ic || '•', h.txt, h.at)
  for (const m of members(page)) {
    if (m.st === 'removed') continue
    if (ST.pins[K(m.path)]) push(ICO.pinI, t('tPin', base(m.path)))
    const hb = hiddenBy(m.path); if (hb) push(ICO.eyeoff, t('tHid', base(hb)))
    const lb = lockedBy(m.path); if (lb) push(ICO.lock, t('tLock', base(lb)))
  }
  const ks = members(page).map((m) => K(m.path))
  for (const l of ST.links) if (ks.includes(K(l.a)) || ks.includes(K(l.b))) push(ICO.link, `${base(l.a)} → ${base(l.b)} · ${ltName(l)}: ${ruleText(ltOf(l))}`)
  return out
}
function renderTopicBoard() {
  const w = $('world'); w.classList.remove('lens', 'far', 'mid'); zoomLevel = 'topic'
  const pages = R.wiki.pages
  const cols = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(pages.length))))
  w.innerHTML = '<svg class="wedges" id="wedges"></svg>' + pages.map((p, i) => {
    const x = (i % cols) * 470, y = Math.floor(i / cols) * 520
    const mem = members(p), tc = touches(p), open = !!R.topen[p.slug]
    const memo = p.memo && !/^\(.*\)$/.test(p.memo) ? p.memo : ''
    return `<div class="tcl${open ? ' open' : ''}" data-slug="${esc(p.slug)}" style="left:${x}px;top:${y}px">
      <div class="th"><div class="orb">${ICO.spark}</div><div style="min-width:0"><h4>${esc(p.title)}</h4><span class="k">${t(p.type === 'project' ? 'gProject' : 'gConcept')} · GBrain · ${t('nSources', mem.filter((m) => m.st !== 'removed').length)}</span></div>
        <button class="tcount${tc.length + (memo ? 1 : 0) ? ' has' : ''}" data-topen="${esc(p.slug)}">${t('touches', tc.length + (memo ? 1 : 0))} ${open ? '▾' : '▸'}</button></div>
      <div class="layer cl"><div class="lab">${t('claudeLayer')}</div>
        <ul class="claims">${p.claims.slice(0, 4).map((c) => `<li>${esc(c.text)}${c.src.length ? '' : ` <span class="cflag red">● ${t('noSrc')}</span>`}</li>`).join('')}</ul>
        <div class="mem">${mem.map((m) => `<div class="mc st-${m.st}" data-go="${esc(m.path)}">${fileIc(base(m.path))}<div class="tx"><span class="t">${esc(base(m.path))}</span><span class="s">${esc(parentOf(m.path).split('\\').slice(-2).join(' › '))}</span></div>${m.st === 'human' ? `<span class="mtag h">${t('humanTag')}</span>` : ''}${m.st === 'removed' ? `<button class="mb" data-tundo="${esc(p.slug)}" data-mp="${esc(m.path)}">${t('undo')}</button>` : `<button class="mb hov" data-tdrop="${esc(p.slug)}" data-mp="${esc(m.path)}">${t('dropM')}</button>`}</div>`).join('')}</div>
      </div>
      ${open ? `<div class="layer hl"><div class="lab">${t('humanLayer')}</div>
        ${tc.length ? `<ul class="touch">${tc.map((x) => `<li><span class="ti">${x.ic}</span><span>${esc(x.txt)}</span>${x.at ? `<span class="ta">${esc(x.at)}</span>` : ''}</li>`).join('')}</ul>` : `<div class="empty">${t('noTouch')}</div>`}
        <textarea class="memoin" data-memo="${esc(p.slug)}" placeholder="${t('memoPh')}">${esc(memo)}</textarea>
        <button class="btn" data-tadd="${esc(p.slug)}" ${R.sel && !isDirPath(R.sel) ? '' : 'disabled'}>${t('addSel')}</button>
      </div>` : ''}
      <div class="foot"><button class="btn on" data-tlens="${esc(p.slug)}">${t('onMap')}</button><button class="btn" data-twiki="${esc(p.slug)}">${t('tabWiki')}</button></div>
    </div>`
  }).join('')
  applyCam(); requestAnimationFrame(drawEdges)
}
/* ---------- wiki as a vault: read the map folders like Obsidian, with the topics that use each file ---------- */
const READABLE = /\.(md|markdown|txt|csv|tsv|json|ya?ml|toml|py|js|ts|html|css|tex|r|sh|log)$/i
const wikiRoots = () => Object.values(ST.boxes).filter((b) => !b.child).map((b) => b.path)
const citedBy = (p) => R.wiki.pages.filter((x) => x.sources.some((s) => K(s) === K(p)))
const topicsUnder = (dir) => R.wiki.pages.filter((x) => x.sources.some((s) => under(s, dir)))
function loadWtree(dir) {
  R.wtree = R.wtree || {}; const k = K(dir)
  if (R.wtree[k]) return
  R.wtree[k] = { loading: true }
  api.list(dir).then((r) => { R.wtree[k] = r; if (R.view === 'wiki') renderWiki() })
}
function treeHTML(dir, depth) {
  const r = (R.wtree || {})[K(dir)]
  if (!r || r.loading) { loadWtree(dir); return `<li class="wt muted" style="--d:${depth}">${t('loading')}</li>` }
  if (r.error) return `<li class="wt muted" style="--d:${depth}">${esc(r.error)}</li>`
  const dirs = r.dirs.filter((d) => !d.system && !/^\./.test(d.name)).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  const files = r.files.filter((f) => READABLE.test(f.name)).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  const other = r.files.length - files.length
  return dirs.map((d) => dirRow(d.path, d.name, depth)).join('') +
    files.map((f) => { const n = citedBy(f.path).length; return `<li class="wt file${R.wfile && K(R.wfile) === K(f.path) ? ' on' : ''}" style="--d:${depth}" data-wfile="${esc(f.path)}" title="${esc(f.name)}"><span class="car"></span><span class="fext">${esc(extOf(f.name))}</span><span class="nm">${esc(f.name.replace(/\.(md|markdown)$/i, ''))}</span>${n ? `<span class="wtn" title="${t('wBack')}">✳${n}</span>` : ''}</li>` }).join('') +
    (other ? `<li class="wt muted" style="--d:${depth}"><span class="car"></span>${t('wOther', other)}</li>` : '')
}
function dirRow(path, name, depth) {
  const k = K(path), open = !!(R.wopen || {})[k], n = topicsUnder(path).length
  const on = !R.wfile && R.wfolder && K(R.wfolder) === k
  return `<li class="wt dir${on ? ' on' : ''}" style="--d:${depth}" data-wdir="${esc(path)}"><span class="car">${open ? '▾' : '▸'}</span><span class="fi">${ICO.folder}</span><span class="nm">${esc(name)}</span>${n ? `<span class="wtn" title="${t('wFolderTopics')}">✳${n}</span>` : ''}</li>${open ? treeHTML(path, depth + 1) : ''}`
}
// open a file in the reader and unfold the tree down to it
function openWikiFile(p) {
  R.wmode = 'folder'; ST.wmode = 'folder'; R.wfile = norm(p); R.wopen = R.wopen || {}
  for (const root of wikiRoots()) if (under(p, root)) { let x = parentOf(p); while (x && under(x, root)) { R.wopen[K(x)] = true; if (K(x) === K(root)) break; x = parentOf(x) } }
  R.view = 'wiki'; renderAll()
  requestAnimationFrame(() => { const el = $('wikiList').querySelector('.wt.on'); if (el) el.scrollIntoView({ block: 'nearest' }) })
}
/* a small markdown renderer: headings, lists, checkboxes, tables, code, quotes, [[links]], frontmatter */
function mdInline(s) {
  const codes = []
  let h = esc(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000' })
  h = h.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, a) => `<span class="mdimg">${t('wImage')}${a ? ' · ' + a : ''}</span>`)
  h = h.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, slug, label) => { const pg = R.wiki.pages.find((x) => x.slug.toLowerCase() === slug.trim().toLowerCase()); return pg ? `<span class="mdwl" data-wsel="${esc(pg.slug)}">${label || esc(pg.title)}</span>` : `<span class="mdwl off">${label || slug}</span>` })
  h = h.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '<span class="mdlink" title="$2">$1</span>')
  h = h.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^\w])__([^_]+)__/g, '$1<b>$2</b>')
  h = h.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>').replace(/~~([^~]+)~~/g, '<s>$1</s>')
  return h.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`)
}
function mdList(buf) {
  let html = ''; const stack = []
  for (const raw of buf) {
    const m = raw.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/)
    if (!m) { html = html.replace(/<\/li>$/, '<br>' + mdInline(raw.trim()) + '</li>'); continue }
    const ind = m[1].replace(/\t/g, '  ').length, tag = /\d/.test(m[2]) ? 'ol' : 'ul'
    while (stack.length && ind < stack[stack.length - 1].ind) html += `</${stack.pop().tag}>`
    if (!stack.length || ind > stack[stack.length - 1].ind) { html += `<${tag}>`; stack.push({ ind, tag }) }
    let txt = m[3], box = ''
    const cb = txt.match(/^\[( |x|X)\]\s+(.*)$/); if (cb) { box = `<span class="mdcb${cb[1] !== ' ' ? ' on' : ''}"></span>`; txt = cb[2] }
    html += `<li>${box}${mdInline(txt)}</li>`
  }
  while (stack.length) html += `</${stack.pop().tag}>`
  return html
}
function mdHTML(src) {
  const lines = String(src).replace(/\r\n?/g, '\n').split('\n')
  let i = 0, out = ''
  if (lines[0] === '---') { const end = lines.indexOf('---', 1); if (end > 0) { out += `<div class="mdfm">${lines.slice(1, end).map((l) => `<div>${esc(l)}</div>`).join('')}</div>`; i = end + 1 } }
  const sep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l || '')
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
  const isList = (l) => /^\s*([-*+]|\d+[.)])\s+/.test(l)
  const isTable = (j) => /\|/.test(lines[j]) && sep(lines[j + 1])
  while (i < lines.length) {
    const l = lines[i]; let m
    if (/^\s*```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]); i++; out += `<pre class="mdcode">${esc(buf.join('\n'))}</pre>`; continue }
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { out += `<div class="mh mh${m[1].length}">${mdInline(m[2])}</div>`; i++; continue }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { out += '<hr class="mdhr">'; i++; continue }
    if (/^\s*>/.test(l)) { const buf = []; while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, '')); out += `<blockquote class="mdq">${buf.map(mdInline).join('<br>')}</blockquote>`; continue }
    if (isTable(i)) { const head = cells(l); i += 2; const rows = []; while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(cells(lines[i++])); out += `<div class="mdtw"><table><thead><tr>${head.map((c) => `<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${mdInline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; continue }
    if (isList(l)) { const buf = []; while (i < lines.length && (isList(lines[i]) || (buf.length && /^\s{2,}\S/.test(lines[i])))) buf.push(lines[i++]); out += mdList(buf); continue }
    if (!l.trim()) { i++; continue }
    const buf = []; while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*```|\s*>)/.test(lines[i]) && !isList(lines[i]) && !isTable(i)) buf.push(lines[i++])
    out += `<p>${buf.map(mdInline).join('<br>')}</p>`
  }
  return out
}
// the middle pane in folder mode: a file (rendered) or a folder overview
function renderReader() {
  const pane = $('wikiPage')
  if (R.wfile) {
    const p = R.wfile; R.wtext = R.wtext || {}
    const c = R.wtext[K(p)]
    if (!c) { R.wtext[K(p)] = { loading: true }; api.readText(p).then((r) => { R.wtext[K(p)] = r; if (R.view === 'wiki' && R.wfile && K(R.wfile) === K(p)) renderReader() }); pane.innerHTML = `<div class="empty">${t('loading')}</div>`; return }
    if (c.loading) return
    const back = citedBy(p)
    const said = back.flatMap((pg) => pg.claims.filter((cl) => cl.src.some((s) => K(srcPath(pg, s)) === K(p))).map((cl) => ({ pg, text: cl.text })))
    const lk = linksOf(p)
    const crumbs = parentOf(p).split('\\').slice(-3).join(' › ')
    const isMd = /\.(md|markdown)$/i.test(p)
    pane.innerHTML = `<div class="rdhead"><div><h1>${esc(base(p))}</h1><div class="sub2">${esc(crumbs)}${c.size != null ? ' · ' + (c.size / 1024).toFixed(1) + ' KB' : ''}${c.mtime ? ' · ' + esc(new Date(c.mtime).toLocaleDateString(L === 'ko' ? 'ko-KR' : 'en-US')) : ''}</div></div>
      <div class="rdbtns"><button class="btn" data-go="${esc(p)}">${t('wOpenMap')}</button><button class="btn" data-wreveal="${esc(p)}">${t('aReveal')}</button></div></div>
      <div class="backbox"><div class="bkh">✳ ${t('wBack')}<span>${back.length}</span></div>${back.length ? `<div class="bkchips">${back.map((pg) => `<span class="bkchip" data-wsel="${esc(pg.slug)}">${esc(pg.title)}</span>`).join('')}</div>${said.length ? `<ul class="bksaid">${said.slice(0, 6).map((x) => `<li>${esc(x.text)}<span>${esc(x.pg.title)}</span></li>`).join('')}</ul>` : ''}` : `<div class="bknone">${t('wNoBack')}</div>`}
      ${lk.length ? `<div class="bkh" style="margin-top:10px">${ICO.linkS} ${t('wHumanLinks')}<span>${lk.length}</span></div><div class="bkchips">${lk.map((l) => { const o = K(l.a) === K(p) ? l.b : l.a; return `<span class="bkchip lnk" ${READABLE.test(o) ? `data-wfile="${esc(o)}"` : `data-go="${esc(o)}"`}>${esc(ltName(l))} · ${esc(base(o))}</span>` }).join('')}</div>` : ''}</div>
      ${c.error ? `<div class="empty">${c.error === 'type' ? t('wNotText') : esc(c.error)}</div>` : `${c.cut ? `<div class="hint">${t('wCut')}</div>` : ''}<div class="md${isMd ? '' : ' plain'}">${isMd ? mdHTML(c.text) : `<pre class="mdcode">${esc(c.text)}</pre>`}</div>`}`
    return
  }
  const dir = R.wfolder || wikiRoots()[0]
  if (!dir) { pane.innerHTML = `<div class="empty">${t('wPick')}</div>`; return }
  const r = (R.wtree || {})[K(dir)]
  const files = r && r.files ? r.files.filter((f) => READABLE.test(f.name)) : []
  const tp = topicsUnder(dir)
  pane.innerHTML = `<div class="rdhead"><div><h1>${esc(base(dir))}</h1><div class="sub2">${esc(parentOf(dir).split('\\').slice(-2).join(' › '))}</div></div><div class="rdbtns"><button class="btn" data-go="${esc(dir)}">${t('wOpenMap')}</button></div></div>
    <h2>✳ ${t('wFolderTopics')}</h2>${tp.length ? `<div class="tpcards">${tp.map((pg) => `<div class="tpcard" data-wsel="${esc(pg.slug)}"><b>${esc(pg.title)}</b><span>${esc((pg.claims[0] || {}).text || '')}</span><i>${t('nSources', pg.sources.filter((s) => under(s, dir)).length)}</i></div>`).join('')}</div>` : `<div class="bknone">${t('wNoTopicsHere')}</div>`}
    <h2>${t('wFiles')}</h2><ul class="flist">${files.map((f) => { const n = citedBy(f.path).length; return `<li data-wfile="${esc(f.path)}"><span class="fext">${esc(extOf(f.name))}</span><span class="nm">${esc(f.name)}</span>${n ? `<span class="wtn">✳${n}</span>` : ''}</li>` }).join('') || '<li class="empty">—</li>'}</ul>`
}
function renderWiki() {
  const pages = R.wiki.pages; if (!pages.length) return
  R.wmode = R.wmode || ST.wmode || 'folder'
  $('wmSeg').innerHTML = [['folder', t('wmFolder')], ['topic', t('wmTopic')]].map(([k, l]) => `<button class="${R.wmode === k ? 'on' : ''}" data-wmode="${k}">${l}</button>`).join('')
  $('wikiv').classList.toggle('fmode', R.wmode === 'folder')
  const p = pages.find((x) => x.slug === R.wsel) || pages[0]; R.wsel = p.slug
  if (R.wmode === 'folder') {
    R.wopen = R.wopen || {}
    const roots = wikiRoots()
    if (roots[0] && R.wopen[K(roots[0])] === undefined) R.wopen[K(roots[0])] = true
    $('wikiList').innerHTML = roots.map((d) => dirRow(d, base(d), 0)).join('') || `<li class="empty">${t('wNoRoots')}</li>`
    renderReader()
  } else {
  $('wikiList').innerHTML = pages.map((x) => `<li class="row${x.slug === p.slug ? ' on' : ''}" data-wsel="${esc(x.slug)}"><div class="tile" style="color:var(--violet)">✳</div><div class="tx"><span class="t">${esc(x.title)}</span><span class="s">${t(x.type === 'project' ? 'gProject' : 'gConcept')} · ${t('nSources', x.sources.length)}${x.stale.length ? ' · ' + t('cStale') : ''}</span></div></li>`).join('')
  // the ingest run that last wrote this page
  const run = R.wiki.log.find((e) => e.writes.some((w) => K(w).endsWith(K(p.slug) + '.md'))) || R.wiki.log[0]
  const steps = run ? [['sScan', 'rule', run.scanned], ['sHash', 'rule', run.hashed], ['sLink', 'rule', run.linksFound], ['sRead', 'llm', run.reads.length], ['sWrite', 'llm', run.writes.length]] : []
  const pipe = steps.map(([s, kind, v], i) => `<div class="step ${kind}"><span class="sn">${i + 1}</span><div><b>${t(s)}</b><span>${v}</span></div><span class="kind">${kind === 'rule' ? t('rule') + ' · ' + t('free') : 'LLM'}</span></div>`).join('<span class="arrow">›</span>')
  const tc = touches(p)
  const reads = run ? run.reads.filter((r) => p.sources.some((s) => K(s) === K(r))) : []
  const memo = p.memo && !/^\(.*\)$/.test(p.memo) ? p.memo : ''
  $('wikiPage').innerHTML = `<h1>${esc(p.title)}</h1><div class="sub2">${t(p.type === 'project' ? 'gProject' : 'gConcept')} · ${esc(p.updated || '')} · ${esc(base(p.file))}</div>
    ${run ? `<div class="buildbox"><div class="bhh">${t('buildHead')}<span>${esc(new Date(run.when).toLocaleString(L === 'ko' ? 'ko-KR' : 'en-US'))} · ${t('trig_' + run.trigger)} · ${run.model}${run.tokens ? ' · ' + run.tokens.toLocaleString() + ' tok' : ''}${run.cost != null ? ' · $' + run.cost.toFixed(3) : ''}</span></div><div class="pipe">${pipe}</div></div>` : ''}
    <div class="human"><div class="hh">${t('humanHead')}</div>${tc.length ? tc.map((x) => `<div class="r"><span class="ti2">${x.ic}</span><span>${esc(x.txt)}</span></div>`).join('') : `<div class="r" style="color:var(--ink-3)">${t('noTouch')}</div>`}</div>
    <h2>${t('claimsHead')}</h2><ul class="claims big">${p.claims.map((c) => `<li><span>${esc(c.text)}</span>${c.src.map((s) => `<span class="schip" data-wfile="${esc(srcPath(p, s))}">${esc(s)}</span>`).join('')}${c.src.length ? '' : `<span class="cflag red">● ${t('noSrc')}</span>`}</li>`).join('')}</ul>
    ${reads.length ? `<h2>${t('readOrder')}</h2><ul class="reads">${reads.map((r, i) => `<li data-wfile="${esc(r)}"><span class="rn2">${i + 1}</span><span class="rnm">${esc(base(r))}</span><span class="rloc">${esc(parentOf(r).split('\\').slice(-2).join(' › '))}</span></li>`).join('')}</ul>` : ''}
    <h2>${t('linksHead')}</h2><ul class="plinks">${p.links.length ? p.links.map((l) => `<li data-wsel="${esc(l)}"><span class="ln"></span><b>${esc((pages.find((x) => x.slug === l) || {}).title || l)}</b><span class="rk2">${p.broken.includes(l) ? t('cBroken') : t('ruleLink')}</span></li>`).join('') : '<li class="empty">—</li>'}</ul>
    <h2>${t('tlHead')}</h2><ul class="tl">${p.timeline.map((x) => `<li>${esc(x)}</li>`).join('')}${tedit(p.slug).hist.map((h) => `<li class="h">${esc(h.at)} · ${esc(h.txt)}</li>`).join('')}</ul>
    <h2>${t('memo')}</h2><textarea class="memoin" data-memo="${esc(p.slug)}" placeholder="${t('memoPh')}">${esc(memo)}</textarea>`
  }
  const noSrc = pages.reduce((a, x) => a + x.claims.filter((c) => !c.src.length).length, 0)
  const stale = pages.filter((x) => x.stale.length).length, broken = pages.reduce((a, x) => a + x.broken.length, 0), orphan = pages.filter((x) => x.orphan).length
  const tabs = [['log', t('wtLog')], ['check', t('wtCheck') + (stale + broken + noSrc ? ` · ${stale + broken + noSrc}` : '')]]
  let body = ''
  if (R.wsTab === 'log') body = `<ul class="logl">${R.wiki.log.slice(0, 12).map((e) => `<li><span class="lw">${esc(new Date(e.when).toLocaleString(L === 'ko' ? 'ko-KR' : 'en-US'))}</span><b>${t('trig_' + e.trigger)} · ${e.model}</b><span>${t('nReads', e.reads.length)} · ${t('nWrites', e.writes.length)}${e.note ? ' · ' + esc(e.note) : ''}</span><span class="lc">${e.cost != null ? '$' + e.cost.toFixed(3) : '—'}</span></li>`).join('') || `<li class="empty">—</li>`}</ul>`
  else body = `<div class="checks"><div class="${stale ? 'bad' : ''}"><b>${stale}</b><span>${t('cStale')}</span></div><div class="${broken ? 'bad' : ''}"><b>${broken}</b><span>${t('cBroken')}</span></div><div><b>${orphan}</b><span>${t('cOrphan')}</span></div><div class="${noSrc ? 'bad' : ''}"><b>${noSrc}</b><span>${t('cNoSrc')}</span></div></div>${stale ? `<p class="hint">● ${pages.filter((x) => x.stale.length).map((x) => esc(x.title)).join(', ')}</p>` : ''}`
  $('wikiSide').innerHTML = `<div class="seg" style="margin-bottom:10px">${tabs.map(([k, l]) => `<button class="${R.wsTab === k ? 'on' : ''}" data-wst="${k}">${l}</button>`).join('')}</div>${body}
    <div class="wbtns"><button class="btn on" id="wBuild">${R.wiki.running ? t('building') : t('updateWiki')}</button></div><p class="hint">${esc(R.wiki.dir || '')}</p>`
}
async function runIngest(mode, folders) {
  if (R.wiki.running || DM.on) return // the demo tour plays back a recorded build instead
  folders = folders || Object.values(ST.boxes).map((b) => b.path)
  if (!folders.length) return
  R.wiki.running = true; R.prog = { text: t('ingestStart') }; showToast(); renderStatic()
  await api.wikiIngest({ folders, mode, rules: rulesForIngest(), lang: L }) // pages are written in the app's language
}
function showToast() {
  const on = !!R.prog
  $('itoast').classList.toggle('show', on)
  if (on) { $('itText').textContent = R.prog.text; $('itSpin').style.display = R.prog.done ? 'none' : ''; $('itStop').style.display = R.prog.done ? 'none' : '' }
}
api.onWiki(async (m) => {
  if (m.type === 'start') R.prog = { text: t('ingestScan', m.entry.scanned, m.entry.picked.length, m.entry.model) }
  if (m.type === 'step') R.prog = { text: m.kind === 'read' ? t('ingestRead', base(m.path), m.n, m.total) : t('ingestWrite', base(m.path)) }
  if (m.type === 'done') {
    R.prog = { done: true, text: m.entry.note === 'nothing changed' ? t('ingestNone') : m.entry.note === 'no pages' ? t('ingestFail', m.entry.result || '') : t('ingestDone', m.entry.writes.length, m.entry.cost) }
    await loadWiki(); R.wiki.running = false; renderAll()
    setTimeout(() => { R.prog = null; showToast() }, m.entry.note === 'no pages' ? 12000 : 4500)
  }
  showToast()
})
$('itStop').onclick = () => api.wikiStop()
$('soonBtn').onclick = () => runIngest('first')
// a folder landing on the map updates the wiki: first build if there is none, otherwise only the new folder
window.__onFolderAdded = (p) => { if (ST.autoWiki === false) return; runIngest(R.wiki.pages.length ? 'update' : 'first', R.wiki.pages.length ? [p] : undefined) }
document.addEventListener('click', (e) => {
  const tg = e.target.closest('[data-topen]'); if (tg) { R.topen[tg.dataset.topen] = !R.topen[tg.dataset.topen]; return renderTopicBoard() }
  const dr = e.target.closest('[data-tdrop]'); if (dr) { const ed = tedit(dr.dataset.tdrop); ed.removed[K(dr.dataset.mp)] = true; ed.hist.push({ ic: '−', txt: t('dropMemH', base(dr.dataset.mp)), at: new Date().toLocaleTimeString() }); save(); return renderTopicBoard() }
  const un = e.target.closest('[data-tundo]'); if (un) { const ed = tedit(un.dataset.tundo); delete ed.removed[K(un.dataset.mp)]; save(); return renderTopicBoard() }
  const ad = e.target.closest('[data-tadd]'); if (ad && R.sel) { const ed = tedit(ad.dataset.tadd); ed.added[K(R.sel)] = R.sel; ed.hist.push({ ic: '+', txt: t('addMemH', base(R.sel)), at: new Date().toLocaleTimeString() }); save(); return renderTopicBoard() }
  const ln = e.target.closest('[data-tlens]'); if (ln) { R.lens = ln.dataset.tlens; R.view = 'map'; renderAll(); return }
  const tw = e.target.closest('[data-twiki]'); if (tw) { R.wsel = tw.dataset.twiki; R.view = 'wiki'; renderAll(); return }
  const wm = e.target.closest('[data-wmode]'); if (wm) { R.wmode = ST.wmode = wm.dataset.wmode; save(); return renderWiki() }
  const wdr = e.target.closest('[data-wdir]'); if (wdr) { const k = K(wdr.dataset.wdir); R.wopen = R.wopen || {}; if (!R.wfile && R.wfolder && K(R.wfolder) === k) R.wopen[k] = !R.wopen[k]; else R.wopen[k] = true; R.wfolder = norm(wdr.dataset.wdir); R.wfile = null; return renderWiki() }
  const wf = e.target.closest('[data-wfile]'); if (wf && wf.dataset.wfile) return openWikiFile(wf.dataset.wfile)
  const wrv = e.target.closest('[data-wreveal]'); if (wrv) return api.reveal(wrv.dataset.wreveal)
  const ws = e.target.closest('[data-wsel]'); if (ws) { R.wsel = ws.dataset.wsel; R.wmode = 'topic'; return renderWiki() }
  const wt = e.target.closest('[data-wst]'); if (wt) { R.wsTab = wt.dataset.wst; return renderWiki() }
  if (e.target.id === 'wBuild') return runIngest(R.wiki.pages.length ? 'update' : 'first')
  const go = e.target.closest('[data-go]'); if (go && go.dataset.go) { R.view = 'map'; select(go.dataset.go); return }
  if (e.target.id === 'lensOff') { R.lens = null; renderAll() }
  if (e.target.id === 'linkOff') { R.linkFrom = null; renderAll() }
})
document.addEventListener('focusout', async (e) => {
  const m = e.target.closest && e.target.closest('[data-memo]'); if (!m) return
  const slug = m.dataset.memo, v = m.value.trim()
  const page = R.wiki.pages.find((x) => x.slug === slug); if (!page || v === (page.memo || '').trim()) return
  await api.wikiMemo(slug, v) // written into the page's "## 사람 메모", so Claude reads it next session
  tedit(slug).hist.push({ ic: ICO.read, txt: t('memoH'), at: new Date().toLocaleTimeString() }); save()
  await loadWiki(); if (R.view === 'topic') renderTopicBoard()
})

/* ================= Claude Code link (hooks) ================= */
R.hooks = { installed: false }; R.blkOff = null; R.blocked = {}
function renderConn() {
  $('connSw').classList.toggle('on', !!R.hooks.installed)
  $('connSub').textContent = R.hooks.error ? R.hooks.error : R.hooks.installed ? t('connOn') : t('connOff')
}
$('connSw').onclick = async () => {
  $('connSw').disabled = true
  const res = await api.hooks(R.hooks.installed ? 'uninstall' : 'install')
  R.hooks = await api.hooks('status')
  if (res && res.error) R.hooks.error = res.error
  $('connSw').disabled = false
  renderConn(); renderGuide()
}
// denials written by the hook show up as "blocked" on the map and in the feed
async function pollBlocked() {
  const res = await api.blocked(R.blkOff === null ? 1e15 : R.blkOff) // first call: skip old lines
  if (R.blkOff === null) { R.blkOff = res.next; return }
  R.blkOff = res.next
  for (const b of res.events) {
    R.events.push({ tool: 'Blocked', kind: 'blocked', path: b.path, at: Date.parse(b.at) || Date.now(), agent: 'main', reason: b.reason })
    R.blocked[K(b.path)] = Date.now()
  }
  if (res.events.length) { scheduleRender(); renderFeed() }
}

/* ================= projects + new session ================= */
// each project has its own map and its own wiki; rules (hide, lock, pin, link) stay global
function renderProjects() {
  const root = projRoot() || (Object.values(ST.boxes).find((b) => !b.child) || {}).path
  $('openClaude').style.display = root ? '' : 'none'
  if (root) $('openClaudeTx').textContent = t('openClaude', base(root), mapDirs().length)
  const sel = $('projSel')
  sel.innerHTML = Object.entries(ST.projects).sort((a, b) => (b[1].created || 0) - (a[1].created || 0))
    .map(([id, p]) => `<option value="${esc(id)}"${id === ST.curProj ? ' selected' : ''}>${esc(id === 'default' ? t('defaultProj') : p.name)}</option>`).join('')
}
async function switchProject(id) {
  if (ST.projects[ST.curProj]) Object.assign(ST.projects[ST.curProj], { boxes: ST.boxes, cam: R.cam })
  ST.curProj = id
  const p = ST.projects[id]
  ST.boxes = p.boxes || {}
  if (p.cam) R.cam = p.cam
  ST.wikiIndex = await api.wikiProject(id) // the hook tells Claude where this project's wiki is
  R.cur = null; R.events = []; R.touch = {}; R.sel = null; R.lens = null
  save()
  await loadWiki()
  R.wsel = R.wiki.pages[0] ? R.wiki.pages[0].slug : null
  renderProjects(); renderAll()
  await pollSessions()
  requestAnimationFrame(fitAll)
}
const mapDirs = () => Object.values(ST.boxes).filter((b) => !b.child).map((b) => b.path)
// open Claude Code for the project on screen: works in its root folder, with every map folder allowed
async function openClaude() {
  const root = projRoot() || Object.values(ST.boxes).filter((b) => !b.child).map((b) => b.path)[0]
  if (!root) return
  ST.follow = true; save()
  const r = await api.launchClaude(root, mapDirs())
  R.prog = { done: true, text: r.ok ? t('launched', base(root)) : t('launchFail', r.error || '') }; showToast()
  setTimeout(() => { if (R.prog && R.prog.done) { R.prog = null; showToast() } }, 6000)
}
$('openClaude').onclick = openClaude
async function newSession() {
  const folder = await api.pickFolder()
  if (!folder) return
  const id = 'p' + Date.now().toString(36)
  ST.projects[id] = { name: base(folder), root: norm(folder), created: Date.now(), boxes: { [K(folder)]: { path: norm(folder), x: 0, y: 0, w: 560, folded: false, child: false, spawn: true } }, cam: null }
  ST.follow = true
  await switchProject(id)
  const r = await api.launchClaude(folder, mapDirs())
  R.prog = { done: true, text: r.ok ? t('launched', base(folder)) : t('launchFail', r.error || '') }; showToast()
  setTimeout(() => { if (R.prog && R.prog.done) { R.prog = null; showToast() } }, 6000)
  folderAdded(folder) // a new project's folder builds its wiki
}
$('newSess').onclick = newSession
$('projSel').onchange = (e) => switchProject(e.target.value)
$('allCb').onchange = (e) => { R.showAll = e.target.checked; renderLeft() }

initDemo({ ST, R, DM, $, K, api, t, applyEvents, scheduleRender, renderFeed, renderAll, applyCam, drawEdges, fitAll, viewRect, applyTheme, layoutChrome, showToast, getLang: () => L, setLang: (l) => { L = l } })

window.__setView = (v) => { const [view, open] = v.split(':'); R.view = view; if (open) R.topen[open] = true; renderAll(); requestAnimationFrame(fitAll) } // dev aid for screenshots

/* ---------------- boot ---------------- */
;(async function boot() {
  const saved = await api.loadState()
  if (saved) { Object.assign(ST, saved); if (saved.cam) R.cam = saved.cam }
  for (const b of Object.values(ST.boxes)) b.w = Math.max(b.w, b.child ? 400 : 560) // tile boards need room
  L = ST.lang || 'ko'
  applyTheme()
  R.roots = await api.roots()
  // first run with projects: the existing map becomes the default project
  if (!ST.projects || !Object.keys(ST.projects).length) { ST.projects = { default: { name: t('defaultProj'), root: '', created: 1, boxes: ST.boxes, cam: R.cam } }; ST.curProj = 'default' }
  if (!ST.projects[ST.curProj]) ST.curProj = Object.keys(ST.projects)[0]
  ST.boxes = ST.projects[ST.curProj].boxes || ST.boxes
  ST.wikiIndex = await api.wikiProject(ST.curProj)
  renderProjects()
  if (!Object.keys(ST.boxes).length) R.left = 'pc' // empty map: start from "This PC"
  await loadWiki()
  R.hooks = await api.hooks('status'); renderConn()
  pollBlocked(); setInterval(pollBlocked, 1000)
  renderAll()
  await pollSessions()
  const first = R.sessions.filter(inProject)[0]
  if (!R.cur && first) await openSession(first)
  setInterval(poll, 700)
  setInterval(pollSessions, 4000)
  setInterval(() => { if (R.left === 's') renderLeft(); renderFeed() }, 30000)
})()

// keyboard: Ctrl + / Ctrl - / Ctrl 0 change the size of the whole app (saved);
// + / - alone zoom the map when you are not typing
addEventListener('keydown', async (e) => {
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')
  const mod = e.ctrlKey || e.metaKey
  if (e.altKey || (!mod && typing)) return
  const k = e.key, c = e.code
  const zin = k === '+' || k === '=' || c === 'Equal' || c === 'NumpadAdd'
  const zout = k === '-' || k === '_' || c === 'Minus' || c === 'NumpadSubtract'
  const reset = mod && (k === '0' || c === 'Digit0' || c === 'Numpad0')
  if (!zin && !zout && !reset) return
  e.preventDefault()
  if (mod) {
    const z = await api.uiZoom(reset ? 'reset' : zin ? 'in' : 'out')
    const msg = t('uiZoom', Math.round(z * 100)); R.prog = { done: true, text: msg }; showToast()
    clearTimeout(R.uiZoomT); R.uiZoomT = setTimeout(() => { if (R.prog && R.prog.text === msg) { R.prog = null; showToast() } }, 1400)
    return
  }
  if (R.view !== 'map') return
  const v = viewRect()
  zoomAt(zin ? 1.2 : 1 / 1.2, (v.l + v.r) / 2, (v.t + v.b) / 2)
})
addEventListener('keydown', (e) => { if (e.key === 'Escape' && (R.linkFrom || R.linkDrag)) { R.linkFrom = null; R.linkDrag = null; drag = null; renderAll() } })
