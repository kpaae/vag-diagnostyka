/* Baza kodów błędów: opisy i typowe przyczyny (VAG i BMW).
   Zawiera tylko wpisy, które mają źródło (pole s). To podpowiedź, a nie diagnoza:
   kod mówi, który obwód lub funkcja zgłosiły usterkę, nie które część jest zepsuta.
   Opisy tłumaczone własnymi słowami. Rozbieżności między źródłami oznaczone u:1. */

const DTC_SRC = {
  tsb: ['Biuletyn BMW (vehicleservicepros.com)', 'https://www.vehicleservicepros.com/tsbs/article/53094694/update-needed-for-rough-running-bmw'],
  gk: ['Opis zbiorczy kodu 21A02D', 'https://grokipedia.com/page/BMW_fault_code_21A02D'],
  eu: ['europarts360.com', 'https://europarts360.com/blogs/guide/bmw-common-fault-codes-explained-symptoms-causes-how-to-fix-them'],
  bt: ['bimmertalk.com', 'https://bimmertalk.com/tools/fault-code'],
  fp: ['onefastshop.com (paliwo N54/N55/B58)', 'https://onefastshop.com/blogs/blog/bmw-low-fuel-pressure-codes-29f2-29dc-lpfp-failing'],
  us: ['blog.usro.net', 'https://blog.usro.net/2025/04/bmw-fault-dtc-codes-complete-list-explained/'],
  ef: ['enginefinder.co.za (VW)', 'https://www.enginefinder.co.za/blog/problems/vw-error-codes-problems/'],
  bc: ['brightcoding.dev (VAG)', 'https://converter.brightcoding.dev/vag-obd-codes']
};

/* Brakujące opisy SAE (dołączane do DTC_DESC). */
const DTC_EXTRA = {
  P0014: 'Wałek rozrządu wydechowy – położenie (bank 1)',
  P0174: 'Mieszanka za uboga (bank 2)',
  P0193: 'Ciśnienie paliwa w szynie – sygnał za wysoki',
  P0341: 'Czujnik położenia wałka rozrządu – zakres lub działanie',
  P0430: 'Sprawność katalizatora poniżej progu (bank 2)',
  P0442: 'Układ odparowania paliwa (EVAP) – mały wyciek',
  P0496: 'Układ odparowania paliwa (EVAP) – zbyt duży przepływ oczyszczania',
  P2463: 'Filtr cząstek stałych (DPF) – nagromadzenie sadzy'
};

