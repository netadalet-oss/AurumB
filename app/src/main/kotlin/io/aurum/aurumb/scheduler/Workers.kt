package io.aurum.aurumb.scheduler

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.room.withTransaction
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import io.aurum.aurumb.AurumRuntimeFactory
import io.aurum.aurumb.persistence.DatabaseFactory
import io.aurum.aurumb.persistence.DataMutationCoordinator
import io.aurum.aurumb.persistence.SchedulerJobEntity
import io.aurum.aurumb.persistence.SchedulerRunEntity
import io.aurum.aurumb.settings.SettingsRepository
import io.aurum.aurumb.settings.qualifiedTradePolicy
import io.aurum.aurumb.calendar.BistCalendarFactory
import io.aurum.aurumb.portfolio.PortfolioExecutionPolicy
import io.aurum.aurumb.portfolio.VirtualPortfolioService
import io.aurum.aurumb.portfolio.PortfolioIntegrityService
import io.aurum.aurumb.signal.QualifiedTradeCoordinator
import io.aurum.aurumb.signal.QualifiedTradePolicy
import io.aurum.aurumb.selection.SelectionOutcomeService
import io.aurum.aurumb.history.KHistoricalService
import io.aurum.aurumb.learning.LearningPipelineService
import io.aurum.aurumb.market.MarketPortalService
import io.aurum.aurumb.notification.TradeAlertDeliveryService
import io.aurum.aurumb.ai.OpenAiAutomationService
import io.aurum.aurumb.pipeline.DownstreamPipelineService
import io.aurum.aurumb.pipeline.PipelineTriggerSource
import io.aurum.aurumb.pipeline.PipelineStages
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

