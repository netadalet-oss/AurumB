package com.aurum.bistterminal8

// RECONSTRUCTED_FROM_DEX
// Lifecycle method surface is DEX-proven; service orchestration is reconstructed.

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat

class PipelineService : Service() {
    companion object {
        private const val CHANNEL = "aurum_background_pipeline"
        private const val NOTIFICATION_ID = 2020
    }

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Aurum Pipeline", NotificationManager.IMPORTANCE_LOW)
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(
            NOTIFICATION_ID,
            NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("Aurum BIST Rev 20")
                .setContentText("Background pipeline")
                .setOngoing(true)
                .build()
        )

        val epoch = intent?.getLongExtra("epoch", System.currentTimeMillis())
            ?: System.currentTimeMillis()
        val slot = intent?.getStringExtra("slot").orEmpty()
        val token = SchedulerLedger.begin(this, epoch, slot)

        // MainActivity/background WebView execution is reconstructed separately.
        SchedulerLedger.complete(this, token, "started", "")
        AurumScheduler.rearm(this)
        stopSelf(startId)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
