/* ===== VAG Diagnostyka – rdzeń: ELM327 / OBD-II / UDS / symulator ===== */
'use strict';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hex2 = n => (Math.round(n) & 0xFF).toString(16).toUpperCase().padStart(2, '0');
const hex3 = n => n.toString(16).toUpperCase().padStart(3, '0');
const bytesOf = h => { const a = []; for (let i = 0; i + 1 < h.length; i += 2) a.push(parseInt(h.substr(i, 2), 16)); return a; };
const u16 = (a, b) => a * 256 + b;
const asciiOf = arr => arr.map(c => (c >= 32 && c < 127) ? String.fromCharCode(c) : '').join('').trim();
const asciiOrHex = arr => {
  const txt = arr.map(c => c === 0 ? '' : String.fromCharCode(c)).join('').trim();
  return (txt.length && /^[\x20-\x7E]+$/.test(txt)) ? txt : arr.map(hex2).join(' ');
};
const lvl = (v, w, c) => v >= c ? 'crit' : v >= w ? 'warn' : 'ok';
const lvlAbs = (v, w, c) => lvl(Math.abs(v), w, c);
const fmtDur = v => `${Math.floor(v / 60)} min ${Math.round(v % 60)} s`;

function voltCheck(v, s) {
  const running = (s.rpm || 0) > 400;
  if (running) { if (v < 12.6) return 'crit'; if (v < 13.2 || v > 15.0) return 'warn'; return 'ok'; }
  if (v < 11.9) return 'crit'; if (v < 12.3) return 'warn'; return 'ok';
}

const NRC = {
  '10': 'odmowa ogólna', '11': 'usługa nieobsługiwana', '12': 'podfunkcja nieobsługiwana',
  '13': 'zła długość lub format', '14': 'odpowiedź za długa', '22': 'warunki niespełnione',
  '24': 'zła kolejność żądań', '31': 'parametr poza zakresem', '33': 'dostęp zablokowany',
  '35': 'zły klucz dostępu', '72': 'błąd programowania', '78': 'odpowiedź w toku',
  '7E': 'podfunkcja nieobsługiwana w tej sesji', '7F': 'usługa nieobsługiwana w tej sesji'
};

const FUELSYS = {
  1: 'Pętla otwarta – zimny silnik', 2: 'Pętla zamknięta (sonda lambda)',
  4: 'Pętla otwarta – obciążenie lub odcięcie', 8: 'Pętla otwarta – usterka',
  16: 'Pętla zamknięta – usterka sondy'
};

/* Moduły VAG (UDS po CAN). Odpowiedź = żądanie + 0x6A (silnik/skrzynia: +8). */
const MODULES = [
  { addr: '01', name: 'Elektronika silnika', tx: 0x7E0, rx: 0x7E8 },
  { addr: '02', name: 'Skrzynia biegów', tx: 0x7E1, rx: 0x7E9 },
  { addr: '03', name: 'ABS / ESP', tx: 0x713, rx: 0x77D },
  { addr: '08', name: 'Klimatyzacja', tx: 0x746, rx: 0x7B0 },
  { addr: '09', name: 'Elektronika centralna', tx: 0x70E, rx: 0x778 },
  { addr: '15', name: 'Poduszki powietrzne', tx: 0x715, rx: 0x77F },
  { addr: '16', name: 'Kolumna kierownicy', tx: 0x70C, rx: 0x776 },
  { addr: '17', name: 'Zestaw wskaźników', tx: 0x714, rx: 0x77E },
  { addr: '19', name: 'Gateway', tx: 0x710, rx: 0x77A },
  { addr: '44', name: 'Wspomaganie kierownicy', tx: 0x712, rx: 0x77C },
  { addr: '5F', name: 'Elektronika informacyjna (radio, MIB)', tx: 0x773, rx: 0x7DD }
];
/* BMW (D-CAN, adresowanie rozszerzone: tester 0x6F1, odpowiedź 0x600 + adres). Seria F/G – UDS, seria E od ok. 2007 – KWP2000. */
const BMW_MODULES = [
  { addr: '12', name: 'DME/DDE – silnik', bmw: 0x12 },
  { addr: '13', name: 'DME2 – drugi sterownik silnika', bmw: 0x13 },
  { addr: '18', name: 'EGS – skrzynia biegów', bmw: 0x18 },
  { addr: '29', name: 'DSC – ABS / stabilizacja', bmw: 0x29 },
  { addr: '30', name: 'EPS – wspomaganie kierownicy', bmw: 0x30 },
  { addr: '01', name: 'ACSM – poduszki powietrzne', bmw: 0x01 },
  { addr: '40', name: 'CAS / FEM / BDC – nadwozie, immobilizer', bmw: 0x40 },
  { addr: '00', name: 'JBE – moduł centralny (seria E)', bmw: 0x00 },
  { addr: '10', name: 'ZGW – gateway', bmw: 0x10 },
  { addr: '1C', name: 'ICM – podwozie', bmw: 0x1C },
  { addr: '60', name: 'KOMBI – zestaw wskaźników', bmw: 0x60 },
  { addr: '63', name: 'HU / CIC / NBT – radio i nawigacja', bmw: 0x63 },
  { addr: '72', name: 'FRM / REM – światła, elektronika tyłu', bmw: 0x72 },
  { addr: '78', name: 'IHKA – klimatyzacja', bmw: 0x78 },
  { addr: '56', name: 'FZD – moduł dachu', bmw: 0x56 },
  { addr: '5D', name: 'KAFAS – kamera asystentów', bmw: 0x5D }
];
const BMW_IDENT_DIDS = [['F190', 'VIN'], ['F187', 'Nr części'], ['F189', 'Oprogramowanie'], ['F191', 'Nr części HW'], ['F18C', 'Nr seryjny'], ['F150', 'Wersja HW']];
const BRAND_WMI = {
  bmw: ['WBA', 'WBS', 'WBY', 'WBX', 'WB1', 'WB3', 'WB4', 'WB5', 'WMW', '4US', '5UX', '5UM', '5YM', 'X4X', 'LBV', 'WBW'],
  vag: ['WVW', 'WV1', 'WV2', 'WV3', 'WVG', 'WAU', 'WUA', 'WA1', 'TRU', 'VSS', 'VS6', 'TMB', 'TMP', 'VWV', 'WP0', 'WP1', '3VW', '1VW', '9BW', 'AAV', 'LSV', 'LFV', 'XW8']
};
function brandOf(vin) {
  const w = (vin || '').slice(0, 3).toUpperCase();
  for (const [b, list] of Object.entries(BRAND_WMI)) if (list.includes(w)) return b;
  return null;
}
const IDENT_DIDS = [['F187', 'Nr części'], ['F197', 'System'], ['F189', 'Oprogramowanie'], ['F191', 'Nr części HW'], ['F18C', 'Nr seryjny'], ['F19E', 'Plik ODX'], ['0600', 'Kodowanie', 'hex']];
const hex4 = n => n.toString(16).toUpperCase().padStart(4, '0');