/* Przyczyny dla kodów SAE (VAG, BMW i inne). c = lista od najczęstszej, w = ostrzeżenie. */
const DTC_CAUSES = {
  P0299: { s: ['ef', 'bc'], c: ['Nieszczelność układu doładowania: pęknięta rura, kolanko, opaska, intercooler', 'Siłownik wastegate, zawór N75 lub zawór upustowy (diverter)', 'Nieszczelne przewody podciśnienia', 'Zacznij od próby ciśnieniowej dolotu'] },
  P0234: { s: ['ef'], c: ['Wastegate zablokowany w pozycji zamkniętej', 'Zatkany przewód sterujący lub wadliwy zawór sterujący doładowaniem'], w: 'Długotrwałe nadmierne doładowanie jest groźne dla silnika.' },
  P0300: { s: ['ef', 'bc', 'eu'], c: ['Cewki zapłonowe i świece (przetestuj zamianą cewek między cylindrami)', 'Osad na zaworach dolotowych w silnikach z wtryskiem bezpośrednim', 'Nieszczelność układu PCV/CCV (podciśnienie)', 'Wtryskiwacze'], w: 'Migająca kontrolka MIL oznacza ryzyko zniszczenia katalizatora.' },
  P0171: { s: ['eu'], c: ['Nieszczelności dolotu, gumy, kolektor', 'Układ odmy (CCV/PCV)', 'Przepływomierz (MAF)', 'Słabe zasilanie paliwem: pompa, wtryskiwacze'] },
  P0420: { s: ['eu', 'ef'], c: ['Najpierw sonda lambda za katalizatorem', 'Nieszczelność układu wydechowego', 'Wypadanie zapłonów lub uboga mieszanka (np. razem z P0171)', 'Dopiero na końcu zużyty katalizator'] },
  P0011: { s: ['ef', 'bc'], c: ['Zablokowany zawór N205 (VVT), często od brudnego lub zbyt niskiego oleju', 'Zła klasa lub zużyty olej i filtr', 'Rozciągnięty łańcuch lub zużyty fazownik'] },
  P0016: { s: ['ef'], c: ['Rozciągnięty łańcuch rozrządu i zużyty napinacz', 'Wymieniaj łańcuch, napinacz i prowadnice, nie tylko czujniki', 'W VCDS sprawdź adaptację wałka: silnie ujemna wartość potwierdza rozciągnięcie'], w: 'Razem z P0341 i skrajną adaptacją łańcuch może przeskoczyć i zagiąć zawory. Nie jeźdź na siłę.' },
  P0341: { s: ['ef'], c: ['Rozciągnięty łańcuch rozrządu (silniki TSI)', 'Sprawdź adaptację wałka w VCDS, zanim wymienisz czujnik'] },
  P0087: { s: ['ef', 'fp'], c: ['Pompa wysokiego ciśnienia lub zapchany filtr', 'W TDI: pompa CP4', 'W BMW N54/N55: pompa HPFP, niska strona paliwa, czujniki ciśnienia'], w: 'Opiłki metalu w filtrze paliwa: zanieczyszczony cały układ, wymiana pompy, wtryskiwaczy i przewodów.' },
  P0193: { s: [], c: [] },
  P0401: { s: ['ef'], c: ['Zapchany lub zablokowany zawór EGR', 'Zatkana chłodnica EGR lub zasadzony kolektor', 'Najpierw czyszczenie, potem wymiana'] },
  P0441: { s: ['bc'], c: ['Zawór odpowietrzania zbiornika (purge)'] },
  P0455: { s: ['bt'], c: ['Najpierw korek wlewu paliwa i jego uszczelka'] },
  P2015: { s: ['ef', 'bc'], c: ['Nagar na klapach kolektora dolotowego (silniki z wtryskiem bezpośrednim)', 'Pęknięty drążek lub zużyty czujnik położenia klap', 'W VCDS ten sam błąd to 18447'] },
  P2463: { s: ['ef'], c: ['Czujnik ciśnienia DPF', 'Rzeczywiście zapchany filtr po jeździe na krótkich trasach: wymuszona regeneracja, czyszczenie lub wymiana'] },
  P0014: { s: ['bt'], c: ['Elektrozawór VANOS nie doprowadza wałka do zadanej pozycji: brud, olej, łańcuch (patrz 2A82)'] }
};

