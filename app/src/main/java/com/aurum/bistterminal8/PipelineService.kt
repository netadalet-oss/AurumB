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
    private data class PendingJob(val intent: Intent, val startId: Int)
    private val pendingJobs = ArrayDeque<PendingJob>()
    private var activeToken: String? = null
    private var activeStartId: Int? = null

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
        val incoming = intent ?: return START_NOT_STICKY
        if (activeToken != null) {
            pendingJobs.addLast(PendingJob(Intent(incoming), startId))
            return START_NOT_STICKY
        }
        startJob(incoming, startId)
        return START_NOT_STICKY
    }

    private fun startJob(intent: Intent, startId: Int) {
        val epoch = intent.getLongExtra("epoch", 0L).takeIf { it > 0L }
            ?: run { stopSelf(startId); return }
        val jobToken = intent.getStringExtra("jobToken")
            ?: run { stopSelf(startId); return }
        val kind = intent.getStringExtra("pipelineKind").let { if (it == "market") "market" else "data" }
        activeToken = jobToken
        activeStartId = startId
        SchedulerLedger.markRunning(this, jobToken)

        watchdog = android.os.Handler(mainLooper)
        watchdogTask = Runnable {
            SchedulerLedger.complete(this, jobToken, "TIMED_OUT", "PIPELINE_TIMEOUT", "WATCHDOG")
            finishActiveJob()
        }.also { watchdog?.postDelayed(it, 2 * 60 * 60 * 1000L) }

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            addJavascriptInterface(BackgroundNativeBridge(), "AurumNativeBridge")
            webChromeClient = object : WebChromeClient() {
                override fun onJsPrompt(view: WebView?, url: String?, message: String?, defaultValue: String?, result: JsPromptResult?): Boolean {
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
                        SchedulerLedger.complete(this@PipelineService, jobToken,
                            if (ok) "COMPLETED" else "FAILED",
                            uri.getQueryParameter("detail").orEmpty(),
                            if (ok) "" else "JAVASCRIPT_PIPELINE")
                        finishActiveJob()
                        return true
                    }
                    return uri.scheme != "https" || uri.host != "appassets.androidplatform.net"
                }
            }
            loadUrl("https://appassets.androidplatform.net/assets/index.html?background=1&epoch=$epoch&pipeline=$kind")
        }
    }

    /**
     * Deliberately small background command surface. UI-only commands remain in MainActivity.
     */
    private fun handleNative(message: String, body: String): String {
        if (!message.startsWith("aurum://native?")) return "ERR:INVALID_NATIVE_URI"
        val uri = runCatching { Uri.parse(message) }.getOrNull() ?: return "ERR:INVALID_NATIVE_URI"
        return when (uri.getQueryParameter("cmd").orEmpty()) {
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
            else -> "ERR:UNSUPPORTED_NATIVE_COMMAND"
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

    private fun finishActiveJob() {
        watchdogTask?.let { watchdog?.removeCallbacks(it) }
        watchdogTask = null
        releaseTransferWakeLock()
        destroyWebView()
        activeToken = null
        activeStartId = null
        if (pendingJobs.isNotEmpty()) {
            pendingJobs.removeFirst().let { startJob(it.intent, it.startId) }
        } else {
            stopSelf()
        }
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        activeToken?.let {
            SchedulerLedger.complete(this, it, "TIMED_OUT", "SYSTEM_FGS_TIMEOUT", "FOREGROUND_SERVICE")
        }
        while (pendingJobs.isNotEmpty()) {
            val queued = pendingJobs.removeFirst()
            queued.intent.getStringExtra("jobToken")?.let {
                SchedulerLedger.complete(this, it, "MISSED", "SYSTEM_FGS_BUDGET_EXHAUSTED", "FOREGROUND_SERVICE")
            }
        }
        watchdogTask?.let { watchdog?.removeCallbacks(it) }
        watchdogTask = null
        releaseTransferWakeLock()
        destroyWebView()
        activeToken = null
        activeStartId = null
        stopSelf()
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
        destroyWebView()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
