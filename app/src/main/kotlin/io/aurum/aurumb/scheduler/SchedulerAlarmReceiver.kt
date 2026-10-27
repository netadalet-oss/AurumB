package io.aurum.aurumb.scheduler

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class SchedulerAlarmReceiver:BroadcastReceiver() {
    override fun onReceive(context:Context,intent:Intent) {
        when(intent.action) {
            AppScheduler.ACTION_DATA_ALARM -> {
                AppScheduler.enqueueScheduledData(context,intent.getLongExtra(AppScheduler.EXTRA_SCHEDULED_AT,0L))
                AppScheduler.scheduleNextDataAlarm(context)
            }
            AppScheduler.ACTION_MARKET_ALARM -> {
                AppScheduler.enqueueScheduledMarket(context,intent.getLongExtra(AppScheduler.EXTRA_SCHEDULED_AT,0L))
                AppScheduler.scheduleNextMarketAlarm(context)
            }
            AppScheduler.ACTION_LOG_RETENTION_ALARM -> {
                AppScheduler.enqueueScheduledLogRetention(context,intent.getLongExtra(AppScheduler.EXTRA_SCHEDULED_AT,0L))
                AppScheduler.scheduleNextLogRetentionAlarm(context)
            }
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED -> AppScheduler.ensurePeriodic(context)
        }
    }
}
