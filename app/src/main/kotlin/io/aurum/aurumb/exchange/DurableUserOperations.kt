package io.aurum.aurumb.exchange

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import io.aurum.aurumb.security.SecureSecretStore
import io.aurum.aurumb.update.RuntimePatchService
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import java.time.Instant
import java.util.UUID

object DurableUserOperations {
    private const val MODE_ALL="ALL"
    private const val MODE_EXPLICIT="EXPLICIT"

    fun enqueueExport(
        context:Context,
        treeUri:Uri,
        format:ExchangeFormat,
        selectedTables:Set<String>?,
        separateFiles:Boolean
    ) {
        val req=OneTimeWorkRequestBuilder<DataExportWorker>()
            .setInputData(workDataOf(
                "treeUri" to treeUri.toString(),
                "format" to format.name,
                "selectionMode" to if(selectedTables==null) MODE_ALL else MODE_EXPLICIT,
                "selectedTablesJson" to JSONArray(selectedTables?.sorted().orEmpty()).toString(),
                "separateFiles" to separateFiles
            ))
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueue(req)
    }

    fun enqueueImport(context:Context,uri:Uri) {
        val req=OneTimeWorkRequestBuilder<DataImportWorker>()
            .setInputData(workDataOf("uri" to uri.toString()))
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueue(req)
    }

    fun enqueueBackup(context:Context,treeUri:Uri,passphrase:CharArray) {
        val secret=temporarySecretName("backup")
        val store=SecureSecretStore(context)
        store.put(secret,passphrase)
        try {
            val req=OneTimeWorkRequestBuilder<FullBackupWorker>()
                .setInputData(workDataOf("treeUri" to treeUri.toString(),"secretName" to secret))
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build()
            WorkManager.getInstance(context.applicationContext).enqueue(req)
        } catch(t:Throwable) {
            store.remove(secret)
            throw t
        }
    }

    fun enqueueRestore(context:Context,uri:Uri,passphrase:CharArray) {
        val secret=temporarySecretName("restore")
        val store=SecureSecretStore(context)
        store.put(secret,passphrase)
        try {
            val req=OneTimeWorkRequestBuilder<FullRestoreWorker>()
                .setInputData(workDataOf("uri" to uri.toString(),"secretName" to secret))
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .build()
            WorkManager.getInstance(context.applicationContext).enqueue(req)
        } catch(t:Throwable) {
            store.remove(secret)
            throw t
        }
    }

    fun enqueueRuntimePatch(context:Context,uri:Uri) {
        val req=OneTimeWorkRequestBuilder<RuntimePatchWorker>()
            .setInputData(workDataOf("uri" to uri.toString()))
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build()
        WorkManager.getInstance(context.applicationContext).enqueue(req)
    }

    fun cleanupStaleTemporarySecrets(
        context:Context,
        now:Instant=Instant.now(),
        maxAgeSeconds:Long=24*60*60
    ) {
        val store=SecureSecretStore(context)
        store.names().filter{it.startsWith("tmp-backup-") || it.startsWith("tmp-restore-")}.forEach { name ->
            val created=name.split("-").getOrNull(2)?.toLongOrNull() ?: return@forEach
            if(now.epochSecond-created>maxAgeSeconds) store.remove(name)
        }
    }

    private fun temporarySecretName(kind:String):String =
        "tmp-"+kind+"-"+Instant.now().epochSecond+"-"+UUID.randomUUID().toString().take(8)

}

