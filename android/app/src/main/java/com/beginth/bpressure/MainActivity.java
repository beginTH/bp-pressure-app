package com.beginth.bpressure;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.ConsoleMessage;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.Window;
import android.view.WindowManager;

@SuppressWarnings("deprecation")
public class MainActivity extends Activity {
    private WebView webView;
    private static final int CAMERA_PERMISSION_REQUEST = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Fullscreen, no title bar
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );

        // Set status/nav bar color to match the app
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(0xFF0A0A0C);
            getWindow().setNavigationBarColor(0xFF0A0A0C);
        }

        webView = new WebView(this);

        // --- WebView Settings ---
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);

        // Storage & Database support (IndexedDB)
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);

        // File & Blob URL access
        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);

        // Media
        settings.setMediaPlaybackRequiresUserGesture(false);

        // Cache
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Mixed content (allow https to load http resources if needed)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        // --- WebViewClient ---
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                view.loadUrl(url);
                return true;
            }
        });

        // --- WebChromeClient ---
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("BPressure AI")
                    .setMessage(message)
                    .setPositiveButton("ตกลง", (dialog, which) -> result.confirm())
                    .setCancelable(false)
                    .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("BPressure AI")
                    .setMessage(message)
                    .setPositiveButton("ใช่", (dialog, which) -> result.confirm())
                    .setNegativeButton("ไม่", (dialog, which) -> result.cancel())
                    .setCancelable(false)
                    .show();
                return true;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                android.util.Log.d("BPressureAI", consoleMessage.message()
                    + " -- line " + consoleMessage.lineNumber()
                    + " of " + consoleMessage.sourceId());
                return true;
            }
        });

        webView.loadUrl("https://beginth.github.io/bp-pressure-app/");
        setContentView(webView);

        // Request camera permission
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
