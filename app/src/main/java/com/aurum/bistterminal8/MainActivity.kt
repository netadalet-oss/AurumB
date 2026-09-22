package com.aurum.bistterminal8

// RECONSTRUCTED_FROM_DEX
// Native method surface/commands are DEX-proven; bridge payloads are constrained by APK-exact JS assets.

import android.app.AlertDialog
import android.app.NotificationChannel
import android.app.NotificationManager
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import androidx.activity.OnBackPressedCallback\nimport androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.OutputStreamWriter

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var exportFolder: Uri? = null\n\n    private val folderPicker = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->\n        if (uri != null) {\n            runCatching {\n                contentResolver.takePersistableUriPermission(\n                    uri,\n                    android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION\n                )\n            }\n            exportFolder = uri\n            getSharedPreferences("aurum_export_folder", MODE_PRIVATE).edit()\n                .putString("uri", uri.toString()).apply()\n            if (::webView.isInitialized) webView.evaluateJavascript("window.refreshExportFolderStatus?.()", null)\n        }\n    }

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    inner class NativeBridge {
        @JavascriptInterface
        fun call(message: String, body: String): String = handleNative(message, body)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        exportFolder = getSharedPreferences("aurum_export_folder", MODE_PRIVATE)\n            .getString("uri", null)?.let(Uri::parse)\n        webView = WebView(this)
        setContentView(webView)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.addJavascriptInterface(NativeBridge(), "AurumNativeBridge")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?) =
                request?.url?.let(assetLoader::shouldInterceptRequest)
        }
        webView.webChromeClient = WebChromeClient()
        if (savedInstanceState == null) {
            webView.loadUrl("https://appassets.androidplatform.net/assets/index.html")
        } else {
            webView.restoreState(savedInstanceState)
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })
    }

    fun handleNative(message: String, body: String): String {
        val uri = runCatching { Uri.parse(message) }.getOrNull() ?: return ""
        if (uri.scheme != "aurum" || uri.host != "native") return ""
        return when (uri.getQueryParameter("cmd").orEmpty()) {
            "secret_status" -> if (SecureSecretStore.configured(this)) "1" else "0"
            "secret_set" -> { SecureSecretStore.put(this, body.trim()); "OK" }
            "secret_delete" -> { SecureSecretStore.delete(this); "OK" }
            "secret_input" -> { runOnUiThread { openSecretEditor() }; "OPENED" }
            "http_cancel" -> { NativeMarketHttp.cancel(uri.getQueryParameter("requestId").orEmpty()); "OK" }
            "http_request" -> {
                val id = uri.getQueryParameter("requestId").orEmpty()
                NativeMarketHttp.request(this, id, uri.getQueryParameter("method") ?: "GET",
                    uri.getQueryParameter("url").orEmpty(), body,
                    uri.getQueryParameter("timeout")?.toIntOrNull() ?: 15000
                ) { payload -> resolveJs("window.AurumNativeHTTP.resolve", id, payload) }
                "ACCEPTED"
            }
            "openai_request" -> {
                val id = uri.getQueryParameter("requestId").orEmpty()
                NativeOpenAI.request(this, id, uri.getQueryParameter("path").orEmpty(), body
                ) { payload -> resolveJs("window.AurumNativeAI.resolve", id, payload) }
                "ACCEPTED"
            }
            "folder_status" -> currentFolderUri()?.toString().orEmpty()
            "folder_clear" -> { exportFolder = null; "OK" }
            "export" -> exportBytes(uri.getQueryParameter("name").orEmpty(),
                uri.getQueryParameter("mime") ?: "application/octet-stream", body, "", "")
            "notify" -> postNotification(uri.getQueryParameter("id").orEmpty(),
                uri.getQueryParameter("title").orEmpty(), uri.getQueryParameter("text").orEmpty(), body)
            "schedule" -> {
                val o = runCatching { JSONObject(body) }.getOrElse { JSONObject() }
                val a = o.optJSONArray("times")
                val times = mutableListOf<String>()
                if (a != null) for (i in 0 until a.length()) times.add(a.optString(i))
                if (AurumScheduler.install(this, o.optBoolean("enabled", true), times)) "OK" else "ERROR"
            }
            else -> ""
        }
    }

    private fun resolveJs(function: String, id: String, payload: String) {
        runOnUiThread {
            webView.evaluateJavascript(function + "(" + JSONObject.quote(id) + "," +
                JSONObject.quote(payload) + ")", null)
        }
    }

    fun currentFolderUri(): Uri? = exportFolder

    fun exportBytes(name: String, mime: String, data: String, a: String, b: String): String {
        val folder = currentFolderUri() ?: return "NO_FOLDER"
        return runCatching {
            val target = android.provider.DocumentsContract.createDocument(contentResolver, folder, mime, name)
                ?: return "ERROR"
            contentResolver.openOutputStream(target)?.use {
                OutputStreamWriter(it, Charsets.UTF_8).use { writer -> writer.write(data) }
            }
            target.toString()
        }.getOrDefault("ERROR")
    }

    fun openSecretEditor() {
        val input = EditText(this).apply { inputType = 0x81 }
        AlertDialog.Builder(this).setTitle("OpenAI API Key").setView(input)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                val value = input.text.toString().trim()
                if (value.isNotEmpty()) {
                    SecureSecretStore.put(this, value)
                    webView.evaluateJavascript("window.AurumNativeAIKeySaved(true)", null)
                }
            }.setNegativeButton(android.R.string.cancel, null).show()
    }

    fun postNotification(id: String, title: String, text: String, extra: String): String {
        val channel = "aurum_pipeline"
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(channel, "Aurum", NotificationManager.IMPORTANCE_DEFAULT))
        nm.notify(id.hashCode(), NotificationCompat.Builder(this, channel)
            .setSmallIcon(android.R.drawable.stat_notify_more).setContentTitle(title)
            .setContentText(text).setAutoCancel(true).build())
        return "OK"
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        webView.removeJavascriptInterface("AurumNativeBridge")
        webView.destroy()
        super.onDestroy()
    }
}
