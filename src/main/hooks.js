// CoExplorer <-> Claude Code hooks.
// Installs a small standalone hook script (~/.coexplorer/coexplorer-hook.cjs) and registers it in
// the Claude Code settings file, so the rules a person marks in CoExplorer (hidden / locked / pins / links)
// reach Claude: as context at session start and on every prompt, and as hard denies before file tools run.
// Set COEX_HOME to use another folder than ~/.coexplorer (tests use this).
import fs from 'fs'
import os from 'os'
import { join, dirname } from 'path'

const COEX_HOME = process.env.COEX_HOME || join(os.homedir(), '.coexplorer')
const DEFAULT_SETTINGS = join(os.homedir(), '.claude', 'settings.json')

export const HOOK_SCRIPT = join(COEX_HOME, 'coexplorer-hook.cjs')
export const BLOCKED_LOG = join(COEX_HOME, 'blocked.log')

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse']
const PRE_TOOL_MATCHER = 'Read|Edit|MultiEdit|Write|NotebookEdit|Glob|Grep'
const HOOK_TIMEOUT_SEC = 5

// ---------------------------------------------------------------------------------------------
// The hook script. Plain CommonJS, no dependencies. Kept as a string so it can be written to disk
// as-is (no backticks or dollar-brace sequences inside, because this is a template literal).
// Usage: node coexplorer-hook.cjs <SessionStart|UserPromptSubmit|PreToolUse>   (hook JSON on stdin)
// ---------------------------------------------------------------------------------------------
const HOOK_SOURCE = String.raw`'use strict';
// CoExplorer hook. Written by the CoExplorer app; overwritten on every install. Do not edit.
// Fails open: any error, missing state, or more than 1.5 s -> exit 0 with no output.
var fs = require('fs');
var path = require('path');
var os = require('os');
var W = path.win32;

function quit() { try { process.exit(0); } catch (e) {} }
var killer = setTimeout(quit, 1500);
process.on('uncaughtException', quit);
process.on('unhandledRejection', quit);

var EVENT = process.argv[2] || '';
var HOME = process.env.COEX_HOME || path.join(os.homedir(), '.coexplorer');
var STATE = path.join(HOME, 'state.json');
var LOG = path.join(HOME, 'blocked.log');
var WIKI = path.join(HOME, 'wiki', 'index.md');
var WRITE_TOOLS = { Edit: 1, MultiEdit: 1, Write: 1, NotebookEdit: 1 };
var MAX_CONTEXT = 3000;

// ---- paths ----------------------------------------------------------------------------------
// Normalize a Windows path for comparison: / -> \, strip \\?\, map /c/... to c:\..., strip trailing
// dots/spaces of each segment, resolve . and .., lowercase, no trailing separator (except a root).
function norm(p, base) {
  if (typeof p !== 'string') return '';
  var s = p.trim();
  if (!s) return '';
  s = s.replace(/\//g, '\\');
  if (s.indexOf('\\\\?\\') === 0) {
    s = s.slice(4);
    if (/^unc\\/i.test(s)) s = '\\' + s.slice(3);
  }
  var m = /^\\([a-zA-Z])(\\|$)/.exec(s);
  if (m) s = m[1] + ':\\' + s.slice(3);
  s = s.split('\\').map(function (seg, i) {
    if (i === 0 || seg === '.' || seg === '..') return seg;
    var t = seg.replace(/[. ]+$/, '');
    return t || seg;
  }).join('\\');
  var b = base ? norm(base) : '';
  s = b ? W.resolve(b, s) : W.resolve(s);
  s = s.toLowerCase();
  if (s.length > 3 && s.charAt(s.length - 1) === '\\') s = s.slice(0, -1);
  return s;
}

// true if child is parent itself or lies under it (separator boundary: c:\ab is not inside c:\a)
function inside(child, parent) {
  if (!child || !parent) return false;
  if (child === parent) return true;
  var pre = parent.charAt(parent.length - 1) === '\\' ? parent : parent + '\\';
  return child.indexOf(pre) === 0;
}

// static (non-wildcard) leading part of a glob pattern, e.g. C:/a/b/**/*.md -> C:/a/b
function globPrefix(pattern) {
  var parts = String(pattern).replace(/\\/g, '/').split('/');
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    if (/[*?\[\]{}!]/.test(parts[i])) break;
    out.push(parts[i]);
  }
  if (out.length === parts.length) out.pop(); // last part is a file name pattern
  return out.join('/');
}

// ---- state ----------------------------------------------------------------------------------
function list(obj) {
  var out = [];
  if (Array.isArray(obj)) {
    obj.forEach(function (v) { if (typeof v === 'string' && v) out.push(v); });
  } else if (obj && typeof obj === 'object') {
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      out.push(typeof v === 'string' && v ? v : k);
    });
  }
  return out;
}

function loadState() {
  var raw;
  try { raw = fs.readFileSync(STATE, 'utf8'); } catch (e) { return null; }
  var st = JSON.parse(raw.replace(/^\uFEFF/, ''));
  if (!st || typeof st !== 'object') return null;
  var links = [];
  if (Array.isArray(st.links)) {
    st.links.forEach(function (l) {
      if (l && typeof l.a === 'string' && typeof l.b === 'string') links.push({ a: l.a, b: l.b, type: typeof l.type === 'string' ? l.type : '', rule: typeof l.rule === 'string' ? l.rule : '' });
    });
  }
  function withNorm(arr) {
    return arr.map(function (p) { return { orig: p, n: norm(p) }; }).filter(function (x) { return x.n; });
  }
  // folders the person put on the map (top-level boxes only): where this work happens
  var folders = [];
  if (st.boxes && typeof st.boxes === 'object') {
    Object.keys(st.boxes).forEach(function (k) {
      var b = st.boxes[k];
      if (b && typeof b.path === 'string' && b.path && !b.child && folders.indexOf(b.path) < 0) folders.push(b.path);
    });
  }
  return {
    folders: folders,
    hidden: withNorm(list(st.hidden)),
    locked: withNorm(list(st.locked)),
    pins: list(st.pins),
    links: links,
    en: st.lang === 'en', // Claude gets the rules in the app's language
    wiki: typeof st.wikiIndex === 'string' && st.wikiIndex ? st.wikiIndex : WIKI // the current project's wiki
  };
}

// ---- context (SessionStart / UserPromptSubmit) -----------------------------------------------
var RULE_EN = {
  use: 'when you read one, read the other too',
  replace: 'the first replaces the second; skip the second',
  related: 'related; use for reference only',
  flow: 'the output of the first feeds the second; follow this order',
  basis: 'the first is the basis; check it before you start'
};
function buildContext(st) {
  var en = !!st.en;
  var linkRule = function (l) { return en ? (RULE_EN[l.type] || l.rule) : l.rule; };
  var sections = [
    [en ? 'Folders on the map (what the person chose to work on; look for files here first):' : '지도에 올린 폴더 (사람이 고른 작업 대상. 파일은 이 폴더들 안에서 먼저 찾을 것):', st.folders || []],
    [en ? 'Hidden (never open or search):' : '숨김 (열거나 검색하지 말 것):', st.hidden.map(function (x) { return x.orig; })],
    [en ? 'Locked (read only, never edit):' : '잠금 (읽기만, 고치지 말 것):', st.locked.map(function (x) { return x.orig; })],
    [en ? 'Pinned (the reference file; skip other versions with the same name):' : '고정 (기준 파일, 같은 이름의 다른 버전은 건너뛸 것):', st.pins],
    [en ? 'Links (read these together):' : '연결 (함께 참고할 것):', st.links.map(function (l) { var r = linkRule(l); return l.a + ' → ' + l.b + (r ? ' (' + r + ')' : ''); })]
  ].filter(function (s) { return s[1].length; });
  if (!sections.length) return '';
  var head = en ? '[CoExplorer] Rules set by the person' : '[CoExplorer] 사람이 정한 규칙';
  var tail = (en ? 'Wiki: ' : '위키: ') + (st.wiki || WIKI) + (en ? ' (read it before the sources, if it exists)' : ' (있으면 원본보다 먼저 읽을 것)');
  var budget = MAX_CONTEXT - head.length - tail.length - 2;
  var lines = [];
  var used = 0;
  for (var i = 0; i < sections.length; i++) {
    var title = sections[i][0];
    var items = sections[i][1];
    if (used + title.length + 1 > budget - 20) break;
    lines.push(title); used += title.length + 1;
    for (var j = 0; j < items.length; j++) {
      var line = '- ' + items[j];
      var more = items.length - j;
      if (used + line.length + 1 > budget - 20) {
        var note = en ? '- \u2026 and ' + more + ' more' : '- \u2026 외 ' + more + '개';
        lines.push(note); used += note.length + 1;
        break;
      }
      lines.push(line); used += line.length + 1;
    }
  }
  var text = [head].concat(lines, [tail]).join('\n');
  return text.length > MAX_CONTEXT ? text.slice(0, MAX_CONTEXT) : text;
}

// ---- PreToolUse -----------------------------------------------------------------------------
function decide(input, st) {
  var tool = String(input.tool_name || '');
  var ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  var cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  var targets = [];
  if (tool === 'Glob' || tool === 'Grep') {
    var root = typeof ti.path === 'string' && ti.path ? ti.path : cwd;
    var eff = norm(root, cwd);
    if (tool === 'Glob' && typeof ti.pattern === 'string' && ti.pattern) {
      var pre = globPrefix(ti.pattern);
      if (pre) eff = norm(pre, eff);
    }
    targets.push({ raw: root, n: eff, search: true });
  } else {
    var fp = ti.file_path || ti.notebook_path || ti.path;
    if (typeof fp === 'string' && fp) targets.push({ raw: fp, n: norm(fp, cwd), search: false });
  }
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    if (!t.n) continue;
    for (var h = 0; h < st.hidden.length; h++) {
      if (inside(t.n, st.hidden[h].n)) {
        return { path: t.raw, reason: st.en ? 'CoExplorer: the person hid this folder (' + st.hidden[h].orig + '). Do not open or search this path.' : 'CoExplorer: 사람이 숨긴 폴더입니다 (' + st.hidden[h].orig + '). 이 경로는 열거나 검색하지 마세요.' };
      }
    }
    if (t.search) {
      for (var k = 0; k < st.hidden.length; k++) {
        if (inside(st.hidden[k].n, t.n)) {
          return { path: t.raw, reason: st.en ? 'CoExplorer: this search covers a folder the person hid (' + st.hidden[k].orig + '). Search again with a narrower path that leaves the hidden folder out.' : 'CoExplorer: 검색 범위 안에 사람이 숨긴 폴더가 있습니다 (' + st.hidden[k].orig + '). 숨긴 폴더가 들어가지 않는 더 좁은 경로를 지정해 다시 검색하세요.' };
        }
      }
    }
    if (WRITE_TOOLS[tool]) {
      for (var l = 0; l < st.locked.length; l++) {
        if (inside(t.n, st.locked[l].n)) {
          return { path: t.raw, reason: st.en ? 'CoExplorer: the person locked this folder (' + st.locked[l].orig + '). Read it only; do not edit it.' : 'CoExplorer: 사람이 잠근 폴더입니다 (' + st.locked[l].orig + '). 읽기만 하고 고치지 마세요.' };
        }
      }
    }
  }
  return null;
}

function out(obj) {
  try { fs.writeSync(1, JSON.stringify(obj)); } catch (e) {}
}

function main(raw) {
  var st = loadState();
  if (!st) return;
  if (EVENT === 'SessionStart' || EVENT === 'UserPromptSubmit') {
    var ctx = buildContext(st);
    if (ctx) out({ hookSpecificOutput: { hookEventName: EVENT, additionalContext: ctx } });
    return;
  }
  if (EVENT === 'PreToolUse') {
    if (!st.hidden.length && !st.locked.length) return;
    var input = JSON.parse(String(raw || '').replace(/^\uFEFF/, ''));
    if (!input || typeof input !== 'object') return;
    var d = decide(input, st);
    if (!d) return;
    try {
      fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), tool: String(input.tool_name || ''), path: d.path, reason: d.reason }) + '\n');
    } catch (e) {}
    out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: d.reason } });
  }
}

var buf = '';
var finished = false;
function finish() {
  if (finished) return;
  finished = true;
  try { main(buf); } catch (e) {}
  clearTimeout(killer);
  quit();
}
try {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (d) { buf += d; if (buf.length > 4000000) quit(); });
  process.stdin.on('end', finish);
  process.stdin.on('error', finish);
} catch (e) { quit(); }
`

