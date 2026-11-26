/* ===== Akumulator: napięcia, testy rozruchu i ładowania, odczyt danych z auta, przewodnik wymiany ===== */
function createBatt(api) {
  const $ = s => document.querySelector(s);
  const { esc, fmtNum } = api;
  const f = (v, d = 1) => (v == null || !isFinite(v)) ? '—' : fmtNum(v, d);
  const LV = { ok: 'OK', warn: 'Uwaga', crit: 'Problem', info: 'Info', na: 'Brak danych' };
  const V = (lvl, title, text) => ({ lvl, title, text });
  const checksHtml = list => `<ul class="checks">${list.map(c => `<li><span class="vd ${c.lvl}">${LV[c.lvl]}</span><div><b>${esc(c.title)}</b><p>${esc(c.text)}</p></div></li>`).join('')}</ul>`;
  const sorted = a => a.slice().sort((x, y) => x - y);
  const med = a => { if (!a.length) return null; const s = sorted(a), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const pct = (a, p) => { if (!a.length) return null; const s = sorted(a); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  const col = (S, k) => S.map(x => x[k]).filter(v => v != null && isFinite(v));
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const hx = b => b.map(x => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  const hex4 = d => d.toString(16).toUpperCase().padStart(4, '0');
  const ascii = b => b.every(x => x >= 32 && x < 127) ? String.fromCharCode(...b) : null;

  const KEYS = ['ecuV', 'adapterV', 'rpm', 'coolant', 'iat', 'ambient', 'runTime', 'load'];
  const LIVE = ['ecuV', 'adapterV', 'rpm', 'coolant'];
  /* Adres modułu 61 (monitor akumulatora J367) według typowej tabeli VAG: nie jest potwierdzony dla tego auta, dlatego tylko sprawdzamy, czy odpowie. */
  const M61 = { tx: 0x7E5, rx: 0x7ED }, GW = { tx: 0x710, rx: 0x77A };

  const TESTS = {
    ign: { name: 'Napięcie przy włączonym zapłonie', phases: [['Zapłon włączony, silnik nie pracuje. Nie włączaj dodatkowych odbiorników i niczego nie dotykaj.', 45]] },
    crank: { name: 'Rozruch', max: 180, phases: [['Zapłon włączony. Za chwilę uruchom silnik.', 150]] },
    charge: {
      name: 'Ładowanie (alternator)',
      phases: [
        ['Silnik na biegu jałowym, odbiorniki wyłączone (światła, ogrzewanie szyby, dmuchawa).', 40],
        ['Włącz odbiorniki: światła mijania, ogrzewanie tylnej szyby, dmuchawa na maksimum. Obroty nadal jałowe.', 45],
        ['Odbiorniki zostają włączone. Rozgrzany silnik, auto zabezpieczone (hamulec ręczny, luz): trzymaj ok. 2500 obr/min.', 45]
      ]
    }
  };
  const total = t => t.max || t.phases.reduce((a, p) => a + p[1], 0);

  const st = {
    run: null, t0: 0, samples: [], res: null, msg: '', busy: false, crankAt: null, startAt: null,
    scan: { running: false, stopReq: false, msg: '', last: null },
    form: (() => { try { return Object.assign({ cap: '70', en: '760', tech: '', man: '', ser: '' }, JSON.parse(api.store.get('battForm', '{}'))); } catch (e) { return { cap: '70', en: '760', tech: '', man: '', ser: '' }; } })(),
    probe: null, auto: false, waitAt: 0,
    armed: api.store.get('battMorning', '') === '1', marks: []
  };
  const saveForm = () => { try { api.store.set('battForm', JSON.stringify(st.form)); } catch (e) {} };
  const now = () => performance.now();

  /* ---------- analiza ---------- */
  function ctxText() {
    const e = med(col(st.samples, 'ect')), a = api.vals().ambient;
    return e != null || a != null ? ` Temperatura: płyn ${e != null ? f(e, 0) + ' °C' : '—'}${a != null ? ', otoczenie ' + f(a, 0) + ' °C' : ''}.` : '';
  }
  function adapterInfo(S) {
    const u = med(col(S, 'u')), a = med(col(S, 'a'));
    return u != null && a != null ? V('info', 'Adapter a sterownik', `Adapter pokazuje ${f(a, 1)} V, sterownik ${f(u, 2)} V. Ocenę opieram na odczycie ze sterownika. Odczyt adaptera bywa niższy o ok. 1 V (u Ciebie tak było przy zapłonie), więc nim nie oceniam.`) : null;
  }
  function analyzeIgn() {
    const S = st.samples.filter(s => (s.rpm ?? 0) < 100), out = [];
    const u = col(S, 'u');
    if (u.length < 5) { out.push(V('na', 'Napięcie przy zapłonie', 'Za mało odczytów przy stojącym silniku. Zrób test przed uruchomieniem silnika.')); return out; }
    const m = med(u), mn = Math.min(...u), first = med(u.slice(0, Math.max(2, u.length >> 2))), last = med(u.slice(-Math.max(2, u.length >> 2)));
    const lvl = m >= 12.4 ? 'ok' : m >= 12.0 ? 'warn' : 'crit';
    out.push(V(lvl, 'Napięcie przy włączonym zapłonie', `Mediana ${f(m, 2)} V, najniżej ${f(mn, 2)} V (${u.length} odczytów).${ctxText()} Ocena ogólna dla stojącego silnika: od ok. 12,4 V dobrze, 12,0–12,4 V akumulator częściowo rozładowany, poniżej 12,0 V rozładowany albo słaby. Włączony zapłon i odbiorniki obniżają odczyt o 0,2–0,4 V, więc sprawdź też napięcie miernikiem na klemach po całonocnym postoju.`));
    if (first - last > 0.25) out.push(V('warn', 'Napięcie spada w czasie testu', `Z ${f(first, 2)} V na początku do ${f(last, 2)} V na końcu. Przy samym zapłonie to oznaka akumulatora, który słabo trzyma obciążenie, albo rosnącego poboru auta (moduły, pompa, dmuchawa).`));
    const ai = adapterInfo(S); if (ai) out.push(ai);
    return out;
  }
  function analyzeCrank() {
    const S = st.samples, out = [];
    if (S.length < 5) { out.push(V('na', 'Rozruch', 'Za mało odczytów. Uruchom test przed rozruchem silnika i odczekaj do końca.')); return out; }
    const i0 = S.findIndex(s => (s.rpm ?? 0) > 0);
    if (i0 === 0) { out.push(V('na', 'Rozruch', 'Silnik już pracował, gdy zacząłeś test. Uruchom test przy wyłączonym silniku, a rozruch zrób po poleceniu.')); return out; }
    if (i0 < 0) { out.push(V('na', 'Rozruch', 'W czasie testu silnik nie został uruchomiony (obroty zostały zerowe).')); return out; }
    const pre = col(S.slice(0, i0), 'u'), mPre = med(pre);
    const iRun = S.findIndex((s, i) => i >= i0 && (s.rpm ?? 0) >= 600);
    const tS = S[i0].t, tR = iRun >= 0 ? S[iRun].t : S[S.length - 1].t;
    const win = S.filter(s => s.t >= tS - 1.0 && s.t <= tR && s.u != null);
    const lost = st.lostConn;
    out.push(V('info', 'Przed rozruchem', `Napięcie przy zapłonie: ${f(mPre, 2)} V (${pre.length} odczytów).${ctxText()}`));
    if (win.length < 2) {
      out.push(V('na', 'Napięcie w czasie rozruchu', `W czasie rozruchu (${f(tR - tS, 1)} s) mam ${win.length} odczytów. To za mało, żeby ocenić, i nie znaczy, że napięcie było dobre. Adapter i sterownik odpowiadają kilka razy na sekundę, a rozruch trwa krótko.${lost ? ' Połączenie z adapterem urwało się przy rozruchu.' : ''}`));
    } else {
      const mn = Math.min(...win.map(s => s.u)), lvl = mn >= 9.6 ? 'ok' : mn >= 8.5 ? 'warn' : 'crit';
      out.push(V(lvl, 'Najniższe napięcie w czasie rozruchu', `${f(mn, 2)} V przy rozruchu trwającym ${f(tR - tS, 1)} s (${win.length} odczytów), spadek o ${f(mPre - mn, 2)} V od napięcia przed rozruchem. To najniższy odczyt, który zdążyłem zapisać, a nie na pewno prawdziwe minimum. Progi ogólne: od ok. 9,6 V dobrze, 8,5–9,6 V słabo, poniżej 8,5 V źle. Są dla ok. 20 °C. Na mrozie niższe napięcie jest częstsze.${lost ? ' Połączenie z adapterem urwało się przy rozruchu: to samo w sobie wskazuje na zbyt niskie napięcie zasilania adaptera albo zły styk gniazda.' : ''}`));
    }
    if (iRun >= 0) {
      const after = S.filter(s => s.t >= tR + 3 && s.t <= tR + 10 && s.u != null).map(s => s.u), ma = med(after);
      if (ma != null) out.push(V(ma >= 13.2 ? 'ok' : ma >= 12.6 ? 'warn' : 'crit', 'Po rozruchu', `W 3–10 s po uruchomieniu napięcie wynosi ${f(ma, 2)} V. ${ma >= 13.2 ? 'Alternator się włączył.' : 'Alternator ładuje słabo albo jeszcze się nie włączył. Sterownik zarządzania energią może na początku ograniczać ładowanie.'}`));
      const hi = S.find(s => s.t > tR && s.u >= 13.2);
      if (hi) out.push(V('info', 'Czas do ładowania', `Napięcie dochodzi do 13,2 V po ${f(hi.t - tR, 1)} s od uruchomienia.`));
    }
    const ai = adapterInfo(S); if (ai) out.push(ai);
    return out;
  }
  function analyzeCharge() {
    const T = TESTS.charge, out = [], S = st.samples;
    let t0 = 0; const bounds = T.phases.map(p => { const a = t0; t0 += p[1]; return [a, t0]; });
    const rows = [];
    T.phases.forEach((p, i) => {
      const P = S.filter(s => s.t >= bounds[i][0] + 8 && s.t < bounds[i][1] && s.u != null);
      const u = col(P, 'u'), rpm = col(P, 'rpm');
      rows.push({ u: med(u), n: u.length, mn: u.length ? Math.min(...u) : null, mx: u.length ? Math.max(...u) : null, ripple: u.length > 4 ? pct(u, 0.95) - pct(u, 0.05) : null, rpm: med(rpm) });
    });
    const names = ['Bieg jałowy, bez odbiorników', 'Bieg jałowy, z odbiornikami', '2500 obr/min, z odbiornikami'];
    const lim = [[13.2, 12.8], [13.0, 12.6], [13.4, 13.0]];
    rows.forEach((r, i) => {
      if (r.n < 5) { out.push(V('na', names[i], 'Za mało odczytów w tej fazie.')); return; }
      const lvl = r.u >= lim[i][0] ? (r.u > 15.0 ? 'warn' : 'ok') : r.u >= lim[i][1] ? 'warn' : 'crit';
      const rpmOk = i < 2 ? (r.rpm == null || (r.rpm >= 550 && r.rpm <= 1200)) : (r.rpm != null && r.rpm >= 2000 && r.rpm <= 3200);
      out.push(V(rpmOk ? lvl : 'info', names[i], `Napięcie ${f(r.u, 2)} V (od ${f(r.mn, 2)} do ${f(r.mx, 2)}), obroty ${f(r.rpm, 0)}.${r.ripple != null ? ` Rozrzut ${f(r.ripple, 2)} V.` : ''}${rpmOk ? '' : ' Obroty w tej fazie nie zgadzają się z poleceniem, więc ocena jest niepewna.'}${r.u > 15.0 ? ' Powyżej 15 V: możliwe przeładowanie.' : ''}`));
    });
    if (rows[1].n >= 5 && rows[2].n >= 5 && rows[1].u < 13.2 && rows[2].u - rows[1].u < 0.1) out.push(V('warn', 'Alternator nie reaguje na obroty', `Napięcie z odbiornikami nie rośnie przy wyższych obrotach (${f(rows[1].u, 2)} V → ${f(rows[2].u, 2)} V). Przy słabym alternatorze albo paskowi to typowy objaw.`));
    out.push(V('info', 'Uwaga do oceny', 'Sterownik zarządzania energią w autach VAG potrafi celowo obniżać ładowanie (np. gdy akumulator jest pełny i ciepły), więc pojedynczy niski odczyt przy zapalonym silniku nie musi być usterką. Rozstrzygają fazy z odbiornikami.'));
    return out;
  }
  const analyze = () => st.run === 'ign' ? analyzeIgn() : st.run === 'crank' ? analyzeCrank() : analyzeCharge();

  /* ---------- test ---------- */
  function start(kind, auto) {
    if (!api.elm() || st.run) return;
    Object.assign(st, { run: kind, t0: now(), samples: [], res: null, msg: '', crankAt: null, startAt: null, lostConn: false, kind, auto: !!auto });
    api.ensurePolling(); ui();
  }
  /* Poranny start: rano po połączeniu test rozruchu rusza sam, skan modułów czeka na jego koniec, a przed rozruchem
     i tuż po nim aplikacja czyta tylko obroty i napięcie, żeby złapać jak najwięcej odczytów w czasie kręcenia rozrusznikiem. */
  function onConnect() {
    if (!st.armed || st.run) return false;
    st.marks = []; start('crank', true); api.showTab('batt'); setTimeout(() => { const g = $('#akGo'); if (g) g.scrollIntoView({ block: 'center' }); }, 300); return true;
  }
  function finishAuto() { if (st.auto) { st.auto = false; api.afterMorning(); } }
  function mark(what) {
    const t = new Date(), txt = what === 'epc' ? 'znacznik: EPC się zapaliło' : 'znacznik: czuję ograniczenie mocy';
    st.marks.push({ t, txt }); api.mark(txt); ui();
  }
  function stop(manual) {
    if (!st.run) return;
    const kind = st.run, T = TESTS[kind]; st.kind = kind;
    st.res = analyze(); st.run = null; st.msg = manual ? 'Przerwano ręcznie.' : 'Zakończono.';
    if (st.samples.length >= 5) {
      const csv = ['czas [s];napięcie sterownika [V];napięcie z adaptera [V];obroty [obr/min];płyn [°C]', ...st.samples.map(s => [f(s.t, 2), s.u ?? '', s.a ?? '', s.rpm ?? '', s.ect ?? ''].join(';').replace(/\./g, ','))].join('\n');
      const txt = [`== Akumulator: ${T.name} ==`, ...st.res.map(c => `[${LV[c.lvl]}] ${c.title}: ${c.text}`), '', '== Próbki (CSV) ==', csv].join('\n');
      api.saveLog('test-akumulator', `Akumulator: ${T.name}${st.auto ? ' (poranny start)' : ''}`, txt);
    }
    finishAuto(); ui();
  }
  function tick() {
    misAuto(curTab);
    if (!st.run) return;
    const T = TESTS[st.run], t = (now() - st.t0) / 1000, v = api.vals();
    if (!api.elm()) { st.lostConn = true; stop(false); return; }
    const fresh = api.fresh;
    st.samples.push({ t, u: fresh('ecuV') ? v.ecuV : null, a: v.adapterV, rpm: fresh('rpm') ? v.rpm : null, ect: v.coolant });
    if (st.run === 'crank') {
      /* Poranny start, a silnik już pracował przy połączeniu: to nie pierwszy start, nic nie zapisujemy. */
      if (st.auto && st.startAt == null && fresh('rpm') && (v.rpm ?? 0) >= 400 && !st.samples.slice(0, -1).some(x => x.rpm != null)) {
        st.run = null; st.res = null; st.msg = ''; st.morMsg = 'Silnik już pracował przy połączeniu, więc poranny test pominięty. Zostaje włączony na następny start.'; finishAuto(); ui(); return;
      }
      if (st.startAt == null && (v.rpm ?? 0) >= 600 && fresh('rpm')) st.startAt = t;
      if (st.startAt != null && t - st.startAt >= 30) { stop(false); return; }
    }
    if (t >= total(T)) { stop(false); return; }
    ui(true);
  }
  function phaseInfo() {
    const T = TESTS[st.run], t = (now() - st.t0) / 1000;
    if (st.run === 'crank') {
      if (st.startAt != null) return { text: 'Silnik pracuje. Nagrywam jeszcze chwilę.', left: Math.max(0, 30 - (t - st.startAt)) };
      const crk = st.samples.some(s => (s.rpm ?? 0) > 0);
      if (crk) return { text: 'Rozruch trwa…', left: Math.max(0, T.max - t) };
      if (st.auto && !ready()) return { text: 'Czekam na pierwszy odczyt statusu P2563, jeszcze nie odpalaj…', left: Math.max(0, T.max - t), wait: true };
      return { text: st.auto ? 'ODPAL TERAZ' : TESTS.crank.phases[0][0] + ' Czekam na rozruch.', left: Math.max(0, T.max - t), go: st.auto };
    }
    let acc = 0; for (const p of T.phases) { if (t < acc + p[1]) return { text: p[0], left: acc + p[1] - t }; acc += p[1]; }
    return { text: T.phases[T.phases.length - 1][0], left: 0 };
  }

  /* ---------- odczyt danych z auta ---------- */
  async function probe61() {
    const e = api.elm(); if (!e || st.busy) return;
    st.busy = true; st.probe = { msg: 'Sprawdzam moduł 61…' }; ui();
    const resume = api.pause();
    let m = {};
    try { m = await e.op(() => e.readDidsRaw(M61, [0xF187, 0xF189, 0xF190, 0xF19E])); } catch (x) { m = {}; }
    resume();
    const keys = Object.keys(m);
    const txt = d => m[d] && (ascii(m[d]) || hx(m[d]));
    st.probe = keys.length ? { ok: true, msg: `Moduł 61 odpowiada (0x7E5). Nr części: ${txt(0xF187) || '—'}, oprogramowanie: ${txt(0xF189) || '—'}, plik ODX: ${txt(0xF19E) || '—'}.` } : { ok: false, msg: 'Moduł 61 nie odpowiada pod adresem 0x7E5. Adres wzięty z typowej tabeli VAG i nie jest potwierdzony dla tego auta. Możliwe, że monitor akumulatora jest częścią gatewaya (19), albo że tego auta nie ma w ogóle.' };
    api.logLine('— akumulator: moduł 61 ' + (keys.length ? 'odpowiada' : 'nie odpowiada'));
    st.busy = false; ui();
  }
  const SCAN_KEY = l => 'battScan.' + l;
  function loadScan(l) { try { const r = JSON.parse(api.store.get(SCAN_KEY(l), 'null')); return r && r.d ? r : null; } catch (e) { return null; } }
  function rangesOf(s) {
    const out = [];
    for (const part of String(s).split(/[,;\s]+/).filter(Boolean)) {
      const m = part.match(/^([0-9a-f]{1,4})(?:-([0-9a-f]{1,4}))?$/i); if (!m) return null;
      const lo = parseInt(m[1], 16), hi = parseInt(m[2] || m[1], 16); if (hi < lo) return null; out.push([lo, hi]);
    }
    const n = out.reduce((a, [lo, hi]) => a + hi - lo + 1, 0);
    return out.length && n <= 0x4000 ? out : null;
  }
  async function scanGw(label) {
    const e = api.elm(); if (!e || st.busy || st.scan.running || api.toolsBusy()) return;
    const rg = rangesOf($('#akRange').value); if (!rg) { st.scan.msg = 'Zły zakres. Wpisz np. 0100-2FFF (łącznie do 16 384 numerów).'; ui(); return; }
    api.store.set('battRange', $('#akRange').value);
    Object.assign(st.scan, { running: true, stopReq: false, msg: 'Szukam…', label }); st.busy = true; ui();
    const resume = api.pause(), found = [], t0 = now(); let err = null;
    try {
      await e.op(() => e.scanDidsFast(GW, rg, {
        stop: () => st.scan.stopReq || e !== api.elm(),
        onProgress: (did, n, tot) => { st.scan.msg = `Sprawdzam 0x${hex4(did)} · ${n} z ${tot} · znaleziono ${found.length} · ${Math.round((now() - t0) / 1000)} s`; scanUi(); },
        onFound: fd => found.push(fd)
      }));
    } catch (x) { err = x.message; }
    resume(); st.busy = false;
    const d = {}; for (const fd of found) d[hex4(fd.did)] = hx(fd.bytes);
    const rec = { ts: Date.now(), ect: api.vals().coolant, u: api.vals().ecuV, range: $('#akRange').value, partial: st.scan.stopReq || !!err, d };
    try { api.store.set(SCAN_KEY(label), JSON.stringify(rec)); } catch (x) { err = (err ? err + '; ' : '') + 'nie zmieściło się w pamięci przeglądarki, dane są tylko w logu'; }
    st.scan.running = false; st.scan.last = { label, n: found.length, err, partial: rec.partial };
    st.scan.msg = `${rec.partial ? 'Przerwano' : 'Gotowe'}: gateway odpowiada na ${found.length} numerów${err ? ` (${err})` : ''}. Lista poszła do logu.`;
    const cand = found.filter(fd => { const a = ascii(fd.bytes); return a && a.replace(/[^0-9A-Za-z]/g, '').length >= 8; });
    api.saveLog('test-akumulator', `Akumulator: gateway, stan ${label === 'before' ? 'przed wymianą' : label === 'after' ? 'po wymianie' : 'bieżący'} (${found.length} DID)`, [
      `== Gateway (19): numery 0x22, które odpowiadają — ${label} ==`, `Zakres: ${rec.range}${rec.partial ? ' (przerwane)' : ''}${err ? ' · ' + err : ''}`, `Płyn silnika: ${rec.ect ?? '—'} °C, napięcie sterownika: ${rec.u ?? '—'} V`, '',
      'Odczyty tekstowe (≥8 znaków alfanumerycznych):', ...(cand.length ? cand.map(fd => `${hex4(fd.did)}: ${ascii(fd.bytes)}`) : ['brak']), '', 'Wszystkie:', ...found.map(fd => `${hex4(fd.did)} (${fd.bytes.length} B): ${hx(fd.bytes)}`)].join('\n'));
    ui();
  }
  function compare() {
    const a = loadScan('before'), b = loadScan('after');
    if (!a || !b) { st.scan.msg = 'Do porównania potrzebne są oba zapisy: przed i po wymianie.'; ui(); return; }
    const ch = [];
    for (const k of new Set([...Object.keys(a.d), ...Object.keys(b.d)])) if (a.d[k] !== b.d[k]) ch.push([k, a.d[k] ?? '(brak)', b.d[k] ?? '(brak)']);
    st.scan.diff = ch; st.scan.msg = `Porównanie: zmieniło się ${ch.length} z ${Object.keys(b.d).length} numerów.`;
    api.saveLog('test-akumulator', `Akumulator: różnice przed i po wymianie (${ch.length})`, [`== Gateway: różnice przed → po ==`, `Przed: ${new Date(a.ts).toLocaleString('pl-PL')}, napięcie ${a.u ?? '—'} V · Po: ${new Date(b.ts).toLocaleString('pl-PL')}, napięcie ${b.u ?? '—'} V`, '', ...(ch.length ? ch.map(([k, x, y]) => `${k}: ${x}  →  ${y}`) : ['brak zmian'])].join('\n'));
    ui();
  }

  /* ---------- widok ---------- */
  function minisHtml() {
    const ks = LIVE.filter(api.avail);
    if (!ks.length) return '<p class="small muted">Brak odczytów. Połącz się z adapterem.</p>';
    return `<div class="minis">${ks.map(k => `<div class="mini" data-k="${k}"><span>${esc(api.CAT[k].name)}</span><b>—</b><small>${esc(api.CAT[k].unit || '')}</small></div>`).join('')}</div>`;
  }
  function updMinis() {
    const h = $('#akLive'); if (!h) return; const v = api.vals();
    const want = LIVE.filter(api.avail).join(','), have = [...h.querySelectorAll('.mini')].map(x => x.dataset.k).join(',');
    if (want !== have) h.innerHTML = minisHtml();
    h.querySelectorAll('.mini').forEach(el => { const k = el.dataset.k; el.querySelector('b').textContent = v[k] == null ? '—' : api.fmtVal(api.CAT[k], v[k]); el.dataset.s = v[k] == null ? '' : api.stateOf(k, v[k]); });
    const g = $('#akGate'); if (g) g.innerHTML = gateHtml();
  }
  function gateHtml() {
    const v = api.vals(), on = !!api.elm(), u = v.ecuV, rpm = v.rpm;
    const row = (ok, t) => `<li><span class="vd ${ok == null ? 'na' : ok ? 'ok' : 'warn'}">${ok == null ? '?' : ok ? 'OK' : 'Nie'}</span><div><b>${esc(t)}</b></div></li>`;
    return `<ul class="checks">${row(on ? true : false, 'Adapter połączony')}${row(rpm == null ? null : rpm < 100, 'Silnik nie pracuje, zapłon włączony' + (rpm != null ? ` (${f(rpm, 0)} obr/min)` : ''))}${row(u == null ? null : u >= 12.5, `Napięcie sterownika co najmniej 12,5 V${u != null ? ` (teraz ${f(u, 2)} V)` : ''}. Przy niższym podłącz prostownik.`)}</ul>`;
  }
  const ready = () => api.p2Ready() || (now() - st.t0) / 1000 > 8;
  function morningUi() {
    const a = $('#akArm'); if (!a) return;
    a.textContent = st.armed ? 'Poranny start: włączony (wyłącz)' : 'Przygotuj na rano';
    a.classList.toggle('primary', !st.armed);
    const m = $('#akMorSt');
    if (m) m.textContent = st.run === 'crank' && st.auto ? '' : st.morMsg || (st.armed ? 'Gotowe. Rano po połączeniu test ruszy sam.' : 'Wyłączony.');
    const g = $('#akGo'); if (g) { const on = st.run === 'crank' && st.auto; g.hidden = !on; if (on) { const p = phaseInfo(); g.textContent = p.text; g.dataset.go = p.go ? '1' : ''; } }
    const on = !!api.elm(); for (const id of ['#akMarkEpc', '#akMarkLim']) { const b = $(id); if (b) b.disabled = !on; }
    const k = $('#akMarks'); if (k) k.textContent = st.marks.length ? 'Zapisane znaczniki: ' + st.marks.map(x => `${x.t.toLocaleTimeString('pl-PL')} ${x.txt.replace('znacznik: ', '')}`).join(' · ') : '';
  }
  function ui(light) {
    morningUi();
    const s = $('#akStatus'); if (!s) return;
    if (st.run) { const p = phaseInfo(), n = st.samples.length; s.textContent = `${TESTS[st.run].name}: ${p.text} · jeszcze ${mmss(p.left)} · ${n} próbek`; }
    else s.textContent = st.res ? `${TESTS[st.kind].name}: ${st.msg}` : '';
    if (light) { updMinis(); return; }
    const on = !!api.elm();
    for (const k of ['ign', 'crank', 'charge']) { const b = $('#akT_' + k); if (b) b.disabled = !on || !!st.run || st.busy; }
    const x = $('#akStop'); if (x) x.hidden = !st.run;
    const rc = $('#akRes'); if (rc) { rc.hidden = !st.res; if (st.res) rc.querySelector('.rbody').innerHTML = `<h3 class="sect">Wynik: ${esc(TESTS[st.kind].name)}</h3>` + checksHtml(st.res); }
    scanUi(); formUi(); updMinis();
  }
  function scanUi() {
    const m = $('#akScanSt'); if (!m) return; const on = !!api.elm(), busy = st.busy || !!st.run;
    m.textContent = st.scan.msg || '';
    const sc = { b1: 'before', b2: 'after', b3: 'now' };
    for (const id in sc) { const b = $('#akScan_' + sc[id]); if (b) b.disabled = !on || busy || st.scan.running; }
    const p = $('#akProbe'); if (p) p.disabled = !on || busy;
    const sp = $('#akScanStop'); if (sp) sp.hidden = !st.scan.running;
    const c = $('#akCmp'); if (c) c.disabled = !(loadScan('before') && loadScan('after'));
    const pr = $('#akProbeSt'); if (pr) pr.textContent = st.probe ? st.probe.msg : '';
    const sv = (l, id) => { const r = loadScan(l), el = $(id); if (el) el.textContent = r ? `zapisano ${new Date(r.ts).toLocaleString('pl-PL')} (${Object.keys(r.d).length} numerów${r.partial ? ', przerwane' : ''})` : 'jeszcze nie zapisano'; };
    sv('before', '#akSavedBefore'); sv('after', '#akSavedAfter');
    const d = $('#akDiff'); if (d) d.innerHTML = st.scan.diff ? (st.scan.diff.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th>DID</th><th>Przed</th><th>Po</th></tr></thead><tbody>${st.scan.diff.slice(0, 60).map(([k, x, y]) => `<tr><td class="mono">${esc(k)}</td><td class="mono small">${esc(x)}</td><td class="mono small">${esc(y)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small">Brak zmian.</p>') : '';
  }
  function formUi() {
    const o = $('#akVals'); if (!o) return; const F = st.form;
    const techName = { wet: 'zalewany (konwencjonalny)', efb: 'EFB', agm: 'AGM' }[F.tech];
    o.innerHTML = F.cap && F.man && F.ser && F.tech ? `<div class="minis"><div class="mini"><span>Pojemność</span><b>${esc(F.cap)}</b><small>Ah</small></div><div class="mini"><span>Technologia</span><b>${esc(techName)}</b></div><div class="mini"><span>Producent (kod)</span><b>${esc(F.man)}</b></div><div class="mini"><span>Numer seryjny</span><b class="mono" style="font-size:16px">${esc(F.ser)}</b></div></div>` : '<p class="small muted">Uzupełnij pola z naklejki, a tu pokażę wartości do wpisania.</p>';
  }
  function render() {
    const host = $('#battPanel'); if (!host) return;
    const vag = api.brand() === 'vag';
    const g = (() => { const m = api.report().modules.find(x => x.addr === '19'); return m && m.ident ? `${m.ident['Nr części'] || ''} ${m.ident['System'] || ''} (plik ODX: ${m.ident['Plik ODX'] || '—'})`.trim() : null; })();
    host.innerHTML = `
      <div class="panel-intro"><h2 class="ptitle">Start</h2>
        <p class="muted">Najważniejsze przy uruchamianiu auta: napięcia, błędy zapisane w sterownikach, wypadanie zapłonów oraz testy akumulatora. Oceny napięć to ogólne progi dla akumulatorów 12 V, nie dane producenta tego modelu.</p></div>
      <div class="card"><h3 class="sect">Napięcia teraz</h3><div id="akLive">${minisHtml()}</div>
        <p class="small muted" id="akLastKey"></p></div>
      <div class="card"><h3 class="sect">Błędy na start</h3><div id="akErr"></div>
        <div class="actions"><button class="btn small" id="akErrScan" type="button">Skanuj ponownie</button><button class="btn small ghost" id="akErrGo" type="button">Szczegóły w zakładce Błędy</button></div></div>
      <div class="card"><h3 class="sect">Wypadanie zapłonów</h3>
        <p class="small muted">Liczniki sterownika silnika z trybu 06 OBD: bieżący cykl jazdy i średnia z ostatnich 10 cykli. Przy pracującym silniku aplikacja odświeża je co minutę.</p>
        <div id="akMis"></div>
        <div class="actions"><button class="btn small" id="akMisGo" type="button">Odczytaj teraz</button></div></div>
      <div class="card ptest" id="akMorning"><h3 class="sect">Poranny start</h3>
        <p class="small muted">Nagrywa pierwszy start dnia: napięcie przy zapłonie, w czasie rozruchu i po nim, Twoje znaczniki EPC, a w autach VAG także moment testu P2563. Włącz wieczorem. Rano po połączeniu test ruszy sam, a skan modułów poczeka, aż się skończy.</p>
        <div class="actions"><button class="btn" id="akArm" type="button"></button></div>
        <p class="small" id="akMorSt"></p>
        <p class="kphase akgo" id="akGo" aria-live="assertive" hidden></p>
        <div class="actions"><button class="btn" id="akMarkEpc" type="button">EPC się zapaliło</button><button class="btn" id="akMarkLim" type="button">Czuję ograniczenie mocy</button></div>
        <p class="small" id="akMarks"></p>
        <details class="tgroup"><summary><span>Jak to działa</span></summary><ol class="steps" style="margin-top:8px"><li><b>Wieczorem</b><span>Naciśnij „Przygotuj na rano”. Ustawienie zostaje w telefonie.</span></li><li><b>Rano</b><span>Wepnij adapter, włącz zapłon bez odpalania i od razu „Port COM”.</span></li><li><b>Start</b><span>Aplikacja sama otworzy tę zakładkę. Poczekaj na „ODPAL TERAZ” (kilka sekund) i odpal jak zwykle.</span></li><li><b>Jazda</b><span>Telefon zostaje połączony, z włączonym ekranem. Gdy zapali się EPC albo poczujesz ograniczenie, naciśnij przycisk niżej, ale tylko wtedy, gdy to bezpieczne (np. na światłach). Wystarczy przybliżony czas.</span></li><li><b>Po jeździe</b><span>Poczekaj, aż logi wyślą się na GitHub (zakładka Logi).</span></li></ol></details>
      </div>
      <div class="card ptest"><h3 class="sect">Testy</h3>
        <p class="small muted">Każdy test zapisuje wynik i próbki do logu (idzie na GitHub). Wynik oceniam po napięciu ze sterownika silnika, nie z adaptera.</p>
        <ol class="steps"><li><b>Zapłon</b><span>45 s przy stojącym silniku. Rób rano na zimno, przed uruchomieniem.</span></li><li><b>Rozruch</b><span>Zapłon włączony, start, uruchomienie silnika. Rejestruje najniższe napięcie i czas dojścia do ładowania.</span></li><li><b>Ładowanie</b><span>Trzy fazy na pracującym silniku: jałowy, jałowy z odbiornikami, 2500 obr/min z odbiornikami.</span></li></ol>
        <p class="kphase" id="akStatus" aria-live="polite"></p>
        <div class="actions"><button class="btn" id="akT_ign" type="button">Test: zapłon</button><button class="btn" id="akT_crank" type="button">Test: rozruch</button><button class="btn" id="akT_charge" type="button">Test: ładowanie</button><button class="btn small ghost" id="akStop" type="button" hidden>Zakończ</button></div></div>
      <div class="card" id="akRes" hidden><div class="rbody"></div></div>
      <div class="card"${vag ? '' : ' hidden'}><h3 class="sect">Dane akumulatora w aucie (odczyt)</h3>
        <p class="small muted">Auta VAG z monitorem akumulatora trzymają jego dane (pojemność, technologia, producent, numer seryjny) w module 61 albo w gatewayu (19). Według źródeł o MQB adaptację robi się w gatewayu. Dla Twojego auta nie ma otwartych danych, więc aplikacja tylko odczytuje, co moduły podają, a numery wskaże porównanie przed i po wymianie.</p>
        <p class="small">${g ? `Gateway: ${esc(g)}.` : 'Gateway jeszcze nie odczytany: zrób skan modułów.'}</p>
        <p class="small" id="akProbeSt"></p>
        <div class="actions"><button class="btn small" id="akProbe" type="button">Sprawdź moduł 61</button></div>
        <label class="fl" style="margin-top:10px">Zakres numerów <input id="akRange" class="inp mono" value="${esc(api.store.get('battRange', '0100-2FFF'))}" spellcheck="false" autocomplete="off"></label>
        <p class="small muted">Pełny zakres zajmuje kilka do kilkunastu minut. Wynik zostaje zapamiętany. Zapisuj stan <b>przed</b> wymianą i <b>po</b>, żeby porównanie wskazało numery, w których siedzi akumulator.</p>
        <p class="small" id="akScanSt"></p>
        <div class="actions"><button class="btn small" id="akScan_before" type="button">Zapisz stan przed wymianą</button><button class="btn small" id="akScan_after" type="button">Zapisz stan po wymianie</button><button class="btn small ghost" id="akScan_now" type="button">Odczyt bieżący</button><button class="btn small" id="akCmp" type="button">Porównaj</button><button class="btn small ghost" id="akScanStop" type="button" hidden>Przerwij</button></div>
        <p class="small muted">Przed: <span id="akSavedBefore"></span><br>Po: <span id="akSavedAfter"></span></p>
        <div id="akDiff"></div></div>
      <div class="card"${vag ? '' : ' hidden'}><h3 class="sect">Wymiana akumulatora: rejestracja w aucie</h3>
        <p class="small muted">Zapisu do auta z aplikacji jeszcze nie ma. W źródłach nie znalazłem numerów ani formatu danych dla gatewaya tego auta, a zapis w ciemno mógłby uszkodzić adaptacje gatewaya. Rejestrację zrób w VCDS albo OBDeleven. Aplikacja przygotuje wartości, sprawdzi napięcie i zapisze stan przed i po, żeby następnym krokiem dało się zrobić zapis na sprawdzonych numerach.</p>
        <div class="fl2"><label class="fl">Pojemność [Ah] <input id="akCap" class="inp mono" inputmode="numeric" value="${esc(st.form.cap)}"></label>
        <label class="fl">Prąd rozruchowy [A, EN] <input id="akEn" class="inp mono" inputmode="numeric" value="${esc(st.form.en)}"></label>
        <label class="fl">Technologia <select id="akTech" class="inp"><option value="">wybierz</option><option value="wet">zalewany (konwencjonalny)</option><option value="efb">EFB</option><option value="agm">AGM</option></select></label>
        <label class="fl">Producent (kod z naklejki) <input id="akMan" class="inp mono" value="${esc(st.form.man)}" spellcheck="false" autocomplete="off"></label>
        <label class="fl">Numer seryjny z naklejki <input id="akSer" class="inp mono" value="${esc(st.form.ser)}" spellcheck="false" autocomplete="off"></label></div>
        <div id="akVals"></div>
        <h4 class="sect" style="margin-top:12px">Warunki</h4><div id="akGate"></div>
        <ol class="steps"><li><b>Przed</b><span>Zapisz stan „przed wymianą” (przycisk wyżej) na starym akumulatorze. Zapisz też notatkę ze starych wartości adaptacji w VCDS (Add to Log).</span></li><li><b>Wymiana</b><span>Zapłon wyłączony. Przy wymianie podłącz prostownik albo zasilacz podtrzymujący, żeby auto nie straciło zasilania i ustawień.</span></li><li><b>Rejestracja</b><span>Zapłon włączony, silnik nie pracuje, stabilne napięcie. VCDS: moduł 19 Gateway, Adaptation-10, kanały: pojemność („Battery adaptation – Size”), producent („Manufacturer”), numer seryjny („Serial number”), a technologię („Battery technology”) zmieniasz tylko przy innym typie akumulatora. Nazwy kanałów mogą wyglądać jak IDE03256-… Według CarPort-OBD u MQB kanał nazywa się 10801 „Battery adaptation”. U Ibizy 6P (Twoja) nie jest to potwierdzone, VCDS pokaże właściwy format.</span></li><li><b>Po</b><span>Wyłącz i włącz zapłon, sprawdź kanały, zapisz stan „po wymianie” w aplikacji i porównaj. Odczytaj błędy: nie powinno być błędów monitora akumulatora. Po krótkiej jeździe start-stop (jeśli auto go ma) wraca, gdy akumulator jest naładowany.</span></li></ol>
        <p class="small muted">Gdy akumulator nie ma czytelnego numeru seryjnego, źródła podają skrót: zwiększyć zapisany numer o 1. To rada z forum, nie dokumentacja producenta.</p></div>
      <div class="card"><h3 class="sect">Pobór prądu po wyłączeniu (miernik)</h3>
        <p class="small muted">Tego aplikacja nie zmierzy, bo auto usypia i adapter też wygasa. Ogólna metoda: zamknij auto, odczekaj 30–40 minut, aż moduły zasną, odepnij klemę ujemną i włącz amperomierz szeregowo między klemę a biegun. Typowo kilkadziesiąt mA to norma, kilkaset mA to usterka (wartości ogólne, nie dla tego modelu). Nie otwieraj drzwi i nie włączaj zapłonu w trakcie.</p></div>
      <div class="card"><h3 class="sect">Źródła</h3>
        <p class="small">Ross-Tech Wiki: Battery Replacement (wiki.ross-tech.com). CarPort-OBD: MQB battery adaptation (carport-obd.com). Iamcarhacker: VAG battery coding guide (iamcarhacker.com). Wątek na seatcupra.net o rejestracji akumulatora. Wnioski z forów i poradników są wskazówkami, nie dokumentacją producenta.</p></div>`;
    const sel = $('#akTech'); sel.value = st.form.tech;
    const bind = (id, k) => { $(id).oninput = e => { st.form[k] = e.target.value.trim(); saveForm(); formUi(); }; };
    bind('#akCap', 'cap'); bind('#akEn', 'en'); bind('#akMan', 'man'); bind('#akSer', 'ser'); sel.onchange = e => { st.form.tech = e.target.value; saveForm(); formUi(); };
    $('#akT_ign').onclick = () => start('ign'); $('#akT_crank').onclick = () => start('crank'); $('#akT_charge').onclick = () => start('charge');
    $('#akStop').onclick = () => stop(true);
    $('#akProbe').onclick = probe61;
    $('#akScan_before').onclick = () => scanGw('before'); $('#akScan_after').onclick = () => scanGw('after'); $('#akScan_now').onclick = () => scanGw('now');
    $('#akScanStop').onclick = () => { st.scan.stopReq = true; };
    $('#akCmp').onclick = compare;
    $('#akArm').onclick = () => { st.armed = !st.armed; st.morMsg = ''; api.store.set('battMorning', st.armed ? '1' : ''); ui(); };
    $('#akMarkEpc').onclick = () => mark('epc'); $('#akMarkLim').onclick = () => mark('lim');
    $('#akErrScan').onclick = () => api.rescan(); $('#akErrGo').onclick = () => api.showTab('errors');
    $('#akMisGo').onclick = () => readMis(true);
    errorsUi(); misUi();
    lastKey(); ui();
  }
  function lastKey() {
    const el = $('#akLastKey'); if (!el) return; const k = api.p2Info && api.p2Info();
    el.textContent = k ? `Strażnik P2563 zapisał przy ostatnim włączeniu zapłonu: ${f(k.u, 2)} V (płyn ${f(k.ect, 0)} °C).` : '';
  }
  /* ---------- błędy na start ---------- */
  function errorsUi() {
    const h = $('#akErr'); if (!h) return;
    const R = api.report(), on = !!api.elm(), scanning = api.scanning();
    const b = $('#akErrScan'); if (b) b.disabled = !on || scanning;
    if (!on) { h.innerHTML = '<p class="small muted">Połącz adapter. Skan błędów rusza sam po połączeniu.</p>'; return; }
    const rd = R.readiness, o = R.obd, mods = R.modules || [];
    const obdCodes = o ? [...(o.stored || []).map(c => ({ ...c, kind: 'zapisany' })), ...(o.pending || []).map(c => ({ ...c, kind: 'oczekujący' }))] : [];
    const modCodes = mods.flatMap(m => (m.dtcs || []).map(d => ({ m, d })));
    const lines = [];
    lines.push(`<li><span class="vd ${rd ? (rd.mil ? 'crit' : 'ok') : 'na'}">${rd ? (rd.mil ? 'Świeci' : 'OK') : '?'}</span><div><b>Kontrolka silnika (MIL)</b><p>${rd ? (rd.mil ? `Włączona, kody emisyjne: ${rd.count}.` : 'Wyłączona.') : 'Jeszcze nie odczytano.'}</p></div></li>`);
    lines.push(`<li><span class="vd ${o ? (obdCodes.length ? 'warn' : 'ok') : 'na'}">${o ? (obdCodes.length ? obdCodes.length : 'OK') : '?'}</span><div><b>Kody OBD silnika</b><p>${o ? (obdCodes.length ? obdCodes.map(c => `${esc(c.code)} (${c.kind})${c.desc ? ' – ' + esc(c.desc) : ''}`).join('<br>') : 'Brak zapisanych i oczekujących.') : scanning ? 'Odczyt w toku…' : 'Jeszcze nie odczytano.'}</p></div></li>`);
    const top = modCodes.slice(0, 8).map(({ m, d }) => `[${esc(m.addr)}] ${esc(m.name)}: ${esc(d.full || d.code)}${d.desc ? ' – ' + esc(d.desc) : ''} <small class="muted">(${esc((d.flags || []).filter(x => !/^status/.test(x)).join(', '))})</small>`);
    lines.push(`<li><span class="vd ${mods.length ? (modCodes.length ? 'warn' : 'ok') : 'na'}">${mods.length ? (modCodes.length ? modCodes.length : 'OK') : '?'}</span><div><b>Moduły ${esc(api.BRAND_NAMES[api.brand()] || '')}</b><p>${mods.length ? (modCodes.length ? top.join('<br>') + (modCodes.length > 8 ? `<br>i ${modCodes.length - 8} więcej w zakładce Błędy.` : '') : `Brak błędów w ${mods.length} odczytanych modułach.`) : ''}${scanning ? (mods.length ? '<br>' : '') + 'Skan modułów w toku…' : mods.length ? '' : 'Moduły jeszcze nie odczytane.'}</p></div></li>`);
    h.innerHTML = `<ul class="checks">${lines.join('')}</ul>`;
  }
  /* ---------- wypadanie zapłonów (tryb 06) ---------- */
  const mis = { res: null, at: 0, busy: false, msg: '' };
  async function readMis(manual) {
    const e = api.elm(); if (!e || mis.busy || st.run || api.toolsBusy()) return;
    mis.busy = true; mis.msg = 'Odczyt…'; misUi();
    try {
      const r = await e.op(() => e.readMisfires());
      mis.res = r; mis.at = Date.now(); mis.msg = r.ok ? '' : `Sterownik nie podał liczników (${r.err}).`;
      if (r.ok && manual) api.logLine(`— wypadanie zapłonów: ${misRows().map(x => `c${x.c} ${x.cur ?? '—'}/${x.avg ?? '—'}`).join(', ') || 'brak liczników'}`);
    } catch (x) { mis.msg = 'Nie udało się odczytać: ' + x.message; }
    mis.busy = false; misUi();
  }
  function misRows() {
    const T = (mis.res && mis.res.tests) || [], rows = [];
    for (let c = 1; c <= 12; c++) { const L = T.filter(t => t.mid === 0xA1 + c); if (!L.length) continue; const cur = L.find(t => t.tid === 0x0C), avg = L.find(t => t.tid === 0x0B); rows.push({ c, cur: cur ? cur.value : null, avg: avg ? avg.value : null }); }
    return rows;
  }
  function misUi() {
    const h = $('#akMis'); if (!h) return;
    const b = $('#akMisGo'); if (b) b.disabled = !api.elm() || mis.busy || !!st.run;
    if (!mis.res) { h.innerHTML = `<p class="small muted">${esc(mis.msg || (api.elm() ? 'Odczytam po uruchomieniu silnika albo przyciskiem.' : 'Połącz adapter.'))}</p>`; return; }
    const R = misRows();
    if (!R.length) { h.innerHTML = `<p class="small">${esc(mis.msg || 'Sterownik nie podaje liczników wypadania zapłonów dla cylindrów (tryb 06, MID A2 i dalej).')}</p>`; return; }
    const tot = R.reduce((a, r) => a + (r.cur || 0), 0), worst = R.reduce((a, r) => (r.cur || 0) > (a.cur || 0) ? r : a, R[0]), maxv = Math.max(1, ...R.map(r => Math.max(r.cur || 0, r.avg || 0)));
    const lead = tot === 0 ? '<p class="codehead ok">Brak wypadania zapłonów w bieżącym cyklu jazdy.</p>' : `<p class="codehead ${tot >= 5 && worst.cur > tot * 0.6 ? 'crit' : ''}">${tot} w bieżącym cyklu${tot >= 5 && worst.cur > tot * 0.6 ? `, głównie cylinder ${worst.c}` : ''}.</p>`;
    h.innerHTML = `${lead}<div class="tblwrap"><table class="tbl"><thead><tr><th>Cylinder</th><th class="num">Bieżący cykl</th><th class="num">Średnia 10 cykli</th><th class="barcol"></th></tr></thead><tbody>${R.map(r => `<tr><td>${r.c}</td><td class="num">${r.cur == null ? '—' : f(r.cur, 0)}</td><td class="num">${r.avg == null ? '—' : f(r.avg, 0)}</td><td class="barcol"><span class="bar" style="width:${Math.round((r.cur || 0) / maxv * 100)}%"></span></td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Odczyt ${new Date(mis.at).toLocaleTimeString('pl-PL')}. Licznik bieżącego cyklu zeruje się po każdym uruchomieniu. Pojedyncze zliczenia na zimnym silniku są normalne. Przy kilku zliczeniach w jednym cylindrze zamień cewkę z sąsiednim cylindrem i sprawdź, czy błąd przejdzie razem z nią.</p>`;
  }
  /* Automatycznie: na zakładce Start, przy pracującym silniku, co minutę (nie w czasie testu rozruchu). */
  let misCheck = 0;
  function misAuto(tab) {
    const t = Date.now(); if (t - misCheck < 5000) return; misCheck = t;
    const v = api.vals();
    if (tab === 'batt' && api.elm() && !st.run && (v.rpm ?? 0) >= 400 && t - mis.at > 60000) readMis(false);
  }
  /* ---------- API ---------- */
  const keysFor = tab => (tab === 'batt' || st.run) ? KEYS : null;
  const tNow = () => (now() - st.t0) / 1000;
  /* Przed rozruchem i 3 s po nim: tylko obroty i napięcie (jedno krótkie zapytanie, kilka odczytów na sekundę). */
  const fastKeys = () => st.run === 'crank' && (st.startAt == null || tNow() - st.startAt < 3) ? ['rpm', 'ecuV'] : null;
  /* Wolne odczyty (status błędu ok. 1,5 s, skan) wstrzymane od gotowości do rozruchu do 10 s po uruchomieniu silnika. */
  const hold = () => st.run === 'crank' && (st.startAt == null || tNow() - st.startAt < 10);
  let curTab = 'batt';
  function onTab(t) { curTab = t; if (t === 'batt') { lastKey(); ui(); errorsUi(); misUi(); } }
  function stopAll() { if (st.run) { st.lostConn = !api.elm(); stop(false); } st.auto = false; if (st.scan.running) st.scan.stopReq = true; }
  return { render, tick, keysFor, onTab, stopAll, onConnect, fastKeys, hold, errorsUi, busy: () => !!st.run || st.busy };
}
