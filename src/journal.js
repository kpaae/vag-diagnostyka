/* ===== Dziennik: zapis logów w telefonie (IndexedDB) i wysyłka do prywatnego repozytorium GitHub ===== */
function createJournal(api) {
  const $ = s => document.querySelector(s);
  const { esc, plural } = api;
  const KEEP = 300, CHUNK = 700 * 1024;
  const p2 = n => String(n).padStart(2, '0');
  const dstamp = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const tstamp = d => `${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const KINDS = {
    raport: 'Raport', nagranie: 'Nagranie parametrów', rejestr: 'Rejestr jazdy', 'test-p0299': 'Test doładowania (P0299)', 'test-ogrzewanie': 'Test nagrzewania', 'test-map': 'Czujnik MAP (ciśnienia)', 'test-p2563': 'Strażnik P2563 (zimny start)', 'test-klima': 'Climatronic (nawiew i klapa)', 'test-akumulator': 'Akumulator',
    'testy-obd': 'Testy sterownika (tryb 06)', skaner: 'Skaner pomiarów VAG', podsluch: 'Podsłuch magistrali', konsola: 'Konsola UDS', komunikacja: 'Log komunikacji'
  };

  /* ---------- magazyn ---------- */
  let mem = [];          // zapas, gdy IndexedDB jest niedostępne (np. tryb prywatny)
  let dbp = null, dbOk = true;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('vagdiag', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('logs', { keyPath: 'id' });
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    }).catch(e => { dbOk = false; throw e; });
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => { const t = d.transaction('logs', mode); const r = fn(t.objectStore('logs')); t.oncomplete = () => res(r && 'result' in r ? r.result : undefined); t.onerror = () => rej(t.error); });
  }
  async function put(e) { try { await tx('readwrite', s => s.put(e)); } catch (err) { const i = mem.findIndex(x => x.id === e.id); if (i >= 0) mem[i] = e; else mem.push(e); } }
  async function del(id) { try { await tx('readwrite', s => s.delete(id)); } catch (err) {} mem = mem.filter(x => x.id !== id); }
  async function all() { let L = []; try { L = await tx('readonly', s => s.getAll()) || []; } catch (err) {} const ids = new Set(L.map(x => x.id)); return L.concat(mem.filter(x => !ids.has(x.id))).sort((a, b) => b.ts - a.ts); }

  /* ---------- urządzenie (folder w repozytorium) ---------- */
  let autoDev = api.store.get('devAuto', '');
  function guessDev() {
    const ua = navigator.userAgent;
    const br = /Bluefy/i.test(ua) ? 'Bluefy' : /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox/.test(ua) ? 'Firefox' : 'Safari';
    if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad ' + br;
    if (/iPhone/.test(ua)) return 'iPhone ' + br;
    const m = ua.match(/Android [\d.]+; ([^;)]+)/); if (m && m[1] !== 'K') return (/^SM-/.test(m[1]) ? 'Samsung ' : '') + m[1].trim();
    if (/Android/.test(ua)) return 'Android ' + br;
    if (/Windows/.test(ua)) return 'Windows ' + br;
    if (/Mac OS X/.test(ua)) return 'Mac ' + br;
    return 'Linux ' + br;
  }
  async function detectDev() {
    let name = guessDev();
    try {
      if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
        const h = await navigator.userAgentData.getHighEntropyValues(['model', 'platform']);
        if (h.model) name = (/^SM-/.test(h.model) ? 'Samsung ' : '') + h.model;
      }
    } catch (e) {}
    autoDev = name; api.store.set('devAuto', name); render();
  }
  detectDev();
  function devName() { return api.store.get('devName', '') || autoDev || guessDev(); }
  const devSlug = n => (n || 'urzadzenie').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'urzadzenie';

  /* ---------- sesja ---------- */
  let session = null;
  function startSession() { const d = new Date(); session = `${dstamp(d)}_${p2(d.getHours())}${p2(d.getMinutes())}`; return session; }
  function header(kind, title) {
    return [`VAG Diagnostyka · ${KINDS[kind] || kind}${title && title !== KINDS[kind] ? ' · ' + title : ''}`,
      `Data: ${new Date().toLocaleString('pl-PL')}`, `VIN: ${api.vin() || '—'}`, `Urządzenie: ${devName()}`, `Przeglądarka: ${navigator.userAgent}`, `Sesja: ${session || '—'}`, `Wersja aplikacji: ${api.version}`, ''].join('\n');
  }

  /* Dodaje wpis. Z opcją id nadpisuje istniejący (np. rejestr jazdy zapisywany co kilka minut). */
  async function add(kind, title, text, opt = {}) {
    if (!text || !String(text).trim()) return null;
    const d = new Date(), ext = opt.ext || 'txt';
    const sess = session || `${dstamp(d)}_bez-polaczenia`;
    let e = opt.id ? (await all()).find(x => x.id === opt.id) : null;
    const body = (ext === 'csv' ? '' : header(kind, title)) + text;
    if (e) Object.assign(e, { ts: d.getTime(), title: title || e.title, text: body, synced: false, err: null });
    else e = { id: opt.id || `${d.getTime()}-${kind}`, ts: d.getTime(), session: sess, kind, title: title || KINDS[kind] || kind, ext, text: body, synced: false, err: null, sha: {}, file: `${sess}/${tstamp(d)}-${kind}` };
    await put(e);
    await trim();
    render();
    if (opt.quiet !== true) api.logLine(`— zapisano: ${e.title}`);
    kick();
    return e.id;
  }
  async function trim() {
    const L = await all(); if (L.length <= KEEP) return;
    for (const e of L.slice(KEEP)) if (e.synced || !cfg().token) await del(e.id);
  }

  /* ---------- GitHub ---------- */
  function cfg() { return { repo: api.store.get('ghRepo', '') || 'kpaae/vag-logi', token: api.store.get('ghToken', ''), auto: api.store.get('ghAuto', '1') === '1' }; }
  const enc = new TextEncoder();
  function b64(str) {
    const bytes = enc.encode(str); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  /* Ścieżka w repozytorium: <urządzenie>/<sesja>/<godzina>-<rodzaj>. Folder urządzenia ustalany przy pierwszej wysyłce wpisu. */
  function parts(e) {
    if (!e.path) e.path = `${devSlug(devName())}/${e.file || e.session + '/' + e.id}`;
    if (e.text.length <= CHUNK) return [[`${e.path}.${e.ext}`, e.text]];
    const out = []; for (let i = 0, n = 1; i < e.text.length; i += CHUNK, n++) out.push([`${e.path}.cz${n}.${e.ext}`, e.text.slice(i, i + CHUNK)]);
    return out;
  }
  async function gh(method, path, body) {
    const c = cfg();
    const r = await fetch(`https://api.github.com/repos/${c.repo}${path}`, {
      method, headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) { const err = new Error(ghErr(r.status, j)); err.status = r.status; throw err; }
    return j;
  }
  function ghErr(s, j) {
    if (s === 401) return 'Klucz dostępu jest nieprawidłowy albo wygasł.';
    if (s === 403) return 'Klucz nie ma uprawnienia do zapisu w tym repozytorium (Contents: Read and write).';
    if (s === 404) return 'Nie widzę repozytorium. Sprawdź nazwę (właściciel/nazwa) i czy klucz ma do niego dostęp.';
    if (s === 409 || s === 422) return 'Konflikt wersji pliku. Ponowię wysyłkę.';
    return `GitHub odpowiedział ${s}${j && j.message ? ': ' + j.message : ''}`;
  }
  let syncing = false, again = false, lastErr = '';
  async function sync(force) {
    const c = cfg(); if (!c.repo || !c.token || (!c.auto && !force)) { render(); return; }
    if (!navigator.onLine) { lastErr = 'Brak internetu. Wyślę, gdy wróci połączenie.'; render(); return; }
    if (syncing) { again = true; return; }
    syncing = true; lastErr = ''; render();
    try {
      const L = (await all()).filter(e => !e.synced).reverse();
      for (const e of L) {
        try {
          for (const [path, text] of parts(e)) {
            const body = { message: `${KINDS[e.kind] || e.kind}: ${e.title} (${e.session})`, content: b64(text) };
            if (e.sha[path]) body.sha = e.sha[path];
            let j;
            try { j = await gh('PUT', '/contents/' + path.split('/').map(encodeURIComponent).join('/'), body); }
            catch (err) {
              if (err.status !== 409 && err.status !== 422) throw err;
              const cur = await gh('GET', '/contents/' + path.split('/').map(encodeURIComponent).join('/')).catch(() => null);
              if (cur && cur.sha) body.sha = cur.sha; else delete body.sha;
              j = await gh('PUT', '/contents/' + path.split('/').map(encodeURIComponent).join('/'), body);
            }
            e.sha[path] = j && j.content && j.content.sha;
          }
          e.synced = true; e.err = null; await put(e);
        } catch (err) {
          e.err = err.message; await put(e); lastErr = err.message;
          if (err.status === 401 || err.status === 403 || err.status === 404 || err instanceof TypeError) break;
        }
        render();
      }
    } finally { syncing = false; render(); if (again) { again = false; sync(force); } }
  }
  let kickT = null;
  function kick() { clearTimeout(kickT); kickT = setTimeout(() => sync(false), 1500); }
  window.addEventListener('online', () => sync(false));
  setInterval(() => sync(false), 90000);
  async function testGh() {
    const st = $('#jGhSt'); const c = cfg();
    if (!c.repo || !c.token) { st.textContent = 'Uzupełnij repozytorium i klucz.'; return; }
    st.textContent = 'Sprawdzam…';
    try {
      const r = await gh('GET', '');
      if (!r.permissions || !r.permissions.push) { st.textContent = 'Klucz widzi repozytorium, ale nie ma prawa zapisu.'; return; }
      st.textContent = r.private ? `Połączono z ${r.full_name} (prywatne). Logi będą wysyłane automatycznie.` : `Uwaga: ${r.full_name} jest publiczne. Logi zawierają VIN, ustaw repozytorium jako prywatne.`;
      sync(true);
    } catch (err) { st.textContent = err instanceof TypeError ? 'Brak połączenia z GitHubem.' : err.message; }
  }

  /* ---------- interfejs ---------- */
  let rT = null;
  function render() { clearTimeout(rT); rT = setTimeout(draw, 120); }
  const kb = n => n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
  async function draw() {
    const host = $('#journalPanel'); if (!host) return;
    if (!host.dataset.built) build(host);
    const L = await all(), c = cfg();
    const pend = L.filter(e => !e.synced).length;
    $('#jSum').textContent = `${L.length} ${plural(L.length, 'wpis', 'wpisy', 'wpisów')} w telefonie${c.repo && c.token ? `, do wysłania: ${pend}` : ''}${syncing ? ' · wysyłam…' : ''}${!dbOk ? ' · pamięć przeglądarki niedostępna, logi znikną po zamknięciu strony' : ''}`;
    $('#jErr').textContent = lastErr; $('#jErr').hidden = !lastErr;
    $('#jSend').hidden = !(c.repo && c.token) || !pend;
    const by = {}; L.forEach(e => { (by[e.session] = by[e.session] || []).push(e); });
    $('#jList').innerHTML = L.length ? Object.keys(by).sort().reverse().slice(0, 40).map(s => `<div class="jsess"><h4 class="sub">${esc(s.replace('_', ' · ').replace(/(\d\d)(\d\d)$/, '$1:$2'))}</h4>
      ${by[s].map(e => `<div class="jrow"><div class="jmain"><b>${esc(e.title)}</b><span class="muted">${new Date(e.ts).toLocaleTimeString('pl-PL')} · ${kb(e.text.length)}</span></div>
        <span class="st ${e.synced ? 'ok' : e.err ? 'no' : ''}">${e.synced ? 'wysłane' : e.err ? 'błąd' : c.repo && c.token ? 'czeka' : 'w telefonie'}</span>
        <div class="jact"><button class="linkbtn" type="button" data-jc="${esc(e.id)}">Kopiuj</button>${api.framed ? '' : `<button class="linkbtn" type="button" data-jd="${esc(e.id)}">Pobierz</button>`}<button class="linkbtn" type="button" data-jx="${esc(e.id)}">Usuń</button></div></div>`).join('')}</div>`).join('')
      : '<p class="small muted">Jeszcze nic nie zapisano. Logi pojawią się po połączeniu z autem.</p>';
  }
  function build(host) {
    host.dataset.built = '1'; const c = cfg();
    host.innerHTML = `
      <div class="card"><div class="card-h"><h3>Zapisane logi</h3><span class="n" id="jSum"></span></div>
        <p class="small muted">Aplikacja sama zapisuje każdy raport ze skanu, nagranie, testy z paneli, odczyt testów sterownika, skaner, podsłuch, konsolę i log komunikacji, a w czasie połączenia co sekundę rejestruje parametry jazdy. Logi zostają w tym telefonie i, jeśli ustawisz GitHuba poniżej, trafiają do Twojego prywatnego repozytorium.</p>
        <p class="small codehead crit" id="jErr" hidden></p>
        <div class="actions"><button class="btn small primary" id="jSend" type="button" hidden>Wyślij teraz</button><button class="btn small ghost" id="jClean" type="button">Usuń wysłane z telefonu</button></div>
        <div id="jList"></div></div>
      <details class="help" id="jGh"${c.token ? '' : ' open'}><summary>Wysyłanie logów na GitHub ${c.token ? '· ustawione' : ''}</summary>
        <ol>
          <li>Prywatne repozytorium <b>kpaae/vag-logi</b> już jest. Na innym koncie utwórz własne: <a href="https://github.com/new?name=vag-logi&visibility=private&description=Logi%20z%20VAG%20Diagnostyka" target="_blank" rel="noopener">github.com/new</a> (nazwa vag-logi, Private).</li>
          <li>Otwórz <a href="https://github.com/settings/personal-access-tokens/new?name=VAG%20Diagnostyka%20logi&description=Wysy%C5%82anie%20log%C3%B3w%20z%20aplikacji%20VAG%20Diagnostyka&expires_in=366&contents=write" target="_blank" rel="noopener">gotowy formularz tokenu</a> (nazwa, ważność rok i uprawnienie Contents: Read and write są już ustawione). Zostaje jedno: w „Repository access” wybierz „Only select repositories” i <b>tylko vag-logi</b>. Potem „Generate token” i skopiuj go.</li>
          <li>Wklej poniżej i naciśnij „Zapisz i sprawdź”. Od tej chwili logi wysyłają się same, także te już zapisane w telefonie. Klucz zostaje tylko w tej przeglądarce i daje dostęp wyłącznie do repozytorium z logami.</li>
          <li>Na drugim urządzeniu nie trzeba wpisywać tokenu ręcznie: gdy steruje ono przez most, na urządzeniu przy aucie naciśnij „Przekaż ustawienia logów GitHub”.</li>
        </ol>
        <div class="frow"><label class="fl">Repozytorium <input id="jRepo" class="inp mono" value="${esc(c.repo || 'kpaae/vag-logi')}" spellcheck="false" autocomplete="off" autocapitalize="off"></label></div>
        <div class="frow"><label class="fl">Urządzenie <input id="jDev" class="inp" value="${esc(api.store.get('devName', ''))}" placeholder="${esc(devName())}" spellcheck="false" autocomplete="off"></label></div>
        <p class="small muted" id="jDevNote">Logi z tego urządzenia trafiają do folderu <code>${esc(devSlug(devName()))}/</code>. Zostaw puste, żeby użyć nazwy wykrytej automatycznie.</p>
        <div class="frow"><label class="fl">Token <input id="jTok" class="inp mono" type="password" value="${esc(c.token)}" placeholder="github_pat_…" spellcheck="false" autocomplete="off" autocapitalize="off"></label></div>
        <div class="frow"><label class="chk"><input type="checkbox" id="jAuto"${c.auto ? ' checked' : ''}> wysyłaj automatycznie</label>
          <button class="btn small primary" id="jSave" type="button">Zapisz i sprawdź</button><button class="btn small ghost" id="jForget" type="button">Usuń klucz</button></div>
        <p class="tstatus" id="jGhSt"></p></details>`;
    $('#jDev').oninput = e => { api.store.set('devName', e.target.value.trim()); $('#jDevNote').querySelector('code').textContent = devSlug(devName()) + '/'; };
    $('#jSave').onclick = () => { api.store.set('ghRepo', $('#jRepo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '')); api.store.set('ghToken', $('#jTok').value.trim()); api.store.set('ghAuto', $('#jAuto').checked ? '1' : '0'); testGh(); };
    $('#jForget').onclick = () => { api.store.set('ghToken', ''); $('#jTok').value = ''; $('#jGhSt').textContent = 'Klucz usunięty z tej przeglądarki.'; render(); };
    $('#jAuto').onchange = e => { api.store.set('ghAuto', e.target.checked ? '1' : '0'); };
    $('#jSend').onclick = () => sync(true);
    $('#jClean').onclick = async () => { for (const e of await all()) if (e.synced) await del(e.id); render(); };
    host.addEventListener('click', async ev => {
      const b = ev.target.closest('button'); if (!b) return;
      const id = b.dataset.jc || b.dataset.jd || b.dataset.jx; if (!id) return;
      const e = (await all()).find(x => x.id === id); if (!e) return;
      if (b.dataset.jc) api.copyText(e.text, b);
      if (b.dataset.jd) api.download(`${e.session}-${(e.file || e.path || e.id).split('/').pop()}.${e.ext}`, e.text, e.ext === 'csv' ? 'text/csv' : 'text/plain');
      if (b.dataset.jx) { await del(e.id); render(); }
    });
  }

  /* ---------- rejestr jazdy (automatyczny) ---------- */
  const reg = { id: null, keys: [], rows: [], t0: 0, last: 0, saved: 0 };
  function regStart() { Object.assign(reg, { id: null, keys: [], rows: [], t0: Date.now(), last: 0, saved: Date.now() }); }
  function regTick(vals, CAT, fresh) {
    if (!reg.t0) return;
    const now = Date.now(); if (now - reg.last < 1000) return; reg.last = now;
    const row = { t: (now - reg.t0) / 1000 };
    /* Tylko świeże odczyty: wartość, której w tym cyklu nie czytano, zostaje pusta, zamiast powtarzać starą. */
    for (const k in vals) if (CAT[k] && !CAT[k].text && isFinite(vals[k]) && (!fresh || fresh(k))) { row[k] = vals[k]; if (!reg.keys.includes(k)) reg.keys.push(k); }
    reg.rows.push(row); if (reg.rows.length > 4 * 3600) reg.rows.shift();
    if (now - reg.saved > 5 * 60000) regSave(CAT, true);
  }
  function regSave(CAT, quiet) {
    if (reg.rows.length < 10) return;
    reg.saved = Date.now();
    if (!reg.id) reg.id = `${reg.t0}-rejestr`;
    const head = ['czas [s]', ...reg.keys.map(k => `${CAT[k].name}${CAT[k].unit ? ' [' + CAT[k].unit + ']' : ''}`)].join(';');
    const lines = reg.rows.map(r => [r.t.toFixed(1).replace('.', ','), ...reg.keys.map(k => r[k] == null ? '' : String(+r[k].toFixed(3)).replace('.', ','))].join(';'));
    add('rejestr', `Rejestr jazdy, ${Math.round(reg.rows[reg.rows.length - 1].t / 60)} min`, [head, ...lines].join('\r\n'), { id: reg.id, ext: 'csv', quiet });
  }
  function regStop(CAT) { regSave(CAT, false); reg.t0 = 0; }

  render();
  return { add, startSession, render, sync, regStart, regTick, regSave, regStop, KINDS, devName };
}
