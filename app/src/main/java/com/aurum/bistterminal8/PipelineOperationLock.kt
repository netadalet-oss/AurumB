package com.aurum.bistterminal8

import android.content.Context
import org.json.JSONObject
import java.time.Instant

/**
 * Process-wide operation mutex shared by foreground MainActivity and PipelineService.
 * The in-memory owner is authoritative for concurrency; SharedPreferences is diagnostics only
 * so a process restart cannot leave a permanent stale lock.
 */
object PipelineOperationLock {
    private const val PREFS = "aurum_operation_lock"

    private data class Owner(
        val token: String,
        val kind: String,
        val source: String,
        val acquiredAt: String
    )

    @Volatile
    private var owner: Owner? = null

    @Synchronized
    fun acquire(context: Context, token: String, kind: String, source: String): Boolean {
        if (token.isBlank()) return false
        val current = owner
        if (current != null) return current.token == token

        val normalizedKind = if (kind == "market") "market" else "data"
        val normalizedSource = source.take(40).ifBlank { "UNKNOWN" }
        val next = Owner(token.take(160), normalizedKind, normalizedSource, Instant.now().toString())
        owner = next
        persist(context, next)
        return true
    }

    @Synchronized
    fun release(context: Context, token: String): Boolean {
        val current = owner ?: return true
        if (token.isBlank() || current.token != token) return false
        owner = null
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
        return true
    }

    @Synchronized
    fun statusJson(context: Context): String {
        val current = owner
        val json = JSONObject()
            .put("busy", current != null)
            .put("token", current?.token ?: JSONObject.NULL)
            .put("kind", current?.kind ?: JSONObject.NULL)
            .put("source", current?.source ?: JSONObject.NULL)
            .put("acquiredAt", current?.acquiredAt ?: JSONObject.NULL)

        // Previous-process metadata is diagnostic only; it never blocks a new operation.
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (current == null && prefs.contains("token")) {
            json.put(
                "stalePreviousProcess",
                JSONObject()
                    .put("token", prefs.getString("token", null))
                    .put("kind", prefs.getString("kind", null))
                    .put("source", prefs.getString("source", null))
                    .put("acquiredAt", prefs.getString("acquiredAt", null))
            )
        }
        return json.toString()
    }

    private fun persist(context: Context, value: Owner) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("token", value.token)
            .putString("kind", value.kind)
            .putString("source", value.source)
            .putString("acquiredAt", value.acquiredAt)
            .apply()
    }
}
