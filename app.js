// Created and modified by Claude (model: Claude Sonnet 5.5, Anthropic). AI-generated code: review and test before relying on it.
'use strict';

/* ======================================================================
   Settings: fill these in after registering your Google Cloud project
   (see README.md). All three values are public by design. Leave them empty
   and the app still works with the email / file fallback only.
   ====================================================================== */
const GOOGLE = {
  clientId: '', // OAuth 2.0 Web client ID
  apiKey: '',   // Browser API key (restrict to your site + Picker API)
  appId: ''     // Google Cloud project number (the Picker needs it)
};

const SCOPE_FILE = 'https://www.googleapis.com/auth/drive.file';
const SCOPE_READ = 'https://www.googleapis.com/auth/drive.readonly';
const MAX_SLOTS = 1500;
const LOCALE = (typeof navigator !== 'undefined' && navigator.language) || 'en-GB';
const GLYPH = { '0': '', '1': '\u2713', '2': '~' };

/* ====================== Generic helpers ====================== */
const p2 = n => String(n).padStart(2, '0');
const slug = s => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-')
  .replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'anon';

function hashId(str) { // FNV-1a, short id that ties responses to one version of a meeting
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64u = {
  enc(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
};

async function runStream(stream, bytes) {
  const w = stream.writable.getWriter();
  w.write(bytes);
  w.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** JSON -> compressed, URL-safe string. 'z' = deflate, 'j' = plain (no CompressionStream). */
async function pack(obj) {
  const raw = enc.encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'undefined') return 'j' + b64u.enc(raw);
  return 'z' + b64u.enc(await runStream(new CompressionStream('deflate-raw'), raw));
}

async function unpack(str) {
  const kind = str[0];
  const bytes = b64u.dec(str.slice(1));
  if (kind === 'j') return JSON.parse(dec.decode(bytes));
  if (kind === 'z') return JSON.parse(dec.decode(await runStream(new DecompressionStream('deflate-raw'), bytes)));
  throw new Error('Unknown format');
}

/* ====================== Time zones ====================== */
const _cache = {};
const cached = (k, make) => _cache[k] || (_cache[k] = make());
const partsFmt = tz => cached('p' + tz, () => new Intl.DateTimeFormat('en-US', {
  timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit'
}));
const dateFmt = tz => cached('d' + tz, () => new Intl.DateTimeFormat(LOCALE, {
  timeZone: tz, weekday: 'short', day: 'numeric', month: 'short'
}));

function validTz(z) {
  try { new Intl.DateTimeFormat('en', { timeZone: z }); return z; } catch (e) { return 'UTC'; }
}
function browserTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; }
}
function tzList(extra = []) {
  let l;
  try { l = Intl.supportedValuesOf('timeZone'); } catch (e) {
    l = ['Europe/Helsinki', 'Europe/Stockholm', 'Europe/Berlin', 'Europe/London', 'America/New_York',
      'America/Los_Angeles', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];
  }
  return [...new Set([...extra, ...l, 'UTC'])];
}

function zonedParts(ms, tz) {
  const o = {};
  for (const p of partsFmt(tz).formatToParts(ms)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute };
}
function tzOffsetMs(ms, tz) {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, 0) - ms;
}
/** Wall-clock time in `tz` -> UTC milliseconds (handles DST changes). */
function localToUtcMs(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let utc = guess - tzOffsetMs(guess, tz);
  const off2 = tzOffsetMs(utc, tz);
  if (guess - off2 !== utc) utc = guess - off2;
  return utc;
}

