/* ===== Most: urządzenie przy aucie przekazuje strumień adaptera, inne urządzenie steruje pełną aplikacją (WebRTC przez PeerJS) ===== */
function createBridge(api) {
  const $ = s => document.querySelector(s);
  const { esc } = api;
  const LIBS = {
    peer: 'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js',
    peerAlt: 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
    qr: 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
    qrAlt: 'https://unpkg.com/qrcode-generator@1.4.4/qrcode.js'
  };
  const PREFIX = 'vagdiag-most-';
  const ALPH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const loaded = {};
  function load(url) {
    if (loaded[url]) return loaded[url];
    return (loaded[url] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = url; s.async = true; s.onload = res; s.onerror = () => { delete loaded[url]; rej(new Error('Nie udało się pobrać biblioteki połączeń. Sprawdź internet.')); }; document.head.appendChild(s); }));
  }
  async function peerLib() { if (window.Peer) return; try { await load(LIBS.peer); } catch (e) { await load(LIBS.peerAlt); } if (!window.Peer) throw new Error('Biblioteka połączeń niedostępna.'); }
  const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => ALPH[b % ALPH.length]).join('');
  const normCode = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const linkFor = code => `${location.origin}${location.pathname}?most=${code}`;
  function peerErr(e) {
    const t = e && e.type;
    if (t === 'peer-unavailable') return 'Nie ma mostu o tym kodzie. Sprawdź kod i czy urządzenie przy aucie ma włączony most.';
    if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return 'Brak połączenia z serwerem pośredniczącym. Sprawdź internet na obu urządzeniach.';
    if (t === 'browser-incompatible') return 'Ta przeglądarka nie obsługuje połączeń WebRTC.';
    return (e && e.message) || String(e);
  }

  /* ================= MOST (urządzenie przy aucie) ================= */
  const H = { on: false, peer: null, code: '', t: null, ctrl: null, pending: [], stats: { tx: 0, rx: 0, cmds: 0, last: '' }, wake: null, cap: null, keys: new Map(), busy: Promise.resolve() };
  /* Ekran urządzenia przy aucie nie może zgasnąć: Android po wygaszeniu usypia Bluetooth i połączenie WebRTC.
     Blokada wygaszania znika, gdy strona schodzi w tło, więc odnawiamy ją po każdym powrocie. */
  async function keepAwake() { try { if (H.on && navigator.wakeLock && !document.hidden) H.wake = await navigator.wakeLock.request('screen'); } catch (e) {} }
  document.addEventListener('visibilitychange', () => {
    if (!H.on) return;
    if (document.hidden) api.logLine('! most: strona zeszła w tło. Nie wygaszaj ekranu i nie przełączaj aplikacji na urządzeniu przy aucie.');
    else keepAwake();
  });
  async function host(transport) {
    await peerLib();
    H.on = true; H.t = transport; H.ctrl = null; H.pending = []; H.stats = { tx: 0, rx: 0, cmds: 0, last: '' }; H.cap = null;
    /* Dane z adaptera: w czasie wysyłki zbiorczej zbieramy je tutaj, w pozostałym czasie idą od razu do sterującego. */
    transport.onData(s => { if (H.cap != null) { H.cap += s; return; } if (H.ctrl && H.ctrl.open) { H.ctrl.send({ d: s }); H.stats.rx += s.length; } });
    await keepAwake();
    let code = api.store.get('bridgeCode', '') || newCode();
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await openPeer(code); break; }
      catch (e) { if (e.type === 'unavailable-id') { code = newCode(); continue; } stopHost(); throw new Error(peerErr(e)); }
    }
    api.store.set('bridgeCode', code); H.code = code;
    renderHost();
    return code;
  }
  function openPeer(code) {
    return new Promise((res, rej) => {
      const p = new window.Peer(PREFIX + code, { debug: 1 });
      let opened = false;
      p.on('open', () => { opened = true; H.peer = p; res(); });
      p.on('error', e => { if (!opened) { try { p.destroy(); } catch (x) {} rej(e); } else { api.logLine('! most: ' + peerErr(e)); renderHost(peerErr(e)); } });
      p.on('disconnected', () => { if (H.on && !p.destroyed) setTimeout(() => { try { p.reconnect(); } catch (e) {} }, 1500); });
      p.on('connection', conn => {
        conn.on('open', () => {
          const who = (conn.metadata && conn.metadata.name) || 'urządzenie';
          /* Urządzenie, które już raz zostało zatwierdzone, wraca po zerwaniu połączenia bez ponownego pytania. */
          const key = conn.metadata && conn.metadata.key;
          if (key && H.keys.get(key) === who) { H.pending.push({ conn, who, key }); approve(H.pending.length - 1, true); return; }
          H.pending.push({ conn, who }); renderHost();
          api.logLine(`— most: ${who} prosi o sterowanie`);
          try { navigator.vibrate && navigator.vibrate(200); } catch (e) {}
        });
        conn.on('data', m => onCtrlData(conn, m));
        conn.on('close', () => {
          H.pending = H.pending.filter(x => x.conn !== conn);
          if (H.ctrl === conn) { H.ctrl = null; api.logLine('— most: sterujące urządzenie rozłączone'); }
          renderHost();
        });
      });
    });
  }
  function onCtrlData(conn, m) {
    if (conn !== H.ctrl || !m) return;
    if (m.ping) { try { conn.send({ pong: m.ping }); } catch (e) {} return; }
    if (m.b != null && Array.isArray(m.cmds)) { H.busy = H.busy.then(() => runBatch(conn, m)); return; }
    if (typeof m.w === 'string') {
      H.stats.tx += m.w.length; const c = m.w.trim(); if (c) { H.stats.cmds++; H.stats.last = c; }
      H.t.write(m.w).catch(e => api.logLine('! most: zapis do adaptera: ' + e.message));
      if (H.stats.cmds % 20 === 0) renderStats();
    }
  }
  /* Wysyłka zbiorcza: polecenia wykonywane tutaj, przy adapterze, po kolei; odpowiedzi wracają w jednej wiadomości. */
  async function runBatch(conn, m) {
    const outs = [], to = Math.min(Math.max(+m.to || 4000, 500), 30000);
    for (const c of m.cmds.slice(0, 40)) {
      if (!H.on || conn !== H.ctrl) break;
      H.cap = '';
      try { await H.t.write(String(c) + '\r'); } catch (e) { outs.push(''); break; }
      const t0 = Date.now();
      while (!H.cap.includes('>') && Date.now() - t0 < to) await new Promise(r => setTimeout(r, 4));
      outs.push(H.cap); H.stats.cmds++; H.stats.last = String(c);
    }
    H.cap = null;
    try { conn.send({ b: m.b, out: outs }); } catch (e) {}
    if (H.stats.cmds % 20 < m.cmds.length) renderStats();
  }
  function approve(i, again) {
    const p = H.pending[i]; if (!p) return;
    H.pending.splice(i, 1);
    if (H.ctrl && H.ctrl !== p.conn) { try { H.ctrl.send({ kicked: 1 }); H.ctrl.close(); } catch (e) {} }
    H.ctrl = p.conn; H.ctrl.who = p.who;
    const key = p.key || Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
    H.keys.set(key, p.who);
    p.conn.send({ ok: 1, host: api.devName(), adapter: H.t.name, key });
    api.logLine(again ? `— most: ${p.who} wróciło po przerwie` : `— most: steruje ${p.who}`);
    renderHost();
  }
  function reject(i) { const p = H.pending[i]; if (!p) return; H.pending.splice(i, 1); try { p.conn.send({ denied: 1 }); setTimeout(() => p.conn.close(), 300); } catch (e) {} renderHost(); }
  function stopHost() {
    if (!H.on) return;
    H.on = false;
    try { H.ctrl && H.ctrl.send({ lost: 1 }); } catch (e) {}
    try { H.peer && H.peer.destroy(); } catch (e) {}
    try { H.wake && H.wake.release(); } catch (e) {}
    H.peer = null; H.ctrl = null; H.pending = []; H.wake = null; H.cap = null; H.keys = new Map();
    renderHost();
  }
  function adapterLost() { try { H.ctrl && H.ctrl.send({ lost: 1 }); } catch (e) {} }
  let qrUrl = null;
  async function qrSvg(text) {
    try { if (!window.qrcode) { try { await load(LIBS.qr); } catch (e) { await load(LIBS.qrAlt); } } const q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) { return ''; }
  }
  async function renderHost(err) {
    const box = $('#bridgeHost'); if (!box) return;
    box.hidden = !H.on; if (!H.on) { box.innerHTML = ''; return; }
    const link = linkFor(H.code);
    if (!box.dataset.code || box.dataset.code !== H.code) {
      box.dataset.code = H.code;
      box.innerHTML = `<div class="card bridge">
        <div class="card-h"><h3>Most do auta</h3><span class="n" id="bhAd"></span></div>
        <p class="small muted">To urządzenie przekazuje komunikację z adaptera. Na drugim urządzeniu (także iPhone lub iPad, w zwykłym Safari) otwórz aplikację, naciśnij <b>Inne urządzenie</b> i wpisz kod albo zeskanuj QR. Nie wyłączaj ekranu tego urządzenia.</p>
        <div class="bwrap"><div class="bqr" id="bhQr"></div>
          <div class="bcode"><span class="muted small">Kod mostu</span><b>${esc(H.code.slice(0, 3) + ' ' + H.code.slice(3))}</b>
            <div class="actions"><button class="btn small" type="button" id="bhCopy">Kopiuj link</button><button class="btn small ghost" type="button" id="bhNew">Nowy kod</button></div></div></div>
        <div id="bhReq"></div>
        <p class="tstatus" id="bhSt"></p>
        <div class="actions"><button class="btn small danger" type="button" id="bhStop">Wyłącz most</button><button class="btn small ghost" type="button" id="bhGh" hidden>Przekaż ustawienia logów GitHub</button></div></div>`;
      $('#bhCopy').onclick = e => api.copyText(link, e.currentTarget);
      $('#bhNew').onclick = async () => { api.store.set('bridgeCode', newCode()); const t = H.t; stopHost(); await host(t).catch(e => api.banner(e.message, 'error')); };
      $('#bhStop').onclick = () => api.stopBridgeHost();
      $('#bhGh').onclick = e => {
        const repo = api.store.get('ghRepo', ''), token = api.store.get('ghToken', '');
        if (!H.ctrl || !token) return;
        try { H.ctrl.send({ gh: { repo, token } }); e.currentTarget.textContent = 'Wysłano'; api.logLine('— most: przekazano ustawienia logów GitHub'); } catch (x) {}
      };
      qrSvg(link).then(svg => { const q = $('#bhQr'); if (q) q.innerHTML = svg; });
    }
    $('#bhAd').textContent = H.t ? H.t.name : '';
    $('#bhGh').hidden = !(H.ctrl && api.store.get('ghToken', ''));
    $('#bhReq').innerHTML = H.pending.map((p, i) => `<div class="confirm ok"><span><b>${esc(p.who)}</b> chce sterować diagnostyką przez ten most.${H.ctrl ? ' Obecne sterowanie zostanie przejęte.' : ''}</span>
      <div><button class="btn small primary" type="button" data-ok="${i}">Zezwól</button><button class="btn small" type="button" data-no="${i}">Odrzuć</button></div></div>`).join('');
    $('#bhReq').querySelectorAll('[data-ok]').forEach(b => { b.onclick = () => approve(+b.dataset.ok); });
    $('#bhReq').querySelectorAll('[data-no]').forEach(b => { b.onclick = () => reject(+b.dataset.no); });
    renderStats(err);
  }
  function renderStats(err) {
    const st = $('#bhSt'); if (!st) return;
    st.textContent = err ? err : H.ctrl ? `Steruje: ${H.ctrl.who}. Poleceń: ${H.stats.cmds}, ostatnie: ${H.stats.last}` : H.pending.length ? 'Czekam na Twoją decyzję.' : 'Czekam na połączenie z drugiego urządzenia…';
    api.chip(H.ctrl ? `Most · steruje ${H.ctrl.who}` : `Most · kod ${H.code}`, H.ctrl ? 'on' : 'busy');
  }

  /* ================= STEROWANIE (zdalne urządzenie) ================= */
  /* Połączenie z mostem z automatycznym powrotem: co 4 s sprawdzamy, czy most żyje; gdy połączenie padnie, próbujemy
     wrócić przez ok. 40 s kluczem z pierwszego zatwierdzenia, więc na urządzeniu przy aucie nie trzeba znów klikać „Zezwól”.
     Polecenia wysłane w tym czasie czekają. */
  async function openRemote(codeIn) {
    const code = normCode(codeIn);
    if (code.length < 4) throw new Error('Wpisz kod mostu z urządzenia przy aucie.');
    await peerLib();
    api.banner('Łączę z mostem… Na urządzeniu przy aucie naciśnij „Zezwól”.', 'info');
    const R = { peer: null, conn: null, cb: null, closed: false, hostName: 'most', key: null, last: Date.now(), seq: 0, wait: {}, ready: null, readyRes: null, hb: null, retrying: false };
    const newPeer = () => new Promise((res, rej) => {
      const p = new window.Peer({ debug: 1 });
      p.on('open', () => res(p)); p.on('error', e => rej(new Error(peerErr(e))));
      p.on('disconnected', () => { if (!R.closed && !p.destroyed) setTimeout(() => { try { p.reconnect(); } catch (e) {} }, 1000); });
    });
    const connect = (firstTime) => new Promise((res, rej) => {
      const c = R.peer.connect(PREFIX + code, { reliable: true, metadata: { name: api.devName(), key: R.key } });
      const to = setTimeout(() => { rej(new Error(firstTime ? 'Most nie odpowiedział w ciągu minuty. Czy ktoś nacisnął „Zezwól” na urządzeniu przy aucie?' : 'most nie odpowiada')); try { c.close(); } catch (e) {} }, firstTime ? 60000 : 8000);
      const onErr = e => { clearTimeout(to); rej(new Error(peerErr(e))); };
      R.peer.once ? R.peer.once('error', onErr) : R.peer.on('error', onErr);
      c.on('data', m => {
        if (!m) return;
        R.last = Date.now();
        if (m.ok) { clearTimeout(to); R.hostName = m.host || R.hostName; if (m.key) R.key = m.key; res(c); return; }
        if (m.denied) { clearTimeout(to); rej(new Error('Urządzenie przy aucie odrzuciło połączenie.')); return; }
        if (typeof m.d === 'string') { R.cb && R.cb(m.d); return; }
        if (m.b != null) { const w = R.wait[m.b]; if (w) { delete R.wait[m.b]; w.res(m.out || []); } return; }
        if (m.gh && m.gh.token) { api.store.set('ghToken', m.gh.token); if (m.gh.repo) api.store.set('ghRepo', m.gh.repo); api.banner('Ustawienia wysyłania logów na GitHub przyszły z mostu. Logi z tego urządzenia będą wysyłane automatycznie.', 'info'); api.ghChanged && api.ghChanged(); return; }
        if (m.pong) return;
        if (m.lost || m.kicked) { finish(m.kicked ? 'Inne urządzenie przejęło sterowanie mostem.' : 'Most stracił połączenie z adapterem.'); }
      });
      c.on('close', () => { if (c === R.conn) dropped(); });
    });
    const finish = msg => {
      if (R.closed) return; R.closed = true; clearInterval(R.hb);
      for (const k in R.wait) { R.wait[k].rej(new Error('Most rozłączony')); delete R.wait[k]; }
      try { R.conn && R.conn.close(); } catch (e) {} try { R.peer && R.peer.destroy(); } catch (e) {}
      api.remoteLost(msg);
    };
    async function dropped() {
      if (R.closed || R.retrying) return;
      R.retrying = true; R.conn = null;
      R.ready = new Promise(r => { R.readyRes = r; });
      api.chip('Most · łączę ponownie…', 'busy'); api.logLine('! most: połączenie przerwane, łączę ponownie…');
      const t0 = Date.now();
      while (!R.closed && Date.now() - t0 < 40000) {
        try {
          if (!R.peer || R.peer.destroyed) R.peer = await newPeer();
          else if (R.peer.disconnected) { try { R.peer.reconnect(); } catch (e) {} await new Promise(r => setTimeout(r, 1500)); }
          R.conn = await connect(false);
          R.retrying = false; R.last = Date.now(); api.chip(`Most · ${R.hostName}`, 'on'); api.logLine('— most: połączenie przywrócone');
          const r = R.readyRes; R.ready = null; R.readyRes = null; r && r(true);
          return;
        } catch (e) { await new Promise(r => setTimeout(r, 2500)); }
      }
      R.retrying = false; const r = R.readyRes; R.ready = null; R.readyRes = null; r && r(false);
      finish('Połączenie z mostem zostało przerwane i nie udało się go przywrócić. Sprawdź, czy ekran urządzenia przy aucie jest włączony, a strona otwarta.');
    }
    R.peer = await newPeer();
    R.conn = await connect(true);
    api.store.set('lastBridge', code);
    /* Sygnał życia: gdy przez 12 s nic nie przyjdzie, uznajemy połączenie za zerwane (WebRTC czasem nie zgłasza zamknięcia). */
    R.hb = setInterval(() => {
      if (R.closed || R.retrying || !R.conn) return;
      if (Date.now() - R.last > 12000) { try { R.conn.close(); } catch (e) {} dropped(); return; }
      try { R.conn.send({ ping: Date.now() }); } catch (e) {}
    }, 4000);
    const ensure = async () => {
      if (R.closed) throw new Error('Most rozłączony');
      if (R.conn && R.conn.open && !R.retrying) return;
      if (!R.ready) dropped();
      if (!(await R.ready)) throw new Error('Most rozłączony');
    };
    return {
      name: `Most · ${R.hostName}`,
      onData(f) { R.cb = f; },
      async write(s) { await ensure(); R.conn.send({ w: s }); },
      async batch(cmds, timeout) {
        await ensure();
        const id = ++R.seq;
        return new Promise((res, rej) => {
          const tm = setTimeout(() => { delete R.wait[id]; rej(new Error('most nie odpowiedział')); }, cmds.length * (timeout || 4000) + 8000);
          R.wait[id] = { res: v => { clearTimeout(tm); res(v); }, rej: e => { clearTimeout(tm); rej(e); } };
          R.conn.send({ b: id, cmds, to: timeout || 4000 });
        });
      },
      close() { R.closed = true; clearInterval(R.hb); try { R.conn && R.conn.close(); } catch (e) {} try { R.peer && R.peer.destroy(); } catch (e) {} }
    };
  }

  /* ================= okno wyboru ================= */
  function dialog() {
    let d = $('#bridgeDlg');
    if (!d) {
      d = document.createElement('dialog'); d.id = 'bridgeDlg'; d.className = 'dlg'; document.body.appendChild(d);
    }
    const last = api.store.get('lastBridge', '');
    d.innerHTML = `<form method="dialog" class="dlgin">
      <h3 class="ptitle">Inne urządzenie</h3>
      <div class="card"><h4 class="sub">Steruj z tego urządzenia</h4>
        <p class="small muted">Adapter jest podłączony do innego telefonu lub komputera, na którym włączony jest most. Działa też na iPhonie i iPadzie w zwykłym Safari.</p>
        <div class="frow"><input id="bdCode" class="inp mono grow" placeholder="kod, np. ABC 123" value="${esc(last)}" autocomplete="off" autocapitalize="characters" spellcheck="false"><button class="btn small primary" type="button" id="bdJoin">Połącz</button></div></div>
      <div class="card"><h4 class="sub">To urządzenie jest przy aucie</h4>
        <p class="small muted">Połącz adapter i udostępnij go innym urządzeniom. Na tym urządzeniu aplikacja tylko przekazuje dane.</p>
        <div class="actions"><button class="btn small" type="button" id="bdBle">Most przez Bluetooth</button>${navigator.serial ? '<button class="btn small" type="button" id="bdCom">Most przez Port COM</button>' : ''}</div></div>
      <p class="small muted">Połączenie jest bezpośrednie (WebRTC). Do zestawienia używany jest publiczny serwer PeerJS, a dane z auta idą prosto między urządzeniami. Najpewniej działa, gdy oba są w tej samej sieci Wi-Fi albo jedno udostępnia hotspot.</p>
      <div class="actions end"><button class="btn small ghost" value="cancel">Zamknij</button></div></form>`;
    $('#bdJoin').onclick = () => { const c = $('#bdCode').value; d.close(); api.connectRemote(c); };
    $('#bdCode').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#bdJoin').click(); } };
    $('#bdBle').onclick = () => { d.close(); api.startBridgeHost('ble'); };
    if ($('#bdCom')) $('#bdCom').onclick = () => { d.close(); api.startBridgeHost('serial'); };
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }

  return { host, stopHost, adapterLost, openRemote, dialog, active: () => H.on, normCode };
}
