/* VAG: dane, które precyzują skan i raport.
   - Adresy CAN modułów: patrz niżej.
   - Rekordy 0x01 i 0x02 danych rozszerzonych (0x19 06) i znacznik 0x02BD: układ opisany w badaniach pashokitsme/vagcan
     (research/odis-dtc/freeze-frames.md), potwierdzony niezależnie przez NinjaStyle82/dtcsweep (MIT, decode_vw_extended)
     i zgodny z wydrukami VCDS (priorytet, częstość, licznik zapomnienia, przebieg, data i godzina). Implementacja własna.
   - Numery błędów Simos18, rodziny sterowników i pomiary 0x22 Simos18: bri3d/VW_Flash (BSD 2-Clause).
   Moduły VAG po UDS zgłaszają błąd jako własny 3-bajtowy numer (VCDS pokazuje go dziesiętnie, np. 19225),
   a nie jako kod SAE. Kod P/U/B/C i opis bierze się z bazy danego sterownika. */

/* Nazwy modułów po identyfikatorze żądania (TX). Odpowiedź = TX + 0x6A (silnik i skrzynia: +8).
   Tylko identyfikatory potwierdzone w otwartych źródłach: wiki mr-fix.info (CAN-BUS sniffing), OVMS vweup_obd.h (MIT),
   GoingElectric (lista OBD2 VW e-Up), SenseiIssei/Caruspex data/ecus/vag.csv (MIT) i adresy z zestawów OBDb (fakty, CC BY-SA).
   Adres VAG (dwa znaki) tylko tam, gdzie źródło go podaje; nazwy własne. */
const VAG_MOD_NAMES = {
  0x7E0: ['01', 'Elektronika silnika'], 0x7E1: ['02', 'Skrzynia biegów'], 0x7E2: ['??', 'Drugi sterownik silnika'],
  0x70A: ['10', 'Asystent parkowania'], 0x70B: ['??', 'Kontrola ciśnienia w oponach'], 0x70C: ['16', 'Kolumna kierownicy'],
  0x70E: ['09', 'Elektronika centralna'], 0x70F: ['22', 'Napęd na cztery koła'], 0x710: ['19', 'Gateway'], 0x711: ['25', 'Immobilizer'],
  0x712: ['44', 'Wspomaganie kierownicy'], 0x713: ['03', 'ABS / ESP'], 0x714: ['17', 'Zestaw wskaźników'], 0x715: ['15', 'Poduszki powietrzne'],
  0x71D: ['??', 'Pompa sprzęgła napędu 4x4'], 0x742: ['??', 'Ogrzewanie (moduł dodatkowy)'], 0x746: ['08', 'Klimatyzacja'],
  0x74F: ['A5', 'Czujniki przednie asystentów (kamera, radar)'], 0x752: ['??', 'Hamulec postojowy'], 0x767: ['75', 'Telematyka'],
  0x773: ['5F', 'Elektronika informacyjna (radio, MIB)']
};
/* Moduły sprawdzane w zwykłym skanie oprócz podstawowej listy (pełne przeszukanie i tak sprawdza 0x700–0x774). */
const VAG_EXTRA_MODULES = [0x752, 0x70A, 0x74F, 0x70B, 0x711, 0x767]
  .map(tx => ({ addr: VAG_MOD_NAMES[tx][0], name: VAG_MOD_NAMES[tx][1], tx, rx: tx + 0x6A }));

function vagEcuFamily(part) {
  const p = String(part || '').replace(/[\s.-]/g, '').toUpperCase();
  if (!p) return null;
  for (const [f, list] of Object.entries(VAG_ECU_FAMILY)) if (list.includes(p)) return f;
  return null;
}
const isSimos18 = f => /^Simos18/.test(f || '');

/* Błąd z modułu VAG: numer VAG + ewentualnie kod z bazy sterownika. Surowe bajty zostają w d.raw. */
function resolveVagDtc(d, family, isEngine) {
  const n = parseInt(d.raw, 16);
  const o = { ...d, vagNo: n, saeGuess: d.full };
  const hit = isEngine && isSimos18(family) ? SIMOS18_DTC[n] : null;
  if (hit) {
    const code = hit[0].slice(0, 5), ftb = hit[0].slice(5);
    Object.assign(o, { code, ftb, full: `${n} · ${code} ${ftb}`, desc: DTC_DESC[code] && ftb === '00' ? DTC_DESC[code] : hit[1], descEn: hit[1], dbSrc: 'Simos18' });
  } else Object.assign(o, { code: String(n), full: String(n), desc: '', vagOnly: true });
  return o;
}

