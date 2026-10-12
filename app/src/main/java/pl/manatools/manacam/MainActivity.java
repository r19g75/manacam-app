package pl.manatools.manacam;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

// Powloka aplikacji: interfejs w assets/www (HTML/JS), tu tylko to, czego strona sama nie zrobi.
public class MainActivity extends Activity {
    private static final String START = "http://appassets.androidplatform.net/assets/www/index.html";

    private WebView web;
    private ConnectivityManager cm;
    private ConnectivityManager.NetworkCallback wifiCb;

    @Override
    protected void onCreate(Bundle stan) {
        super.onCreate(stan);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        cm = getSystemService(ConnectivityManager.class);
        przypnijDoWifi();

        // Strona z http://appassets... (nie file://, nie https): fetch do http://192.168.4.1 bez blokady mixed content.
        final WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .setHttpAllowed(true)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                 // localStorage: adres i haslo kamery
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);   // nowa wersja interfejsu = nowy APK, bez starych plikow z cache
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return assets.shouldInterceptRequest(r.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if ("appassets.androidplatform.net".equals(r.getUrl().getHost())) return false;
                otworzZewnetrznie(r.getUrl().toString());   // linki poza aplikacje -> przegladarka
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient());   // bez tego WebView pomija alert/confirm z JS
        web.addJavascriptInterface(new Natywne(), "Natywne");
        setContentView(web);
        if (stan == null) web.loadUrl(START);
        else web.restoreState(stan);
    }

    // Android przy Wi-Fi bez internetu (siec kamery) kieruje ruch aplikacji na dane komorkowe
    // i 192.168.4.1 jest nieosiagalne. Przypinamy proces do Wi-Fi, gdy tylko jest dostepne.
    private void przypnijDoWifi() {
        NetworkRequest req = new NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build();
        wifiCb = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network n) {
                cm.bindProcessToNetwork(n);
            }

            @Override
            public void onLost(Network n) {
                if (n.equals(cm.getBoundNetworkForProcess())) cm.bindProcessToNetwork(null);
            }
        };
        cm.registerNetworkCallback(req, wifiCb);
    }

    private void otworzZewnetrznie(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle stan) {
        super.onSaveInstanceState(stan);
        web.saveState(stan);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.evaluateJavascript("window.wTle && wTle(true)", null);    // zwolnij strumien (kamera ma 1 miejsce)
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.evaluateJavascript("window.wTle && wTle(false)", null);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.wstecz ? wstecz() : false", wynik -> {
            if (!"true".equals(wynik)) MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onDestroy() {
        try {
            cm.unregisterNetworkCallback(wifiCb);
        } catch (Exception ignored) {
        }
        cm.bindProcessToNetwork(null);
        web.destroy();
        super.onDestroy();
    }

    class Natywne {
        @JavascriptInterface
        public String wersja() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public int wersjaKod() {
            return BuildConfig.VERSION_CODE;
        }

        @JavascriptInterface
        public void otworz(String url) {
            otworzZewnetrznie(url);
        }

        // Zdjecie z /capture (base64 JPEG) -> Galeria, folder Pictures/manaCam. Zwraca nazwe albo "BLAD: ...".
        @JavascriptInterface
        public String zapiszZdjecie(String b64) {
            try {
                byte[] dane = Base64.decode(b64, Base64.DEFAULT);
                String nazwa = "manaCam_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date()) + ".jpg";
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, nazwa);
                v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
                v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/manaCam");
                Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                if (uri == null) return "BLAD: brak dostepu do galerii";
                try (OutputStream o = getContentResolver().openOutputStream(uri)) {
                    o.write(dane);
                }
                return nazwa;
            } catch (Exception e) {
                return "BLAD: " + e.getMessage();
            }
        }
    }
}
