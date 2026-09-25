package com.aurum.bistterminal8

// RECONSTRUCTED_FROM_DEX
import android.content.Context
import org.json.JSONObject
import java.time.Instant

object SchedulerLedger {
    private const val PREFS = "aurum_scheduler_ledger"

    fun begin(context: Context, epoch: Long, time: String): String {
        val token = token(epoch, time)
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prune(prefs)
        val previous = prefs.getString(token, null)
        if (previous != null) {
            val status = runCatching { JSONObject(previous).optString("status") }.getOrDefault("")
            if (status in setOf("RUNNING", "COMPLETED")) return ""
        }
        val record = JSONObject()
            .put("eventId", token)
            .put("eventTime", Instant.ofEpochMilli(epoch).toString())
            .put("scheduledTime", time)
            .put("jobToken", token)
            .put("calendarType", "BIST")
            .put("startedAt", Instant.now().toString())
            .put("status", "RUNNING")
            .put("attempt", 1)
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

    private fun prune(prefs: android.content.SharedPreferences) {
        val cutoff = System.currentTimeMillis() - 14L * 24L * 60L * 60L * 1000L
        val edit = prefs.edit()
        for ((key, raw) in prefs.all) {
            val started = runCatching { JSONObject(raw as? String ?: "{}").optString("startedAt") }.getOrDefault("")
            val millis = runCatching { Instant.parse(started).toEpochMilli() }.getOrDefault(Long.MAX_VALUE)
            if (millis < cutoff) edit.remove(key)
        }
        edit.apply()
    }

    fun token(epoch: Long, time: String): String =
        "AUTO|" + epoch + "|" + time.replace(":", "")
}
