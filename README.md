# VAG Diagnostyka

Webowa aplikacja diagnostyczna dla aut grupy VAG (VW, Audi, Seat/Cupra, Škoda), która łączy się z adapterem ELM327 bezpośrednio z przeglądarki. Nie trzeba niczego instalować ani mieć serwera, bo całość to jeden plik HTML.

**Uruchom:** https://kpaae.github.io/vag-diagnostyka/

## Co potrafi

**Parametry na żywo** (standardowe OBD-II, tryb 01), pogrupowane i z orientacyjnymi progami alarmowymi:

| Grupa | Parametry |
|---|---|
| Silnik | obroty, prędkość, obciążenie, przepustnica, pedał, wyprzedzenie zapłonu, moment żądany i rzeczywisty, zużycie paliwa, napięcie |
| Chłodzenie | płyn chłodzący, olej, powietrze dolotowe, nagrzanie dolotu ponad otoczenie, temperatury katalizatora |
| Doładowanie | doładowanie rzeczywiste i zadane w barach, odchyłka od zadanego, MAP, ciśnienie atmosferyczne, MAF |
| Mieszanka | lambda rzeczywista i zadana, odchyłka, korekty krótko- i długoterminowe, tryb pętli, ciśnienie w szynie, sonda za katalizatorem |

Aplikacja pokazuje tylko te parametry, które sterownik zgłasza jako obsługiwane. Ma wykresy ostatnich odczytów, min/max i nagrywanie przejazdu do CSV.

**Błędy:**
- kody OBD silnika: zapisane, oczekujące i stałe, plus zamrożona ramka,
- skan modułów VAG przez UDS (0x19): silnik, skrzynia, ABS/ESP, klimatyzacja, BCM, airbag, kolumna, licznik, gateway, wspomaganie, radio, opcjonalnie pełne przeszukanie adresów 0x700–0x774,
- identyfikacja modułów (nr części, system, wersja oprogramowania),
- kasowanie błędów z potwierdzeniem,
- raport tekstowy do skopiowania.

**Panel P0299** (za niskie doładowanie):
- stan kodu P0299 i kodów powiązanych, zamrożona ramka,
- sprawdzenie czujników ciśnienia przy wyłączonym silniku (kolektor i doładowanie kontra atmosferyczne),
- test przyspieszenia z automatycznym wykryciem pełnego gazu: doładowanie rzeczywiste i zadane, odchyłka (bez pierwszych 1,5 s rozkręcania turbo), wastegate, temperatura dolotu, mieszanka i ciśnienie paliwa pod obciążeniem, korekty na biegu jałowym,
- lista „od czego zacząć” ułożona według wyników.

**Panel Ogrzewanie:**
- wybór objawu i podpowiedź, co zwykle za nim stoi,
- test nagrzewania z wykresem temperatury płynu i oleju: wiarygodność czujnika na zimnym starcie, tempo nagrzewania, czy silnik osiąga temperaturę roboczą, czy temperatura spada w jeździe,
- wniosek: problem po stronie silnika (termostat) albo nagrzewnicy i nawiewu, z listą kontroli,
- kody Climatronic i kody silnika związane z chłodzeniem.

Wyniki obu testów trafiają do raportu, a dane można skopiować jako CSV.

**Stan:** VIN, kontrolka MIL, gotowość systemów (readiness), lista obsługiwanych PID, surowy log komunikacji.

## Wymagania

| Urządzenie | Przeglądarka | Adapter |
|---|---|---|
| iPhone / iPad | [Bluefy](https://apps.apple.com/app/id1492822055) (Safari nie obsługuje Web Bluetooth) | ELM327 **Bluetooth LE** (np. vLinker MC+/FS BLE, OBDLink CX, Veepeak BLE) |
| Android | Chrome | ELM327 Bluetooth LE |
| Windows / macOS / Linux | Chrome lub Edge | BLE przez przycisk **Bluetooth**; klasyczny Bluetooth (SPP) lub USB przez przycisk **Port COM** po sparowaniu w systemie |

Strona musi działać przez HTTPS, co GitHub Pages zapewnia.

Do modułów VAG (UDS po CAN, mniej więcej auta od 2010 r.) adapter musi obsługiwać `ATFCSH` / `ATCRA`. Tanie klony ELM327 v2.1 często tego nie robią. Aplikacja wykrywa ten przypadek i pokazuje ostrzeżenie.

## Ograniczenia

- Odczyt na żywo korzysta ze standardowego OBD-II. Kanały specyficzne dla VAG (np. wypadanie zapłonów na cylinder, korekty od spalania stukowego, pozycja wastegate) wymagają zmapowania identyfikatorów UDS `0x22` dla konkretnego sterownika. To jest w planach.
- Starsze auta na protokole TP2.0 / KWP2000 (mniej więcej sprzed 2010) nie są obsługiwane w skanie modułów.
- Opisy kodów obejmują ogólne kody SAE. Kody producenta pokazywane są bez opisu.
- Brak kodowania i adaptacji (zapis do sterowników). Aplikacja tylko czyta dane i kasuje błędy.
- Progi alarmowe są orientacyjne i nie zastępują danych serwisowych.

## Struktura

```
index.html        gotowa aplikacja (to serwuje GitHub Pages)
src/core.js       komunikacja: ELM327, OBD-II, UDS
src/app.js        interfejs
src/style.css     wygląd
src/body.html     znaczniki
src/build.js      składa src/ w index.html
```

Po zmianach w `src/` uruchom `node src/build.js`.

## Licencja

MIT. Korzystasz na własną odpowiedzialność. Kasowanie błędów w module bezpieczeństwa (np. airbag) nie usuwa przyczyny usterki.
