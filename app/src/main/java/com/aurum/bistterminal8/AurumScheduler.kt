package com.aurum.bistterminal8

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

object AurumScheduler {
    private const val PREFS = "aurum_scheduler"
    private const val LEGACY_PREFS = "aurum_pipeline"
    private const val MIGRATION_KEY = "legacy_schedule_migrated_v1"
    private const val ACTION_SLOT = "com.aurum.bistterminal8.SCHEDULED_SLOT"
    const val ACTION_MAINTENANCE = "com.aurum.bistterminal8.WEEKLY_MAINTENANCE"
    private const val MAINTENANCE_REQUEST_CODE = 23003

    private val zone = ZoneId.of("Europe/Istanbul")
    private val fmt = DateTimeFormatter.ofPattern("HH:mm")
    private val dataDefaults = listOf(
        "00:30","04:30","08:20","09:20","10:20","11:20","12:20","13:20","14:20",
        "15:20","16:20","17:20","18:20","19:20","20:30","21:30","22:30","23:30"
    )

    fun valid(value: String): Boolean =
        runCatching { LocalTime.parse(value, fmt); true }.getOrDefault(false)

    private fun migrateLegacyIfNeeded(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getBoolean(MIGRATION_KEY, false)) return

        val editor = prefs.edit()
        val alreadyHasData = prefs.contains("enabled") || prefs.contains("times")
        if (!alreadyHasData) {
            val legacySources = listOf(
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE),
                context.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE)
            )
            val source = legacySources.firstOrNull {
                it.contains("schedule_enabled") || it.contains("schedule_times")
            }
            if (source != null) {
                if (source.contains("schedule_enabled")) {
                    editor.putBoolean("enabled", source.getBoolean("schedule_enabled", false))
                }
                source.getString("schedule_times", null)
                    ?.split(',')
                    ?.map(String::trim)
                    ?.filter(::valid)
                    ?.distinct()
                    ?.sorted()
                    ?.takeIf { it.isNotEmpty() }
                    ?.let { editor.putString("times", it.joinToString(",")) }
            }
        }
        editor.putBoolean(MIGRATION_KEY, true).apply()
    }

    fun configuredTimes(context: Context, kind: String = "data"): List<String> {
        migrateLegacyIfNeeded(context)
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = if (kind == "market") "market_times" else "times"
        val parsed = prefs.getString(key, null)
            ?.split(',')
            ?.map(String::trim)
            ?.filter(::valid)
            ?.distinct()
            ?.sorted()
            .orEmpty()
        if (parsed.isNotEmpty()) return parsed
        return if (kind == "market") dataDefaults.map(::plus30) else dataDefaults
    }

    fun enabled(context: Context, kind: String): Boolean {
        migrateLegacyIfNeeded(context)
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = if (kind == "market") "market_enabled" else "enabled"
        return prefs.getBoolean(key, false)
    }

    fun install(context: Context, enabled: Boolean, times: List<String>, kind: String = "data"): Boolean {
        migrateLegacyIfNeeded(context)
        val clean = times.map(String::trim).filter(::valid).distinct().sorted()
        if (enabled && clean.isEmpty()) return false

        cancel(context, configuredTimes(context, kind), kind)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(if (kind == "market") "market_enabled" else "enabled", enabled)
            .putString(if (kind == "market") "market_times" else "times", clean.joinToString(","))
            .apply()

        if (enabled) clean.forEach { scheduleNextForTime(context, it, Instant.now(), kind) }
        return true
    }

    fun exactAllowed(context: Context): Boolean {
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        return Build.VERSION.SDK_INT < 31 || alarmManager.canScheduleExactAlarms()
    }

    fun statusJson(context: Context): String {
        migrateLegacyIfNeeded(context)
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val json = org.json.JSONObject()
            .put("exactAllowed", exactAllowed(context))
            .put("sdk", Build.VERSION.SDK_INT)
        for (kind in listOf("data", "market")) {
            json.put(kind + "Enabled", enabled(context, kind))
            json.put(kind + "Times", org.json.JSONArray(configuredTimes(context, kind)))
            json.put(kind + "Registered", registered(context, kind))
            json.put(
                kind + "Next",
                org.json.JSONObject(prefs.all.filterKeys { it.startsWith("next_" + kind + "_") })
            )
        }
        json.put("ledger", SchedulerLedger.latest(context))
        return json.toString()
    }

    fun rearm(context: Context) {
        migrateLegacyIfNeeded(context)
        for (kind in listOf("data", "market")) {
            if (enabled(context, kind)) {
                configuredTimes(context, kind).forEach {
                    scheduleNextForTime(context, it, Instant.now(), kind)
                }
            }
        }
        scheduleWeeklyMaintenance(context)
    }

    internal fun nextSundayMidnight(after: Instant = Instant.now()): Instant {
        val local = after.atZone(zone)
        val delta = (java.time.DayOfWeek.SUNDAY.value - local.dayOfWeek.value + 7) % 7
        var target = local.toLocalDate().plusDays(delta.toLong()).atStartOfDay(zone)
        if (!target.toInstant().isAfter(after)) target = target.plusWeeks(1)
        return target.toInstant()
    }

    fun scheduleWeeklyMaintenance(context: Context, after: Instant = Instant.now()): Instant {
        val target = nextSundayMidnight(after)
        val epoch = target.toEpochMilli()
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            MAINTENANCE_REQUEST_CODE,
            Intent(context, TriggerReceiver::class.java)
                .setAction(ACTION_MAINTENANCE)
                .putExtra("epoch", epoch),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        if (Build.VERSION.SDK_INT >= 31 && !alarmManager.canScheduleExactAlarms()) {
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, epoch, pendingIntent)
        } else {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, epoch, pendingIntent)
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putLong("next_maintenance", epoch).apply()
        return target
    }

    fun scheduleNextForTime(context: Context, time: String, after: Instant, kind: String = "data") {
        if (!valid(time) || !enabled(context, kind)) return

        var target = ZonedDateTime.of(
            after.atZone(zone).toLocalDate(),
            LocalTime.parse(time, fmt),
            zone
        )
        if (!target.toInstant().isAfter(after.plusSeconds(1))) target = target.plusDays(1)

        val epoch = target.toInstant().toEpochMilli()
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        val pendingIntent = pending(context, time, epoch, kind)

        if (Build.VERSION.SDK_INT >= 31 && !alarmManager.canScheduleExactAlarms()) {
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, epoch, pendingIntent)
        } else {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, epoch, pendingIntent)
        }

        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putLong("next_" + kind + "_" + time.replace(":", ""), epoch)
            .apply()
    }

    private fun cancel(context: Context, times: List<String>, kind: String) {
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        val editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        times.forEach { time ->
            PendingIntent.getBroadcast(
                context,
                requestCode(time, kind),
                Intent(context, TriggerReceiver::class.java).setAction(ACTION_SLOT),
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )?.let { pendingIntent ->
                alarmManager.cancel(pendingIntent)
                pendingIntent.cancel()
            }
            editor.remove("next_" + kind + "_" + time.replace(":", ""))
        }
        editor.apply()
    }

    fun pending(context: Context, time: String, epoch: Long, kind: String): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            requestCode(time, kind),
            Intent(context, TriggerReceiver::class.java)
                .setAction(ACTION_SLOT)
                .putExtra("slotTime", time)
                .putExtra("epoch", epoch)
                .putExtra("pipelineKind", kind),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    /** Read-only check that each active Android PendingIntent still exists. */
    fun registered(context:Context,kind:String):Boolean {
        if(!enabled(context,kind))return true
        return configuredTimes(context,kind).all { time ->
            PendingIntent.getBroadcast(context,requestCode(time,kind),
              Intent(context,TriggerReceiver::class.java).setAction(ACTION_SLOT),
              PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)!=null
        }
    }
    private fun requestCode(time: String, kind: String) = (kind + "|" + time).hashCode()
    private fun plus30(time: String) = LocalTime.parse(time, fmt).plusMinutes(30).format(fmt)
}