/** Slot start times as UTC epoch minutes. g = {a:'YYYY-MM-DD', b, wd:[0-6], f:'HH:MM', e:'HH:MM'} */
function generateSlots(g, len, tz) {
  const [fy, fm, fd] = g.a.split('-').map(Number);
  const [ty, tm, td] = g.b.split('-').map(Number);
  const [fh, fmi] = g.f.split(':').map(Number);
  const [eh, emi] = g.e.split(':').map(Number);
  const start = fh * 60 + fmi, end = eh * 60 + emi;
  const out = [];
  const first = Date.UTC(fy, fm - 1, fd), last = Date.UTC(ty, tm - 1, td);
  for (let t = first, n = 0; t <= last && n < 400; t += 86400000, n++) {
    const dt = new Date(t);
    if (!g.wd.includes(dt.getUTCDay())) continue;
    for (let s = start; s + len <= end; s += len) {
      out.push(localToUtcMs(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(),
        Math.floor(s / 60), s % 60, tz) / 60000);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

const deltaEncode = a => a.map((v, i) => (i ? v - a[i - 1] : v));
function deltaDecode(a) { let acc = 0; return a.map(d => (acc += d)); }

function fmtSlot(min, len, tz) {
  const ms = min * 60000;
  const t = x => { const p = zonedParts(x, tz); return `${p2(p.h)}:${p2(p.mi)}`; };
  return `${dateFmt(tz).format(ms)} ${t(ms)}\u2013${t(ms + len * 60000)}`;
}

/** Length in minutes of slot i. "Pick slots" meetings keep one length per slot. */
const slotLen = (cfg, i) => (cfg.lens ? cfg.lens[i] : cfg.l);
function fmtRange(min, len, tz) {
  const ms = min * 60000;
  const t = x => { const p = zonedParts(x, tz); return `${p2(p.h)}:${p2(p.mi)}`; };
  return `${t(ms)}\u2013${t(ms + len * 60000)}`;
}
function dayKey(min, tz) { const p = zonedParts(min * 60000, tz); return `${p.y}-${p2(p.m)}-${p2(p.d)}`; }

/** Layout for a list of slots in a given time zone: columns = days, rows = clock times. */
function buildGrid(slots, tz) {
  const dates = new Map(), times = new Set(), cell = new Map();
  slots.forEach((m, i) => {
    const ms = m * 60000, p = zonedParts(ms, tz);
    const dk = `${p.y}-${p2(p.m)}-${p2(p.d)}`, tk = `${p2(p.h)}:${p2(p.mi)}`;
    if (!dates.has(dk)) dates.set(dk, dateFmt(tz).format(ms));
    times.add(tk);
    cell.set(dk + '|' + tk, i);
  });
  return { dates: [...dates].sort((a, b) => (a[0] < b[0] ? -1 : 1)), times: [...times].sort(), cell };
}

/* ====================== Meeting config ====================== */
function normalizeConfig(raw) {
  if (!raw || raw.v !== 1 || !Array.isArray(raw.s) || !raw.s.length || raw.s.length > MAX_SLOTS ||
      !raw.s.every(Number.isFinite)) throw new Error('bad config');
  const mail = String(raw.m || '').slice(0, 200);
  const lens = Array.isArray(raw.ll) && raw.ll.length === raw.s.length && raw.ll.every(Number.isFinite)
    ? raw.ll.map(x => Math.min(Math.max(x, 5), 1440)) : null;
  return {
    k: raw.k === 'list' ? 'list' : 'grid',
    lens,
    t: String(raw.t || 'Meeting').slice(0, 120),
    n: String(raw.n || '').slice(0, 1000),
    l: Math.min(Math.max(+raw.l || 60, 5), 600),
    slots: deltaDecode(raw.s),
    z: validTz(raw.z || 'UTC'),
    m: /^[^\s@,;?&]+@[^\s@,;?&]+$/.test(mail) ? mail : '',
    f: String(raw.f || '').replace(/[^\w-]/g, '').slice(0, 100),
    p: (Array.isArray(raw.p) ? raw.p : []).map(x => String(x).slice(0, 80)).slice(0, 300),
    g: raw.g && typeof raw.g === 'object' ? raw.g : null
  };
}
const configId = cfg => hashId(JSON.stringify(cfg.lens ? [cfg.t, cfg.slots, cfg.lens] : [cfg.t, cfg.slots]));

/* ====================== Responses ====================== */
/** states: array of '0' (no), '1' (ok), '2' (acceptable), one per slot. */
function makeResponse(cfgId, name, tz, states) {
  return { v: 1, c: cfgId, n: name, z: tz, s: states.join(''), ts: Date.now() };
}

function aggregate(nSlots, responses) {
  const mk = () => Array.from({ length: nSlots }, () => []);
  const ok = mk(), acc = mk(), no = mk();
  for (const r of responses) {
    for (let i = 0; i < nSlots; i++) {
      const c = r.s[i];
      (c === '1' ? ok : c === '2' ? acc : no)[i].push(r.n);
    }
  }
  return { ok, acc, no };
}

/** Slot indices, best first: most people who can attend, then most who answered "ok". */
function rankSlots(agg) {
  const idx = agg.ok.map((_, i) => i);
  const att = i => agg.ok[i].length + agg.acc[i].length;
  return idx.sort((a, b) => att(b) - att(a) || agg.ok[b].length - agg.ok[a].length || a - b);
}

/* ====================== Google Drive ====================== */
const scriptPromises = {};
function loadScript(src) {
  return scriptPromises[src] || (scriptPromises[src] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = res;
    s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.append(s);
  }));
}

const tokens = {};
function getToken(scope) {
  return new Promise((res, rej) => {
    if (!GOOGLE.clientId) return rej(new Error('Google Drive is not set up on this site.'));
    const t = tokens[scope];
    if (t && t.exp > Date.now() + 30000) return res(t.v);
    loadScript('https://accounts.google.com/gsi/client').then(() => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE.clientId, scope,
        callback: r => {
          if (r.error) return rej(new Error(r.error_description || r.error));
          tokens[scope] = { v: r.access_token, exp: Date.now() + r.expires_in * 1000 };
          res(r.access_token);
        },
        error_callback: e => rej(new Error(e.message || e.type || 'Sign-in failed'))
      });
      client.requestAccessToken();
    }, rej);
  });
}

async function driveFetch(url, scope, opts = {}) {
  const t = await getToken(scope);
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + t, ...(opts.headers || {}) } });
  if (!r.ok) {
    const e = new Error(`Google Drive error ${r.status}`);
    e.status = r.status;
    try { e.detail = (await r.text()).slice(0, 200); } catch (x) { /* ignore */ }
    throw e;
  }
  return r;
}

/** Opens the Google Picker for a folder. With prefId it shows just that folder. */
async function pickFolder(prefId) {
  if (!GOOGLE.apiKey || !GOOGLE.appId) throw new Error('The folder picker needs apiKey and appId in app.js.');
  const t = await getToken(SCOPE_FILE);
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise(r => gapi.load('picker', r));
  return new Promise((res, rej) => {
    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true).setSelectFolderEnabled(true);
    if (prefId) view.setFileIds(prefId);
    new google.picker.PickerBuilder().addView(view).setOAuthToken(t)
      .setDeveloperKey(GOOGLE.apiKey).setAppId(GOOGLE.appId)
      .setCallback(d => {
        if (d.action === google.picker.Action.PICKED) res(d.docs[0]);
        else if (d.action === google.picker.Action.CANCEL) rej(new Error('Folder selection was cancelled.'));
      }).build().setVisible(true);
  });
}

