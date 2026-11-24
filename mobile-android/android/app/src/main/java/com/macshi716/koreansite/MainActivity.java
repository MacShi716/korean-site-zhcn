package com.macshi716.koreansite;

import android.graphics.Color;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final int LIGHT_PAGE = Color.parseColor("#F2EBDD");
    private static final int DARK_PAGE = Color.parseColor("#070C11");

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        if (webView == null) {
            return;
        }

        WebSettings settings = webView.getSettings();
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        webView.setBackgroundColor(LIGHT_PAGE);
        applyChrome(false);
        webView.addJavascriptInterface(new ChromeBridge(), "KoreanSiteAndroid");

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView view = getBridge().getWebView();
                if (view != null && view.canGoBack()) {
                    view.goBack();
                    return;
                }
                setEnabled(false);
                finish();
            }
        });
    }

    private void applyChrome(boolean dark) {
        int page = dark ? DARK_PAGE : LIGHT_PAGE;
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(page);
        getWindow().getDecorView().setBackgroundColor(page);
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.setBackgroundColor(page);
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
    }

    private final class ChromeBridge {
        @JavascriptInterface
        public void setMode(String mode) {
            boolean dark = "dark".equals(mode);
            runOnUiThread(() -> applyChrome(dark));
        }
    }
}
