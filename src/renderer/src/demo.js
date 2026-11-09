// One-minute self-running tour of CoExplorer, in English.
// It drives the real interface with a drawn cursor: real clicks, real drags, real tab changes.
// Story: an empty project -> drag in the folders you need -> build the LLM wiki once, in the Wiki tab
// -> from then on, each folder you add updates the wiki -> where Claude reads, in order
// -> a person draws a relation, and it sits on top of the wiki.
// The wiki builds are replays of a real build (projects/demo in the wiki folder, made by the app's own ingest),
// and Claude's reads are replayed tool calls on real files. Nothing is saved: everything goes back at the end (or on Esc).

const CURSOR = '<svg width="30" height="35" viewBox="0 0 24 28"><path d="M3 2.5v19.2l5.1-4.6 3.6 7.9 3.7-1.6-3.5-7.6h6.9z" fill="#101217" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/></svg>'
const FOLDER = '<svg class="i" viewBox="0 0 24 24"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>'
// the folders the tour uses, under Desktop\<PARENT>, and the wiki project their real build was saved in:
// FIRST and SECOND go in before the first build; THIRD is added later and updates the wiki
const PARENT = ['2_학업', '대외활동', 'KHUDA']
const FIRST = '10기 데이터분석트랙', SECOND = '웹진', THIRD = '10기 파이썬 스터디', DEMO_WIKI = 'demo'
// the tour runs zoomed out a little, so the top bar and the folders fit on a normal window
const ZOOM = 0.8