const folderFlag = id => 'wm-folder-' + id;

async function saveToDrive(cfg, cfgId, resp) {
  let granted = false;
  try { granted = localStorage.getItem(folderFlag(cfg.f)) === '1'; } catch (e) { /* ignore */ }
  if (!granted) {
    const doc = await pickFolder(cfg.f);
    if (doc.id !== cfg.f) throw new Error('Please select the folder named in the invitation.');
    try { localStorage.setItem(folderFlag(cfg.f), '1'); } catch (e) { /* ignore */ }
  }
  const name = `response-${cfgId}-${slug(resp.n)}.json`;
  try {
    const q = encodeURIComponent(`name='${name}' and '${cfg.f}' in parents and trashed=false`);
    const found = await (await driveFetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, SCOPE_FILE)).json();
    const existing = found.files && found.files[0];
    const meta = existing ? { name } : { name, parents: [cfg.f], mimeType: 'application/json' };
    const boundary = 'wm' + Math.random().toString(36).slice(2);
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(resp)}\r\n--${boundary}--`;
    const url = existing
      ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    await driveFetch(url, SCOPE_FILE, {
      method: existing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
    });
  } catch (e) {
    if (e.status === 403 || e.status === 404) { try { localStorage.removeItem(folderFlag(cfg.f)); } catch (x) { /* ignore */ } }
    throw e;
  }
}

async function loadFromDrive(cfg, cfgId) {
  const q = encodeURIComponent(`'${cfg.f}' in parents and trashed=false`);
  const list = await (await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=1000&fields=files(id,name)`, SCOPE_READ)).json();
  const all = list.files || [];
  const mine = all.filter(f => f.name.startsWith(`response-${cfgId}-`));
  const got = await Promise.allSettled(mine.map(async f =>
    (await driveFetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, SCOPE_READ)).json()));
  return {
    items: got.filter(g => g.status === 'fulfilled').map(g => g.value),
    failed: got.filter(g => g.status === 'rejected').length,
    otherVersions: all.filter(f => f.name.startsWith('response-') && !f.name.startsWith(`response-${cfgId}-`)).length
  };
}

/* ====================== DOM helpers ====================== */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el; // text is always added as text nodes, never as HTML
}
const mount = () => { const r = document.getElementById('root'); r.replaceChildren(); return r; };
const baseUrl = () => location.href.split('#')[0];

function makeStatus() {
  const el = h('div', { class: 'status', 'aria-live': 'polite' });
  el.set = (msg, kind) => { el.textContent = msg || ''; el.className = 'status ' + (kind || ''); };
  return el;
}

function tzSelect(current, extra = []) {
  const sel = h('select');
  for (const z of tzList([current, ...extra])) sel.append(h('option', { value: z, selected: z === current }, z));
  return sel;
}

function copyButton(input) {
  return h('button', {
    type: 'button', onclick: async e => {
      try { await navigator.clipboard.writeText(input.value); } catch (x) { input.select(); document.execCommand('copy'); }
      e.target.textContent = 'Copied';
      setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
    }
  }, 'Copy');
}

function parseFolder(v) {
  v = v.trim();
  if (!v) return '';
  const m = v.match(/folders\/([\w-]+)/) || v.match(/[?&]id=([\w-]+)/);
  const id = m ? m[1] : v;
  return /^[\w-]{10,}$/.test(id) ? id : null;
}

function renderError(msg) {
  mount().append(h('div', { class: 'card' }, h('h1', {}, 'Meeting Finder'), h('p', {}, msg),
    h('p', {}, h('a', { href: baseUrl() }, 'Create a new meeting'))));
}