abstract class ForegroundUserOperationWorker(
    context:Context,
    params:WorkerParameters,
    private val operationLabel:String
):CoroutineWorker(context,params) {
    final override suspend fun doWork():Result {
        setForeground(foregroundInfo())
        return try {
            execute()
        } catch(c:CancellationException) {
            throw c
        } catch(t:Throwable) {
            Result.failure(workDataOf("error" to (t.message?:t::class.java.simpleName).take(500)))
        }
    }

    protected abstract suspend fun execute():Result

    private fun foregroundInfo():ForegroundInfo {
        val channelId="aurumb.user-operations.v1"
        val manager=applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if(Build.VERSION.SDK_INT>=26) {
            manager.createNotificationChannel(
                NotificationChannel(channelId,"Aurum BIST kullanıcı işlemleri",NotificationManager.IMPORTANCE_LOW)
            )
        }
        val notification=NotificationCompat.Builder(applicationContext,channelId)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("Aurum BIST · "+operationLabel)
            .setContentText("İşlem arka planda güvenli biçimde sürdürülüyor.")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        return if(Build.VERSION.SDK_INT>=29)
            ForegroundInfo(5200+(id.hashCode() and 0x3ff),notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else ForegroundInfo(5200+(id.hashCode() and 0x3ff),notification)
    }
}

class DataExportWorker(context:Context,params:WorkerParameters):
    ForegroundUserOperationWorker(context,params,"Dışa aktarma") {
    override suspend fun execute():Result {
        val tree=Uri.parse(requireNotNull(inputData.getString("treeUri")){"EXPORT_TREE_URI_REQUIRED"})
        val format=ExchangeFormat.valueOf(requireNotNull(inputData.getString("format")){"EXPORT_FORMAT_REQUIRED"})
        val selected=if(inputData.getString("selectionMode")=="EXPLICIT") {
            val a=JSONArray(inputData.getString("selectedTablesJson")?:"[]")
            (0 until a.length()).map{a.optString(it)}.filter{it.isNotBlank()}.toSet()
        } else null
        val uris=DataExchangeService(applicationContext).exportSelected(
            tree,format,selected,inputData.getBoolean("separateFiles",false)
        )
        return Result.success(workDataOf("fileCount" to uris.size))
    }
}

class DataImportWorker(context:Context,params:WorkerParameters):
    ForegroundUserOperationWorker(context,params,"İçe aktarma") {
    override suspend fun execute():Result {
        val uri=Uri.parse(requireNotNull(inputData.getString("uri")){"IMPORT_URI_REQUIRED"})
        val report=DataExchangeService(applicationContext).importFile(uri,replaceAll=false)
        return Result.success(workDataOf("tables" to report.tables,"rows" to report.rows))
    }
}

class FullBackupWorker(context:Context,params:WorkerParameters):
    ForegroundUserOperationWorker(context,params,"Tam yedek") {
    override suspend fun execute():Result {
        val tree=Uri.parse(requireNotNull(inputData.getString("treeUri")){"BACKUP_TREE_URI_REQUIRED"})
        val secretName=requireNotNull(inputData.getString("secretName")){"BACKUP_SECRET_REQUIRED"}
        val store=SecureSecretStore(applicationContext)
        val pass=store.get(secretName) ?: return Result.failure(workDataOf("error" to "BACKUP_SECRET_MISSING"))
        return try {
            val uri=BackupRestoreService(applicationContext).backupToTree(tree,pass)
            Result.success(workDataOf("uri" to uri.toString()))
        } finally {
            pass.fill('\u0000')
            store.remove(secretName)
        }
    }
}

class FullRestoreWorker(context:Context,params:WorkerParameters):
    ForegroundUserOperationWorker(context,params,"Tam geri yükleme") {
    override suspend fun execute():Result {
        val uri=Uri.parse(requireNotNull(inputData.getString("uri")){"RESTORE_URI_REQUIRED"})
        val secretName=requireNotNull(inputData.getString("secretName")){"RESTORE_SECRET_REQUIRED"}
        val store=SecureSecretStore(applicationContext)
        val pass=store.get(secretName) ?: return Result.failure(workDataOf("error" to "RESTORE_SECRET_MISSING"))
        return try {
            val report=BackupRestoreService(applicationContext).restoreFrom(uri,pass)
            Result.success(workDataOf(
                "tables" to report.tables,"rows" to report.rows,
                "settings" to report.settings,"secrets" to report.secrets
            ))
        } finally {
            pass.fill('\u0000')
            store.remove(secretName)
        }
    }
}

class RuntimePatchWorker(context:Context,params:WorkerParameters):
    ForegroundUserOperationWorker(context,params,"Güncelleme paketi") {
    override suspend fun execute():Result {
        val uri=Uri.parse(requireNotNull(inputData.getString("uri")){"PATCH_URI_REQUIRED"})
        val report=RuntimePatchService(applicationContext).applyFrom(uri)
        return Result.success(workDataOf(
            "patchId" to report.patchId,
            "settingsChanged" to report.settingsChanged,
            "dataRows" to report.dataRows
        ))
    }
}
