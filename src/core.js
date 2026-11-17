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
  { addr: '56', name: 'Radio', tx: 0x773, rx: 0x7DD }
];
const IDENT_DIDS = [['F187', 'Nr części'], ['F197', 'System'], ['F189', 'Oprogramowanie'], ['F191', 'Nr części HW'], ['F18C', 'Nr seryjny']];

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
  P0111: 'Czujnik temperatury powietrza dolotowego – zakres lub działanie',
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

function decodeUdsDtc(b0, b1, b2, st) {
  const code = saeCode(b0, b1);
  const flags = [st & 0x01 ? 'aktywny' : 'zapisany'];
  if (st & 0x08) flags.push('potwierdzony');
  if (st & 0x04) flags.push('oczekujący');
  if (st & 0x80) flags.push('kontrolka');
  flags.push('status 0x' + hex2(st));
  return { code, ftb: hex2(b2), full: `${code}-${hex2(b2)}`, status: st, real: (st & 0xAF) !== 0, flags, active: !!(st & 1), mil: !!(st & 0x80), desc: DTC_DESC[code] || '' };
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
    transport.onData(s => {
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
  async voltage() {
    const r = await this.send('ATRV');
    const m = r.join(' ').match(/(\d+(?:\.\d+)?)\s*V/i);
    return m ? parseFloat(m[1]) : null;
  }
  async select(tx, rx) {
    const key = tx + ':' + rx; if (this.cur === key) return;
    await this.send('ATSH' + hex3(tx)); await this.send('ATCRA' + hex3(rx));
    if (this.fcOk) {
      for (const c of ['ATFCSH' + hex3(tx), 'ATFCSD300000', 'ATFCSM1']) {
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
  async request(req, { attempts = 5 } = {}) {
    let pending = false;
    for (let a = 0; a < attempts; a++) {
      const { msgs, err } = parseElm(await this.send(req));
      if (err) { if (pending && err === 'NO DATA') { await sleep(300); continue; } return { err }; }
      const real = msgs.filter(m => !(m.startsWith('7F') && m.substr(4, 2) === '78'));
      if (real.length < msgs.length) pending = true;
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
    await this.select(0x7E0, 0x7E8);
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
    await this.select(0x7E0, 0x7E8);
    const out = {}; let queue = [...defs];
    while (queue.length) {
      const n = this.multiPid ? Math.min(6, queue.length) : 1;
      const ch = queue.splice(0, n);
      const r = await this.request('01' + ch.map(d => hex2(d.pid)).join(''), { attempts: 2 });
      if (r.err) { if (n > 1) { this.multiPid = false; queue = ch.concat(queue); } continue; }
      const p = parseMode01(r.data, ch);
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
    await this.select(0x7E0, 0x7E8);
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
    await this.select(0x7E0, 0x7E8);
    const r = await this.request('0101', { attempts: 2 });
    if (r.err) return null;
    const b = bytesOf(r.data).slice(2, 6);
    return b.length === 4 ? parseReadiness(b) : null;
  }
  async readVin() {
    await this.select(0x7E0, 0x7E8);
    for (const q of ['0902', '22F190']) {
      const r = await this.request(q, { attempts: 2 });
      if (!r.err) { const v = asciiOf(bytesOf(r.data).slice(3)); if (v.length >= 17) return v.slice(-17); }
    }
    return null;
  }
  async readFreeze(sup) {
    await this.select(0x7E0, 0x7E8);
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
  async clearObd() { await this.select(0x7E0, 0x7E8); return this.request('04', { attempts: 4 }); }

  /* ---- UDS, moduły VAG ---- */
  async probe(mod, deep) {
    await this.select(mod.tx, mod.rx);
    let r = await this.request('3E00', { attempts: 1 });
    let present = !r.err || !!r.nrc;
    if (!present && deep) { r = await this.request('22F187', { attempts: 1 }); present = !r.err || !!r.nrc; }
    return present;
  }
  async readDid(did) {
    const r = await this.request('22' + did, { attempts: 3 });
    if (r.err || !r.data.startsWith('62' + did)) return null;
    return asciiOrHex(bytesOf(r.data).slice(3));
  }
  async readModuleDtcs(mod) {
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
    for (const [did, label] of IDENT_DIDS) { const v = await this.readDid(did); if (v) info.ident[label] = v; }
    const d = await this.readModuleDtcs(mod);
    info.dtcs = d.dtcs; info.untested = d.untested || 0; if (d.err) info.err = d.err;
    return info;
  }
  async clearModule(mod) { await this.select(mod.tx, mod.rx); return this.request('14FFFFFF', { attempts: 6 }); }
  async findUnknown(onProgress) {
    const known = new Set(MODULES.map(m => m.tx)); const found = [];
    await this.send('ATST32');
    try {
      for (let tx = 0x700; tx < 0x775; tx++) {
        if (known.has(tx)) continue;
        onProgress && onProgress(tx);
        const mod = { addr: '??', name: 'Moduł 0x' + hex3(tx), tx, rx: tx + 0x6A };
        if (await this.probe(mod, false)) found.push(mod);
      }
    } finally { await this.send('ATST64'); }
    return found;
  }
}

/* ===== Symulator adaptera (tryb demo) ===== */
const DEMO_VIN = 'VSSZZZDEMO0000001';
const DEMO_MODS = {
  0x7E0: { addr: '01', sys: '1.8 TSI  DEMO', part: 'DEMO-01-0000', sw: '0001' },
  0x7E1: { addr: '02', sys: 'DSG  DEMO', part: 'DEMO-02-0000', sw: '0001' },
  0x713: { addr: '03', sys: 'ESP  DEMO', part: 'DEMO-03-0000', sw: '0001' },
  0x70E: { addr: '09', sys: 'BCM  DEMO', part: 'DEMO-09-0000', sw: '0001' },
  0x715: { addr: '15', sys: 'AIRBAG  DEMO', part: 'DEMO-15-0000', sw: '0001' },
  0x714: { addr: '17', sys: 'KOMBI  DEMO', part: 'DEMO-17-0000', sw: '0001' },
  0x710: { addr: '19', sys: 'GATEWAY  DEMO', part: 'DEMO-19-0000', sw: '0001' },
  0x712: { addr: '44', sys: 'EPS  DEMO', part: 'DEMO-44-0000', sw: '0001' }
};
const W2 = v => { const n = Math.max(0, Math.min(65535, Math.round(v))); return [n >> 8, n & 255]; };
const B1 = v => Math.max(0, Math.min(255, Math.round(v)));
const ENC = {
  0x03: s => [s.fuelSys, 0], 0x04: s => [B1(s.load * 2.55)], 0x05: s => [B1(s.coolant + 40)],
  0x06: s => [B1((s.stft + 100) * 1.28)], 0x07: s => [B1((s.ltft + 100) * 1.28)],
  0x0B: s => [B1(s.map)], 0x0C: s => W2(s.rpm * 4), 0x0D: s => [B1(s.speed)], 0x0E: s => [B1((s.timing + 64) * 2)],
  0x0F: s => [B1(s.iat + 40)], 0x10: s => W2(s.maf * 100), 0x11: s => [B1(s.tps * 2.55)],
  0x15: s => [B1(s.o2s2 * 200), 0xFF], 0x1F: s => W2(s.runTime), 0x23: s => W2(s.railP * 10), 0x2F: s => [B1(s.fuelLvl * 2.55)],
  0x33: s => [B1(s.baro)], 0x34: s => [...W2(s.lambdaA * 32768), ...W2((s.lambdaI + 128) * 256)],
  0x3C: s => W2((s.cat1 + 40) * 10), 0x3E: s => W2((s.cat2 + 40) * 10), 0x42: s => W2(s.ecuV * 1000),
  0x43: s => W2(s.absload * 2.55), 0x44: s => W2(s.lambdaCmd * 32768), 0x46: s => [B1(s.ambient + 40)],
  0x49: s => [B1(s.pedal * 2.55)], 0x5C: s => [B1(s.oil + 40)], 0x5E: s => W2(s.fuelRate * 20),
  0x61: s => [B1(s.tqDem + 125)], 0x62: s => [B1(s.tqAct + 125)],
  0x70: s => [0x03, ...W2(s.boostCmdAbs * 32), ...W2(s.boostActAbs * 32), 0, 0, 0, 0, 0x00],
  0x87: s => [0x01, ...W2(s.mapX * 32), 0, 0]
};

class DemoTransport {
  constructor() {
    this.name = 'Demo'; this.cb = null; this.tx = 0x7E0; this.t0 = Date.now(); this.last = 0;
    this.boost = -0.6; this.iat = 24; this.reset();
    this.freeze = { fuelSys: 4, load: 94, coolant: 91, stft: 1.2, ltft: 4.7, map: 196, rpm: 4120, speed: 88, timing: 12.5, iat: 47, maf: 118, tps: 96 };
  }
  reset() {
    this.obdStored = [[0x02, 0x99]];
    this.udsDtc = { '01': [[0x02, 0x99, 0x00, 0x08]], '03': [[0x50, 0xA0, 0x00, 0x08]], '19': [[0xC1, 0x21, 0x00, 0x08]], '09': [[0x00, 0x02, 0x07, 0x50], [0x00, 0x02, 0x0A, 0x50], [0x00, 0x03, 0x07, 0x40]] };
  }
  onData(cb) { this.cb = cb; }
  async write(s) {
    const cmd = s.replace(/[\r\n\s]/g, '').toUpperCase();
    const lines = this.handle(cmd);
    setTimeout(() => { this.cb && this.cb(lines.join('\r') + '\r\r>'); }, 15 + Math.random() * 25);
  }
  close() {}
  handle(c) {
    if (c.startsWith('AT')) {
      if (c === 'ATZ' || c === 'ATI') return ['ELM327 v1.5'];
      if (c === 'ATRV') return [this.sim().adapterV.toFixed(1) + 'V'];
      if (c.startsWith('ATSH')) { this.tx = parseInt(c.slice(4), 16); return ['OK']; }
      return ['OK'];
    }
    if (!/^[0-9A-F]+$/.test(c) || c.length % 2) return ['?'];
    const q = bytesOf(c);
    let r = null;
    if (this.tx === 0x7E0 || this.tx === 0x7DF) r = this.engine(q);
    else if (DEMO_MODS[this.tx]) r = this.uds(q, DEMO_MODS[this.tx]);
    return r ? this.frame(r) : ['NO DATA'];
  }
  frame(b) {
    if (b.length <= 7) return [b.map(hex2).join('')];
    const lines = [hex3(b.length), '0:' + b.slice(0, 6).map(hex2).join('')];
    let idx = 1;
    for (let i = 6; i < b.length; i += 7) { lines.push((idx % 16).toString(16).toUpperCase() + ':' + b.slice(i, i + 7).map(hex2).join('')); idx++; }
    return lines;
  }
  bitmap(base) {
    const sup = Object.keys(ENC).map(Number).concat([0x01]);
    const b = [0, 0, 0, 0];
    for (const p of sup) if (p > base && p <= base + 32) { const i = p - base - 1; b[i >> 3] |= 0x80 >> (i & 7); }
    if (sup.some(p => p > base + 32)) b[3] |= 0x01;
    return b;
  }
  engine(q) {
    const mode = q[0];
    if (mode === 0x01) {
      const pids = q.slice(1);
      if (pids.length === 1 && pids[0] % 0x20 === 0) return [0x41, pids[0], ...this.bitmap(pids[0])];
      if (pids.length === 1 && pids[0] === 0x01) return [0x41, 0x01, this.obdStored.length, 0x07, 0x65, 0x04];
      const s = this.sim(); const out = [0x41];
      for (const p of pids) { const e = ENC[p]; if (e) out.push(p, ...e(s).map(B1)); }
      return out.length > 1 ? out : null;
    }
    if (mode === 0x02) {
      const p = q[1];
      if (p === 0x02) { const d = this.obdStored[0] || [0, 0]; return [0x42, 0x02, 0x00, ...d]; }
      const e = ENC[p]; return (e && this.obdStored.length) ? [0x42, p, 0x00, ...e(this.freeze).map(B1)] : null;
    }
    if (mode === 0x03) return [0x43, this.obdStored.length, ...this.obdStored.flat()];
    if (mode === 0x07) return [0x47, 0x00];
    if (mode === 0x0A) return [0x4A, 0x00];
    if (mode === 0x04) { this.obdStored = []; this.udsDtc['01'] = []; return [0x44]; }
    if (mode === 0x09 && q[1] === 0x02) return [0x49, 0x02, 0x01, ...[...DEMO_VIN].map(c => c.charCodeAt(0))];
    return this.uds(q, DEMO_MODS[0x7E0]);
  }
  uds(q, m) {
    const sid = q[0]; const neg = c => [0x7F, sid, c];
    if (sid === 0x3E) return [0x7E, 0x00];
    if (sid === 0x10) return [0x50, q[1], 0x00, 0x32, 0x01, 0xF4];
    if (sid === 0x22) {
      const did = u16(q[1], q[2]);
      const txt = { 0xF187: m.part, 0xF197: m.sys, 0xF189: m.sw, 0xF190: DEMO_VIN }[did];
      if (txt == null) return neg(0x31);
      return [0x62, q[1], q[2], ...[...txt].map(c => c.charCodeAt(0))];
    }
    if (sid === 0x19 && q[1] === 0x02) return [0x59, 0x02, 0xFF, ...(this.udsDtc[m.addr] || []).flat()];
    if (sid === 0x14) { this.udsDtc[m.addr] = []; if (m.addr === '01') this.obdStored = []; return [0x54]; }
    return neg(0x11);
  }
  sim() {
    const now = Date.now(); const t = (now - this.t0) / 1000;
    const dt = this.last ? Math.min(1, (now - this.last) / 1000) : 0.2; this.last = now;
    const warm = Math.min(1, t / 120);
    const ph = t % 26; const R = a => (Math.random() - 0.5) * a;
    let rpm, load, tps, cmd, speed, cut = false, accel = false, k = 0, idle = false;
    if (ph < 8) { idle = true; rpm = 785 + R(20); load = 21 + R(2); tps = 0; cmd = -0.62; speed = 0; }
    else if (ph < 14) { k = (ph - 8) / 6; accel = true; rpm = 1600 + 4200 * k + R(40); load = 88 + 8 * k; tps = 96; cmd = 1.2; speed = 25 + 95 * k; }
    else if (ph < 20) { rpm = 2350 + R(30); load = 36 + R(3); tps = 17; cmd = 0.04; speed = 105; }
    else if (ph < 23) { k = (ph - 20) / 3; rpm = 2350 - 1450 * k; load = 11; tps = 0; cmd = -0.72; cut = true; speed = 105 - 70 * k; }
    else { idle = true; rpm = 790 + R(20); load = 22; tps = 0; cmd = -0.62; speed = 0; }
    const target = accel ? Math.min(cmd, 0.97) : cmd; // turbo nie dobija do zadanego – pasuje do P0299
    this.boost += (target - this.boost) * (1 - Math.exp(-dt * 3));
    this.iat += ((accel ? 52 : 24) - this.iat) * (1 - Math.exp(-dt * 0.5));
    const baro = 99, ambient = 9;
    const actAbs = baro + this.boost * 100, cmdAbs = baro + cmd * 100;
    const lambdaCmd = accel && k > 0.25 ? 0.86 : 1.0;
    const fuelSys = warm < 0.35 ? 1 : (cut ? 4 : (accel && k > 0.25 ? 4 : 2));
    const lambdaA = cut ? 1.99 : lambdaCmd + R(0.02);
    const maf = Math.max(2, rpm * 1.8 / 120 * 1.2 * (load / 100) * (1 + Math.max(0, this.boost)));
    return {
      rpm, load, absload: load * 1.1, tps, pedal: accel ? 100 : (tps > 0 ? tps + 3 : 0), speed,
      timing: accel ? 9 + 6 * k : cut ? 0 : idle ? 7 + R(2) : 31,
      coolant: Math.round(64 + 26 * warm + (accel ? 2 : 0)), oil: Math.round(50 + 42 * warm + (accel ? 4 * k : 0)),
      iat: Math.round(this.iat), ambient, cat1: 380 + 420 * warm + (accel ? 120 * k : 0), cat2: 300 + 380 * warm,
      map: Math.min(255, Math.max(20, actAbs)), mapX: Math.max(20, actAbs), baro,
      boostCmdAbs: Math.max(20, cmdAbs), boostActAbs: Math.max(20, actAbs), maf,
      lambdaCmd, lambdaA, lambdaI: (lambdaA - 1) * 1.2, stft: cut ? 0 : R(5), ltft: 4.7, fuelSys,
      railP: accel ? 160 + 40 * k : cut ? 40 : idle ? 52 : 85, o2s2: cut ? 0.05 : 0.68 + R(0.03),
      tqDem: accel ? 95 : cut ? 0 : idle ? 4 : 24, tqAct: accel ? 88 : cut ? 0 : idle ? 4 : 23,
      fuelRate: cut ? 0 : maf / (14.7 * lambdaA) * 3.6 / 0.745, fuelLvl: 62, runTime: Math.round(t),
      ecuV: 14.15 + R(0.06), adapterV: 14.1 + R(0.1)
    };
  }
}

if (typeof module !== 'undefined') module.exports = { ELM, DemoTransport, PIDS, DERIVED, MODULES, parseElm, saeCode, DTC_DESC };