/* ====================== Organiser: setup ====================== */
function renderSetup(prev) {
  const root = mount();
  const g0 = (prev && prev.g) || {};
  const now = new Date();
  const mon = new Date(now); mon.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  const end = new Date(mon); end.setDate(mon.getDate() + 11);
  const iso = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const wdLabel = i => new Intl.DateTimeFormat(LOCALE, { weekday: 'short', timeZone: 'UTC' }).format(Date.UTC(2024, 0, 1 + i));
  const wdSet = new Set(g0.wd || [1, 2, 3, 4, 5]);
  let mode = prev && prev.k === 'list' ? 'list' : 'grid';
  const manual = prev && prev.k === 'list' ? prev.slots.map((m, i) => ({ m, len: slotLen(prev, i) })) : [];

  const f = {
    title: h('input', { type: 'text', maxlength: 120, value: prev ? prev.t : '', placeholder: 'e.g. Project kick-off' }),
    notes: h('textarea', { maxlength: 1000 }, prev ? prev.n : ''),
    tz: tzSelect(prev ? prev.z : browserTz()),
    a: h('input', { type: 'date', value: g0.a || iso(mon) }),
    b: h('input', { type: 'date', value: g0.b || iso(end) }),
    from: h('input', { type: 'time', value: g0.f || '09:00' }),
    to: h('input', { type: 'time', value: g0.e || '17:00' }),
    len: h('select'),
    md: h('input', { type: 'date', value: iso(mon) }),
    mt: h('input', { type: 'time', value: '10:00' }),
    ml: h('select'),
    folder: h('input', { type: 'text', value: prev ? prev.f : '', placeholder: 'Folder link or ID' }),
    mail: h('input', { type: 'email', value: prev ? prev.m : '', placeholder: 'organiser@example.org' }),
    people: h('textarea', { placeholder: 'One name per line' }, prev ? prev.p.join('\n') : '')
  };
  for (const n of [15, 30, 45, 60, 90, 120]) {
    f.len.append(h('option', { value: n, selected: n === (prev && prev.k !== 'list' ? prev.l : 60) }, n + ' minutes'));
  }
  for (const n of [15, 30, 45, 60, 90, 120, 180, 240]) {
    f.ml.append(h('option', { value: n, selected: n === 60 }, n + ' minutes'));
  }
  const wdBoxes = [1, 2, 3, 4, 5, 6, 0].map(d => ({
    d, input: h('input', { type: 'checkbox', value: d, checked: wdSet.has(d) })
  }));
  const preview = h('p', { class: 'muted' });
  const status = makeStatus();
  const out = h('div');
  const manualHost = h('div');
  const modeHint = h('p', { class: 'muted' });

  function read() {
    const tz = f.tz.value;
    if (mode === 'list') {
      const sorted = [...manual].sort((x, y) => x.m - y.m);
      return { g: null, len: 60, tz, slots: sorted.map(s => s.m), lens: sorted.map(s => s.len) };
    }
    const g = { a: f.a.value, b: f.b.value, wd: wdBoxes.filter(x => x.input.checked).map(x => x.d), f: f.from.value, e: f.to.value };
    const len = +f.len.value;
    let slots = [];
    if (g.a && g.b && g.f && g.e && g.a <= g.b && g.f < g.e) slots = generateSlots(g, len, tz);
    return { g, len, tz, slots, lens: null };
  }
  function updatePreview() {
    const { slots } = read();
    if (mode === 'list') {
      preview.textContent = slots.length ? `${slots.length} slot${slots.length === 1 ? '' : 's'} chosen` : 'No slots yet: add some above.';
      return;
    }
    const days = new Set(slots.map(m => zonedParts(m * 60000, f.tz.value))
      .map(p => `${p.y}-${p.m}-${p.d}`)).size;
    preview.textContent = slots.length
      ? `${slots.length} slots on ${days} days` + (slots.length > MAX_SLOTS ? ` (too many, the limit is ${MAX_SLOTS})` : '')
      : 'No slots yet: check dates, weekdays and hours.';
  }

  function renderManual() {
    manual.sort((x, y) => x.m - y.m);
    manualHost.replaceChildren(manual.length
      ? h('ul', { class: 'slotlist' }, manual.map((s, i) => h('li', {},
        h('span', {}, `${fmtSlot(s.m, s.len, f.tz.value)} (${s.len} min)`),
        h('button', { type: 'button', 'aria-label': 'Remove this slot', onclick: () => { manual.splice(i, 1); renderManual(); updatePreview(); } }, '×'))))
      : h('p', { class: 'muted' }, 'No slots added yet.'));
  }
  function addManual() {
    if (!f.md.value || !f.mt.value) return status.set('Choose a date and a start time.', 'err');
    const [y, mo, d] = f.md.value.split('-').map(Number);
    const [hh, mi] = f.mt.value.split(':').map(Number);
    const m = localToUtcMs(y, mo, d, hh, mi, f.tz.value) / 60000;
    if (manual.some(s => s.m === m)) return status.set('That start time is already in the list.', 'err');
    if (manual.length >= MAX_SLOTS) return status.set(`At most ${MAX_SLOTS} slots are allowed.`, 'err');
    manual.push({ m, len: +f.ml.value });
    status.set('');
    renderManual(); updatePreview();
  }

  const gridSec = h('div', {},
    h('div', { class: 'row' }, h('div', {}, h('label', {}, 'First day'), f.a), h('div', {}, h('label', {}, 'Last day'), f.b)),
    h('label', {}, 'Days of the week'), h('div', { class: 'days' }, wdBoxes.map(x => h('label', {}, x.input, wdLabel([1, 2, 3, 4, 5, 6, 0].indexOf(x.d))))),
    h('div', { class: 'row' },
      h('div', {}, h('label', {}, 'Each day from'), f.from),
      h('div', {}, h('label', {}, 'until'), f.to),
      h('div', {}, h('label', {}, 'Slot length'), f.len)));
  const listSec = h('div', {},
    h('div', { class: 'row' },
      h('div', {}, h('label', {}, 'Date'), f.md),
      h('div', {}, h('label', {}, 'Start time'), f.mt),
      h('div', {}, h('label', {}, 'Length'), f.ml)),
    h('div', { class: 'actions' },
      h('button', { type: 'button', onclick: addManual }, 'Add slot'),
      h('button', { type: 'button', onclick: () => { manual.length = 0; renderManual(); updatePreview(); } }, 'Clear all')),
    manualHost);

  const modeBtns = [['grid', 'Time grid (When2Meet style)'], ['list', 'Pick individual slots (Doodle style)']].map(([v, label]) => {
    const b = h('button', { type: 'button', 'aria-pressed': v === mode, onclick: () => setMode(v) }, label);
    b.dataset.v = v;
    return b;
  });
  function setMode(v) {
    mode = v;
    modeBtns.forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v));
    gridSec.hidden = v !== 'grid';
    listSec.hidden = v !== 'list';
    modeHint.textContent = v === 'grid'
      ? 'Regular slots on every chosen day. Participants can pick any times that suit them.'
      : 'You choose the exact options, each with its own date, start time and length. Best when you only have a few candidates.';
    renderManual(); updatePreview();
  }
  [f.a, f.b, f.from, f.to, f.len, f.tz, ...wdBoxes.map(x => x.input)].forEach(el => el.addEventListener('input', updatePreview));
  f.tz.addEventListener('input', renderManual);

  const pickBtn = GOOGLE.clientId && GOOGLE.apiKey && GOOGLE.appId
    ? h('button', {
      type: 'button', onclick: async () => {
        try { const d = await pickFolder(); f.folder.value = d.id; status.set(`Folder selected: ${d.name}`, 'ok'); }
        catch (e) { status.set(e.message, 'err'); }
      }
    }, 'Pick folder from Drive') : null;

  async function create() {
    const title = f.title.value.trim();
    const r = read();
    const folder = parseFolder(f.folder.value);
    const mail = f.mail.value.trim();
    if (!title) return status.set('Please give the meeting a title.', 'err');
    if (!r.slots.length) return status.set(mode === 'list' ? 'Add at least one time slot.' : 'There are no time slots yet.', 'err');
    if (r.slots.length > MAX_SLOTS) return status.set(`Too many slots (max ${MAX_SLOTS}). Shorten the date range.`, 'err');
    if (folder === null) return status.set('The folder link or ID does not look right.', 'err');
    if (mail && !/^[^\s@,;?&]+@[^\s@,;?&]+$/.test(mail)) return status.set('The email address does not look right.', 'err');
    const people = f.people.value.split('\n').map(s => s.trim()).filter(Boolean);
    const base = { v: 1, t: title, n: f.notes.value.trim(), l: r.len, s: deltaEncode(r.slots), z: r.tz, m: mail, f: folder, p: people };
    const raw = mode === 'list' ? { ...base, k: 'list', ll: r.lens } : { ...base, g: r.g };
    const packed = await pack(raw);
    const link = v => `${baseUrl()}#c=${packed}${v ? '&v=' + v : ''}`;
    const row = (label, url, hint) => {
      const inp = h('input', { type: 'text', readonly: true, value: url });
      return h('div', {}, h('label', {}, label), hint && h('div', { class: 'muted' }, hint),
        h('div', { class: 'linkrow' }, inp, copyButton(inp), h('a', { href: url, target: '_blank', rel: 'noopener' }, h('button', { type: 'button' }, 'Open'))));
    };
    out.replaceChildren(h('div', { class: 'card' },
      h('h2', {}, 'Your links'),
      row('Send this to participants', link('')),
      row('Results (for you)', link('results'), 'Only people who can read the Drive folder will see Drive answers.'),
      row('Edit this meeting later', link('edit'), 'Changing dates or times creates a new version: earlier answers will not match.'),
      !folder && !mail ? h('p', { class: 'status err' }, 'No folder or email is set, so participants can only download a file and send it to you by hand.') : null,
      packed.length > 2500 ? h('p', { class: 'muted' }, 'This link is long. Some chat apps cut long links; email usually works.') : null));
    status.set('');
    out.scrollIntoView({ behavior: 'smooth' });
  }

  root.append(
    h('h1', {}, prev ? 'Edit meeting' : 'Find a meeting time'),
    h('p', { class: 'muted' }, 'Choose possible time slots, then share the generated link. Everything you enter is stored in the link itself.'),
    h('div', { class: 'card' },
      h('h2', {}, '1. The meeting'),
      h('label', {}, 'Title'), f.title,
      h('label', {}, 'Notes for participants (optional)'), f.notes),
    h('div', { class: 'card' },
      h('h2', {}, '2. Possible time slots'),
      h('div', { class: 'brushes' }, modeBtns),
      modeHint,
      h('label', {}, 'These times are in time zone'), f.tz,
      gridSec, listSec, preview),
    h('div', { class: 'card' },
      h('h2', {}, '3. Where answers go'),
      h('label', {}, 'Google Drive folder (participants need edit access)'),
      h('div', { class: 'linkrow' }, f.folder, pickBtn),
      h('label', {}, 'Email address for the email fallback'), f.mail,
      h('label', {}, 'Expected participants (optional, to see who has not answered)'), f.people),
    h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', onclick: create }, 'Create links')),
    status, out);
  setMode(mode);
}

