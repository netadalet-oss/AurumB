package com.aurum.bistterminal8

// RECONSTRUCTED_FROM_DEX

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class TriggerReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val service = Intent(context, PipelineService::class.java).apply {
            action = intent.action
            putExtras(intent)
        }
        context.startForegroundService(service)
    }
}
