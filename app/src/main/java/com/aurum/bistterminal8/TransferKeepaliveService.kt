package com.aurum.bistterminal8

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager

/**
 * Keeps an explicit user-started foreground data transfer alive while the Activity is backgrounded.
 * It owns no network logic; the WebView job remains the single data producer.
 */
class TransferKeepaliveService : Service() {
    private var wakeLock: PowerManager.WakeLock? = null
    private val handler by lazy { android.os.Handler(mainLooper) }
    private val timeout = Runnable { stopSelf() }

    override fun onCreate() {
        super.onCreate()
        val channel = "aurum_active_transfer"
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(channel, "Aurum veri aktarımı", NotificationManager.IMPORTANCE_LOW)
        )
        val notification = Notification.Builder(this, channel)
            .setContentTitle("Aurum")
            .setContentText("Veri aktarımı devam ediyor")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setOngoing(true)
            .build()
        startForeground(2030, notification)
        wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AurumB:ManualTransferService")
            .apply {
                setReferenceCounted(false)
                acquire(6 * 60 * 60 * 1000L)
            }
        handler.postDelayed(timeout, 6 * 60 * 60 * 1000L)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_NOT_STICKY

    override fun onDestroy() {
        handler.removeCallbacks(timeout)
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
