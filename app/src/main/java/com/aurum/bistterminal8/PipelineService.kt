package com.aurum.bistterminal8

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.IBinder
import android.os.PowerManager
import android.webkit.JavascriptInterface
import android.webkit.JsPromptResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.util.ArrayDeque

class PipelineService : Service() {
    private data class Run(val epoch: Long, val token: String, val kind: String, val startId: Int)

    private var webView: WebView? = null
    private var transferWakeLock: PowerManager.WakeLock? = null
    private var watchdog: android.os.Handler? = null
    private var watchdogTask: Runnable? = null
    private val queue = ArrayDeque<Run>()
    private var active: Run? = null

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
        val token = intent.getStringExtra("jobToken")
            ?: run { stopSelf(startId); return START_NOT_STICKY }
        val kind = intent.getStringExtra("pipelineKind").let { if (it == "market") "market" else "data" }

        // A Service has one WebView execution host. Never destroy an active run when a second
        // alarm arrives; queue it and execute deterministically after the current run completes.
        if (active?.token == token || queue.any { it.token == token }) return START_NOT_STICKY
        queue.addLast(Run(epoch, token, kind, startId))
        startNextIfIdle()
        return START_NOT_STICKY
    }

    private fun startNextIfIdle() {
        if (active != null) return
        val run = queue.removeFirstOrNull() ?: run {
            stopSelf()
            return
        }
        active = run
        watchdogTask?.let { watchdog?.removeCallbacks(it) }
        watchdog = android.os.Handler(mainLooper)
        watchdogTask = Runnable { finishActive(false, "PIPELINE_TIMEOUT") }
            .also { watchdog?.postDelayed(it, 2 * 60 * 60 * 1000L) }

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
            addJavascriptInterface(BackgroundNativeBridge(), "AurumNativeBridge")
            webChromeClient = object : WebChromeClient() {
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
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) =
                    loader.shouldInterceptRequest(request.url)

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    if (uri.scheme == "aurum" && uri.host == "complete") {
                        finishActive(
                            uri.getQueryParameter("ok") != "0",
                            uri.getQueryParameter("detail").orEmpty()
                        )
                        return true
                    }
                    return uri.scheme != "https" || uri.host != "appassets.androidplatform.net"
                }
            }
            loadUrl("https://appassets.androidplatform.net/assets/index.html?background=1&epoch=" + run.epoch + "&pipeline=" + run.kind)
        }
    }

    private fun finishActive(ok: Boolean, detail: String) {
        val run = active ?: return
        watchdogTask?.let { watchdog?.removeCallbacks(it) }
        watchdogTask = null
        SchedulerLedger.complete(this, run.token, if (ok) "COMPLETED" else "FAILED", detail)
        destroyWebView()
        active = null
        stopSelfResult(run.startId)
        if (queue.isNotEmpty()) startNextIfIdle() else stopSelf()
    }

    private fun handleNative(message: String, body: String): String {
        if (!message.startsWith("aurum://native?")) return "ERR:INVALID_NATIVE_URI"
        val uri = runCatching { Uri.parse(message) }.getOrNull() ?: return "ERR:INVALID_NATIVE_URI"
        return when (uri.getQueryParameter("cmd").orEmpty()) {
            "http_cancel" -> {
                val id = uri.getQueryParameter("requestId").orEmpty()
                if (id.isBlank()) "ERR:MISSING_REQUEST_ID" else { NativeMarketHttp.cancel(id); "OK" }
            }
            "http_request" -> {
                val id = uri.getQueryParameter("requestId").orEmpty()
                val url = uri.getQueryParameter("url").orEmpty()
                if (id.isBlank()) "ERR:MISSING_REQUEST_ID"
                else if (url.isBlank()) "ERR:MISSING_URL"
                else {
                    NativeMarketHttp.request(
                        this, id, uri.getQueryParameter("method") ?: "GET", url, body,
                        (uri.getQueryParameter("timeout")?.toIntOrNull() ?: 15000).coerceIn(1000, 120000)
                    ) { payload -> resolveJs("window.AurumNativeHTTP&&window.AurumNativeHTTP.resolve", id, payload) }
                    "ACCEPTED"
                }
            }
            "transfer_keepalive" -> {
                val enabled = uri.getQueryParameter("enabled") != "0"
                if (enabled) acquireTransferWakeLock() else releaseTransferWakeLock()
                "OK"
            }
            "notification" -> postNotification(
                uri.getQueryParameter("title").orEmpty(),
                uri.getQueryParameter("body").orEmpty(),
                uri.getQueryParameter("tag").orEmpty(),
                uri.getQueryParameter("channel").orEmpty().ifBlank { "aurum_pipeline" }
            )
            else -> "ERR:UNSUPPORTED_NATIVE_COMMAND"
        }
    }

    private fun postNotification(title: String, body: String, tag: String, channel: String): String {
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return "ERR:NOTIFICATION_PERMISSION"
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(channel, "Aurum Bildirimleri", NotificationManager.IMPORTANCE_DEFAULT))
        val notification = NotificationCompat.Builder(this, channel)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle(title.ifBlank { "Aurum" })
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .build()
        nm.notify(if (tag.isBlank()) body.hashCode() else tag.hashCode(), notification)
        return "OK"
    }

    private fun resolveJs(function: String, id: String, payload: String) {
        android.os.Handler(mainLooper).post {
            webView?.evaluateJavascript(
                function + "(" + JSONObject.quote(id) + "," + JSONObject.quote(payload) + ")", null
            )
        }
    }

    private fun acquireTransferWakeLock() {
        if (transferWakeLock?.isHeld == true) return
        transferWakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AurumB:BackgroundTransfer")
            .apply { setReferenceCounted(false); acquire(2 * 60 * 60 * 1000L) }
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

    override fun onTimeout(startId: Int, fgsType: Int) {
        finishActive(false, "ANDROID_FGS_TIMEOUT")
    }

    override fun onDestroy() {
        active?.let { SchedulerLedger.complete(this, it.token, "FAILED", "SERVICE_DESTROYED") }
        queue.forEach { SchedulerLedger.complete(this, it.token, "FAILED", "SERVICE_DESTROYED_BEFORE_START") }
        queue.clear()
        active = null
        watchdogTask?.let { watchdog?.removeCallbacks(it) }
        watchdogTask = null
        watchdog = null
        releaseTransferWakeLock()
        destroyWebView()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