export function writeHookScript() {
  fs.mkdirSync(COEX_HOME, { recursive: true })
  let current = null
  try { current = fs.readFileSync(HOOK_SCRIPT, 'utf8') } catch {}
  if (current !== HOOK_SOURCE) fs.writeFileSync(HOOK_SCRIPT, HOOK_SOURCE, 'utf8')
  return HOOK_SCRIPT
}

// ---- settings.json helpers ------------------------------------------------------------------
// Forward slashes work in both Git Bash (Claude Code's default hook shell on Windows) and PowerShell,
// and avoid backslash escapes; the double quotes protect spaces and non-ASCII characters.
function hookCommand(event) {
  return 'node "' + HOOK_SCRIPT.replace(/\\/g, '/') + '" ' + event
}

function ourGroup(event) {
  const handler = { type: 'command', command: hookCommand(event), timeout: HOOK_TIMEOUT_SEC }
  return event === 'PreToolUse' ? { matcher: PRE_TOOL_MATCHER, hooks: [handler] } : { hooks: [handler] }
}

const canon = (s) => String(s).replace(/\\/g, '/').toLowerCase()
const OUR_MARK = canon(HOOK_SCRIPT)
const isOurs = (h) => !!h && typeof h === 'object' && typeof h.command === 'string' && canon(h.command).includes(OUR_MARK)
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

