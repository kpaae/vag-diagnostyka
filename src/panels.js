/* ===== Panele diagnostyczne: P0299 (doładowanie) i ogrzewanie ===== */
function createPanels(api) {
  const $ = s => document.querySelector(s);
  const { esc, fmtNum, CAT } = api;
  const LV = { ok: 'OK', warn: 'Uwaga', crit: 'Problem', info: 'Info', na: 'Brak danych' };
  const V = (lvl, title, text) => ({ lvl, title, text });
  const f = (v, d = 1) => (v == null || !isFinite(v)) ? '—' : fmtNum(v, d);
  const sgn = (v, d) => (v >= 0 ? '+' : '') + f(v, d);
  const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const mn = a => a.length ? Math.min(...a) : null;
  const mx = a => a.length ? Math.max(...a) : null;
  const col = (S, k) => S.map(s => s[k]).filter(x => x != null && isFinite(x));
  const fmtMin = m => { const s = Math.round(m * 60); return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; };
  let cur = 'live';

  /* ---------- wspólne elementy ---------- */
  const checksHtml = list => `<ul class="checks">${list.map(c => `<li><span class="vd ${c.lvl}">${LV[c.lvl]}</span><div><b>${esc(c.title)}</b><p>${esc(c.text)}</p></div></li>`).join('')}</ul>`;
  const stepsHtml = list => list.map(s => `<li><b>${esc(s[0])}</b><span>${esc(s[1])}</span></li>`).join('');
  function minis(keys) {
    const ks = keys.filter(api.avail);
    if (!ks.length) return '<p class="small muted">Sterownik nie podaje parametrów potrzebnych w tym panelu.</p>';
    return `<div class="minis">${ks.map(k => `<div class="mini" data-k="${k}"><span>${esc(CAT[k].name)}</span><b>—</b><small>${esc(CAT[k].unit || '')}</small></div>`).join('')}</div>`;
  }
  function updMinis(id) {
    const host = $('#' + id); if (!host) return;
    const vals = api.vals();
    host.querySelectorAll('.mini').forEach(el => {
      const k = el.dataset.k, v = vals[k];
      el.querySelector('b').textContent = v == null ? '—' : api.fmtVal(CAT[k], v);
      el.dataset.s = v == null ? '' : api.stateOf(k, v);
    });
  }
  /* Adresy modułów w panelach są podane po VAG-owsku (01 silnik, 08 klimatyzacja); dla BMW tłumaczymy je na adresy BMW. */
  const mapAddr = a => api.brand() === 'bmw' ? ({ '01': '12', '08': '78' }[a] || a) : a;
  const sameMod = (x, m) => (x.bmw != null || m.bmw != null) ? x.bmw === m.bmw : x.tx === m.tx;
  function codeHits(codes, addrs0) {
    const addrs = addrs0.map(mapAddr), ENG = mapAddr('01');
    const rep = api.report(), hits = [], seen = new Set();
    const add = (shown, base, src, flags) => { const key = shown + src; if (seen.has(key)) return; seen.add(key); hits.push({ shown, base, src, flags: flags || '', desc: api.DTC_DESC[base] || '' }); };
    if (rep.obd) {
      (rep.obd.stored || []).forEach(d => codes.includes(d.code) && add(d.code, d.code, 'OBD, zapisany'));
      (rep.obd.pending || []).forEach(d => codes.includes(d.code) && add(d.code, d.code, 'OBD, oczekujący'));
    }
    rep.modules.forEach(m => {
      const whole = addrs.includes(m.addr);
      m.dtcs.forEach(d => { if (whole || (m.addr === ENG && codes.includes(d.code))) add(d.full, d.code, 'moduł ' + m.addr, d.flags.filter(x => !x.startsWith('status')).join(', ')); });
    });
    const read = !!rep.obd || rep.modules.some(m => m.addr === ENG || addrs.includes(m.addr));
    return { hits, read };
  }
  const codeList = hits => `<div class="codes">${hits.map(h => `<div class="codeline"><code>${esc(h.shown)}</code><span>${esc(h.desc || 'kod producenta, brak opisu')}</span><span class="flag">${esc(h.src)}${h.flags ? ' · ' + esc(h.flags) : ''}</span></div>`).join('')}</div>`;
  function freezeHtml(dtc) {
    const fr = api.report().freeze; if (!fr || fr.dtc !== dtc) return '';
    return `<p class="small muted">Zamrożona ramka, czyli warunki w chwili zapisania ${esc(dtc)}:</p><table class="freeze"><tbody>${Object.entries(fr.values).map(([k, v]) => `<tr><td>${esc(CAT[k] ? CAT[k].name : k)}</td><td>${CAT[k] ? api.fmtVal(CAT[k], v) : v} ${CAT[k] ? esc(CAT[k].unit) : ''}</td></tr>`).join('')}</tbody></table>`;
  }
  async function readCodes(btn, addrs) {
    const e = api.elm(); if (!e) return;
    const label = btn.textContent; btn.disabled = true; btn.textContent = 'Odczytuję…';
    try {
      const rep = api.report();
      rep.obd = await e.op(() => e.readObdDtcs());
      rep.freeze = await e.op(() => e.readFreeze(api.sup()));
      for (const addr of addrs.map(mapAddr)) {
        const m = api.modules().find(x => x.addr === addr); if (!m) continue;
        const r = await e.op(() => e.scanModule(m, true));
        const i = rep.modules.findIndex(x => sameMod(x, m));
        if (r) { if (i >= 0) rep.modules[i] = r; else rep.modules.push(r); rep.absent = rep.absent.filter(x => !sameMod(x, m)); }
        else if (i < 0 && !rep.absent.some(x => sameMod(x, m))) rep.absent.push(m);
      }
      api.renderErrors();
    } catch (err) { api.logLine('! ' + err.message); }
    btn.disabled = false; btn.textContent = label;
  }
  function csvOf(S, cols, tLabel, tMul) {
    const used = cols.filter(c => S.some(s => s[c[0]] != null));
    const out = [[tLabel, ...used.map(c => c[1])].join(';')];
    for (const s of S) out.push([(s.t * tMul).toFixed(2).replace('.', ','), ...used.map(c => s[c[0]] == null ? '' : String(+(+s[c[0]]).toFixed(3)).replace('.', ','))].join(';'));
    return out.join('\r\n');
  }

  /* ---------- wykres ---------- */
  function niceStep(r) { const p = Math.pow(10, Math.floor(Math.log10(r))); const m = r / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; }
  function drawChart(cv, series, o) {
    if (!cv) return;
    const W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d'); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const tk = api.tokens(), pts = series.flatMap(s => s.pts), refs = o.refs || [];
    ctx.font = `12px ${tk.mono}`; ctx.fillStyle = tk.muted;
    if (pts.length < 2) { ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(o.empty || 'Brak danych', W / 2, H / 2); return; }
    let x0 = o.xMin ?? mn(pts.map(p => p.x)), x1 = mx(pts.map(p => p.x));
    let y0 = mn(pts.map(p => p.y).concat(refs.map(r => r.y))), y1 = mx(pts.map(p => p.y).concat(refs.map(r => r.y)));
    if (x1 - x0 < 1e-6) x1 = x0 + 1;
    if (y1 - y0 < 1e-6) { y0 -= 1; y1 += 1; }
    const yp = (y1 - y0) * 0.08; y0 -= yp; y1 += yp;
    const xs = niceStep((x1 - x0) / 5), ys = niceStep((y1 - y0) / 4);
    const L = 46, R = 12, T = 8, B = 24;
    const X = x => L + (x - x0) / (x1 - x0) * (W - L - R), Y = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
    const dd = s => s >= 1 ? 0 : s >= 0.1 ? 1 : 2;
    ctx.strokeStyle = tk.line; ctx.lineWidth = 1; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = Math.ceil(y0 / ys); i * ys <= y1 + 1e-9; i++) { const y = Math.round(Y(i * ys)) + 0.5; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke(); ctx.fillText(fmtNum(i * ys, dd(ys)), L - 6, y); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let i = Math.ceil(x0 / xs); i * xs <= x1 + 1e-9; i++) ctx.fillText(fmtNum(i * xs, dd(xs)), X(i * xs), H - B + 6);
    refs.forEach(r => {
      const y = Math.round(Y(r.y)) + 0.5;
      ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = tk.muted; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke(); ctx.restore();
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(r.label, W - R - 2, y - 3);
    });
    series.forEach(s => {
      if (s.pts.length < 2) return;
      ctx.save(); ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; if (s.dash) ctx.setLineDash([6, 4]);
      ctx.beginPath(); s.pts.forEach((p, i) => { const px = X(p.x), py = Y(p.y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke(); ctx.restore();
    });
  }

  /* =================== P0299 – za niskie doładowanie =================== */
  const BOOST_KEYS = ['rpm', 'pedal', 'pedalRel', 'tps', 'load', 'boost', 'boostTarget', 'boostDev', 'map', 'baro', 'iat', 'ambient', 'stft1', 'ltft1', 'lambdaA', 'lambdaCmd', 'timing', 'railP', 'maf', 'wgCmd', 'wgAct', 'wgU', 'wgUsp', 'coolant', 'speed'];
  const BOOST_LIVE = ['boost', 'boostTarget', 'boostDev', 'map', 'rpm', 'pedal', 'iat', 'wgAct', 'wgU', 'wgUsp'];
  const BOOST_CODES = ['P0299', 'P0234', 'P0236', 'P0237', 'P0238', 'P0243', 'P0245', 'P0246', 'P2563', 'P0101', 'P0102', 'P0103', 'P0106', 'P0107', 'P0108', 'P0171', 'P2279', 'P0087', 'P0088', 'P0300', 'P0301', 'P0302', 'P0303', 'P0304', 'P0325'];
  const BOOST_COLS = [['rpm', 'obroty [obr/min]'], ['pedal', 'pedał [%]'], ['pedalRaw', 'pedał OBD 0x49 [%]'], ['load', 'obciążenie [%]'], ['boost', 'doładowanie [bar]'], ['target', 'zadane [bar]'], ['dev', 'odchyłka [bar]'], ['iat', 'dolot [°C]'], ['amb', 'otoczenie [°C]'], ['stft', 'korekta krótkoterm. [%]'], ['ltft', 'korekta długoterm. [%]'], ['lam', 'lambda'], ['lamCmd', 'lambda zadana'], ['timing', 'zapłon [°]'], ['rail', 'paliwo [bar]'], ['maf', 'MAF [g/s]'], ['wgC', 'wastegate zadany [%]'], ['wgA', 'wastegate rzecz. [%]'], ['ect', 'płyn [°C]'], ['speed', 'prędkość [km/h]']];
  const SUSPECT = {
    leak: ['Nieszczelność dolotu po stronie ciśnienia', 'Przewody intercoolera i ich opaski, sam intercooler i membrana zaworu przelotowego. Najpewniej wykryje to test dymny albo próba szczelności przy lekkim nadciśnieniu w warsztacie.'],
    wg: ['Wastegate i jego siłownik', 'Czy cięgno nie ma luzu, czy porusza się płynnie w pełnym zakresie i czy siłownik reaguje na sterowanie. Wyrobiony sworzeń klapy wastegate to częsta przyczyna P0299.'],
    sensor: ['Czujnik ciśnienia doładowania', 'Przy wyłączonym silniku musi pokazywać ciśnienie atmosferyczne. Sprawdź wtyczkę, wyczyść czujnik z nalotu olejowego albo wymień.'],
    ic: ['Intercooler i temperatura dolotu', 'Wyczyść intercooler z zewnątrz i sprawdź, czy w środku nie ma oleju (wycieki z turbo).'],
    fuel: ['Zasilanie paliwem', 'Mieszanka uboga albo spadek ciśnienia pod obciążeniem: sprawdź pompę wysokiego ciśnienia i jej popychacz.'],
    restr: ['Opory dolotu lub wydechu', 'Najpierw filtr powietrza. Rzadziej przyczyną jest zatkany katalizator.']
  };
  const bt = { running: false, t0: 0, samples: [], result: null, sensor: null, sensorMsg: '', pulls: 0 };

  function sampleBoost(v) {
    return {
      t: (performance.now() - bt.t0) / 1000, rpm: v.rpm, pedal: v.pedalRel ?? v.pedal ?? v.tps, pedalRaw: v.pedal, load: v.load,
      boost: v.boost, target: v.boostTarget, dev: v.boostDev, iat: v.iat, amb: v.ambient,
      stft: v.stft1, ltft: v.ltft1, lam: v.lambdaA ?? v.lambdaV, lamCmd: v.lambdaCmd, timing: v.timing,
      rail: v.railP ?? v.railPabs, maf: v.maf, wgC: v.wgUsp ?? v.wgCmd, wgA: v.wgU ?? v.wgAct, ect: v.coolant, speed: v.speed
    };
  }
  /* Pełny gaz. Pedał z OBD (PID 0x49) u wielu aut, m.in. VAG, przy wciśniętym do końca pedale pokazuje tylko ok. 75–85%,
     więc próg liczymy od największej wartości widzianej w teście: 90% z niej, nie mniej niż 60% i nie więcej niż 80%. */
  function wotThr() { const m = bt.pedMax ?? 0; return Math.min(80, Math.max(60, m * 0.9)); }
  /* Bieg jałowy: pedał puszczony. PID 0x49 nie schodzi do zera (zwykle 12–16%), więc liczymy od najmniejszej wartości w teście. */
  const pedIdle = s => s.pedal == null || s.pedal < (bt.pedMin ?? 0) + 3;
  const isWot = s => (s.pedal != null ? s.pedal >= wotThr() : (s.load ?? 0) >= 85) && (s.rpm ?? 0) >= 1500;
  const span = p => mx(col(p, 'rpm')) - mn(col(p, 'rpm'));
  function findPulls(S) {
    const segs = []; let cur = null, gap = 0;
    S.forEach((s, i) => {
      if (isWot(s)) { if (!cur) cur = { a: i, b: i }; cur.b = i; gap = 0; }
      else if (cur && ++gap > 1) { segs.push(cur); cur = null; gap = 0; }
    });
    if (cur) segs.push(cur);
    return segs.map(g => S.slice(g.a, g.b + 1)).filter(p => p.length >= 2 && p[p.length - 1].t - p[0].t >= 1 && span(p) >= 500);   // przy wolnym odczycie (np. przez most) przyspieszenie ma tylko kilka próbek
  }

  function analyzeBoost() {
    const S = bt.samples, out = { checks: [], suspects: [], best: null, pulls: 0 };
    const score = { leak: 0, wg: 0, sensor: 0, ic: 0, fuel: 0, restr: 0 };
    if (bt.sensor) { out.checks.push(bt.sensor); if (bt.sensor.lvl === 'warn' || bt.sensor.lvl === 'crit') score.sensor += 3; }
    const wgCodes = engineCodes().list.filter(h => /^P256[345]$|^P00AF$|^P024[3-6]$/.test(h.code));
    if (wgCodes.length) { out.checks.push(V('crit', 'Błąd sterowania wastegate', `${wgCodes.map(h => h.code).join(', ')} w pamięci sterownika. Sterownik sam wykrył, że siłownik wastegate albo jego czujnik położenia nie działa prawidłowo.`)); score.wg += 4; }
    const ect = mx(col(S, 'ect'));
    if (ect != null) out.checks.push(ect >= 70
      ? V('ok', 'Silnik rozgrzany', `Płyn chłodzący ${f(ect, 0)} °C.`)
      : V('warn', 'Silnik niedogrzany', `Płyn chłodzący ${f(ect, 0)} °C. Na zimnym silniku sterownik celowo ogranicza doładowanie, więc wynik nie jest miarodajny. Powtórz test po rozgrzaniu do ponad 80 °C.`));
    const pulls = findPulls(S).sort((a, b) => span(b) - span(a));
    out.pulls = pulls.length;
    const P = pulls[0];
    if (!P) out.checks.push(V('na', 'Brak przyspieszenia', `Nie zarejestrowałem przyspieszenia z pełnym gazem powyżej 1500 obr/min. Największe wciśnięcie pedału w teście: ${f(bt.pedMax, 0)}%${S.some(s => s.pedal != null) ? '' : ' (sterownik nie podaje pozycji pedału, liczę po obciążeniu ≥ 85%)'}. Zrób jedno przyspieszenie z pedałem wciśniętym do końca, np. na trzecim biegu od 2000 obr/min, przez co najmniej 2–3 sekundy.`));
    else {
      out.best = P;
      const pb = col(P, 'boost'), peak = mx(pb), hasT = col(P, 'target').length >= 3;
      const atPeak = P.find(s => s.boost === peak);
      if (peak == null) out.checks.push(V('na', 'Doładowanie', 'Sterownik nie podaje ciśnienia w kolektorze ani doładowania.'));
      else if (hasT) {
        // Pierwsze 1,5 s przyspieszenia to rozkręcanie turbo – wtedy duża odchyłka jest normalna.
        const valid = s => s.target != null && s.boost != null && s.target >= 0.3;
        let spooled = P.filter(s => valid(s) && s.t - P[0].t >= 1.5);
        if (spooled.length < 3) spooled = P.filter(valid);
        const devs = spooled.map(s => s.boost - s.target);
        const low = devs.filter(d => d < -0.2).length / Math.max(1, devs.length);
        const worst = mn(devs), over = mx(devs), peakT = mx(col(P, 'target'));
        const lvl = (low >= 0.4 || worst <= -0.4) ? 'crit' : (low >= 0.15 || worst <= -0.25) ? 'warn' : 'ok';
        out.checks.push(V(lvl, 'Doładowanie względem zadanego',
          `Najwyżej ${f(peak, 2)} bar przy ${f(atPeak && atPeak.rpm, 0)} obr/min, zadane do ${f(peakT, 2)} bar. Największy niedobór ${f(worst, 2)} bar, poniżej zadanego o ponad 0,2 bar przez ${f(low * 100, 0)}% przyspieszenia. ` +
          (lvl === 'ok' ? 'Turbo nadąża za sterownikiem.' : 'Turbo nie daje tyle, ile żąda sterownik. To dokładnie sytuacja, w której zapisuje się P0299.')));
        if (lvl !== 'ok') { score.leak += 2; score.wg += 2; }
        if (over != null && over >= 0.3) { out.checks.push(V('warn', 'Przekroczenie zadanego', `Chwilami ${f(over, 2)} bar ponad zadane. To wskazuje na sterowanie wastegate, a nie na nieszczelność.`)); score.wg += 2; }
        const head = devs.slice(0, Math.ceil(devs.length / 2)), tail = devs.slice(Math.floor(devs.length * 0.7));
        if (head.length >= 2 && tail.length >= 2 && avg(tail) - avg(head) <= -0.15) {
          out.checks.push(V('warn', 'Niedobór rośnie z obrotami', `Na początku przyspieszenia odchyłka ${f(avg(head), 2)} bar, pod koniec ${f(avg(tail), 2)} bar. Im większy przepływ powietrza, tym większa strata. Tak zwykle zachowuje się nieszczelność po stronie ciśnienia albo zatkany filtr lub wydech.`));
          score.leak += 2; score.restr += 1;
        }
      } else {
        const first05 = P.find(s => s.boost != null && s.boost >= 0.5);
        const lvl = peak < 0.4 ? 'crit' : peak < 0.8 ? 'warn' : 'ok';
        out.checks.push(V(lvl, 'Maksymalne doładowanie', `Najwyżej ${f(peak, 2)} bar przy ${f(atPeak && atPeak.rpm, 0)} obr/min${first05 ? `, 0,5 bar osiągnięte przy ${f(first05.rpm, 0)} obr/min` : ''}. Sterownik nie podaje wartości zadanej, więc ocena jest orientacyjna.${lvl === 'ok' ? '' : ' Przy pełnym gazie benzynowe turbo zwykle daje wyraźnie więcej.'}`));
        if (lvl !== 'ok') { score.leak += 1; score.wg += 1; }
        const tb = avg(col(P.slice(Math.floor(P.length * 0.7)), 'boost'));
        if (tb != null && peak - tb >= 0.35) {
          out.checks.push(V('info', 'Spadek na wysokich obrotach', `Doładowanie spada z ${f(peak, 2)} do ${f(tb, 2)} bar pod koniec przyspieszenia. Część spadku jest fabryczna, ale duży spadek może oznaczać nieszczelność lub zatkany filtr.`));
          score.leak += 1; score.restr += 1;
        }
      }
      const wg = P.filter(s => s.wgC != null && s.wgA != null);
      if (wg.length >= 3) {
        const bad = wg.filter(s => Math.abs(s.wgC - s.wgA) > 15).length / wg.length;
        out.checks.push(V(bad >= 0.3 ? 'warn' : 'ok', 'Wastegate', `Pozycja rzeczywista odbiega od zadanej o ponad 15 punktów przez ${f(bad * 100, 0)}% przyspieszenia.${bad >= 0.3 ? ' Siłownik nie nadąża za sterowaniem.' : ''}`));
        if (bad >= 0.3) score.wg += 3;
      }
      const iat = mx(col(P, 'iat')), amb = avg(col(S, 'amb'));
      if (iat != null) {
        const rise = amb != null ? iat - amb : null;
        const lvl = rise == null ? (iat >= 60 ? 'warn' : 'info') : rise >= 55 ? 'crit' : rise >= 35 ? 'warn' : 'ok';
        out.checks.push(V(lvl, 'Temperatura powietrza dolotowego', `Najwyżej ${f(iat, 0)} °C${rise != null ? `, ${f(rise, 0)} °C ponad otoczenie` : ''}. ${lvl === 'warn' || lvl === 'crit' ? 'Gorące powietrze w dolocie, sterownik może zdejmować doładowanie.' : 'Intercooler chłodzi prawidłowo.'}`));
        if (lvl === 'warn' || lvl === 'crit') score.ic += 2;
      }
      const lm = P.filter(s => s.lam != null && s.lamCmd != null);
      if (lm.length >= 3) {
        const d = avg(lm.map(s => s.lam - s.lamCmd));
        const lvl = d >= 0.08 ? 'crit' : d >= 0.04 ? 'warn' : 'ok';
        out.checks.push(V(lvl, 'Mieszanka pod obciążeniem', `Lambda średnio ${sgn(d, 3)} względem zadanej. ${lvl === 'ok' ? 'Paliwa nie brakuje.' : 'Mieszanka uboższa niż zadana, sterownik może ograniczać moc.'}`));
        if (lvl !== 'ok') score.fuel += 2;
      }
      const rail = col(P, 'rail');
      if (rail.length >= 3) {
        const lvl = mn(rail) < 40 ? 'warn' : 'info';
        out.checks.push(V(lvl, 'Ciśnienie paliwa', `Od ${f(mn(rail), 0)} do ${f(mx(rail), 0)} bar w czasie przyspieszenia.${lvl === 'warn' ? ' Spadek poniżej 40 bar przy pełnym gazie wskazuje na problem z zasilaniem.' : ''}`));
        if (lvl === 'warn') score.fuel += 2;
      }
      const tim = col(P, 'timing');
      if (tim.length >= 3) out.checks.push(V('info', 'Kąt zapłonu', `Od ${f(mn(tim), 1)}° do ${f(mx(tim), 1)}° w czasie przyspieszenia. Bardzo niski albo ujemny kąt przy pełnym gazie może oznaczać korekty od spalania stukowego, np. po tankowaniu słabszego paliwa.`));
    }
    const idle = S.filter(s => (s.rpm ?? 0) > 400 && s.rpm < 1100 && pedIdle(s) && s.stft != null && s.ltft != null);
    if (idle.length >= 5) {
      const tot = avg(idle.map(s => s.stft + s.ltft));
      const lvl = tot >= 15 ? 'crit' : (tot >= 8 || tot <= -15) ? 'warn' : 'ok';
      out.checks.push(V(lvl, 'Korekty mieszanki na biegu jałowym', `Łącznie ${sgn(tot, 1)}%. ` + (tot >= 8 ? 'Sterownik dolewa paliwa, bo mieszanka jest uboga. To typowy objaw zasysania lewego powietrza: nieszczelny dolot, odma albo przewody podciśnienia.' : tot <= -15 ? 'Mieszanka bogata: sprawdź zawór odpowietrzenia zbiornika paliwa i wtryskiwacze.' : 'W normie.')));
      if (tot >= 8) score.leak += 2;
    } else out.checks.push(V('na', 'Korekty mieszanki na biegu jałowym', 'Za mało próbek na biegu jałowym. Przed przyspieszeniem postój 20–30 sekund na luzie.'));
    out.suspects = Object.entries(score).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k]) => SUSPECT[k]);
    return out;
  }

  function sensorCheck() {
    const v = api.vals();
    if (v.rpm == null) return 'Brak odczytu obrotów. Poczekaj chwilę i spróbuj ponownie.';
    if (v.rpm > 0) return 'Silnik pracuje. Zgaś go, zostaw włączony zapłon i naciśnij ponownie.';
    const baro = v.baro, map = v.mapX ?? v.map, act = v.boostActAbs;
    if (baro == null || (map == null && act == null)) return 'Sterownik nie podaje ciśnienia atmosferycznego albo ciśnienia w kolektorze.';
    const parts = []; let worst = 0;
    if (map != null) { parts.push(`w kolektorze ${f(map, 0)} kPa`); worst = Math.max(worst, Math.abs(map - baro)); }
    if (act != null) { parts.push(`doładowania ${f(act, 0)} kPa`); worst = Math.max(worst, Math.abs(act - baro)); }
    const lvl = worst <= 3 ? 'ok' : worst <= 6 ? 'warn' : 'crit';
    bt.sensor = V(lvl, 'Czujniki ciśnienia bez pracy silnika', `Atmosferyczne ${f(baro, 0)} kPa, ${parts.join(', ')}. Różnica ${f(worst, 0)} kPa. ${lvl === 'ok' ? 'Czujniki są zgodne.' : 'Czujnik pokazuje inaczej niż atmosferyczne, sprawdź go.'}`);
    return '';
  }

  /* =================== Czujnik MAP: zadane i rzeczywiste =================== */
  const MAP_KEYS = ['rpm', 'pedal', 'pedalRel', 'load', 'baro', 'baroU', 'map', 'mapX', 'mapU', 'mapUsp', 'chgU', 'chgUsp', 'boostActAbs', 'boostCmdAbs', 'maf', 'wgAct', 'wgCmd', 'wgU', 'wgUsp', 'turboU', 'tqU', 'tqUsp', 'speed'];
  const MAP_COLS = [['rpm', 'obroty [obr/min]'], ['pedal', 'pedał [%]'], ['load', 'obciążenie [%]'], ['baro', 'atmosferyczne [kPa]'], ['map', 'kolektor MAP [kPa]'], ['mapSp', 'kolektor zadane [kPa]'], ['chg', 'przed przepustnicą [kPa]'], ['chgSp', 'przed przepustnicą zadane [kPa]'], ['maf', 'MAF [g/s]'], ['wgA', 'wastegate rzecz. [%]'], ['wgC', 'wastegate zadany [%]'], ['turbo', 'obroty turbiny [tys. obr/min]'], ['tq', 'moment rzecz. [Nm]'], ['tqSp', 'moment żądany [Nm]'], ['speed', 'prędkość [km/h]']];
  const mt = { running: false, watch: false, t0: 0, samples: [], result: null, src: '', n: 0 };
  const med = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const sampleMap = v => ({
    t: (performance.now() - mt.t0) / 1000, rpm: v.rpm, pedal: v.pedalRel ?? v.pedal ?? v.tps, load: v.load, baro: v.baroU ?? v.baro,
    map: v.mapU ?? v.mapX ?? v.map, mapSp: v.mapUsp, chg: v.chgU ?? v.boostActAbs, chgSp: v.chgUsp ?? v.boostCmdAbs, maf: v.maf, wgA: v.wgU ?? v.wgAct, wgC: v.wgUsp ?? v.wgCmd, turbo: v.turboU, tq: v.tqU, tqSp: v.tqUsp, speed: v.speed
  });
  const lv3 = (d, a, b) => d <= a ? 'ok' : d <= b ? 'warn' : 'crit';
  function analyzeMap() {
    const S = mt.samples, out = { checks: [], suspect: null };
    if (S.length < 5) return out;
    const hasMap = S.some(s => s.map != null), hasChg = S.some(s => s.chg != null);
    if (!hasMap) { out.checks.push(V('na', 'Czujnik MAP', 'Sterownik nie podaje ciśnienia w kolektorze.')); return out; }
    const pMax = mx(col(S, 'pedal')) ?? 0, wotT = Math.min(80, Math.max(60, pMax * 0.9));
    const pMin = Math.min(...S.map(s => s.pedal).filter(x => x != null)), off = S.filter(s => (s.rpm ?? 1) < 100),
      idle = S.filter(s => (s.rpm ?? 0) >= 600 && (s.rpm ?? 0) <= 1300 && (s.speed ?? 0) < 3 && (s.pedal == null || s.pedal < pMin + 3));
    /* Pełny gaz oceniamy na plateau: od 2800 obr/min i bez pierwszej sekundy, bo na początku przyspieszenia doładowanie
       dopiero narasta i brak do zadanego jest wtedy normalny. */
    const wot = []; { let segT = null, lastT = null;
      for (const s of S) {
        const on = (s.pedal != null ? s.pedal >= wotT : (s.load ?? 0) >= 85) && (s.rpm ?? 0) >= 1500;
        if (!on) { segT = null; continue; }
        if (segT == null || s.t - lastT > 1.5) segT = s.t;
        lastT = s.t;
        if (s.t - segT >= 1 && (s.rpm ?? 0) >= 2800) wot.push(s);
      } }
    let bad = null;   // 'map' | 'chg' | 'baro'
    // A. Zapłon włączony, silnik wyłączony: wszystkie czujniki mają pokazywać atmosferyczne.
    if (off.length >= 3) {
      const b = med(col(off, 'baro')), m = med(col(off, 'map')), c = med(col(off, 'chg'));
      if (b != null && m != null) {
        const dm = m - b, dc = c != null ? c - b : null, worst = Math.max(Math.abs(dm), dc != null ? Math.abs(dc) : 0), lvl = lv3(worst, 3, 6);
        let who = '';
        if (lvl !== 'ok') {
          if (dc == null) who = ' Nie mam drugiego czujnika do porównania, więc nie wiadomo, który jest zły: kolektor czy atmosferyczny.';
          else if (Math.abs(dm) > 3 && Math.abs(dc) <= 3) { bad = 'map'; who = ' Odstaje czujnik w kolektorze (MAP), a ciśnienie przed przepustnicą zgadza się z atmosferycznym.'; }
          else if (Math.abs(dc) > 3 && Math.abs(dm) <= 3) { bad = 'chg'; who = ' Odstaje czujnik ciśnienia przed przepustnicą (doładowania), a MAP zgadza się z atmosferycznym.'; }
          else if (Math.abs(m - c) <= 3) { bad = 'baro'; who = ' Kolektor i czujnik przed przepustnicą zgadzają się ze sobą, a odstaje atmosferyczne. Czujnik atmosferyczny siedzi w sterowniku, więc wniosek jest mniej pewny.'; }
          else who = ' Odstają oba, w różne strony. Sprawdź zasilanie czujników i masę.';
        }
        out.checks.push(V(lvl, 'Silnik wyłączony: czujniki ciśnienia', `Atmosferyczne ${f(b, 1)} kPa, kolektor (MAP) ${f(m, 1)} kPa (${sgn(dm, 1)})${dc != null ? `, przed przepustnicą ${f(c, 1)} kPa (${sgn(dc, 1)})` : ''}. ${lvl === 'ok' ? 'Wszystkie zgodne w granicach 3 kPa.' : 'Różnica powyżej normy.' + who}`));
      }
    } else out.checks.push(V('na', 'Silnik wyłączony', 'Brak próbek z wyłączonym silnikiem i włączonym zapłonem. Ten krok najlepiej wykrywa uszkodzony czujnik: zacznij test przed uruchomieniem silnika.'));
    // B. Bieg jałowy.
    if (idle.length >= 8) {
      const m = med(col(idle, 'map')), c = med(col(idle, 'chg')), b = med(col(idle, 'baro')) ?? med(col(off, 'baro')), mm = col(idle, 'map').sort((x, y) => x - y), spread = mm[Math.floor(mm.length * 0.95)] - mm[Math.floor(mm.length * 0.05)];
      const lvl = m >= 22 && m <= 55 ? 'ok' : m > 70 ? 'crit' : 'warn';
      out.checks.push(V(lvl, 'Bieg jałowy: podciśnienie w kolektorze', `MAP ${f(m, 0)} kPa (zwykle 25–50 kPa abs. na rozgrzanym silniku na biegu jałowym). ${m > 55 ? 'Za wysokie: podciśnienie jest za małe. Możliwe: nieszczelność dolotu za przepustnicą, zawieszony zawór lub czujnik pokazuje za dużo.' : m < 22 ? 'Za niskie jak na bieg jałowy, to podejrzane dla czujnika.' : 'W normie.'} Rozrzut odczytów ${f(spread, 0)} kPa${spread > 10 ? ', czyli czujnik albo dolot pulsuje mocniej niż zwykle.' : '.'}`));
      if (m > 55 && b != null && m >= b - 8) { if (!bad) bad = 'leakIdle'; }
      if (c != null && b != null) out.checks.push(V(lv3(Math.abs(c - b), 6, 12), 'Bieg jałowy: przed przepustnicą', `Ciśnienie przed przepustnicą ${f(c, 0)} kPa przy atmosferycznym ${f(b, 0)} kPa. Na biegu jałowym powinny być prawie równe (różnica do ok. 6 kPa z filtra i rur).`));
    } else out.checks.push(V('na', 'Bieg jałowy', 'Za mało próbek na biegu jałowym (potrzeba kilkunastu sekund po uruchomieniu silnika).'));
    // C. Pełny gaz: zadane i rzeczywiste.
    if (wot.length >= 3) {
      const gap = (key, spKey) => { const d = wot.filter(s => s[key] != null && s[spKey] != null).map(s => s[spKey] - s[key]); return d.length >= 3 ? { avg: avg(d), max: mx(d), n: d.length } : null; };
      const gm = gap('map', 'mapSp'), gc = gap('chg', 'chgSp');
      for (const [g, name] of [[gm, 'kolektor (MAP)'], [gc, 'przed przepustnicą']]) {
        if (!g) continue;
        const lvl = g.avg >= 30 ? 'crit' : g.avg >= 15 ? 'warn' : g.avg <= -20 ? 'warn' : 'ok';
        out.checks.push(V(lvl, `Pełny gaz: ${name}, zadane i rzeczywiste`, `${lvl === 'ok' ? `Odchyłka od zadanego średnio ${f(Math.abs(g.avg), 0)} kPa` : `Średnio ${g.avg >= 0 ? 'brakuje' : 'jest za dużo o'} ${f(Math.abs(g.avg), 0)} kPa względem zadanego`}, najwięcej ${f(g.max, 0)} kPa (${g.n} próbek). ${lvl === 'ok' ? 'Doładowanie wykonuje zadanie.' : g.avg > 0 ? 'Doładowanie nie osiąga wartości zadanej.' : 'Doładowanie przekracza zadane, sterownik może ograniczać moc.'}`));
      }
      if (!gm && !gc) out.checks.push(V('na', 'Zadane i rzeczywiste', 'Sterownik nie podał ciśnień zadanych (potrzebny odczyt Simos18 albo PID 0x70). Naciśnij „Odczytaj ciśnienia”.'));
      if (hasChg) {
        const d = wot.filter(s => s.map != null && s.chg != null).map(s => s.chg - s.map);
        if (d.length >= 3) {
          const a = avg(d), lvl = a > 20 ? 'crit' : a > 12 ? 'warn' : a < -8 ? 'warn' : 'ok';
          let who = '';
          if (lvl !== 'ok') {
            if (a > 12) { bad = bad || 'mapLow'; who = ' Przed przepustnicą jest wyraźnie więcej niż w kolektorze: przepustnica nie otwiera się do końca, jest opór za nią albo czujnik MAP zaniża.'; }
            else { bad = bad || 'mapHigh'; who = ' W kolektorze jest więcej niż przed przepustnicą, co fizycznie nie jest możliwe: czujnik MAP zawyża albo czujnik doładowania zaniża.'; }
          }
          out.checks.push(V(lvl, 'Pełny gaz: kolektor a ciśnienie przed przepustnicą', `Przy pełnym gazie różnica (przed przepustnicą minus kolektor) wynosi średnio ${f(a, 0)} kPa. Przy szeroko otwartej przepustnicy powinna być mała (do ok. 8–10 kPa).${lvl === 'ok' ? ' Czujniki są zgodne.' : who}`));
        }
      }
      // Wniosek: czy to czujnik, czy realny brak doładowania.
      const low = (gm && gm.avg >= 15) || (gc && gc.avg >= 15), agree = out.checks.find(c => /kolektor a ciśnienie przed/.test(c.title));
      if (low && agree && agree.lvl === 'ok') out.suspect = V('info', 'Czujniki wiarygodne, doładowania realnie brakuje', 'Kolektor i ciśnienie przed przepustnicą zgadzają się ze sobą, a oba są poniżej zadanego. To nie wygląda na usterkę czujnika MAP, tylko na prawdziwy brak doładowania (nieszczelność, wastegate, turbosprężarka, zawór przelotowy). Przy P2563 najpierw wastegate.');
      else if (!low && agree && agree.lvl === 'ok') out.suspect = V('ok', 'Czujniki ciśnienia i doładowanie w normie', 'W tym teście kolektor i ciśnienie przed przepustnicą są zgodne i osiągają zadane. Jeśli EPC wraca, szukaj w innych grupach błędów, zwłaszcza w wastegate (P2563).');
    } else out.checks.push(V('na', 'Pełny gaz', 'Nie zarejestrowałem pełnego gazu powyżej 2800 obr/min (pierwszej sekundy nie liczę, bo doładowanie dopiero narasta). Zrób przyspieszenie na niskim biegu, np. na trzecim od 2000 obr/min do 5000.'));
    // D. Wastegate: położenie rzeczywiste a zadane (P2563 to właśnie czujnik położenia siłownika).
    const wgS = S.filter(s => s.wgA != null && s.wgC != null);
    if (wgS.length >= 10) {
      const rA = mx(col(wgS, 'wgA')) - mn(col(wgS, 'wgA')), rC = mx(col(wgS, 'wgC')) - mn(col(wgS, 'wgC'));
      const offW = wgS.filter(s => (s.rpm ?? 1) < 100), wotW = wgS.filter(s => wot.includes(s));
      if (offW.length >= 3) {
        const d = Math.abs(med(col(offW, 'wgA')) - med(col(offW, 'wgC')));
        out.checks.push(V(lv3(d, 3, 8), 'Wastegate przy wyłączonym silniku', `Położenie rzeczywiste ${f(med(col(offW, 'wgA')), 1)}%, zadane ${f(med(col(offW, 'wgC')), 1)}% (różnica ${f(d, 1)} punktu). ${d <= 3 ? 'Siłownik stoi w położeniu spoczynkowym, zgodnie z zadanym.' : 'Przy wyłączonym silniku oba powinny być prawie równe. Rozbieżność wskazuje na luz lub zacięcie cięgna, albo na czujnik położenia siłownika.'}`));
        if (d > 8 && !bad) bad = 'wg';
      }
      if (rC >= 25 && rA < 5) { out.checks.push(V('crit', 'Wastegate się nie rusza', `Zadane zmieniało się o ${f(rC, 0)} punktów procentowych, a rzeczywiste tylko o ${f(rA, 1)}. Siłownik nie podąża za sterowaniem albo czujnik położenia podaje stałą wartość.`)); bad = 'wg'; }
      else if (wotW.length >= 3) {
        const d = wotW.map(s => s.wgC - s.wgA), am = avg(d.map(Math.abs)), lvl = lv3(am, 6, 12);
        out.checks.push(V(lvl, 'Wastegate pod obciążeniem: zadane i rzeczywiste', `Średnia różnica położenia ${f(am, 1)} punktu procentowego, najwięcej ${f(mx(d.map(Math.abs)), 0)} (${wotW.length} próbek). ${lvl === 'ok' ? 'Siłownik podąża za sterowaniem.' : 'Siłownik nie nadąża za zadaniem albo czujnik położenia podaje niewiarygodną wartość. To zgodne z błędem P2563.'}`));
        if (lvl !== 'ok' && !bad) bad = 'wg';
      } else out.checks.push(V('info', 'Wastegate', `Zadane zmieniało się o ${f(rC, 0)} p.p., rzeczywiste o ${f(rA, 0)} p.p. Do oceny pod obciążeniem potrzebne jest przyspieszenie z pełnym gazem.`));
    } else if (S.some(s => s.wgA != null || s.wgC != null)) out.checks.push(V('na', 'Wastegate', 'Za mało próbek położenia wastegate (rzeczywistego i zadanego jednocześnie).'));
    // E. Moment: czy sterownik ogranicza moc (typowy skutek EPC).
    const tqS = wot.filter(s => s.tq != null && s.tqSp != null && s.tqSp > 50);
    if (tqS.length >= 3) {
      const r = avg(tqS.map(s => s.tq / s.tqSp));
      out.checks.push(V(r >= 0.9 ? 'ok' : r >= 0.75 ? 'warn' : 'crit', 'Moment pod obciążeniem', `Rzeczywisty moment to średnio ${f(r * 100, 0)}% żądanego. ${r >= 0.9 ? 'Sterownik nie ogranicza mocy.' : 'Sterownik realizuje wyraźnie mniej, niż żąda kierowca: ograniczenie mocy (tryb awaryjny, EPC) albo brak doładowania.'}`));
    }
    const tb = col(wot, 'turbo');
    if (tb.length >= 3) out.checks.push(V('info', 'Obroty turbosprężarki', `Pod pełnym gazem do ${f(mx(tb), 0)} tys. obr/min (średnio ${f(avg(tb), 0)}). Niskie obroty przy braku doładowania wskazują, że turbina nie dostaje energii (np. wastegate otwarty), wysokie przy braku doładowania szukaj nieszczelności za sprężarką.`));
    // Kody czujników w pamięci.
    const cs = engineCodes().list.filter(h => /^P010[6-9]$|^P023[6-9]$|^P0069$|^P2227$|^P2228$|^P2229$/.test(h.code));
    if (cs.length) out.checks.push(V('crit', 'Błędy czujników ciśnienia w pamięci', `${cs.map(h => h.code).join(', ')}: sterownik sam zgłasza usterkę czujnika ciśnienia w kolektorze albo doładowania.`));
    if (bad === 'map' || bad === 'mapHigh' || bad === 'mapLow') out.suspect = V('warn', 'Podejrzany: czujnik ciśnienia w kolektorze (MAP)', 'Sprawdź wtyczkę i przewód czujnika, nalot olejowy w otworze czujnika, a przy powtarzalnej rozbieżności wymień czujnik. Po wymianie wyczyść błędy i powtórz test.');
    else if (bad === 'chg') out.suspect = V('warn', 'Podejrzany: czujnik ciśnienia doładowania (przed przepustnicą)', 'Sprawdź wtyczkę, przewód i nalot olejowy czujnika w rurze ciśnieniowej, potem wymień czujnik, jeśli rozbieżność się powtarza.');
    else if (bad === 'baro') out.suspect = V('info', 'Podejrzany: pomiar atmosferyczny', 'Czujnik atmosferyczny jest we wnętrzu sterownika. Porównaj z OBD (PID 0x33) i z pogodą dla Twojej wysokości. Różnica kilku kPa wynika z pogody, powyżej 6 kPa to już usterka.');
    else if (bad === 'wg') out.suspect = V('warn', 'Podejrzany: siłownik wastegate lub jego czujnik położenia', 'Rzeczywiste położenie rozjeżdża się z zadanym. Sprawdź luz i płynność cięgna oraz sworznia klapy, wtyczkę i przewody siłownika. Po naprawie wykonaj podstawowe ustawienie siłownika doładowania (VCDS/ODIS, IDE04304).');
    else if (bad === 'leakIdle') out.suspect = V('warn', 'Za małe podciśnienie na biegu jałowym', 'Szukaj nieszczelności dolotu za przepustnicą: przewody podciśnienia, uszczelka kolektora, zawory.');
    return out;
  }
  const mapLines = () => {
    const L = []; if (mt.samples.length >= 5) { const r = analyzeMap(); L.push('', '== Czujnik MAP: zadane i rzeczywiste =='); r.checks.forEach(c => L.push(`[${LV[c.lvl]}] ${c.title}: ${c.text}`)); if (r.suspect) L.push(`[${LV[r.suspect.lvl]}] ${r.suspect.title}: ${r.suspect.text}`); } return L;
  };
  function mapRows() {
    const v = api.vals(), baro = v.baroU ?? v.baro;
    const rows = [
      ['Atmosferyczne', baro, null, null],
      ['Kolektor (MAP)', v.mapU ?? v.mapX ?? v.map, v.mapUsp, 'map'],
      ['Przed przepustnicą (doładowanie)', v.chgU ?? v.boostActAbs, v.chgUsp ?? v.boostCmdAbs, 'chg']
    ];
    const cell = x => x == null ? '—' : `${f(x, 0)} kPa${baro != null ? ` <small>(${sgn((x - baro) / 100, 2)} bar)</small>` : ''}`;
    return `<table class="simtbl"><thead><tr><th>Ciśnienie</th><th>Rzeczywiste</th><th>Zadane</th><th>Różnica</th></tr></thead><tbody>${rows.map(([n, a, sp, k]) => `<tr><td>${esc(n)}</td><td>${cell(a)}</td><td>${cell(sp)}</td><td>${a != null && sp != null ? `<b>${sgn(a - sp, 0)} kPa</b>` : '—'}</td></tr>`).join('')}</tbody></table>`;
  }
  function renderMapLive() { const el = $('#mTable'); if (el) el.innerHTML = mapRows(); }
  function renderMapResult() {
    const card = $('#mResCard'); if (!card) return;
    const ok = mt.samples.length >= 5; card.hidden = !ok; if (!ok) return;
    const r = analyzeMap(); $('#mChecks').innerHTML = checksHtml(r.checks.concat(r.suspect ? [r.suspect] : []));
  }
  function mapStatus() {
    const el = $('#mStatus'); if (!el) return;
    const S = mt.samples, l = S[S.length - 1];
    el.textContent = mt.running ? (l ? `Nagrywam ${f(l.t, 0)} s · ${S.length} próbek${(l.rpm ?? 1) < 100 ? ' · silnik wyłączony' : ''}` : 'Nagrywam…') : mt.src || (l ? `Zakończono po ${f(l.t, 0)} s.` : '');
    const go = $('#mStart'), st = $('#mStop'), w = $('#mWatch'), c = $('#mCsv');
    if (go) { go.hidden = mt.running; st.hidden = !mt.running; go.disabled = !api.elm(); go.textContent = S.length ? 'Nowy test' : 'Start testu'; w.disabled = !api.elm() || mt.running; w.textContent = mt.watch ? 'Zatrzymaj podgląd' : 'Podgląd na żywo'; c.hidden = mt.running || !S.length; }
  }
  async function mapProbe() {
    mt.src = 'Sprawdzam, które ciśnienia podaje sterownik…'; mapStatus();
    const n = api.udsProbe ? await api.udsProbe() : 0;
    const bl = $('#bLive'); if (bl) { bl.innerHTML = minis(BOOST_LIVE); updMinis('bLive'); }
    mt.src = n ? `Sterownik podaje ${n} pomiarów Simos18 (ciśnienia, położenie wastegate, moment, obroty turbiny).` : 'Sterownik nie odpowiada na odczyty Simos18. Użyję ciśnień z OBD (kolektor PID 0x0B, doładowanie PID 0x70), o ile je podaje.';
    mapStatus();
  }
  function startMap() {
    if (!api.elm()) return;
    Object.assign(mt, { running: true, t0: performance.now(), samples: [], result: null, n: 0, src: '' });
    mapProbe().then(() => { mt.t0 = performance.now(); mt.samples = []; api.ensurePolling(); mapStatus(); });
    api.ensurePolling(); renderMapResult(); mapStatus();
  }
  function stopMap() { if (!mt.running) return; mt.running = false; renderMapResult(); mapStatus(); saveMap(); }
  function saveMap() { if (mt.samples.length >= 5) api.saveLog('test-map', 'Czujnik MAP: zadane i rzeczywiste', mapLines().join('\n').trim() + '\n\n== Próbki (CSV) ==\n' + csvOf(mt.samples, MAP_COLS, 'czas [s]', 1)); }

  function renderBoost() {
    const host = $('#boostPanel'); if (!host) return;
    const on = !!api.elm();
    host.innerHTML = `
      <div class="panel-intro"><h2 class="ptitle">Doładowanie i EPC</h2>
        <p class="muted">Wszystkie błędy silnika związane z mocą, czyli te, które zapalają kontrolkę EPC: doładowanie i wastegate (P0299, P2563 i inne), przepustnica i pedał, wypadanie zapłonów, paliwo, rozrząd. Do tego test czujników i przyspieszenia, który wskazuje, od czego zacząć.</p></div>
      <div class="pgrid">
        <div class="card"><h3 class="sect">1. Błędy silnika: EPC, doładowanie, zapłon</h3><div id="bCodes"></div>
          <div class="cardfoot"><button class="btn small" id="bRead" type="button" ${on ? '' : 'disabled'}>Odczytaj kody silnika</button></div></div>
        <div class="card"><h3 class="sect">2. Czujniki bez pracy silnika</h3>
          <p class="small muted">Zgaś silnik i zostaw włączony zapłon. Ciśnienie w kolektorze i doładowania musi wtedy równać się atmosferycznemu.</p>
          <div id="bSensor"></div>
          <div class="cardfoot"><button class="btn small" id="bSensorBtn" type="button" ${on ? '' : 'disabled'}>Sprawdź czujniki</button></div></div>
      </div>
      <div class="card ptest"><h3 class="sect">Czujnik MAP: zadane i rzeczywiste</h3>
        <p class="small muted">Porównuje ciśnienie w kolektorze (czujnik MAP) z ciśnieniem przed przepustnicą, atmosferycznym i wartościami zadanymi przez sterownik. Odróżnia uszkodzony czujnik od prawdziwego braku doładowania.</p>
        <ol class="steps"><li>Zapłon włączony, silnik wyłączony. Naciśnij „Start testu” i zostaw 10 sekund.</li><li>Uruchom silnik i zostaw na biegu jałowym 20 sekund.</li><li>Rozgrzany silnik: w bezpiecznym miejscu i zgodnie z przepisami jedno albo dwa przyspieszenia pełnym gazem od 2000 obr/min.</li><li>Naciśnij „Zakończ”.</li></ol>
        <div id="mTable"></div>
        <p class="tstatus" id="mStatus"></p>
        <div class="actions"><button class="btn primary" id="mStart" type="button">Start testu</button><button class="btn" id="mStop" type="button" hidden>Zakończ</button><button class="btn small" id="mWatch" type="button">Podgląd na żywo</button><button class="btn small ghost" id="mCsv" type="button" hidden>Kopiuj dane CSV</button></div></div>
      <div class="card" id="mResCard" hidden><h3 class="sect">Wynik: czujnik MAP</h3><div id="mChecks"></div></div>
      <div class="card ptest"><h3 class="sect">3. Test przyspieszenia</h3>
        <ol class="steps"><li>Rozgrzej silnik do ponad 80 °C.</li><li>Naciśnij Start i postój 20–30 s na biegu jałowym.</li><li>W bezpiecznym miejscu i zgodnie z przepisami: trzeci bieg, od około 2000 obr/min pełny gaz do około 5500 obr/min.</li><li>Naciśnij Zakończ.</li></ol>
        <div id="bLive">${minis(BOOST_LIVE)}</div>
        <p class="tstatus" id="bStatus"></p>
        <div class="actions"><button class="btn primary" id="bStart" type="button">Start</button><button class="btn" id="bStop" type="button" hidden>Zakończ</button><button class="btn small ghost" id="bCsv" type="button" hidden>Kopiuj dane CSV</button></div></div>
      <div class="card" id="bResCard" hidden><h3 class="sect">4. Wynik</h3>
        <div class="chartbox"><canvas id="bChart" class="chart" aria-label="Doładowanie w funkcji obrotów"></canvas><p class="legend" id="bLegend"></p></div>
        <div id="bChecks"></div></div>
      <div class="card" id="bSusCard" hidden><h3 class="sect">Od czego zacząć</h3><ol class="sus" id="bSus"></ol></div>
      <details class="help"><summary>Pełna lista kontroli przy P0299</summary><ol>
        <li><b>Szczelność dolotu.</b> Przewody intercoolera, opaski, intercooler, przepustnica. Najlepiej test dymny.</li>
        <li><b>Zawór przelotowy (upustowy).</b> Pęknięta membrana wypuszcza doładowanie.</li>
        <li><b>Wastegate.</b> Luz na cięgnie lub sworzniu klapy, płynność ruchu siłownika.</li>
        <li><b>Czujnik ciśnienia doładowania.</b> Porównanie z atmosferycznym przy wyłączonym silniku, nalot olejowy.</li>
        <li><b>Filtr powietrza i dolot przed turbo.</b></li>
        <li><b>Turbosprężarka.</b> Luzy wirnika, ślady oleju w dolocie.</li>
        <li><b>Wydech.</b> Zatkany katalizator zdarza się rzadko, ale daje spadek doładowania na wysokich obrotach.</li></ol></details>`;
    $('#bRead').onclick = e => readCodes(e.currentTarget, ['01']);
    $('#bSensorBtn').onclick = () => { bt.sensorMsg = sensorCheck(); renderSensor(); if (!bt.running && bt.samples.length) { bt.result = analyzeBoost(); renderBoostResult(); } };
    $('#mStart').onclick = manualStart(mt, startMap); $('#mStop').onclick = manualStop(mt, stopMap);
    $('#mWatch').onclick = async () => { mt.watch = !mt.watch; if (mt.watch) { await mapProbe(); api.ensurePolling(); } mapStatus(); renderMapLive(); };
    $('#mCsv').onclick = e => api.copyText(csvOf(mt.samples, MAP_COLS, 'czas [s]', 1), e.currentTarget);
    renderMapLive(); renderMapResult(); mapStatus();
    $('#bStart').onclick = manualStart(bt, startBoost);
    $('#bStop').onclick = manualStop(bt, stopBoost);
    $('#bCsv').onclick = e => api.copyText(csvOf(bt.samples, BOOST_COLS, 'czas [s]', 1), e.currentTarget);
    renderBoostCodes(); renderSensor(); syncBoost(); updMinis('bLive'); renderBoostResult();
  }
  function renderSensor() {
    const el = $('#bSensor'); if (!el) return;
    el.innerHTML = bt.sensorMsg ? `<p class="small">${esc(bt.sensorMsg)}</p>` : bt.sensor ? checksHtml([bt.sensor]) : '';
  }
  /* Grupy kodów silnika pokazywane w tej zakładce. EPC u VAG zapala się przy usterkach wpływających na moc:
     doładowanie, przepustnica i pedał, włącznik świateł stopu, sterownik, a często też przy wypadaniu zapłonów. */
  const rng = (a, b, pre = 'P') => { const o = []; for (let i = a; i <= b; i++) o.push(pre + i.toString(16).toUpperCase().padStart(4, '0')); return o; };
  const ENG_GROUPS = [
    ['boost', 'Doładowanie i wastegate', new Set(['P0299', 'P0234', 'P00AF', 'P2261', 'P2279', ...rng(0x0236, 0x0238), ...rng(0x0243, 0x0246), ...rng(0x2563, 0x2565), ...rng(0x0045, 0x0048), ...rng(0x0033, 0x0035), ...rng(0x0106, 0x0108), ...rng(0x0101, 0x0103)])],
    ['epc', 'Przepustnica, pedał gazu, hamulec, sterownik (EPC)', new Set(['P0571', 'P0504', 'P0606', 'P0638', 'P0562', 'P0563', ...rng(0x0120, 0x0123), ...rng(0x0220, 0x0223), ...rng(0x2100, 0x2119), ...rng(0x2122, 0x2138), ...rng(0x0600, 0x060F)])],
    ['mis', 'Wypadanie zapłonów i zapłon', new Set([...rng(0x0300, 0x0312), ...rng(0x0350, 0x0358), ...rng(0x0261, 0x0272), ...rng(0x0325, 0x0334)])],
    ['fuel', 'Paliwo i mieszanka', new Set(['P0087', 'P0088', 'P2293', 'P0171', 'P0172', 'P2187', 'P2188', ...rng(0x0191, 0x0193)])],
    ['cam', 'Rozrząd i czujniki obrotów', new Set(['P0011', 'P0014', 'P0335', 'P0340', 'P0341', ...rng(0x0016, 0x0019)])]
  ];
  const groupOf = code => (ENG_GROUPS.find(g => g[2].has(code)) || ['other', 'Inne błędy silnika'])[0];
  const groupName = k => (ENG_GROUPS.find(g => g[0] === k) || [k, 'Inne błędy silnika'])[1];
  /* Wszystkie kody silnika: z OBD (tryby 03/07/0A) i z modułu silnika (UDS). Kod z modułu VAG ma kod P tylko wtedy,
     gdy aplikacja zna bazę sterownika; inaczej sam numer VAG, który też tu trafia. */
  function engineCodes() {
    const rep = api.report(), ENG = mapAddr('01'), out = [], seen = new Map();
    const add = (code, src, flags, d) => {
      const k = code; if (seen.has(k)) { const h = seen.get(k); h.src += ', ' + src; if (d && !h.d) h.d = d; return; }
      const h = { code, src, flags: flags || [], d, group: groupOf(code) }; seen.set(k, h); out.push(h);
    };
    if (rep.obd) for (const [k, n] of [['stored', 'OBD zapisany'], ['pending', 'OBD oczekujący'], ['permanent', 'OBD stały']]) (rep.obd[k] || []).forEach(d => add(d.code, n));
    rep.modules.filter(m => m.addr === ENG).forEach(m => m.dtcs.forEach(d => add(d.code, 'moduł ' + m.addr, d.flags.filter(x => !x.startsWith('status')), d)));
    const read = !!rep.obd || rep.modules.some(m => m.addr === ENG);
    return { list: out, read };
  }
  function engCodeHtml(h) {
    const d = h.d, desc = api.DTC_DESC[h.code] || (d && d.desc) || '';
    const ctx = d && d.vagNo != null && d.details && !d.details.err ? vagContextText(vagFaultContext(d.details.ext, api.report().stamp)) : '';
    const inf = dtcInfo(h.code, false);
    return `<div class="codeline"><code>${esc(d ? d.full : h.code)}</code><span>${esc(desc || (d && d.vagOnly ? 'numer VAG, opis tylko w bazie producenta' : 'kod producenta, brak opisu'))}</span>
      <span class="flag">${esc(h.src)}${h.flags.length ? ' · ' + esc(h.flags.join(', ')) : ''}</span>
      ${ctx ? `<span class="small muted">${esc(ctx)}</span>` : ''}
      ${inf && inf.causes.length ? `<details class="cz"><summary>Możliwe przyczyny</summary>${inf.warn ? `<p class="warnp">${esc(inf.warn)}</p>` : ''}<ul>${inf.causes.map(c => `<li>${esc(c)}</li>`).join('')}</ul><p class="muted small">Źródła: ${inf.src.map(x => `<a href="${esc(x[1])}" target="_blank" rel="noopener">${esc(x[0])}</a>`).join(', ')}</p></details>` : ''}</div>`;
  }
  function renderBoostCodes() {
    const el = $('#bCodes'); if (!el) return;
    const { list, read } = engineCodes();
    if (!read) { el.innerHTML = '<p class="small muted">Kody nie zostały jeszcze odczytane.</p>'; return; }
    const active = h => h.flags.includes('aktywny') || h.flags.includes('kontrolka');
    const key = list.filter(h => h.group !== 'other'), act = key.filter(active);
    const p0299 = list.filter(h => h.code === 'P0299');
    let head;
    if (act.length) head = `<p class="codehead crit">Aktywny błąd związany z mocą silnika (EPC): ${esc(act.map(h => `${h.code} – ${groupName(h.group).toLowerCase()}`).join('; '))}.</p>`;
    else if (key.length) head = `<p class="codehead warn">Zapisane błędy związane z mocą silnika: ${esc(key.map(h => h.code).join(', '))}. Teraz nie są aktywne.</p>`;
    else if (list.length) head = '<p class="codehead ok">Brak błędów doładowania, przepustnicy, pedału ani wypadania zapłonów. Inne błędy silnika są niżej.</p>';
    else head = '<p class="codehead ok">Silnik nie ma zapisanych błędów. Jeśli kontrolka EPC się zapala, a błąd znika, test przyspieszenia i tak pokaże przyczynę.</p>';
    if (!p0299.length && key.some(h => h.group === 'boost')) head += '<p class="small muted">P0299 nie jest zapisany, ale jest inny błąd układu doładowania (wyżej). Test przyspieszenia poniżej dotyczy też jego.</p>';
    const tips = [];
    if (list.some(h => /^P256[345]$|^P00AF$|^P024[3-6]$/.test(h.code))) tips.push('Błąd siłownika lub czujnika wastegate: w Narzędziach → „Pomiary silnika Simos18” porównaj wastegate rzeczywisty z zadanym (na postoju i przy przyspieszeniu). Po naprawie siłownika potrzebne jest podstawowe ustawienie w VCDS/ODIS.');
    if (list.some(h => h.group === 'mis')) tips.push('Wypadanie zapłonów: w Narzędziach → „Testy sterownika” są liczniki wypadania na każdy cylinder. Zamień cewki między cylindrami i sprawdź, czy błąd idzie za cewką.');
    if (list.some(h => h.group === 'epc')) tips.push('Przepustnica, pedał lub włącznik stopu: sprawdź wtyczki, a przy błędach przepustnicy wyczyść ją i zrób adaptację przepustnicy w VCDS/ODIS.');
    const groups = ['boost', 'epc', 'mis', 'fuel', 'cam', 'other'].map(g => [g, list.filter(h => h.group === g)]).filter(x => x[1].length);
    el.innerHTML = head + groups.map(([g, hs]) => `<h4 class="sub">${esc(groupName(g))}</h4><div class="codes">${hs.map(engCodeHtml).join('')}</div>`).join('')
      + (tips.length ? `<ul class="small tips">${tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '')
      + freezeHtml('P0299');
  }
  function syncBoost() {
    const s = $('#bStart'), p = $('#bStop'), c = $('#bCsv'); if (!s) return;
    s.hidden = bt.running; p.hidden = !bt.running; c.hidden = bt.running || !bt.samples.length;
    s.textContent = bt.samples.length ? 'Nowy test' : 'Start'; s.disabled = !api.elm();
    const st = $('#bStatus');
    if (!bt.running) st.textContent = bt.samples.length ? `Test zakończony: ${bt.samples.length} próbek, przyspieszeń: ${bt.pulls}.` : '';
  }
  function boostStatus() {
    const st = $('#bStatus'), s = bt.samples[bt.samples.length - 1]; if (!st || !s) return;
    const idleN = bt.samples.filter(x => (x.rpm ?? 0) > 400 && x.rpm < 1100 && pedIdle(x)).length;
    st.textContent = isWot(s)
      ? `Nagrywam przyspieszenie: ${f(s.rpm, 0)} obr/min, ${f(s.boost, 2)} bar`
      : `Nagrywam. Próbki na biegu jałowym: ${idleN}, przyspieszenia: ${bt.pulls}. ${bt.pulls ? 'Możesz zakończyć test albo powtórzyć przyspieszenie.' : `Czekam na pełny gaz (pedał teraz ${f(s.pedal, 0)}%, próg ${f(wotThr(), 0)}%).`}`;
  }
  function startBoost() {
    if (!api.elm()) return;
    Object.assign(bt, { running: true, t0: performance.now(), samples: [], result: null, pulls: 0, pedMax: 0, pedMin: null });
    api.ensurePolling(); syncBoost(); renderBoostResult();
    $('#bStatus').textContent = 'Nagrywam…';
  }
  function stopBoost() {
    if (!bt.running) return;
    bt.running = false; bt.result = analyzeBoost(); syncBoost(); renderBoostResult(); saveBoost();
  }
  function renderBoostResult() {
    const card = $('#bResCard'), sus = $('#bSusCard'); if (!card) return;
    const r = bt.running ? (bt.pulls ? analyzeBoost() : null) : bt.result;
    card.hidden = !r; sus.hidden = !r;
    if (!r) return;
    $('#bChecks').innerHTML = checksHtml(r.checks);
    $('#bSus').innerHTML = r.suspects.length ? stepsHtml(r.suspects)
      : r.best ? stepsHtml([['W tym przejeździe doładowanie było w normie.', 'Błąd może pojawiać się sporadycznie, np. w upale, na wysokich obrotach albo na wyższym biegu. Powtórz test w warunkach z zamrożonej ramki.']])
      : stepsHtml([['Najpierw test przyspieszenia.', 'Bez zarejestrowanego przyspieszenia nie da się wskazać przyczyny.']]);
    drawBoost(r.best);
  }
  function drawBoost(P) {
    const cv = $('#bChart'); if (!cv || $('#tab-boost').hidden) return;
    const tk = api.tokens(), S = P || [];
    const act = S.filter(s => s.rpm != null && s.boost != null).map(s => ({ x: s.rpm, y: s.boost }));
    const tgt = S.filter(s => s.rpm != null && s.target != null).map(s => ({ x: s.rpm, y: s.target }));
    drawChart(cv, [{ pts: tgt, color: tk.ink, dash: true }, { pts: act, color: tk.accent }], { refs: [{ y: 0, label: '0 bar' }], empty: 'Brak zarejestrowanego przyspieszenia' });
    $('#bLegend').innerHTML = `<span><i class="sw"></i>doładowanie rzeczywiste</span>${tgt.length ? '<span><i class="sw dash"></i>zadane</span>' : ''}<span>oś pozioma: obr/min, pionowa: bar</span>`;
  }

  /* =================== Ogrzewanie =================== */
  const HEAT_KEYS = ['coolant', 'coolant2', 'oil', 'ambient', 'iat', 'rpm', 'speed', 'runTime', 'load'];
  const HEAT_LIVE = ['coolant', 'coolant2', 'oil', 'ambient', 'speed', 'runTime'];
  const HEAT_CODES = ['P0128', 'P0125', 'P0116', 'P0117', 'P0118', 'P0119', 'P2181', 'P0597', 'P0598', 'P0599', 'P0480', 'P0481', 'P0217'];
  const HEAT_COLS = [['ect', 'płyn [°C]'], ['ect2', 'płyn za chłodnicą [°C]'], ['oil', 'olej [°C]'], ['amb', 'otoczenie [°C]'], ['iat', 'dolot [°C]'], ['rpm', 'obroty [obr/min]'], ['speed', 'prędkość [km/h]'], ['run', 'od uruchomienia [s]']];
  const SYMPTOMS = [['cold', 'Zimny nawiew'], ['slow', 'Długo się grzeje'], ['idle', 'Zimno na postoju'], ['drive', 'Zimno w jeździe'], ['side', 'Grzeje jedna strona']];
  const SYM_TIP = {
    cold: 'Zimne powietrze przy rozgrzanym silniku wskazuje na nagrzewnicę albo klapę temperatury. Zimne powietrze i zimny silnik wskazują na termostat.',
    slow: 'Najczęściej termostat albo niski poziom płynu. Test pokaże, czy silnik dochodzi do temperatury roboczej.',
    idle: 'Grzeje w jeździe, a na postoju nie: typowe dla powietrza w układzie albo niskiego poziomu płynu. Na wolnych obrotach pompa słabiej przepycha płyn przez nagrzewnicę.',
    drive: 'Grzeje na postoju, a w jeździe nie: typowe dla stale otwartego termostatu, bo pęd powietrza wychładza silnik. Zwróć uwagę, czy w teście temperatura spada w jeździe.',
    side: 'Jedna strona grzeje, druga nie: zwykle silniczek klapy albo powietrze w nagrzewnicy przy niskim poziomie płynu.'
  };
  const CONCL = {
    heater: { title: 'Silnik się nagrzewa, więc przyczyny szukamy po stronie nagrzewnicy i nawiewu.', steps: [
      ['Poziom płynu chłodzącego', 'Sprawdź na zimnym silniku, między MIN a MAX. Ubytek oznacza wyciek. W tym silniku częstym miejscem wycieku jest obudowa pompy wody z termostatem.'],
      ['Węże nagrzewnicy', 'Na rozgrzanym silniku ostrożnie dotknij obu węży przy ścianie grodziowej. Oba gorące: płyn płynie, winna jest klapa temperatury albo Climatronic. Jeden wyraźnie chłodniejszy: zatkana nagrzewnica, powietrze w układzie albo słaby przepływ.'],
      ['Powietrze w układzie', 'Bulgotanie za deską albo grzanie zależne od obrotów wskazuje na zapowietrzenie. Układ trzeba odpowietrzyć.'],
      ['Klapa temperatury', 'Przy zmianie z LO na HI powinno być słychać pracę silniczka za deską. Kody Climatronic dotyczące silniczków klap to potwierdzą. Po wymianie potrzebne jest ustawienie podstawowe klap, którego aplikacja jeszcze nie robi.']] },
    engine: { title: 'Silnik nie trzyma temperatury roboczej, więc nagrzewnica nie ma czym grzać.', steps: [
      ['Termostat', 'Najczęstsza przyczyna: termostat stale otwarty, często razem z kodem P0128. W tym silniku termostat siedzi w module pompy wody.'],
      ['Wentylator chłodnicy', 'Jeśli kręci się stale, także na zimnym silniku, wychładza go. Sprawdź jego sterowanie.'],
      ['Czujnik temperatury płynu', 'Po dłuższej jeździe porównaj temperaturę płynu z temperaturą oleju. Duża rozbieżność wskazuje na czujnik.'],
      ['Poziom płynu', 'Przy niskim poziomie czujnik może pokazywać zaniżoną temperaturę.']] },
    none: { title: 'Za mało danych na wniosek.', steps: [['Test nagrzewania', 'Uruchom test na zimnym silniku i jedź 15–20 minut, potem naciśnij Zakończ.']] }
  };
  const ht = { running: false, t0: 0, samples: [], n: 0, sym: api.store.get('heatSym', 'cold') };
  if (!SYM_TIP[ht.sym]) ht.sym = 'cold';

  /* Drugi czujnik płynu (za chłodnicą): wybrany numer, a przed wyborem lista kandydatów zapisywana obok. */
  const c2 = api.c2 || { sel: null, cands: [], vals: {}, probe: false, choose() {}, setCands() {} };
  const c2hex = d => '0x' + d.toString(16).toUpperCase().padStart(4, '0');
  const heatCols = () => HEAT_COLS.concat(c2.cands.map(d => ['c' + d, 'DID ' + c2hex(d) + ' [°C]']));
  const sampleHeat = v => {
    const o = { t: (performance.now() - ht.t0) / 60000, ect: v.coolant, ect2: v.coolant2, oil: v.oil, amb: v.ambient, iat: v.iat, rpm: v.rpm, speed: v.speed, run: v.runTime };
    if (c2.probe) for (const d of c2.cands) if (c2.vals[d] != null) o['c' + d] = c2.vals[d];
    return o;
  };
  const corr = (a, b) => {
    const n = a.length; if (n < 3) return null;
    const ma = avg(a), mb = avg(b); let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null;
  };
  /* Ocena kandydatów: stały odczyt to nie temperatura, kopia płynu to ten sam czujnik co w OBD, a czujnik za chłodnicą
     śledzi płyn, ale od niego odstaje (przy zimnym silniku i otwarciu obiegu). */
  function rankC2(S) {
    const res = [];
    for (const d of c2.cands) {
      const k = 'c' + d, P = S.filter(x => x[k] != null && x.ect != null);
      if (P.length < 10) continue;
      const b = P.map(x => x[k]), rng = mx(b) - mn(b), r = corr(P.map(x => x.ect), b), dabs = avg(P.map(x => Math.abs(x[k] - x.ect)));
      const kind = rng < 5 ? 'stały' : (r != null && r >= 0.98 && dabs < 1.5) ? 'kopia' : (r != null && r >= 0.6 && rng >= 15) ? 'czujnik' : 'inny';
      res.push({ did: d, key: k, r, rng, dabs, dm: avg(P.map(x => x[k] - x.ect)), kind, n: P.length });
    }
    return res.sort((x, y) => (y.kind === 'czujnik') - (x.kind === 'czujnik') || (y.r ?? -1) - (x.r ?? -1));
  }
  /* Kolumna z danymi czujnika 2: wybrany czujnik albo najlepszy kandydat z tego testu. */
  function c2Series(S) {
    if (S.some(x => x.ect2 != null)) return { key: 'ect2', label: 'płyn za chłodnicą', ranked: null };
    const ranked = rankC2(S), best = ranked.find(x => x.kind === 'czujnik');
    return best ? { key: best.key, label: 'kandydat ' + c2hex(best.did), best, ranked } : { key: null, ranked };
  }
  function c2Checks(S, out, maxE) {
    const ser = c2Series(S), { ranked } = ser;
    if (ranked && ranked.length) {
      const fmt = x => `${c2hex(x.did)}: ${x.kind}${x.r != null ? `, r = ${f(x.r, 2)}` : ''}, zakres ${f(x.rng, 0)} °C`;
      out.checks.push(V('info', 'Szukanie czujnika 2 płynu', `Sprawdzone numery: ${ranked.map(fmt).join('; ')}. ${ser.best ? `Najlepiej pasuje ${c2hex(ser.best.did)}: zmienia się razem z płynem (r = ${f(ser.best.r, 2)}) i średnio jest o ${f(Math.abs(ser.best.dm), 0)} °C ${ser.best.dm < 0 ? 'chłodniejszy' : 'cieplejszy'}. To wniosek z danych, nie z dokumentacji, więc traktuj go jako prawdopodobny, nie pewny.` : 'Żaden nie zachowuje się jak czujnik za chłodnicą (zmienia się razem z płynem, ale się od niego różni). Powtórz test od zimnego silnika albo skorzystaj z VCDS (IDE00192).'}`));
    }
    if (!ser.key) return;
    const P = S.filter(x => x[ser.key] != null && x.ect != null); if (P.length < 10) return;
    const c0 = P[0][ser.key], e0 = P[0].ect;
    if (e0 > 60) { out.checks.push(V('info', 'Czujnik 2 płynu', `Test zaczął się na ciepłym silniku (płyn ${f(e0, 0)} °C), więc nie da się ocenić, kiedy otworzył się obieg radiatora. Powtórz od zimnego silnika.`)); return; }
    const open = P.find(x => x.t > P[0].t && x[ser.key] >= c0 + 8);
    if (open) {
      const warm = open.ect >= 70;
      out.checks.push(V(warm ? 'ok' : 'warn', 'Obieg radiatora (czujnik 2)', `Za chłodnicą temperatura wzrosła o 8 °C po ${fmtMin(open.t)}, gdy płyn silnika miał ${f(open.ect, 0)} °C. ${warm ? 'Radiator włączył się dopiero po nagrzaniu silnika, jak powinien.' : 'To za wcześnie: obieg radiatora otworzył się przy zimnym silniku. Termostat albo zawór modułu zarządzania temperaturą otwiera się za wcześnie lub jest stale otwarty. Wniosek jest pewny tylko wtedy, gdy ten czujnik naprawdę stoi za chłodnicą.'}`));
    } else if (maxE >= 85) out.checks.push(V('info', 'Obieg radiatora (czujnik 2)', `Czujnik 2 nie wzrósł o 8 °C przez cały test, mimo że płyn doszedł do ${f(maxE, 0)} °C. Obieg radiatora prawie się nie otworzył albo to nie jest czujnik za chłodnicą.`));
    const dr = P.filter(x => x.ect >= 85 && (x.speed ?? 0) >= 50);
    if (dr.length >= 5) out.checks.push(V('info', 'Różnica płynu i czujnika 2', `Przy rozgrzanym silniku i prędkości od 50 km/h płyn jest średnio o ${f(avg(dr.map(x => x.ect - x[ser.key])), 0)} °C cieplejszy niż czujnik 2.`));
  }

  function analyzeHeat() {
    const S = ht.samples, out = { checks: [], concl: null, branch: null };
    if (S.length < 3) return out;
    const dur = S[S.length - 1].t, maxE = mx(col(S, 'ect'));
    if (maxE == null) { out.checks.push(V('na', 'Temperatura płynu', 'Sterownik nie podaje temperatury płynu chłodzącego.')); return out; }
    const first = S.find(s => s.ect != null), amb = avg(col(S, 'amb'));
    if (first.run != null && first.run <= 180 && amb != null) {
      const d = first.ect - amb;
      if (d < -5) out.checks.push(V('warn', 'Czujnik temperatury płynu', `Na starcie płyn ${f(first.ect, 0)} °C, otoczenie ${f(amb, 0)} °C. Czujnik płynu pokazuje mniej niż otoczenie, to podejrzane.`));
      else if (d <= 8) out.checks.push(V('ok', 'Zimny start', `Na starcie płyn ${f(first.ect, 0)} °C, otoczenie ${f(amb, 0)} °C. Czujnik wygląda wiarygodnie.`));
      else out.checks.push(V('info', 'Silnik nie był wystudzony', `Na starcie płyn ${f(first.ect, 0)} °C przy otoczeniu ${f(amb, 0)} °C. Tempo nagrzewania najlepiej mierzyć po kilku godzinach postoju.`));
    }
    const reach = th => { const s = S.find(x => x.ect != null && x.ect >= th); return s ? s.t : null; };
    const t80 = reach(80), driving = (avg(col(S, 'speed')) ?? 0) >= 20;
    /* Tempo liczymy tylko na pierwszym narastaniu (do pierwszego osiągnięcia 80 °C), a nie z próbek po późniejszym spadku. */
    const rise = S.filter(s => s.ect != null && s.ect >= 40 && (t80 == null || s.t <= t80));
    const rate = rise.length >= 2 && rise[rise.length - 1].t - rise[0].t > 0.5 && rise[rise.length - 1].ect > rise[0].ect ? (rise[rise.length - 1].ect - rise[0].ect) / (rise[rise.length - 1].t - rise[0].t) : null;
    const rateFrom = rise.length ? rise[0].ect : null, rateTo = rise.length ? rise[rise.length - 1].ect : null;
    if (maxE >= 85) { out.branch = 'heater'; out.checks.push(V('ok', 'Temperatura robocza', `Silnik doszedł do ${f(maxE, 0)} °C${t80 != null && first.ect < 75 ? `, 80 °C po ${fmtMin(t80)} od startu testu` : ''}. Termostat się zamyka.`)); }
    else if (dur >= 15) {
      out.branch = driving ? 'engine' : null;
      out.checks.push(V(driving ? 'crit' : 'warn', 'Silnik nie osiąga temperatury', `Po ${fmtMin(dur)} ${driving ? 'jazdy' : 'pracy na postoju'} najwyżej ${f(maxE, 0)} °C. Rozgrzany silnik ma zwykle 85–105 °C. ${driving ? 'Termostat najpewniej jest stale otwarty.' : 'Na postoju, zwłaszcza zimą, silnik grzeje się bardzo wolno. Powtórz test w jeździe.'}`));
    } else out.checks.push(V('info', 'Test w toku', `Minęło ${fmtMin(dur)}, najwyżej ${f(maxE, 0)} °C. Do oceny potrzeba około 15 minut jazdy albo osiągnięcia 85 °C.`));
    if (rate != null) out.checks.push(V('info', 'Tempo nagrzewania', `${f(rate, 1)} °C/min (od ${f(rateFrom, 0)} do ${f(rateTo, 0)} °C), ${driving ? 'w jeździe' : 'głównie na postoju'}.`));
    if (maxE >= 85) {
      const iMax = S.findIndex(s => s.ect === maxE);
      const low = mn(col(S.slice(iMax).filter(s => (s.speed ?? 0) >= 40), 'ect'));
      if (low != null && maxE - low >= 10) {
        /* Spadek po pierwszym otwarciu termostatu (zimny płyn z chłodnicy) bywa normalny. Liczy się, czy temperatura wraca. */
        const iLow = S.findIndex((s, i) => i > iMax && s.ect === low);
        const back = mx(col(S.slice(iLow), 'ect'));
        if (back != null && back >= maxE - 5) {
          out.checks.push(V('info', 'Chwilowy spadek temperatury', `Z ${f(maxE, 0)} do ${f(low, 0)} °C, potem z powrotem ${f(back, 0)} °C. Tak zwykle wygląda pierwsze otwarcie termostatu albo zaworu modułu zarządzania temperaturą: zimny płyn z chłodnicy miesza się z gorącym. Jeśli zdarza się raz na początku jazdy, jest normalny.`));
        } else if (dur < 15) {
          out.checks.push(V('warn', 'Temperatura spada w jeździe', `Z ${f(maxE, 0)} do ${f(low, 0)} °C przy prędkości powyżej 40 km/h i do końca testu nie wróciła. Test trwał ${fmtMin(dur)}, za krótko, żeby to ocenić: przy pierwszym otwarciu termostatu taki spadek bywa normalny. Jedź dalej, łącznie co najmniej 15 minut.`));
        } else {
          out.branch = 'engine';
          out.checks.push(V('warn', 'Temperatura spada w jeździe', `Z ${f(maxE, 0)} do ${f(low, 0)} °C przy prędkości powyżej 40 km/h i przez resztę testu (${fmtMin(dur)}) nie wróciła. Termostat nie trzyma temperatury albo moduł zarządzania temperaturą źle steruje przepływem.`));
        }
      }
    }
    if (maxE >= 110) out.checks.push(V('crit', 'Przegrzewanie', `Płyn doszedł do ${f(maxE, 0)} °C. Sprawdź poziom płynu i wentylator chłodnicy, zanim pojedziesz dalej.`));
    const O = col(S, 'oil');
    if (O.length) out.checks.push(V('info', 'Olej', `Od ${f(mn(O), 0)} do ${f(mx(O), 0)} °C. Olej nagrzewa się wolniej niż płyn. Po dłuższej jeździe obie temperatury powinny być zbliżone.`));
    c2Checks(S, out, maxE);
    out.concl = CONCL[out.branch || 'none'];
    return out;
  }

  function renderHeat() {
    const host = $('#heatPanel'); if (!host) return;
    const on = !!api.elm();
    host.innerHTML = `
      <div class="panel-intro"><h2 class="ptitle">Ogrzewanie</h2>
        <p class="muted">Najpierw sprawdzamy, czy silnik dochodzi do temperatury roboczej. Jeśli tak, przyczyna leży po stronie nagrzewnicy i nawiewu. Jeśli nie, winny jest układ chłodzenia silnika, najczęściej termostat.</p></div>
      <div class="card"><h3 class="sect">Objaw</h3>
        <div class="seg" id="hSym">${SYMPTOMS.map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${k === ht.sym}">${l}</button>`).join('')}</div>
        <p class="small" id="hTip">${esc(SYM_TIP[ht.sym])}</p></div>
      <div class="card" id="hC2Card"><h3 class="sect">Drugi czujnik temperatury płynu</h3>
        <p class="small muted">Silnik ma dwa czujniki płynu: na wyjściu z silnika (ten widzisz wszędzie) i drugi, za chłodnicą. Drugi pokazuje, kiedy otwiera się obieg radiatora, więc najlepiej ocenia termostat. Jego numeru nie ma w otwartych bazach, dlatego aplikacja szuka go sama. Zrób to raz, przy uruchomionym silniku (ok. 1–3 minuty). Potem test nagrzewania sprawdzi, który z kandydatów zachowuje się jak czujnik za chłodnicą.</p>
        <p class="small" id="hC2St"></p>
        <div class="actions"><button class="btn small" id="hC2Go" type="button">Znajdź czujnik 2</button><button class="btn small ghost" id="hC2Clr" type="button" hidden>Zapomnij wynik</button></div></div>
      <div class="card" id="kCard"><h3 class="sect">Climatronic: temperatura nawiewu i klapa</h3>
        <p class="small muted">Numerów odczytów tego modułu nie ma w otwartych źródłach, więc aplikacja dobiera je z danych. Krok 1 zbiera wszystko, co Climatronic podaje (najlepiej przy pracującym silniku, do ok. 10 minut; przerwanie zachowuje to, co już znaleziono). Krok 2 nagrywa te odczyty, gdy zmieniasz pokrętło temperatury: to, co skacze razem z pokrętłem, to klapa albo temperatura zadana, a to, co narasta powoli, to temperatura nawiewu. Krok 2 rób na rozgrzanym silniku (płyn od 80 °C), z nawiewem na średnim biegu, bez AUTO, bez A/C i bez obiegu wewnętrznego.</p>
        <p class="small" id="kSt"></p>
        <p class="kphase" id="kPhase" hidden></p>
        <div class="actions"><button class="btn small" id="kScan" type="button">Krok 1: szukaj odczytów</button><button class="btn small" id="kTest" type="button">Krok 2: test pokrętłem (3 min)</button><button class="btn small ghost" id="kStop" type="button" hidden>Przerwij</button></div>
        <div id="kRes"></div></div>
      <div class="card ptest"><h3 class="sect">Test nagrzewania</h3>
        <ol class="steps"><li>Najlepiej po kilku godzinach postoju, na zimnym silniku.</li><li>Połącz się, naciśnij Start i uruchom silnik.</li><li>Jedź normalnie 15–20 minut. Ekran telefonu musi zostać włączony, aplikacja sama go podtrzymuje.</li><li>Naciśnij Zakończ.</li></ol>
        <div id="hLive">${minis(HEAT_LIVE)}</div>
        <p class="tstatus" id="hStatus"></p>
        <div class="actions"><button class="btn primary" id="hStart" type="button">Start</button><button class="btn" id="hStop" type="button" hidden>Zakończ</button><button class="btn small ghost" id="hCsv" type="button" hidden>Kopiuj dane CSV</button></div></div>
      <div class="card" id="hResCard" hidden><h3 class="sect">Wynik</h3>
        <div class="chartbox"><canvas id="hChart" class="chart" aria-label="Temperatura płynu w czasie"></canvas>
          <p class="legend" id="hLegend"><span><i class="sw"></i>płyn chłodzący</span><span><i class="sw dash"></i>olej</span><span>oś pozioma: minuty, pionowa: °C</span></p></div>
        <div id="hChecks"></div></div>
      <div class="card" id="hConclCard" hidden><h3 class="sect">Wniosek</h3><p class="concl" id="hConcl"></p><ol class="sus" id="hSteps"></ol></div>
      <div class="card"><h3 class="sect">Kody związane z ogrzewaniem</h3><div id="hCodes"></div>
        <div class="cardfoot"><button class="btn small" id="hRead" type="button" ${on ? '' : 'disabled'}>Odczytaj Climatronic i silnik</button></div></div>`;
    $('#hSym').addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      ht.sym = b.dataset.k; api.store.set('heatSym', ht.sym);
      $('#hSym').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      $('#hTip').textContent = SYM_TIP[ht.sym];
    });
    $('#hStart').onclick = manualStart(ht, startHeat);
    $('#hStop').onclick = manualStop(ht, stopHeat);
    $('#hCsv').onclick = e => api.copyText(csvOf(ht.samples, heatCols(), 'czas [min]', 1), e.currentTarget);
    $('#hC2Go').onclick = findC2;
    $('#hC2Clr').onclick = () => { c2.choose(null); c2.setCands([]); c2.vals = {}; c2Status(); reMinis(); };
    c2Status();
    $('#kScan').onclick = climaScanUi; $('#kTest').onclick = climaTest; $('#kStop').onclick = climaStop; climaStatus();
    $('#hRead').onclick = e => readCodes(e.currentTarget, ['01', '08']);
    renderHeatCodes(); syncHeat(); updMinis('hLive'); renderHeatResult();
  }
  /* Kafelek czujnika 2 pojawia się dopiero po wyborze numeru, więc odświeżamy listę kafelków. */
  function reMinis() { const h = $('#hLive'); if (h) { h.innerHTML = minis(HEAT_LIVE); updMinis('hLive'); } }
  function c2Status(msg) {
    const el = $('#hC2St'); if (!el) return;
    const go = $('#hC2Go'), clr = $('#hC2Clr');
    const txt = msg || (c2.sel != null ? `Wybrany czujnik 2: ${c2hex(c2.sel)}, odczyt na żywo w kafelku „Płyn za chłodnicą”. Wybór wynika z danych testu, nie z dokumentacji.` : c2.cands.length ? `Kandydaci: ${c2.cands.map(c2hex).join(', ')}. Uruchom test nagrzewania na zimnym silniku, a aplikacja oceni, który to czujnik za chłodnicą.` : 'Jeszcze nie szukano.');
    el.textContent = txt;
    if (go) go.disabled = !api.elm() || ht.running || !!c2.scanning;
    if (clr) clr.hidden = c2.sel == null && !c2.cands.length;
  }
  /* ---------- Climatronic: dobór odczytów z danych ---------- */
  const KPH = [['LO', 45, 'Ustaw pokrętło temperatury na LO (najzimniej)'], ['HI', 75, 'Ustaw pokrętło temperatury na HI (najcieplej)'], ['LO', 60, 'Ustaw pokrętło temperatury z powrotem na LO']];
  const kt = { running: false, rounds: [], t0: 0, res: null };
  const kHex = d => '0x' + d.toString(16).toUpperCase().padStart(4, '0');
  function climaStatus(msg) {
    const el = $('#kSt'); if (!el) return;
    const C = api.clima || { found: [] }, busy = C.scanning || kt.running, n = C.found.filter(x => x.b.length <= 8).length;
    if (msg !== undefined) el.textContent = msg;
    else if (!busy) el.textContent = C.found.length ? `Zapamiętane odczyty: ${C.found.length} (do testu: ${n}). ${kt.res ? '' : 'Teraz krok 2 na rozgrzanym silniku.'}` : 'Jeszcze nie szukano.';
    const s = $('#kScan'), t = $('#kTest'), p = $('#kStop');
    if (s) { s.disabled = !api.elm() || busy || ht.running; t.disabled = !api.elm() || busy || !n || ht.running; p.hidden = !busy; }
  }
  async function climaScanUi() {
    if (!api.climaScan || !api.elm()) return;
    climaStatus('Szukam…'); $('#kScan').disabled = true; $('#kStop').hidden = false;
    const t0 = performance.now();
    const r = await api.climaScan((did, n, tot, fc) => { const el = $('#kSt'); if (el) el.textContent = `Sprawdzam ${kHex(did)} · ${n} z ${tot} · znaleziono ${fc} · ${Math.round((performance.now() - t0) / 1000)} s`; });
    climaStatus(!r ? 'Szukanie przerwane albo adapter jest zajęty.' : `${r.stopped ? 'Przerwano' : 'Gotowe'}: Climatronic odpowiada na ${r.n} numerów${r.err ? ` (${r.err})` : ''}. Lista poszła do logu. Teraz krok 2 na rozgrzanym silniku.`);
  }
  function climaStop() { if (api.clima && api.clima.scanning) api.clima.stopReq = true; if (kt.running) kt.stopReq = true; }
  async function climaTest() {
    if (!api.climaRound || !api.elm() || kt.running) return;
    Object.assign(kt, { running: true, stopReq: false, rounds: [], t0: performance.now(), res: null });
    $('#kRes').innerHTML = ''; climaStatus('Nagrywam…');
    const total = KPH.reduce((a, p) => a + p[1], 0), ph = $('#kPhase'); ph.hidden = false;
    const resume = api.pause();
    try {
      while (!kt.stopReq && api.elm()) {
        const el = (performance.now() - kt.t0) / 1000; if (el >= total) break;
        let acc = 0, pi = 0; while (pi < KPH.length - 1 && el >= acc + KPH[pi][1]) { acc += KPH[pi][1]; pi++; }
        const left = Math.ceil(acc + KPH[pi][1] - el);
        ph.textContent = `${KPH[pi][2]} · jeszcze ${left} s`;
        const r = await api.climaRound(); if (!r) break;
        const t = (performance.now() - kt.t0) / 1000;
        let acc2 = 0, pj = 0; while (pj < KPH.length - 1 && t >= acc2 + KPH[pj][1]) { acc2 += KPH[pj][1]; pj++; }
        kt.rounds.push({ t, ph: pj, ect: r.ect, m: r.m });
        climaStatus(`Nagrywam: runda ${kt.rounds.length}, płyn ${r.ect ?? '—'} °C`);
      }
    } finally { resume(); }
    kt.running = false; ph.hidden = true;
    if (kt.rounds.length >= 4) { kt.res = climaAnalyze(); renderClima(); api.saveLog('test-klima', `Climatronic: test pokrętłem (${kt.res.react.length} reagujących)`, climaLog()); climaStatus(`Zakończono: ${kt.rounds.length} rund. Wynik poniżej i w logu.`); }
    else climaStatus('Za mało rund do oceny. Powtórz krok 2.');
  }
  /* Każdy odczyt rozkładamy na bajty, a 2-bajtowy także na liczbę 16-bitową. Średnie liczymy z drugiej połowy każdej fazy. */
  function climaSeries() {
    const S = {};
    const add = (name, i, v) => { (S[name] = S[name] || new Array(kt.rounds.length).fill(null))[i] = v; };
    kt.rounds.forEach((r, i) => { for (const d in r.m) { const b = r.m[d], D = +d; b.forEach((x, k) => add(`${kHex(D)}${b.length > 1 ? ' bajt ' + (k + 1) : ''}`, i, x)); if (b.length === 2) add(`${kHex(D)} (16 bit)`, i, b[0] * 256 + b[1]); } });
    return S;
  }
  function climaAnalyze() {
    const S = climaSeries(), R = kt.rounds, out = { react: [], changed: [], fixed: 0 };
    const phMean = (s, p) => { const ix = R.map((r, i) => i).filter(i => R[i].ph === p && s[i] != null); const h = ix.slice(Math.floor(ix.length / 2)); return h.length ? h.reduce((a, i) => a + s[i], 0) / h.length : null; };
    for (const [name, s] of Object.entries(S)) {
      const v = s.filter(x => x != null); if (!v.length) continue;
      if (Math.min(...v) === Math.max(...v)) { out.fixed++; continue; }
      const m0 = phMean(s, 0), m1 = phMean(s, 1), m2 = phMean(s, 2);
      const row = { name, lo1: m0, hi: m1, lo2: m2, min: Math.min(...v), max: Math.max(...v) };
      const ok = m0 != null && m1 != null && m2 != null && Math.sign(m1 - m0) === Math.sign(m1 - m2) && Math.min(Math.abs(m1 - m0), Math.abs(m1 - m2)) >= 3;
      if (ok) {
        /* Czas dojścia do 63% zmiany po przełączeniu na HI: klapa przestawia się w kilka sekund, nawiew nagrzewa się dziesiątki sekund. */
        const hs = KPH[0][1], hiIx = R.map((r, i) => i).filter(i => R[i].ph === 1 && s[i] != null);
        const hit = hiIx.find(i => (s[i] - m0) / (m1 - m0) >= 0.63);
        row.t63 = hit != null ? R[hit].t - hs : null;
        row.kind = row.t63 != null && row.t63 <= 12 ? 'skok razem z pokrętłem: klapa albo temperatura zadana' : 'zmienia się powoli: możliwa temperatura nawiewu';
        row.size = Math.min(Math.abs(m1 - m0), Math.abs(m1 - m2)); out.react.push(row);
      } else out.changed.push(row);
    }
    out.react.sort((a, b) => b.size - a.size);
    return out;
  }
  function renderClima() {
    const el = $('#kRes'); if (!el || !kt.res) return; const r = kt.res, n1 = v => v == null ? '—' : f(v, 1);
    el.innerHTML = r.react.length ? `<table class="tbl"><thead><tr><th>Odczyt</th><th class="num">LO</th><th class="num">HI</th><th class="num">LO</th><th>Zachowanie</th></tr></thead><tbody>${r.react.slice(0, 12).map(x => `<tr><td class="mono">${esc(x.name)}</td><td class="num">${n1(x.lo1)}</td><td class="num">${n1(x.hi)}</td><td class="num">${n1(x.lo2)}</td><td class="small">${esc(x.kind)}</td></tr>`).join('')}</tbody></table><p class="small muted">Wartości surowe (bez skali). Zmienia się też ${r.changed.length} innych odczytów bez związku z pokrętłem, stałych jest ${r.fixed}. Skalę i opis dobiorę z logu.</p>` : `<p class="small">Żaden odczyt nie zareagował na pokrętło. Zmienia się ${r.changed.length}, stałych jest ${r.fixed}. Możliwe, że ten moduł podaje te wartości tylko w sesji rozszerzonej albo pod numerami spoza zakresu.</p>`;
  }
  function climaLog() {
    const r = kt.res, R = kt.rounds, S = climaSeries(), n1 = v => v == null ? '' : String(+(+v).toFixed(2)).replace('.', ',');
    const L = ['== Climatronic: test pokrętłem temperatury ==', `Fazy: ${KPH.map(p => `${p[0]} ${p[1]} s`).join(' → ')} · rund: ${R.length} · płyn: ${R[0].ect ?? '—'} → ${R[R.length - 1].ect ?? '—'} °C`, '', '== Reagują na pokrętło (średnie z drugiej połowy faz, wartości surowe) =='];
    for (const x of r.react) L.push(`${x.name}: LO ${n1(x.lo1)} · HI ${n1(x.hi)} · LO ${n1(x.lo2)} · zakres ${x.min}–${x.max} · 63% zmiany po ${x.t63 == null ? '—' : n1(x.t63) + ' s'} · ${x.kind}`);
    if (!r.react.length) L.push('brak');
    L.push('', '== Zmienne bez związku z pokrętłem ==');
    for (const x of r.changed) L.push(`${x.name}: LO ${n1(x.lo1)} · HI ${n1(x.hi)} · LO ${n1(x.lo2)} · zakres ${x.min}–${x.max}`);
    const keys = [...r.react, ...r.changed].map(x => x.name);
    L.push('', `Stałych odczytów: ${r.fixed}`, '', '== Rundy (CSV) ==', ['czas [s]', 'faza', 'płyn [°C]', ...keys].join(';'));
    const step = Math.max(1, Math.ceil(R.length / 600));
    R.forEach((x, i) => i % step === 0 && L.push([n1(x.t), KPH[x.ph][0], x.ect ?? '', ...keys.map(k => S[k][i] ?? '')].join(';')));
    return L.join('\n');
  }
  async function findC2() {
    if (!api.elm() || ht.running || c2.scanning || !api.c2Scan) return;
    c2Status('Szukam…'); $('#hC2Go').disabled = true;
    const r = await api.c2Scan((did, n, tot, fc) => { const el = $('#hC2St'); if (el) el.textContent = `Sprawdzam 0x${did.toString(16).toUpperCase().padStart(4, '0')} · ${n} z ${tot} · znaleziono ${fc}`; });
    if (!r) { c2Status('Szukanie przerwane albo adapter jest zajęty.'); return; }
    c2Status(r.cand.length ? `Znaleziono ${r.total} odpowiadających numerów, w tym ${r.cand.length} podobnych do temperatury płynu: ${r.cand.map(c => `${c2hex(c.did)} (${f(c.t, 0)} °C)`).join(', ')}. Uruchom test nagrzewania na zimnym silniku, a aplikacja oceni, który to czujnik za chłodnicą.` : `Znaleziono ${r.total} odpowiadających numerów, ale żaden nie wygląda jak druga temperatura płynu. Ten sterownik może mieć czujnik pod innym numerem albo go nie udostępniać.`);
  }
  function renderHeatCodes() {
    const el = $('#hCodes'); if (!el) return;
    const { hits, read } = codeHits(HEAT_CODES, ['08']);
    if (!read) { el.innerHTML = '<p class="small muted">Kody nie zostały jeszcze odczytane.</p>'; return; }
    const rep = api.report(), clim = rep.modules.find(m => m.addr === mapAddr('08'));
    const cs = 'moduł ' + mapAddr('08'); const eng = hits.filter(h => h.src !== cs), cl = hits.filter(h => h.src === cs);
    let html = '';
    if (clim) html += clim.err ? `<p class="small">Klimatyzacja: nie udało się odczytać błędów (${esc(clim.err)}).</p>` : cl.length ? `<p class="small muted">Klimatyzacja:</p>${codeList(cl)}` : '<p class="noerr">Klimatyzacja: brak błędów</p>';
    else html += rep.absent.some(m => m.addr === mapAddr('08')) ? '<p class="small muted">Moduł klimatyzacji nie odpowiedział.</p>' : '<p class="small muted">Moduł klimatyzacji jeszcze nie odczytany.</p>';
    html += eng.length ? `<p class="small muted">Silnik:</p>${codeList(eng)}` : '<p class="noerr">Silnik: brak kodów związanych z chłodzeniem</p>';
    el.innerHTML = html;
  }
  const msgKeep = () => $('#hC2St') && c2.scanning ? $('#hC2St').textContent : undefined;
  function syncHeat() {
    const s = $('#hStart'), p = $('#hStop'), c = $('#hCsv'); if (!s) return;
    s.hidden = ht.running; p.hidden = !ht.running; c.hidden = ht.running || !ht.samples.length;
    s.textContent = ht.samples.length ? 'Nowy test' : 'Start'; s.disabled = !api.elm();
    heatStatus(); c2Status(msgKeep());
  }
  function heatStatus() {
    const el = $('#hStatus'); if (!el) return;
    const S = ht.samples, last = S[S.length - 1];
    if (!ht.running) { el.textContent = last ? `Test zakończony po ${fmtMin(last.t)}.` : ''; return; }
    if (!last) { el.textContent = 'Nagrywam…'; return; }
    const back = S.filter(s => s.t >= last.t - 2 && s.ect != null);
    const rate = back.length >= 2 && back[back.length - 1].t - back[0].t > 0.3 ? (back[back.length - 1].ect - back[0].ect) / (back[back.length - 1].t - back[0].t) : null;
    el.textContent = `Test trwa ${fmtMin(last.t)} · płyn ${f(last.ect, 0)} °C${rate != null ? ` · ${sgn(rate, 1)} °C/min` : ''}`;
  }
  function startHeat() {
    if (!api.elm()) return;
    Object.assign(ht, { running: true, t0: performance.now(), samples: [], n: 0 });
    c2.vals = {}; c2.probe = c2.sel == null && c2.cands.length > 0;
    api.ensurePolling(); syncHeat(); renderHeatResult(); c2Status();
  }
  /* Po teście wybieramy czujnik 2 z kandydatów, jeśli któryś zachował się jak czujnik za chłodnicą. */
  function finishHeat() {
    if (c2.probe && c2.sel == null) { const b = rankC2(ht.samples).find(x => x.kind === 'czujnik'); if (b) c2.choose(b.did); }
    c2.probe = false; reMinis();
  }
  function stopHeat() { if (!ht.running) return; ht.running = false; finishHeat(); syncHeat(); renderHeatResult(); saveHeat(); c2Status(); }
  function renderHeatResult() {
    const card = $('#hResCard'), cc = $('#hConclCard'); if (!card) return;
    const ok = ht.samples.length >= 3; card.hidden = !ok; cc.hidden = !ok;
    if (!ok) return;
    const r = analyzeHeat();
    $('#hChecks').innerHTML = checksHtml(r.checks);
    if (r.concl) { $('#hConcl').textContent = r.concl.title; $('#hSteps').innerHTML = stepsHtml(r.concl.steps); }
    drawHeat();
  }
  function drawHeat() {
    const cv = $('#hChart'); if (!cv || $('#tab-heat').hidden) return;
    const tk = api.tokens();
    const E = ht.samples.filter(s => s.ect != null).map(s => ({ x: s.t, y: s.ect }));
    const O = ht.samples.filter(s => s.oil != null).map(s => ({ x: s.t, y: s.oil }));
    const ser = c2Series(ht.samples), C = ser.key ? ht.samples.filter(s => s[ser.key] != null).map(s => ({ x: s.t, y: s[ser.key] })) : [];
    const lg = $('#hLegend'); if (lg) lg.innerHTML = `<span><i class="sw"></i>płyn chłodzący</span>${C.length ? `<span><i class="sw" style="background:${tk.warn}"></i>${esc(ser.label)}</span>` : ''}<span><i class="sw dash"></i>olej</span><span>oś pozioma: minuty, pionowa: °C</span>`;
    drawChart(cv, [{ pts: O, color: tk.ink, dash: true }].concat(C.length ? [{ pts: C, color: tk.warn }] : [], [{ pts: E, color: tk.accent }]), { refs: [{ y: 85, label: '85 °C' }], xMin: 0 });
  }

  /* =================== Automatyczne testy ===================
     Po 3 minutach ciągłego połączenia aplikacja sama nagrywa trzy testy (nagrzewanie, doładowanie P0299, czujnik MAP)
     z normalnej jazdy. Co 10 minut kończy odcinek i zapisuje logi (wysyłane na GitHub razem z resztą), po czym zaczyna
     następny. Odcinek bez przyspieszenia z pełnym gazem nie daje logu doładowania ani MAP, bo nie ma czego oceniać. */
  const AUTO_DELAY = 3 * 60000, AUTO_SEG = 10 * 60000;
  const auto = { on: api.store.get('autoTests', '1') !== '0', elm: null, since: 0, segAt: 0, off: false, active: false, shown: 0 };
  const hasPlateau = S => S.filter(x => (x.rpm ?? 0) >= 2800 && (x.pedal != null ? x.pedal >= 50 : (x.load ?? 0) >= 85)).length >= 3;
  const worthBoost = () => bt.samples.length >= 10 && findPulls(bt.samples).length >= 1;
  const worthHeat = () => ht.samples.length >= 60;
  const worthMap = () => mt.samples.length >= 20 && hasPlateau(mt.samples);
  const coldNow = () => { const c = api.vals().coolant; return c != null && c < 60; };
  function autoStart() {
    auto.active = true; auto.segAt = performance.now();
    if (!bt.running) { startBoost(); bt.auto = true; }
    if (!ht.running) { startHeat(); ht.auto = true; }
    if (!mt.running) { startMap(); mt.auto = true; }
  }
  function autoCycle(restart) {
    if (bt.auto && bt.running) { bt.running = false; bt.result = analyzeBoost(); if (worthBoost()) saveBoost(); syncBoost(); renderBoostResult(); }
    if (ht.auto && ht.running) { ht.running = false; finishHeat(); if (worthHeat()) saveHeat(); syncHeat(); renderHeatResult(); c2Status(); }
    if (mt.auto && mt.running) { mt.running = false; if (worthMap()) saveMap(); renderMapResult(); mapStatus(); }
    bt.auto = ht.auto = mt.auto = false;
    if (restart) autoStart(); else auto.active = false;
  }
  /* Ręczne zatrzymanie testu uruchomionego automatycznie kończy auto-testy do następnego połączenia. */
  const manualStop = (t, fn) => () => { if (t.auto) { t.auto = false; auto.off = true; fn(); autoCycle(false); autoStatus(true); } else fn(); };
  const manualStart = (t, fn) => () => { fn(); t.auto = false; };
  function autoStatus(force) {
    const el = document.querySelector('#autoSt'); if (!el) return;
    const now = performance.now(); if (!force && now - auto.shown < 900) return; auto.shown = now;
    const mmss = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
    el.textContent = !auto.on || !api.elm() ? '' : auto.off ? 'auto-testy wyłączone do ponownego połączenia' : auto.active ? `auto-testy nagrywają ${mmss(now - auto.segAt)}` : coldNow() ? 'zimny silnik: auto-testy ruszają od razu' : `auto-testy ruszą za ${mmss(Math.max(0, AUTO_DELAY - (now - auto.since)))}`;
  }
  function autoTick() {
    const e = api.elm(), now = performance.now();
    if (e !== auto.elm) { auto.elm = e; auto.since = now; auto.off = false; auto.active = false; }
    if (auto.on && e && !auto.off) {
      /* Zimny silnik: testy od razu, bo usterka wastegate tego auta pojawia się tylko po zimnym starcie. */
      if (!auto.active) { if (now - auto.since >= AUTO_DELAY || (coldNow() && now - auto.since >= 3000)) autoStart(); }
      else if (now - auto.segAt >= AUTO_SEG) autoCycle(true);
    }
    autoStatus();
  }
  function setAuto(on) {
    auto.on = !!on; api.store.set('autoTests', on ? '1' : '0');
    if (!on && auto.active) autoCycle(false);
    if (on) auto.off = false;
    autoStatus(true);
  }

  /* ---------- API dla aplikacji ---------- */
  function render() {
    if (!api.elm()) { mt.running = false; mt.watch = false; if (bt.running) { bt.running = false; bt.result = analyzeBoost(); } if (ht.running) { ht.running = false; finishHeat(); } }
    renderBoost(); renderHeat();
  }
  function refresh() { renderBoostCodes(); renderHeatCodes(); }
  function onTab(t) {
    cur = t;
    if (t === 'boost') { updMinis('bLive'); renderBoostResult(); }
    if (t === 'heat') { updMinis('hLive'); renderHeatResult(); }
  }
  function tick() {
    autoTick();
    const v = api.vals();
    if (bt.running) {
      if (bt.samples.length < 20000) { const sm = sampleBoost(v); bt.samples.push(sm); if (sm.pedal != null) { if (sm.pedal > (bt.pedMax ?? 0)) bt.pedMax = sm.pedal; if (bt.pedMin == null || sm.pedal < bt.pedMin) bt.pedMin = sm.pedal; } }
      const n = findPulls(bt.samples).length;
      if (n !== bt.pulls) { bt.pulls = n; renderBoostResult(); }
      boostStatus();
    }
    if (ht.running) {
      if (ht.samples.length < 20000) ht.samples.push(sampleHeat(v));
      if (++ht.n % 8 === 0 && cur === 'heat') renderHeatResult();
      heatStatus();
    }
    if (mt.running && mt.samples.length < 20000) {
      mt.samples.push(sampleMap(v));
      if (++mt.n % 8 === 0 && cur === 'boost') renderMapResult();
      mapStatus();
    }
    if (cur === 'boost' && (mt.running || mt.watch)) renderMapLive();
    if (cur === 'boost') updMinis('bLive');
    if (cur === 'heat') updMinis('hLive');
  }
  function keysFor(tab) {
    const ks = [];
    if (bt.running || tab === 'boost') ks.push(...BOOST_KEYS);
    if (mt.running || (mt.watch && tab === 'boost')) ks.push(...MAP_KEYS);
    if (ht.running || tab === 'heat') ks.push(...HEAT_KEYS);
    return ks.length ? [...new Set(ks)] : null;
  }
  function stopAll() {
    if (auto.active) autoCycle(false);
    auto.elm = null; autoStatus(true);
    if (mt.running) { mt.running = false; saveMap(); }
    mt.watch = false; mapStatus();
    if (bt.running) { bt.running = false; bt.result = analyzeBoost(); saveBoost(); }
    if (ht.running) { ht.running = false; finishHeat(); saveHeat(); }
    syncBoost(); syncHeat();
  }
  function boostLines() {
    const L = [];
    const r = bt.result || (bt.sensor ? { checks: [bt.sensor], suspects: [] } : null);
    if (r) {
      L.push('', '== P0299 – test doładowania ==');
      r.checks.forEach(c => L.push(`[${LV[c.lvl]}] ${c.title}: ${c.text}`));
      if (r.suspects.length) L.push('Od czego zacząć: ' + r.suspects.map((s, i) => `${i + 1}. ${s[0]}`).join('; '));
    }
    return L;
  }
  function heatLines() {
    const L = [];
    if (ht.samples.length >= 3) {
      const h = analyzeHeat();
      L.push('', '== Ogrzewanie – test nagrzewania ==', 'Objaw: ' + SYMPTOMS.find(s => s[0] === ht.sym)[1]);
      h.checks.forEach(c => L.push(`[${LV[c.lvl]}] ${c.title}: ${c.text}`));
      if (h.concl) L.push('Wniosek: ' + h.concl.title);
    }
    return L;
  }
  function reportLines() { return boostLines().concat(mapLines(), heatLines()); }
  function saveBoost() { if (bt.samples.length) api.saveLog('test-p0299', `Test doładowania, ${bt.pulls} ${bt.pulls === 1 ? 'przyspieszenie' : 'przyspieszeń'}`, boostLines().join('\n').trim() + '\n\n== Próbki (CSV) ==\n' + csvOf(bt.samples, BOOST_COLS, 'czas [s]', 1)); }
  function saveHeat() { if (ht.samples.length >= 3) api.saveLog('test-ogrzewanie', 'Test nagrzewania', heatLines().join('\n').trim() + '\n\n== Próbki (CSV) ==\n' + csvOf(ht.samples, heatCols(), 'czas [min]', 1)); }
  let rs = null;
  window.addEventListener('resize', () => { clearTimeout(rs); rs = setTimeout(() => { if (cur === 'boost') renderBoostResult(); if (cur === 'heat') drawHeat(); }, 200); });
  return { render, refresh, onTab, tick, keysFor, stopAll, setAuto, reportLines, busy: () => bt.running || ht.running || mt.running };
}
