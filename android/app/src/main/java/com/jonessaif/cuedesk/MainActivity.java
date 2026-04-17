package com.jonessaif.cuedesk;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.annotation.Nullable;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    public static final String EXTRA_SERVER_URL = "serverUrl";
    private static final String PREFS_NAME = "cuedesk_server_prefs";
    private static final String KEY_SERVER_URL = "serverUrl";
    private static final String SERVER_CONFIG_SCHEME = "cuedesk";
    private static final String SERVER_CONFIG_HOST = "server-config";
    private static final long INITIAL_LOAD_TIMEOUT_MS = 2000L;
    private boolean serverRecoveryTriggered = false;
    private boolean firstPageLoaded = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable initialLoadTimeoutRunnable = this::maybeRecoverFromInitialLoadTimeout;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        if (shouldOpenServerConfig(getIntent())) {
            openServerConfigScreen();
            finish();
            return;
        }

        applyServerUrlFromIntent(getIntent());

        String serverUrl = readServerUrl(this);
        if (serverUrl == null) {
            startActivity(new Intent(this, ServerConfigActivity.class));
            finish();
            return;
        }

        this.config = new CapConfig.Builder(this).setServerUrl(serverUrl).create();
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void load() {
        super.load();
        if (getBridge() != null && getBridge().getWebView() != null) {
            // Hide WebView until first successful page load to avoid showing
            // Android's default "Web page not available" screen.
            getBridge().getWebView().setVisibility(View.INVISIBLE);
        }
        getBridge().addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageLoaded(WebView webView) {
                    // Ignore: onPageLoaded can fire for intermediate/error pages.
                }

                @Override
                public void onPageCommitVisible(WebView webView, String url) {
                    if (isConfiguredServerPage(url)) {
                        firstPageLoaded = true;
                        mainHandler.removeCallbacks(initialLoadTimeoutRunnable);
                        if (webView != null) {
                            webView.setVisibility(View.VISIBLE);
                        }
                    }
                }

                @Override
                public void onReceivedError(WebView webView) {
                    maybeRecoverFromServerFailure(webView);
                }

                @Override
                public void onReceivedHttpError(WebView webView) {
                    maybeRecoverFromServerFailure(webView);
                }
            }
        );

        // Safety net: if initial page never loads (some OEM WebViews swallow errors),
        // send user to server setup instead of keeping the default "Web page not available" screen.
        mainHandler.postDelayed(initialLoadTimeoutRunnable, INITIAL_LOAD_TIMEOUT_MS);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (shouldOpenServerConfig(intent)) {
            openServerConfigScreen();
            return;
        }
        if (applyServerUrlFromIntent(intent)) {
            // Recreate bridge with new runtime server URL.
            recreate();
        }
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacks(initialLoadTimeoutRunnable);
        super.onDestroy();
    }

    public static void saveServerUrl(Context context, String serverUrl) {
        String normalized = normalizeServerUrl(serverUrl);
        if (normalized == null) {
            return;
        }
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_SERVER_URL, normalized).commit();
    }

    @Nullable
    public static String readServerUrl(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_SERVER_URL, null);
        return normalizeServerUrl(raw);
    }

    @Nullable
    private static String normalizeServerUrl(@Nullable String raw) {
        if (raw == null) {
            return null;
        }
        String value = raw.trim();
        if (value.isEmpty()) {
            return null;
        }

        if (!value.startsWith("http://") && !value.startsWith("https://")) {
            value = "http://" + value;
        }

        if (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }

        Uri parsed = Uri.parse(value);
        String scheme = parsed.getScheme();
        String host = parsed.getHost();
        if (host == null || host.trim().isEmpty()) {
            return null;
        }
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
            return null;
        }

        int port = parsed.getPort();
        if (port != -1 && (port < 1 || port > 65535)) {
            return null;
        }

        return value;
    }

    private boolean shouldOpenServerConfig(@Nullable Intent intent) {
        if (intent == null) {
            return false;
        }
        Uri data = intent.getData();
        if (data == null) {
            return false;
        }
        String scheme = data.getScheme();
        String host = data.getHost();
        return SERVER_CONFIG_SCHEME.equalsIgnoreCase(scheme) && SERVER_CONFIG_HOST.equalsIgnoreCase(host);
    }

    private void openServerConfigScreen() {
        startActivity(new Intent(this, ServerConfigActivity.class));
    }

    private void maybeRecoverFromServerFailure(@Nullable WebView webView) {
        if (!tryStartRecovery()) {
            return;
        }
        mainHandler.removeCallbacks(initialLoadTimeoutRunnable);
        String configuredServer = readServerUrl(this);
        if (configuredServer == null) {
            return;
        }
        if (webView == null) {
            return;
        }
        // Recover only during initial document load; ignore later sub-resource failures.
        if (webView.getProgress() > 35) {
            return;
        }

        String currentUrl = webView.getUrl();
        if (currentUrl == null || !currentUrl.startsWith(configuredServer)) {
            return;
        }

        recoverToServerSetup("Unable to reach server. Update IP/port.");
    }

    private void maybeRecoverFromInitialLoadTimeout() {
        if (!tryStartRecovery()) {
            return;
        }
        if (firstPageLoaded) {
            return;
        }
        String configuredServer = readServerUrl(this);
        if (configuredServer == null) {
            return;
        }

        recoverToServerSetup("Server not reachable. Please update IP/port.");
    }

    private boolean applyServerUrlFromIntent(@Nullable Intent intent) {
        if (intent == null) {
            return false;
        }
        if (!intent.hasExtra(EXTRA_SERVER_URL)) {
            return false;
        }

        String urlFromIntent = normalizeServerUrl(intent.getStringExtra(EXTRA_SERVER_URL));
        // Consume one-time override so stale launcher intents never re-apply old server values.
        intent.removeExtra(EXTRA_SERVER_URL);
        setIntent(intent);

        if (urlFromIntent == null) {
            return false;
        }

        String current = readServerUrl(this);
        if (urlFromIntent.equals(current)) {
            return false;
        }
        saveServerUrl(this, urlFromIntent);
        return true;
    }

    private synchronized boolean tryStartRecovery() {
        if (serverRecoveryTriggered) {
            return false;
        }
        serverRecoveryTriggered = true;
        return true;
    }

    private boolean isConfiguredServerPage(@Nullable String url) {
        String configuredServer = readServerUrl(this);
        if (configuredServer == null || url == null) {
            return false;
        }
        return url.startsWith(configuredServer);
    }

    private void recoverToServerSetup(String message) {
        runOnUiThread(() -> {
            Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
            openServerConfigScreen();
            finish();
        });
    }
}