/* ====================== Participant ====================== */
function renderParticipant(cfg) {
  const id = configId(cfg);
  const root = mount();
  let tz = browserTz();
  let brush = '1';
  let dragging = false;
  let states = Array(cfg.slots.length).fill('0');
  let els = [];
  let savedName = '';
  try {
    const d = JSON.parse(localStorage.getItem('wm-draft-' + id) || 'null');
    if (d) { savedName = d.name || ''; if (typeof d.s === 'string' && d.s.length === states.length) states = [...d.s]; }
  } catch (e) { /* ignore */ }

  const nameIn = h('input', { type: 'text', maxlength: 80, value: savedName, autocomplete: 'name' });
  const tzSel = tzSelect(tz);
  const gridHost = h('div', { class: 'grid-wrap' });
  const status = makeStatus();
  const saveDraft = () => { try { localStorage.setItem('wm-draft-' + id, JSON.stringify({ name: nameIn.value, s: states.join('') })); } catch (e) { /* ignore */ } };
  nameIn.addEventListener('input', saveDraft);
  window.addEventListener('pointerup', () => { dragging = false; });

  function paint(i) {
    states[i] = brush;
    els[i].dataset.s = brush;
    els[i].textContent = GLYPH[brush];
    saveDraft();
  }

  function drawGrid() {
    const g = buildGrid(cfg.slots, tz);
    els = [];
    const head = h('tr', {}, h('th', { class: 'corner' }));
    g.dates.forEach(([dk, label]) => head.append(h('th', {
      class: 'colh', title: 'Apply the selected mark to this whole day',
      onclick: () => g.times.forEach(tk => { const i = g.cell.get(dk + '|' + tk); if (i != null) paint(i); })
    }, label)));
    const body = h('tbody');
    g.times.forEach(tk => {
      const tr = h('tr', {}, h('th', {
        class: 'rowh', title: 'Apply the selected mark to this whole row',
        onclick: () => g.dates.forEach(([dk]) => { const i = g.cell.get(dk + '|' + tk); if (i != null) paint(i); })
      }, tk));
      g.dates.forEach(([dk]) => {
        const i = g.cell.get(dk + '|' + tk);
        if (i == null) return tr.append(h('td', { class: 'void' }));
        const label = fmtSlot(cfg.slots[i], slotLen(cfg, i), tz);
        const td = h('td', { class: 'cell', tabindex: 0, role: 'button', 'aria-label': label, title: label, 'data-s': states[i] }, GLYPH[states[i]]);
        td.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button === 0) { dragging = true; paint(i); e.preventDefault(); } });
        td.addEventListener('pointerenter', () => { if (dragging) paint(i); });
        td.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') paint(i); });
        td.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); paint(i); } });
        els[i] = td;
        tr.append(td);
      });
      body.append(tr);
    });
    gridHost.replaceChildren(h('table', { class: 'grid' }, h('thead', {}, head), body));
  }
  /* "Pick slots" meetings: one row per option with three buttons, instead of a grid */
  function drawList() {
    els = [];
    const host = h('div', { class: 'optlist' });
    let day = '';
    cfg.slots.forEach((m, i) => {
      const dk = dayKey(m, tz);
      if (dk !== day) { day = dk; host.append(h('h3', { class: 'dayhead' }, dateFmt(tz).format(m * 60000))); }
      const seg = [['1', 'OK'], ['2', 'Acceptable'], ['0', 'No']].map(([v, label]) => {
        const b = h('button', { type: 'button', class: 'seg', 'aria-pressed': states[i] === v, onclick: () => {
          states[i] = v; seg.forEach(x => x.setAttribute('aria-pressed', x.dataset.v === v)); saveDraft();
        } }, h('span', { class: 'swatch' }, GLYPH[v] || '\u00d7'), label);
        b.dataset.v = v;
        return b;
      });
      host.append(h('div', { class: 'optrow' },
        h('span', { class: 'opttime' }, fmtRange(m, slotLen(cfg, i), tz)), h('div', { class: 'segs' }, seg)));
    });
    gridHost.replaceChildren(host);
  }
  const draw = () => (cfg.k === 'list' ? drawList() : drawGrid());
  tzSel.addEventListener('input', () => { tz = tzSel.value; draw(); });

  const brushBtns = [['1', 'OK'], ['2', 'Acceptable'], ['0', 'No']].map(([v, label]) => {
    const b = h('button', { type: 'button', 'aria-pressed': v === brush, onclick: () => {
      brush = v; brushBtns.forEach(x => x.setAttribute('aria-pressed', x.dataset.v === v));
    } }, h('span', { class: 'swatch' }, GLYPH[v] || '\u00d7'), label);
    b.dataset.v = v;
    return b;
  });

  function build() {
    const n = nameIn.value.trim();
    if (!n) throw new Error('Please enter your name.');
    if (!states.includes('1') && !states.includes('2') &&
        !confirm('Every slot is marked "No". Send it anyway?')) return null;
    return makeResponse(id, n, tz, states);
  }

  const actions = h('div', { class: 'actions' });
  if (GOOGLE.clientId && cfg.f) {
    actions.append(h('button', { class: 'primary', type: 'button', onclick: async () => {
      try {
        const r = build(); if (!r) return;
        status.set('Saving to Google Drive\u2026');
        await saveToDrive(cfg, id, r);
        status.set('Saved. You can reopen this link and save again to change your answer.', 'ok');
      } catch (e) { status.set((e.message || 'Failed') + (cfg.m ? ' You can use the email option instead.' : ' You can download the file instead.'), 'err'); }
    } }, 'Save to Google Drive'));
  }
  if (cfg.m) {
    actions.append(h('button', { class: cfg.f && GOOGLE.clientId ? '' : 'primary', type: 'button', onclick: async () => {
      try {
        const r = build(); if (!r) return;
        const body = `Hello,\n\nMy availability for "${cfg.t}" is below. Please do not edit the line starting with WMRESP:\n\nWMRESP:${await pack(r)}\n`;
        location.href = `mailto:${cfg.m}?subject=${encodeURIComponent('Availability: ' + cfg.t)}&body=${encodeURIComponent(body)}`;
        status.set('Your email program should open with the answer in the message. Just send it.', 'ok');
      } catch (e) { status.set(e.message, 'err'); }
    } }, 'Send by email'));
  }
  actions.append(h('button', { type: 'button', onclick: () => {
    try {
      const r = build(); if (!r) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(r)], { type: 'application/json' }));
      const a = h('a', { href: url, download: `response-${id}-${slug(r.n)}.json` });
      document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      status.set('File downloaded. Send it to the organiser.', 'ok');
    } catch (e) { status.set(e.message, 'err'); }
  } }, 'Download file'));

  root.append(
    h('h1', {}, cfg.t),
    cfg.n && h('p', { style: 'white-space:pre-wrap' }, cfg.n),
    h('div', { class: 'card' },
      h('div', { class: 'row' }, h('div', {}, h('label', {}, 'Your name'), nameIn), h('div', {}, h('label', {}, 'Your time zone'), tzSel)),
      h('label', {}, 'Mark the slots'),
      cfg.k === 'list'
        ? h('p', { class: 'muted' }, 'Choose OK, Acceptable or No for each option. Options left on "No" count as unavailable.')
        : h('p', { class: 'muted' }, 'Pick a mark, then click or drag over the slots. Click a day or time label to fill the whole column or row. Unmarked slots count as "No".'),
      cfg.k === 'list' ? null : h('div', { class: 'brushes' }, brushBtns),
      gridHost),
    h('div', { class: 'card' }, h('h2', {}, 'Send your answer'), actions, status));
  draw();
}

