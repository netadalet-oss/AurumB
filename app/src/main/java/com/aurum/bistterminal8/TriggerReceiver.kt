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

        val service = Intent(context, PipelineService::class.java)
            .putExtra("epoch", epoch)
            .putExtra("jobToken", jobToken)
        ContextCompat.startForegroundService(context, service)
    }
}