function countOurs(groups) {
  let n = 0
  for (const g of groups) if (isObj(g) && Array.isArray(g.hooks)) n += g.hooks.filter(isOurs).length
  return n
}

// returns a new array without our handlers; groups emptied by the removal are dropped, others untouched
function stripOurs(groups) {
  const res = []
  for (const g of groups) {
    if (!isObj(g) || !Array.isArray(g.hooks) || !g.hooks.some(isOurs)) { res.push(g); continue }
    const kept = g.hooks.filter((h) => !isOurs(h))
    if (kept.length) res.push({ ...g, hooks: kept })
  }
  return res
}

function sameJSON(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

// { data, exists } or { error }
function readSettings(settingsPath) {
  let raw
  try { raw = fs.readFileSync(settingsPath, 'utf8') } catch (e) {
    if (e.code === 'ENOENT') return { data: {}, exists: false }
    return { error: `설정 파일을 읽을 수 없습니다: ${e.message}` }
  }
  raw = raw.replace(/^\uFEFF/, '')
  if (!raw.trim()) return { data: {}, exists: true }
  let data
  try { data = JSON.parse(raw) } catch (e) {
    return { error: `설정 파일이 올바른 JSON이 아니어서 건드리지 않았습니다: ${e.message}` }
  }
  if (!isObj(data)) return { error: '설정 파일의 최상위가 JSON 객체가 아니어서 건드리지 않았습니다.' }
  if (data.hooks !== undefined && !isObj(data.hooks)) return { error: '설정 파일의 "hooks" 항목이 객체가 아니어서 건드리지 않았습니다.' }
  return { data, exists: true }
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\..*$/, '')
}