/* ---- OBD tryb 06: wyniki testów monitorów ---- */
const UAS = {
  0x01: [1, ''], 0x02: [0.1, ''], 0x03: [0.01, ''], 0x04: [0.001, ''], 0x05: [0.0000305, ''], 0x06: [0.000305, ''],
  0x07: [0.25, 'obr/min'], 0x08: [0.01, 'km/h'], 0x09: [1, 'km/h'], 0x0A: [0.122, 'mV'], 0x0B: [0.001, 'V'], 0x0C: [0.01, 'V'],
  0x0D: [0.00390625, 'mA'], 0x0E: [0.001, 'A'], 0x0F: [0.01, 'A'], 0x10: [1, 'ms'], 0x11: [100, 'ms'], 0x12: [1, 's'],
  0x13: [1, 'mΩ'], 0x14: [1, 'Ω'], 0x15: [1, 'kΩ'], 0x16: [0.1, '°C', -40], 0x17: [0.01, 'kPa'], 0x18: [0.0117, 'kPa'],
  0x19: [0.079, 'kPa'], 0x1A: [1, 'kPa'], 0x1B: [10, 'kPa'], 0x1C: [0.01, '°'], 0x1D: [0.5, '°'], 0x1E: [0.0000305, ''],
  0x1F: [0.05, 'AFR'], 0x20: [0.0039062, ''], 0x21: [1, 'mHz'], 0x22: [1, 'Hz'], 0x23: [1, 'kHz'], 0x24: [1, 'zliczeń'],
  0x25: [1, 'km'], 0x26: [0.1, 'mV/ms'], 0x27: [0.01, 'g/s'], 0x28: [1, 'g/s'], 0x29: [0.25, 'Pa/s'], 0x2A: [0.001, 'kg/h'],
  0x2B: [1, 'przełączeń'], 0x2C: [0.01, 'g/cyl'], 0x2D: [0.01, 'mg/skok'], 0x2E: [1, ''], 0x2F: [0.01, '%'], 0x30: [0.001526, '%'],
  0x31: [0.001, 'l'], 0x34: [1, 'min'], 0x35: [10, 'ms'], 0x36: [0.01, 'g'], 0x37: [0.1, 'g'], 0x38: [1, 'g'],
  0x3C: [0.1, 'µs'], 0x3D: [0.01, 'mA'], 0x3F: [0.01, 'l'], 0x40: [1, 'ppm'], 0x41: [0.01, 'µA'],
  0x81: [1, ''], 0x82: [0.1, ''], 0x83: [0.01, ''], 0x84: [0.001, ''], 0x85: [0.0000305, ''], 0x86: [0.000305, ''],
  0x8A: [0.122, 'mV'], 0x8B: [0.001, 'V'], 0x8C: [0.01, 'V'], 0x8D: [0.00390625, 'mA'], 0x8E: [0.001, 'A'], 0x90: [1, 'ms'],
  0x96: [0.1, '°C'], 0x99: [0.1, 'kPa'], 0x9C: [0.01, '°'], 0x9D: [0.5, '°'], 0xA8: [1, 'g/s'], 0xA9: [0.25, 'Pa/s'],
  0xAD: [0.01, 'mg/skok'], 0xAE: [0.1, 'mg/skok'], 0xAF: [0.01, '%'], 0xB0: [0.003052, '%'], 0xB1: [2, 'mV/s'],
  0xFC: [0.01, 'kPa'], 0xFD: [0.001, 'kPa'], 0xFE: [0.25, 'Pa']
};
function midName(m) {
  if (m >= 0x01 && m <= 0x10) { const i = m - 1; return `Sonda lambda – bank ${(i >> 2) + 1}, czujnik ${(i & 3) + 1}`; }
  if (m >= 0x41 && m <= 0x50) { const i = m - 0x41; return `Grzałka sondy lambda – bank ${(i >> 2) + 1}, czujnik ${(i & 3) + 1}`; }
  if (m >= 0xA2 && m <= 0xAD) return `Wypadanie zapłonów – cylinder ${m - 0xA1}`;
  return ({
    0x21: 'Katalizator – bank 1', 0x22: 'Katalizator – bank 2', 0x31: 'EGR – bank 1', 0x32: 'EGR – bank 2',
    0x35: 'Zmienne fazy rozrządu – bank 1', 0x36: 'Zmienne fazy rozrządu – bank 2',
    0x39: 'EVAP – wyciek 0,150″', 0x3A: 'EVAP – wyciek 0,090″', 0x3B: 'EVAP – wyciek 0,040″', 0x3C: 'EVAP – wyciek 0,020″', 0x3D: 'EVAP – przepływ przedmuchu',
    0x61: 'Podgrzewanie katalizatora – bank 1', 0x62: 'Podgrzewanie katalizatora – bank 2', 0x71: 'Powietrze wtórne 1', 0x72: 'Powietrze wtórne 2',
    0x81: 'Układ paliwowy – bank 1', 0x82: 'Układ paliwowy – bank 2', 0x85: 'Ciśnienie doładowania – bank 1', 0x86: 'Ciśnienie doładowania – bank 2',
    0x90: 'Czujnik NOx', 0xA1: 'Wypadanie zapłonów – ogólnie', 0xB0: 'Filtr cząstek stałych – bank 1', 0xB1: 'Filtr cząstek stałych – bank 2'
  })[m] || ('Monitor 0x' + hex2(m));
}
function tidName(mid, tid) {
  if (mid >= 0xA1 && mid <= 0xAD) { if (tid === 0x0B) return 'Średnia z ostatnich 10 cykli jazdy'; if (tid === 0x0C) return 'Bieżący lub ostatni cykl jazdy'; }
  if (mid >= 0x01 && mid <= 0x10) {
    const t = { 0x01: 'Próg napięcia bogata → uboga', 0x02: 'Próg napięcia uboga → bogata', 0x03: 'Niskie napięcie do pomiaru czasu przełączania', 0x04: 'Wysokie napięcie do pomiaru czasu przełączania',
      0x05: 'Czas przełączania bogata → uboga', 0x06: 'Czas przełączania uboga → bogata', 0x07: 'Minimalne napięcie w teście', 0x08: 'Maksymalne napięcie w teście', 0x09: 'Czas między przełączeniami', 0x0A: 'Okres sygnału sondy' }[tid];
    if (t) return t;
  }
  return (tid >= 0x80 ? 'Test producenta 0x' : 'Test 0x') + hex2(tid);
}
function scaleUas(uas, raw) {
  const s = UAS[uas]; const signed = uas >= 0x80;
  const v = signed && raw >= 0x8000 ? raw - 0x10000 : raw;
  if (!s) return { v, unit: 'surowe' };
  return { v: v * s[0] + (s[2] || 0), unit: s[1] };
}
function parseMode06(data) {
  const b = bytesOf(data); if (b[0] !== 0x46) return [];
  const out = [];
  for (let i = 1; i + 8 < b.length; i += 9) {
    const [mid, tid, uas] = [b[i], b[i + 1], b[i + 2]];
    const val = scaleUas(uas, u16(b[i + 3], b[i + 4])), lo = scaleUas(uas, u16(b[i + 5], b[i + 6])), hi = scaleUas(uas, u16(b[i + 7], b[i + 8]));
    out.push({ mid, tid, uas, value: val.v, min: lo.v, max: hi.v, unit: val.unit, pass: val.v >= lo.v && val.v <= hi.v, name: tidName(mid, tid) });
  }
  return out;
}

/* ---- Klasyfikacja poleceń w konsoli UDS ---- */
const SID_NAMES = {
  0x01: 'OBD: dane bieżące', 0x02: 'OBD: zamrożona ramka', 0x03: 'OBD: kody zapisane', 0x04: 'OBD: kasowanie kodów', 0x06: 'OBD: wyniki testów', 0x07: 'OBD: kody oczekujące', 0x09: 'OBD: informacje o pojeździe', 0x0A: 'OBD: kody stałe',
  0x10: 'Zmiana sesji', 0x11: 'Reset sterownika', 0x14: 'Kasowanie błędów', 0x19: 'Odczyt błędów', 0x22: 'Odczyt danych', 0x23: 'Odczyt pamięci',
  0x27: 'Dostęp zabezpieczony', 0x28: 'Sterowanie komunikacją', 0x2C: 'Definicja danych dynamicznych', 0x2E: 'Zapis danych (adaptacja, kodowanie)', 0x2F: 'Sterowanie wyjściem (test elementów)',
  0x31: 'Procedura (ustawienia podstawowe)', 0x34: 'Programowanie: pobieranie', 0x35: 'Programowanie: wysyłanie', 0x36: 'Programowanie: transfer', 0x37: 'Programowanie: koniec',
  0x3D: 'Zapis pamięci', 0x3E: 'Podtrzymanie sesji', 0x85: 'Sterowanie zapisem błędów'
};
function classifyCmd(hex) {
  const b = bytesOf(hex); const sid = b[0];
  if (sid == null) return { level: 'bad', why: 'Puste polecenie.' };
  if ([0x34, 0x35, 0x36, 0x37, 0x38, 0x3D].includes(sid) || (sid === 0x10 && b[1] === 0x02))
    return { level: 'block', why: 'Programowanie i zapis pamięci są zablokowane. Przerwane programowanie może trwale uszkodzić sterownik.' };
  if ([0x04, 0x11, 0x14, 0x27, 0x28, 0x2E, 0x2F, 0x31, 0x85].includes(sid) || (sid === 0x10 && b[1] !== 0x01 && b[1] !== 0x03))
    return { level: 'write', why: `${SID_NAMES[sid] || 'To polecenie'} zmienia stan sterownika albo uruchamia element wykonawczy.` };
  return { level: 'read', why: SID_NAMES[sid] || 'Polecenie' };
}

/* ---- Podsłuch: składanie ramek ISO-TP w wiadomości ---- */
function createIsoTp(onMsg) {
  const part = {};
  return line => {
    const l = line.replace(/\s/g, '').toUpperCase();
    if (!/^[0-9A-F]{5,}$/.test(l)) return false;
    const id = parseInt(l.slice(0, 3), 16); let d = bytesOf(l.slice(3)); if (!d.length) return false;
    let ea = null; if (id >= 0x600 && id <= 0x6FF) { ea = d[0]; d = d.slice(1); if (!d.length) return true; }   // BMW: adres w pierwszym bajcie
    const key = id + ':' + ea;
    const t = d[0] >> 4;
    if (t === 0) { const n = d[0] & 0xF; if (n) onMsg(id, d.slice(1, 1 + n), ea); }
    else if (t === 1) { part[key] = { len: ((d[0] & 0xF) << 8) | d[1], data: d.slice(2) }; }
    else if (t === 2 && part[key]) { const p = part[key]; p.data.push(...d.slice(1)); if (p.data.length >= p.len) { onMsg(id, p.data.slice(0, p.len), ea); delete part[key]; } }
    return true;
  };
}

