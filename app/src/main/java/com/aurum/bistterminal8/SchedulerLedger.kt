package com.aurum.bistterminal8

import android.content.Context
import org.json.JSONObject
import java.time.Instant

object SchedulerLedger {
    private const val PREFS = "aurum_scheduler_ledger"

    /**
     * Atomically acquires one scheduled slot. A duplicate delivery for the same pipeline/epoch/slot
     * returns null and must not start a second PipelineService.
     */
    fun acquire(context: Context, epoch: Long, time: String, kind: String): String? {
        val normalizedKind = if (kind == "market") "market" else "data"
        val token = token(epoch, time, normalizedKind)
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        synchronized(this) {
            val previous = prefs.getString(token, null)
            if (previous != null) {
                val status = runCatching { JSONObject(previous).optString("status") }.getOrDefault("")
                if (status in setOf("RUNNING", "COMPLETED")) return null
            }
            val record = JSONObject()
                .put("eventId", token)
                .put("eventTime", Instant.ofEpochMilli(epoch).toString())
                .put("scheduledTime", time)
                .put("jobToken", token)
                .put("operationType", if (normalizedKind == "market") "SCHEDULED_MARKET" else "SCHEDULED_DATA")
                .put("pipelineKind", normalizedKind)
                .put("calendarType", "BIST")
                .put("startedAt", Instant.now().toString())
                .put("status", "RUNNING")
                .put("attempt", 1)
            prefs.edit().putString(token, record.toString()).commit()
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
            record.put("jobToken", token)
                .put("completedAt", Instant.now().toString())
                .put("status", status)
                .put("lastError", detail.takeIf { status != "COMPLETED" })
                .put("detail", detail)
            prefs.edit().putString(token, record.toString()).apply()
        }
    }

    fun latest(context: Context): JSONObject {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val rows = prefs.all.values.mapNotNull { runCatching { JSONObject(it as String) }.getOrNull() }
        return rows.maxByOrNull { it.optString("startedAt") } ?: JSONObject()
    }

    fun token(epoch: Long, time: String, kind: String = "data"): String =
        "AUTO|" + (if (kind == "market") "MARKET" else "DATA") + "|" + epoch + "|" + time.replace(":", "")
}