function backupSettings(settingsPath) {
  let target = `${settingsPath}.coexplorer-backup-${stamp()}`
  let i = 2
  while (fs.existsSync(target)) target = `${settingsPath}.coexplorer-backup-${stamp()}-${i++}`
  fs.copyFileSync(settingsPath, target)
  return target
}

function writeSettings(settingsPath, data) {
  fs.mkdirSync(dirname(settingsPath), { recursive: true })
  const tmp = `${settingsPath}.coexplorer-tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, settingsPath)
}

// ---- public API -----------------------------------------------------------------------------
export function hookStatus(settingsPath = DEFAULT_SETTINGS) {
  const r = readSettings(settingsPath)
  const scriptPresent = fs.existsSync(HOOK_SCRIPT)
  if (r.error) return { installed: false, settingsPath, scriptPresent, error: r.error }
  const hooks = isObj(r.data.hooks) ? r.data.hooks : {}
  const installed = EVENTS.every((ev) => Array.isArray(hooks[ev]) && countOurs(hooks[ev]) > 0)
  return { installed, settingsPath, scriptPresent }
}

export function installHooks(settingsPath = DEFAULT_SETTINGS) {
  try {
    writeHookScript()
    const r = readSettings(settingsPath)
    if (r.error) return { ok: false, error: r.error }
    const data = r.data
    const hooks = isObj(data.hooks) ? data.hooks : {}
    let changed = false
    for (const ev of EVENTS) {
      if (hooks[ev] !== undefined && !Array.isArray(hooks[ev])) {
        return { ok: false, error: `설정 파일의 hooks.${ev} 항목이 배열이 아니어서 건드리지 않았습니다.` }
      }
      const groups = hooks[ev] || []
      const want = ourGroup(ev)
      // already exactly installed once -> leave it where it is
      if (countOurs(groups) === 1 && groups.some((g) => sameJSON(g, want))) continue
      hooks[ev] = [...stripOurs(groups), want]
      changed = true
    }
    if (!changed) return { ok: true, changed: false }
    data.hooks = hooks
    const backup = r.exists ? backupSettings(settingsPath) : undefined
    writeSettings(settingsPath, data)
    return { ok: true, changed: true, backup }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

export function uninstallHooks(settingsPath = DEFAULT_SETTINGS) {
  try {
    const r = readSettings(settingsPath)
    if (r.error) return { ok: false, error: r.error }
    if (!r.exists || !isObj(r.data.hooks)) return { ok: true, changed: false }
    const data = r.data
    const hooks = data.hooks
    let changed = false
    for (const ev of Object.keys(hooks)) {
      const groups = hooks[ev]
      if (!Array.isArray(groups) || countOurs(groups) === 0) continue
      // Emptied arrays are kept as []: an empty array may have been there before we installed,
      // and removing it is never needed (Claude Code treats [] as "no hooks").
      hooks[ev] = stripOurs(groups)
      changed = true
    }
    if (!changed) return { ok: true, changed: false }
    const backup = backupSettings(settingsPath)
    writeSettings(settingsPath, data)
    return { ok: true, changed: true, backup }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// New lines of blocked.log since byte offset `sinceBytes`. Only complete lines are consumed;
// pass the returned `next` on the following call. If the log shrank (rotated), starts over.
export function readBlocked(sinceBytes = 0) {
  let size
  try { size = fs.statSync(BLOCKED_LOG).size } catch { return { events: [], next: 0 } }
  let start = Number(sinceBytes) || 0
  if (start < 0 || start > size) start = 0
  if (start === size) return { events: [], next: start }
  const len = size - start
  const buf = Buffer.alloc(len)
  const fd = fs.openSync(BLOCKED_LOG, 'r')
  try { fs.readSync(fd, buf, 0, len, start) } finally { fs.closeSync(fd) }
  const end = buf.lastIndexOf(0x0a)
  if (end < 0) return { events: [], next: start }
  const events = []
  for (const line of buf.subarray(0, end + 1).toString('utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line)
      events.push({ at: e.at || '', tool: e.tool || '', path: e.path || '', reason: e.reason || '' })
    } catch {}
  }
  return { events, next: start + end + 1 }
}
