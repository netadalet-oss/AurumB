package com.aurum.bistterminal8

// RECONSTRUCTED_FROM_DEX
// Reconstructed from classes3.dex descriptors/constants. Original Kotlin formatting is not claimed.

import android.content.Context
import java.security.MessageDigest

object SchedulerLedger {
    private const val PREFS = "aurum_scheduler_ledger"

    fun begin(context: Context, epoch: Long, slot: String): String {
        val token = token(epoch, slot)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString("active_token", token)
            .putLong("active_epoch", epoch)
            .putString("active_slot", slot)
            .apply()
        return token
    }

    fun complete(context: Context, token: String, status: String, detail: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString("last_token", token)
            .putString("last_status", status)
            .putString("last_detail", detail)
            .putLong("last_completed_at", System.currentTimeMillis())
            .apply()
    }

    fun token(epoch: Long, slot: String): String {
        val bytes = "$epoch|$slot".toByteArray(Charsets.UTF_8)
        return MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString("") { "%02x".format(it) }
    }
}
