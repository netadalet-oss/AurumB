package com.aurum.bistterminal8

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.IBinder
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

/**
 * Exact weekly maintenance host. It opens the local application origin without the
 * background pipeline flag, runs only the persistence cleanup contract, then exits.
 */
class MaintenanceService : Service() {
    private var webView:WebView?=null
    private val handler by lazy { Handler(mainLooper) }
    private var timeout:Runnable?=null

    override fun onCreate() {
        super.onCreate()
        val channel="aurum_weekly_maintenance"
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(channel,"Aurum haftalık bakım",NotificationManager.IMPORTANCE_LOW)
        )
        startForeground(
            2031,
            Notification.Builder(this,channel)
                .setContentTitle("Aurum")
                .setContentText("Haftalık log ve bildirim bakımı")
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setOngoing(true)
                .build()
        )
    }

    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
        if(webView!=null) return START_NOT_STICKY
        val loader=WebViewAssetLoader.Builder()
            .addPathHandler("/assets/",WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        timeout=Runnable { finish() }.also { handler.postDelayed(it,90_000L) }
        webView=WebView(this).apply {
            settings.javaScriptEnabled=true
            settings.domStorageEnabled=true
            settings.databaseEnabled=true
            settings.allowFileAccess=false
            settings.allowContentAccess=false
            settings.mixedContentMode=android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
            webViewClient=object:WebViewClient() {
                private var requested=false
                override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest)=
                    loader.shouldInterceptRequest(request.url)
                override fun onPageFinished(view:WebView,url:String) {
                    if(requested)return
                    requested=true
                    view.evaluateJavascript(
                        """(async()=>{try{if(window.AurumSettingsHistory20?.cleanup)await window.AurumSettingsHistory20.cleanup();else if(window.AurumCompactNotifications?.cleanup)await window.AurumCompactNotifications.cleanup();localStorage.setItem('aurum.ui.historyCleanupSunday.v1',new Date().toISOString())}catch(e){console.warn('weekly maintenance',e)}finally{location.href='aurum://maintenance-complete'}})()""",
                        null
                    )
                }
                override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest):Boolean {
                    val u=request.url
                    if(u.scheme=="aurum"&&u.host=="maintenance-complete") {
                        finish()
                        return true
                    }
                    return u.scheme!="https"||u.host!="appassets.androidplatform.net"
                }
            }
            loadUrl("https://appassets.androidplatform.net/assets/index.html?maintenance=1")
        }
        return START_NOT_STICKY
    }

    private fun finish() {
        timeout?.let(handler::removeCallbacks);timeout=null
        webView?.apply {
            stopLoading()
            loadUrl("about:blank")
            removeAllViews()
            destroy()
        }
        webView=null
        stopSelf()
    }

    override fun onDestroy() { finish();super.onDestroy() }
    override fun onBind(intent:Intent?):IBinder?=null
}
