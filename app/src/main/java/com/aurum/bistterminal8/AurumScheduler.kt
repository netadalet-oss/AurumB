package com.aurum.bistterminal8

// RECONSTRUCTED_FROM_DEX
// Public method surface and scheduler identifiers are DEX-proven.
// Scheduling implementation is reconstructed to preserve the observed contract.

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

object AurumScheduler {
    private const val PREFS = "aurum_scheduler"
    private const val ACTION_SLOT = "com.aurum.bistterminal8.SCHEDULED_SLOT"

    fun configuredTimes(context: Context): List<String> {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString("times", null)
            .orEmpty()
        return raw.split(',').map(String::trim).filter(::valid)
    }

    fun install(context: Context, enabled: Boolean, times: List<String>): Boolean {
        val clean = times.map(String::trim).filter(::valid).distinct()
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("enabled", enabled)
            .putString("times", clean.joinToString(","))
            .apply()
        cancelKnown(context)
        if (!enabled) return true
        val now = Instant.now()
        clean.forEach { scheduleNextForTime(context, it, now) }
        return true
    }

    fun rearm(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!prefs.getBoolean("enabled", false)) return
        val now = Instant.now()
        configuredTimes(context).forEach { scheduleNextForTime(context, it, now) }
    }

    fun scheduleNextForTime(context: Context, time: String, now: Instant) {
        if (!valid(time)) return
        val zone = ZoneId.systemDefault()
        val localTime = LocalTime.parse(time)
        var target = LocalDate.now(zone).atTime(localTime).atZone(zone).toInstant()
        if (!target.isAfter(now)) target = target.atZone(zone).plusDays(1).toInstant()

        val alarm = context.getSystemService(AlarmManager::class.java)
        val pi = pending(context, time, target.toEpochMilli())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarm.canScheduleExactAlarms()) {
            alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, target.toEpochMilli(), pi)
        } else {
            alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, target.toEpochMilli(), pi)
        }
    }

    fun cancelKnown(context: Context) {
        val alarm = context.getSystemService(AlarmManager::class.java)
        configuredTimes(context).forEach { time ->
            val intent = Intent(context, TriggerReceiver::class.java).setAction(ACTION_SLOT)
            PendingIntent.getBroadcast(
                context, time.hashCode(), intent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )?.let { alarm.cancel(it); it.cancel() }
        }
    }

    fun pending(context: Context, time: String, epoch: Long): PendingIntent {
        val intent = Intent(context, TriggerReceiver::class.java)
            .setAction(ACTION_SLOT)
            .putExtra("slotTime", time)
            .putExtra("epoch", epoch)
        return PendingIntent.getBroadcast(
            context, time.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    fun valid(value: String): Boolean =
        runCatching { LocalTime.parse(value); true }.getOrDefault(false)
}
