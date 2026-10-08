package com.aurum.bistterminal8

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import java.time.Instant

class TriggerReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == AurumScheduler.ACTION_MAINTENANCE) {
            val epoch=intent.getLongExtra("epoch",0L)
            val expected=context.getSharedPreferences("aurum_scheduler",Context.MODE_PRIVATE)
                .getLong("next_maintenance",0L)
            if(epoch<=0L || expected!=epoch)return
            AurumScheduler.scheduleWeeklyMaintenance(context)
            runCatching {
                ContextCompat.startForegroundService(context, Intent(context, MaintenanceService::class.java))
            }.onFailure { android.util.Log.e("AurumScheduler", "Maintenance start rejected", it) }
            return
        }
        val slotTime = intent.getStringExtra("slotTime") ?: return
        if (!AurumScheduler.valid(slotTime)) return
        val kind = intent.getStringExtra("pipelineKind").let { if (it == "market") "market" else "data" }
        // Do not run stale alarms after the user disables or edits a schedule.
        if (!AurumScheduler.enabled(context, kind) || slotTime !in AurumScheduler.configuredTimes(context, kind)) return
        val epoch = intent.getLongExtra("epoch",0L).takeIf { it>0L } ?: return
        val expected=context.getSharedPreferences("aurum_scheduler",Context.MODE_PRIVATE)
            .getLong("next_" + kind + "_" + slotTime.replace(":",""),0L)
        if(epoch!=expected)return

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
            .putExtra("slotTime", slotTime)
        runCatching { ContextCompat.startForegroundService(context, service) }
            .onFailure { SchedulerLedger.complete(context, jobToken, "FAILED", "SERVICE_START: " + (it.message ?: it.javaClass.simpleName)) }
    }
}
