package com.aurum.bistterminal8

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import java.time.Instant

class TriggerReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val slotTime = intent.getStringExtra("slotTime") ?: return
        val scheduledEpoch = intent.getLongExtra("epoch", 0L).takeIf { it > 0L } ?: System.currentTimeMillis()
        val begin = SchedulerLedger.begin(context, scheduledEpoch, slotTime)

        // Alarms are one-shot. Rearm from real delivery time so a delayed alarm cannot
        // recreate an occurrence in the past or immediately retrigger itself.
        val rearmFrom = Instant.ofEpochMilli(maxOf(System.currentTimeMillis(), scheduledEpoch)).plusSeconds(1)
        AurumScheduler.scheduleNextForTime(context, slotTime, rearmFrom)

        if (!begin.shouldStart) return
        val service = Intent(context, PipelineService::class.java)
            .putExtra("epoch", scheduledEpoch)
            .putExtra("jobToken", begin.token)
        runCatching { ContextCompat.startForegroundService(context, service) }
            .onFailure { SchedulerLedger.complete(context, begin.token, "FAILED", "SERVICE_START: " + (it.message ?: it.javaClass.simpleName)) }
    }
}
