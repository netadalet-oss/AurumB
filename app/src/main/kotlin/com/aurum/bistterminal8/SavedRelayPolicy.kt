package com.aurum.bistterminal8

import android.content.Context
import java.net.URL
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

/**
 * Stores only a SHA-256 fingerprint of the user-configured Apps Script endpoint identity.
 * The raw URL/token is never persisted by Android.
 */
object SavedRelayPolicy {
    private const val PREFS = "aurum_saved_relay_policy"
    private const val HASH_KEY = "apps_script_endpoint_sha256"

    private fun tokenOf(url: URL): String? {
        val raw = url.query ?: return null
        for (part in raw.split('&')) {
            val i = part.indexOf('=')
            val key = if (i >= 0) part.substring(0, i) else part
            if (URLDecoder.decode(key, StandardCharsets.UTF_8.name()) != "token") continue
            val value = if (i >= 0) part.substring(i + 1) else ""
            return URLDecoder.decode(value, StandardCharsets.UTF_8.name()).takeIf { it.isNotBlank() }
        }
        return null
    }

    fun canonical(raw: String): String? = runCatching { canonical(URL(raw)) }.getOrNull()

    fun canonical(url: URL): String? {
        if (!url.protocol.equals("https", ignoreCase = true)) return null
        if (!url.host.equals("script.google.com", ignoreCase = true)) return null
        if (!Regex("^/macros/s/[^/]+/exec$").matches(url.path)) return null
        val token = tokenOf(url) ?: return null
        return "https://script.google.com" + url.path + "|token=" + token
    }

    private fun digest(value: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    fun save(context: Context, raw: String): Boolean {
        val canonical = canonical(raw) ?: return false
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(HASH_KEY, digest(canonical)).apply()
        return true
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(HASH_KEY).apply()
    }

    fun matches(context: Context, url: URL): Boolean {
        val canonical = canonical(url) ?: return false
        val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(HASH_KEY, null) ?: return false
        return MessageDigest.isEqual(
            saved.toByteArray(StandardCharsets.US_ASCII),
            digest(canonical).toByteArray(StandardCharsets.US_ASCII)
        )
    }
}
