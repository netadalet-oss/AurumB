package com.aurum.bistterminal8

// RECONSTRUCTED_FROM_DEX
// Native method surface/commands are DEX-proven; bridge payloads are constrained by APK-exact JS assets.

import android.app.AlertDialog
import android.app.NotificationChannel
import android.app.NotificationManager
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.webkit.JavascriptInterface
import android.webkit.JsPromptResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.OutputStreamWriter

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var exportFolder: Uri? = null
    private var transferWakeLock: PowerManager.WakeLock? = null

    private val folderPicker = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null) {
            runCatching {
                contentResolver.takePersistableUriPermission(
                    uri,
                    android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                )
            }
            exportFolder = uri
            getSharedPreferences("aurum_export_folder", MODE_PRIVATE).edit()
                .putString("uri", uri.toString()).apply()
            if (::webView.isInitialized) webView.evaluateJavascript("window.refreshExportFolderStatus?.()", null)
        }
    }

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
        // Foreground launch must remain idle. Boot/time-change receivers and explicit schedule commands own alarm rearming.
        WebView.setWebContentsDebuggingEnabled((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0)
        exportFolder = getSharedPreferences("aurum_export_folder", MODE_PRIVATE)
            .getString("uri", null)?.let(Uri::parse)
        webView = WebView(this)
        setContentView(webView)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.databaseEnabled = true
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false
        webView.settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        webView.isFocusable = true
        webView.isFocusableInTouchMode = true
        webView.descendantFocusability = android.view.ViewGroup.FOCUS_AFTER_DESCENDANTS
        webView.addJavascriptInterface(NativeBridge(), "AurumNativeBridge")
        webView.webChromeClient = object : WebChromeClient() {
            override fun onJsPrompt(
                view: WebView?, url: String?, message: String?, defaultValue: String?, result: JsPromptResult?
            ): Boolean {
                if (message?.startsWith("aurum://native?") == true) {
                    result?.confirm(handleNative(message, defaultValue.orEmpty()))
                    return true
                }
                return super.onJsPrompt(view, url, message, defaultValue, result)
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?) =
                request?.url?.let(assetLoader::shouldInterceptRequest)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.scheme == "https" && uri.host == "appassets.androidplatform.net") return false
                if (uri.scheme == "https") {
                    runCatching {
                        startActivity(android.content.Intent(this@MainActivity, BrowserActivity::class.java)
                            .putExtra("url", uri.toString()))
                    }
                    return true
                }
                return true
            }
        }
        if (savedInstanceState == null) {
            webView.loadUrl("https://appassets.androidplatform.net/assets/index.html")
        } else {
            webView.restoreState(savedInstanceState)
        }
        webView.requestFocus()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })
    }

    fun handleNative(message: String, body: String): String {
        if (!message.startsWith("aurum://native?")) return "ERR:INVALID_NATIVE_URI"
        val uri = runCatching { Uri.parse(message) }.getOrNull() ?: return "ERR:INVALID_NATIVE_URI"
        return when (uri.getQueryParameter("cmd").orEmpty()) {
            "secret_status" -> if (SecureSecretStore.configured(this)) "1" else "0"
            "secret_set" -> {
                val secret = body.trim()
                if (secret.isBlank()) "ERR:INVALID_SECRET"
                else { SecureSecretStore.put(this, secret); "OK" }
            }
            "secret_delete" -> { SecureSecretStore.delete(this); "OK" }
            "secret_input" -> { runOnUiThread { openSecretEditor() }; "OPENED" }
            "http_cancel" -> {
                val id = uri.getQueryParameter("requestId").orEmpty()
                if (id.isBlank()) "ERR:MISSING_REQUEST_ID"
                else { NativeMarketHttp.cancel(id); "OK" }
            }
            "transfer_keepalive" -> {
                val enabled = uri.getQueryParameter("enabled") != "0"
                if (enabled) {
                    if (transferWakeLock?.isHeld != true) {
                        transferWakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
                            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AurumB:ActiveTransfer")
                            .apply { setReferenceCounted(false); acquire(6 * 60 * 60 * 1000L) }
                    }
                } else {
                    transferWakeLock?.let { if (it.isHeld) it.release() }
                    transferWakeLock = null
                }
                "OK"
            }
                        "http_request" -> {
                val id = uri.getQueryParameter("requestId").orEmpty()
                val url = uri.getQueryParameter("url").orEmpty()
                if (id.isBlank()) "ERR:MISSING_REQUEST_ID"
                else if (url.isBlank()) "ERR:MISSING_URL"
                else {
                    NativeMarketHttp.request(this, id, uri.getQueryParameter("method") ?: "GET",
                        url, body, (uri.getQueryParameter("timeout")?.toIntOrNull() ?: 15000).coerceIn(1000, 120000)
                    ) { payload -> resolveJs("window.AurumNativeHTTP&&window.AurumNativeHTTP.resolve", id, payload) }
                    "ACCEPTED"
                }
            }
            "openai_request" -> {
                val id = uri.getQueryParameter("requestId").orEmpty()
                val path = uri.getQueryParameter("path").orEmpty()
                if (id.isBlank()) "ERR:MISSING_REQUEST_ID"
                else if (path.isBlank()) "ERR:MISSING_PATH"
                else {
                    NativeOpenAI.request(
                        this, path, uri.getQueryParameter("method") ?: "GET", body
                    ) { payload -> resolveJs("window.AurumNativeAI&&window.AurumNativeAI.resolve", id, payload) }
                    "ACCEPTED"
                }
            }
            "open_url" -> {
                val raw = uri.getQueryParameter("url").orEmpty()
                val target = runCatching { Uri.parse(raw) }.getOrNull()
                if (target == null || target.scheme != "https") "ERR:MISSING_URL"
                else {
                    runCatching {
                        startActivity(android.content.Intent(this, BrowserActivity::class.java).putExtra("url", target.toString()))
                    }.fold(onSuccess = { "OPENED" }, onFailure = { "ERR:OPEN_URL" })
                }
            }
            "folder_pick" -> { runOnUiThread { folderPicker.launch(null) }; "PICKING" }
            "folder_status" -> currentFolderUri()?.toString().orEmpty()
            "folder_clear" -> {
                exportFolder?.let { uri ->
                    runCatching {
                        contentResolver.releasePersistableUriPermission(
                            uri,
                            android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or
                                android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        )
                    }
                }
                exportFolder = null
                getSharedPreferences("aurum_export_folder", MODE_PRIVATE)
                    .edit().remove("uri").apply()
                "OK"
            }
            "export" -> exportBytes(
                uri.getQueryParameter("name").orEmpty(),
                uri.getQueryParameter("mime") ?: "application/octet-stream",
                body,
                uri.getQueryParameter("encoding").orEmpty(),
                uri.getQueryParameter("target").orEmpty()
            )
            "notification" -> postNotification(
                uri.getQueryParameter("title").orEmpty(),
                uri.getQueryParameter("body").orEmpty(),
                uri.getQueryParameter("tag").orEmpty(),
                uri.getQueryParameter("channel").orEmpty().ifBlank { "aurum_pipeline" }
            )
            "schedule" -> {
                val enabled = uri.getQueryParameter("enabled") != "0"
                val times = uri.getQueryParameter("times").orEmpty()
                    .split(',').map(String::trim).filter(String::isNotEmpty)
                if (enabled && (times.isEmpty() || times.any { !AurumScheduler.valid(it) })) {
                    "ERR:INVALID_SCHEDULE"
                } else if (AurumScheduler.install(this, enabled, times)) "OK"
                else "ERR:INVALID_SCHEDULE"
            }
            else -> "ERR:UNSUPPORTED_NATIVE_COMMAND"
        }
    }

    private fun resolveJs(function: String, id: String, payload: String) {
        runOnUiThread {
            webView.evaluateJavascript(function + "(" + JSONObject.quote(id) + "," +
                JSONObject.quote(payload) + ")", null)
        }
    }

    fun currentFolderUri(): Uri? = exportFolder

    fun exportBytes(name: String, mime: String, data: String, encoding: String, target: String): String {
        val safeName = name.replace(Regex("""[\\/:*?"<>|]"""), "_").take(120)
            .ifBlank { "aurum_export" }
        val bytes = try {
            if (encoding.equals("base64", ignoreCase = true)) {
                android.util.Base64.decode(data, android.util.Base64.DEFAULT)
            } else data.toByteArray(Charsets.UTF_8)
        } catch (_: IllegalArgumentException) {
            return "ERR:INVALID_DATA"
        }

        var mediaUri: Uri? = null
        return try {
            val outUri = if (target == "custom") {
                val tree = currentFolderUri() ?: return "ERR:NO_FOLDER"
                val docId = android.provider.DocumentsContract.getTreeDocumentId(tree)
                val parent = android.provider.DocumentsContract.buildDocumentUriUsingTree(tree, docId)
                android.provider.DocumentsContract.createDocument(
                    contentResolver, parent,
                    mime.ifBlank { "application/octet-stream" }, safeName
                ) ?: return "ERR:CREATE_FILE"
            } else {
                if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q) {
                    return "ERR:ANDROID_10_REQUIRED"
                }
                val values = android.content.ContentValues().apply {
                    put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, safeName)
                    put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime.ifBlank { "application/octet-stream" })
                    put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS + "/Aurum")
                    put(android.provider.MediaStore.MediaColumns.IS_PENDING, 1)
                }
                contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?.also { mediaUri = it } ?: return "ERR:CREATE_FILE"
            }

            val out = contentResolver.openOutputStream(outUri, "w") ?: return "ERR:OPEN_FILE"
            out.use { it.write(bytes) }
            mediaUri?.let { uri ->
                val done = android.content.ContentValues().apply {
                    put(android.provider.MediaStore.MediaColumns.IS_PENDING, 0)
                }
                contentResolver.update(uri, done, null, null)
            }
            "OK"
        } catch (_: SecurityException) {
            "ERR:PERMISSION"
        } catch (_: java.io.IOException) {
            "ERR:WRITE_FILE"
        } catch (_: Throwable) {
            "ERR:WRITE_FILE"
        }
    }

    fun openSecretEditor() {
        val input = EditText(this).apply { inputType = 0x81 }
        AlertDialog.Builder(this).setTitle("OpenAI API Key").setView(input)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                val value = input.text.toString().trim()
                if (value.isNotEmpty()) {
                    SecureSecretStore.put(this, value)
                    webView.evaluateJavascript("window.AurumNativeAIKeySaved&&window.AurumNativeAIKeySaved(true)", null)
                }
            }.setNegativeButton(android.R.string.cancel, null).show()
    }

    fun postNotification(title: String, body: String, tag: String, channel: String): String {
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            androidx.core.content.ContextCompat.checkSelfPermission(
                this, android.Manifest.permission.POST_NOTIFICATIONS
            ) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) return "ERR:NOTIFICATION_PERMISSION"

        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(channel, "Aurum Bildirimleri", NotificationManager.IMPORTANCE_DEFAULT)
        )
        val notification = NotificationCompat.Builder(this, channel)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle(title.ifBlank { "Aurum BIST Rev 20" })
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .build()
        nm.notify(if (tag.isBlank()) body.hashCode() else tag.hashCode(), notification)
        return "OK"
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        transferWakeLock?.let { if (it.isHeld) it.release() }
        transferWakeLock = null
        webView.removeJavascriptInterface("AurumNativeBridge")
        webView.destroy()
        super.onDestroy()
    }
}