/* ====================== Organiser: results ====================== */
function renderResults(cfg) {
  const id = configId(cfg);
  const root = mount();
  let tz = browserTz();
  let selected = null;
  const store = new Map(); // lower-cased name -> response (latest wins)

  const status = makeStatus();
  const tzSel = tzSelect(tz, [cfg.z]);
  const summary = h('div');
  const picks = h('div');
  const heatHost = h('div', { class: 'grid-wrap' });
  const detail = h('div', { class: 'detail' });
  const pasteIn = h('textarea', { placeholder: 'Paste emails or WMRESP:\u2026 lines here' });
  const fileIn = h('input', { type: 'file', multiple: true, accept: '.json,.txt,.eml' });

  /** Returns true when the response was accepted. */
  function addResponse(r) {
    if (!r || typeof r.n !== 'string' || typeof r.s !== 'string') return false;
    if (r.c && r.c !== id) return false;
    if (r.s.length !== cfg.slots.length || !/^[012]+$/.test(r.s)) return false;
    const key = r.n.trim().toLowerCase();
    if (!key) return false;
    const prev = store.get(key);
    if (!prev || (+r.ts || 0) >= (+prev.ts || 0)) store.set(key, { n: r.n.trim().slice(0, 80), z: r.z, s: r.s, ts: +r.ts || 0 });
    return true;
  }
  async function ingestText(text) {
    let ok = 0, bad = 0;
    const t = text.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try { for (const o of [].concat(JSON.parse(t))) (addResponse(o) ? ok++ : bad++); return { ok, bad }; } catch (e) { /* fall through */ }
    }
    for (const m of text.matchAll(/WMRESP:([zj][\w-]+)/g)) {
      try { (addResponse(await unpack(m[1])) ? ok++ : bad++); } catch (e) { bad++; }
    }
    return { ok, bad };
  }
  const report = ({ ok, bad }) => status.set(
    `${ok} answer(s) added.` + (bad ? ` ${bad} could not be used (damaged, or for another version of this meeting).` : ''), bad ? 'err' : 'ok');

  const attendance = (agg, i) => agg.ok[i].length + agg.acc[i].length;

  function showDetail(i, agg, pending) {
    selected = i;
    const list = (title, arr) => h('div', {}, h('h3', {}, `${title} (${arr.length})`),
      arr.length ? h('div', { class: 'chips' }, arr.map(n => h('span', { class: 'chip' }, n))) : h('p', { class: 'muted' }, '\u2014'));
    detail.replaceChildren(h('div', { class: 'card' }, h('h2', {}, fmtSlot(cfg.slots[i], slotLen(cfg, i), tz)),
      list('OK', agg.ok[i]), list('Acceptable', agg.acc[i]), list('No', agg.no[i]),
      pending.length ? list('No answer yet', pending) : null));
    draw();
  }

  function drawListHeat(N, agg, best, pending) {
    const host = h('div', { class: 'optlist' });
    let day = '';
    cfg.slots.forEach((m, i) => {
      const dk = dayKey(m, tz);
      if (dk !== day) { day = dk; host.append(h('h3', { class: 'dayhead' }, dateFmt(tz).format(m * 60000))); }
      const ok = agg.ok[i].length, ac = agg.acc[i].length;
      const label = `${fmtSlot(m, slotLen(cfg, i), tz)}: ${ok} OK, ${ac} acceptable`;
      host.append(h('button', {
        type: 'button', class: 'optres' + (best.has(i) ? ' best' : '') + (selected === i ? ' sel' : ''), title: label, 'aria-label': label,
        onclick: () => showDetail(i, agg, pending)
      },
      h('span', { class: 'opttime' }, fmtRange(m, slotLen(cfg, i), tz)),
      h('span', { class: 'bar' }, N ? [h('i', { class: 'b-ok', style: `width:${ok / N * 100}%` }), h('i', { class: 'b-acc', style: `width:${ac / N * 100}%` })] : null),
      h('span', { class: 'cnt' }, ac ? `${ok}+${ac}` : `${ok}`)));
    });
    heatHost.replaceChildren(host);
  }

  function draw() {
    const resp = [...store.values()];
    const N = resp.length;
    const agg = aggregate(cfg.slots.length, resp);
    const ranks = rankSlots(agg);
    const best = new Set(N ? ranks.slice(0, 3).filter(i => attendance(agg, i) > 0) : []);
    const pending = cfg.p.filter(x => !store.has(x.trim().toLowerCase()));

    summary.replaceChildren(
      h('p', {}, `${N} answer${N === 1 ? '' : 's'} so far.`),
      N ? h('div', { class: 'chips' }, resp.map(r => h('span', { class: 'chip' }, r.n))) : null,
      pending.length ? h('p', { class: 'muted' }, 'No answer yet:') : null,
      pending.length ? h('div', { class: 'chips' }, pending.map(n => h('span', { class: 'chip pending' }, n))) : null);

    const topList = N ? ranks.slice(0, 5).filter(i => attendance(agg, i) > 0) : [];
    picks.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Best options'),
      topList.length ? h('ol', { class: 'picks' }, topList.map(i => h('li', {},
        h('button', { type: 'button', onclick: () => showDetail(i, agg, pending) }, fmtSlot(cfg.slots[i], slotLen(cfg, i), tz)),
        ` \u2013 ${agg.ok[i].length} OK, ${agg.acc[i].length} acceptable` +
        (agg.no[i].length ? `; cannot: ${agg.no[i].join(', ')}` : '')))) : h('p', { class: 'muted' }, 'Nothing to rank yet.'),
      h('p', { class: 'muted' }, 'Ranked by how many people can attend, then by how many answered "OK".')));

    if (cfg.k === 'list') { drawListHeat(N, agg, best, pending); return; }
    const g = buildGrid(cfg.slots, tz);
    const head = h('tr', {}, h('th', {}));
    g.dates.forEach(([, label]) => head.append(h('th', {}, label)));
    const body = h('tbody');
    g.times.forEach(tk => {
      const tr = h('tr', {}, h('th', { class: 'rowh' }, tk));
      g.dates.forEach(([dk]) => {
        const i = g.cell.get(dk + '|' + tk);
        if (i == null) return tr.append(h('td', { class: 'void' }));
        const ok = agg.ok[i].length, ac = agg.acc[i].length;
        const label = `${fmtSlot(cfg.slots[i], slotLen(cfg, i), tz)}: ${ok} OK, ${ac} acceptable`;
        const cellEl = h('button', {
          type: 'button', class: 'heat' + (best.has(i) ? ' best' : '') + (selected === i ? ' sel' : ''), title: label, 'aria-label': label,
          onclick: () => showDetail(i, agg, pending)
        },
        N ? h('div', { class: 'fill' },
          h('div', { class: 'f-ok', style: `height:${ok / N * 100}%` }),
          h('div', { class: 'f-acc', style: `height:${ac / N * 100}%` })) : null,
        N ? h('div', { class: 'num' }, h('span', {}, ac ? `${ok}+${ac}` : `${ok}`)) : null);
        tr.append(h('td', {}, cellEl));
      });
      body.append(tr);
    });
    heatHost.replaceChildren(h('table', { class: 'grid' }, h('thead', {}, head), body));
  }

  tzSel.addEventListener('input', () => { tz = tzSel.value; selected = null; detail.replaceChildren(); draw(); });

  const driveBtn = GOOGLE.clientId && cfg.f ? h('button', { class: 'primary', type: 'button', onclick: async () => {
    try {
      status.set('Reading the Drive folder\u2026');
      const r = await loadFromDrive(cfg, id);
      let ok = 0, bad = r.failed;
      r.items.forEach(o => (addResponse(o) ? ok++ : bad++));
      report({ ok, bad });
      if (r.otherVersions) status.set(status.textContent + ` ${r.otherVersions} file(s) in the folder belong to an older version of this meeting and were ignored.`, bad ? 'err' : 'ok');
      selected = null; detail.replaceChildren(); draw();
    } catch (e) { status.set((e.message || 'Failed') + (e.detail ? ' ' + e.detail : ''), 'err'); }
  } }, 'Load answers from Drive') : null;

  fileIn.addEventListener('change', async () => {
    let ok = 0, bad = 0;
    for (const f of fileIn.files) { const r = await ingestText(await f.text()); ok += r.ok; bad += r.bad; }
    fileIn.value = ''; report({ ok, bad }); draw();
  });

  root.append(
    h('h1', {}, cfg.t),
    h('div', { class: 'card' }, h('h2', {}, 'Collect answers'),
      driveBtn ? h('div', { class: 'actions' }, driveBtn) : h('p', { class: 'muted' }, 'Drive is not configured for this meeting, so use files or pasted emails.'),
      h('label', {}, 'Answer files (.json)'), fileIn,
      h('label', {}, 'Answers received by email'), pasteIn,
      h('div', { class: 'actions' }, h('button', { type: 'button', onclick: async () => {
        const r = await ingestText(pasteIn.value); pasteIn.value = ''; report(r); draw();
      } }, 'Add pasted answers')),
      status, summary),
    picks,
    h('div', { class: 'card' }, h('h2', {}, 'Attendance per slot'),
      h('label', {}, 'Show times in'), tzSel,
      h('div', { class: 'legend' },
        h('span', {}, h('i', { class: 'dot', style: 'background:var(--ok)' }), 'OK'),
        h('span', {}, h('i', { class: 'dot', style: 'background:var(--acc)' }), 'Acceptable'),
        h('span', {}, cfg.k === 'list' ? 'Number: OK+acceptable. Blue outline: best options. Click an option for names.' : 'Cell label: OK+acceptable. Blue outline: best options. Click a slot for names.')),
      heatHost),
    detail);
  draw();
}

/* ====================== Routing ====================== */
async function init() {
  const params = new URLSearchParams(location.hash.slice(1));
  const c = params.get('c');
  const view = params.get('v') || '';
  if (!c) return renderSetup(null);
  let cfg;
  try { cfg = normalizeConfig(await unpack(c)); } catch (e) {
    return renderError('This link looks damaged or incomplete. Ask the organiser to send it again.');
  }
  document.title = cfg.t + ' \u2013 Meeting Finder';
  if (view === 'results') renderResults(cfg);
  else if (view === 'edit') renderSetup(cfg);
  else renderParticipant(cfg);
}

if (typeof document !== 'undefined') {
  window.addEventListener('hashchange', () => init());
  if (GOOGLE.clientId) loadScript('https://accounts.google.com/gsi/client').catch(() => { });
  init();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    pack, unpack, hashId, slug, localToUtcMs, generateSlots, deltaEncode, deltaDecode, buildGrid, fmtSlot,
    normalizeConfig, configId, makeResponse, aggregate, rankSlots, parseFolder, slotLen, fmtRange, dayKey
  };
}
