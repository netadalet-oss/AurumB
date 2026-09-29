package com.aurum.bistterminal8

import android.content.Context
import org.json.JSONObject
import java.time.Instant

object SchedulerLedger {
    private const val PREFS = "aurum_scheduler_ledger"

    /**
     * Opens a scheduled run exactly once. RUNNING and COMPLETED events are not started again.
     * FAILED events may be retried by a later explicit recovery path.
     */
    fun begin(context: Context, epoch: Long, time: String, kind: String): String? {
        val normalizedKind = if (kind == "market") "market" else "data"
        val token = token(epoch, time, normalizedKind)
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val previous = prefs.getString(token, null)
        if (previous != null) {
            val status = runCatching { JSONObject(previous).optString("status") }.getOrDefault("")
            if (status in setOf("RUNNING", "COMPLETED")) return null
        }
        val now = System.currentTimeMillis()
        val record = JSONObject()
            .put("eventId", token)
            .put("eventTime", Instant.ofEpochMilli(epoch).toString())
            .put("scheduledTime", time)
            .put("pipelineKind", normalizedKind)
            .put("jobToken", token)
            .put("calendarType", "BIST")
            .put("receivedAt", Instant.ofEpochMilli(now).toString())
            .put("latenessMs", (now - epoch).coerceAtLeast(0L))
            .put("startedAt", Instant.ofEpochMilli(now).toString())
            .put("status", "RUNNING")
            .put("attempt", if (previous == null) 1 else runCatching { JSONObject(previous).optInt("attempt", 0) + 1 }.getOrDefault(1))
        prefs.edit().putString(token, record.toString()).apply()
        return token
    }

    fun complete(context: Context, token: String, status: String, detail: String) {
        if (token.isBlank()) return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val record = runCatching { JSONObject(prefs.getString(token, "{}") ?: "{}") }
            .getOrElse { JSONObject() }
        record.put("jobToken", token)
            .put("completedAt", Instant.now().toString())
            .put("status", status)
            .put("error", detail)
        prefs.edit().putString(token, record.toString()).apply()
    }

    fun latest(context: Context): JSONObject {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val rows = prefs.all.values.mapNotNull { runCatching { JSONObject(it as String) }.getOrNull() }
        return rows.maxByOrNull { it.optString("startedAt") } ?: JSONObject()
    }

    fun token(epoch: Long, time: String, kind: String): String =
        "AUTO|" + kind + "|" + epoch + "|" + time.replace(":", "")
}
