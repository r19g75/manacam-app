'use strict';
// manaCam - interfejs telefonu. Kontrakt z kamera: API.md (wersja API_WERSJA).

const REPO = 'r19g75/manacam-app';
const API_WERSJA = 1;
const FOV_X = 66, FOV_Y = 50;          // pole widzenia OV2640 [stopnie] przy zoomie 1x
const ZAKRES = 45;                     // glowica -45..45 stopni
const OKRES_STANU = 1000;              // co ile ms pytamy o stan
const DLUGIE_WCISNIECIE = 600;

const $ = id => document.getElementById(id);
const natywne = window.Natywne || null;
// Strona podana przez sama kamere (http://192.168.4.1/) - adres kamery = adres strony, aktualizacje razem z firmware.
const zKamery = !natywne && location.protocol === 'http:' && location.hostname !== 'appassets.androidplatform.net';

// ---------- ustawienia (localStorage) ----------
const cfg = (() => {
  let c = {};
  try { c = JSON.parse(localStorage.getItem('manacam') || '{}'); } catch (e) { /* brak/zablokowany storage */ }
  return { adres: c.adres || '192.168.4.1', haslo: c.haslo || 'manatools', krok: c.krok || 5, demo: !!c.demo,
           ledOst: c.ledOst || 128, aktSprawdzono: c.aktSprawdzono || 0,
           // obrot widoku w aplikacji (stopnie zgodnie z zegarem). Kamera lezy w obudowie bokiem, obraz z sensora
           // jest obrocony o 90 w prawo -> domyslnie 270 (90 w lewo). Sensor sam umie tylko 180 (Ustawienia > obraz).
           widok: [0, 90, 180, 270].includes(c.widok) ? c.widok : 270 };
})();
if (zKamery) cfg.adres = location.hostname;
if (new URLSearchParams(location.search).has('demo')) cfg.demo = true;   // test w przegladarce: index.html?demo
function zapiszCfg() { try { localStorage.setItem('manacam', JSON.stringify(cfg)); } catch (e) { /* trudno */ } }

// "http://192.168.4.1/" albo "192.168.4.1:80" -> "192.168.4.1" (port strumienia 81 dokladamy sami)
function normalizujAdres(a) {
  return (a || '').trim().replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '') || '192.168.4.1';
}

function adresUrl(sciezka, params = {}, port) {
  const u = new URL(`http://${cfg.adres}${port ? ':' + port : ''}${sciezka}`);
  u.searchParams.set('k', cfg.haslo);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

// ---------- komunikacja ----------
class BladApi extends Error {
  constructor(tekst, kod) { super(tekst); this.kod = kod; }
}

async function api(sciezka, params = {}, limitMs = 3000) {
  if (cfg.demo) return demoApi(sciezka, params);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), limitMs);
  let r;
  try {
    r = await fetch(adresUrl(sciezka, params), { signal: ac.signal, cache: 'no-store' });
  } catch (e) {
    throw new BladApi(e.name === 'AbortError' ? 'Kamera nie odpowiada' : 'Brak połączenia z kamerą', 0);
  } finally {
    clearTimeout(t);
  }
  if (r.status === 401) throw new BladApi('Złe hasło administratora (Ustawienia)', 401);
  if (r.status === 409) throw new BladApi('Głowica niedostępna: kamera nie wykryła sterownika serw', 409);
  if (r.status === 404) throw new BladApi('Ta wersja programu kamery nie ma tej funkcji, zaktualizuj kamerę', 404);
  if (!r.ok) throw new BladApi(`Kamera zgłosiła błąd ${r.status}`, r.status);
  if (sciezka === '/capture') return r.blob();
  let j;
  try { j = await r.json(); } catch (e) { throw new BladApi('Niezrozumiała odpowiedź kamery', -1); }
  ustawStan(j);
  return j;
}

// Polecenia wysylane czesto (ruch, led): najwyzej jedno w drodze, wygrywa najnowsze.
function nadawca(sciezka) {
  let wToku = false, czeka = null;
  return async params => {
    czeka = params;
    if (wToku) return;
    wToku = true;
    while (czeka) {
      const p = czeka; czeka = null;
      try { await api(sciezka, p); } catch (e) { pokazBlad(e); }
    }
    wToku = false;
  };
}
const wyslijRuch = nadawca('/api/ruch');
const wyslijLed = nadawca('/api/led');

