package com.aurum.bistterminal8

// RECONSTRUCTED_FROM_DEX
// Receiver flow, extra names and ledger handoff are DEX-proven.

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class TriggerReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val slotTime = intent.getStringExtra("slotTime") ?: return
        val epoch = intent.getLongExtra("epoch", 0L).takeIf { it > 0L }
            ?: System.currentTimeMillis()
        val jobToken = SchedulerLedger.begin(context, epoch, slotTime)
        if (jobToken.isNotBlank()) {
            val service = Intent(context, PipelineService::class.java)
                .putExtra("epoch", epoch)
                .putExtra("jobToken", jobToken)
            ContextCompat.startForegroundService(context, service)
        }
        // Every alarm is one-shot. Rearm from actual delivery time so a late alarm
        // can never schedule another occurrence in the past.
        AurumScheduler.scheduleNextForTime(context, slotTime, java.time.Instant.now().plusSeconds(1))
    }
}
