# manaCam — aplikacja Android (podgląd + sterowanie głowicą kamery manaTools 05)

**Czytaj najpierw.** Ten plik = stan, decyzje, pułapki. Kontrakt z kamerą: `API.md`.
Firmware kamery: `C:\Users\Robert\Documents\PlatformIO\Projects\manaCam_firmware` (jego `START.md`, `NOTATKI.md`, `PLAN_SOFT.md`).

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
- Plik `manacam.p12` (PKCS12, alias `manacam`) + `haslo.txt` w `C:\Users\Robert\Documents\PRojekty\manaCam_app_KLUCZ\`
  (POZA repo). Ten sam klucz jest w sekretach repo: `MANACAM_KEYSTORE_B64` (base64 pliku), `MANACAM_KEYSTORE_PASS`.
- **Zgubienie klucza = aktualizacje nie zainstalują się na starej wersji** (trzeba odinstalować, tracąc ustawienia).
  Zrób kopię katalogu `manaCam_app_KLUCZ` (pendrive/sejf), NIE do repo.
- Wygenerowany Pythonem (`cryptography`), bo na tym PC nie ma `keytool`.

## Stan
- 2026-10-12: aplikacja napisana; interfejs sprawdzony w headless Chrome (360 px pion i poziom, demo) i **z prawdziwą
  kamerą manaCam-D328** (firmware S1A): obraz na żywo, stan, wyszarzona głowica (PCA9685 nie podłączony).
  APK jeszcze nie budowany: czeka na utworzenie repo na GitHubie.

## Pułapki (sprawdzone / przewidziane)
1. **Android kieruje ruch na dane komórkowe**, gdy Wi-Fi nie ma internetu (sieć kamery): `MainActivity.przypnijDoWifi()`
   wiąże proces z Wi-Fi (`bindProcessToNetwork`). Przy Wi-Fi z internetem nic to nie zmienia.
   Skutek: w sieci kamery sprawdzanie aktualizacji nie działa (normalne, ciche).
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

## Następne kroki
1. Utworzyć publiczne repo `r19g75/manacam-app`, ustawić sekrety, push → pierwsze wydanie; zainstalować na telefonie.
2. Test na telefonie w sieci kamery (pułapka 1!), zdjęcie do Galerii, powrót z tła.
3. Firmware S2 (bateria) / S3 (kalibracja serw, kierunki zgodne z `API.md`) / S4 (≥10 kl./s; teraz ~8,8 przy SVGA).