abstract class AuditedWorker(
    context:Context,
    params:WorkerParameters,
    private val jobId:String,
    private val intervalSeconds:Long
):CoroutineWorker(context,params) {
    abstract suspend fun execute()
    protected open val foregroundDataSync:Boolean=false
    protected open fun nextRunAt(at:Instant):Instant=at.plusSeconds(intervalSeconds)
    private var completionNoteCode:String?=null
    private var completionNoteMessage:String?=null

    protected fun succeedWithNote(code:String,message:String) {
        completionNoteCode=code
        completionNoteMessage=message.take(240)
    }

    protected suspend fun freezeIfLatestDataGateClosed(operationType:String):Boolean {
        val dao=DatabaseFactory.get(applicationContext).aurumDao()
        val repairOperationType=when(operationType) {
            "HISTORICAL_SYNC" -> "HISTORICAL_REPAIR"
            "FUND_SYNC" -> "FUND_REPAIR"
            else -> null
        }
        val active=dao.activeOperations().firstOrNull {
            it.operationType==operationType || it.operationType==repairOperationType
        }
        if(active!=null) {
            val preservedAt=dao.latestValidRun()?.asOfUtc ?: "NO_PRIOR_DOWNSTREAM_SNAPSHOT"
            succeedWithNote(
                "DATA_REFRESH_IN_PROGRESS_DOWNSTREAM_FROZEN",
                "Veriler aktarımı/eksik tamamlama sürüyor; kısmi veri downstream'e uygulanmadı. Diğer tablolar/modüller ve zaman damgaları korundu. Son downstream asOf="+preservedAt
            )
            return true
        }

        val operationTypes=listOfNotNull(operationType,repairOperationType)
        var latest=dao.latestCompletedDataPublicationAmong(operationTypes) ?: return false
        if(latest.operationType==repairOperationType) {
            val knownRepairGate=
                latest.errorCode=="DATA_QUALITY_BELOW_GATE_DOWNSTREAM_FROZEN" ||
                latest.stage.contains("BELOW_GATE") ||
                latest.stage.contains("GATE_OPEN") ||
                Regex(".*_Q\\d+$").matches(latest.stage)
            if(!knownRepairGate) {
                latest=dao.latestCompletedDataPublication(operationType) ?: latest
            }
        }

        val gateCode=latest.errorCode?.takeIf {
            it=="DATA_QUALITY_BELOW_GATE_DOWNSTREAM_FROZEN" ||
            it=="DATA_QUALITY_EVIDENCE_MISSING_DOWNSTREAM_FROZEN" ||
            it=="DATA_TABLE_COMPLETENESS_BELOW_GATE_DOWNSTREAM_FROZEN" ||
            it=="DATA_QUALITY_LT_70_DOWNSTREAM_FROZEN" ||
            it=="DATA_TABLE_COMPLETENESS_LT_70_DOWNSTREAM_FROZEN"
        } ?: return false
        val preservedAt=dao.latestValidRun()?.asOfUtc ?: "NO_PRIOR_DOWNSTREAM_SNAPSHOT"
        val settings=SettingsRepository(applicationContext).pipelineSettings()
        val reason=when {
            gateCode.contains("TABLE_COMPLETENESS") ->
                "Veriler tablosu doluluğu ayarlı eşik %"+settings.dataCellCompletenessPct.toPlainString()+" değerini aşmadı"
            gateCode.contains("EVIDENCE_MISSING") ->
                "Veri aktarım kalite kanıtı bulunmadığı için downstream fail-closed"
            else ->
                "Veri aktarım kalitesi ayarlı alt basamak %"+settings.transferQualityThresholdsPct.last()+" altında"
        }
        succeedWithNote(
            gateCode,
            reason+"; diğer tablolar/modüller değiştirilmedi ve zaman damgaları korundu. Son downstream asOf="+preservedAt
        )
        return true
    }

    final override suspend fun doWork():Result {
        if(foregroundDataSync) setForeground(foregroundInfo())
        val dao=DatabaseFactory.get(applicationContext).aurumDao()
        val started=System.nanoTime()
        val at=Instant.now()
        val next=nextRunAt(at).toString()
        val runId=UUID.randomUUID().toString()
        dao.putSchedulerJob(SchedulerJobEntity(jobId,at.toString(),next,"RUNNING",null,null,runAttemptCount,null,null))
        dao.insertSchedulerRun(SchedulerRunEntity(runId,jobId,at.toString(),null,"RUNNING",null,null,runAttemptCount,null,null))
        return try {
            DataMutationCoordinator.serialized { execute() }
            val ms=(System.nanoTime()-started)/1_000_000
            val state=if(completionNoteCode==null)"SUCCEEDED" else "SUCCEEDED_WITH_NOTE"
            dao.putSchedulerJob(SchedulerJobEntity(
                jobId,at.toString(),next,state,ms,true,runAttemptCount,completionNoteCode,completionNoteMessage
            ))
            dao.updateSchedulerRun(SchedulerRunEntity(
                runId,jobId,at.toString(),Instant.now().toString(),state,ms,true,runAttemptCount,
                completionNoteCode,completionNoteMessage
            ))
            Result.success()
        } catch (c:CancellationException) {
            val ms=(System.nanoTime()-started)/1_000_000
            val userCancelled=c.message=="USER_CANCELLED"
            val interruptedState=if(userCancelled)"CANCELLED" else "INTERRUPTED"
            val interruptedCode=if(userCancelled)"CANCELLED" else "SYSTEM_INTERRUPTED_RETRYABLE"
            val interruptedMessage=if(userCancelled)
                (c.message?:"USER_CANCELLED")
            else "Android/process interrupted durable work; WorkManager may reschedule it."
            withContext(NonCancellable) {
                dao.putSchedulerJob(SchedulerJobEntity(
                    jobId,at.toString(),next,interruptedState,ms,false,runAttemptCount,
                    interruptedCode,interruptedMessage.take(240)
                ))
                dao.updateSchedulerRun(SchedulerRunEntity(
                    runId,jobId,at.toString(),Instant.now().toString(),interruptedState,ms,false,runAttemptCount,
                    interruptedCode,interruptedMessage.take(240)
                ))
            }
            if(userCancelled) Result.failure() else throw c
        } catch (t:Throwable) {
            val ms=(System.nanoTime()-started)/1_000_000
            val terminal=runAttemptCount>=3
            val finalState=if(terminal)"FAILED" else "RETRY_PENDING"
            dao.putSchedulerJob(SchedulerJobEntity(
                jobId,at.toString(),next,finalState,ms,false,runAttemptCount,
                t::class.java.simpleName,t.message?.take(240)
            ))
            dao.updateSchedulerRun(SchedulerRunEntity(
                runId,jobId,at.toString(),Instant.now().toString(),finalState,ms,false,runAttemptCount,
                t::class.java.simpleName,t.message?.take(240)
            ))
            if (terminal) Result.failure() else Result.retry()
        }
    }

    private fun foregroundNotificationId():Int =
        4100+((jobId.hashCode() and 0x7fffffff)%700)

    private fun foregroundInfo():ForegroundInfo {
        val channelId="aurumb.background.sync.v1"
        if(Build.VERSION.SDK_INT>=26) {
            val manager=applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(
                NotificationChannel(channelId,"Aurum arka plan senkronu",NotificationManager.IMPORTANCE_LOW)
            )
        }
        val notification=NotificationCompat.Builder(applicationContext,channelId)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Aurum veri işlemi")
            .setContentText("Piyasa verileri ve hesaplamalar arka planda sürdürülüyor.")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()
        return if(Build.VERSION.SDK_INT>=29) {
            ForegroundInfo(foregroundNotificationId(),notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(foregroundNotificationId(),notification)
        }
    }
}

class MarketRefreshWorker(context:Context,params:WorkerParameters):
    AuditedWorker(context,params,AppScheduler.MARKET_REFRESH,6*60*60) {
    override val foregroundDataSync:Boolean=true
    override fun nextRunAt(at:Instant):Instant=AppScheduler.nextDataAfter(applicationContext,at)

    override suspend fun execute() {
        val runtime=AurumRuntimeFactory.create(applicationContext)
        val settingsRepo=SettingsRepository(applicationContext)
        val settings=settingsRepo.pipelineSettings()
        val raw=settingsRepo.load().first
        val manual=inputData.getString("triggerSource")=="MANUAL"
        val sync=runtime.historicalSync.sync(settings)
        val repair=runtime.historicalSync.repairAfterMainTransfer(settings,mainResult=sync)
        val database=DatabaseFactory.get(applicationContext)
        val dao=database.aurumDao()
        KHistoricalService(dao).refreshFromData()
        val dataPublishedAt=dao.operationProgress(repair.operationId)?.updatedAtUtc
            ?: dao.operationProgress(sync.operationId)?.updatedAtUtc
            ?: Instant.now().toString()

        val effectiveDownstreamEligible=repair.finalDownstreamEligible ?: sync.downstreamEligible
        val effectiveSuccessRatio=repair.finalSuccessRatio ?: sync.successRatio
        if(!effectiveDownstreamEligible) {
            val pct=runCatching{
                BigDecimal(effectiveSuccessRatio).multiply(BigDecimal("100"))
                    .setScale(2,java.math.RoundingMode.HALF_EVEN).toPlainString()
            }.getOrDefault("0.00")
            val preservedAt=dao.latestValidRun()?.asOfUtc ?: "NO_PRIOR_DOWNSTREAM_SNAPSHOT"
            succeedWithNote(
                "DATA_QUALITY_BELOW_GATE_DOWNSTREAM_FROZEN",
                "Veriler yayımlandı ("+pct+"%); Eksikleri Tamamla="+repair.mode+
                    ". Ayarlı aktarım alt basamağı %"+settings.transferQualityThresholdsPct.last()+
                    " karşılanmadı. Kn, K_Tarihsel, S ve bağlı modüller değiştirilmedi; kendi zaman damgaları korundu. Son downstream asOf="+preservedAt
            )
            return
        }

        if(manual) {
            val preservedAt=dao.latestValidRun()?.asOfUtc ?: "NO_PRIOR_DOWNSTREAM_SNAPSHOT"
            succeedWithNote(
                "MANUAL_DATA_ONLY_DOWNSTREAM_PRESERVED",
                "Veriler manuel olarak yayımlandı; Eksikleri Tamamla="+repair.mode+
                    ". Kn, K_Tarihsel ve S otomatik çalıştırılmadı. Önceki downstream zaman damgaları korundu. Son S asOf="+preservedAt
            )
            return
        }

        val pipeline=DownstreamPipelineService(dao,runtime.selection)
        val published=try {
            database.withTransaction {
                SelectionOutcomeService(dao).evaluateMatured(settings)
                pipeline.runAutomatic(settings,dataPublishedAt)
            }
        } catch(t:IllegalStateException) {
            if(t.message?.startsWith("DATA_TABLE_COMPLETENESS_")==true) {
                dao.operationProgress(repair.operationId)?.let { row ->
                    dao.putOperationProgress(row.copy(
                        stage="COMPLETE_TABLE_BELOW_GATE",
                        errorCode="DATA_TABLE_COMPLETENESS_BELOW_GATE_DOWNSTREAM_FROZEN",
                        updatedAtUtc=Instant.now().toString()
                    ))
                }
                val preservedAt=dao.latestValidRun()?.asOfUtc ?: "NO_PRIOR_DOWNSTREAM_SNAPSHOT"
                succeedWithNote(
                    "DATA_TABLE_COMPLETENESS_BELOW_GATE_DOWNSTREAM_FROZEN",
                    "Veriler yayımlandı ancak tablo doluluğu ayarlı eşik %"+settings.dataCellCompletenessPct.toPlainString()+" değerini aşmadı; Kn, K_Tarihsel, S ve bağlı modüller rollback ile değiştirilmedi; zaman damgaları korundu. Son S asOf="+preservedAt
                )
                return
            }
            throw t
        }

        val portfolio=VirtualPortfolioService(
            dao,
            PortfolioExecutionPolicy(
                startingCapital=BigDecimal(raw.getValue("portfolioStartingCapitalTRY")),
                defaultPosition=BigDecimal(raw.getValue("portfolioDefaultPositionTRY")),
                commissionBps=settings.commissionBps,
                slippageBps=settings.slippageBps
            )
        )
        val tradeEvents=QualifiedTradeCoordinator(
            dao,BistCalendarFactory.create2026(),settings.topN,portfolio,
            maxDailyMovePct=settings.maxDailyMovePct,
            policy=settings.qualifiedTradePolicy()
        ).advance(published.runId)
        TradeAlertDeliveryService(applicationContext,dao)
            .enqueueAndFlush(tradeEvents,published.runId,Instant.now())
        try {
            OpenAiAutomationService(applicationContext,dao).maybeRunDailyAudit()
        } catch (_:Throwable) {
            // AI is an advisory sidecar. Its own durable AI/audit records retain
            // the failure; a provider/API issue must not invalidate S/AL/SAT.
        }
        succeedWithNote(
            "AUTO_PIPELINE_COMPLETED",
            "Otomatik sıra tamamlandı: Veriler → Eksikleri Tamamla ("+repair.mode+
                ") → Kn → K_Tarihsel → S. Kaynak veri publication="+dataPublishedAt
        )
    }
}

class DataRepairWorker(context:Context,params:WorkerParameters):
    AuditedWorker(context,params,"aurumb.data.repair.manual",24*60*60) {
    override val foregroundDataSync:Boolean=true
    override suspend fun execute() {
        val runtime=AurumRuntimeFactory.create(applicationContext)
        val settings=SettingsRepository(applicationContext).pipelineSettings()
        val repair=runtime.historicalSync.repairAfterMainTransfer(settings)
        KHistoricalService(DatabaseFactory.get(applicationContext).aurumDao()).refreshFromData()
        succeedWithNote(
            "MANUAL_DATA_REPAIR_COMPLETED",
            "Eksikleri Tamamla tamamlandı: "+repair.mode+
                " · hedef="+repair.targeted+" · başarılı="+repair.succeeded+
                ". Manuel repair downstream tabloları otomatik tetiklemez."
        )
    }
}

class ManualPipelineStageWorker(context:Context,params:WorkerParameters):
    AuditedWorker(context,params,"aurumb.pipeline.stage.manual",24*60*60) {
    override val foregroundDataSync:Boolean=true
    override suspend fun execute() {
        val stage=inputData.getString("stage") ?: throw IllegalArgumentException("STAGE_REQUIRED")
        require(stage in setOf(PipelineStages.KN,PipelineStages.K_HISTORICAL,PipelineStages.S))
        val database=DatabaseFactory.get(applicationContext)
        val dao=database.aurumDao()
        val publication=dao.latestCompletedDataPublicationAmong(
            listOf("HISTORICAL_SYNC","HISTORICAL_REPAIR")
        ) ?: throw IllegalStateException("NO_COMPLETED_DATA_PUBLICATION")
        val settingsRepo=SettingsRepository(applicationContext)
        val settings=settingsRepo.pipelineSettings()
        val runtime=AurumRuntimeFactory.create(applicationContext)
        val pipeline=DownstreamPipelineService(dao,runtime.selection)
        when(stage) {
            PipelineStages.KN -> pipeline.runKn(settings,publication.updatedAtUtc,PipelineTriggerSource.MANUAL)
            PipelineStages.K_HISTORICAL -> pipeline.runKHistorical(publication.updatedAtUtc,PipelineTriggerSource.MANUAL)
            PipelineStages.S -> {
                val published=pipeline.runSelection(
                    settings,publication.updatedAtUtc,PipelineTriggerSource.MANUAL
                )
                val raw=settingsRepo.load().first
                val portfolio=VirtualPortfolioService(
                    dao,
                    PortfolioExecutionPolicy(
                        startingCapital=BigDecimal(raw.getValue("portfolioStartingCapitalTRY")),
                        defaultPosition=BigDecimal(raw.getValue("portfolioDefaultPositionTRY")),
                        commissionBps=settings.commissionBps,
                        slippageBps=settings.slippageBps
                    )
                )
                val tradeEvents=QualifiedTradeCoordinator(
                    dao,BistCalendarFactory.create2026(),settings.topN,portfolio,
                    maxDailyMovePct=settings.maxDailyMovePct,
                    policy=settings.qualifiedTradePolicy()
                ).advance(published.runId)
                TradeAlertDeliveryService(applicationContext,dao)
                    .enqueueAndFlush(tradeEvents,published.runId,Instant.now())
                try {
                    OpenAiAutomationService(applicationContext,dao).maybeRunDailyAudit()
                } catch (_:Throwable) {
                    // Advisory AI failure never rewrites the manually published S state.
                }
            }
        }
        succeedWithNote(
            "MANUAL_STAGE_COMPLETED",
            stage+" manuel çalıştırıldı; çalıştırılmayan downstream tablolarının mevcut zaman damgaları korunur."
        )
    }
}

class DailyAuditWorker(context:Context,params:WorkerParameters):
    AuditedWorker(context,params,AppScheduler.DAILY_AUDIT,24*60*60) {
    override val foregroundDataSync:Boolean=true
    override suspend fun execute() {
        if(freezeIfLatestDataGateClosed("HISTORICAL_SYNC")) return
        val dao=DatabaseFactory.get(applicationContext).aurumDao()
        val latest=dao.latestValidRun() ?: throw IllegalStateException("NO_VALID_ANALYSIS_RUN")
        val rows=dao.selectionsForRun(latest.id)
        if(rows.isEmpty()) throw IllegalStateException("EMPTY_SELECTION_PUBLICATION")
        if(rows.filter{it.rank>0}.map{it.rank}.sorted() != (1..rows.count{it.rank>0}).toList()) {
            throw IllegalStateException("RANK_INTEGRITY")
        }
        val portfolioIntegrity=PortfolioIntegrityService(dao).inspect()
        if(!portfolioIntegrity.valid) {
            throw IllegalStateException("PORTFOLIO_INTEGRITY:"+portfolioIntegrity.reasons.joinToString(","))
        }
    }
}


class ModelEvaluationWorker(context:Context,params:WorkerParameters):
    AuditedWorker(context,params,AppScheduler.MODEL_EVALUATION,24*60*60) {
    override val foregroundDataSync:Boolean=true
    override suspend fun execute() {
        if(freezeIfLatestDataGateClosed("HISTORICAL_SYNC")) return
        val dao=DatabaseFactory.get(applicationContext).aurumDao()
        val settings=SettingsRepository(applicationContext).pipelineSettings()
        LearningPipelineService(dao).run(topN=settings.topN)
    }
}


class PortalRefreshWorker(context:Context,params:WorkerParameters):
    AuditedWorker(context,params,AppScheduler.PORTAL_REFRESH,6*60*60) { 
    override val foregroundDataSync:Boolean=true
    override fun nextRunAt(at:Instant):Instant=AppScheduler.nextMarketAfter(applicationContext,at)
    override suspend fun execute() {
        // Legacy market refresh is independent from the main data-quality gate.
        // Manual and scheduled market refresh must remain available even when the
        // data pipeline is frozen; MarketPortalService preserves the last valid rows.
        val dao=DatabaseFactory.get(applicationContext).aurumDao()
        withContext(Dispatchers.IO) {
            MarketPortalService(dao=dao).refreshAndPersist()
        }
    }
}


class LogRetentionWorker(context:Context,params:WorkerParameters):
    CoroutineWorker(context,params) {
    override suspend fun doWork():Result = try {
        val dao=DatabaseFactory.get(applicationContext).aurumDao()
        DataMutationCoordinator.serialized {
            // Weekly maintenance removes routine noise from persistence itself.
            // Important events are not aged out merely because seven days elapsed.
            val audits=dao.allAudit()
            val importantAudits=audits.filter { row ->
                io.aurum.common.logging.OperationalEventPolicy.isImportantAudit(
                    row.level,row.subsystem,row.code,row.message
                )
            }
            val routineAuditIds=audits.filterNot { it in importantAudits }.map { it.id }
            val duplicateImportantAuditIds=importantAudits
                .groupBy { row ->
                    io.aurum.common.logging.OperationalEventPolicy.dedupeKey(
                        row.subsystem,row.code,row.message
                    )
                }
                .values.flatMap { rows -> rows.drop(1) }.map { it.id }
            val auditDeleteIds=(routineAuditIds+duplicateImportantAuditIds).distinct()
            if(auditDeleteIds.isNotEmpty()) dao.deleteAuditByIds(auditDeleteIds)

            val deliveries=dao.allNotificationDeliveries()
            val importantDeliveries=deliveries.filter { row ->
                io.aurum.common.logging.OperationalEventPolicy.isImportantNotification(
                    row.eventType,row.title,row.body,row.importance
                )
            }
            val routineDeliveryIds=deliveries.filterNot { it in importantDeliveries }.map { it.id }
            val duplicateImportantDeliveryIds=importantDeliveries
                .groupBy { row -> row.fingerprint+"|"+row.channel }
                .values.flatMap { rows -> rows.drop(1) }.map { it.id }
            val deliveryDeleteIds=(routineDeliveryIds+duplicateImportantDeliveryIds).distinct()
            if(deliveryDeleteIds.isNotEmpty())
                dao.deleteNotificationDeliveriesByIds(deliveryDeleteIds)

            // Backward compatibility for pre-policy lifecycle rows.
            dao.deleteRoutineInstrumentAudit()
        }
        Result.success()
    } catch(t:Throwable) {
        if(runAttemptCount>=3) Result.failure() else Result.retry()
    }
}
