package io.aurum.aurumb

import android.app.Application
import io.aurum.aurumb.persistence.DatabaseFactory
import io.aurum.aurumb.exchange.BackupRestoreService
import io.aurum.aurumb.exchange.DurableUserOperations
import io.aurum.aurumb.scheduler.AppScheduler
import io.aurum.aurumb.settings.SettingsRepository
import io.aurum.aurumb.transfer.StateTransferService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import java.time.Instant

class AurumApplication:Application() {
    private val appScope=CoroutineScope(SupervisorJob()+Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()

        // Full-restore crash recovery is the first state owner. No scheduler
        // may observe or mutate a partially restored database/settings set.
        val recoveryError=runBlocking(Dispatchers.IO) {
            runCatching {
                BackupRestoreService(this@AurumApplication).recoverInterruptedRestore()
            }.exceptionOrNull()
        }
        if(recoveryError!=null) {
            getSharedPreferences("aurum.recovery.health.v1",MODE_PRIVATE).edit()
                .putString("fullRestoreRecoveryError",recoveryError::class.java.simpleName+":"+(recoveryError.message?:""))
                .putString("failedAtUtc",Instant.now().toString())
                .apply()
            // Fail closed: UI can still open, but no automated mutation is started.
            return
        } else {
            getSharedPreferences("aurum.recovery.health.v1",MODE_PRIVATE).edit()
                .remove("fullRestoreRecoveryError").remove("failedAtUtc").apply()
        }

        // Process-death recovery must finish before any WorkManager worker can
        // observe stale RUNNING/CANCEL_REQUESTED state in this process.
        val dao=DatabaseFactory.get(this@AurumApplication).aurumDao()
        runBlocking(Dispatchers.IO) {
            val recoveredAt=Instant.now().toString()
            dao.finalizePendingUserCancellations(recoveredAt)
            dao.markActiveOperationsInterrupted(recoveredAt)
            dao.markRunningSchedulerRunsInterrupted(recoveredAt)
            dao.markRunningSchedulerJobsRecoveryPending()
        }

        DurableUserOperations.cleanupStaleTemporarySecrets(this@AurumApplication)
        AppScheduler.ensurePeriodic(this@AurumApplication)

        // Potentially heavier import-journal recovery remains off the main thread.
        appScope.launch {
            StateTransferService(dao,SettingsRepository(this@AurumApplication)).recoverPendingImports()
        }
    }
}
