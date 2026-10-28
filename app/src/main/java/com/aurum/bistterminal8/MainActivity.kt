package com.aurum.bistterminal8

// RECONSTRUCTED_FROM_DEX
// Native method surface/commands are DEX-proven; bridge payloads are constrained by APK-exact JS assets.

import android.app.AlertDialog
import android.app.NotificationChannel
import android.app.NotificationManager
import android.net.Uri
import android.os.Bundle
import android.webkit.JsPromptResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.TextView
import android.widget.Button
import android.widget.LinearLayout
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
    private var rendererLost = false
    private var exportFolder: Uri? = null

    // The export stream contains only AES-GCM encrypted Legacy JSON.
    // It never receives unencrypted IndexedDB rows or password material.
    private var encryptedBackupStream: java.io.OutputStream? = null
    private var encryptedBackupUri: Uri? = null
    private var encryptedBackupPending: Boolean = false
    private var encryptedBackupBytes: Long = 0L
    private var backupFileChooserCallback: android.webkit.ValueCallback<Array<Uri>>? = null
    private val backupFilePicker = registerForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        val callback = backupFileChooserCallback
        backupFileChooserCallback = null
        callback?.onReceiveValue(uri?.let { arrayOf(it) })
    }


    private var dataOperationOwner: String? = null

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
            if (::webView.isInitialized && !rendererLost && webView.parent != null) webView.evaluateJavascript("window.refreshExportFolderStatus?.()", null)
        }
    }

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }


    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Foreground launch remains network-idle; only the wall-clock weekly maintenance alarm is made durable here.
        AurumScheduler.scheduleWeeklyMaintenance(this)
        WebView.setWebContentsDebuggingEnabled((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0)
        exportFolder = getSharedPreferences("aurum_export_folder", MODE_PRIVATE)
            .getString("uri", null)?.let(Uri::parse)
        // This Legacy WebView bundle requires ES2020; an obsolete embedded Chromium
        // must not open a blank JS app or be mistaken for a failed market refresh.
        val webViewMajor = WebView.getCurrentWebViewPackage()?.versionName?.substringBefore('.')?.toIntOrNull()
        if (webViewMajor != null && webViewMajor < 80) {
            setContentView(LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(36, 48, 36, 48)
                addView(TextView(this@MainActivity).apply {
                    text = "Android System WebView veya Chrome sürümü çok eski. AurumB Legacy verileri silinmedi. WebView/Chrome'u güncelleyip yeniden açın."
                    textSize = 17f
                })
                addView(Button(this@MainActivity).apply {
                    text = "Kapat"
                    setOnClickListener { finish() }
                })
            })
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
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView?, filePathCallback: android.webkit.ValueCallback<Array<Uri>>?,
                fileChooserParams: WebChromeClient.FileChooserParams?
            ): Boolean {
                val trusted = view?.url?.startsWith("https://appassets.androidplatform.net/assets/") == true
                if (!trusted || filePathCallback == null) return false
                backupFileChooserCallback?.onReceiveValue(null)
                backupFileChooserCallback = filePathCallback
                return try {
                    backupFilePicker.launch("application/json")
                    true
                } catch (_: Throwable) {
                    backupFileChooserCallback?.onReceiveValue(null)
                    backupFileChooserCallback = null
                    false
                }
            }
            override fun onJsPrompt(
                view: WebView?, url: String?, message: String?, defaultValue: String?, result: JsPromptResult?
            ): Boolean {
                if (message?.startsWith("aurum://native?") == true) {
                    val source = runCatching { Uri.parse(url.orEmpty()) }.getOrNull()
                    val appOrigin = source?.scheme == "https" &&
                        source.host == "appassets.androidplatform.net" &&
                        source.path?.startsWith("/assets/") == true
                    val trustedTop = view?.url?.startsWith(
                        "https://appassets.androidplatform.net/assets/") == true
                    result?.confirm(if (appOrigin && trustedTop)
                        handleNative(message, defaultValue.orEmpty(), true)
                        else "ERR:UNTRUSTED_ORIGIN")
                    return true
                }
                return super.onJsPrompt(view, url, message, defaultValue, result)
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun onRenderProcessGone(view: WebView?, detail: android.webkit.RenderProcessGoneDetail?): Boolean {
                rendererLost = true
                android.util.Log.e("AurumBLegacy", "WebView renderer terminated (crash=${detail?.didCrash()})")
                runCatching { (view?.parent as? android.view.ViewGroup)?.removeView(view) }
                runCatching { view?.destroy() }
                setContentView(LinearLayout(this@MainActivity).apply {
                    orientation=LinearLayout.VERTICAL
                    setPadding(36,48,36,48)
                    addView(TextView(this@MainActivity).apply {
                        text="Legacy WebView işlemi kapandı. Kayıtlar silinmedi. Yeniden açarak son doğrulanmış verilere ulaşabilirsiniz."
                        textSize=17f
                    })
                    addView(Button(this@MainActivity).apply {
                        text="Kayıtları koruyarak yeniden aç"
                        setOnClickListener { recreate() }
                    })
                })
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
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (::webView.isInitialized && !rendererLost && webView.parent != null && webView.canGoBack()) webView.goBack() else finish()
            }
        })
    }

    fun handleNative(message: String, body: String, trustedPrompt: Boolean = false): String {
        if (!message.startsWith("aurum://native?")) return "ERR:INVALID_NATIVE_URI"
        val uri = runCatching { Uri.parse(message) }.getOrNull() ?: return "ERR:INVALID_NATIVE_URI"
        return when (uri.getQueryParameter("cmd").orEmpty()) {
            "backup_export_begin" -> if (trustedPrompt)
                beginEncryptedBackupExport(uri.getQueryParameter("name").orEmpty())
                else "ERR:UNTRUSTED_ORIGIN"
            "backup_export_chunk" -> if (trustedPrompt)
                writeEncryptedBackupChunk(body) else "ERR:UNTRUSTED_ORIGIN"
            "backup_export_finish" -> if (trustedPrompt)
                finishEncryptedBackupExport() else "ERR:UNTRUSTED_ORIGIN"
            "backup_export_abort" -> if (trustedPrompt)
                cancelEncryptedBackupExport() else "ERR:UNTRUSTED_ORIGIN"
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
                if (enabled) {
                    ContextCompat.startForegroundService(
                        this,
                        android.content.Intent(this, TransferKeepaliveService::class.java)
                    )
                } else {
                    stopService(android.content.Intent(this, TransferKeepaliveService::class.java))
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
            if (!::webView.isInitialized || rendererLost || webView.parent == null) return@runOnUiThread
            webView.evaluateJavascript(function + "(" + JSONObject.quote(id) + "," +
                JSONObject.quote(payload) + ")", null)
        }
    }

    fun currentFolderUri(): Uri? = exportFolder


    // For WebView, a blob: download is not supported without a DownloadListener.
    // Stream small chunks through trusted JS prompts into Android's Downloads.
    // On Android 26-28 use an explicitly selected SAF folder.
    private fun cancelEncryptedBackupExport(): String {
        runCatching { encryptedBackupStream?.close() }
        encryptedBackupStream = null
        encryptedBackupUri?.let { uri ->
            runCatching {
                if (encryptedBackupPending) contentResolver.delete(uri, null, null)
                else android.provider.DocumentsContract.deleteDocument(contentResolver, uri)
            }
        }
        encryptedBackupUri = null
        encryptedBackupPending = false
        encryptedBackupBytes = 0L
        return "OK"
    }

    private fun beginEncryptedBackupExport(rawName: String): String {
        if (encryptedBackupStream != null) return "ERR:BACKUP_EXPORT_BUSY"
        val name = rawName.replace(Regex("""[\\/:*?"<>|]"""), "_")
            .take(100).let { if (it.endsWith(".json")) it else it + ".json" }
        var uri: Uri? = null
        var pending = false
        return try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                val values = android.content.ContentValues().apply {
                    put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name)
                    put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "application/json")
                    put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH,
                        android.os.Environment.DIRECTORY_DOWNLOADS + "/Aurum")
                    put(android.provider.MediaStore.MediaColumns.IS_PENDING, 1)
                }
                uri = contentResolver.insert(
                    android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                pending = true
            } else {
                val tree = currentFolderUri() ?: return "ERR:NO_FOLDER_ANDROID_8_9"
                val parent = android.provider.DocumentsContract.buildDocumentUriUsingTree(
                    tree, android.provider.DocumentsContract.getTreeDocumentId(tree))
                uri = android.provider.DocumentsContract.createDocument(
                    contentResolver, parent, "application/json", name)
            }
            val document = uri ?: return "ERR:BACKUP_CREATE_FAILED"
            val out = contentResolver.openOutputStream(document, "w")
                ?: return "ERR:BACKUP_WRITE_UNAVAILABLE"
            encryptedBackupStream = out
            encryptedBackupUri = document
            encryptedBackupPending = pending
            encryptedBackupBytes = 0L
            "OK"
        } catch (_: Throwable) {
            encryptedBackupStream = null
            uri?.let { runCatching { contentResolver.delete(it, null, null) } }
            encryptedBackupUri = null
            encryptedBackupPending = false
            "ERR:BACKUP_EXPORT_START"
        }
    }

    private fun writeEncryptedBackupChunk(text: String): String {
        val stream = encryptedBackupStream ?: return "ERR:BACKUP_EXPORT_NOT_STARTED"
        if (text.isEmpty() || text.length > 24576) return "ERR:BACKUP_CHUNK_LENGTH"
        if (text.any { it.code > 127 }) return "ERR:BACKUP_CHUNK_NOT_ASCII"
        return try {
            val bytes = text.toByteArray(Charsets.US_ASCII)
            stream.write(bytes)
            encryptedBackupBytes += bytes.size
            "OK"
        } catch (_: Throwable) {
            cancelEncryptedBackupExport()
            "ERR:BACKUP_CHUNK_WRITE"
        }
    }

    private fun finishEncryptedBackupExport(): String {
        val stream = encryptedBackupStream ?: return "ERR:BACKUP_EXPORT_NOT_STARTED"
        val uri = encryptedBackupUri ?: return "ERR:BACKUP_EXPORT_NO_URI"
        if (encryptedBackupBytes < 100L) {
            cancelEncryptedBackupExport()
            return "ERR:BACKUP_EMPTY"
        }
        return try {
            stream.flush()
            stream.close()
            encryptedBackupStream = null
            if (encryptedBackupPending) {
                val done = android.content.ContentValues().apply {
                    put(android.provider.MediaStore.MediaColumns.IS_PENDING, 0)
                }
                if (contentResolver.update(uri, done, null, null) < 1)
                    throw java.io.IOException("Failed to publish encrypted backup")
            }
            encryptedBackupUri = null
            encryptedBackupPending = false
            encryptedBackupBytes = 0L
            "OK"
        } catch (_: Throwable) {
            cancelEncryptedBackupExport()
            "ERR:BACKUP_FINISH"
        }
    }


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
                    if (::webView.isInitialized && !rendererLost && webView.parent != null)
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
        if (!::webView.isInitialized || rendererLost || webView.parent == null) return
        runOnUiThread {
            if (rendererLost) return@runOnUiThread
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
        refreshPublishedLocalState()
    }

    override fun onStop() {
        PublicationBus.detach()
        super.onStop()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        if (::webView.isInitialized && !rendererLost && webView.parent != null) webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        cancelEncryptedBackupExport()
        backupFileChooserCallback?.onReceiveValue(null)
        backupFileChooserCallback = null
        stopService(android.content.Intent(this, TransferKeepaliveService::class.java))
        dataOperationOwner?.let { OperationLock.release("data", it) }
        dataOperationOwner = null
        if (::webView.isInitialized && !rendererLost && webView.parent != null) {
            webView.removeJavascriptInterface("AurumNativeBridge")
            webView.destroy()
        }
        super.onDestroy()
    }
}