/* Data i godzina z 4 bajtów (6 b rok od 2000, 4 miesiąc, 5 dzień, 5 godzina, 6 minuta, 6 sekunda). */
function vagClock(b) {
  if (!b || b.length !== 4) return null;
  const c = ((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3];
  const t = { y: 2000 + (c >>> 26), mo: (c >>> 22) & 15, d: (c >>> 17) & 31, h: (c >>> 12) & 31, mi: (c >>> 6) & 63, s: c & 63 };
  if (t.mo < 1 || t.mo > 12 || t.d < 1 || t.d > 31 || t.h > 23 || t.mi > 59 || t.s > 59) return null;
  const p = n => String(n).padStart(2, '0');
  return `${t.y}-${p(t.mo)}-${p(t.d)} ${p(t.h)}:${p(t.mi)}:${p(t.s)}`;
}
const u24 = b => (b[0] << 16) + (b[1] << 8) + b[2];

/* Znacznik 0x02BD (stan teraz): dokładnie 10 bajtów, inaczej odrzucamy (inne układy dają fałszywy przebieg). */
function parseVagStamp(b) {
  if (!b || b.length !== 10) return null;
  const km = u24(b.slice(1, 4)), time = vagClock(b.slice(6, 10));
  return time ? { km, time } : null;
}

/* Kontekst błędu z rekordów 0x01 (priorytet, częstość) i 0x02 (licznik zapomnienia, przebieg, czas). */
function vagFaultContext(ext, stamp) {
  if (!ext || !ext.length) return null;
  const r1 = ext.find(r => r.rec === 1 && r.bytes.length === 2), r2 = ext.find(r => r.rec === 2 && r.bytes.length === 10);
  if (!r1 && !r2) return null;
  const o = {};
  if (r1) { o.priority = r1.bytes[0]; o.freq = r1.bytes[1]; }
  if (r2) {
    const b = r2.bytes, km = u24(b.slice(1, 4)), time = vagClock(b.slice(6, 10));
    o.aging = b[0];
    if (time && (!stamp || km <= stamp.km)) { o.km = km; o.time = time; if (stamp) o.kmAgo = stamp.km - km; }
  }
  return o;
}
function vagContextText(c) {
  if (!c) return '';
  const nf = n => n.toLocaleString('pl-PL');
  const L = [];
  if (c.freq != null) L.push(`wystąpień: ${c.freq === 255 ? '255 lub więcej' : c.freq}`);
  if (c.priority != null) L.push(`priorytet: ${c.priority}`);
  if (c.km != null) L.push(`przebieg: ${nf(c.km)} km${c.kmAgo != null ? ` (${c.kmAgo === 0 ? 'teraz' : nf(c.kmAgo) + ' km temu'})` : ''}`);
  if (c.time) L.push(`czas: ${c.time} (zegar auta)`);
  if (c.aging != null) L.push(`licznik zapomnienia: ${c.aging}`);
  return L.join(' · ');
}

/* Pomiary Simos18 (EA888 gen. 3, MQB) przez UDS 0x22 na 0x7E0. Lista i przeliczniki: VW_Flash logs/csv/parameters_22.csv.
   [DID, nazwa, jednostka, bajty, ze znakiem, przelicznik, para (DID wartości zadanej)] */
const SIMOS18_DIDS = [
  [0xF40C, 'Obroty silnika', 'obr/min', 2, 0, x => x / 4],
  [0x2033, 'Prędkość', 'km/h', 2, 0, x => x / 100],
  [0x210F, 'Bieg', '', 2, 0, x => x],
  [0x1070, 'Pedał gazu', '%', 2, 0, x => x / 10.24],
  [0x20BA, 'Przepustnica', '%', 2, 1, x => x / 10],
  [0x437C, 'Moment obrotowy', 'Nm', 2, 1, x => x / 10, 0x4380],
  [0x4380, 'Moment żądany', 'Nm', 2, 1, x => x / 10],
  [0x202A, 'Ciśnienie przed przepustnicą (doładowanie)', 'kPa', 2, 0, x => x / 10, 0x2029],
  [0x2029, 'Ciśnienie przed przepustnicą zadane', 'kPa', 2, 0, x => x / 10],
  [0x39C0, 'Ciśnienie w kolektorze (MAP)', 'kPa', 2, 0, x => x / 10, 0x39C1],
  [0x39C1, 'Ciśnienie w kolektorze zadane', 'kPa', 2, 0, x => x / 10],
  [0x13CA, 'Ciśnienie atmosferyczne', 'kPa', 2, 0, x => x / 120.60176665439],
  [0x39A2, 'Wastegate', '%', 2, 0, x => 100 - x / 100, 0x39A3],
  [0x39A3, 'Wastegate zadany', '%', 2, 0, x => 100 - x / 100],
  [0x1040, 'Obroty turbosprężarki', 'tys. obr/min', 2, 0, x => x / 163.84],
  [0x2032, 'Przepływ powietrza', 'kg/h', 2, 0, x => x],
  [0x1001, 'Temperatura dolotu', '°C', 1, 0, x => x * 0.75 - 48],
  [0x1041, 'Temperatura powietrza przy turbosprężarce', '°C', 2, 1, x => x * 0.005859375 + 144],
  [0x1004, 'Temperatura otoczenia', '°C', 2, 1, x => x / 128],
  [0x11CD, 'Temperatura płynu chłodzącego', '°C', 1, 0, x => x - 40],
  [0x202F, 'Temperatura oleju', '°C', 2, 0, x => (x - 2731.4) / 10],
  [0x101E, 'Wentylator chłodnicy', '%', 1, 0, x => x * 0.390625],
  [0x2004, 'Wyprzedzenie zapłonu (średnie)', '°', 2, 1, x => x / 100],
  [0x200A, 'Korekta spalania stukowego cyl. 1', '°', 2, 1, x => x / 100],
  [0x200B, 'Korekta spalania stukowego cyl. 2', '°', 2, 1, x => x / 100],
  [0x200C, 'Korekta spalania stukowego cyl. 3', '°', 2, 1, x => x / 100],
  [0x200D, 'Korekta spalania stukowego cyl. 4', '°', 2, 1, x => x / 100],
  [0x2904, 'Licznik wypadania zapłonów', '', 2, 0, x => x],
  [0x201E, 'Wałek dolotowy (pozycja)', '°', 2, 1, x => 30 - x / 10],
  [0x201A, 'Wałek wydechowy (pozycja)', '°', 2, 1, x => x / 10 - 24],
  [0x167C, 'Wznios zaworów (AVS)', '', 1, 0, x => x],
  [0x295C, 'Klapy kolektora dolotowego', '', 1, 0, x => x],
  [0x10C0, 'Lambda', 'λ', 2, 0, x => x / 1024, 0xF444],
  [0xF444, 'Lambda zadana', 'λ', 2, 0, x => x / 32768],
  [0xF406, 'Korekta krótkoterminowa (STFT)', '%', 1, 0, x => x / 1.28 - 100],
  [0xF407, 'Korekta długoterminowa (LTFT)', '%', 1, 0, x => x / 1.28 - 100],
  [0x2027, 'Ciśnienie paliwa – wtrysk bezpośredni', 'bar', 2, 0, x => x / 10, 0x293B],
  [0x293B, 'Ciśnienie paliwa DI zadane', 'bar', 2, 0, x => x / 10],
  [0x2025, 'Ciśnienie paliwa – wtrysk pośredni (MPI)', 'bar', 2, 0, x => x / 1000, 0x2932],
  [0x2932, 'Ciśnienie paliwa MPI zadane', 'bar', 2, 0, x => x / 1000],
  [0x209A, 'Wydajność pompy wysokiego ciśnienia', '%', 2, 0, x => x / 100],
  [0x2028, 'Wysterowanie pompy niskiego ciśnienia', '%', 2, 0, x => x / 100],
  [0x13A0, 'Czas wtrysku DI', 'ms', 2, 0, x => x / 250],
  [0x13AC, 'Czas wtrysku MPI', 'ms', 2, 0, x => x / 250],
  [0xF452, 'Zawartość etanolu', '%', 1, 0, x => x / 2.55],
  [0x14A6, 'Napięcie zasilania', 'V', 1, 0, x => x * 0.1015625],
  [0x14EC, 'Obciążenie procesora sterownika', '%', 2, 0, x => x * 0.09765625],
  [0x203C, 'Tempomat', '', 2, 0, x => x]
].map(([did, name, unit, len, signed, fn, sp]) => ({ did, name, unit, len, signed: !!signed, fn, sp }));
const SIMOS18_SP = new Set(SIMOS18_DIDS.filter(d => d.sp).map(d => d.sp));
function decodeSimosDid(def, b) {
  if (!b || b.length !== def.len) return null;
  let x = def.len === 2 ? (b[0] << 8) + b[1] : b[0];
  if (def.signed) x = def.len === 2 ? (x << 16) >> 16 : (x << 24) >> 24;
  const v = def.fn(x);
  return isFinite(v) ? v : null;
}
/* Dodatkowe moduły do zwykłego skanu (pełne przeszukanie i tak sprawdza 0x700–0x774). */
for (const m of VAG_EXTRA_MODULES) if (!MODULES.some(x => x.tx === m.tx)) MODULES.push(m);
