package com.aurum.bistterminal8

// RECONSTRUCTED_FROM_DEX
// Scheduler constants, defaults, timezone and weekday/weekend policy are DEX-proven.

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

object AurumScheduler {
    private const val PREFS = "aurum_scheduler"
    private const val ACTION_SLOT = "com.aurum.bistterminal8.SCHEDULED_SLOT"
    private val zone = ZoneId.of("Europe/Istanbul")
    private val fmt = DateTimeFormatter.ofPattern("HH:mm")
    private val weekdayDefaults = listOf(
        "00:30","04:30","08:20","09:20","10:20","11:20","12:20","13:20","14:20",
        "15:20","16:20","17:20","18:20","19:20","20:30","21:30","22:30","23:30"
    )
    private val weekendDefaults = listOf("12:30")
    private val defaults = (weekdayDefaults + weekendDefaults).distinct().sorted()
    private const val DEFAULT_PROFILE_KEY = "defaultProfile"

    fun configuredTimes(context: Context): List<String> {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString("times", null)
        val parsed = raw?.split(',')?.map(String::trim)?.filter(::valid)?.distinct()?.sorted().orEmpty()
        return if (parsed.isEmpty()) defaults else parsed
    }

    fun install(context: Context, enabled: Boolean, times: List<String>): Boolean {
        val clean = times.map(String::trim).filter(::valid).distinct().sorted()
        if (enabled && clean.isEmpty()) return false
        val previous = configuredTimes(context)
        cancelTimes(context, previous)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("enabled", enabled)
            .putString("times", clean.joinToString(","))
            .putBoolean(DEFAULT_PROFILE_KEY, clean.toSet() == defaults.toSet())
            .apply()
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

    fun scheduleNextForTime(context: Context, time: String, after: Instant) {
        if (!valid(time)) return
        val localTime = LocalTime.parse(time, fmt)
        var target = ZonedDateTime.of(after.atZone(zone).toLocalDate(), localTime, zone)
        if (!target.toInstant().isAfter(after.plusSeconds(1))) target = target.plusDays(1)

        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val configured = configuredTimes(context).toSet()
        val useDefaultCalendar = prefs.getBoolean(DEFAULT_PROFILE_KEY, configured == defaults.toSet())
        if (useDefaultCalendar) {
            while (true) {
                val allowed = if (target.dayOfWeek == DayOfWeek.SATURDAY ||
                    target.dayOfWeek == DayOfWeek.SUNDAY) weekendDefaults else weekdayDefaults
                if (time in allowed) break
                target = target.plusDays(1)
            }
        }

        val epoch = target.toInstant().toEpochMilli()
        val alarm = context.getSystemService(AlarmManager::class.java)
        val pi = pending(context, time, epoch)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarm.canScheduleExactAlarms()) {
            alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, epoch, pi)
        } else {
            alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, epoch, pi)
        }
    }

    fun cancelKnown(context: Context) = cancelTimes(context, configuredTimes(context))

    private fun cancelTimes(context: Context, times: List<String>) {
        val alarm = context.getSystemService(AlarmManager::class.java)
        times.forEach { time ->
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
        runCatching { LocalTime.parse(value, fmt); true }.getOrDefault(false)
}
