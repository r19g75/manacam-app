# manaCam — aplikacja Android (podgląd + sterowanie głowicą kamery manaTools 05)

**Czytaj najpierw.** Ten plik = stan, decyzje, pułapki. Kontrakt z kamerą: `API.md`.
Firmware kamery: `C:\Users\Robert\Projekty_Claude\manaCam_firmware` (jego `START.md`, `NOTATKI.md`, `PLAN_SOFT.md`).

## Decyzje (2026-10-12, user)
- **APK z GitHuba** (nie PWA): PWA z GitHub Pages działa po HTTPS i nie może rozmawiać z `http://192.168.4.1`
  (mixed content). Natywna powłoka WebView w Javie + interfejs HTML/JS w `app/src/main/assets/www/`.
- Bez Capacitora/Reacta i bez kroku budowania interfejsu: lokalny Node to v14, Java 8. APK buduje **GitHub Actions**.
- Aktualizacje: Actions przy każdym pushu na `main` tworzy wydanie `v1.0.<N>` z `manaCam-1.0.<N>.apk`
  (N = `versionCode` = numer przebiegu). Aplikacja raz na dobę (i ręcznie w Ustawieniach) pyta
  `api.github.com/repos/r19g75/manacam-app/releases/latest` i proponuje pobranie. Repo musi być **publiczne**
  (pobieranie bez tokenu).
- Działa bez internetu: wszystko w APK, kamera po Wi-Fi.

## Struktura
- `app/src/main/java/pl/manatools/manacam/MainActivity.java`: WebView (strona z `http://appassets.androidplatform.net`),
  przypięcie procesu do Wi-Fi, mostek `Natywne` (wersja, otwórz URL, zapis zdjęcia do Galerii `Pictures/manaCam`).
- `app/src/main/assets/www/` `index.html`, `style.css`, `app.js`: cały interfejs. Test w przeglądarce PC:
  `index.html?demo` (tryb demo bez kamery) albo bez `?demo` z PC w sieci kamery (CORS `*` w firmware).
- `.github/workflows/apk.yml`: budowa, podpis, kontrola odcisku, wydanie.
- `podpis-sha256.txt`: odcisk certyfikatu podpisu; workflow odrzuca APK z innym podpisem.

