package com.aurum.bistterminal8

// RECONSTRUCTED_FROM_DEX
// Native method surface/commands are DEX-proven; bridge payloads are constrained by APK-exact JS assets.

import android.app.AlertDialog
import android.app.NotificationChannel
import android.app.NotificationManager
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.JsPromptResult
import android.webkit.RenderProcessGoneDetail
import android.util.Log
import android.widget.TextView
import android.widget.Button
import android.widget.LinearLayout
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.OutputStreamWriter

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var exportFolder: Uri? = null
    private var dataOperationOwner: String? = null
    private var rendererLossCount = 0
    private var lastRendererLossAt = 0L

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
            if (::webView.isInitialized && webView.parent != null) webView.evaluateJavascript("window.refreshExportFolderStatus?.()", null)
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


    /** Rebuild a WebView after Chromium renderer death without deleting IndexedDB data.
     * The JavaScript startup path restores the last persisted transfer checkpoint.
     */
    private fun webViewSupportsRuntime(): Boolean {
        // ES2020 optional chaining/nullish coalescing is required by bundled assets.
        val packageInfo = WebView.getCurrentWebViewPackage()
        val major = packageInfo?.versionName?.substringBefore('.')?.toIntOrNull()
        if (major == null) {
            Log.w("AurumWebView", "Cannot determine WebView major version; retaining standard runtime startup")
            return true
        }
        if (major < 80) {
            Log.e("AurumWebView", "Unsupported Chromium WebView major=$major; bundled JavaScript requires >=80")
            return false
        }
        return true
    }

    private fun unsupportedWebViewScreen() {
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(36, 48, 36, 48)
            addView(TextView(this@MainActivity).apply {
                text = "Android System WebView veya Chrome sürümü çok eski. Uygulama kodunu çalıştırmak için WebView/Chrome'u güncelleyin, sonra Aurum'u yeniden açın. Yerel veriler ve aktarım kayıtları silinmedi."
                textSize = 17f
            })
            addView(Button(this@MainActivity).apply {
                text = "Uygulamayı kapat"
                setOnClickListener { finish() }
            })
        }
        setContentView(panel)
    }

    private fun installWebView(savedInstanceState: Bundle? = null) {
        if (!webViewSupportsRuntime()) {
            unsupportedWebViewScreen()
            return
        }
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
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                Log.e("AurumWebView", "Renderer terminated; crashed=${detail.didCrash()}, priority=${detail.rendererPriorityAtExit()}")
                val current = view === webView
                (view.parent as? ViewGroup)?.removeView(view)
                runCatching { view.removeJavascriptInterface("AurumNativeBridge") }
                runCatching { view.destroy() }
                if (!current || isFinishing || isDestroyed) return true
                val now = android.os.SystemClock.elapsedRealtime()
                rendererLossCount = if (now - lastRendererLossAt <= 60_000L) rendererLossCount + 1 else 1
                lastRendererLossAt = now
                if (rendererLossCount <= 2) {
                    installWebView()
                } else {
                    val fallback = LinearLayout(this@MainActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(36, 48, 36, 48)
                        addView(TextView(this@MainActivity).apply {
                            text = "WebView işlemi art arda kapandı. Yerel kayıtlar silinmedi; son doğrulanmış tablo korundu."
                            textSize = 17f
                        })
                        addView(Button(this@MainActivity).apply {
                            text = "Verileri koruyarak yeniden aç"
                            setOnClickListener {
                                rendererLossCount = 0
                                installWebView()
                            }
                        })
                    }
                    setContentView(fallback)
                }
                return true
            }
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

    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Foreground launch remains network-idle; only the wall-clock weekly maintenance alarm is made durable here.
        AurumScheduler.rearm(this)
        WebView.setWebContentsDebuggingEnabled((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0)
        exportFolder = getSharedPreferences("aurum_export_folder", MODE_PRIVATE)
            .getString("uri", null)?.let(Uri::parse)
        installWebView(savedInstanceState)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (!::webView.isInitialized || webView.parent == null) finish()
                else if (webView.canGoBack()) webView.goBack() else finish()
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
            "operation_lock_acquire" -> {
                val kind = uri.getQueryParameter("kind").orEmpty().lowercase().let {
                    if (it == "market") "market" else "data"
                }
                val owner = uri.getQueryParameter("owner").orEmpty()
                if (owner.isBlank()) "ERR:MISSING_OWNER"
                else if (OperationLock.acquire(kind, owner)) {
                    if (kind == "data") dataOperationOwner = owner
                    "OK"
                } else "BUSY"
            }
            "operation_lock_release" -> {
                val kind = uri.getQueryParameter("kind").orEmpty().lowercase().let {
                    if (it == "market") "market" else "data"
                }
                val owner = uri.getQueryParameter("owner").orEmpty()
                if (owner.isBlank()) "ERR:MISSING_OWNER"
                else if (OperationLock.release(kind, owner)) {
                    if (kind == "data" && dataOperationOwner == owner) dataOperationOwner = null
                    "OK"
                } else "ERR:NOT_OWNER"
            }
            "relay_endpoint_set" -> {
                val raw = body.trim()
                if (raw.isBlank()) {
                    SavedRelayPolicy.clear(this)
                    "OK"
                } else if (SavedRelayPolicy.save(this, raw)) "OK"
                else "ERR:INVALID_RELAY_ENDPOINT"
            }
            "http_cancel" -> {
                val id = uri.getQueryParameter("requestId").orEmpty()
                if (id.isBlank()) "ERR:MISSING_REQUEST_ID"
                else { NativeMarketHttp.cancel(id); "OK" }
            }
            "transfer_keepalive" -> {
                val enabled = uri.getQueryParameter("enabled") != "0"
                runCatching {
                    val intent = android.content.Intent(this, TransferKeepaliveService::class.java)
                    if (enabled) ContextCompat.startForegroundService(this, intent)
                    else stopService(intent)
                    "OK"
                }.getOrElse { cause ->
                    /* Android 12+ can prohibit foreground-service starts; a bridge command
                     * must never turn that restriction into an Activity crash. */
                    Log.w("AurumTransfer", "Keepalive command rejected by Android", cause)
                    "ERR:KEEPALIVE_UNAVAILABLE"
                }
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
            "schedule_status" -> AurumScheduler.statusJson(this)
            "schedule_exact_settings" -> {
                if (android.os.Build.VERSION.SDK_INT >= 31 && !AurumScheduler.exactAllowed(this)) {
                    val opened = runCatching {
                        startActivity(
                            android.content.Intent(
                                android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                                Uri.parse("package:$packageName")
                            )
                        )
                        true
                    }.getOrDefault(false)
                    if (opened) "OPENED" else "ERR:EXACT_SETTINGS_UNAVAILABLE"
                } else "OK"
            }
            "schedule" -> {
                val enabled = uri.getQueryParameter("enabled") != "0"
                val kind = uri.getQueryParameter("kind").orEmpty().let { if (it == "market") "market" else "data" }
                val times = uri.getQueryParameter("times").orEmpty().split(',').map(String::trim).filter(String::isNotEmpty)
                if (enabled && (times.isEmpty() || times.any { !AurumScheduler.valid(it) })) "ERR:INVALID_SCHEDULE"
                else if (AurumScheduler.install(this, enabled, times, kind)) "OK" else "ERR:INVALID_SCHEDULE"
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

    private fun refreshPublishedLocalState() {
        if (!::webView.isInitialized || webView.parent == null) return
        runOnUiThread {
            if (webView.parent == null) return@runOnUiThread
            webView.evaluateJavascript(
                "window.AurumPublicationContinuity&&window.AurumPublicationContinuity.reload&&window.AurumPublicationContinuity.reload()",
                null
            )
        }
    }

    override fun onStart() {
        super.onStart()
        PublicationBus.attach { refreshPublishedLocalState() }
    }

    override fun onResume() {
        super.onResume()
        // Cache-only resync. This never starts a provider request or a scheduler job.
        AurumScheduler.rearm(this)
        refreshPublishedLocalState()
    }

    override fun onStop() {
        PublicationBus.detach()
        super.onStop()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        if (::webView.isInitialized && webView.parent != null) webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        stopService(android.content.Intent(this, TransferKeepaliveService::class.java))
        dataOperationOwner?.let { OperationLock.release("data", it) }
        dataOperationOwner = null
        if (::webView.isInitialized && webView.parent != null) {
            runCatching { webView.removeJavascriptInterface("AurumNativeBridge") }
            runCatching { (webView.parent as? ViewGroup)?.removeView(webView) }
            runCatching { webView.destroy() }
        }
        super.onDestroy()
    }
}