export function initDemo(c) {
  const { ST, R, DM, $, K, api } = c
  let running = false, stopped = false, t0 = 0, log = []
  let cur = null, cap = null, ghost = null, cx = 0, cy = 0, down = false

  class Stop extends Error {}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const wait = async (ms) => { await sleep(ms); if (stopped) throw new Stop() }
  const q = (s) => (typeof s === 'function' ? s() : typeof s === 'string' ? document.querySelector(s) : s)
  const vis = (e) => !!(e && e.isConnected && e.getClientRects().length)
  const mid = (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }
  const near = (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width * 0.7, y: r.top + r.height * 0.72 } }
  const esc = (s) => String(s).replace(/[&<>"]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[x]))
  const base = (p) => String(p).split(/[\\/]/).pop()
  const inside = (p, dir) => K(p).startsWith(K(dir) + '\\')
  async function waitFor(s, ms = 2000) {
    const end = performance.now() + ms
    for (;;) { const e = q(s); if (vis(e)) return e; if (performance.now() > end) return null; await wait(50) }
  }
  // each scene starts at a fixed second, so the pace stays calm and the tour stays under a minute
  const until = async (sec) => { const left = sec * 1000 - (performance.now() - t0); if (left > 0) await wait(left) }

  /* ---------- cursor ---------- */
  function put(x, y) {
    cx = x; cy = y
    cur.style.transform = `translate(${x - 3.75}px,${y - 3.1}px)`
    if (ghost) ghost.style.transform = `translate(${x + 16}px,${y + 14}px)`
  }
  function anim(dur, fn) {
    const s = performance.now()
    return new Promise((res) => {
      const f = (now) => {
        if (stopped) return res()
        const t = Math.min(1, (now - s) / dur)
        fn(t)
        t < 1 ? requestAnimationFrame(f) : res()
      }
      requestAnimationFrame(f)
    }).then(() => { if (stopped) throw new Stop() })
  }
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
  // calm cursor: never faster than about half a second, longer for long trips
  function moveTo(target, o = {}) {
    const p = target && target.x !== undefined ? target : mid(target)
    const x0 = cx, y0 = cy, dx = p.x - x0, dy = p.y - y0, dist = Math.hypot(dx, dy)
    const arc = Math.min(34, dist * 0.08), nx = -dy / (dist || 1), ny = dx / (dist || 1)
    return anim(o.dur || Math.min(1250, Math.max(600, 480 + dist * 0.7)), (t) => {
      const e = ease(t), b = Math.sin(Math.PI * e) * arc
      put(x0 + dx * e + nx * b, y0 + dy * e + ny * b)
      if (o.each) o.each(cx, cy)
    })
  }
  async function press() {
    cur.classList.add('down')
    const r = document.createElement('div'); r.className = 'dm-rip'; r.style.left = cx + 'px'; r.style.top = cy + 'px'
    document.body.appendChild(r); setTimeout(() => r.remove(), 600)
    await wait(140)
    cur.classList.remove('down')
  }
  async function click(s, o = {}) {
    const e = await waitFor(s, o.t ?? 2000); if (!e) return false
    await moveTo(e); await wait(260); await press()
    const live = typeof s === 'object' ? e : q(s) || e // it may have been re-rendered while the cursor moved
    live.click()
    await wait(o.after ?? 900)
    return true
  }
  // switching tabs: the stage fades out, the tab changes, the stage fades back in
  async function tab(v, after = 700) {
    const sel = `#viewSeg [data-v="${v}"]`
    const e = await waitFor(sel); if (!e) return
    await moveTo(e); await wait(260); await press()
    document.body.classList.add('dm-fading'); await wait(260)
    q(sel).click()
    await wait(80); document.body.classList.remove('dm-fading')
    await wait(after)
  }
  async function hover(s, ms = 500, o = {}) {
    const e = await waitFor(s, o.t ?? 2000); if (!e) return null
    await moveTo(o.near ? near(e) : e)
    e.classList.add('dm-hover')
    e.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: cx, clientY: cy }))
    await wait(ms)
    e.classList.remove('dm-hover')
    return e
  }
  const pe = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, pointerType: 'mouse', isPrimary: true })
  // press on `from`, move to `to`, release: the map's own pointer handlers do the rest
  async function pdrag(from, to, dur = 1300) {
    await moveTo(from); await wait(250)
    cur.classList.add('down'); down = true
    from.dispatchEvent(pe('pointerdown', cx, cy))
    await moveTo(to, { dur, each: (x, y) => window.dispatchEvent(pe('pointermove', x, y)) })
    await wait(150)
    window.dispatchEvent(pe('pointerup', cx, cy))
    cur.classList.remove('down'); down = false
  }
  // HTML drag and drop, as when a folder row is dragged from "This PC" onto the whiteboard
  async function dragFolder(row, to, name) {
    await moveTo(row); await wait(250)
    cur.classList.add('down')
    const dt = new DataTransfer(), cv = $('canvas')
    const de = (type, x, y) => new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y })
    row.dispatchEvent(de('dragstart', cx, cy))
    ghost = document.createElement('div'); ghost.className = 'dm-ghost'; ghost.innerHTML = FOLDER + esc(name)
    document.body.appendChild(ghost); put(cx, cy)
    await moveTo(to, { dur: 1500, each: (x, y) => cv.dispatchEvent(de('dragover', x, y)) })
    await wait(200)
    cv.dispatchEvent(de('drop', cx, cy)); document.dispatchEvent(de('dragend', cx, cy))
    ghost.remove(); ghost = null
    cur.classList.remove('down')
  }

  /* ---------- camera ---------- */
  function camTo(b, ms = 900) {
    const a = { ...R.cam }
    return anim(ms, (t) => {
      const e = 1 - Math.pow(1 - t, 3)
      R.cam = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, z: a.z + (b.z - a.z) * e }
      c.applyCam()
    }).then(() => c.drawEdges())
  }
  async function fitAnim(ms = 900) { const a = { ...R.cam }; c.fitAll(); const b = { ...R.cam }; R.cam = a; c.applyCam(); await camTo(b, ms) }
  // folders sit side by side along the top of the map, 600 apart; this view shows two of them, from world x = wx
  const camAt = (wx = 0) => { const v = c.viewRect(); const z = Math.max(0.5, Math.min(0.9, (v.r - v.l - 36) / 1160)); return { z, x: v.l + 18 - wx * z, y: v.t + 16 } }
  // screen point that makes the map's drop handler place a box's corner at world (wx, wy)
  const dropPoint = (wx, wy) => ({ x: R.cam.x + (wx + 60) * R.cam.z, y: R.cam.y + (wy + 20) * R.cam.z })

  /* ---------- subtitles ---------- */
  function say(text, sub = '') {
    log.push([Math.round(performance.now() - t0), text])
    cap.classList.remove('show')
    setTimeout(() => {
      cap.innerHTML = `<b>${esc(text)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`
      cap.classList.add('show')
    }, 240)
  }

  /* ---------- replays ---------- */
  function claude(tool, kind, path, agent = 'main') {
    c.applyEvents([{ tool, kind, path, at: Date.now(), agent }], true)
    c.scheduleRender(); c.renderFeed()
  }
  // the progress toast of a real wiki build, played back from its log entry
  async function replayBuild(entry, pages, ms) {
    const reads = entry.reads.length ? entry.reads : entry.picked || []
    const writes = entry.writes.filter((w) => /\.md$/i.test(w) && !/[\\/]index\.md$/i.test(w))
    const shownR = reads.slice(0, 7), shownW = writes.slice(0, 4)
    const step = Math.max(200, (ms - 2000) / (shownR.length + shownW.length || 1))
    R.wiki.running = true; c.renderAll()
    R.prog = { text: c.t('ingestScan', entry.scanned, (entry.picked || reads).length, entry.model) }; c.showToast()
    await wait(1100)
    for (let i = 0; i < shownR.length; i++) { R.prog = { text: c.t('ingestRead', base(shownR[i]), i + 1, reads.length) }; c.showToast(); await wait(step) }
    for (const w of shownW) { R.prog = { text: c.t('ingestWrite', base(w)) }; c.showToast(); await wait(step) }
    R.wiki = { pages, log: [entry, ...R.wiki.log], running: false, dir: R.wiki.dir }
    R.prog = { done: true, text: c.t('ingestDone', writes.length, entry.cost) }; c.showToast(); c.renderAll()
    setTimeout(() => { if (R.prog && R.prog.done) { R.prog = null; c.showToast() } }, 3000)
    await wait(900)
  }

  /* ---------- the stage: an empty project, the tree open at the folders, the real wiki build ---------- */
  async function setup() {
    const root = R.roots.find((r) => r.key === 'desktop') || R.roots[0]; if (!root) return null
    const chain = [root.path]
    for (const s of PARENT) chain.push(chain[chain.length - 1] + '\\' + s)
    const par = chain[chain.length - 1], A = par + '\\' + FIRST, B = par + '\\' + SECOND, C = par + '\\' + THIRD
    if ((await api.exists(A)) !== 'dir' || (await api.exists(B)) !== 'dir') return null
    const hasC = (await api.exists(C)) === 'dir'

    // the English wiki built from A + B (first build) and then C (update); fall back to this project's wiki
    let w = null
    try { await api.wikiProject(DEMO_WIKI); w = await api.wikiPages() } finally { await api.wikiProject(ST.curProj) }
    if (!w || !w.pages.length) w = R.wiki
    const wrote = (e, p) => !!e && e.writes.some((x) => K(x) === K(p.file))
    let first = (w.log || []).find((e) => e.trigger === 'first' && e.writes.length)
    let upd = (w.log || []).find((e) => e.mode === 'update' && e.writes.length)
    const from = (dir) => (p) => p.sources.some((s) => inside(s, dir))
    let stage1 = first ? w.pages.filter((p) => wrote(first, p)) : []
    if (!stage1.length) stage1 = w.pages.filter((p) => from(A)(p) || from(B)(p))
    const stage2 = w.pages.filter((p) => stage1.includes(p) || from(C)(p) || wrote(upd, p))
    const fake = (pages, dirs, mode) => ({ when: new Date().toISOString(), mode, trigger: mode === 'first' ? 'first' : 'auto', model: mode === 'first' ? 'sonnet' : 'haiku', scanned: pages.length * 5, picked: [], reads: [...new Set(pages.flatMap((p) => p.sources.filter((s) => dirs.some((d) => inside(s, d)))))], writes: pages.map((p) => p.file), cost: null })
    if (!first) first = fake(stage1, [A, B], 'first')
    if (!upd) upd = fake(stage2.filter((p) => !stage1.includes(p)), [C], 'update')

    // files Claude will read: sources of the pages, from both first folders
    const exists = async (list) => (await Promise.all(list.map(async (p) => ((await api.exists(p)) === 'file' ? p : null)))).filter(Boolean)
    const srcA = await exists([...new Set(stage1.flatMap((p) => p.sources.filter((s) => inside(s, A))))].slice(0, 6))
    const srcB = await exists([...new Set(stage1.flatMap((p) => p.sources.filter((s) => inside(s, B))))].slice(0, 6))
    const a = srcA[0], b = srcB[0]
    const page = stage1.find((p) => p.sources.some((s) => K(s) === K(a))) || stage1[0]
    const reads = [srcA[0], srcB[0], srcA[1], srcB[1]].filter(Boolean)

    // an empty project, in English, with "This PC" open at the folders
    Object.assign(ST, { boxes: {}, links: [], pins: {}, hidden: {}, locked: {}, tedits: {}, seen: {}, openL: true, openR: true, guideOpen: false })
    Object.assign(R, { cur: null, events: [], touch: {}, blocked: {}, sel: null, hover: null, lens: null, view: 'map', left: 'pc', showPath: false, showLinks: false, pathAuto: false, turnSteps: 0, topen: {}, fan: {}, more: {}, editLink: null, linkFrom: null, wsel: null, wsTab: 'log', wmode: 'folder', wfolder: null, wfile: null, wopen: {} })
    R.wiki = { pages: [], log: [], running: false, dir: w.dir }
    for (const p of chain) { R.pcOpen[K(p)] = true; R.tree[K(p)] = await api.children(p) }
    c.setLang('en'); c.layoutChrome()
    R.cam = camAt(0)
    c.renderAll()
    const row = await waitFor(pcRowSel(A), 1500)
    if (row) { const list = $('leftList'); list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - 40 }
    return { A, B, C: hasC ? C : null, first, upd, stage1, stage2, a, b, page, reads }
  }
  const pcRowSel = (p) => () => document.querySelector(`#leftList [data-pc="${CSS.escape(p)}"]`)
  const boxEl = (p) => document.querySelector(`#world [data-box="${CSS.escape(K(p))}"]`)
  const cardOf = (p) => () => document.querySelector(`#world .card[data-k="${CSS.escape(K(p))}"]`)

  /* ---------- the tour ---------- */
  async function tour(S) {
    put(innerWidth * 0.55, innerHeight * 0.5)
    cur.classList.add('show')

    /* 0s · an empty project */
    say('CoExplorer: the file explorer you share with Claude Code', 'Start with an empty project')
    await hover('#emptyHint', 1800, { t: 400 })

    /* 4.5s · drag in the folders you need */
    await until(4.5)
    say('First, drag in the folders you need', 'Nothing is moved or copied. Your files stay where they are.')
    for (const [dir, name, wx] of [[S.A, FIRST, 0], [S.B, SECOND, 600]]) {
      const row = await waitFor(pcRowSel(dir)); if (!row) continue
      await dragFolder(row, dropPoint(wx, 0), name)
      await waitFor(() => boxEl(dir), 2000); await wait(500)
    }

    /* 12s · build the LLM wiki once, in the Wiki tab */
    await until(12)
    say('Then build the LLM wiki from them, once', 'Claude reads the files and writes topic pages, each line with its source')
    await tab('wiki', 500)
    await click('#soonBtn', { after: 200 })
    R.view = 'wiki'
    R.wmode = 'folder'; R.wfolder = S.A; R.wfile = null // the wiki opens on the first folder: the topics Claude found in it
    await replayBuild(S.first, S.stage1, 4200)
    await hover('#wikiPage .tpcard', 1300, { t: 800 })

    /* 21.5s · from now on, each folder you add updates the wiki */
    await until(21.5)
    if (S.C) {
      say('From now on, every folder you add updates the wiki', 'Only the new and changed files are read again')
      await tab('map', 300)
      await camTo(camAt(600), 900)
      const row = await waitFor(pcRowSel(S.C))
      if (row) {
        await dragFolder(row, dropPoint(1200, 0), THIRD)
        await waitFor(() => boxEl(S.C), 2000); await wait(300)
      }
      await replayBuild(S.upd, S.stage2, 3400)
    }

    /* 31s · where Claude reads, in order */
    await until(31)
    say('See exactly where Claude reads, and in what order', 'Each file lights up as Claude opens it, then the path replays')
    if (R.view !== 'map') await tab('map', 300)
    await camTo(camAt(0), 900)
    for (let i = 0; i < S.reads.length; i++) {
      claude('Read', 'read', S.reads[i], i === 2 ? 'sub' : 'main')
      await wait(250)
      const e = q(cardOf(S.reads[i])); if (vis(e)) await moveTo(near(e), { dur: 650 })
      await wait(250)
    }
    await click('#pathBtn', { after: 3200 })

    /* 40.5s · a person draws a relation */
    await until(40.5)
    R.showPath = false; c.renderAll()
    const ca = await waitFor(cardOf(S.a), 800), cb = await waitFor(cardOf(S.b), 800)
    if (ca && cb) {
      say('Draw a relation between two files', 'Drag one onto the other, then say what the link means')
      await moveTo(ca); ca.classList.add('dm-hover'); await wait(350)
      const h = ca.querySelector('.lkh')
      if (h) {
        await pdrag(h, mid(cb), 1400)
        await wait(500)
        await click('#selBox [data-ltype="basis"]', { after: 800 })
      }
    }

    /* 47.5s · the relation sits on top of the LLM wiki */
    await until(47.5)
    if (S.page) {
      say('Your relation sits on top of the LLM wiki', 'Claude reads what you set before anything it wrote itself')
      R.wmode = 'folder'; R.wfolder = S.A; R.wfile = null
      await tab('wiki', 200)
      // open the topic page from the folder's topic cards; your relation is in the block at its top
      if (!(await click(`#wikiPage .tpcard[data-wsel="${CSS.escape(S.page.slug)}"]`, { after: 300, t: 800 }))) { R.wsel = S.page.slug; R.wmode = 'topic'; c.renderAll() }
      const hb = await waitFor('#wikiPage .human', 800)
      if (hb) {
        $('wikiPage').scrollTop = 0
        hb.classList.add('dm-glow')
        const rows = hb.querySelectorAll('.r')
        await hover(rows[rows.length - 1] || hb, 2000)
      }
    }

    /* 54s · close */
    await until(54)
    say('CoExplorer', 'You and Claude, on the same map')
    await tab('map', 100)
    await fitAnim(1000)
    await moveTo({ x: innerWidth / 2, y: innerHeight * 0.42 }, { dur: 800 })
    await until(59)
  }

  /* ---------- run, then put everything back ---------- */
  const RK = ['wmode', 'wfolder', 'wfile', 'wopen', 'cur', 'view', 'sel', 'left', 'showPath', 'showLinks', 'lens', 'raw', 'wsel', 'wsTab', 'editLink', 'linkFrom', 'reading', 'hover', 'wiki', 'prog', 'pathAuto', 'pathT0', 'pathPlan', 'turnStart', 'turnSteps']
  function snapshot() {
    return {
      st: JSON.stringify(ST), lang: c.getLang(), events: R.events.slice(),
      r: Object.fromEntries(RK.map((k) => [k, R[k]])),
      obj: JSON.parse(JSON.stringify({ pcOpen: R.pcOpen, topen: R.topen, fan: R.fan, more: R.more, touch: R.touch, blocked: R.blocked, cam: R.cam })),
    }
  }
  function restore(s) {
    for (const k of Object.keys(ST)) delete ST[k]
    Object.assign(ST, JSON.parse(s.st))
    Object.assign(R, s.r, s.obj, { events: s.events, linkDrag: null })
    ;(R.pathHits || []).forEach(clearTimeout)
    c.setLang(s.lang); c.applyTheme(); c.layoutChrome(); c.showToast(); c.renderAll()
  }
  function mount() {
    cur = document.createElement('div'); cur.className = 'dm-cur'; cur.innerHTML = CURSOR
    cap = document.createElement('div'); cap.className = 'dm-cap'
    document.body.append(cur, cap)
  }
  async function run() {
    if (running) return log
    running = true; stopped = false; log = []
    const snap = snapshot()
    DM.on = true; document.body.classList.add('demo-on')
    const zoom0 = api.getZoom ? api.getZoom() : 1
    if (api.setZoom) { api.setZoom(ZOOM); await sleep(250) } // let the layout settle at the new size
    try {
      const S = await setup()
      mount(); t0 = performance.now()
      if (S) await tour(S)
      else { say('Demo folders not found', `Desktop\\${PARENT.join('\\')}\\${FIRST} and ${SECOND} are needed`); await wait(3000) }
    } catch (e) { if (!(e instanceof Stop)) console.warn('[demo] ' + ((e && e.stack) || e)) }
    log.push([Math.round(performance.now() - t0), 'end'])
    // release anything still held, then put the app back
    if (down) window.dispatchEvent(pe('pointerup', -10, -10))
    document.dispatchEvent(new DragEvent('dragend', { bubbles: true }))
    document.body.classList.remove('dm-fading')
    if (ghost) { ghost.remove(); ghost = null }
    if (cur) cur.classList.remove('show')
    if (cap) cap.classList.remove('show')
    await sleep(400)
    if (cur) cur.remove()
    if (cap) cap.remove()
    if (api.setZoom) { api.setZoom(zoom0); await sleep(150) }
    restore(snap)
    DM.on = false; running = false
    document.body.classList.remove('demo-on')
    return log
  }
  addEventListener('keydown', (e) => { if (running && e.key === 'Escape') stopped = true })
  $('demoBtn').onclick = () => { run() }
  window.__demo = run
}