/* Parametry OBD-II tryb 01. g = grupa w interfejsie. */
const PIDS = [
  // Silnik
  { pid: 0x0C, len: 2, g: 'silnik', f: b => [u16(b[0], b[1]) / 4], outs: [{ key: 'rpm', name: 'Obroty', unit: 'obr/min', d: 0, min: 0, max: 7000 }] },
  { pid: 0x0D, len: 1, g: 'silnik', f: b => [b[0]], outs: [{ key: 'speed', name: 'Prędkość', unit: 'km/h', d: 0, min: 0, max: 250 }] },
  { pid: 0x04, len: 1, g: 'silnik', f: b => [b[0] * 100 / 255], outs: [{ key: 'load', name: 'Obciążenie obliczone', unit: '%', d: 0, min: 0, max: 100 }] },
  { pid: 0x43, len: 2, g: 'silnik', f: b => [u16(b[0], b[1]) * 100 / 255], outs: [{ key: 'absload', name: 'Obciążenie bezwzględne', unit: '%', d: 0, min: 0, max: 200 }] },
  { pid: 0x11, len: 1, g: 'silnik', f: b => [b[0] * 100 / 255], outs: [{ key: 'tps', name: 'Przepustnica', unit: '%', d: 0, min: 0, max: 100 }] },
  { pid: 0x49, len: 1, g: 'silnik', f: b => [b[0] * 100 / 255], outs: [{ key: 'pedal', name: 'Pedał gazu', unit: '%', d: 0, min: 0, max: 100 }] },
  { pid: 0x0E, len: 1, g: 'silnik', f: b => [b[0] / 2 - 64], outs: [{ key: 'timing', name: 'Wyprzedzenie zapłonu', unit: '°', d: 1, min: -15, max: 45 }] },
  { pid: 0x61, len: 1, g: 'silnik', f: b => [b[0] - 125], outs: [{ key: 'tqDem', name: 'Moment żądany', unit: '%', d: 0, min: 0, max: 100 }] },
  { pid: 0x62, len: 1, g: 'silnik', f: b => [b[0] - 125], outs: [{ key: 'tqAct', name: 'Moment rzeczywisty', unit: '%', d: 0, min: 0, max: 100 }] },
  { pid: 0x5E, len: 2, g: 'silnik', f: b => [u16(b[0], b[1]) / 20], outs: [{ key: 'fuelRate', name: 'Chwilowe zużycie paliwa', unit: 'l/h', d: 1, min: 0, max: 40 }] },
  { pid: 0x2F, len: 1, g: 'silnik', slow: true, f: b => [b[0] * 100 / 255], outs: [{ key: 'fuelLvl', name: 'Poziom paliwa', unit: '%', d: 0, min: 0, max: 100 }] },
  { pid: 0x42, len: 2, g: 'silnik', f: b => [u16(b[0], b[1]) / 1000], outs: [{ key: 'ecuV', name: 'Napięcie sterownika', unit: 'V', d: 2, min: 10, max: 16, check: voltCheck }] },
  { pid: 0x1F, len: 2, g: 'silnik', slow: true, f: b => [u16(b[0], b[1])], outs: [{ key: 'runTime', name: 'Czas od uruchomienia', unit: '', d: 0, fmt: fmtDur, nospark: true }] },
  // Chłodzenie i temperatury
  { pid: 0x05, len: 1, g: 'chlodzenie', f: b => [b[0] - 40], outs: [{ key: 'coolant', name: 'Płyn chłodzący', unit: '°C', d: 0, min: -10, max: 130, check: v => lvl(v, 110, 118) }] },
  { pid: 0x5C, len: 1, g: 'chlodzenie', f: b => [b[0] - 40], outs: [{ key: 'oil', name: 'Olej silnikowy', unit: '°C', d: 0, min: -10, max: 150, check: v => lvl(v, 125, 140) }] },
  { pid: 0x0F, len: 1, g: 'chlodzenie', f: b => [b[0] - 40], outs: [{ key: 'iat', name: 'Powietrze dolotowe', unit: '°C', d: 0, min: -10, max: 90, check: v => lvl(v, 55, 70) }] },
  { pid: 0x46, len: 1, g: 'chlodzenie', slow: true, f: b => [b[0] - 40], outs: [{ key: 'ambient', name: 'Temperatura otoczenia', unit: '°C', d: 0, min: -20, max: 45 }] },
  { pid: 0x3C, len: 2, g: 'chlodzenie', f: b => [u16(b[0], b[1]) / 10 - 40], outs: [{ key: 'cat1', name: 'Katalizator, przed', unit: '°C', d: 0, min: 0, max: 1000, check: v => lvl(v, 850, 950) }] },
  { pid: 0x3E, len: 2, g: 'chlodzenie', f: b => [u16(b[0], b[1]) / 10 - 40], outs: [{ key: 'cat2', name: 'Katalizator, za', unit: '°C', d: 0, min: 0, max: 1000 }] },
  // Doładowanie
  { pid: 0x0B, len: 1, g: 'doladowanie', f: b => [b[0]], outs: [{ key: 'map', name: 'Ciśnienie w kolektorze', unit: 'kPa', d: 0, min: 0, max: 255 }] },
  { pid: 0x87, len: 5, g: 'doladowanie', f: b => [(b[0] & 1) ? u16(b[1], b[2]) / 32 : null, (b[0] & 2) ? u16(b[3], b[4]) / 32 : null], outs: [{ key: 'mapX', name: 'Kolektor, precyzyjnie', unit: 'kPa', d: 0, min: 0, max: 300 }, { key: 'mapXB', name: 'Kolektor B', unit: 'kPa', d: 0, min: 0, max: 300 }] },
  { pid: 0x70, len: 10, g: 'doladowanie', f: b => [(b[0] & 1) ? u16(b[1], b[2]) * 0.03125 : null, (b[0] & 2) ? u16(b[3], b[4]) * 0.03125 : null], outs: [{ key: 'boostCmdAbs', name: 'Doładowanie zadane, abs.', unit: 'kPa', d: 0, min: 0, max: 300 }, { key: 'boostActAbs', name: 'Doładowanie rzeczywiste, abs.', unit: 'kPa', d: 0, min: 0, max: 300 }] },
  { pid: 0x6F, len: 3, g: 'doladowanie', f: b => [(b[0] & 1) ? b[1] : null], outs: [{ key: 'compIn', name: 'Ciśnienie przed sprężarką', unit: 'kPa', d: 0, min: 60, max: 120 }] },
  { pid: 0x72, len: 5, g: 'doladowanie', f: b => [(b[0] & 1) ? b[1] * 100 / 255 : null, (b[0] & 2) ? b[2] * 100 / 255 : null], outs: [{ key: 'wgCmd', name: 'Wastegate zadany', unit: '%', d: 0, min: 0, max: 100 }, { key: 'wgAct', name: 'Wastegate rzeczywisty', unit: '%', d: 0, min: 0, max: 100 }] },
  { pid: 0x33, len: 1, g: 'doladowanie', slow: true, f: b => [b[0]], outs: [{ key: 'baro', name: 'Ciśnienie atmosferyczne', unit: 'kPa', d: 0, min: 80, max: 110 }] },
  { pid: 0x10, len: 2, g: 'doladowanie', f: b => [u16(b[0], b[1]) / 100], outs: [{ key: 'maf', name: 'Masa powietrza (MAF)', unit: 'g/s', d: 1, min: 0, max: 200 }] },
  // Mieszanka
  { pid: 0x34, len: 4, g: 'mieszanka', f: b => [u16(b[0], b[1]) * 2 / 65536, u16(b[2], b[3]) / 256 - 128], outs: [{ key: 'lambdaA', name: 'Lambda rzeczywista', unit: 'λ', d: 3, min: 0.7, max: 1.3 }, { key: 'lambdaI', name: 'Prąd sondy lambda', unit: 'mA', d: 2, min: -2, max: 2 }] },
  { pid: 0x24, len: 4, g: 'mieszanka', f: b => [u16(b[0], b[1]) * 2 / 65536, u16(b[2], b[3]) * 8 / 65536], outs: [{ key: 'lambdaV', name: 'Lambda rzeczywista (napięciowo)', unit: 'λ', d: 3, min: 0.7, max: 1.3 }, { key: 'lambdaVv', name: 'Napięcie sondy 1', unit: 'V', d: 3, min: 0, max: 5 }] },
  { pid: 0x44, len: 2, g: 'mieszanka', f: b => [u16(b[0], b[1]) * 2 / 65536], outs: [{ key: 'lambdaCmd', name: 'Lambda zadana', unit: 'λ', d: 3, min: 0.7, max: 1.3 }] },
  { pid: 0x06, len: 1, g: 'mieszanka', f: b => [b[0] / 1.28 - 100], outs: [{ key: 'stft1', name: 'Korekta krótkoterminowa', unit: '%', d: 1, min: -25, max: 25, check: v => lvlAbs(v, 10, 20) }] },
  { pid: 0x07, len: 1, g: 'mieszanka', f: b => [b[0] / 1.28 - 100], outs: [{ key: 'ltft1', name: 'Korekta długoterminowa', unit: '%', d: 1, min: -25, max: 25, check: v => lvlAbs(v, 8, 15) }] },
  { pid: 0x08, len: 1, g: 'mieszanka', f: b => [b[0] / 1.28 - 100], outs: [{ key: 'stft2', name: 'Korekta krótkoterm., bank 2', unit: '%', d: 1, min: -25, max: 25, check: v => lvlAbs(v, 10, 20) }] },
  { pid: 0x09, len: 1, g: 'mieszanka', f: b => [b[0] / 1.28 - 100], outs: [{ key: 'ltft2', name: 'Korekta długoterm., bank 2', unit: '%', d: 1, min: -25, max: 25, check: v => lvlAbs(v, 8, 15) }] },
  { pid: 0x03, len: 2, g: 'mieszanka', f: b => [b[0]], outs: [{ key: 'fuelSys', name: 'Tryb układu paliwowego', unit: '', text: true, fmt: v => FUELSYS[v] || ('kod ' + v) }] },
  { pid: 0x23, len: 2, g: 'mieszanka', f: b => [u16(b[0], b[1]) / 10], outs: [{ key: 'railP', name: 'Ciśnienie paliwa w szynie', unit: 'bar', d: 0, min: 0, max: 250 }] },
  { pid: 0x59, len: 2, g: 'mieszanka', f: b => [u16(b[0], b[1]) / 10], outs: [{ key: 'railPabs', name: 'Ciśnienie paliwa, abs.', unit: 'bar', d: 0, min: 0, max: 250 }] },
  { pid: 0x5D, len: 2, g: 'mieszanka', f: b => [(u16(b[0], b[1]) - 26880) / 128], outs: [{ key: 'injTiming', name: 'Kąt wtrysku', unit: '°', d: 1, min: -210, max: 302 }] },
  { pid: 0x15, len: 2, g: 'mieszanka', f: b => [b[0] / 200, b[1] === 0xFF ? null : b[1] / 1.28 - 100], outs: [{ key: 'o2s2', name: 'Sonda za katalizatorem', unit: 'V', d: 3, min: 0, max: 1.1 }, { key: 'o2s2trim', name: 'Korekta od sondy 2', unit: '%', d: 1, min: -25, max: 25 }] }
];

