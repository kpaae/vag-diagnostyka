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
  const BOOST_KEYS = ['rpm', 'pedal', 'pedalRel', 'tps', 'load', 'boost', 'boostTarget', 'boostDev', 'map', 'baro', 'iat', 'ambient', 'stft1', 'ltft1', 'lambdaA', 'lambdaCmd', 'timing', 'railP', 'maf', 'wgCmd', 'wgAct', 'coolant', 'speed'];
  const BOOST_LIVE = ['boost', 'boostTarget', 'boostDev', 'map', 'rpm', 'pedal', 'iat', 'wgAct'];
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
      rail: v.railP ?? v.railPabs, maf: v.maf, wgC: v.wgCmd, wgA: v.wgAct, ect: v.coolant, speed: v.speed
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
    $('#bStart').onclick = startBoost;
    $('#bStop').onclick = stopBoost;
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
  const HEAT_KEYS = ['coolant', 'oil', 'ambient', 'iat', 'rpm', 'speed', 'runTime', 'load'];
  const HEAT_LIVE = ['coolant', 'oil', 'ambient', 'speed', 'runTime'];
  const HEAT_CODES = ['P0128', 'P0125', 'P0116', 'P0117', 'P0118', 'P0119', 'P2181', 'P0597', 'P0598', 'P0599', 'P0480', 'P0481', 'P0217'];
  const HEAT_COLS = [['ect', 'płyn [°C]'], ['oil', 'olej [°C]'], ['amb', 'otoczenie [°C]'], ['iat', 'dolot [°C]'], ['rpm', 'obroty [obr/min]'], ['speed', 'prędkość [km/h]'], ['run', 'od uruchomienia [s]']];
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

  const sampleHeat = v => ({ t: (performance.now() - ht.t0) / 60000, ect: v.coolant, oil: v.oil, amb: v.ambient, iat: v.iat, rpm: v.rpm, speed: v.speed, run: v.runTime });

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
    const win = S.filter(s => s.ect != null && s.ect >= 40 && s.ect < 80);
    const rate = win.length >= 2 && win[win.length - 1].t - win[0].t > 0.5 ? (win[win.length - 1].ect - win[0].ect) / (win[win.length - 1].t - win[0].t) : null;
    if (maxE >= 85) { out.branch = 'heater'; out.checks.push(V('ok', 'Temperatura robocza', `Silnik doszedł do ${f(maxE, 0)} °C${t80 != null ? `, 80 °C po ${fmtMin(t80)}` : ''}. Termostat się zamyka.`)); }
    else if (dur >= 15) {
      out.branch = driving ? 'engine' : null;
      out.checks.push(V(driving ? 'crit' : 'warn', 'Silnik nie osiąga temperatury', `Po ${fmtMin(dur)} ${driving ? 'jazdy' : 'pracy na postoju'} najwyżej ${f(maxE, 0)} °C. Rozgrzany silnik ma zwykle 85–105 °C. ${driving ? 'Termostat najpewniej jest stale otwarty.' : 'Na postoju, zwłaszcza zimą, silnik grzeje się bardzo wolno. Powtórz test w jeździe.'}`));
    } else out.checks.push(V('info', 'Test w toku', `Minęło ${fmtMin(dur)}, najwyżej ${f(maxE, 0)} °C. Do oceny potrzeba około 15 minut jazdy albo osiągnięcia 85 °C.`));
    if (rate != null) out.checks.push(V('info', 'Tempo nagrzewania', `${f(rate, 1)} °C/min między 40 a 80 °C, ${driving ? 'w jeździe' : 'głównie na postoju'}.`));
    if (maxE >= 85) {
      const iMax = S.findIndex(s => s.ect === maxE);
      const low = mn(col(S.slice(iMax).filter(s => (s.speed ?? 0) >= 40), 'ect'));
      if (low != null && maxE - low >= 10) {
        out.branch = 'engine';
        out.checks.push(V('warn', 'Temperatura spada w jeździe', `Z ${f(maxE, 0)} do ${f(low, 0)} °C przy prędkości powyżej 40 km/h. Termostat nie trzyma temperatury albo moduł zarządzania temperaturą źle steruje przepływem.`));
      }
    }
    if (maxE >= 110) out.checks.push(V('crit', 'Przegrzewanie', `Płyn doszedł do ${f(maxE, 0)} °C. Sprawdź poziom płynu i wentylator chłodnicy, zanim pojedziesz dalej.`));
    const O = col(S, 'oil');
    if (O.length) out.checks.push(V('info', 'Olej', `Od ${f(mn(O), 0)} do ${f(mx(O), 0)} °C. Olej nagrzewa się wolniej niż płyn. Po dłuższej jeździe obie temperatury powinny być zbliżone.`));
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
      <div class="card ptest"><h3 class="sect">Test nagrzewania</h3>
        <ol class="steps"><li>Najlepiej po kilku godzinach postoju, na zimnym silniku.</li><li>Połącz się, naciśnij Start i uruchom silnik.</li><li>Jedź normalnie 15–20 minut. Ekran telefonu musi zostać włączony, aplikacja sama go podtrzymuje.</li><li>Naciśnij Zakończ.</li></ol>
        <div id="hLive">${minis(HEAT_LIVE)}</div>
        <p class="tstatus" id="hStatus"></p>
        <div class="actions"><button class="btn primary" id="hStart" type="button">Start</button><button class="btn" id="hStop" type="button" hidden>Zakończ</button><button class="btn small ghost" id="hCsv" type="button" hidden>Kopiuj dane CSV</button></div></div>
      <div class="card" id="hResCard" hidden><h3 class="sect">Wynik</h3>
        <div class="chartbox"><canvas id="hChart" class="chart" aria-label="Temperatura płynu w czasie"></canvas>
          <p class="legend"><span><i class="sw"></i>płyn chłodzący</span><span><i class="sw dash"></i>olej</span><span>oś pozioma: minuty, pionowa: °C</span></p></div>
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
    $('#hStart').onclick = startHeat;
    $('#hStop').onclick = stopHeat;
    $('#hCsv').onclick = e => api.copyText(csvOf(ht.samples, HEAT_COLS, 'czas [min]', 1), e.currentTarget);
    $('#hRead').onclick = e => readCodes(e.currentTarget, ['01', '08']);
    renderHeatCodes(); syncHeat(); updMinis('hLive'); renderHeatResult();
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
  function syncHeat() {
    const s = $('#hStart'), p = $('#hStop'), c = $('#hCsv'); if (!s) return;
    s.hidden = ht.running; p.hidden = !ht.running; c.hidden = ht.running || !ht.samples.length;
    s.textContent = ht.samples.length ? 'Nowy test' : 'Start'; s.disabled = !api.elm();
    heatStatus();
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
    api.ensurePolling(); syncHeat(); renderHeatResult();
  }
  function stopHeat() { if (!ht.running) return; ht.running = false; syncHeat(); renderHeatResult(); saveHeat(); }
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
    drawChart(cv, [{ pts: O, color: tk.ink, dash: true }, { pts: E, color: tk.accent }], { refs: [{ y: 85, label: '85 °C' }], xMin: 0 });
  }

  /* ---------- API dla aplikacji ---------- */
  function render() {
    if (!api.elm()) { if (bt.running) { bt.running = false; bt.result = analyzeBoost(); } ht.running = false; }
    renderBoost(); renderHeat();
  }
  function refresh() { renderBoostCodes(); renderHeatCodes(); }
  function onTab(t) {
    cur = t;
    if (t === 'boost') { updMinis('bLive'); renderBoostResult(); }
    if (t === 'heat') { updMinis('hLive'); renderHeatResult(); }
  }
  function tick() {
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
    if (cur === 'boost') updMinis('bLive');
    if (cur === 'heat') updMinis('hLive');
  }
  function keysFor(tab) {
    const ks = [];
    if (bt.running || tab === 'boost') ks.push(...BOOST_KEYS);
    if (ht.running || tab === 'heat') ks.push(...HEAT_KEYS);
    return ks.length ? [...new Set(ks)] : null;
  }
  function stopAll() {
    if (bt.running) { bt.running = false; bt.result = analyzeBoost(); saveBoost(); }
    if (ht.running) { ht.running = false; saveHeat(); }
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
  function reportLines() { return boostLines().concat(heatLines()); }
  function saveBoost() { if (bt.samples.length) api.saveLog('test-p0299', `Test doładowania, ${bt.pulls} ${bt.pulls === 1 ? 'przyspieszenie' : 'przyspieszeń'}`, boostLines().join('\n').trim() + '\n\n== Próbki (CSV) ==\n' + csvOf(bt.samples, BOOST_COLS, 'czas [s]', 1)); }
  function saveHeat() { if (ht.samples.length >= 3) api.saveLog('test-ogrzewanie', 'Test nagrzewania', heatLines().join('\n').trim() + '\n\n== Próbki (CSV) ==\n' + csvOf(ht.samples, HEAT_COLS, 'czas [min]', 1)); }
  let rs = null;
  window.addEventListener('resize', () => { clearTimeout(rs); rs = setTimeout(() => { if (cur === 'boost') renderBoostResult(); if (cur === 'heat') drawHeat(); }, 200); });
  return { render, refresh, onTab, tick, keysFor, stopAll, reportLines, busy: () => bt.running || ht.running };
}
