package com.aurum.bistterminal8

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.net.Uri
import android.os.IBinder
import android.os.PowerManager
import android.webkit.JavascriptInterface
import android.webkit.JsPromptResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

/**
 * Headless execution host for scheduled Aurum pipelines.
 *
 * The background WebView must expose the same native market HTTP transport used by MainActivity.
 * Without this bridge native-market-http.js falls back to an unhandled JS prompt and every
 * allow-listed market request is rejected although the same operation works in the foreground.
 */
class PipelineService : Service() {
    private var webView: WebView? = null
    private var transferWakeLock: PowerManager.WakeLock? = null
    private var watchdog: android.os.Handler? = null
    private var watchdogTask: Runnable? = null
    private var operationLockKind: String? = null
    private var operationLockOwner: String? = null

    private inner class BackgroundNativeBridge {
        @JavascriptInterface
        fun call(message: String, body: String): String = handleNative(message, body)
    }

    override fun onCreate() {
        super.onCreate()
        val channel = "aurum_background_pipeline"
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(channel, "Aurum otomatik çalışmalar", NotificationManager.IMPORTANCE_LOW)
        )
        val notification = Notification.Builder(this, channel)
            .setContentTitle("Aurum")
            .setContentText("Planlanan veri çalışması yürütülüyor")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .build()
        startForeground(2020, notification)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val epoch = intent?.getLongExtra("epoch", 0L)?.takeIf { it > 0L }
            ?: run { stopSelf(startId); return START_NOT_STICKY }
        val jobToken = intent.getStringExtra("jobToken")
            ?: run { stopSelf(startId); return START_NOT_STICKY }
        val kind = intent.getStringExtra("pipelineKind").let { if (it == "market") "market" else "data" }

        // Never destroy an already-running background WebView to start another pipeline.
        // Duplicate same-slot alarms are filtered by SchedulerLedger; different overlapping
        // schedules fail closed and keep the first atomic job intact.
        if (webView != null) {
            SchedulerLedger.complete(this, jobToken, "FAILED", "PIPELINE_BUSY_ALREADY_RUNNING")
            return START_NOT_STICKY
        }
        if (!OperationLock.acquire(kind, jobToken)) {
            SchedulerLedger.complete(this, jobToken, "CANCELLED", kind.uppercase() + "_OPERATION_ALREADY_RUNNING")
            return START_NOT_STICKY
        }
        operationLockKind = kind
        operationLockOwner = jobToken

        acquireTransferWakeLock()
        watchdogTask?.let { watchdog?.removeCallbacks(it) }
        watchdog = android.os.Handler(mainLooper)
        watchdogTask = Runnable {
            SchedulerLedger.complete(this, jobToken, "FAILED", "PIPELINE_TIMEOUT")
            operationLockOwner?.let { owner -> operationLockKind?.let { kindKey -> OperationLock.release(kindKey, owner) } }
            operationLockKind = null
            operationLockOwner = null
            stopSelf(startId)
        }.also { watchdog?.postDelayed(it, 2 * 60 * 60 * 1000L) }

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        destroyWebView()
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW

            // native-bridge.js prefers this interface and only falls back to window.prompt.
            addJavascriptInterface(BackgroundNativeBridge(), "AurumNativeBridge")
            webChromeClient = object : WebChromeClient() {
                override fun onJsPrompt(
                    view: WebView?,
                    url: String?,
                    message: String?,
                    defaultValue: String?,
                    result: JsPromptResult?
                ): Boolean {
                    if (message?.startsWith("aurum://native?") == true) {
                        result?.confirm(handleNative(message, defaultValue.orEmpty()))
                        return true
                    }
                    return super.onJsPrompt(view, url, message, defaultValue, result)
                }
            }

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) =
                    loader.shouldInterceptRequest(request.url)

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    if (uri.scheme == "aurum" && uri.host == "complete") {
                        val ok = uri.getQueryParameter("ok") != "0"
                        val detail = uri.getQueryParameter("detail").orEmpty()
                        watchdogTask?.let { watchdog?.removeCallbacks(it) }
                        SchedulerLedger.complete(
                            this@PipelineService,
                            jobToken,
                            if (ok) "COMPLETED" else "FAILED",
                            detail
                        )
                        releaseTransferWakeLock()
                        operationLockOwner?.let { owner -> operationLockKind?.let { kindKey -> OperationLock.release(kindKey, owner) } }
                        operationLockKind = null
                        operationLockOwner = null
                        stopSelf(startId)
                        return true
                    }
                    return uri.scheme != "https" || uri.host != "appassets.androidplatform.net"
                }
            }
            loadUrl("https://appassets.androidplatform.net/assets/index.html?background=1&epoch=$epoch&pipeline=$kind")
        }
        return START_NOT_STICKY
    }

    /**
     * Deliberately small background command surface. UI-only commands remain in MainActivity.
     */
    private fun handleNative(message: String, body: String): String {
        if (!message.startsWith("aurum://native?")) return "ERR:INVALID_NATIVE_URI"
        val uri = runCatching { Uri.parse(message) }.getOrNull() ?: return "ERR:INVALID_NATIVE_URI"
        return when (uri.getQueryParameter("cmd").orEmpty()) {
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
                else {
                    NativeMarketHttp.cancel(id)
                    "OK"
                }
            }
            "http_request" -> {
                val id = uri.getQueryParameter("requestId").orEmpty()
                val url = uri.getQueryParameter("url").orEmpty()
                if (id.isBlank()) "ERR:MISSING_REQUEST_ID"
                else if (url.isBlank()) "ERR:MISSING_URL"
                else {
                    NativeMarketHttp.request(
                        this,
                        id,
                        uri.getQueryParameter("method") ?: "GET",
                        url,
                        body,
                        (uri.getQueryParameter("timeout")?.toIntOrNull() ?: 15000).coerceIn(1000, 120000)
                    ) { payload ->
                        resolveJs("window.AurumNativeHTTP&&window.AurumNativeHTTP.resolve", id, payload)
                    }
                    "ACCEPTED"
                }
            }
            "transfer_keepalive" -> {
                val enabled = uri.getQueryParameter("enabled") != "0"
                if (enabled) acquireTransferWakeLock() else releaseTransferWakeLock()
                "OK"
            }
            "notification" -> {
                postPipelineNotification(
                    uri.getQueryParameter("title").orEmpty(),
                    uri.getQueryParameter("body").orEmpty(),
                    uri.getQueryParameter("tag").orEmpty()
                )
                "OK"
            }
            else -> "ERR:UNSUPPORTED_NATIVE_COMMAND"
        }
    }

    private fun postPipelineNotification(title: String, body: String, tag: String) {
        runCatching {
            val manager = getSystemService(NotificationManager::class.java)
            val channel = "aurum_background_pipeline"
            val notification = Notification.Builder(this, channel)
                .setContentTitle(title.ifBlank { "Aurum BIST Rev 20" })
                .setContentText(body.take(240))
                .setStyle(Notification.BigTextStyle().bigText(body.take(1200)))
                .setSmallIcon(android.R.drawable.stat_notify_more)
                .setAutoCancel(true)
                .build()
            val safeTag = tag.ifBlank { "aurum-pipeline" }
            manager.notify(safeTag, safeTag.hashCode().let { if (it == 0) 2021 else it }, notification)
        }
    }

    private fun resolveJs(function: String, id: String, payload: String) {
        android.os.Handler(mainLooper).post {
            webView?.evaluateJavascript(
                function + "(" + JSONObject.quote(id) + "," + JSONObject.quote(payload) + ")",
                null
            )
        }
    }

    private fun acquireTransferWakeLock() {
        if (transferWakeLock?.isHeld == true) return
        transferWakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AurumB:BackgroundTransfer")
            .apply {
                setReferenceCounted(false)
                acquire(2 * 60 * 60 * 1000L)
            }
    }

    private fun releaseTransferWakeLock() {
        transferWakeLock?.let { if (it.isHeld) it.release() }
        transferWakeLock = null
    }

    private fun destroyWebView() {
        webView?.apply {
            stopLoading()
            loadUrl("about:blank")
            removeJavascriptInterface("AurumNativeBridge")
            removeAllViews()
            destroy()
        }
        webView = null
    }

    override fun onDestroy() {
        watchdogTask?.let { watchdog?.removeCallbacks(it) }
        watchdogTask = null
        watchdog = null
        releaseTransferWakeLock()
        operationLockOwner?.let { owner -> operationLockKind?.let { kindKey -> OperationLock.release(kindKey, owner) } }
        operationLockKind = null
        operationLockOwner = null
        destroyWebView()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