/* Wartości wyliczane z kilku parametrów. */
const DERIVED = [
  {
    key: 'boost', g: 'doladowanie', name: 'Doładowanie', unit: 'bar', d: 2, min: -1, max: 2,
    deps: [0x70, 0x87, 0x0B, 0x33], needs: s => s.has(0x70) || s.has(0x87) || s.has(0x0B),
    calc: s => { const abs = s.boostActAbs ?? s.mapX ?? s.map; return abs == null ? null : (abs - (s.baro ?? 100)) / 100; }
  },
  {
    key: 'boostTarget', g: 'doladowanie', name: 'Doładowanie zadane', unit: 'bar', d: 2, min: -1, max: 2,
    deps: [0x70, 0x33], needs: s => s.has(0x70),
    calc: s => s.boostCmdAbs == null ? null : (s.boostCmdAbs - (s.baro ?? 100)) / 100
  },
  {
    key: 'boostDev', g: 'doladowanie', name: 'Odchyłka od zadanego', unit: 'bar', d: 2, min: -0.6, max: 0.6,
    deps: [0x70, 0x33, 0x87, 0x0B], needs: s => s.has(0x70),
    calc: s => (s.boost == null || s.boostTarget == null) ? null : s.boost - s.boostTarget,
    check: (v, s) => {
      if ((s.boostTarget ?? 0) < 0.3) return 'ok';
      if (v <= -0.4 || v >= 0.35) return 'crit';
      if (v <= -0.2 || v >= 0.2) return 'warn';
      return 'ok';
    }
  },
  {
    key: 'iatRise', g: 'chlodzenie', name: 'Dolot ponad otoczenie', unit: '°C', d: 0, min: 0, max: 60,
    deps: [0x0F, 0x46], needs: s => s.has(0x0F) && s.has(0x46),
    calc: s => (s.iat == null || s.ambient == null) ? null : s.iat - s.ambient,
    check: v => lvl(v, 25, 40)
  },
  {
    key: 'lambdaDev', g: 'mieszanka', name: 'Odchyłka lambdy', unit: 'λ', d: 3, min: -0.15, max: 0.15,
    deps: [0x44, 0x34, 0x24, 0x03], needs: s => s.has(0x44) && (s.has(0x34) || s.has(0x24)),
    calc: s => { const a = s.lambdaA ?? s.lambdaV; return (a == null || s.lambdaCmd == null) ? null : a - s.lambdaCmd; },
    check: (v, s) => s.fuelSys !== 2 ? 'ok' : lvlAbs(v, 0.05, 0.1)
  },
  {
    key: 'trimTotal', g: 'mieszanka', name: 'Korekta łączna', unit: '%', d: 1, min: -30, max: 30,
    deps: [0x06, 0x07], needs: s => s.has(0x06) && s.has(0x07),
    calc: s => (s.stft1 == null || s.ltft1 == null) ? null : s.stft1 + s.ltft1,
    check: v => lvlAbs(v, 10, 20)
  }
];

/* Opisy kodów SAE (ogólne, tłumaczenie własne). Kody producenta nie mają opisu. */
const DTC_DESC = {
  P0011: 'Wałek rozrządu dolotowy – położenie lub działanie układu (bank 1)',
  P0016: 'Korelacja wału korbowego i wałka rozrządu (bank 1)',
  P0087: 'Ciśnienie paliwa w szynie za niskie',
  P0088: 'Ciśnienie paliwa w szynie za wysokie',
  P0101: 'Przepływomierz (MAF) – zakres lub działanie',
  P0102: 'Przepływomierz (MAF) – sygnał za niski',
  P0103: 'Przepływomierz (MAF) – sygnał za wysoki',
  P0106: 'Czujnik ciśnienia w kolektorze (MAP) – zakres lub działanie',
  P0107: 'Czujnik ciśnienia w kolektorze (MAP) – sygnał za niski',
  P0108: 'Czujnik ciśnienia w kolektorze (MAP) – sygnał za wysoki',
  P0111: 'Czujnik temperatury powietrza dolotowego – zakres lub działanie',
  P0119: 'Czujnik temperatury płynu chłodzącego – sygnał przerywany',
  P0125: 'Za niska temperatura płynu do pracy w pętli zamkniętej',
  P0217: 'Przegrzanie silnika',
  P0245: 'Zawór sterujący wastegate – sygnał za niski',
  P0246: 'Zawór sterujący wastegate – sygnał za wysoki',
  P0481: 'Wentylator chłodnicy 2 – obwód sterowania',
  P0598: 'Termostat sterowany elektrycznie – sygnał za niski',
  P0599: 'Termostat sterowany elektrycznie – sygnał za wysoki',
  P0116: 'Czujnik temperatury płynu chłodzącego – zakres lub działanie',
  P0117: 'Czujnik temperatury płynu chłodzącego – sygnał za niski',
  P0118: 'Czujnik temperatury płynu chłodzącego – sygnał za wysoki',
  P0121: 'Czujnik położenia przepustnicy – zakres lub działanie',
  P0128: 'Silnik nagrzewa się za wolno (termostat)',
  P0130: 'Sonda lambda, bank 1 czujnik 1 – obwód',
  P0133: 'Sonda lambda, bank 1 czujnik 1 – wolna reakcja',
  P0135: 'Grzałka sondy lambda, bank 1 czujnik 1 – obwód',
  P0136: 'Sonda lambda, bank 1 czujnik 2 – obwód',
  P0141: 'Grzałka sondy lambda, bank 1 czujnik 2 – obwód',
  P0171: 'Mieszanka za uboga (bank 1)',
  P0172: 'Mieszanka za bogata (bank 1)',
  P0234: 'Za wysokie ciśnienie doładowania (overboost)',
  P0236: 'Czujnik ciśnienia doładowania – zakres lub działanie',
  P0237: 'Czujnik ciśnienia doładowania – sygnał za niski',
  P0238: 'Czujnik ciśnienia doładowania – sygnał za wysoki',
  P0243: 'Zawór sterujący wastegate – obwód',
  P0299: 'Za niskie ciśnienie doładowania (underboost)',
  P0300: 'Losowe wypadanie zapłonów',
  P0301: 'Wypadanie zapłonów – cylinder 1',
  P0302: 'Wypadanie zapłonów – cylinder 2',
  P0303: 'Wypadanie zapłonów – cylinder 3',
  P0304: 'Wypadanie zapłonów – cylinder 4',
  P0325: 'Czujnik spalania stukowego 1 – obwód',
  P0335: 'Czujnik położenia wału korbowego – obwód',
  P0340: 'Czujnik położenia wałka rozrządu – obwód',
  P0401: 'Za mały przepływ EGR',
  P0420: 'Sprawność katalizatora poniżej progu (bank 1)',
  P0441: 'Układ odparowania paliwa (EVAP) – nieprawidłowy przepływ',
  P0455: 'Układ odparowania paliwa (EVAP) – duży wyciek',
  P0480: 'Wentylator chłodnicy 1 – obwód sterowania',
  P0507: 'Obroty biegu jałowego wyższe niż oczekiwane',
  P0562: 'Napięcie zasilania za niskie',
  P0563: 'Napięcie zasilania za wysokie',
  P0597: 'Termostat sterowany elektrycznie – przerwa w obwodzie',
  P0606: 'Sterownik silnika – błąd procesora',
  P0627: 'Pompa paliwa – przerwa w obwodzie sterowania',
  P0700: 'Skrzynia biegów zgłasza usterkę (żądanie kontrolki MIL)',
  P2004: 'Klapy kolektora dolotowego zablokowane w pozycji otwartej (bank 1)',
  P2015: 'Czujnik położenia klap kolektora dolotowego – zakres lub działanie',
  P2096: 'Korekta za katalizatorem – mieszanka za uboga (bank 1)',
  P2097: 'Korekta za katalizatorem – mieszanka za bogata (bank 1)',
  P2181: 'Układ chłodzenia – nieprawidłowe działanie',
  P2187: 'Mieszanka za uboga na biegu jałowym (bank 1)',
  P2188: 'Mieszanka za bogata na biegu jałowym (bank 1)',
  P2279: 'Nieszczelność układu dolotowego',
  P2293: 'Regulator ciśnienia paliwa 2 – działanie',
  P2563: 'Czujnik położenia sterowania turbosprężarki – zakres lub działanie'
};

