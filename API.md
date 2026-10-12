# manaCam — API kamery (kontrakt firmware ↔ aplikacja)

Wersja kontraktu: **1**. Kamera zwraca ją w `/api/stan` jako `api`. Aplikacja ostrzega, gdy wersje się różnią.

Adres domyślny `192.168.4.1` (własna sieć kamery). W sieci zakładu adres jest wyświetlany na stronie kamery.

## Uwierzytelnienie
Każde wywołanie `/api/*`, `/capture` i strumień przyjmuje parametr **`k=<hasło administratora>`**.
Przeglądarka może zamiast niego użyć Basic auth (`admin` / hasło).
Brak lub złe hasło: `401`.
Parametr w adresie zamiast nagłówka: `<img>` ze strumieniem nie wyśle nagłówka, a zwykły GET nie wymaga preflightu CORS.
Hasło i tak idzie jawnym tekstem (sieć kamery jest szyfrowana WPA2).

## CORS
Każda odpowiedź `/api/*` i `/capture` ma `Access-Control-Allow-Origin: *`. Aplikacja ładuje się z `http://appassets.androidplatform.net`.

## Wywołania (port 80, wszystkie GET, odpowiedź JSON = stan jak w `/api/stan`, chyba że napisano inaczej)
| Ścieżka | Parametry | Działanie |
|---|---|---|
| `/api/stan` | — | stan (niżej) |
| `/api/ruch` | `pan`, `tilt` (stopnie, −45…45, liczby całkowite) | ruch do pozycji bezwzględnej (rampa w firmware). Można podać jedną oś |
| `/api/ruch` | `dpan`, `dtilt` (stopnie) | ruch względny |
| `/api/srodek` | — | pan = 0, tilt = 0 |
| `/api/pozycja` | `zapisz=1..4` albo `idz=1..4` | zapamiętane pozycje (NVS) |
| `/api/led` | `v=0..255` | jasność leda flash |
| `/api/zoom` | `v=1` albo `v=2` | zoom cyfrowy (okno sensora) |
| `/api/obraz` | `rozdz=VGA\|SVGA\|XGA`, `jakosc=10..40`, `obrot=0\|180`, `lustro=0\|1` | ustawienia obrazu (dowolny podzbiór) |
| `/capture` | — | `image/jpeg`, klatka w bieżącej rozdzielczości strumienia |

## Kierunki
`pan+` = obraz przesuwa się w prawo, `tilt+` = w górę. Aplikacja na tym opiera celowanie dotknięciem obrazu.
Firmware odpowiada za zgodność kierunków z obrazem (`KIER_PAN`/`KIER_TILT`, obrót obrazu 180°).

## Wdrożenie w firmware
| Funkcja | Od wersji firmware |
|---|---|
| stan, strumień, `/capture`, led, obraz, ruch/środek/pozycje (gdy wykryto PCA9685) | S1A |
| bateria (`bateria_v`, `bateria_pct`) | S2 (do tego czasu `null`) |
| kalibracja serw (kierunki, środek, krańce) | S3 |
| `/api/zoom` | S5 (do tego czasu `404` → aplikacja: „brak funkcji”) |

## Strumień
`http://<adres>:81/stream?k=<hasło>`: `multipart/x-mixed-replace` MJPEG.
Jeden oglądający naraz. Inne urządzenie dostaje `503` i tekst `kamera zajeta`; to samo urządzenie (ten sam adres IP) przejmuje strumień.

## `/api/stan`
```json
{
  "api": 1,
  "wersja": "S4-2026-10-20",
  "nazwa": "manaCam-D328",
  "czas": 1234,
  "restart": "wlaczenie zasilania",
  "bateria_v": 18.42,
  "bateria_pct": 62,
  "pan": 0, "tilt": -10,
  "pan_cel": 0, "tilt_cel": -10,
  "led": 0, "zoom": 1,
  "rozdz": "SVGA", "jakosc": 12, "obrot": 0, "lustro": 0,
  "pozycje": [[0,0],[20,-5],null,null],
  "glowica": true,
  "kamera": true,
  "klienci": 1,
  "strumien_zajety": false,
  "sta_ip": ""
}
```
Pole sprzętu, którego nie ma (np. brak ADS1115 przed S2), ma wartość `null` (`bateria_v`, `bateria_pct`).
`glowica`/`kamera` = `false`, gdy nie wykryto PCA9685 albo kamera się nie zainicjowała. Wywołania ruchu zwracają wtedy `409`.
