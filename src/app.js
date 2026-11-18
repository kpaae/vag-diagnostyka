/* ===== VAG Diagnostyka – interfejs ===== */
(function () {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const GROUPS = [['silnik', 'Silnik'], ['chlodzenie', 'Chłodzenie i temperatury'], ['doladowanie', 'Doładowanie'], ['mieszanka', 'Mieszanka']];
  const ORDER = {
    silnik: ['rpm', 'speed', 'load', 'absload', 'tps', 'pedal', 'timing', 'tqDem', 'tqAct', 'fuelRate', 'fuelLvl', 'ecuV', 'adapterV', 'runTime'],
    chlodzenie: ['coolant', 'oil', 'iat', 'iatRise', 'ambient', 'cat1', 'cat2'],
    doladowanie: ['boost', 'boostTarget', 'boostDev', 'wgCmd', 'wgAct', 'map', 'mapX', 'boostCmdAbs', 'boostActAbs', 'baro', 'compIn', 'maf'],
    mieszanka: ['lambdaA', 'lambdaV', 'lambdaCmd', 'lambdaDev', 'trimTotal', 'stft1', 'ltft1', 'stft2', 'ltft2', 'fuelSys', 'railP', 'railPabs', 'injTiming', 'o2s2', 'o2s2trim', 'lambdaI', 'lambdaVv']
  };
  const WIDE = { rpm: {}, coolant: {}, boost: { target: 'boostTarget' }, lambdaA: { target: 'lambdaCmd' }, lambdaV: { target: 'lambdaCmd' }, trimTotal: { zero: true } };

  const CAT = {};
  PIDS.forEach(def => def.outs.forEach(o => { CAT[o.key] = { ...o, g: def.g, pid: def.pid, slow: !!def.slow }; }));
  DERIVED.forEach(d => { CAT[d.key] = { ...d, derived: true }; });
  CAT.adapterV = { key: 'adapterV', name: 'Akumulator (gniazdo OBD)', unit: 'V', d: 1, min: 10, max: 16, g: 'silnik', special: true, check: voltCheck };

  const store = {
    get(k, d) { try { const v = localStorage.getItem('vagdiag.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('vagdiag.' + k, v); } catch (e) {} }
  };
  const framed = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();

  let elm = null, tr = null, mode = null, sup = new Set();
  let panels = null, tools = null, bridge = null, currentTab = 'live';
  let vals = {}, seen = {}, hist = {}, mm = {}, tiles = [];
  let polling = false, pollRun = 0, cycle = 0, rec = null, wake = null, scanning = false, connecting = false;
  let view = store.get('group', 'silnik'); if (!['silnik', 'chlodzenie', 'doladowanie', 'mieszanka', 'all'].includes(view)) view = 'silnik';
  let report = blankReport();
  const logBuf = []; let logTimer = null;
  const sess = { on: false, log: [], id: null, ok: false };
  let journal = null;
  function sessStart() { sess.on = true; sess.log = []; sess.id = Date.now() + '-komunikacja'; sess.ok = false; }
  function sessSave(final) {
    if (!journal || !sess.log.length) return;
    journal.add('komunikacja', sess.ok ? 'Log komunikacji' : 'Log nieudanego połączenia', sess.log.join('\n'), { id: sess.id, quiet: !final });
  }
  function sessEnd() {
    if (!sess.on) return;
    if (journal && sess.ok) journal.regStop(CAT);
    sessSave(true); sess.on = false;
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && sess.on && journal) { if (sess.ok) journal.regSave(CAT, true); sessSave(false); } });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  /* ---------- marka ---------- */
  const modKey = m => m.bmw != null ? 'b' + m.bmw : 'm' + m.tx;
  function brand() { const o = store.get('brand', 'auto'); return o !== 'auto' ? o : (brandOf(report.vin) || 'vag'); }
  function modules() { return brand() === 'bmw' ? BMW_MODULES : MODULES; }
  const BRAND_NAMES = { vag: 'VAG', bmw: 'BMW' };
  function blankReport() { return { vin: null, calib: null, readiness: null, obd: null, freeze: null, modules: [], absent: [], adapter: null, at: null }; }
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function plural(n, a, b, c) { if (n === 1) return a; const d = n % 10, h = n % 100; return (d >= 2 && d <= 4 && (h < 12 || h > 14)) ? b : c; }
  const nf = {};
  function fmtNum(v, d) { if (!nf[d]) nf[d] = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d }); if (Math.abs(v) < Math.pow(10, -d) / 2) v = 0; return nf[d].format(v); }
  function fmtVal(c, v) { if (v == null || (!c.text && !isFinite(v))) return '—'; if (c.fmt) return c.fmt(v); return fmtNum(v, c.d ?? 0); }
  function tokens() { const s = getComputedStyle(document.documentElement); const g = n => s.getPropertyValue(n).trim(); return { accent: g('--accent'), warn: g('--warn'), crit: g('--crit'), ink: g('--ink'), muted: g('--muted'), line: g('--line'), mono: g('--f-mono') }; }

  /* ---------- komunikaty ---------- */
  function banner(text, kind = 'info', action) {
    $('#bannerText').textContent = text; const b = $('#banner'); b.className = 'banner ' + kind; b.hidden = !text;
    const a = $('#bannerAction'); a.hidden = !action;
    a.onclick = action ? () => { b.hidden = true; action.fn(); } : null;
    if (action) a.textContent = action.label;
  }
  $('#bannerClose').onclick = () => { $('#banner').hidden = true; };
  function chip(text, s) { const c = $('#connChip'); c.dataset.s = s || ''; c.querySelector('span').textContent = text; c.title = text; }

  /* ---------- log ---------- */
  function logLine(s) {
    const t = new Date(); const ts = t.toTimeString().slice(0, 8) + '.' + String(t.getMilliseconds()).padStart(3, '0');
    logBuf.push(ts + '  ' + s); if (logBuf.length > 1500) logBuf.splice(0, logBuf.length - 1500);
    if (sess.on) { sess.log.push(ts + '  ' + s); if (sess.log.length > 40000) sess.log.splice(0, 5000); }
    if (!$('#tab-log').hidden && !logTimer) logTimer = setTimeout(renderLog, 400);
  }
  function renderLog() { logTimer = null; const p = $('#log'); const atBottom = p.scrollTop + p.clientHeight >= p.scrollHeight - 30; p.textContent = logBuf.join('\n'); if (atBottom) p.scrollTop = p.scrollHeight; }
  const elmLog = (cmd, lines) => logLine('> ' + cmd + (lines.length ? '   < ' + lines.join(' | ') : '   < (brak)'));

  /* ---------- zakładki ---------- */
  $$('.tabs button').forEach(b => b.addEventListener('click', () => {
    $$('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    ['live', 'boost', 'heat', 'errors', 'tools', 'state', 'log'].forEach(t => { $('#tab-' + t).hidden = t !== b.dataset.tab; });
    currentTab = b.dataset.tab;
    if (b.dataset.tab === 'log') { renderLog(); journal && journal.render(); }
    if (b.dataset.tab === 'live') { sizeSparks(); updateTiles(); }
    panels && panels.onTab(currentTab);
  }));

  /* ---------- grupy i kafelki ---------- */
  function avail(k) { const c = CAT[k]; if (!c || !elm) return false; if (c.special) return true; if (c.derived) return c.needs(sup); return sup.has(c.pid); }
  function isWide(k) { return !!WIDE[k] && !(k === 'lambdaV' && avail('lambdaA')); }
  function syncSeg() { $$('#groupSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.g === view ? 'true' : 'false')); }
  $$('#groupSeg button').forEach(b => b.addEventListener('click', () => { view = b.dataset.g; store.set('group', view); syncSeg(); buildTiles(); }));

  function buildTiles() {
    const host = $('#tiles'); host.innerHTML = ''; tiles = [];
    panels && panels.render();
    if (!elm) { host.innerHTML = '<p class="empty">Połącz adapter, żeby zobaczyć parametry.</p>'; return; }
    const groups = view === 'all' ? GROUPS : GROUPS.filter(g => g[0] === view);
    for (const [g, label] of groups) {
      const keys = ORDER[g].filter(avail);
      const sec = el('section', 'group');
      sec.appendChild(el('h2', null, `${label} <small>${keys.length} ${plural(keys.length, 'parametr', 'parametry', 'parametrów')}</small>`));
      if (!keys.length) { sec.appendChild(el('p', 'muted', 'Sterownik nie udostępnia parametrów z tej grupy przez standardowe OBD.')); host.appendChild(sec); continue; }
      const grid = el('div', 'grid');
      for (const k of keys) grid.appendChild(makeTile(k));
      sec.appendChild(grid); host.appendChild(sec);
    }
    sizeSparks(); updateTiles();
  }
  function makeTile(k) {
    const c = CAT[k], w = isWide(k), cfg = WIDE[k] || {};
    const spark = !c.text && !c.nospark;
    const t = el('div', 'tile' + (w ? ' wide' : '') + (c.text ? ' text' : ''));
    t.dataset.key = k; t.dataset.s = 'none';
    t.innerHTML = `<div class="t-head"><span class="t-name">${esc(c.name)}</span><span class="pill"></span></div>
      <div class="t-val"><span class="v">—</span>${c.unit ? `<span class="u">${esc(c.unit)}</span>` : ''}</div>
      ${w ? `<div class="gauge">${cfg.zero ? '<span class="zero"></span>' : ''}<span class="fill"></span>${cfg.target ? '<span class="mk" hidden></span>' : ''}</div>
      <div class="gscale"><span>${fmtNum(c.min ?? 0, c.d > 1 ? 1 : 0)}</span>${cfg.target ? '<span>▮ zadane</span>' : ''}<span>${fmtNum(c.max ?? 100, c.d > 1 ? 1 : 0)}</span></div>` : ''}
      ${spark ? '<canvas class="spark" aria-hidden="true"></canvas><div class="mm"><span class="mn">min —</span><span class="mx">max —</span></div>' : ''}`;
    tiles.push({ k, el: t, v: t.querySelector('.v'), pill: t.querySelector('.pill'), fill: t.querySelector('.fill'), mk: t.querySelector('.mk'), cv: t.querySelector('canvas'), mn: t.querySelector('.mn'), mx: t.querySelector('.mx') });
    return t;
  }
  function sizeSparks() { for (const t of tiles) if (t.cv && t.cv.clientWidth) { t.cv.width = Math.round(t.cv.clientWidth * dpr); t.cv.height = Math.round(30 * dpr); } }
  let rsz = null; window.addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(() => { sizeSparks(); updateTiles(); }, 150); });

  function stateOf(k, v) { const c = CAT[k]; return (v != null && c.check) ? c.check(v, vals) : 'none'; }
  function updateTiles() {
    const tk = tokens();
    for (const t of tiles) {
      const c = CAT[t.k], v = vals[t.k];
      const has = v != null && (c.text || isFinite(v));
      t.v.textContent = has ? fmtVal(c, v) : '—';
      const s = has ? stateOf(t.k, v) : 'none';
      t.el.dataset.s = s;
      t.pill.textContent = s === 'crit' ? 'Alarm' : s === 'warn' ? 'Uwaga' : s === 'ok' ? 'OK' : '';
      if (has && t.mn && mm[t.k]) { t.mn.textContent = 'min ' + fmtVal(c, mm[t.k].min); t.mx.textContent = 'max ' + fmtVal(c, mm[t.k].max); }
      if (t.fill && has) {
        const lo = c.min ?? 0, hi = c.max ?? 100, pos = x => Math.max(0, Math.min(1, (x - lo) / (hi - lo))) * 100;
        if (WIDE[t.k].zero) { const z = pos(0), p = pos(v); t.fill.style.left = Math.min(z, p) + '%'; t.fill.style.width = Math.abs(p - z) + '%'; }
        else { t.fill.style.left = '0'; t.fill.style.width = pos(v) + '%'; }
        if (t.mk) { const tv = vals[WIDE[t.k].target]; if (tv != null) { t.mk.hidden = false; t.mk.style.left = pos(tv) + '%'; } else t.mk.hidden = true; }
      }
      if (t.cv) drawSpark(t.cv, hist[t.k] || [], s === 'crit' ? tk.crit : s === 'warn' ? tk.warn : tk.accent);
    }
  }
  function drawSpark(cv, h, color) {
    const ctx = cv.getContext('2d'); if (!ctx) return;
    const W = cv.width, H = cv.height; ctx.clearRect(0, 0, W, H);
    if (h.length < 2 || !W) return;
    let lo = Math.min(...h), hi = Math.max(...h); if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
    const r = 2.5 * dpr, Wd = W - r - 1, n = 90, dx = Wd / (n - 1), x0 = Wd - (h.length - 1) * dx;
    const y = v => H - r - (v - lo) / (hi - lo) * (H - 2 * r);
    const path = () => { ctx.beginPath(); h.forEach((v, i) => { const X = x0 + i * dx, Y = y(v); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); };
    path(); ctx.lineTo(Wd, H); ctx.lineTo(x0, H); ctx.closePath();
    ctx.globalAlpha = 0.14; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
    path(); ctx.lineWidth = 1.5 * dpr; ctx.lineJoin = 'round'; ctx.strokeStyle = color; ctx.stroke();
    ctx.beginPath(); ctx.arc(Wd, y(h[h.length - 1]), r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  }

  function updateAlerts() {
    const items = [];
    for (const k in vals) {
      const c = CAT[k]; if (!c || !c.check || !avail(k) || cycle - (seen[k] ?? -99) > 15) continue;
      const s = stateOf(k, vals[k]); if (s === 'warn' || s === 'crit') items.push({ s, c, v: vals[k] });
    }
    items.sort((a, b) => (a.s === 'crit' ? 0 : 1) - (b.s === 'crit' ? 0 : 1));
    const html = items.length
      ? items.map(i => `<div class="alert ${i.s}"><b>${i.s === 'crit' ? 'Alarm' : 'Uwaga'}:</b> ${esc(i.c.name)} ${fmtVal(i.c, i.v)} ${esc(i.c.unit)}</div>`).join('')
      : (Object.keys(seen).length ? '<div class="alert">Odczytywane parametry mieszczą się w progach orientacyjnych.</div>' : '');
    const host = $('#alerts'); if (host.dataset.h !== html) { host.innerHTML = html; host.dataset.h = html; }
  }

  /* ---------- odczyt na żywo ---------- */
  function activeKeys() {
    const pk = panels && panels.keysFor(currentTab);
    if (pk) return pk.filter(avail);
    return (view === 'all' ? GROUPS.map(g => g[0]) : [view]).flatMap(g => ORDER[g]).filter(avail); }
  function allKeys() { return GROUPS.flatMap(g => ORDER[g[0]]).filter(avail); }
  function defsFor(keys) {
    const pids = new Set([0x0C, 0x04]);
    for (const k of keys) { const c = CAT[k]; if (c.derived) c.deps.forEach(p => pids.add(p)); else if (!c.special) pids.add(c.pid); }
    return PIDS.filter(d => pids.has(d.pid) && sup.has(d.pid) && (!d.slow || cycle % 10 === 0 || d.outs.every(o => vals[o.key] == null)));
  }
  function take(res) {
    for (const k in res) {
      seen[k] = cycle; const v = res[k];
      if (CAT[k] && !CAT[k].text && isFinite(v)) {
        (hist[k] = hist[k] || []).push(v); if (hist[k].length > 90) hist[k].shift();
        const m = mm[k] || (mm[k] = { min: v, max: v }); if (v < m.min) m.min = v; if (v > m.max) m.max = v;
      }
    }
  }
  async function pollLoop(run) {
    while (polling && run === pollRun && elm) {
      if (tools && tools.busy()) { await sleep(400); continue; }
      const t0 = performance.now(); const wanted = activeKeys(); const keys = (cycle % 6 === 0 && !(panels && panels.busy())) ? allKeys() : wanted; const e = elm;
      try {
        const res = await e.op(() => e.readLive(defsFor(keys)));
        if (keys.includes('adapterV') && (cycle % 10 === 0 || vals.adapterV == null)) { const v = await e.op(() => e.voltage()); if (v != null) res.adapterV = v; }
        if (run !== pollRun || e !== elm) break;
        Object.assign(vals, res);
        for (const d of DERIVED) { const v = d.calc(vals); if (v != null && isFinite(v)) { vals[d.key] = v; res[d.key] = v; } }
        take(res);
        journal && journal.regTick(vals, CAT);
        if (rec) { const row = { t: (Date.now() - rec.t0) / 1000 }; for (const k of wanted) if (vals[k] != null && seen[k] === cycle) { row[k] = vals[k]; rec.keys.add(k); } rec.rows.push(row); $('#btnRec').textContent = `Zatrzymaj · ${rec.rows.length}`; }
        if (!$('#tab-live').hidden) updateTiles();
        panels && panels.tick();
        updateAlerts();
      } catch (err) { logLine('! ' + err.message); }
      cycle++;
      const dt = performance.now() - t0;
      $('#rate').textContent = `odświeżanie ${fmtNum(1000 / Math.max(dt, 1), 1)} Hz`;
      await sleep(Math.max(0, 160 - dt));
    }
  }
  function startPolling() {
    if (!elm) return; polling = true; pollRun++; $('#btnPoll').textContent = 'Pauza'; $('#btnPoll').disabled = false;
    try { navigator.wakeLock && navigator.wakeLock.request('screen').then(w => { wake = w; }).catch(() => {}); } catch (e) {}
    pollLoop(pollRun);
  }
  function stopPolling() {
    polling = false; pollRun++; $('#btnPoll').textContent = 'Wznów'; $('#rate').textContent = '';
    try { wake && wake.release(); } catch (e) {} wake = null;
  }
  $('#btnPoll').onclick = () => { polling ? stopPolling() : startPolling(); };
  /* Wstrzymanie odczytu na żywo na czas narzędzi, które zajmują adapter. Zwraca funkcję wznawiającą. */
  function pause() { const was = polling; if (was) stopPolling(); return () => { if (was && elm && !polling) startPolling(); }; }

  /* ---------- nagrywanie ---------- */
  $('#btnRec').onclick = () => {
    const b = $('#btnRec');
    if (!rec) { rec = { t0: Date.now(), rows: [], keys: new Set() }; b.classList.add('rec-on'); b.textContent = 'Zatrzymaj · 0'; $('#recBox').hidden = true; if (!polling) startPolling(); return; }
    b.classList.remove('rec-on'); b.textContent = 'Nagrywaj';
    const r = rec; rec = null; lastRec = r;
    if (journal && r.rows.length) journal.add('nagranie', `Nagranie, ${Math.round(r.rows[r.rows.length - 1].t)} s`, csv(r), { ext: 'csv' });
    $('#recInfo').textContent = `Nagranie: ${r.rows.length} ${plural(r.rows.length, 'próbka', 'próbki', 'próbek')}, ${fmtNum(r.rows.length ? r.rows[r.rows.length - 1].t : 0, 0)} s, ${r.keys.size} ${plural(r.keys.size, 'parametr', 'parametry', 'parametrów')}`;
    $('#recBox').hidden = false;
  };
  let lastRec = null;
  function csv(r) {
    const keys = [...r.keys];
    const out = [['czas [s]', ...keys.map(k => `${CAT[k].name}${CAT[k].unit ? ' [' + CAT[k].unit + ']' : ''}`)].join(';')];
    for (const row of r.rows) out.push([row.t.toFixed(2).replace('.', ','), ...keys.map(k => { const v = row[k]; if (v == null) return ''; const c = CAT[k]; return c.text ? (c.fmt ? c.fmt(v) : v) : v.toFixed(Math.max(c.d ?? 0, 1)).replace('.', ','); })].join(';'));
    return out.join('\r\n');
  }
  $('#btnCsvCopy').onclick = e => lastRec && copyText(csv(lastRec), e.currentTarget);
  $('#btnCsvDl').onclick = () => lastRec && download(`vag-nagranie-${stamp()}.csv`, csv(lastRec), 'text/csv');
  $('#btnRecClose').onclick = () => { $('#recBox').hidden = true; };

  function stamp() { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; }
  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: type + ';charset=utf-8' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function copyText(text, btn) {
    const done = () => { if (btn) { const o = btn.textContent; btn.textContent = 'Skopiowano'; setTimeout(() => { btn.textContent = o; }, 1500); } };
    const fallback = () => { $('#copyBox').hidden = false; const ta = $('#copyText'); ta.value = text; if (btn && $('#tab-errors').hidden) $('.tabs [data-tab="errors"]').click(); ta.focus(); ta.select(); };
    try { navigator.clipboard.writeText(text).then(done, fallback); } catch (e) { fallback(); }
  }
  if (framed) { $('#btnCsvDl').hidden = true; $('#btnReportDl').hidden = true; }

  /* ---------- połączenie ---------- */
  /* Usługi BLE spotykane w adapterach ELM327 (pełne UUID – część przeglądarek na iOS nie przyjmuje skrótów 16-bitowych). */
  const u16uuid = n => '0000' + n.toString(16).padStart(4, '0') + '-0000-1000-8000-00805f9b34fb';
  const BLE_SERVICES = [
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // vLinker, Vgate iCar Pro BLE
    u16uuid(0xfff0), // Veepeak, Konnwei, wiele klonów
    u16uuid(0xffe0), // klony z modułem HM-10
    u16uuid(0x18f0), // OBDLink CX / MX+ i inne
    u16uuid(0xffb0), u16uuid(0xae30), u16uuid(0xbeef), u16uuid(0xfee7)
  ];
  const props = c => Object.entries({ r: 'read', w: 'write', wn: 'writeWithoutResponse', n: 'notify', i: 'indicate' }).filter(([, p]) => c.properties[p]).map(([k]) => k).join('/');
  const errText = e => (e && (e.message || e.name)) ? `${e.name && e.name !== 'Error' ? e.name + ': ' : ''}${e.message || ''}` : String(e);
  async function step(label, fn) {
    logLine('… BLE: ' + label);
    try { return await fn(); }
    catch (e) {
      if (e && (e.name === 'NotFoundError' || typeof e.code === 'string')) throw e;
      logLine('! BLE: ' + label + ' – ' + errText(e));
      throw Object.assign(new Error(`Etap „${label}” nie powiódł się (${errText(e)}).`), { step: label, orig: e });
    }
  }
  /* Typowe nazwy adapterów OBD BLE – pozwalają ukryć w oknie wyboru zegarki, słuchawki itp. */
  const NAME_PREFIXES = ['OBD', 'Obd', 'obd', 'IOS', 'iOS', 'ios', 'Android', 'V-LINK', 'VLINK', 'Vlink', 'vLink', 'vLinker', 'Vgate', 'iCar', 'VEEPEAK', 'Veepeak', 'KONNWEI', 'KW9', 'ELM', 'Elm', 'LELink', 'Viecar', 'Carista', 'OBDLink', 'MX+', 'Vaux', 'BLE', 'Bluetooth', 'Car', 'CAR', 'Scan'];
  async function pickDevice(all) {
    const opts = { acceptAllDevices: true, optionalServices: BLE_SERVICES };
    if (all) return navigator.bluetooth.requestDevice(opts);
    const filters = BLE_SERVICES.map(s => ({ services: [s] })).concat(NAME_PREFIXES.map(p => ({ namePrefix: p })));
    try { return await navigator.bluetooth.requestDevice({ filters, optionalServices: BLE_SERVICES }); }
    catch (e) {
      if (e && e.name === 'NotFoundError') throw Object.assign(e, { filtered: true });
      logLine('! BLE: filtr urządzeń nieobsługiwany (' + errText(e) + '), pokazuję wszystkie');
      return navigator.bluetooth.requestDevice(opts);
    }
  }
  async function openBle(all) {
    if (!navigator.bluetooth) throw Object.assign(new Error('nobt'), { code: 'nobt' });
    const dev = await step(all ? 'wybór urządzenia (wszystkie)' : 'wybór adaptera OBD', () => pickDevice(all));
    logLine(`— wybrano: ${dev.name || '(bez nazwy)'}`);
    chip('Łączenie z ' + (dev.name || 'adapterem') + '…', 'busy');
    let srv = null;
    for (let a = 1; a <= 3 && !srv; a++) {
      try { srv = await step(`łączenie z adapterem (próba ${a})`, () => dev.gatt.connect()); }
      catch (e) { if (a === 3) throw e; await sleep(800); }
    }
    let services = [];
    for (const u of BLE_SERVICES) { try { services.push(await srv.getPrimaryService(u)); } catch (_) {} }
    if (!services.length) { try { services = await srv.getPrimaryServices(); } catch (e) { logLine('! BLE: lista usług – ' + errText(e)); } }
    logLine('— usługi: ' + (services.map(s => s.uuid).join(', ') || 'brak'));
    if (!services.length) { try { dev.gatt.disconnect(); } catch (e) {} throw new Error(`Adapter ${dev.name || ''} nie udostępnia żadnej znanej usługi BLE. Wyślij zrzut zakładki Komunikacja – dopiszę jego UUID.`); }
    // Kandydaci: najpierw usługa z jedną cechą notify+write (vLinker), potem para notify + write w tej samej usłudze.
    const pairs = [];
    for (const s of services) {
      let chars = []; try { chars = await s.getCharacteristics(); } catch (e) { logLine('! BLE: cechy ' + s.uuid + ' – ' + errText(e)); continue; }
      chars.forEach(c => logLine(`   ${s.uuid.slice(4, 8)} → ${c.uuid} [${props(c)}]`));
      const isN = c => c.properties.notify || c.properties.indicate, isW = c => c.properties.write || c.properties.writeWithoutResponse;
      const both = chars.find(c => isN(c) && isW(c));
      if (both) pairs.push([both, both]);
      const n = chars.find(isN), w = chars.find(c => isW(c) && c !== n) || chars.find(isW);
      if (n && w && !(both && n === both)) pairs.push([n, w]);
    }
    if (!pairs.length) { try { dev.gatt.disconnect(); } catch (e) {} throw new Error('Nie znalazłem kanału ELM327 w tym urządzeniu. Upewnij się, że wybrałeś adapter OBD, a nie inne urządzenie.'); }
    let nt = null, wr = null, lastErr = null;
    for (const [n, w] of pairs) {
      try { await step('włączenie powiadomień ' + n.uuid.slice(0, 8), () => n.startNotifications()); nt = n; wr = w; break; }
      catch (e) { lastErr = e; }
    }
    if (!nt) { try { dev.gatt.disconnect(); } catch (e) {} throw lastErr; }
    logLine(`— kanał: odczyt ${nt.uuid}, zapis ${wr.uuid}`);
    const dec = new TextDecoder(), enc = new TextEncoder(); let cb = null; let closed = false;
    nt.addEventListener('characteristicvaluechanged', e => { cb && cb(dec.decode(e.target.value)); });
    dev.addEventListener('gattserverdisconnected', () => { if (!closed) lost(); });
    const noResp = wr.properties.writeWithoutResponse;
    return {
      name: 'Bluetooth LE · ' + (dev.name || 'adapter'),
      onData(f) { cb = f; },
      async write(s) {
        const b = enc.encode(s);
        for (let i = 0; i < b.length; i += 20) {
          const part = b.slice(i, i + 20);
          if (noResp && wr.writeValueWithoutResponse) await wr.writeValueWithoutResponse(part);
          else if (wr.writeValueWithResponse) await wr.writeValueWithResponse(part);
          else await wr.writeValue(part);
        }
      },
      close() { closed = true; try { dev.gatt.disconnect(); } catch (e) {} }
    };
  }
  async function openSerial() {
    if (!navigator.serial) throw Object.assign(new Error('noserial'), { code: 'noserial' });
    const SPP = '00001101-0000-1000-8000-00805f9b34fb'; // klasyczny Bluetooth (port szeregowy)
    let port;
    try { port = await navigator.serial.requestPort({ allowedBluetoothServiceClassIds: [SPP] }); }
    catch (e) { if (e && e.name === 'NotFoundError') throw e; port = await navigator.serial.requestPort(); }
    logLine('— port: ' + JSON.stringify(port.getInfo ? port.getInfo() : {}));
    await port.open({ baudRate: 38400 });
    const writer = port.writable.getWriter(), reader = port.readable.getReader(), dec = new TextDecoder(), enc = new TextEncoder();
    let cb = null, alive = true;
    (async () => { try { while (alive) { const { value, done } = await reader.read(); if (done) break; if (value && cb) cb(dec.decode(value)); } } catch (e) {} if (alive) lost(); })();
    return {
      name: 'Port COM',
      onData(f) { cb = f; },
      async write(s) { await writer.write(enc.encode(s)); },
      async close() { alive = false; try { await reader.cancel(); } catch (e) {} try { reader.releaseLock(); } catch (e) {} try { writer.releaseLock(); } catch (e) {} try { await port.close(); } catch (e) {} }
    };
  }
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function friendly(e) {
    if (e.bridge) return e.message || String(e);
    if (e.code === 'nobt') return IOS
      ? 'Safari i Chrome na iPhonie nie obsługują Bluetooth ze stron. Możesz sterować przez most: podłącz adapter do telefonu z Androidem lub komputera, włącz tam most i tutaj naciśnij „Inne urządzenie”. Druga droga to Bluefy z adapterem Bluetooth LE.'
      : 'Ta przeglądarka nie obsługuje Bluetooth ze stron. Użyj Chrome lub Edge.';
    if (e.code === 'noserial') return 'Port COM działa w Chrome lub Edge na komputerze oraz w aktualnym Chrome na Androidzie. Na iPhonie użyj przycisku Bluetooth.';
    if (e.name === 'NotFoundError') return e.filtered ? 'filtered' : null;
    if (e.name === 'SecurityError' || e.name === 'NotAllowedError') return framed
      ? 'W tym podglądzie przeglądarka blokuje Bluetooth i porty. Otwórz aplikację z własnego adresu HTTPS (instrukcja w zakładce Stan).'
      : 'Przeglądarka nie zezwoliła na połączenie. Strona musi być otwarta przez HTTPS.';
    const base = e.message || String(e);
    return base + ' Zamknij całkowicie inne aplikacje OBD (adapter przyjmuje jedno połączenie), odczekaj kilka sekund i spróbuj ponownie. Szczegóły są w zakładce Komunikacja.';
  }
  function lost(msg) {
    if (!mode) return;
    if (mode === 'bridge') {
      bridge.adapterLost(); bridge.stopHost(); tr = null; mode = null; setButtons();
      logLine('— most: adapter rozłączony'); chip('Połączenie przerwane', '');
      banner('Most: połączenie z adapterem zostało przerwane. Sprawdź adapter i włącz most ponownie.', 'warn'); return;
    }
    panels && panels.stopAll(); tools && tools.stopAll();
    stopPolling(); elm = null; mode = null;
    const t = tr; tr = null; if (t && msg) { try { t.close(); } catch (e) {} }
    setButtons();
    logLine('— połączenie przerwane' + (msg ? ': ' + msg : '')); sessEnd();
    chip('Połączenie przerwane', ''); banner(msg || 'Połączenie z adapterem zostało przerwane. Sprawdź adapter i połącz ponownie.', 'warn');
  }
  /* ---------- most ---------- */
  async function startBridgeHost(kind) {
    if (connecting) return;
    connecting = true; setButtons();
    await disconnect();
    try {
      const t = kind === 'ble' ? await openBle() : await openSerial();
      tr = t; mode = 'bridge';
      logLine('— most: adapter ' + t.name);
      const code = await bridge.host(t);
      logLine('— most włączony, kod ' + code);
      $('#banner').hidden = true;
    } catch (err) {
      const msg = friendly(err); logLine('! most: ' + (err.message || err));
      bridge.stopHost(); const t = tr; tr = null; mode = null; if (t) { try { await t.close(); } catch (e) {} }
      chip('Rozłączony', '');
      if (msg && msg !== 'filtered') banner(msg, 'error');
      else if (msg === 'filtered') banner('Nie widzisz adaptera? Wybierz „Inne urządzenie” i spróbuj ponownie, a na liście szukaj urządzenia, które znika po wyjęciu adaptera.', 'info');
    }
    connecting = false; setButtons(); buildTiles();
  }
  async function stopBridgeHost() { await disconnect(); banner('Most wyłączony.', 'info'); }
  async function disconnect() {
    if (bridge && bridge.active()) bridge.stopHost();
    panels && panels.stopAll();
    if (tools) await tools.stopAll();
    stopPolling();
    const t = tr; tr = null; elm = null; mode = null;
    if (t) { try { await t.close(); } catch (e) {} logLine('— rozłączono'); }
    sessEnd();
    chip('Rozłączony', ''); setButtons();
  }
  function setButtons() {
    const on = !!elm;
    $('#btnDisc').hidden = !on && mode !== 'bridge'; $('#btnDisc').textContent = mode === 'bridge' ? 'Wyłącz most' : 'Rozłącz';
    $('#btnBridge').disabled = connecting; $('#btnPoll').disabled = !on; $('#btnRec').disabled = !on;
    $('#btnScan').disabled = !on || scanning; $('#btnState').disabled = !on;
    $('#btnBle').disabled = $('#btnSerial').disabled = connecting;
    tools && tools.sync();
  }
  async function connect(kind, all) {
    if (connecting) return;
    connecting = true; setButtons();
    if (rec) $('#btnRec').click();
    await disconnect();
    vals = {}; seen = {}; hist = {}; mm = {}; report = blankReport(); cycle = 0;
    sessStart(); journal && journal.startSession();
    $('#scanProgress').textContent = '';
    renderObd(); renderModules(); renderState(); updateAlerts(); buildTiles();
    try {
      const t = kind === 'ble' ? await openBle(all) : kind === 'remote' ? await bridge.openRemote(all).catch(e => { e.bridge = true; throw e; }) : await openSerial();
      tr = t; chip('Inicjalizacja adaptera…', 'busy');
      const e = new ELM(t, elmLog);
      e.onWarn = msg => { banner(msg, 'warn'); logLine('! ' + msg); };
      logLine('— połączenie: ' + t.name);
      const id = await e.init();
      let s = await e.op(() => e.discoverPids());
      if (!s.size) {
        logLine('— sterownik nie odpowiada pod 7E0, szukam przez zapytanie ogólne 7DF');
        const f = await e.op(() => e.findObdEcu());
        f.tried.forEach(t => logLine('— ' + t));
        if (f.ok) { logLine(`— odpowiada ${f.rx ? '0x' + f.rx.toString(16).toUpperCase() : 'sterownik'} (${f.proto})${f.others && f.others.length ? ', także ' + f.others.join(', ') : ''}; dalsze zapytania OBD idą przez 7DF`); s = await e.op(() => e.discoverPids()); }
        if (!s.size) {
          const v = await e.voltage().catch(() => null);
          const all = f.tried.join(' ');
          const why = /CAN ERROR|BUS ERROR|BUS INIT|UNABLE/i.test(all)
            ? 'Adapter nie widzi magistrali auta (CAN ERROR). Sprawdź, czy adapter jest wciśnięty do końca w gniazdo OBD.'
            : 'Adapter działa, ale auto nie odpowiada na zapytania OBD. Włącz zapłon: w BMW naciśnij Start/Stop bez wciskania hamulca, aż zapali się cały zestaw wskaźników (albo uruchom silnik), w innych autach przekręć kluczyk do drugiej pozycji.';
          throw Object.assign(new Error(`${why}${v ? ` Napięcie w gnieździe: ${String(v).replace('.', ',')} V.` : ''} Szczegóły w zakładce Logi.`), { bridge: true });
        }
      }
      elm = e; sup = s; mode = kind;
      sess.ok = true; journal && journal.regStart();
      report.adapter = `${id} · ${t.name}`;
      chip(`${t.name} · ${id}`, 'on');
      $('#banner').hidden = true;
      connecting = false; tools && tools.onConnect(); setButtons(); buildTiles(); renderState(); startPolling();
      refreshState().then(() => { tools && !tools.busy() && tools.render(); renderModules(); runScan(false); });
    } catch (err) {
      connecting = false;
      const msg = friendly(err);
      logLine('! ' + (err.message || err));
      const t = tr; tr = null; elm = null; mode = null; if (t) { try { await t.close(); } catch (e) {} }
      if (msg !== 'filtered' && msg !== null) sessEnd(); else sess.on = false;
      chip('Rozłączony', ''); setButtons(); buildTiles();
      if (msg === 'filtered') banner('Nie widzisz swojego adaptera na liście? Niektóre adaptery nie podają nazwy. Pokaż wszystkie urządzenia i wybierz to, które znika z listy po wyjęciu adaptera z gniazda.', 'info', { label: 'Pokaż wszystkie urządzenia', fn: () => connect('ble', true) });
      else if (msg) { banner(msg, 'error'); $('#errBadge').hidden = true; }
    }
  }
  $('#btnBle').onclick = () => connect('ble');
  $('#btnSerial').onclick = () => connect('serial');
  $('#btnDisc').onclick = async () => { await disconnect(); banner('Rozłączono z adapterem.', 'info'); };

  /* ---------- stan pojazdu ---------- */
  async function refreshState() {
    const e = elm; if (!e) return;
    $('#btnState').disabled = true;
    try {
      report.vin = await e.op(() => e.readVin());
      report.readiness = await e.op(() => e.readReadiness());
      report.calib = await e.op(() => e.readCalib());
      const v = await e.op(() => e.voltage()); if (v != null) { vals.adapterV = v; }
    } catch (err) { logLine('! ' + err.message); }
    renderState(); setButtons();
  }
  $('#btnState').onclick = refreshState;
  function renderState() {
    const r = report.readiness;
    $('#sVin').textContent = report.vin || '—';
    $('#sMil').textContent = r ? (r.mil ? 'włączona' : 'wyłączona') : '—';
    $('#sCnt').textContent = r ? String(r.count) : '—';
    $('#sIgn').textContent = r ? (r.compression ? 'samoczynny (diesel)' : 'iskrowy (benzyna)') : '—';
    const cal = report.calib || {};
    $('#sEcu').textContent = cal.ecuName || '—';
    $('#sCal').textContent = cal.calid ? cal.calid.join(', ') : '—';
    $('#sCvn').textContent = cal.cvn ? cal.cvn.join(', ') : '—';
    $('#sReady').innerHTML = r && r.monitors.length
      ? r.monitors.map(m => `<li><span>${esc(m.name)}</span><span class="st ${m.complete ? 'ok' : 'no'}">${m.complete ? 'gotowy' : 'niegotowy'}</span></li>`).join('')
      : '<li class="muted">—</li>';
    $('#sAd').textContent = elm ? elm.ident : '—';
    $('#sConn').textContent = tr ? tr.name : '—';
    $('#sV').textContent = vals.adapterV != null ? fmtNum(vals.adapterV, 1) + ' V' : '—';
    $('#sMp').textContent = elm ? (elm.multiPid ? 'tak' : 'nie (wolniejsze odświeżanie)') : '—';
    $('#sFc').textContent = elm ? (elm.fcOk ? 'obsługiwany' : 'brak – dłuższe odpowiedzi mogą nie dochodzić') : '—';
    const names = {}; PIDS.forEach(d => { names[d.pid] = d.outs[0].name; });
    const list = [...sup].filter(p => p % 0x20 !== 0).sort((a, b) => a - b);
    $('#sPidCount').textContent = elm ? `${list.length} PID` : '';
    $('#sPids').innerHTML = elm ? list.map(p => `${hex2(p)}${names[p] ? ' ' + esc(names[p]) : ''}`).join(' · ') : '—';
  }

  /* ---------- błędy ---------- */
  function causesHtml(code, bmw) {
    const i = dtcInfo(code, bmw); if (!i || (!i.causes.length && !i.warn && !i.note)) return '';
    return `<details class="cz"><summary>Możliwe przyczyny</summary>${i.uncertain ? '<p class="muted small">Źródła nie są zgodne co do tego kodu. Traktuj opis orientacyjnie.</p>' : ''}${i.warn ? `<p class="warnp">${esc(i.warn)}</p>` : ''}${i.causes.length ? `<ul>${i.causes.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}${i.note ? `<p class="muted small">${esc(i.note)}</p>` : ''}<p class="muted small">To podpowiedź z poradników, nie diagnoza. Źródła: ${i.src.map(x => `<a href="${esc(x[1])}" target="_blank" rel="noopener">${esc(x[0])}</a>`).join(', ')}</p></details>`;
  }
  function dtcRow(code, desc, flags, m, d) {
    const det = d && d.details;
    const detHtml = det ? `<div class="dtcdet">${det.err ? `<span class="muted">${esc(det.err)}</span>`
      : `${det.ext.length ? `<div><b>Dane rozszerzone</b> ${det.ext.map(x => `<span class="kvp">rekord ${hex2(x.rec)}: <code>${x.bytes.map(hex2).join(' ')}</code>${x.bytes.length <= 3 ? ` = ${x.bytes.reduce((a, b) => a * 256 + b, 0)}` : ''}</span>`).join('')}</div>` : ''}
         ${det.snap ? `<div><b>Dane środowiskowe</b> <code class="wrap">${det.snap.map(hex2).join(' ')}</code></div>` : ''}
         ${!det.ext.length && !det.snap ? '<span class="muted">Moduł nie zwrócił szczegółów dla tego kodu.</span>' : '<span class="muted">Surowe dane. Bez opisu producenta nie da się nazwać każdego pola. Licznik wystąpień i przebieg zwykle są w danych rozszerzonych.</span>'}`}</div>` : '';
    const btn = m && d ? `<button class="linkbtn" type="button" data-det="${modKey(m)}|${d.raw}">${det ? 'Odśwież szczegóły' : 'Szczegóły'}</button>` : '';
    return `<div class="dtc"><code>${esc(code)}</code><span class="d">${desc ? esc(desc) : '<span class="muted">Kod producenta, brak opisu w bazie</span>'}</span>${causesHtml(d ? d.code : code, brand() === 'bmw' && !!m)}${flags && flags.length ? `<div class="flags">${flags.map(f => `<span class="flag${f === 'aktywny' ? ' act' : f === 'kontrolka' ? ' mil' : ''}">${esc(f)}</span>`).join('')}${btn}</div>` : ''}${detHtml}</div>`;
  }
  function clearFoot(id, label) { return `<div class="cardfoot" data-foot="${id}"><button class="btn small" type="button" data-clear="${id}">${label}</button></div>`; }
  function renderObd() {
    const o = report.obd, host = $('#obdDtc');
    if (!o) { host.innerHTML = `<p class="muted">${elm ? 'Odczyt w toku…' : 'Jeszcze nie odczytano.'}</p>`; return; }
    const sec = (label, list, note) => {
      const n = list ? list.length : 0;
      return `<div class="card${n ? ' has-err' : ''}"><div class="card-h"><h3>${label}</h3><span class="n">${list == null ? '' : n}</span></div>
        <p class="muted" style="margin:0;font-size:13px">${note}</p>
        ${list == null ? '<p class="muted" style="margin:0">Sterownik nie obsługuje tego odczytu.</p>' : n ? list.map(d => dtcRow(d.code, d.desc)).join('') : '<p class="noerr">Brak kodów</p>'}</div>`;
    };
    let fr = '';
    if (report.freeze) {
      const f = report.freeze;
      fr = `<div class="card"><div class="card-h"><h3>Zamrożona ramka</h3><span class="n">${esc(f.dtc)}</span></div>
        <p class="muted" style="margin:0;font-size:13px">Warunki w chwili zapisania kodu${f.desc ? ': ' + esc(f.desc.toLowerCase()) : ''}.</p>
        <table class="freeze"><tbody>${Object.entries(f.values).map(([k, v]) => `<tr><td>${esc(CAT[k] ? CAT[k].name : k)}</td><td>${CAT[k] ? fmtVal(CAT[k], v) : v} ${CAT[k] ? esc(CAT[k].unit) : ''}</td></tr>`).join('')}</tbody></table></div>`;
    }
    const total = (o.stored || []).length + (o.pending || []).length;
    host.innerHTML = `<div class="cols">${sec('Zapisane', o.stored, 'Potwierdzone usterki emisyjne.')}${sec('Oczekujące', o.pending, 'Wykryte raz, jeszcze niepotwierdzone.')}${sec('Stałe', o.permanent, 'Znikają dopiero po naprawie i jeździe testowej.')}${fr}</div>
      ${total ? clearFoot('obd', 'Kasuj kody silnika (OBD)') : ''}`;
  }
  function renderModules() {
    $('#modTitle').firstChild.textContent = `Moduły ${BRAND_NAMES[brand()]} `;
    const host = $('#modules');
    if (!report.modules.length) { host.innerHTML = `<p class="muted">${scanning ? 'Skanowanie…' : 'Jeszcze nie skanowano.'}</p>`; updateBadge(); return; }
    host.innerHTML = '<div class="cols">' + report.modules.map(m => {
      const n = m.dtcs.length;
      const ident = Object.entries(m.ident).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join('<br>');
      return `<div class="card${n ? ' has-err' : ''}"><div class="card-h"><span class="addr">${esc(m.addr)}</span><h3>${esc(m.name)}</h3><span class="n">${n} ${plural(n, 'błąd', 'błędy', 'błędów')}</span></div>
        ${ident ? `<div class="ident">${ident}</div>` : ''}
        ${m.err ? `<p class="muted" style="margin:0;font-size:13px">Nie udało się odczytać błędów: ${esc(m.err)}</p>` : n ? m.dtcs.map(d => dtcRow(d.full, d.desc, d.flags, m, d)).join('') : '<p class="noerr">Brak błędów</p>'}
        ${m.untested ? `<p class="absent">Pominięto ${m.untested} ${plural(m.untested, 'pozycję', 'pozycje', 'pozycji')} z listy kodów obsługiwanych przez moduł, bez wykrytej usterki.</p>` : ''}
        ${n ? clearFoot(modKey(m), 'Kasuj błędy') : ''}</div>`;
    }).join('') + '</div>' + (report.absent.length ? `<p class="absent">Bez odpowiedzi (brak w aucie lub inny adres): ${report.absent.map(m => esc(m.addr + ' ' + m.name)).join(', ')}</p>` : '');
    updateBadge();
  }
  function updateBadge() {
    const n = report.modules.reduce((a, m) => a + m.dtcs.length, 0) + (report.obd && report.obd.stored ? report.obd.stored.filter(d => !report.modules.some(m => m.dtcs.some(x => x.code === d.code))).length : 0);
    const b = $('#errBadge'); b.textContent = n; b.hidden = !n;
    panels && panels.refresh();
  }

  async function runScan(full) {
    const e = elm; if (!e || scanning) return;
    scanning = true; setButtons();
    const prog = t => { $('#scanProgress').textContent = t; };
    report.modules = []; report.absent = []; report.obd = null; report.freeze = null; renderModules(); renderObd();
    try {
      prog('Odczyt kodów OBD silnika…');
      report.obd = await e.op(() => e.readObdDtcs());
      report.freeze = await e.op(() => e.readFreeze(sup));
      renderObd();
      $('#modTitle').firstChild.textContent = `Moduły ${BRAND_NAMES[brand()]} `;
      for (const m of modules()) {
        if (e !== elm) { prog(''); return; }
        prog(`Moduł ${m.addr} · ${m.name}…`);
        const r = await e.op(() => e.scanModule(m, true));
        if (r) { report.modules.push(r); renderModules(); } else report.absent.push(m);
      }
      if (full && e === elm) {
        const found = await e.op(() => e.findUnknown(tx => prog(`Szukam modułów: 0x${tx.toString(16).toUpperCase()}…`), brand() === 'bmw'));
        for (const m of found) { prog(`Odczyt ${m.name}…`); const r = await e.op(() => e.scanModule(m, false)); if (r) { report.modules.push(r); renderModules(); } }
      }
      report.at = new Date();
      const n = report.modules.reduce((a, m) => a + m.dtcs.length, 0);
      prog(`Gotowe ${report.at.toLocaleTimeString('pl-PL')}: ${report.modules.length} ${plural(report.modules.length, 'moduł', 'moduły', 'modułów')}, ${n} ${plural(n, 'błąd', 'błędy', 'błędów')}.`);
      journal && journal.add('raport', `Raport po skanie: ${report.modules.length} ${plural(report.modules.length, 'moduł', 'moduły', 'modułów')}, ${n} ${plural(n, 'błąd', 'błędy', 'błędów')}`, buildReport());
    } catch (err) { prog('Skanowanie przerwane: ' + err.message); logLine('! ' + err.message); }
    finally { scanning = false; renderModules(); setButtons(); }
  }
  $('#btnScan').onclick = () => runScan($('#fullScan').checked);
  $('#brandSel').value = store.get('brand', 'auto');
  $('#brandSel').onchange = e => {
    store.set('brand', e.target.value); renderModules(); tools && tools.render();
    if (elm && !scanning) runScan(false);
  };

  $('#tab-errors').addEventListener('click', async ev => {
    const btn = ev.target.closest('button'); if (!btn) return;
    if (btn.dataset.det) {
      const e = elm; if (!e) return;
      const [tx, raw] = btn.dataset.det.split('|');
      const m = report.modules.find(x => modKey(x) === tx); const d = m && m.dtcs.find(x => x.raw === raw); if (!d) return;
      btn.disabled = true; btn.textContent = 'Odczyt…';
      try { d.details = await e.op(() => e.readDtcDetails(m, raw)); } catch (err) { d.details = { err: err.message, ext: [], snap: null }; }
      renderModules(); return;
    }
    if (btn.dataset.clear) {
      const id = btn.dataset.clear, foot = btn.closest('.cardfoot');
      const m = id === 'obd' ? null : report.modules.find(x => modKey(x) === id);
      const what = m ? `w module ${m.addr} ${m.name}` : 'silnika (OBD)';
      foot.innerHTML = `<div class="confirm"><span>Skasować błędy ${esc(what)}? Usunie to też zamrożone ramki i zresetuje gotowość systemów. Aktywne usterki wrócą od razu.</span>
        <div><button class="btn small danger" type="button" data-do="${id}">Kasuj</button><button class="btn small" type="button" data-cancel="1">Anuluj</button></div></div>`;
      return;
    }
    if (btn.dataset.cancel) { renderObd(); renderModules(); return; }
    if (btn.dataset.do) {
      const e = elm; if (!e) return;
      const id = btn.dataset.do; btn.disabled = true; btn.textContent = 'Kasowanie…';
      const m = id === 'obd' ? null : report.modules.find(x => modKey(x) === id);
      const r = await e.op(() => m ? e.clearModule(m) : e.clearObd());
      logLine(r.err ? '! kasowanie: ' + r.err : '— skasowano błędy ' + (m ? m.addr : 'OBD'));
      if (m) { const d = await e.op(() => e.readModuleDtcs(m)); m.dtcs = d.dtcs; m.err = d.err; }
      const isEng = x => x.tx === 0x7E0 || x.bmw === 0x12;
      if (!m || isEng(m)) { report.obd = await e.op(() => e.readObdDtcs()); report.freeze = await e.op(() => e.readFreeze(sup)); const em = report.modules.find(isEng); if (em && !m) { const d = await e.op(() => e.readModuleDtcs(em)); em.dtcs = d.dtcs; } }
      $('#scanProgress').textContent = r.err ? `Nie udało się skasować: ${r.err}` : `Skasowano. ${m && m.dtcs.length ? 'Część błędów wróciła, bo usterka jest aktywna.' : ''}`;
      renderObd(); renderModules();
    }
  });

  /* ---------- raport ---------- */
  function buildReport() {
    const L = [];
    L.push('VAG Diagnostyka – raport', 'Data: ' + new Date().toLocaleString('pl-PL'));
    L.push('Adapter: ' + (report.adapter || '—'), 'VIN: ' + (report.vin || '—'), 'Marka: ' + BRAND_NAMES[brand()] + (store.get('brand', 'auto') === 'auto' ? ' (z VIN)' : ' (wybrana ręcznie)'));
    const cal = report.calib || {};
    if (cal.ecuName || cal.calid) L.push(`Sterownik: ${cal.ecuName || '—'} · kalibracja: ${(cal.calid || []).join(', ') || '—'} · CVN: ${(cal.cvn || []).join(', ') || '—'}`);
    const r = report.readiness;
    if (r) { L.push(`Kontrolka MIL: ${r.mil ? 'włączona' : 'wyłączona'}, kody emisyjne: ${r.count}`); L.push('Gotowość: ' + r.monitors.map(m => `${m.name} ${m.complete ? 'gotowy' : 'NIEGOTOWY'}`).join('; ')); }
    L.push('', '== Silnik – kody OBD ==');
    const o = report.obd;
    if (o) for (const [k, n] of [['stored', 'Zapisane'], ['pending', 'Oczekujące'], ['permanent', 'Stałe']]) L.push(`${n}: ${o[k] == null ? 'nieobsługiwane' : o[k].length ? o[k].map(d => d.code + (d.desc ? ' ' + d.desc : '')).join('; ') : 'brak'}`);
    else L.push('nie odczytano');
    if (report.freeze) L.push(`Zamrożona ramka (${report.freeze.dtc}): ` + Object.entries(report.freeze.values).map(([k, v]) => `${CAT[k] ? CAT[k].name : k} ${CAT[k] ? fmtVal(CAT[k], v) : v} ${CAT[k] ? CAT[k].unit : ''}`.trim()).join('; '));
    L.push('', '== Moduły ==');
    for (const m of report.modules) {
      L.push(`[${m.addr}] ${m.name}  ${Object.entries(m.ident).map(([k, v]) => k + ': ' + v).join(' | ')}`);
      if (m.err) L.push('   błąd odczytu: ' + m.err);
      else if (!m.dtcs.length) L.push('   brak błędów');
      else m.dtcs.forEach(d => {
        L.push(`   ${d.full} [${d.flags.join(', ')}] ${d.desc}`.trimEnd());
        const inf = dtcInfo(d.code, brand() === 'bmw'); if (inf && inf.causes.length) L.push('      możliwe przyczyny: ' + inf.causes.join('; '));
        const x = d.details; if (x && !x.err) { x.ext.forEach(r => L.push(`      rekord ${hex2(r.rec)}: ${r.bytes.map(hex2).join(' ')}`)); if (x.snap) L.push('      środowisko: ' + x.snap.map(hex2).join(' ')); }
      });
      if (m.untested) L.push(`   (pominięto ${m.untested} ${plural(m.untested, 'pozycję', 'pozycje', 'pozycji')} z listy obsługiwanych kodów, bez usterki)`);
    }
    if (report.absent.length) L.push('Bez odpowiedzi: ' + report.absent.map(m => m.addr + ' ' + m.name).join(', '));
    if (panels) L.push(...panels.reportLines());
    if (tools) L.push(...tools.reportLines());
    L.push('', 'Obsługiwane PID (tryb 01): ' + ([...sup].filter(p => p % 0x20 !== 0).sort((a, b) => a - b).map(hex2).join(' ') || '—'));
    L.push('', '== Parametry (ostatni odczyt) ==');
    for (const [g, label] of GROUPS) {
      const ks = ORDER[g].filter(k => vals[k] != null && avail(k)); if (!ks.length) continue;
      L.push(label + ':');
      ks.forEach(k => { const c = CAT[k], s = stateOf(k, vals[k]); L.push(`   ${c.name}: ${fmtVal(c, vals[k])} ${c.unit}${s === 'warn' ? '  (UWAGA)' : s === 'crit' ? '  (ALARM)' : ''}`.trimEnd()); });
    }
    return L.join('\n');
  }
  $('#btnReport').onclick = e => copyText(buildReport(), e.currentTarget);
  $('#btnReportDl').onclick = () => download(`vag-raport-${stamp()}.txt`, buildReport(), 'text/plain');
  $('#btnLogCopy').onclick = e => copyText(logBuf.join('\n'), e.currentTarget);
  $('#btnLogClear').onclick = () => { logBuf.length = 0; renderLog(); };

  /* ---------- start ---------- */
  journal = createJournal({
    esc, plural, copyText, download, framed, logLine, store, vin: () => report.vin,
    version: typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'dev'
  });
  const saveLog = (kind, title, text, opt) => journal.add(kind, title, text, opt);
  panels = createPanels({
    saveLog,
    vals: () => vals, avail, stateOf, tokens, store, CAT, DTC_DESC, MODULES, modules, brand,
    esc, fmtNum, fmtVal, plural, copyText, logLine,
    elm: () => elm, mode: () => mode, sup: () => sup, report: () => report,
    renderErrors: () => { renderObd(); renderModules(); },
    ensurePolling: () => { if (!polling) startPolling(); }
  });
  tools = createTools({
    elm: () => elm, esc, fmtNum, plural, copyText, download, stamp, framed, logLine, store, MODULES, modules, brand,
    report: () => report, pause, saveLog
  });
  tools.render();
  bridge = createBridge({
    esc, store, logLine, copyText, banner, chip, devName: () => journal.devName(),
    startBridgeHost, stopBridgeHost, connectRemote: code => connect('remote', code),
    remoteLost: msg => lost(msg)
  });
  $('#btnBridge').onclick = () => bridge.dialog();
  syncSeg(); setButtons();
  setInterval(() => { if (elm && !$('#tab-state').hidden) renderState(); }, 3000);
  buildTiles();
  if (!navigator.serial) $('#btnSerial').hidden = true;
  if (!navigator.bluetooth) $('#btnBle').hidden = true;
  const mostCode = new URLSearchParams(location.search).get('most');
  if (mostCode) {
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    connect('remote', mostCode);
  } else if (IOS) {
    if (!navigator.bluetooth) banner('Na iPhonie steruj przez most: podłącz adapter do telefonu z Androidem lub komputera, włącz tam „Inne urządzenie → Most”, a tutaj naciśnij „Inne urządzenie” i wpisz kod.', 'info', { label: 'Inne urządzenie', fn: () => bridge.dialog() });
    else banner('iPhone łączy się bezpośrednio tylko z adapterami Bluetooth LE (4.0+). Z klasycznym adapterem użyj mostu: „Inne urządzenie”.', 'info');
  }
})();