const ELM_ERRORS = ['NO DATA', 'CAN ERROR', 'BUS ERROR', 'BUS INIT', 'BUFFER FULL', 'DATA ERROR', 'FB ERROR', 'STOPPED', 'UNABLE TO CONNECT', 'ERR', 'LV RESET', 'ACT ALERT'];

/* Odpowiedź ELM327 (ATH0 ATS0 ATCAF1) → lista wiadomości hex. */
function parseElm(lines) {
  const clean = lines.map(l => l.trim().toUpperCase()).filter(l => l && !l.startsWith('SEARCHING') && l !== 'OK');
  for (const l of clean) {
    if (l === '?') return { msgs: [], err: '?' };
    for (const e of ELM_ERRORS) if (l.startsWith(e)) return { msgs: [], err: l.startsWith('NO DATA') ? 'NO DATA' : l };
  }
  const msgs = []; let i = 0;
  while (i < clean.length) {
    const l = clean[i].replace(/\s/g, '');
    if (/^[0-9A-F]{3}$/.test(l) && i + 1 < clean.length && /^[0-9A-F]:/.test(clean[i + 1])) {
      const len = parseInt(l, 16); i++; let parts = '';
      while (i < clean.length && /^[0-9A-F]:/.test(clean[i])) { parts += clean[i].split(':')[1].replace(/\s/g, ''); i++; }
      msgs.push(parts.slice(0, len * 2));
    } else {
      if (/^[0-9A-F]+$/.test(l) && l.length % 2 === 0) msgs.push(l);
      i++;
    }
  }
  return { msgs, err: null };
}

function saeCode(a, b) { return 'PCBU'[a >> 6] + ((a >> 4) & 3) + (a & 0xF).toString(16).toUpperCase() + hex2(b); }

/* BMW pokazuje kody jako 6 znaków hex (np. 120308), a nie kody SAE. */
function decodeUdsDtc(b0, b1, b2, st, bmw) {
  const code = bmw ? hex2(b0) + hex2(b1) + hex2(b2) : saeCode(b0, b1);
  const flags = [st & 0x01 ? 'aktywny' : 'zapisany'];
  if (st & 0x08) flags.push('potwierdzony');
  if (st & 0x04) flags.push('oczekujący');
  if (st & 0x80) flags.push('kontrolka');
  if (st & 0x02) flags.push('w tym cyklu jazdy');
  flags.push('status 0x' + hex2(st));
  return { code, ftb: hex2(b2), raw: hex2(b0) + hex2(b1) + hex2(b2), full: bmw ? code : `${code}-${hex2(b2)}`, status: st, real: (st & 0xAF) !== 0, flags, active: !!(st & 1), mil: !!(st & 0x80), desc: (bmw ? bmwDesc(code) : DTC_DESC[code]) || '' };
}

/* BMW KWP2000 (seria E na D-CAN): kod 2 bajty hex + bajt statusu. */
function decodeKwpDtc(b0, b1, st) {
  const code = hex2(b0) + hex2(b1);
  const flags = [st & 0x20 ? 'aktywny' : 'zapisany']; if (st & 0x40) flags.push('ostrzeżenie'); flags.push('status 0x' + hex2(st));
  return { code, ftb: '', raw: code, full: code, status: st, real: true, flags, active: !!(st & 0x20), mil: false, desc: bmwDesc(code) || '', kwp: true };
}

function parseMode01(data, defs) {
  const b = bytesOf(data); if (b[0] !== 0x41) return null;
  const out = {}; const seen = new Set(); let i = 1;
  while (i < b.length) {
    const pid = b[i]; const def = defs.find(d => d.pid === pid);
    if (!def) break;
    const slice = b.slice(i + 1, i + 1 + def.len);
    if (slice.length < def.len) break;
    const v = def.f(slice);
    def.outs.forEach((o, k) => { if (v[k] != null && isFinite(v[k])) out[o.key] = v[k]; });
    seen.add(pid); i += 1 + def.len;
  }
  return seen.size ? { out, seen } : null;
}

function parseReadiness(b) {
  const compression = !!(b[1] & 0x08);
  const cont = ['Wypadanie zapłonów', 'Układ paliwowy', 'Podzespoły'].map((n, i) => ({ name: n, supported: !!(b[1] & (1 << i)), complete: !(b[1] & (1 << (i + 4))) }));
  const names = compression
    ? ['Katalizator NMHC', 'Katalizator NOx / SCR', null, 'Ciśnienie doładowania', null, 'Czujnik spalin', 'Filtr cząstek stałych', 'EGR / VVT']
    : ['Katalizator', 'Podgrzewanie katalizatora', 'Układ odparowania (EVAP)', 'Wtórne powietrze', null, 'Sonda lambda', 'Grzałka sondy lambda', 'EGR / VVT'];
  const non = names.map((n, i) => n && ({ name: n, supported: !!(b[2] & (1 << i)), complete: !(b[3] & (1 << i)) })).filter(Boolean);
  return { mil: !!(b[0] & 0x80), count: b[0] & 0x7F, compression, monitors: cont.concat(non).filter(m => m.supported) };
}

class ELM {
  constructor(transport, log) {
    this.t = transport; this.log = log || (() => {});
    this.buf = ''; this.waiter = null; this.q = Promise.resolve(); this.opq = Promise.resolve();
    this.fcOk = true; this.cur = null; this.multiPid = true; this.onWarn = null; this.ident = '';
    this.st = '64'; this.countOk = true; this.mon = null;
    transport.onData(s => {
      if (this.mon) { this.mon(s); return; }
      this.buf += s;
      if (this.waiter && this.buf.includes('>')) { const w = this.waiter; this.waiter = null; w(); }
    });
  }
  send(cmd, timeout = 4000) {
    const run = async () => {
      this.buf = '';
      const done = new Promise(res => {
        this.waiter = res;
        setTimeout(() => { if (this.waiter === res) { this.waiter = null; res(); } }, timeout);
      });
      await this.t.write(cmd + '\r');
      await done;
      const raw = this.buf.replace(/>/g, ''); this.buf = '';
      let lines = raw.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
      if (lines.length && lines[0].replace(/\s/g, '').toUpperCase() === cmd.replace(/\s/g, '').toUpperCase()) lines = lines.slice(1);
      this.log(cmd, lines);
      return lines;
    };
    const p = this.q.then(run, run);
    this.q = p.catch(() => {});
    return p;
  }
  /* Blokada operacji wyższego poziomu (każda zaczyna od wyboru modułu). */
  op(fn) { const p = this.opq.then(() => fn()); this.opq = p.catch(() => {}); return p; }