// ---------- stan ----------
let stan = null;
let polaczony = false;
let bledyZRzedu = 0;
let wTleFlaga = false;
let cel = { pan: 0, tilt: 0 };
let ostatniRuch = 0;
let ostrzezenieApi = false;

function ustawStan(j) {
  if (!j || typeof j !== 'object' || !('api' in j)) return;
  stan = j;
  if (j.api !== API_WERSJA && !ostrzezenieApi) {
    ostrzezenieApi = true;
    toast(`Kamera ma API ${j.api}, aplikacja ${API_WERSJA}. Zaktualizuj ${j.api > API_WERSJA ? 'aplikację' : 'kamerę'}.`, true);
  }
  // pozycje z kamery przejmujemy tylko, gdy uzytkownik akurat nie steruje (inaczej cel "skacze" wstecz)
  if (Date.now() - ostatniRuch > 1500 && typeof j.pan_cel === 'number') cel = { pan: j.pan_cel, tilt: j.tilt_cel };
  odswiez();
}

function odswiez() {
  const s = stan;
  $('kropka').className = 'kropka' + (polaczony ? (s && s.kamera === false ? ' ostrz' : ' ok') : '');
  $('nazwa').textContent = (s && s.nazwa) || 'manaCam';
  const bat = $('bateria');
  if (s && typeof s.bateria_v === 'number') {
    bat.hidden = false;
    bat.textContent = `${s.bateria_v.toFixed(1)} V` + (typeof s.bateria_pct === 'number' ? ` ${s.bateria_pct}%` : '');
    bat.classList.toggle('niska', typeof s.bateria_pct === 'number' && s.bateria_pct < 15);
  } else bat.hidden = true;

  const glowica = !!(s && s.glowica);
  document.querySelectorAll('.kier, #btnSrodek, .poz').forEach(b => { b.disabled = !polaczony || !glowica; });
  $('pozycja').textContent = s && glowica
    ? `obrót ${fmt(s.pan)}° / pochylenie ${fmt(s.tilt)}°`
    : (s ? 'głowica niedostępna' : 'obrót – / pochylenie –');
  document.querySelectorAll('.poz').forEach(b => {
    const p = s && s.pozycje && s.pozycje[b.dataset.n - 1];
    b.classList.toggle('pusta', !p);
  });
  $('btnZoom').textContent = `${(s && s.zoom) || 1}×`;
  $('btnZoom').classList.toggle('wl', !!(s && s.zoom > 1));
  $('btnLed').classList.toggle('wl', !!(s && s.led > 0));
  if (s && document.activeElement !== $('ledSuwak')) $('ledSuwak').value = s.led || 0;
  ['btnZoom', 'btnLed', 'ledSuwak', 'btnFoto'].forEach(id => { $(id).disabled = !polaczony || (s && s.kamera === false); });
}
const fmt = v => (typeof v === 'number' ? (v > 0 ? '+' : '') + v : '–');
const ogranicz = v => Math.max(-ZAKRES, Math.min(ZAKRES, Math.round(v)));

async function petlaStanu() {
  if (!wTleFlaga) {
    try {
      await api('/api/stan');
      if (!polaczony) { polaczony = true; bledyZRzedu = 0; startStrumienia(); }
      bledyZRzedu = 0;
      strazStrumienia();
    } catch (e) {
      if (e.kod === 401 || e.kod === 404) {
        if (polaczony) stopStrumienia();
        polaczony = false;
        komunikat(e.kod === 404 ? 'Kamera odpowiada, ale jej program nie ma API aplikacji (za stara wersja).\nZaktualizuj program kamery.' : e.message);
      } else if (++bledyZRzedu >= 2) {
        if (polaczony) stopStrumienia();
        polaczony = false;
        komunikat(`Brak połączenia z kamerą ${cfg.adres}.\n\nSprawdź: kamera włączona, telefon w Wi-Fi „manaCam-…”. ` +
                  `Jeśli Android pyta o sieć bez internetu, wybierz „Pozostań połączony”.`);
      }
    }
    odswiez();
  }
  setTimeout(petlaStanu, OKRES_STANU);
}

