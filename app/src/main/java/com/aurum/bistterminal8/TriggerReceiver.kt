package com.aurum.bistterminal8

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import java.time.Instant

class TriggerReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val slotTime = intent.getStringExtra("slotTime") ?: return
        val kind = intent.getStringExtra("pipelineKind").let { if (it == "market") "market" else "data" }
        val epoch = intent.getLongExtra("epoch", 0L).takeIf { it > 0L }
            ?: System.currentTimeMillis()

        AurumScheduler.scheduleNextForTime(context, slotTime, Instant.now(), kind)

        val jobToken = SchedulerLedger.begin(context, epoch, slotTime, kind) ?: return
        val service = Intent(context, PipelineService::class.java)
            .putExtra("epoch", epoch)
            .putExtra("jobToken", jobToken)
            .putExtra("pipelineKind", kind)
        runCatching { ContextCompat.startForegroundService(context, service) }
            .onFailure {
                SchedulerLedger.complete(
                    context,
                    jobToken,
                    "FAILED",
                    "FOREGROUND_SERVICE_START_FAILED:" + it.javaClass.simpleName + ":" + it.message.orEmpty()
                )
            }
    }
}