  async init() {
    await this.send('ATZ', 5000); await sleep(800);
    const id = await this.send('ATI');
    if (!id.length) throw new Error('Adapter nie odpowiada. Sprawdź, czy jest w gnieździe OBD i czy zapłon jest włączony.');
    for (const c of ['ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATSP6', 'ATCAF1', 'ATAT1', 'ATST64']) await this.send(c);
    this.ident = id.join(' ');
    return this.ident;
  }
  selectObd() { const rx = this.obdRx || 0x7E8; return this.select(this.obdTx || 0x7E0, rx, rx - 8); }
  /* Gdy sterownik nie odpowiada pod 7E0/7E8: zapytanie ogólne 7DF z nagłówkami, żeby zobaczyć,
     kto w ogóle odpowiada i co zwraca adapter. Próbuje CAN 500 kb/s, potem automatycznego wyboru protokołu. */
  async findObdEcu() {
    const tried = [];
    try {
      for (const sp of ['ATSP6', 'ATSP0']) {
        if (this.rawMode) { await this.send('ATCAF1'); this.rawMode = false; }
        for (const c of [sp, 'ATCRA', 'ATH1', 'ATSH7DF']) await this.send(c);
        this.cur = null;
        const lines = await this.send('0100', 12000);
        const txt = lines.join(' | ');
        tried.push(`${sp}: ${txt || '(brak odpowiedzi)'}`);
        for (const l of lines) {
          const h = l.replace(/\s/g, '').toUpperCase();
          const m = h.match(/^(7E[89A-F])(?:0[0-9A-F])?4100/);
          if (m) {
            /* Część aut (np. BMW serii F) przepuszcza przez gateway tylko zapytania ogólne 7DF, a na fizyczny adres
               sterownika nie odpowiada. Wtedy zostajemy przy 7DF i filtrujemy odpowiedzi tylko z tego sterownika. */
            const rx = parseInt(m[1], 16); this.obdRx = rx; this.obdTx = 0x7DF;
            const others = lines.map(x => x.replace(/\s/g, '').toUpperCase().slice(0, 3)).filter(x => /^7E[89A-F]$/.test(x) && x !== m[1]);
            return { ok: true, rx, proto: sp, tried, others };
          }
        }
        if (lines.some(l => /^(18DAF1|18DA)/i.test(l.replace(/\s/g, '')) && /4100/.test(l.replace(/\s/g, '')))) return { ok: false, ext29: true, tried };
        if (lines.some(l => /4100/.test(l.replace(/\s/g, '')))) return { ok: true, proto: sp, tried };   // inny protokół (K-line), nagłówki nie z CAN
      }
      return { ok: false, tried };
    } finally { await this.send('ATH0'); this.cur = null; }
  }
  async voltage() {
    const r = await this.send('ATRV');
    const m = r.join(' ').match(/(\d+(?:\.\d+)?)\s*V/i);
    return m ? parseFloat(m[1]) : null;
  }
  /* fc = adres, na który adapter wysyła ramkę flow control (przy zapytaniu ogólnym 7DF – fizyczny adres sterownika). */
  async select(tx, rx, fc = tx) {
    const key = tx + ':' + rx; if (this.cur === key) return;
    if (this.rawMode) { await this.send('ATCAF1'); this.rawMode = false; }
    await this.send('ATSH' + hex3(tx)); await this.send('ATCRA' + hex3(rx));
    if (this.fcOk) {
      for (const c of ['ATFCSH' + hex3(fc), 'ATFCSD300000', 'ATFCSM1']) {
        const r = await this.send(c);
        if (!r.length || r[r.length - 1].toUpperCase() !== 'OK') {
          this.fcOk = false;
          this.onWarn && this.onWarn('Adapter nie obsługuje ustawiania flow control (ATFCSH). Dłuższe odpowiedzi z modułów VAG mogą nie dochodzić.');
          break;
        }
      }
    }
    this.cur = key;
  }
  /* ---- BMW: D-CAN z adresowaniem rozszerzonym. Tester 0x6F1, moduł odpowiada na 0x600 + adres,
     pierwszy bajt ramki to adres odbiorcy (do modułu) lub 0xF1 (do testera). ISO-TP składamy sami
     w trybie CAF0, bo tanie klony ELM327 nie obsługują ATCEA. ---- */
  async bmwSelect(addr) {
    const key = 'bmw:' + addr; if (this.cur === key) return;
    if (!this.rawMode) { await this.send('ATCAF0'); this.rawMode = true; }
    await this.send('ATSH6F1'); await this.send('ATCRA' + hex3(0x600 + addr));
    this.cur = key;
  }
  async bmwSendFrame(addr, payload) {
    const f = [addr, ...payload]; while (f.length < 8) f.push(0x00);
    const lines = await this.send(f.map(hex2).join(''));
    const frames = [];
    for (const l of lines) {
      const h = l.replace(/\s/g, '').toUpperCase();
      if (/^[0-9A-F]+$/.test(h) && h.length >= 4 && h.length % 2 === 0) { const b = bytesOf(h); if (b[0] === 0xF1) frames.push(b.slice(1)); }
      else if (ELM_ERRORS.some(e => h.startsWith(e.replace(/\s/g, '')))) frames.err = h;
    }
    return frames;
  }
  async bmwRequest(addr, hex, { attempts = 4 } = {}) {
    await this.bmwSelect(addr);
    const pl = bytesOf(hex);
    if (pl.length > 6) return { err: 'polecenie za długie dla jednej ramki (maks. 6 bajtów)' };
    for (let a = 0; a < attempts; a++) {
      let frames = await this.bmwSendFrame(addr, [pl.length, ...pl]);
      if (!frames.length) return { err: frames.err && !frames.err.startsWith('NODATA') ? frames.err : 'NO DATA' };
      let msg = null, i = 0;
      while (i < frames.length && !msg) {
        const f = frames[i++], t = f[0] >> 4;
        if (t === 0) { const m = f.slice(1, 1 + (f[0] & 0xF)); if (m[0] === 0x7F && m[2] === 0x78) continue; msg = m; }
        else if (t === 1) {
          const len = ((f[0] & 0xF) << 8) | f[1]; let data = f.slice(2);
          let rest = frames.slice(i).filter(x => (x[0] >> 4) === 2);
          if (!rest.length) rest = (await this.bmwSendFrame(addr, [0x30, 0x00, 0x00])).filter(x => (x[0] >> 4) === 2);
          for (const c of rest) data = data.concat(c.slice(1));
          if (data.length < len) return { err: `niepełna odpowiedź (${data.length} z ${len} bajtów)` };
          msg = data.slice(0, len);
        }
      }
      if (!msg) { await sleep(400); continue; }   // tylko „czekaj” (7F xx 78) – pytamy ponownie
      if (msg[0] === 0x7F) { const c = hex2(msg[2] || 0); return { err: `NRC ${c}: ${NRC[c] || 'nieznany'}`, nrc: c }; }
      if (msg[0] !== ((pl[0] + 0x40) & 0xFF)) return { err: 'nieoczekiwana odpowiedź: ' + msg.map(hex2).join('') };
      return { data: msg.map(hex2).join('') };
    }
    return { err: 'brak odpowiedzi (moduł wciąż przetwarza)' };
  }
  /* Żądanie do modułu niezależnie od sposobu adresowania (VAG/OBD: osobne ID, BMW: adres w danych). */
  async ureq(mod, hex, opts) {
    if (mod.bmw != null) return this.bmwRequest(mod.bmw, hex, opts);
    await this.select(mod.tx, mod.rx);
    return this.request(hex, opts);
  }

  /* Moduł odpowiedział „czekaj” (7F xx 78). Zamiast wysyłać żądanie od nowa (co u wolnych modułów, np. ABS,
     zaczyna przetwarzanie od początku) prosimy adapter, żeby czekał na kilka kolejnych odpowiedzi z dłuższym limitem czasu. */
  async waitPending(req) {
    if (!this.countOk) return null;
    try {
      await this.send('ATAT0'); await this.send('ATSTFF');
      const lines = await this.send(req + 'F', 25000);
      if (lines.some(l => l.trim() === '?')) { this.countOk = false; return null; }
      const { msgs, err } = parseElm(lines);
      if (err) return null;
      const real = msgs.filter(m => !(m.startsWith('7F') && m.substr(4, 2) === '78'));
      return real.length ? real : null;
    } finally { await this.send('ATST' + this.st); await this.send('ATAT1'); }
  }
  async request(req, { attempts = 5 } = {}) {
    let pending = false, waited = false;
    for (let a = 0; a < attempts; a++) {
      const { msgs, err } = parseElm(await this.send(req));
      if (err) { if (pending && err === 'NO DATA') { await sleep(300); continue; } return { err }; }
      let real = msgs.filter(m => !(m.startsWith('7F') && m.substr(4, 2) === '78'));
      if (real.length < msgs.length) pending = true;
      if (!real.length && pending && !waited) { waited = true; const w = await this.waitPending(req); if (w) real = w; }
      if (!real.length) { if (pending) { await sleep(300); continue; } return { err: 'pusta odpowiedź' }; }
      const m = real[real.length - 1];
      if (m.startsWith('7F') && m.length >= 6) { const c = m.substr(4, 2); return { err: `NRC ${c}: ${NRC[c] || 'nieznany'}`, nrc: c }; }
      const sid = parseInt(req.substr(0, 2), 16);
      if (!m.startsWith(hex2(sid + 0x40))) return { err: 'nieoczekiwana odpowiedź: ' + m };
      return { data: m };
    }
    return { err: 'brak odpowiedzi (moduł wciąż przetwarza)' };
  }