## Klucz podpisu — KRYTYCZNE
- Plik `manacam.p12` (PKCS12, alias `manacam`) + `haslo.txt` w `C:\Users\Robert\Projekty_Claude\manaCam_app_KLUCZ\`
  (POZA repo). Ten sam klucz jest w sekretach repo: `MANACAM_KEYSTORE_B64` (base64 pliku), `MANACAM_KEYSTORE_PASS`.
- **Zgubienie klucza = aktualizacje nie zainstalują się na starej wersji** (trzeba odinstalować, tracąc ustawienia).
  Zrób kopię katalogu `manaCam_app_KLUCZ` (pendrive/sejf), NIE do repo.
- Wygenerowany Pythonem (`cryptography`), bo na tym PC nie ma `keytool`.

## Stan
- 2026-10-12: aplikacja napisana; interfejs sprawdzony w headless Chrome (360 px pion i poziom, demo) i **z prawdziwą
  kamerą manaCam-D328** (firmware S1A): obraz na żywo, stan, wyszarzona głowica (PCA9685 nie podłączony).
- 2026-10-12: repo **publiczne** https://github.com/r19g75/manacam-app, sekrety ustawione, wydania v1.0.1 i v1.0.2 zbudowane
  (podpis zgodny z `podpis-sha256.txt`). Pobranie: https://github.com/r19g75/manacam-app/releases/latest
  Na telefonie jeszcze nie testowane.

- 2026-10-12 (P620): obrót widoku w aplikacji (Ustawienia > Obraz > Obrót widoku, `cfg.widok`, domyślnie 270 = 90° w lewo,
  bo kamera leży w obudowie bokiem i obraz z sensora jest obrócony o 90° w prawo). Sensor umie tylko 180°, więc 90/270 robi CSS.
  Celowanie dotknięciem liczone w układzie ekranu (przy 90/270 FOV poziomy/pionowy zamienione), zdjęcie obracane canvasem przed zapisem.
  Test headless (demo): klik nad środkiem → tilt+, w prawo → pan+, zdjęcie 800×600 → 600×800.
  Sprawdzanie aktualizacji: `Natywne.pobierzZInternetu` (Java) pyta GitHuba przez sieć z internetem (VALIDATED,
  inaczej requestNetwork CELLULAR), bo proces jest przypięty do Wi-Fi kamery — wcześniej w sieci kamery zawsze „brak internetu”.
  Do zrobienia: automatyczne 180° po przejściu pochylenia przez pion (czeka na decyzję o zakresie tilt > 45°).

- 2026-10-13: straż strumienia (`strazStrumienia` w app.js): brak pierwszej klatki w 6 s albo zamarznięcie
  (`klatki` z `/api/stan` stoją / kamera nie widzi strumienia przez 5 odczytów) → automatyczne ponowienie. Wcześniej po
  wyjęciu baterii aplikacja wisiała na „Uruchamianie obrazu…”. Strona z kamery (`zKamery`): adres = adres strony, bez
  przycisku aktualizacji. Sprawdzone w headless Chrome na stronie z kamery (firmware S1B).
- 2026-10-13 (2): limity straży w CZASIE: pierwsza klatka 20 s, licznik klatek stoi 20 s, kamera nie widzi
  połączenia 3 odczyty (też przed 1. klatką). Musi być > `LIMIT_KLATKI_MS` w firmware (15 s) — przy słabym łączu
  klatka idzie kilka sekund; stare „5 odczytów” zrywałoby obraz.

## Pułapki (sprawdzone / przewidziane)
1. **Android kieruje ruch na dane komórkowe**, gdy Wi-Fi nie ma internetu (sieć kamery): `MainActivity.przypnijDoWifi()`
   wiąże proces z Wi-Fi (`bindProcessToNetwork`). Przy Wi-Fi z internetem nic to nie zmienia.
   Sprawdzanie aktualizacji omija to przez `pobierzZInternetu` (dane komórkowe); bez danych komórkowych nie zadziała.
2. Telefon może pytać „Sieć bez internetu — pozostać połączonym?”: odpowiedź TAK (aplikacja to podpowiada).
3. Kamera ma **jedno miejsce na strumień**. Aplikacja zwalnia je w tle (`onPause` → `wTle(true)`).
   To samo urządzenie przejmuje strumień, inne dostaje 503 „kamera zajęta”.
4. WebView bez `WebChromeClient` ignoruje `alert/confirm`: jest ustawiony, ale interfejs i tak ich nie używa (toasty).
5. `onload` dla MJPEG w `<img>` nie jest pewny: pierwsza klatka wykrywana przez `naturalWidth > 0`.
6. Headless Chrome ma minimalne okno 500 px: testy wąskiego ekranu w `<iframe width=360>`.
   Na zrzutach strumienia mogą wyjść poziome pasy (artefakt zrzutu, `/capture` czysty).
7. Firmware starszy niż S1A nie ma `/api/stan` → aplikacja: „program kamery za stary”.
   Funkcje z późniejszych etapów (zoom S5) → 404 → komunikat „brak funkcji”.
8. Instalacja APK: Android poprosi o zgodę „instaluj z nieznanych źródeł” dla przeglądarki (jednorazowo).

9. CI: `runs-on: ubuntu-24.04` i Gradle 8.10.2 + AGP 8.7.3 przypięte świadomie (ubuntu-latest → 26 od 19.10.2026).
   Aktualizacja Gradle/AGP tylko razem i z testem budowy. Ostrzeżenia CI czytać po każdym pushu (`gh run view`).
10. Każdy push na `main` = nowe wydanie dla telefonów. Zmiany próbne: osobna gałąź.
11. Edycje plików przez `sed` z `#` w treści psują się (separator) — używać edycji Pythonem/Edit.

## Następne kroki
1. Zainstalować APK na telefonie (link wyżej).
2. Test na telefonie w sieci kamery (pułapka 1!), zdjęcie do Galerii, powrót z tła.
3. Firmware S2 (bateria) / S3 (kalibracja serw, kierunki zgodne z `API.md`) / S4 (≥10 kl./s; teraz ~8,8 przy SVGA).
