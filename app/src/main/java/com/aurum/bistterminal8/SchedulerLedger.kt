package com.aurum.bistterminal8

import android.content.Context
import org.json.JSONObject
import java.time.Instant

object SchedulerLedger {
    private const val PREFS = "aurum_scheduler_ledger"
    private val terminal = setOf("COMPLETED", "FAILED", "CANCELLED", "TIMEOUT")

    /**
     * Atomically acquires one scheduled slot. A duplicate delivery for the same pipeline/epoch/slot
     * returns null and must not start a second PipelineService.
     */
    fun acquire(context: Context, epoch: Long, time: String, kind: String): String? {
        val normalizedKind = if (kind == "market") "market" else "data"
        val token = token(epoch, time, normalizedKind)
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        synchronized(this) {
            // An event identity can run only once; delayed/replayed exact alarms
            // must never execute a failed slot twice without a NEW scheduled epoch.
            reconcileLocked(prefs)
            if (prefs.contains(token)) return null
            val record = JSONObject()
                .put("eventId", token)
                .put("eventTime", Instant.ofEpochMilli(epoch).toString())
                .put("scheduledTime", time)
                .put("jobToken", token)
                .put("operationType", if (normalizedKind == "market") "SCHEDULED_MARKET" else "SCHEDULED_DATA")
                .put("pipelineKind", normalizedKind)
                .put("calendarType", "BIST")
                .put("startedAt", Instant.now().toString())
                .put("scheduledEpoch", epoch)
                .put("receivedAt", Instant.now().toString())
                .put("status", "RUNNING")
                .put("attempt", 1)
            // Do not start a background pipeline without a durable event record.
            if (!prefs.edit().putString(token, record.toString()).commit()) return null
            return token
        }
    }

    // Compatibility for older native callers reconstructed from the legacy APK surface.
    fun begin(context: Context, epoch: Long, time: String): String =
        acquire(context, epoch, time, "data") ?: token(epoch, time, "data")

    fun complete(context: Context, token: String, status: String, detail: String) {
        if (token.isBlank()) return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        synchronized(this) {
            val record = runCatching { JSONObject(prefs.getString(token, "{}") ?: "{}") }
                .getOrElse { JSONObject() }
            // Renderer, watchdog and onDestroy callbacks can race. The first
            // terminal outcome is authoritative, especially a verified success.
            if (record.optString("status") in terminal) return
            record.put("jobToken", token)
                .put("completedAt", Instant.now().toString())
                .put("status", status)
                .put("lastError", detail.takeIf { status != "COMPLETED" })
                .put("detail", detail)
            if (!prefs.edit().putString(token, record.toString()).commit()) {
                android.util.Log.e("AurumBSchedulerLedger", "Scheduler terminal result was not persisted")
            }
        }
    }

    private fun reconcileLocked(prefs: android.content.SharedPreferences) {
        val cutoff = Instant.now().minusSeconds(2 * 60 * 60 + 5 * 60)
        val e = prefs.edit()
        var changed = false
        prefs.all.forEach { (key, value) ->
            val record = runCatching { JSONObject(value as String) }.getOrNull() ?: return@forEach
            if (record.optString("status") != "RUNNING") return@forEach
            val started = runCatching { Instant.parse(record.optString("startedAt")) }.getOrNull()
            if (started != null && started.isBefore(cutoff)) {
                record.put("status", "TIMEOUT")
                    .put("detail", "STALE_RUNNING_RECONCILED")
                    .put("lastError", "STALE_RUNNING_RECONCILED")
                    .put("completedAt", Instant.now().toString())
                e.putString(key, record.toString())
                changed = true
            }
        }
        if (changed && !e.commit()) {
            android.util.Log.e("AurumBSchedulerLedger", "Stale scheduler result was not persisted")
        }
    }

    fun latest(context: Context): JSONObject {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        synchronized(this) { reconcileLocked(prefs) }
        val rows = prefs.all.values.mapNotNull { runCatching { JSONObject(it as String) }.getOrNull() }
        return rows.maxByOrNull { it.optString("startedAt") } ?: JSONObject()
    }

    fun token(epoch: Long, time: String, kind: String = "data"): String =
        "AUTO|" + (if (kind == "market") "MARKET" else "DATA") + "|" + epoch + "|" + time.replace(":", "")
}