  /* ---- OBD-II, sterownik silnika ---- */
  async discoverPids() {
    await this.selectObd();
    const sup = new Set(); let base = 0;
    while (base <= 0xA0) {
      const r = await this.request('01' + hex2(base), { attempts: 2 });
      if (r.err) break;
      const b = bytesOf(r.data).slice(2, 6);
      if (b.length < 4) break;
      for (let i = 0; i < 32; i++) if (b[i >> 3] & (0x80 >> (i & 7))) sup.add(base + i + 1);
      if (!sup.has(base + 0x20)) break;
      base += 0x20;
    }
    return sup;
  }
  async readLive(defs) {
    await this.selectObd();
    const out = {}; let queue = [...defs];
    this.respLen = this.respLen || {};
    while (queue.length) {
      const n = this.multiPid ? Math.min(6, queue.length) : 1;
      const ch = queue.splice(0, n);
      /* Cyfra liczby odpowiedzi na końcu zapytania (np. 010C0D1): adapter oddaje wynik zaraz po odpowiedzi sterownika,
         zamiast czekać, czy odezwie się ktoś jeszcze. Używana, gdy znamy już długość odpowiedzi. Przy odpowiedziach
         wieloramkowych sprawdzamy, czy adapter ich nie ucina; jeśli tak, wyłączamy ją dla nich. */
      const key = ch.map(d => d.pid).join(','), known = this.respLen[key];
      const useCount = this.fastCount !== false && this.countOk && known != null && (known <= 7 || this.countMulti !== false);
      const r = await this.request('01' + ch.map(d => hex2(d.pid)).join('') + (useCount ? '1' : ''), { attempts: 2 });
      if (r.err && useCount && (r.err === '?' || r.err === 'NO DATA')) { if (r.err === '?') this.countOk = false; else if (known > 7) this.countMulti = false; else if ((this.countFails = (this.countFails || 0) + 1) >= 3) this.fastCount = false; delete this.respLen[key]; queue = ch.concat(queue); continue; }
      if (r.err) { if (n > 1) { this.multiPid = false; queue = ch.concat(queue); } continue; }
      const p = parseMode01(r.data, ch);
      if (useCount && known > 7 && (!p || p.seen.size < ch.length)) { this.countMulti = false; queue = ch.concat(queue); continue; }
      if (p && p.seen.size === ch.length) { this.respLen[key] = r.data.length / 2; if (useCount && known > 7) this.countMulti = true; }
      if (!p || (n > 1 && p.seen.size <= 1)) {
        if (n > 1) {
          this.multiPid = false;
          if (p) Object.assign(out, p.out);
          queue = ch.filter(d => !(p && p.seen.has(d.pid))).concat(queue);
        }
        continue;
      }
      Object.assign(out, p.out);
    }
    return out;
  }
  async readObdDtcs() {
    await this.selectObd();
    const res = {};
    for (const [mode, label] of [['03', 'stored'], ['07', 'pending'], ['0A', 'permanent']]) {
      const r = await this.request(mode, { attempts: 2 });
      if (r.err) { res[label] = (r.err === 'NO DATA' && mode !== '0A') ? [] : null; continue; }
      let b = bytesOf(r.data).slice(1);
      if (b.length % 2 === 1) b = b.slice(1);
      const codes = [];
      for (let i = 0; i + 1 < b.length; i += 2) if (b[i] || b[i + 1]) { const c = saeCode(b[i], b[i + 1]); codes.push({ code: c, desc: DTC_DESC[c] || '' }); }
      res[label] = codes;
    }
    return res;
  }
  async readReadiness() {
    await this.selectObd();
    const r = await this.request('0101', { attempts: 2 });
    if (r.err) return null;
    const b = bytesOf(r.data).slice(2, 6);
    return b.length === 4 ? parseReadiness(b) : null;
  }
  async readVin() {
    await this.selectObd();
    for (const q of ['0902', '22F190']) {
      const r = await this.request(q, { attempts: 2 });
      if (!r.err) { const v = asciiOf(bytesOf(r.data).slice(3)); if (v.length >= 17) return v.slice(-17); }
    }
    /* BMW: VIN z silnika (DME, adres 0x12) przez D-CAN, gdy OBD go nie podaje. */
    const b = await this.bmwRequest(0x12, '22F190', { attempts: 2 });
    if (!b.err) { const v = asciiOf(bytesOf(b.data).slice(3)); if (v.length >= 17) { this.bmwSeen = true; return v.slice(-17); } }
    return null;
  }
  async readFreeze(sup) {
    await this.selectObd();
    const r = await this.request('020200', { attempts: 2 });
    if (r.err) return null;
    const b = bytesOf(r.data);
    if (b.length < 5 || (!b[3] && !b[4])) return null;
    const fr = { dtc: saeCode(b[3], b[4]), values: {} };
    fr.desc = DTC_DESC[fr.dtc] || '';
    for (const pid of [0x03, 0x04, 0x05, 0x06, 0x07, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11]) {
      if (!sup.has(pid)) continue;
      const def = PIDS.find(d => d.pid === pid); if (!def) continue;
      const q = await this.request('02' + hex2(pid) + '00', { attempts: 1 });
      if (q.err) continue;
      const bb = bytesOf(q.data).slice(3); if (bb.length < def.len) continue;
      const v = def.f(bb);
      def.outs.forEach((o, k) => { if (v[k] != null) fr.values[o.key] = v[k]; });
    }
    return fr;
  }
  async clearObd() { await this.selectObd(); return this.request('04', { attempts: 4 }); }

  /* ---- UDS, moduły VAG ---- */
  async probe(mod, deep) {
    let r = await this.ureq(mod, '3E00', { attempts: 1 });
    let present = !r.err || !!r.nrc;
    if (!present && deep) { r = await this.ureq(mod, mod.bmw != null ? '22F190' : '22F187', { attempts: 1 }); present = !r.err || !!r.nrc; }
    return present;
  }
  async readDid(mod, did, asHex) {
    const r = await this.ureq(mod, '22' + did, { attempts: 3 });
    if (r.err || !r.data.startsWith('62' + did)) return null;
    const b = bytesOf(r.data).slice(3);
    return asHex ? b.map(hex2).join('') : asciiOrHex(b);
  }
  /* Szczegóły błędu UDS: dane rozszerzone (0x19 06, rekord po rekordzie) i dane środowiskowe (0x19 04). */
  async readDtcDetails(mod, raw) {
    const ext = [];
    for (let rec = 1; rec <= 8; rec++) {
      const r = await this.ureq(mod, '1906' + raw + hex2(rec), { attempts: 2 });
      if (r.err) { if (rec > 4) break; continue; }
      const b = bytesOf(r.data).slice(6);
      if (b.length > 1 && b[0] === rec) ext.push({ rec, bytes: b.slice(1) });
    }
    if (mod.bmw == null) for (const rec of [0x70, 0x71]) {   // VAG: rekord silnika/skrzyni i dynamiczna ramka zamrożona
      const r = await this.ureq(mod, '1906' + raw + hex2(rec), { attempts: 1 });
      if (r.err) continue;
      const b = bytesOf(r.data).slice(6);
      if (b.length > 1 && b[0] === rec) ext.push({ rec, bytes: b.slice(1) });
    }
    if (mod.bmw == null && !ext.some(x => x.rec === 1 || x.rec === 2)) {
      /* Część modułów odpowiada tylko na „wszystkie rekordy” (FF). Rekordy idą wtedy jeden za drugim bez długości:
         0x01 ma 2 bajty, 0x02 ma 10, nieznany rekord zabiera resztę odpowiedzi. */
      const r = await this.ureq(mod, '1906' + raw + 'FF', { attempts: 2 });
      if (!r.err) {
        const b = bytesOf(r.data).slice(6); let i = 0;
        while (i < b.length) {
          const rec = b[i], len = { 1: 2, 2: 10 }[rec];
          if (len && i + 1 + len <= b.length) { ext.push({ rec, bytes: b.slice(i + 1, i + 1 + len) }); i += 1 + len; }
          else { if (b.length - i > 1) ext.push({ rec, bytes: b.slice(i + 1) }); break; }
        }
      }
    }
    let snap = null;
    const s = await this.ureq(mod, '1904' + raw + 'FF', { attempts: 2 });
    if (!s.err) { const b = bytesOf(s.data).slice(6); if (b.length) snap = b; }
    return { ext, snap };
  }

  /* ---- OBD tryb 06 i 09 ---- */
  async readTests(onProgress) {
    await this.selectObd();
    const mids = []; let base = 0;
    while (base <= 0xE0) {
      const r = await this.request('06' + hex2(base), { attempts: 2 });
      if (r.err) break;
      const b = bytesOf(r.data).slice(2, 6); if (b.length < 4) break;
      for (let i = 0; i < 32; i++) if (b[i >> 3] & (0x80 >> (i & 7))) mids.push(base + i + 1);
      if (!mids.includes(base + 0x20)) break;
      base += 0x20;
    }
    const tests = [];
    for (const mid of mids.filter(m => m % 0x20 !== 0)) {
      onProgress && onProgress(mid);
      const r = await this.request('06' + hex2(mid), { attempts: 2 });
      if (!r.err) parseMode06(r.data).forEach(t => tests.push(t));
    }
    return { mids, tests };
  }
  async readCalib() {
    await this.selectObd();
    const out = {};
    const r4 = await this.request('0904', { attempts: 2 });
    if (!r4.err) { const b = bytesOf(r4.data).slice(3); const ids = []; for (let i = 0; i < b.length; i += 16) { const s = asciiOf(b.slice(i, i + 16)); if (s) ids.push(s); } if (ids.length) out.calid = ids; }
    const r6 = await this.request('0906', { attempts: 2 });
    if (!r6.err) { const b = bytesOf(r6.data).slice(3); const c = []; for (let i = 0; i + 3 < b.length; i += 4) c.push(b.slice(i, i + 4).map(hex2).join('')); if (c.length) out.cvn = c; }
    const rA = await this.request('090A', { attempts: 2 });
    if (!rA.err) { const s = asciiOf(bytesOf(rA.data).slice(3)); if (s) out.ecuName = s; }
    return out;
  }