// ---------- strumien ----------
let ponowStrumien = null, czekajKlatke = null;
// Straz strumienia: polaczenie potrafi sie otworzyc bez klatek albo zamarznac (np. po powrocie sieci kamery,
// telefon chwilowo na danych komorkowych). Bez tego aplikacja wisiala na "Uruchamianie obrazu..." w nieskonczonosc.
// Limity w czasie, nie w liczbie odczytow: przy slabym laczu jedna klatka idzie kilka sekund. Oba > limit klatki
// w kamerze (15 s), zeby to kamera zrywala pierwsza; zerwanie widac szybko po strumien_zajety=false.
const LIMIT_PIERWSZEJ_KLATKI = 20000;  // ms
const LIMIT_ZASTOJU_MS = 20000;        // licznik klatek stoi tak dlugo = zamarzlo
const LIMIT_NIEZAJETY = 3;             // kolejne odczyty stanu: kamera nie widzi naszego polaczenia
let strumienOd = 0, klatkaJest = false, ostKlatki = -1, klatkiOd = 0, niezajety = 0;

function strazStrumienia() {
  if (wTleFlaga || !polaczony || cfg.demo || !strumienOd || ponowStrumien) return;
  let powod = null;
  // kamera nie widzi naszego polaczenia (zerwala je) - takze przed pierwsza klatka, zeby nie czekac 20 s
  niezajety = stan && stan.strumien_zajety === false ? niezajety + 1 : 0;
  if (niezajety >= LIMIT_NIEZAJETY) powod = 'kamera zerwala polaczenie';
  else if (!klatkaJest) {
    if (Date.now() - strumienOd > LIMIT_PIERWSZEJ_KLATKI) powod = 'brak pierwszej klatki';
  } else if (stan && typeof stan.klatki === 'number') {
    // licznik klatek stoi (firmware bez "klatki": tylko warunek niezajety)
    if (stan.klatki !== ostKlatki) { ostKlatki = stan.klatki; klatkiOd = Date.now(); }
    if (Date.now() - klatkiOd > LIMIT_ZASTOJU_MS) powod = 'obraz zamarzl';
  }
  if (powod) {
    console.log('strumien: ponawiam (' + powod + ')');
    stopStrumienia();
    komunikat('Obraz nie dochodzi. Ponawiam…');
    ponowStrumien = setTimeout(startStrumienia, 500);
  }
}

function startStrumienia() {
  clearTimeout(ponowStrumien); ponowStrumien = null;
  clearInterval(czekajKlatke);
  if (wTleFlaga || !polaczony) return;
  const img = $('strumien');
  komunikat('Uruchamianie obrazu…');
  if (cfg.demo) { demoObraz(); return; }
  strumienOd = Date.now(); klatkaJest = false; ostKlatki = -1; klatkiOd = Date.now(); niezajety = 0;
  img.onerror = null; img.onload = null;
  img.removeAttribute('src');            // bez tego naturalWidth moze zostac po starym obrazie
  // onload dla MJPEG nie jest pewny w kazdej wersji WebView - pierwsza klatka = naturalWidth > 0
  const pierwszaKlatka = () => { clearInterval(czekajKlatke); klatkaJest = true; komunikat(null); };
  czekajKlatke = setInterval(() => { if (img.naturalWidth > 0) pierwszaKlatka(); }, 300);
  img.onload = pierwszaKlatka;
  img.onerror = () => {
    clearInterval(czekajKlatke);
    if (!polaczony || wTleFlaga) return;
    komunikat(stan && stan.strumien_zajety ? 'Kamera zajęta: obraz ogląda inne urządzenie.\nPonawiam…'
                                           : 'Brak obrazu z kamery. Ponawiam…');
    ponowStrumien = setTimeout(startStrumienia, 3000);
  };
  img.src = adresUrl('/stream', { t: Date.now() }, 81);   // t: bez cache, nowe polaczenie
}

function stopStrumienia() {
  clearTimeout(ponowStrumien); ponowStrumien = null;
  strumienOd = 0;
  clearInterval(czekajKlatke);
  const img = $('strumien');
  img.onerror = null; img.onload = null;
  img.removeAttribute('src');            // zamyka polaczenie = zwalnia jedyne miejsce w kamerze
}