/* Kody BMW, klucz = 6 znaków hex z UDS lub 4 znaki (starsze oznaczenia ISTA). d = opis, c = przyczyny. */
const BMW_DTC = {
  '21A02D': { d: 'Regulacja spalania: korekta wzniosu zaworów (Valvetronic) na biegu jałowym', s: ['tsb', 'gk'], c: ['Błąd oprogramowania DME: aktualizacja w ISTA (biuletyn BMW). Jeśli to jedyny zapisany błąd, nie wymieniaj części', 'Adaptacja wzniosu zaworów (Valvetronic) po pracach przy silniku', 'Inne błędy zapłonu lub mieszanki zapisane obok', 'Nieszczelność dolotu, słabo osadzone cewki lub świece, luźne wtyczki'], n: 'Objaw: nierówny bieg jałowy, szarpanie przy ruszaniu. Opisywano silniki B46, B48, B58.' },
  '2A82': { d: 'VANOS: zawór lub wałek rozrządu nie osiąga zadanej pozycji', s: ['eu', 'bt'], u: 1, c: ['Zabrudzone lub zablokowane elektrozawory VANOS (często wymienia się parami)', 'Stary lub zdegradowany olej, niskie ciśnienie oleju', 'Rozciągnięty łańcuch rozrządu, zużyte prowadnice (N20/N26)'], n: 'Źródła różnią się co do strony: dolotowa czy wydechowa. Sprawdź w ISTA.' },
  '2A87': { d: 'VANOS: elektrozawór nie osiąga zadanej pozycji', s: ['bt', 'us'], u: 1, c: ['Te same przyczyny co 2A82: brud w zaworach, olej, łańcuch'] },
  '2A98': { d: 'VANOS: elektrozawór nie osiąga zadanej pozycji', s: ['bt'], c: ['Te same przyczyny co 2A82'] },
  '2D06': { d: 'Rozbieżne opisy w źródłach: odchylenie ustawienia rozrządu albo za mały przepływ powietrza (MAF)', s: ['eu', 'us'], u: 1, c: ['Jeśli to rozrząd: rozciągnięty łańcuch, prowadnice, VANOS, brak oleju', 'Jeśli to MAF: czujnik, nieszczelność dolotu'] },
  '30FF': { d: 'Ciśnienie doładowania nie zgadza się z zadanym', s: ['eu', 'bt'], c: ['Pęknięta rura doładowania, nieszczelności', 'Wastegate zablokowany lub stukający', 'Zawory upustowe (diverter) i ich przewody podciśnienia'], n: 'Opisywano N54, N55, S55.' },
  '2DF1': { d: 'Błąd położenia wastegate', s: ['bt'], c: [] },
  '29E0': { d: 'Regulacja mieszanki, bank 1: za uboga', s: ['eu', 'fp'], c: ['Nieszczelności dolotu: gumy, układ odmy PCV/CCV, uszczelki', 'Przepływomierz (MAF)', 'Słabe zasilanie paliwem: pompa, wtryskiwacze'] },
  '29E1': { d: 'Regulacja mieszanki, bank 2', s: ['fp'], c: [] },
  '29F0': { d: 'Bank 1: adaptacja mieszanki na granicy (za uboga)', s: ['bt'], c: ['Układ pracuje na ubogiej mieszance: patrz 29E0'] },
  '29F2': { d: 'Wysokie ciśnienie paliwa: ciśnienie spadło poniżej zadanego (N54)', s: ['fp'], c: ['Pompa wysokiego (HPFP) lub niskiego ciśnienia, zapchany filtr', 'Czujnik ciśnienia niskiego lub wysokiego, regulator, zawór sterujący, wtryskiwacz', 'Luźna wtyczka', 'Zarejestruj ciśnienie niskiej strony i szyny jednocześnie'] },
  '29DC': { d: 'Odcięcie wtrysku: za niskie ciśnienie w układzie wysokiego ciśnienia (N54)', s: ['fp', 'bt'], u: 1, c: ['Pompa HPFP, albo pompa niskiego ciśnienia (LPFP) niewydolna pod doładowaniem', 'Jeśli niska strona trzyma: wymień HPFP i skasuj adaptacje. Jeśli niska strona siada: LPFP, filtr, moduł EKP'], n: 'Jedno ze źródeł wiąże ten kod w N55 z luzem tulejek siłownika wastegate.' },
  '29F1': { d: 'Ciśnienie w szynie nie zgadza się z wartością z zaworu sterującego', s: ['fp'], c: ['Często razem z 29F2', 'Po wymianie HPFP skasuj adaptacje zaworu i zaktualizuj oprogramowanie'] },
  '29F3': { d: 'Czujnik niskiego ciśnienia paliwa: błąd obwodu', s: ['fp'], c: ['Czujnik i jego wtyczka, zanim wymienisz jakąkolwiek pompę'] },
  '29E2': { d: 'Czujnik ciśnienia w szynie: sygnał błędny lub brak', s: ['fp'], c: ['Czujnik, często razem z 29DC'] },
  '2FBF': { d: 'Niskie ciśnienie przy zwolnieniu wtrysku podczas rozruchu (długie kręcenie)', s: ['fp'], c: ['HPFP lub niskie ciśnienie przy rozruchu'] },
  '2FBE': { d: 'Ciśnienie w szynie spadło po wyłączeniu silnika', s: ['fp'], c: ['Jednorazowo zwykle bez znaczenia. Powtarzane z długim rozruchem: HPFP lub nieszczelny wtryskiwacz'] },
  '2AAF': { d: 'Niska strona paliwa nie osiągnęła zadanego ciśnienia', s: ['fp'], c: ['Pompa niskiego ciśnienia (LPFP), filtr w zbiorniku, moduł EKP', 'Typowe w autach po tuningu'] },
  '2EF8': { d: 'Pompa wysokiego ciśnienia (HPFP) nie utrzymuje ciśnienia w szynie', s: ['bt'], c: ['Zużyta HPFP (znana przypadłość N54, opisywana też w N55 i S55)'], n: 'Zwykle razem z P0087.' },
  '29D9': { d: 'Wypadanie zapłonów przy niskim poziomie paliwa w zbiorniku', s: ['fp'], c: ['Zatankuj przed dalszą diagnozą'] },
  '2FBC': { d: 'Sygnał zaworu sterującego objętością w HPFP (to nie błąd ciśnienia)', s: ['fp'], c: [] },
  '11A002': { d: 'Wysokie ciśnienie paliwa: ciśnienie za niskie (wiarygodność)', s: ['fp'], c: ['Zmierz ciśnienie w przewodzie zasilającym (te auta mogą nie mieć czujnika niskiej strony)', 'HPFP, albo pompa i moduł EKP, jeśli ciśnienie w przewodzie jest niskie'], n: 'Wariant przy zimnym rozruchu: 11AC02.' },
  '11AC02': { d: 'Wysokie ciśnienie paliwa za niskie przy zimnym rozruchu', s: ['fp'], c: ['Patrz 11A002'] },
  '119404': { d: 'Czujnik ciśnienia w szynie: zablokowany sygnał', s: ['fp'], c: [] },
  '110001': { d: 'Wyłączenie wtrysku dla ochrony katalizatora z powodu niskiego ciśnienia paliwa', s: ['fp'], c: [] },
  '11A401': { d: 'Wysokie ciśnienie paliwa przy zwolnieniu wtrysku za niskie', s: ['fp'], c: [] },
  '481B03': { d: 'Prąd silnika pompy paliwa za niski (moduł EKP)', s: ['fp'], c: ['Sprawdź moduł EKP'] },
  '11A605': { d: 'Wydajność dostawy paliwa za niska (B58)', s: ['fp'], c: ['Filtr w zbiorniku i okablowanie EKP w pierwszej kolejności'] },
  '2E82': { d: 'Chłodzenie: awaria elektrycznej pompy wody', s: ['us'], c: [], w: 'Ryzyko przegrzania silnika.' },
  '2E85': { d: 'Chłodzenie: błąd komunikacji z pompą wody', s: ['us'], c: [] },
  '2C31': { d: 'Sonda lambda za katalizatorem', s: ['us'], c: [] },
  '8003': { d: 'Zwiększone rozładowanie akumulatora w postoju', s: ['bt'], c: ['Pobór prądu przez moduł, który nie zasypia'] },
  '9C68': { d: 'Akumulator / czujnik IBS', s: ['bt'], c: ['Uszkodzony czujnik IBS albo brak rejestracji akumulatora po wymianie'] },
  '5E19': { d: 'DSC: błąd czujnika ciśnienia hamulcowego', s: ['us'], c: [] },
  '2F44': { d: 'Immobilizer EWS: błąd komunikacji', s: ['us'], c: [] },
  'CF15': { d: 'Skrzynia: nieprawdopodobny bieg', s: ['us'], c: [] },
  'A0B5': { d: 'CAS: nie wykryto przycisku start', s: ['us'], c: [] },
  'A0B6': { d: 'Ogólny błąd „Drivetrain Malfunction” (ograniczona moc)', s: ['bt'], c: ['To tylko zbiorczy kod: czytaj kody towarzyszące'] }
};

/* Szuka wpisu dla kodu. bmw=true: klucz 6-znakowy, a gdy to nie trafi i kod zaczyna się od 00, 4-znakowy. */
function dtcInfo(code, bmw) {
  if (!code) return null;
  const k = String(code).toUpperCase();
  if (bmw) {
    const e = BMW_DTC[k] || (k.length === 6 && k.startsWith('00') ? BMW_DTC[k.slice(2)] : null);
    return e ? { desc: e.d, causes: e.c || [], warn: e.w || '', note: e.n || '', uncertain: !!e.u, src: (e.s || []).map(x => DTC_SRC[x]).filter(Boolean) } : null;
  }
  const e = DTC_CAUSES[k];
  if (!e || (!e.c.length && !e.w)) return null;
  return { desc: DTC_DESC[k] || '', causes: e.c, warn: e.w || '', note: '', uncertain: false, src: (e.s || []).map(x => DTC_SRC[x]).filter(Boolean) };
}
function bmwDesc(code) { const e = dtcInfo(code, true); return e ? e.desc : ''; }
Object.assign(DTC_DESC, DTC_EXTRA);
