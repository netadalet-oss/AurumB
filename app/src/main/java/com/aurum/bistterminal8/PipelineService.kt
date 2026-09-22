package com.aurum.bistterminal8

// RECONSTRUCTED_FROM_DEX
// Background WebView pipeline, URL and completion URI flow are DEX-proven.

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.webkit.JsPromptResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

class PipelineService : Service() {
    private var webView: WebView? = null

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

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView?.destroy()
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            webChromeClient = object : WebChromeClient() {
                override fun onJsPrompt(
                    view: WebView?,
                    url: String?,
                    message: String?,
                    defaultValue: String?,
                    result: JsPromptResult?
                ): Boolean {
                    if (message == "aurum://complete") {
                        val detail = defaultValue.orEmpty()
                        val failed = detail.contains("fail", ignoreCase = true) ||
                            detail.contains("error", ignoreCase = true)
                        SchedulerLedger.complete(
                            this@PipelineService,
                            jobToken,
                            if (failed) "FAILED" else "COMPLETED",
                            if (failed) detail else ""
                        )
                        result?.confirm("OK")
                        stopSelf(startId)
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
                        val status = uri.getQueryParameter("status") ?: "COMPLETED"
                        val error = uri.getQueryParameter("error").orEmpty()
                        SchedulerLedger.complete(this@PipelineService, jobToken, status, error)
                        stopSelf(startId)
                        return true
                    }
                    if (uri.scheme == "bistopt" && uri.host == "sync-finished") {
                        val ok = uri.getQueryParameter("ok") == "1"
                        SchedulerLedger.complete(
                            this@PipelineService,
                            jobToken,
                            if (ok) "COMPLETED" else "FAILED",
                            if (ok) "" else "BACKGROUND_SYNC_FAILED"
                        )
                        stopSelf(startId)
                        return true
                    }
                    return uri.scheme != "https" || uri.host != "appassets.androidplatform.net"
                }
            }
            loadUrl("https://appassets.androidplatform.net/assets/index.html?background=1&epoch=$epoch")
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        webView?.apply {
            stopLoading()
            loadUrl("about:blank")
            removeAllViews()
            destroy()
        }
        webView = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