  /* ---- Narzędzia zaawansowane ---- */
  async raw(mod, hex) {
    return this.ureq(mod, hex.replace(/\s/g, '').toUpperCase(), { attempts: 3 });
  }
  async scanDids(mod, ranges, { onProgress, onFound, stop, extended } = {}) {
    const found = []; let n = 0; const total = ranges.reduce((a, [lo, hi]) => a + hi - lo + 1, 0);
    await this.send('ATST32'); this.st = '32';
    let inExt = false;
    try {
      if (extended) { const s = await this.ureq(mod, '1003', { attempts: 2 }); inExt = !s.err; }
      for (const [lo, hi] of ranges) for (let did = lo; did <= hi; did++) {
        if (stop && stop()) return found;
        n++; if (n % 8 === 0 && onProgress) onProgress(did, n, total);
        const r = await this.ureq(mod, '22' + hex4(did), { attempts: 2 });
        if (r.err || !r.data.startsWith('62' + hex4(did))) continue;
        const f = { did, bytes: bytesOf(r.data).slice(3) };
        found.push(f); onFound && onFound(f);
      }
      return found;
    } finally {
      if (inExt) await this.ureq(mod, '1001', { attempts: 1 });
      this.st = '64'; await this.send('ATST64');
    }
  }
  async readDidRaw(mod, did) {
    const r = await this.ureq(mod, '22' + hex4(did), { attempts: 1 });
    return (r.err || !r.data.startsWith('62' + hex4(did))) ? null : bytesOf(r.data).slice(3);
  }
  /* Podsłuch magistrali (ATMA). Wołać wewnątrz op(): blokuje adapter do czasu stop(). */
  async monitor(onLine, onEnd) {
    for (const c of ['ATH1', 'ATCAF0', 'ATCF600', 'ATCM600']) await this.send(c);
    this.cur = null; this.rawMode = false;
    let tail = '', stopping = false, ended = false, endRes;
    const endP = new Promise(r => { endRes = r; });
    this.mon = s => {
      tail += s;
      const parts = tail.split(/[\r\n]+/); tail = parts.pop();
      for (const p of parts) { const l = p.replace('>', '').trim(); if (l) onLine(l); }
      if (s.includes('>') || tail.includes('>')) {
        const l = tail.replace('>', '').trim(); if (l) onLine(l); tail = '';
        if (!ended) { ended = true; if (!stopping) this.mon = null; endRes(); if (!stopping && onEnd) onEnd(); }
      }
    };
    await this.t.write('ATMA\r');
    const restore = async () => {
      this.mon = null; this.buf = '';
      await sleep(150);
      for (const c of ['ATH0', 'ATCAF1', 'ATCRA']) await this.send(c);
      this.cur = null;
    };
    return {
      ended: endP,
      stop: async () => {
        stopping = true;
        if (!ended) { await this.t.write('\r'); await Promise.race([endP, sleep(2000)]); }
        await restore();
      }
    };
  }
  /* VAG: przebieg i zegar auta teraz (0x02BD), z gatewaya, a gdy nie odpowie – z silnika. */
  async readVagStamp() {
    for (const mod of [{ tx: 0x710, rx: 0x77A }, { tx: 0x7E0, rx: 0x7E8 }]) {
      const b = await this.readDidRaw(mod, 0x02BD);
      const st = parseVagStamp(b);
      if (st) return { ...st, src: hex3(mod.tx) };
    }
    return null;
  }
  async readModuleDtcs(mod) {
    if (mod.bmw != null) return this.readBmwDtcs(mod);
    await this.select(mod.tx, mod.rx);
    /* Maska 0xFF zwraca u VAG wszystkie kody obsługiwane przez moduł (status 0x50 = test jeszcze nie wykonany),
       a nie tylko usterki. Pytamy o statusy usterek (0x2F), a drugi raz o same potwierdzone (0x08), gdy odpowiedź jest za długa. */
    let r = null, switched = false;
    for (const mask of [0x2F, 0x08]) {
      r = await this.request('1902' + hex2(mask));
      if (r.err && r.nrc && !switched) { const s = await this.request('1003'); if (!s.err) { switched = true; r = await this.request('1902' + hex2(mask)); } }
      if (!r.err) break;
    }
    if (switched) await this.request('1001');
    if (r.err) return { err: r.err, dtcs: [], untested: 0 };
    const b = bytesOf(r.data).slice(3); const all = [];
    for (let i = 0; i + 3 < b.length; i += 4) all.push(decodeUdsDtc(b[i], b[i + 1], b[i + 2], b[i + 3]));
    const dtcs = all.filter(d => d.real);
    return { dtcs, untested: all.length - dtcs.length };
  }
  async scanModule(mod, deep = true) {
    if (!(await this.probe(mod, deep))) return null;
    const info = { ...mod, ident: {} };
    for (const [did, label, kind] of (mod.bmw != null ? BMW_IDENT_DIDS : IDENT_DIDS)) { const v = await this.readDid(mod, did, kind === 'hex'); if (v) info.ident[label] = v; }
    if (mod.bmw != null && !Object.keys(info.ident).length) {   // E-series (KWP2000): identyfikacja 0x1A 0x80
      const r = await this.ureq(mod, '1A80', { attempts: 2 }); if (!r.err) info.ident['Identyfikacja (KWP)'] = asciiOrHex(bytesOf(r.data).slice(2));
    }
    const d = await this.readModuleDtcs(mod);
    info.dtcs = d.dtcs; info.untested = d.untested || 0; if (d.err) info.err = d.err;
    if (mod.bmw == null) {
      /* VAG: numer błędu to własny numer producenta, nie kod SAE. Kod P i opis tylko z bazy znanego sterownika. */
      const engine = mod.tx === 0x7E0;
      if (engine) { const fam = vagEcuFamily(info.ident['Nr części']); if (fam) { info.family = fam; info.ident['Rodzina sterownika'] = fam; } }
      info.dtcs = info.dtcs.map(x => resolveVagDtc(x, info.family, engine));
      /* Kontekst każdego błędu (ile razy, przy jakim przebiegu, kiedy): VAG trzyma go w danych rozszerzonych. */
      for (const x of info.dtcs.slice(0, 12)) { try { x.details = await this.readDtcDetails(mod, x.raw); } catch (e) { x.details = { err: e.message, ext: [], snap: null }; } }
    }
    return info;
  }
  async clearModule(mod) {
    const r = await this.ureq(mod, '14FFFFFF', { attempts: 6 });
    if (r.err && r.nrc && mod.bmw != null) return this.ureq(mod, '14FFFF', { attempts: 6 });   // KWP2000
    return r;
  }
  /* BMW: UDS 0x19 02, a gdy moduł nie zna tej usługi (starsze serie E na D-CAN) – KWP2000 0x18 02 FF FF. */
  async readBmwDtcs(mod) {
    let r = null;
    for (const mask of [0x2F, 0x0C, 0x08]) { r = await this.ureq(mod, '1902' + hex2(mask)); if (!r.err || r.nrc !== '31') break; }
    if (!r.err) {
      const b = bytesOf(r.data).slice(3); const all = [];
      for (let i = 0; i + 3 < b.length; i += 4) all.push(decodeUdsDtc(b[i], b[i + 1], b[i + 2], b[i + 3], true));
      const dtcs = all.filter(d => d.real);
      return { dtcs, untested: all.length - dtcs.length };
    }
    if (r.nrc === '11' || r.nrc === '12') {
      const k = await this.ureq(mod, '1802FFFF');
      if (!k.err) {
        const b = bytesOf(k.data); const n = b[1] || 0, list = [];
        for (let i = 2; i + 2 < b.length && list.length < n; i += 3) list.push(decodeKwpDtc(b[i], b[i + 1], b[i + 2]));
        return { dtcs: list, untested: 0, kwp: true };
      }
      return { err: k.err, dtcs: [], untested: 0 };
    }
    return { err: r.err, dtcs: [], untested: 0 };
  }
  async findUnknownBmw(onProgress) {
    const known = new Set(BMW_MODULES.map(m => m.bmw)); const found = [];
    await this.send('ATST32'); this.st = '32';
    try {
      for (let a = 0x00; a <= 0x7F; a++) {
        if (known.has(a)) continue;
        onProgress && onProgress(0x600 + a);
        const mod = { addr: hex2(a), name: 'Moduł BMW 0x' + hex2(a), bmw: a };
        if (await this.probe(mod, false)) found.push(mod);
      }
    } finally { this.st = '64'; await this.send('ATST64'); }
    return found;
  }
  async findUnknown(onProgress, bmw) {
    const known = new Set(MODULES.map(m => m.tx)); const found = [];
    if (bmw) return this.findUnknownBmw(onProgress);
    await this.send('ATST32'); this.st = '32';
    try {
      for (let tx = 0x700; tx < 0x775; tx++) {
        if (known.has(tx)) continue;
        onProgress && onProgress(tx);
        const nm = VAG_MOD_NAMES[tx];
        const mod = { addr: nm ? nm[0] : '??', name: nm ? nm[1] : 'Moduł 0x' + hex3(tx), tx, rx: tx + 0x6A };
        if (await this.probe(mod, false)) found.push(mod);
      }
    } finally { this.st = '64'; await this.send('ATST64'); }
    return found;
  }
}

if (typeof module !== 'undefined') module.exports = { ELM, BMW_MODULES, brandOf, PIDS, DERIVED, MODULES, parseElm, saeCode, DTC_DESC, parseMode06, classifyCmd, createIsoTp, midName };
