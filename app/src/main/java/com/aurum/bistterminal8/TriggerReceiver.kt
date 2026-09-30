package com.aurum.bistterminal8

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import java.time.Instant

class TriggerReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val slotTime = intent.getStringExtra("slotTime") ?: return
        if (!AurumScheduler.valid(slotTime)) return
        val kind = intent.getStringExtra("pipelineKind").let { if (it == "market") "market" else "data" }
        val epoch = intent.getLongExtra("epoch", 0L).takeIf { it > 0L } ?: System.currentTimeMillis()

        // One-shot alarms are always re-armed, including duplicate deliveries.
        // Re-arm from the later of the scheduled instant and the actual delivery time.
        // A delayed alarm must never schedule a follow-up in the past and create a catch-up storm.
        val rearmAfter = maxOf(Instant.now(), Instant.ofEpochMilli(epoch).plusSeconds(1))
        AurumScheduler.scheduleNextForTime(
            context,
            slotTime,
            rearmAfter,
            kind
        )

        val jobToken = SchedulerLedger.acquire(context, epoch, slotTime, kind) ?: return
        val service = Intent(context, PipelineService::class.java)
            .putExtra("epoch", epoch)
            .putExtra("jobToken", jobToken)
            .putExtra("pipelineKind", kind)
        ContextCompat.startForegroundService(context, service)
    }
}
