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
  const H = { on: false, peer: null, code: '', t: null, ctrl: null, pending: [], stats: { tx: 0, rx: 0, cmds: 0, last: '' }, wake: null };
  async function host(transport) {
    await peerLib();
    H.on = true; H.t = transport; H.ctrl = null; H.pending = []; H.stats = { tx: 0, rx: 0, cmds: 0, last: '' };
    transport.onData(s => { if (H.ctrl && H.ctrl.open) { H.ctrl.send({ d: s }); H.stats.rx += s.length; } });
    try { H.wake = navigator.wakeLock ? await navigator.wakeLock.request('screen') : null; } catch (e) {}
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
    if (typeof m.w === 'string') {
      H.stats.tx += m.w.length; const c = m.w.trim(); if (c) { H.stats.cmds++; H.stats.last = c; }
      H.t.write(m.w).catch(e => api.logLine('! most: zapis do adaptera: ' + e.message));
      if (H.stats.cmds % 20 === 0) renderStats();
    }
  }
  function approve(i) {
    const p = H.pending[i]; if (!p) return;
    H.pending.splice(i, 1);
    if (H.ctrl && H.ctrl !== p.conn) { try { H.ctrl.send({ kicked: 1 }); H.ctrl.close(); } catch (e) {} }
    H.ctrl = p.conn; H.ctrl.who = p.who;
    p.conn.send({ ok: 1, host: api.devName(), adapter: H.t.name });
    api.logLine(`— most: steruje ${p.who}`);
    renderHost();
  }
  function reject(i) { const p = H.pending[i]; if (!p) return; H.pending.splice(i, 1); try { p.conn.send({ denied: 1 }); setTimeout(() => p.conn.close(), 300); } catch (e) {} renderHost(); }
  function stopHost() {
    if (!H.on) return;
    H.on = false;
    try { H.ctrl && H.ctrl.send({ lost: 1 }); } catch (e) {}
    try { H.peer && H.peer.destroy(); } catch (e) {}
    try { H.wake && H.wake.release(); } catch (e) {}
    H.peer = null; H.ctrl = null; H.pending = []; H.wake = null;
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
        <div class="actions"><button class="btn small danger" type="button" id="bhStop">Wyłącz most</button></div></div>`;
      $('#bhCopy').onclick = e => api.copyText(link, e.currentTarget);
      $('#bhNew').onclick = async () => { api.store.set('bridgeCode', newCode()); const t = H.t; stopHost(); await host(t).catch(e => api.banner(e.message, 'error')); };
      $('#bhStop').onclick = () => api.stopBridgeHost();
      qrSvg(link).then(svg => { const q = $('#bhQr'); if (q) q.innerHTML = svg; });
    }
    $('#bhAd').textContent = H.t ? H.t.name : '';
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
  async function openRemote(codeIn) {
    const code = normCode(codeIn);
    if (code.length < 4) throw new Error('Wpisz kod mostu z urządzenia przy aucie.');
    await peerLib();
    api.banner('Łączę z mostem… Na urządzeniu przy aucie naciśnij „Zezwól”.', 'info');
    const peer = await new Promise((res, rej) => {
      const p = new window.Peer({ debug: 1 });
      p.on('open', () => res(p)); p.on('error', e => rej(new Error(peerErr(e))));
    });
    let cb = null, closed = false, hostName = 'most';
    const conn = await new Promise((res, rej) => {
      const c = peer.connect(PREFIX + code, { reliable: true, metadata: { name: api.devName() } });
      const to = setTimeout(() => { rej(new Error('Most nie odpowiedział w ciągu minuty. Czy ktoś nacisnął „Zezwól” na urządzeniu przy aucie?')); try { peer.destroy(); } catch (e) {} }, 60000);
      peer.on('error', e => { clearTimeout(to); rej(new Error(peerErr(e))); });
      c.on('data', m => {
        if (!m) return;
        if (m.ok) { clearTimeout(to); hostName = m.host || hostName; res(c); return; }
        if (m.denied) { clearTimeout(to); rej(new Error('Urządzenie przy aucie odrzuciło połączenie.')); try { peer.destroy(); } catch (e) {} return; }
        if (typeof m.d === 'string') { cb && cb(m.d); return; }
        if (m.lost || m.kicked) { if (!closed) { closed = true; api.remoteLost(m.kicked ? 'Inne urządzenie przejęło sterowanie mostem.' : 'Most stracił połączenie z adapterem.'); } }
      });
      c.on('close', () => { if (!closed) { closed = true; api.remoteLost('Połączenie z mostem zostało przerwane.'); } });
    });
    api.store.set('lastBridge', code);
    return {
      name: `Most · ${hostName}`,
      onData(f) { cb = f; },
      async write(s) { if (!conn.open) throw new Error('Most rozłączony'); conn.send({ w: s }); },
      close() { closed = true; try { conn.close(); } catch (e) {} try { peer.destroy(); } catch (e) {} }
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