function komunikat(tekst) {
  const k = $('komunikat');
  k.hidden = !tekst;
  k.dataset.ustawiony = tekst ? '1' : '';
  if (tekst) k.textContent = tekst;
}

// wywolywane z MainActivity (onPause/onResume) i przy zmianie widocznosci karty
window.wTle = tl => {
  wTleFlaga = tl;
  if (tl) stopStrumienia(); else if (polaczony) startStrumienia();
};
document.addEventListener('visibilitychange', () => window.wTle(document.hidden));

// ---------- sterowanie ----------
function ruszDo(pan, tilt) {
  cel = { pan: ogranicz(pan), tilt: ogranicz(tilt) };
  ostatniRuch = Date.now();
  $('pozycja').textContent = `→ obrót ${fmt(cel.pan)}° / pochylenie ${fmt(cel.tilt)}°`;
  wyslijRuch({ pan: cel.pan, tilt: cel.tilt });
}

// przytrzymanie strzalki = ruch ciagly
document.querySelectorAll('.kier').forEach(b => {
  let timer = null;
  const krok = () => ruszDo(cel.pan + b.dataset.dp * cfg.krok, cel.tilt + b.dataset.dt * cfg.krok);
  const stop = () => { clearInterval(timer); timer = null; b.classList.remove('wcisniety'); };
  b.addEventListener('pointerdown', e => {
    if (b.disabled) return;
    e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('wcisniety');
    krok(); clearInterval(timer); timer = setInterval(krok, 250);
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(n => b.addEventListener(n, stop));
});

$('btnSrodek').addEventListener('click', () => { ostatniRuch = Date.now(); cel = { pan: 0, tilt: 0 }; api('/api/srodek').catch(pokazBlad); });

document.querySelectorAll('.krokBtn').forEach(b => b.addEventListener('click', () => {
  cfg.krok = +b.dataset.k; zapiszCfg(); zaznaczKrok();
}));
function zaznaczKrok() { document.querySelectorAll('.krokBtn').forEach(b => b.classList.toggle('wl', +b.dataset.k === cfg.krok)); }

// pozycje: krotko = jedz, przytrzymaj = zapisz
document.querySelectorAll('.poz').forEach(b => {
  let timer = null, dlugie = false;
  b.addEventListener('pointerdown', () => {
    if (b.disabled) return;
    dlugie = false;
    timer = setTimeout(() => {
      dlugie = true;
      api('/api/pozycja', { zapisz: b.dataset.n }).then(() => toast(`Zapisano pozycję ${b.dataset.n}`)).catch(pokazBlad);
    }, DLUGIE_WCISNIECIE);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(n => b.addEventListener(n, () => clearTimeout(timer)));
  b.addEventListener('click', () => {
    if (dlugie || b.disabled) return;
    if (b.classList.contains('pusta')) { toast(`Pozycja ${b.dataset.n} pusta: przytrzymaj, aby zapisać`); return; }
    ostatniRuch = Date.now();
    api('/api/pozycja', { idz: b.dataset.n }).catch(pokazBlad);
  });
  b.addEventListener('contextmenu', e => e.preventDefault());
});

// ---------- obrot widoku ----------
// Przy 90/270 obrazek ma zamienione wymiary (szer. = wys. ramki) i jest obracany wokol srodka ramki.
const bokiem = () => cfg.widok === 90 || cfg.widok === 270;
function ulozObraz() {
  const ramka = $('obraz'), img = $('strumien');
  ramka.classList.toggle('pion', bokiem());
  img.classList.toggle('obrocony', bokiem());
  img.style.setProperty('--w', ramka.clientWidth + 'px');
  img.style.setProperty('--h', ramka.clientHeight + 'px');
  img.style.setProperty('--obr', cfg.widok + 'deg');
}
new ResizeObserver(ulozObraz).observe($('obraz'));

// dotkniecie obrazu = wyceluj w ten punkt (pan+ = w prawo, tilt+ = w gore, patrz API.md)
// Liczone w ukladzie ekranu: po obrocie widoku obraz stoi prosto, wiec poziom ekranu = obrot glowicy.
$('obraz').addEventListener('click', e => {
  if (!polaczony || !stan || !stan.glowica) return;
  const img = $('strumien');
  const r = $('obraz').getBoundingClientRect();
  let nw = img.naturalWidth || 4, nh = img.naturalHeight || 3;
  let fovX = FOV_X, fovY = FOV_Y;
  if (bokiem()) { [nw, nh] = [nh, nw]; [fovX, fovY] = [fovY, fovX]; }
  const skala = Math.min(r.width / nw, r.height / nh);       // object-fit: contain
  const x = (e.clientX - r.left - r.width / 2) / (nw * skala);
  const y = (e.clientY - r.top - r.height / 2) / (nh * skala);
  if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) return;          // klik w czarny pas
  const z = stan.zoom || 1;
  ruszDo(cel.pan + x * fovX / z, cel.tilt - y * fovY / z);
});

// zdjecie z kamery obrocone tak jak widok (JPEG ponownie kodowany tylko przy obrocie)
async function obrocZdjecie(blob) {
  if (!cfg.widok) return blob;
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bokiem() ? bmp.height : bmp.width;
  c.height = bokiem() ? bmp.width : bmp.height;
  const g = c.getContext('2d');
  g.translate(c.width / 2, c.height / 2);
  g.rotate(cfg.widok * Math.PI / 180);
  g.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  return new Promise((ok, zle) => c.toBlob(b => (b ? ok(b) : zle(new BladApi('Nie udało się obrócić zdjęcia', -1))), 'image/jpeg', 0.92));
}

$('btnZoom').addEventListener('click', () => api('/api/zoom', { v: (stan && stan.zoom > 1) ? 1 : 2 }).catch(pokazBlad));
$('btnLed').addEventListener('click', () => {
  const v = stan && stan.led > 0 ? 0 : cfg.ledOst;
  $('ledSuwak').value = v; wyslijLed({ v });
});
$('ledSuwak').addEventListener('input', e => {
  const v = +e.target.value;
  if (v > 0) { cfg.ledOst = v; zapiszCfg(); }
  wyslijLed({ v });
});

$('btnFoto').addEventListener('click', async () => {
  const b = $('btnFoto');
  b.disabled = true; b.textContent = 'Zdjęcie…';
  try {
    const blob = await obrocZdjecie(await api('/capture', {}, 15000));
    if (natywne) {
      const b64 = await new Promise((ok, zle) => {
        const fr = new FileReader();
        fr.onload = () => ok(String(fr.result).split(',')[1]);
        fr.onerror = () => zle(new BladApi('Nie udało się odczytać zdjęcia', -1));
        fr.readAsDataURL(blob);
      });
      const wynik = natywne.zapiszZdjecie(b64);
      if (wynik.startsWith('BLAD')) toast(wynik, true); else toast(`Zapisano w Galerii: ${wynik}`);
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `manaCam_${Date.now()}.jpg`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
  } catch (e) { pokazBlad(e); }
  b.disabled = false; b.textContent = 'Zdjęcie';
});

// ---------- ustawienia ----------
function otworzUstawienia() {
  $('ustAdres').value = cfg.adres;
  $('ustAdres').disabled = zKamery;
  $('ustHaslo').value = cfg.haslo;
  $('ustDemo').checked = cfg.demo;
  $('ustWidok').value = cfg.widok;
  if (stan) {
    $('ustRozdz').value = stan.rozdz || 'SVGA';
    $('ustJakosc').value = stan.jakosc || 12;
    $('ustObrot').checked = stan.obrot === 180;
    $('ustLustro').checked = !!stan.lustro;
  }
  $('ustKamera').textContent = stan
    ? `${stan.nazwa}, program ${stan.wersja} (API ${stan.api})\nczas pracy ${Math.floor(stan.czas / 3600)} h ${Math.floor(stan.czas / 60) % 60} min, ostatni restart: ${stan.restart}` +
      (stan.sta_ip ? `\nadres w sieci zakładu: ${stan.sta_ip}` : '')
    : 'brak połączenia';
  $('ustApka').textContent = natywne ? `wersja ${natywne.wersja()} (${natywne.wersjaKod()})`
    : zKamery ? 'strona z kamery: aktualizuje się razem z programem kamery.\nSkrót na ekranie: menu Chrome → Dodaj do ekranu głównego.'
    : 'uruchomiona w przeglądarce (bez aktualizacji)';
  $('btnAkt').hidden = !natywne;
  $('ekranUst').hidden = false;
}
function zamknijUstawienia() { $('ekranUst').hidden = true; }
window.wstecz = () => { if (!$('ekranUst').hidden) { zamknijUstawienia(); return true; } return false; };

$('btnUst').addEventListener('click', otworzUstawienia);
$('btnZamknij').addEventListener('click', zamknijUstawienia);
$('btnZapiszPol').addEventListener('click', () => {
  if (!zKamery) cfg.adres = normalizujAdres($('ustAdres').value);
  cfg.haslo = $('ustHaslo').value;
  zapiszCfg();
  polaczony = false; stopStrumienia(); ostrzezenieApi = false;
  komunikat('Łączenie z kamerą…');
  zamknijUstawienia();
});
$('btnZapiszObraz').addEventListener('click', () => {
  const jakosc = Math.max(10, Math.min(40, Math.round(+$('ustJakosc').value || 12)));
  api('/api/obraz', { rozdz: $('ustRozdz').value, jakosc, obrot: $('ustObrot').checked ? 180 : 0, lustro: $('ustLustro').checked ? 1 : 0 })
    .then(() => { toast('Zastosowano'); if (polaczony) { stopStrumienia(); startStrumienia(); } })
    .catch(pokazBlad);
});
$('ustWidok').addEventListener('change', e => { cfg.widok = +e.target.value; zapiszCfg(); ulozObraz(); });
$('ustDemo').addEventListener('change', e => {
  cfg.demo = e.target.checked; zapiszCfg();
  polaczony = false; stan = null; stopStrumienia(); komunikat('Łączenie z kamerą…'); odswiez();
});
$('btnAkt').addEventListener('click', () => sprawdzAktualizacje(true));

// ---------- aktualizacje z GitHub Releases ----------
// Wydanie "v1.0.<N>", N = versionCode. Pobranie APK otwiera przegladarke, Android instaluje na starej wersji (ten sam klucz).
async function sprawdzAktualizacje(reczne) {
  const wynik = t => { $('aktWynik').textContent = t; };
  if (!natywne) { if (reczne) wynik('Aktualizacje działają tylko w aplikacji na Androidzie.'); return; }
  if (reczne) wynik('Sprawdzanie…');
  try {
    const j = JSON.parse(await zInternetu(`https://api.github.com/repos/${REPO}/releases/latest`));
    const kod = parseInt(String(j.tag_name).split('.').pop(), 10);
    const apk = (j.assets || []).find(a => a.name.endsWith('.apk'));
    cfg.aktSprawdzono = Date.now(); zapiszCfg();
    if (!apk || !(kod > natywne.wersjaKod())) { if (reczne) wynik(`Masz najnowszą wersję (${natywne.wersja()}).`); return; }
    wynik(`Dostępna wersja ${j.tag_name}.`);
    const b = document.createElement('button');
    b.textContent = `Pobierz ${j.tag_name}`;
    b.onclick = () => natywne.otworz(apk.browser_download_url);
    $('aktWynik').appendChild(document.createElement('br'));
    $('aktWynik').appendChild(b);
    if (!reczne) toast(`Dostępna nowa wersja aplikacji ${j.tag_name} (Ustawienia)`);
  } catch (e) {
    // brak internetu (np. dane komorkowe wylaczone) - cicho przy sprawdzaniu automatycznym
    if (reczne) wynik(`Nie udało się sprawdzić (${e.message}). Aplikacja pyta GitHuba przez dane komórkowe, ` +
                      'bo Wi-Fi kamery nie ma internetu — sprawdź, czy dane komórkowe są włączone.');
  }
}

// Internet przez natywna powloke: proces jest przypiety do Wi-Fi kamery, wiec zwykly fetch nie wyjdzie do sieci.
// Starsza powloka (bez pobierzZInternetu) -> zwykly fetch.
const oczekujace = {};
let nrZapytania = 0;
window.wynikInternetu = (id, ok, tekst) => {
  const p = oczekujace[id]; delete oczekujace[id];
  if (p) (ok ? p.ok(tekst) : p.zle(new Error(tekst)));
};
function zInternetu(url) {
  if (natywne && natywne.pobierzZInternetu) {
    return new Promise((ok, zle) => {
      const id = ++nrZapytania;
      oczekujace[id] = { ok, zle };
      setTimeout(() => window.wynikInternetu(id, false, 'brak odpowiedzi'), 25000);
      natywne.pobierzZInternetu(id, url);
    });
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  return fetch(url, { signal: ac.signal, headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' })
    .then(r => { if (!r.ok) throw new Error(`GitHub ${r.status}`); return r.text(); })
    .finally(() => clearTimeout(t));
}

// ---------- komunikaty ----------
let toastTimer = null;
function toast(tekst, blad) {
  const t = $('toast');
  t.textContent = tekst; t.className = 'toast' + (blad ? ' blad' : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, blad ? 5000 : 2500);
}
function pokazBlad(e) { toast(e && e.message ? e.message : String(e), true); }

// ---------- tryb demo (test interfejsu bez kamery) ----------
const demo = { api: API_WERSJA, wersja: 'DEMO', nazwa: 'manaCam-DEMO', czas: 0, restart: 'demo', bateria_v: 18.4, bateria_pct: 62,
  pan: 0, tilt: 0, pan_cel: 0, tilt_cel: 0, led: 0, zoom: 1, rozdz: 'SVGA', jakosc: 12, obrot: 0, lustro: 0,
  pozycje: [[0, 0], null, null, null], glowica: true, kamera: true, klienci: 1, strumien_zajety: false, sta_ip: '' };
const demoStart = Date.now();
async function demoApi(sciezka, p) {
  await new Promise(r => setTimeout(r, 80));
  const n = +(p.zapisz || p.idz) - 1;
  if (sciezka === '/api/ruch') {
    if ('pan' in p) demo.pan_cel = ogranicz(+p.pan);
    if ('tilt' in p) demo.tilt_cel = ogranicz(+p.tilt);
    if ('dpan' in p) demo.pan_cel = ogranicz(demo.pan_cel + +p.dpan);
    if ('dtilt' in p) demo.tilt_cel = ogranicz(demo.tilt_cel + +p.dtilt);
  } else if (sciezka === '/api/srodek') { demo.pan_cel = 0; demo.tilt_cel = 0; }
  else if (sciezka === '/api/pozycja' && n >= 0 && n < 4) {
    if (p.zapisz) demo.pozycje[n] = [demo.pan, demo.tilt];
    else if (demo.pozycje[n]) [demo.pan_cel, demo.tilt_cel] = demo.pozycje[n];
  } else if (sciezka === '/api/led') demo.led = +p.v;
  else if (sciezka === '/api/zoom') demo.zoom = +p.v;
  else if (sciezka === '/api/obraz') Object.assign(demo, p);
  else if (sciezka === '/capture') return new Blob([demoSvg()], { type: 'image/svg+xml' });
  demo.pan = demo.pan_cel; demo.tilt = demo.tilt_cel;
  demo.czas = Math.floor((Date.now() - demoStart) / 1000);
  const kopia = JSON.parse(JSON.stringify(demo));
  ustawStan(kopia);
  demoObraz();
  return kopia;
}
function demoSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#203040"/>` +
    `<g stroke="#4a6580">${Array.from({ length: 9 }, (_, i) => `<line x1="${i * 100}" y1="0" x2="${i * 100}" y2="600"/>`).join('')}</g>` +
    `<text x="400" y="290" fill="#fff" font-size="40" text-anchor="middle" font-family="sans-serif">DEMO</text>` +
    `<text x="400" y="340" fill="#f2a93b" font-size="28" text-anchor="middle" font-family="sans-serif">obrót ${demo.pan}° pochylenie ${demo.tilt}° zoom ${demo.zoom}×</text></svg>`;
}
function demoObraz() {
  if (!cfg.demo || !polaczony || wTleFlaga) return;
  $('strumien').src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(demoSvg());
  komunikat(null);
}

// ---------- start ----------
zaznaczKrok();
ulozObraz();
odswiez();
petlaStanu();
if (Date.now() - cfg.aktSprawdzono > 24 * 3600 * 1000) setTimeout(() => sprawdzAktualizacje(false), 4000);
