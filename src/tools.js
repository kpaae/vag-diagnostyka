/* ===== Narzędzia: testy OBD, skaner pomiarów VAG, konsola UDS, podsłuch magistrali ===== */
function createTools(api) {
  const $ = s => document.querySelector(s);
  const { esc, fmtNum, plural } = api;
  const host = () => $('#toolsPanel');
  const hexs = b => b.map(hex2).join(' ');
  const f = (v, d) => (v == null || !isFinite(v)) ? '—' : fmtNum(v, d);
  const dec = v => Number.isInteger(v) || Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : Math.abs(v) >= 1 ? 2 : 3;
  const now = () => performance.now();

  const st = {
    tests: null, testsBusy: false, testsMsg: '',
    scan: { running: false, stop: false, found: [], msg: '', watch: false, base: {}, last: {}, changed: new Set(), mod: '7E0:7E8', ranges: api.store.get('didRanges', '1000-1FFF'), ext: false, onlyChg: false },
    con: { mod: '7E0:7E8', lines: [], keep: null, pending: null },
    mon: { running: false, h: null, done: null, msgs: [], raw: [], t0: 0, frames: 0, restarts: 0, hideTp: true, onlyWrite: false, resume: null }
  };

  /* ---------- moduły ---------- */
  function modList() {
    const list = api.MODULES.map(m => ({ key: hex3(m.tx) + ':' + hex3(m.rx), label: `${m.addr} ${m.name}`, tx: m.tx, rx: m.rx }));
    for (const m of api.report().modules) if (!api.MODULES.some(x => x.tx === m.tx)) list.push({ key: hex3(m.tx) + ':' + hex3(m.rx), label: m.name, tx: m.tx, rx: m.rx });
    return list;
  }
  function modOf(key) { const [a, b] = key.split(':'); return { tx: parseInt(a, 16), rx: parseInt(b, 16) }; }
  function modName(id) {
    if (id === 0x7DF) return 'OBD, wszystkie';
    for (const m of api.MODULES) { if (m.tx === id) return `${m.addr} ${m.name} ←`; if (m.rx === id) return `${m.addr} ${m.name} →`; }
    return '0x' + hex3(id);
  }
  function modSelect(id, cur) {
    const opts = modList().map(m => `<option value="${m.key}"${m.key === cur ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
    return `<select id="${id}" class="inp">${opts}<option value="custom"${cur === 'custom' ? ' selected' : ''}>Własny adres…</option></select>`;
  }

  /* ---------- render ---------- */
  function render() {
    const h = host(); if (!h) return;
    const on = !!api.elm();
    h.innerHTML = `
      <div class="panel-intro"><h2 class="ptitle">Narzędzia</h2>
        <p class="muted">Testy sterownika, szukanie pomiarów VAG, ręczne polecenia i nagrywanie procedur z innych testerów. Polecenia zmieniające sterownik zawsze wymagają potwierdzenia, a programowanie jest zablokowane.</p></div>

      <div class="card"><div class="card-h"><h3>Testy sterownika silnika</h3><span class="n">OBD tryb 06</span></div>
        <p class="small muted">Wyniki testów, które sterownik robi sam w czasie jazdy: wypadanie zapłonów na każdy cylinder, sondy lambda, katalizator. Liczniki zapłonów pokazują problem, zanim zapali się kontrolka.</p>
        <div id="tTests"></div>
        <div class="cardfoot"><button class="btn small" id="tTestsBtn" type="button" ${on ? '' : 'disabled'}>Odczytaj testy</button><span class="tstatus" id="tTestsSt"></span></div></div>

      <div class="card"><div class="card-h"><h3>Pomiary VAG</h3><span class="n">skaner 0x22</span></div>
        <p class="small muted">Sterownik ma setki pomiarów poza standardem OBD (np. wastegate, korekty spalania stukowego, zawór chłodzenia), ale pod nieopisanymi numerami. Skaner sprawdza zakres numerów, a obserwacja pokazuje, które wartości się zmieniają. Na postoju, z włączonym silnikiem. Zakres 1000–1FFF trwa ok. 3–5 minut.</p>
        <div class="frow">${modSelect('tScanMod', st.scan.mod)}
          <label class="fl">Zakres <input id="tScanRng" class="inp mono" value="${esc(st.scan.ranges)}" spellcheck="false" autocomplete="off"></label>
          <label class="chk"><input type="checkbox" id="tScanExt"${st.scan.ext ? ' checked' : ''}> sesja rozszerzona</label></div>
        <div class="actions"><button class="btn small primary" id="tScanGo" type="button" ${on ? '' : 'disabled'}>Skanuj</button>
          <button class="btn small" id="tScanStop" type="button" hidden>Zatrzymaj</button>
          <button class="btn small" id="tWatch" type="button" hidden>Obserwuj zmiany</button>
          <label class="chk" id="tOnlyChgL" hidden><input type="checkbox" id="tOnlyChg"${st.scan.onlyChg ? ' checked' : ''}> tylko zmienne</label>
          <button class="btn small ghost" id="tScanCopy" type="button" hidden>Kopiuj listę</button></div>
        <p class="tstatus" id="tScanSt"></p>
        <div id="tScanRes" class="tblwrap"></div></div>

      <div class="card"><div class="card-h"><h3>Konsola UDS</h3><span class="n">dla zaawansowanych</span></div>
        <p class="small muted">Wysyła pojedyncze polecenie do wybranego modułu, np. odczytane z podsłuchu. Odczyty idą od razu. Zapis, procedury i testy elementów wymagają potwierdzenia. Programowanie jest zablokowane.</p>
        <div class="frow">${modSelect('tConMod', st.con.mod)}
          <span id="tConCustom" ${st.con.mod === 'custom' ? '' : 'hidden'}><label class="fl">TX <input id="tConTx" class="inp mono short" value="7E0"></label><label class="fl">RX <input id="tConRx" class="inp mono short" value="7E8"></label></span></div>
        <div class="frow"><input id="tConIn" class="inp mono grow" placeholder="np. 22F187" spellcheck="false" autocomplete="off" autocapitalize="characters"><button class="btn small primary" id="tConSend" type="button" ${on ? '' : 'disabled'}>Wyślij</button></div>
        <div class="actions quick">${[['22F187', 'Nr części'], ['22F19E', 'Plik ODX'], ['220600', 'Kodowanie'], ['1003', 'Sesja rozszerzona'], ['1001', 'Sesja domyślna'], ['3E00', 'Podtrzymanie']].map(([c, l]) => `<button class="btn small ghost" type="button" data-q="${c}">${esc(l)}</button>`).join('')}</div>
        <div id="tConConfirm"></div>
        <pre id="tConOut" class="conout" aria-live="polite"></pre></div>

      <div class="card"><div class="card-h"><h3>Podsłuch magistrali</h3><span class="n">nagrywanie procedur</span></div>
        <ol class="steps"><li>Podłącz adapter przez rozdzielacz OBD (kabel Y) razem z VCDS, OBDeleven albo testerem warsztatowym.</li>
          <li>Naciśnij Start, a potem uruchom procedurę w tamtym programie, np. odpowietrzanie chłodzenia albo test elementów.</li>
          <li>Po zakończeniu naciśnij Stop i pobierz log. Z niego da się odczytać dokładne polecenia i dodać je tu jako przyciski.</li></ol>
        <p class="small muted">W czasie podsłuchu aplikacja nie wysyła nic do auta, odczyt na żywo jest wstrzymany.</p>
        <div class="actions"><button class="btn small primary" id="tMonGo" type="button" ${on ? '' : 'disabled'}>Start</button>
          <button class="btn small" id="tMonStop" type="button" hidden>Stop</button>
          <label class="chk"><input type="checkbox" id="tMonHide"${st.mon.hideTp ? ' checked' : ''}> ukryj podtrzymanie sesji</label>
          <label class="chk"><input type="checkbox" id="tMonWr"${st.mon.onlyWrite ? ' checked' : ''}> tylko polecenia zmieniające</label>
          <button class="btn small ghost" id="tMonCopy" type="button" hidden>Kopiuj log</button>
          <button class="btn small ghost" id="tMonDl" type="button" hidden>Pobierz log</button></div>
        <p class="tstatus" id="tMonSt"></p>
        <div id="tMonOut" class="msgs"></div></div>`;
    bind(); renderTests(); renderScan(); renderCon(); renderMon(); sync();
  }

  function bind() {
    $('#tTestsBtn').onclick = readTests;
    $('#tScanMod').onchange = e => { st.scan.mod = e.target.value === 'custom' ? '7E0:7E8' : e.target.value; if (e.target.value === 'custom') e.target.value = st.scan.mod; };
    $('#tScanRng').onchange = e => { st.scan.ranges = e.target.value; api.store.set('didRanges', e.target.value); };
    $('#tScanExt').onchange = e => { st.scan.ext = e.target.checked; };
    $('#tScanGo').onclick = startScan;
    $('#tScanStop').onclick = () => { st.scan.stop = true; st.scan.watch = false; };
    $('#tWatch').onclick = toggleWatch;
    $('#tOnlyChg').onchange = e => { st.scan.onlyChg = e.target.checked; renderScan(); };
    $('#tScanCopy').onclick = e => api.copyText(scanText(), e.currentTarget);
    $('#tConMod').onchange = e => { stopKeep(); st.con.mod = e.target.value; $('#tConCustom').hidden = e.target.value !== 'custom'; };
    $('#tConSend').onclick = () => conSend($('#tConIn').value);
    $('#tConIn').onkeydown = e => { if (e.key === 'Enter') conSend(e.target.value); };
    host().querySelectorAll('[data-q]').forEach(b => { b.onclick = () => { $('#tConIn').value = b.dataset.q; conSend(b.dataset.q); }; });
    $('#tMonGo').onclick = startMon;
    $('#tMonStop').onclick = stopMon;
    $('#tMonHide').onchange = e => { st.mon.hideTp = e.target.checked; renderMon(); };
    $('#tMonWr').onchange = e => { st.mon.onlyWrite = e.target.checked; renderMon(); };
    $('#tMonCopy').onclick = e => api.copyText(monText(), e.currentTarget);
    $('#tMonDl').onclick = () => api.download(`vag-podsluch-${api.stamp()}.txt`, monText(), 'text/plain');
  }
  function sync() {
    if (!host() || !$('#tTestsBtn')) return;
    const on = !!api.elm(), busyBus = st.mon.running || st.scan.running;
    $('#tTestsBtn').disabled = !on || st.testsBusy || busyBus;
    $('#tScanGo').disabled = !on || busyBus; $('#tScanGo').hidden = st.scan.running;
    $('#tScanStop').hidden = !st.scan.running && !st.scan.watch;
    $('#tWatch').hidden = st.scan.running || !st.scan.found.length; $('#tWatch').textContent = st.scan.watch ? 'Zatrzymaj obserwację' : 'Obserwuj zmiany';
    $('#tWatch').disabled = !on || st.mon.running;
    $('#tOnlyChgL').hidden = !st.scan.found.length; $('#tScanCopy').hidden = !st.scan.found.length;
    $('#tConSend').disabled = !on || st.mon.running;
    $('#tMonGo').hidden = st.mon.running; $('#tMonGo').disabled = !on || st.scan.running || st.scan.watch; $('#tMonStop').hidden = !st.mon.running;
    $('#tMonCopy').hidden = $('#tMonDl').hidden = !st.mon.raw.length || st.mon.running;
    if (api.framed) $('#tMonDl').hidden = true;
  }

  /* ---------- testy OBD (tryb 06) ---------- */
  async function readTests() {
    const e = api.elm(); if (!e) return;
    st.testsBusy = true; sync(); $('#tTestsSt').textContent = 'Odczyt…';
    try {
      st.tests = await e.op(() => e.readTests(mid => { $('#tTestsSt').textContent = `Odczyt: ${midName(mid)}…`; }));
      st.testsMsg = st.tests.mids.length ? '' : 'Sterownik nie zgłasza żadnych wyników testów w trybie 06.';
      api.logLine(`— tryb 06: ${st.tests.tests.length} wyników`);
    } catch (err) { st.testsMsg = 'Nie udało się odczytać: ' + err.message; }
    st.testsBusy = false; $('#tTestsSt').textContent = ''; renderTests(); sync();
  }
  function misfireRows(tests) {
    const rows = [];
    for (let c = 1; c <= 12; c++) {
      const mid = 0xA1 + c, T = tests.filter(t => t.mid === mid); if (!T.length) continue;
      const cur = T.find(t => t.tid === 0x0C), avg = T.find(t => t.tid === 0x0B);
      rows.push({ c, cur: cur ? cur.value : null, avg: avg ? avg.value : null });
    }
    return rows;
  }
  function renderTests() {
    const el = $('#tTests'); if (!el) return;
    const T = st.tests;
    if (!T) { el.innerHTML = st.testsMsg ? `<p class="small">${esc(st.testsMsg)}</p>` : ''; return; }
    if (!T.tests.length) { el.innerHTML = `<p class="small">${esc(st.testsMsg || 'Brak wyników.')}</p>`; return; }
    const mis = misfireRows(T.tests);
    let html = '';
    if (mis.length) {
      const maxv = Math.max(1, ...mis.map(r => Math.max(r.cur || 0, r.avg || 0)));
      const tot = mis.reduce((a, r) => a + (r.cur || 0), 0);
      const worst = mis.reduce((a, r) => (r.cur || 0) > (a.cur || 0) ? r : a, mis[0]);
      const lead = tot === 0 ? '<p class="codehead ok">Brak wypadania zapłonów w bieżącym cyklu jazdy.</p>'
        : `<p class="codehead ${worst.cur > tot * 0.6 && tot >= 5 ? 'crit' : ''}">Wypadanie zapłonów: ${tot} w bieżącym cyklu${tot >= 5 && worst.cur > tot * 0.6 ? `, głównie cylinder ${worst.c}. Zamień cewkę z sąsiednim cylindrem i sprawdź, czy problem przejdzie za nią.` : '.'}</p>`;
      html += `<h4 class="sub">Wypadanie zapłonów</h4>${lead}
        <table class="tbl"><thead><tr><th>Cylinder</th><th>Bieżący cykl</th><th>Średnia 10 cykli</th><th class="barcol"></th></tr></thead><tbody>
        ${mis.map(r => `<tr><td>${r.c}</td><td class="num">${r.cur == null ? '—' : f(r.cur, 0)}</td><td class="num">${r.avg == null ? '—' : f(r.avg, 0)}</td><td class="barcol"><span class="bar" style="width:${Math.round(100 * Math.max(r.cur || 0, r.avg || 0) / maxv)}%"></span></td></tr>`).join('')}
        </tbody></table>
        <p class="small muted">Licznik bieżącego cyklu zeruje się po każdym uruchomieniu. Pojedyncze zliczenia na zimnym silniku są normalne.</p>`;
    }
    const rest = T.tests.filter(t => !(t.mid >= 0xA1 && t.mid <= 0xAD));
    const fails = T.tests.filter(t => !t.pass);
    const byMid = {}; rest.forEach(t => { (byMid[t.mid] = byMid[t.mid] || []).push(t); });
    html += `<h4 class="sub">Pozostałe testy <small>${T.tests.length} ${plural(T.tests.length, 'wynik', 'wyniki', 'wyników')}, poza zakresem: ${fails.length}</small></h4>`;
    html += Object.keys(byMid).map(Number).sort((a, b) => a - b).map(mid => {
      const L = byMid[mid], bad = L.some(t => !t.pass);
      return `<details class="tgroup"${bad ? ' open' : ''}><summary><span>${esc(midName(mid))}</span><span class="st ${bad ? 'no' : 'ok'}">${bad ? 'poza zakresem' : 'OK'}</span></summary>
        <table class="tbl"><thead><tr><th>Test</th><th class="num">Wynik</th><th class="num">Min</th><th class="num">Max</th></tr></thead><tbody>
        ${L.map(t => `<tr class="${t.pass ? '' : 'bad'}"><td>${esc(t.name)}</td><td class="num">${f(t.value, dec(t.value))} ${esc(t.unit)}</td><td class="num">${f(t.min, dec(t.min))}</td><td class="num">${f(t.max, dec(t.max))}</td></tr>`).join('')}
        </tbody></table></details>`;
    }).join('');
    el.innerHTML = html;
  }

  /* ---------- skaner pomiarów ---------- */
  function parseRanges(s) {
    const out = [];
    for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
      const m = part.match(/^([0-9a-f]{1,4})(?:-([0-9a-f]{1,4}))?$/i); if (!m) return null;
      const lo = parseInt(m[1], 16), hi = parseInt(m[2] || m[1], 16); if (hi < lo) return null;
      out.push([lo, hi]);
    }
    const n = out.reduce((a, [lo, hi]) => a + hi - lo + 1, 0);
    return out.length && n <= 0x4000 ? out : null;
  }
  async function startScan() {
    const e = api.elm(); if (!e) return;
    const ranges = parseRanges($('#tScanRng').value);
    if (!ranges) { $('#tScanSt').textContent = 'Zły zakres. Wpisz np. 1000-1FFF albo 0100-01FF, F400-F4FF (łącznie do 16 384 numerów).'; return; }
    const S = st.scan; S.running = true; S.stop = false; S.watch = false; S.found = []; S.base = {}; S.last = {}; S.changed = new Set();
    S.mod = $('#tScanMod').value === 'custom' ? '7E0:7E8' : $('#tScanMod').value;
    const mod = modOf(S.mod); const resume = api.pause(); const t0 = now();
    sync(); renderScan();
    try {
      await e.op(() => e.scanDids(mod, ranges, {
        extended: S.ext, stop: () => S.stop || e !== api.elm(),
        onProgress: (did, n, total) => { const el = $('#tScanSt'); if (el) el.textContent = `Sprawdzam 0x${hex4(did)} · ${n} z ${total} · znaleziono ${S.found.length} · ${Math.round((now() - t0) / 1000)} s`; },
        onFound: fd => { S.found.push(fd); S.base[fd.did] = fd.bytes; S.last[fd.did] = fd.bytes; if (S.found.length % 5 === 1) renderScan(); }
      }));
      S.msg = `${S.stop ? 'Zatrzymano' : 'Gotowe'}: ${S.found.length} ${plural(S.found.length, 'identyfikator odpowiada', 'identyfikatory odpowiadają', 'identyfikatorów odpowiada')}. ${S.found.length ? 'Teraz włącz obserwację i zmieniaj obroty albo poczekaj, aż silnik się nagrzeje.' : ''}`;
      api.logLine(`— skaner 0x22: ${S.found.length} DID`);
    } catch (err) { S.msg = 'Skanowanie przerwane: ' + err.message; }
    S.running = false; resume(); $('#tScanSt').textContent = S.msg; renderScan(); sync();
  }
  async function toggleWatch() {
    const S = st.scan; const e = api.elm(); if (!e) return;
    if (S.watch) { S.watch = false; sync(); return; }
    S.watch = true; sync();
    const resume = api.pause();
    const mod = modOf(S.mod); const list = S.found.slice(0, 120);
    let round = 0;
    while (S.watch && e === api.elm()) {
      for (const fd of list) {
        if (!S.watch || e !== api.elm()) break;
        const b = await e.op(() => e.readDidRaw(mod, fd.did));
        if (b) { S.last[fd.did] = b; if (hexs(b) !== hexs(S.base[fd.did] || [])) S.changed.add(fd.did); }
      }
      round++;
      const el = $('#tScanSt'); if (el) el.textContent = `Obserwacja: runda ${round}, zmienia się ${S.changed.size} z ${list.length}${S.found.length > list.length ? ` (obserwuję pierwsze ${list.length})` : ''}.`;
      renderScan();
    }
    S.watch = false; resume(); sync();
  }
  function u16s(b) { return b.length === 2 ? u16(b[0], b[1]) : b.length === 1 ? b[0] : null; }
  function renderScan() {
    const el = $('#tScanRes'); if (!el) return;
    const S = st.scan; let L = S.found; if (S.onlyChg) L = L.filter(fd => S.changed.has(fd.did));
    if (!L.length) { el.innerHTML = S.found.length && S.onlyChg ? '<p class="small muted">Żadna wartość jeszcze się nie zmieniła.</p>' : ''; return; }
    el.innerHTML = `<table class="tbl dids"><thead><tr><th>DID</th><th>Bajty</th><th>Teraz</th><th class="num">Liczbowo</th></tr></thead><tbody>
      ${L.slice(0, 400).map(fd => { const b = S.last[fd.did] || fd.bytes, ch = S.changed.has(fd.did), n = u16s(b), txt = asciiOrHex(b);
        return `<tr class="${ch ? 'chg' : ''}"><td class="mono">${hex4(fd.did)}</td><td class="num">${b.length}</td><td class="mono hexcell">${esc(b.length > 24 ? hexs(b.slice(0, 24)) + ' …' : hexs(b))}${txt !== hexs(b) ? `<br><span class="muted">${esc(txt.slice(0, 40))}</span>` : ''}</td><td class="num">${n == null ? '' : n}</td></tr>`; }).join('')}
      </tbody></table>${L.length > 400 ? `<p class="small muted">Pokazano 400 z ${L.length}. Pełna lista jest w „Kopiuj listę”.</p>` : ''}`;
  }
  function scanText() {
    const S = st.scan, m = modOf(S.mod);
    return [`Skaner 0x22 · moduł TX ${hex3(m.tx)} RX ${hex3(m.rx)} · ${S.found.length} DID · zmienne: ${S.changed.size}`,
      ...S.found.map(fd => `${hex4(fd.did)}  ${S.changed.has(fd.did) ? 'ZMIENNY' : '       '}  start: ${hexs(S.base[fd.did] || fd.bytes)}${S.changed.has(fd.did) ? '  teraz: ' + hexs(S.last[fd.did]) : ''}`)].join('\n');
  }

  /* ---------- konsola ---------- */
  function conMod() {
    const v = $('#tConMod').value;
    if (v !== 'custom') return modOf(v);
    const tx = parseInt($('#tConTx').value, 16), rx = parseInt($('#tConRx').value, 16);
    return (tx >= 0 && tx <= 0x7FF && rx >= 0 && rx <= 0x7FF) ? { tx, rx } : null;
  }
  function conLine(s, cls) { st.con.lines.push({ s, cls }); if (st.con.lines.length > 300) st.con.lines.shift(); renderCon(); }
  function renderCon() {
    const el = $('#tConOut'); if (!el) return;
    el.innerHTML = st.con.lines.map(l => `<span class="${l.cls || ''}">${esc(l.s)}</span>`).join('\n') || '<span class="muted">Odpowiedzi pojawią się tutaj.</span>';
    el.scrollTop = el.scrollHeight;
  }
  function conSend(input, confirmed) {
    const hex = (input || '').replace(/\s/g, '').toUpperCase();
    $('#tConConfirm').innerHTML = '';
    if (!/^([0-9A-F]{2})+$/.test(hex)) { conLine('! Wpisz polecenie w hex, parzystą liczbę znaków, np. 22F187.', 'err'); return; }
    const mod = conMod(); if (!mod) { conLine('! Zły adres modułu.', 'err'); return; }
    const c = classifyCmd(hex);
    if (c.level === 'block') { conLine('✕ ' + hex + ' – ' + c.why, 'err'); return; }
    if (c.level === 'write' && !confirmed) {
      $('#tConConfirm').innerHTML = `<div class="confirm"><span><b>${esc(hex)}</b> do 0x${hex3(mod.tx)}: ${esc(c.why)} Wyślij tylko, jeśli wiesz, co robi to polecenie w tym module (np. odczytałeś je z podsłuchu procedury). Silnik w trakcie testów elementów może się zachowywać nietypowo.</span>
        <div><button class="btn small danger" type="button" id="tConYes">Wyślij</button><button class="btn small" type="button" id="tConNo">Anuluj</button></div></div>`;
      $('#tConYes').onclick = () => conSend(hex, true);
      $('#tConNo').onclick = () => { $('#tConConfirm').innerHTML = ''; };
      return;
    }
    run(mod, hex);
  }
  async function run(mod, hex) {
    const e = api.elm(); if (!e) return;
    conLine(`> [${hex3(mod.tx)}] ${hex}  · ${classifyCmd(hex).why}`, 'req');
    try {
      const r = await e.op(() => e.raw(mod.tx, mod.rx, hex));
      if (r.err) conLine('< ' + r.err, 'err');
      else { const b = bytesOf(r.data); const txt = asciiOrHex(b.slice(3)); conLine('< ' + hexs(b) + (b.length > 3 && txt !== hexs(b.slice(3)) ? `   „${txt}”` : ''), 'ok'); }
      if (!r.err && hex.startsWith('10')) { if (hex === '1001') stopKeep(); else startKeep(mod); }
    } catch (err) { conLine('! ' + err.message, 'err'); }
  }
  function startKeep(mod) {
    stopKeep();
    st.con.keep = setInterval(() => { const e = api.elm(); if (!e || st.mon.running) return stopKeep(); e.op(() => e.raw(mod.tx, mod.rx, '3E00')).catch(() => {}); }, 2500);
    conLine('— sesja podtrzymywana automatycznie (3E00 co 2,5 s). Wyślij 1001, żeby wrócić do sesji domyślnej.', 'muted');
  }
  function stopKeep() { if (st.con.keep) { clearInterval(st.con.keep); st.con.keep = null; } }

  /* ---------- podsłuch ---------- */
  function svcLabel(b) {
    const sid = b[0];
    if (sid === 0x7F) return `odmowa ${SID_NAMES[b[1]] ? '(' + SID_NAMES[b[1]] + ')' : ''}: NRC ${hex2(b[2] || 0)} ${NRC[hex2(b[2] || 0)] || ''}`.trim();
    if (sid >= 0x40 && SID_NAMES[sid - 0x40]) return 'odp.: ' + SID_NAMES[sid - 0x40];
    return SID_NAMES[sid] || '';
  }
  async function startMon() {
    const e = api.elm(); if (!e) return;
    stopKeep();
    const M = st.mon; M.running = true; M.msgs = []; M.raw = []; M.t0 = now(); M.frames = 0; M.restarts = 0;
    M.resume = api.pause(); sync(); renderMon();
    const tp = createIsoTp((id, bytes) => {
      const t = (now() - M.t0) / 1000;
      const c = id === 0x7DF || api.MODULES.some(m => m.tx === id) || (id >= 0x700 && id < 0x776 && !api.MODULES.some(m => m.rx === id)) ? classifyCmd(bytes.map(hex2).join('')) : null;
      M.msgs.push({ t, id, bytes, w: c && c.level !== 'read', req: !!c });
      if (M.msgs.length > 20000) M.msgs.shift();
      schedule();
    });
    const onLine = l => { M.raw.push(((now() - M.t0) / 1000).toFixed(3) + '  ' + l); if (M.raw.length > 60000) M.raw.shift(); if (tp(l)) M.frames++; else if (/BUFFER FULL|STOPPED|CAN ERROR/.test(l)) M.raw.push('— ' + l); schedule(); };
    M.done = e.op(async () => {
      while (M.running && e === api.elm()) {
        const h = await e.monitor(onLine, () => { M.restarts++; });
        M.h = h;
        await h.ended;
        if (!M.running) break;
        await sleep(120);
      }
    }).catch(err => { api.logLine('! podsłuch: ' + err.message); });
    api.logLine('— podsłuch: start');
  }
  async function stopMon() {
    const M = st.mon; if (!M.running) return;
    M.running = false; $('#tMonStop').disabled = true;
    try { if (M.h) await M.h.stop(); } catch (e) {}
    try { await M.done; } catch (e) {}
    M.h = null; $('#tMonStop').disabled = false;
    const r = M.resume; M.resume = null; r && r();
    api.logLine(`— podsłuch: stop, ${M.frames} ramek, ${M.msgs.length} wiadomości`);
    renderMon(); sync();
  }
  let monTimer = null;
  function schedule() { if (!monTimer) monTimer = setTimeout(() => { monTimer = null; renderMon(); }, 300); }
  function monVisible() { const M = st.mon; return M.msgs.filter(m => !(M.hideTp && (m.bytes[0] === 0x3E || m.bytes[0] === 0x7E)) && (!M.onlyWrite || m.w)); }
  function renderMon() {
    const el = $('#tMonOut'), s = $('#tMonSt'); if (!el) return;
    const M = st.mon, V = monVisible();
    const nw = M.msgs.filter(m => m.w).length;
    s.textContent = M.running || M.raw.length ? `${M.running ? 'Nasłuch' : 'Zapisano'}: ${M.frames} ramek, ${M.msgs.length} wiadomości, w tym ${nw} ${plural(nw, 'polecenie zmieniające', 'polecenia zmieniające', 'poleceń zmieniających')}${M.restarts ? `, wznowień po przepełnieniu: ${M.restarts}` : ''}.` : '';
    el.innerHTML = V.slice(-300).map(m => `<div class="msg${m.w ? ' w' : ''}${m.req ? ' rq' : ''}"><span class="mt">${m.t.toFixed(2)}</span><span class="mid">${esc(modName(m.id))}</span><code>${esc(hexs(m.bytes.slice(0, 40)))}${m.bytes.length > 40 ? ' …' : ''}</code><span class="ms">${esc(svcLabel(m.bytes))}</span></div>`).join('')
      || (M.running ? '<p class="small muted">Czekam na komunikację diagnostyczną…</p>' : '');
    if (M.running) el.scrollTop = el.scrollHeight;
    sync();
  }
  function monText() {
    const M = st.mon;
    return ['VAG Diagnostyka – podsłuch magistrali', 'Data: ' + new Date().toLocaleString('pl-PL'), '',
      '== Wiadomości (złożone ISO-TP) ==',
      ...M.msgs.map(m => `${m.t.toFixed(3)}  ${hex3(m.id)}  ${modName(m.id).padEnd(28)}  ${hexs(m.bytes)}  ${svcLabel(m.bytes)}${m.w ? '  [ZMIENIA]' : ''}`),
      '', '== Surowe ramki ==', ...M.raw].join('\n');
  }

  /* ---------- API ---------- */
  return {
    render,
    onConnect() { st.tests = null; st.testsMsg = ''; st.scan.found = []; st.scan.changed = new Set(); render(); },
    sync,
    async stopAll() { stopKeep(); st.scan.stop = true; st.scan.watch = false; if (st.mon.running) { st.mon.running = false; try { st.mon.h && await st.mon.h.stop(); } catch (e) {} st.mon.resume = null; } sync(); },
    busy() { return st.mon.running || st.scan.running || st.scan.watch; },
    reportLines() {
      const L = [];
      if (st.tests && st.tests.tests.length) {
        L.push('', '== Testy sterownika (OBD tryb 06) ==');
        const mis = misfireRows(st.tests.tests);
        if (mis.length) L.push('Wypadanie zapłonów (bieżący cykl / średnia 10 cykli): ' + mis.map(r => `cyl. ${r.c}: ${r.cur ?? '—'} / ${r.avg ?? '—'}`).join('; '));
        const fails = st.tests.tests.filter(t => !t.pass);
        L.push(fails.length ? 'Poza zakresem: ' + fails.map(t => `${midName(t.mid)} – ${t.name}: ${f(t.value, dec(t.value))} ${t.unit} (min ${f(t.min, dec(t.min))}, max ${f(t.max, dec(t.max))})`).join('; ') : `Wszystkie ${st.tests.tests.length} wyniki w zakresie.`);
      }
      if (st.scan.found.length) L.push('', `Skaner 0x22: ${st.scan.found.length} DID, zmiennych ${st.scan.changed.size}`);
      return L;
    }
  };
}
