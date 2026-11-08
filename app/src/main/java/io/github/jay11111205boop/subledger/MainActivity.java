package io.github.jay11111205boop.subledger;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Hosts the interface in a WebView and provides the two things a web page
 * cannot do on its own: saving a backup file and picking one to restore.
 *
 * The app declares no permissions, including no internet permission.
 * Files are read and written only through the system file picker, and only
 * the file the person chooses.
 */
public class MainActivity extends Activity {

    private static final String PAGE = "file:///android_asset/index.html";
    private static final int REQ_EXPORT = 1;
    private static final int REQ_IMPORT = 2;
    private static final int MAX_IMPORT_BYTES = 5 * 1024 * 1024;

    private WebView web;
    private String pendingExport;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        setContentView(web);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setSupportZoom(false);

        // Nothing outside the bundled page is ever loaded.
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "Android");
        web.loadUrl(PAGE);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    /** Lets the page handle Back first (closing a screen), then exits. */
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.appBack ? window.appBack() : false", value -> {
            if (!"true".equals(value)) {
                finish();
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            if (requestCode == REQ_EXPORT) {
                pendingExport = null;
            }
            return;
        }

        Uri uri = data.getData();
        if (requestCode == REQ_EXPORT) {
            writeExport(uri);
        } else if (requestCode == REQ_IMPORT) {
            readImport(uri);
        }
    }

    private void writeExport(Uri uri) {
        try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null || pendingExport == null) {
                throw new IllegalStateException("Nothing to write");
            }
            out.write(pendingExport.getBytes(StandardCharsets.UTF_8));
            message("Backup saved.");
        } catch (Exception e) {
            message("Could not save the backup.");
        } finally {
            pendingExport = null;
        }
    }

    private void readImport(Uri uri) {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) {
                throw new IllegalStateException("Cannot open file");
            }
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = in.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
                if (buffer.size() > MAX_IMPORT_BYTES) {
                    message("That file is too large to be a backup.");
                    return;
                }
            }
            String text = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
            web.evaluateJavascript("window.onImportedText(" + JSONObject.quote(text) + ")", null);
        } catch (Exception e) {
            message("Could not read that file.");
        }
    }

    private void message(String text) {
        web.evaluateJavascript("window.onNativeMessage(" + JSONObject.quote(text) + ")", null);
    }

    /** Methods the page can call as window.Android.something(). */
    private class Bridge {

        @JavascriptInterface
        public String getVersion() {
            try {
                PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
                return info.versionName == null ? "" : info.versionName;
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void exportBackup(final String json, final String filename) {
            runOnUiThread(() -> {
                pendingExport = json;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, filename);
                try {
                    startActivityForResult(intent, REQ_EXPORT);
                } catch (ActivityNotFoundException e) {
                    pendingExport = null;
                    message("No file app is available to save the backup.");
                }
            });
        }

        @JavascriptInterface
        public void importBackup() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                try {
                    startActivityForResult(intent, REQ_IMPORT);
                } catch (ActivityNotFoundException e) {
                    message("No file app is available to pick a backup.");
                }
            });
        }
    }
}
