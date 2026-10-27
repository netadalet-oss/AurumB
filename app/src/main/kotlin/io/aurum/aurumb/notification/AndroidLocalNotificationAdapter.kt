package io.aurum.aurumb.notification

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import io.aurum.common.notification.*

class AndroidLocalNotificationAdapter(private val context:Context):NotificationAdapter {
    override val kind=NotificationChannelKind.ANDROID_LOCAL
    private val channelId="aurumb.events.v1"

    override suspend fun deliver(event:NotificationEvent):Boolean {
        ensureChannel()
        if(Build.VERSION.SDK_INT>=33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) return false
        val priority=when(event.importance) {
            NotificationImportance.LOW -> NotificationCompat.PRIORITY_LOW
            NotificationImportance.NORMAL -> NotificationCompat.PRIORITY_DEFAULT
            NotificationImportance.HIGH,NotificationImportance.CRITICAL -> NotificationCompat.PRIORITY_HIGH
        }
        val notification=NotificationCompat.Builder(context,channelId)
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle(event.title)
            .setContentText(event.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(event.body))
            .setPriority(priority)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(context).notify(event.fingerprint.hashCode(),notification)
        return true
    }

    private fun ensureChannel() {
        if(Build.VERSION.SDK_INT<26) return
        val manager=context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel=NotificationChannel(channelId,"Aurum bildirimleri",NotificationManager.IMPORTANCE_DEFAULT)
        manager.createNotificationChannel(channel)
    }
}
