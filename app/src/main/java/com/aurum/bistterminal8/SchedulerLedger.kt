package com.aurum.bistterminal8

import android.content.Context
import org.json.JSONObject
import java.time.Instant

object SchedulerLedger {
    private const val PREFS = "aurum_scheduler_ledger"
    private const val RETAIN_MS = 14L * 24 * 60 * 60 * 1000

    data class BeginResult(val token: String, val shouldStart: Boolean)

    fun begin(context: Context, epoch: Long, time: String): BeginResult {
        val token = token(epoch, time)
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prune(prefs)
        val previous = prefs.getString(token, null)
        if (previous != null) {
            val status = runCatching { JSONObject(previous).optString("status") }.getOrDefault("")
            if (status == "RUNNING" || status == "COMPLETED") return BeginResult(token, false)
        }
        val previousAttempt = runCatching { JSONObject(previous ?: "{}").optInt("attempt", 0) }.getOrDefault(0)
        val record = JSONObject()
            .put("eventId", token).put("eventTime", Instant.ofEpochMilli(epoch).toString())
            .put("scheduledTime", time).put("jobToken", token).put("calendarType", "BIST")
            .put("startedAt", Instant.now().toString()).put("status", "RUNNING")
            .put("attempt", previousAttempt + 1)
        prefs.edit().putString(token, record.toString()).apply()
        return BeginResult(token, true)
    }

    fun complete(context: Context, token: String, status: String, detail: String) {
        if (token.isBlank()) return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val record = runCatching { JSONObject(prefs.getString(token, "{}") ?: "{}") }.getOrElse { JSONObject() }
        record.put("jobToken", token).put("completedAt", Instant.now().toString())
            .put("status", status).put("error", detail)
        prefs.edit().putString(token, record.toString()).apply()
    }

    private fun prune(prefs: android.content.SharedPreferences) {
        val cutoff = System.currentTimeMillis() - RETAIN_MS
        val edit = prefs.edit()
        var changed = false
        for ((key, value) in prefs.all) {
            val obj = runCatching { JSONObject(value as? String ?: "") }.getOrNull() ?: continue
            val stamp = obj.optString("completedAt").ifBlank { obj.optString("startedAt") }
            val at = runCatching { Instant.parse(stamp).toEpochMilli() }.getOrNull() ?: continue
            if (at < cutoff && obj.optString("status") != "RUNNING") { edit.remove(key); changed = true }
        }
        if (changed) edit.apply()
    }

    fun token(epoch: Long, time: String): String = "AUTO|" + epoch + "|" + time.replace(":", "")
}
