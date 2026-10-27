package io.aurum.aurumb.pipeline

import io.aurum.aurumb.persistence.*
import io.aurum.aurumb.universe.UniverseDirectoryService
import io.aurum.common.provider.*
import io.aurum.common.quality.TransferQualityLadder
import io.aurum.common.quality.TransferQualityDecision
import io.aurum.aurumb.quality.HistoricalRepairMode
import io.aurum.aurumb.quality.HistoricalRepairPolicy
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

data class SyncFailure(val symbol:String,val provider:String,val code:String,val retryable:Boolean)
data class HistoricalRepairResult(
    val operationId:String,
    val mode:String,
    val targeted:Int,
    val succeeded:Int,
    val failures:List<SyncFailure>,
    val finalAcceptedQualityThresholdPct:Int?=null,
    val finalEvaluatedQualityThresholdsPct:List<Int> = emptyList(),
    val finalDownstreamEligible:Boolean?=null,
    val finalSuccessRatio:String?=null
)

data class HistoricalSyncResult(
    val operationId:String,
    val total:Int,
    val succeeded:Int,
    val failures:List<SyncFailure>,
    val source:String,
    val acceptedQualityThresholdPct:Int,
    val evaluatedQualityThresholdsPct:List<Int>,
    val downstreamEligible:Boolean=acceptedQualityThresholdPct>0,
    val successRatio:String="0"
)

class HistoricalSyncService(
    private val dao:AurumDao,
    private val directoryService:UniverseDirectoryService,
    private val barProvider:HistoricalBarProvider,
    private val clock:()->Instant={Instant.now()}
) {
    suspend fun sync(settings:PipelineSettings):HistoricalSyncResult {
        val startedAt=clock()
        val zone=ZoneId.of("Europe/Istanbul")
        val prior=dao.latestOperationProgress("HISTORICAL_SYNC")
        val resumeSince=prior
            ?.takeIf{it.state=="INTERRUPTED" && it.errorCode=="PROCESS_INTERRUPTED_RECOVERABLE"}
            ?.startedAtUtc
            ?.let{runCatching{Instant.parse(it)}.getOrNull()}
            ?.takeIf{
                LocalDate.ofInstant(it,zone)==LocalDate.ofInstant(startedAt,zone)
            }
        val operationId=UUID.randomUUID().toString()
        progress(operationId,"DIRECTORY",0,0,null,barProvider.id,startedAt,null,"RUNNING",false)

        try {
            val now=clock()
            val today=LocalDate.ofInstant(now,zone)
            var snapshot=dao.universeAtOrBefore(today.toString())
            if(snapshot==null || snapshot.asOfDate!=today.toString()) {
                val directory=directoryService.refresh(today,now)
                if(directory.published) snapshot=dao.universeAtOrBefore(today.toString())
                else if(snapshot==null) throw IllegalStateException("UNIVERSE_UNAVAILABLE")
            }
            val universe=requireNotNull(snapshot)
            val blocked=dao.blockedInstruments().map{it.symbol}.toSet()
            val symbols=parseSymbols(universe.symbolsJson).filterNot{it in blocked}
            if(symbols.isEmpty()) throw IllegalStateException("EMPTY_UNIVERSE")

            val total=symbols.size+1
            val from=now.minusSeconds(settings.lookbackDays*86400)
            val to=now.plusSeconds(86400)
            val failures=mutableListOf<SyncFailure>()
            var succeeded=0
            var processed=0

            checkCancellation(operationId,startedAt)
            progress(operationId,"MARKET_INDEX",processed,total,"XU100",barProvider.id,startedAt,null,"RUNNING",false)
            if(resumeSince!=null && persistedSince("XU100",resumeSince)) {
                succeeded++
            } else {
                val index=fetchWithRetry("XU100.IS",from,to,settings.providerRetryCount)
                when(index) {
                    is BarProviderResult.Success -> {
                        dao.putMarketBars(index.bars.map{it.toEntity("XU100")})
                        index.latestObservation?.let { dao.insertObservation(it.toEntity("XU100")) }
                        succeeded++
                    }
                    is BarProviderResult.Failure -> failures += SyncFailure("XU100",index.provider,index.code,index.retryable)
                }
            }
            processed++
            progress(
                operationId,"HISTORICAL_BARS",processed,total,"XU100",barProvider.id,startedAt,
                failures.lastOrNull()?.takeIf{it.symbol=="XU100"}?.code,"RUNNING",false
            )

            for(symbol in symbols) {
                checkCancellation(operationId,startedAt)
                progress(operationId,"HISTORICAL_BARS",processed,total,symbol,barProvider.id,startedAt,null,"RUNNING",false)
                if(resumeSince!=null && persistedSince(symbol,resumeSince)) {
                    succeeded++
                } else {
                    val result=fetchWithRetry(symbol+".IS",from,to,settings.providerRetryCount)
                    when(result) {
                        is BarProviderResult.Success -> {
                            dao.putMarketBars(result.bars.map{it.toEntity(symbol)})
                            result.latestObservation?.let { dao.insertObservation(it.toEntity(symbol)) }
                            succeeded++
                        }
                        is BarProviderResult.Failure -> failures += SyncFailure(symbol,result.provider,result.code,result.retryable)
                    }
                }
                processed++
                progress(
                    operationId,"HISTORICAL_BARS",processed,total,symbol,barProvider.id,startedAt,
                    failures.lastOrNull()?.takeIf{it.symbol==symbol}?.code,"RUNNING",false
                )
            }

            val qualityDecision=TransferQualityLadder.evaluate(succeeded,total,settings.transferQualityThresholdsPct)
            val threshold=qualityDecision.acceptedThresholdPct
            val downstreamEligible=threshold!=null
            dao.deleteObservationsBefore(now.minus(Duration.ofDays(14)).toString())
            progress(
                operationId,
                if(downstreamEligible) "COMPLETE_Q"+threshold else "COMPLETE_BELOW_GATE",
                total,total,null,barProvider.id,startedAt,
                if(downstreamEligible) null else "DATA_QUALITY_BELOW_GATE_DOWNSTREAM_FROZEN",
                "SUCCEEDED",false
            )
            return HistoricalSyncResult(
                operationId,total,succeeded,failures,barProvider.id,
                threshold?:0,qualityDecision.evaluatedThresholdsPct,
                downstreamEligible=downstreamEligible,
                successRatio=qualityDecision.ratio.toPlainString()
            )
        } catch(c:CancellationException) {
            val current=dao.operationProgress(operationId)
            val userCancelled=c.message=="USER_CANCELLED"
            val state=if(userCancelled)"CANCELLED" else "INTERRUPTED"
            val code=if(userCancelled)"USER_CANCELLED" else "PROCESS_INTERRUPTED_RECOVERABLE"
            if(current?.state!=state) {
                progress(
                    operationId,state,
                    current?.processed?:0,current?.total?:0,current?.currentInstrument,
                    current?.provider?:barProvider.id,startedAt,
                    code,state,userCancelled
                )
            }
            throw c
        } catch(t:Throwable) {
            progress(
                operationId,"FAILED",0,0,null,barProvider.id,startedAt,
                t::class.java.simpleName,"FAILED",false
            )
            throw t
        }
    }

    /**
     * Completes the Veriler table after the main transfer.
     * - If the last completed main transfer is older than 30 minutes (or absent),
     *   the whole table is fetched again through [sync].
     * - Otherwise only symbols with missing OHLCV cells or evidence time older
     *   than 30 minutes are re-fetched.
     *
     * This repair/freshness decision is deliberately NOT a downstream eligibility
     * gate. Downstream remains governed by transfer quality and cell completeness.
     */
    suspend fun repairAfterMainTransfer(
        settings:PipelineSettings,
        mainResult:HistoricalSyncResult?=null,
        now:Instant=clock()
    ):HistoricalRepairResult {
        val latestMain=dao.latestCompletedDataPublication("HISTORICAL_SYNC")
        val mainAt=latestMain?.updatedAtUtc?.let{runCatching{Instant.parse(it)}.getOrNull()}
        val mainStartedAt=latestMain?.startedAtUtc?.let{runCatching{Instant.parse(it)}.getOrNull()}
        if(HistoricalRepairPolicy.mode(mainAt,now)==HistoricalRepairMode.FULL_TABLE) {
            val full=sync(settings)
            return HistoricalRepairResult(
                full.operationId,"FULL_TABLE_MAIN_OLDER_THAN_30M",
                full.total,full.succeeded,full.failures,
                full.acceptedQualityThresholdPct.takeIf{it>0},
                full.evaluatedQualityThresholdsPct,
                full.downstreamEligible,
                full.successRatio
            )
        }

        val operationId=UUID.randomUUID().toString()
        val startedAt=clock()
        repairProgress(operationId,"SCAN",0,0,null,startedAt,null,"RUNNING")
        try {
            val today=LocalDate.ofInstant(now,ZoneId.of("Europe/Istanbul"))
            val snapshot=dao.universeAtOrBefore(today.toString()) ?: run {
                val full=sync(settings)
                return HistoricalRepairResult(
                    full.operationId,"FULL_TABLE_UNIVERSE_MISSING",
                    full.total,full.succeeded,full.failures,
                    full.acceptedQualityThresholdPct.takeIf{it>0},
                    full.evaluatedQualityThresholdsPct,
                    full.downstreamEligible,
                    full.successRatio
                )
            }
            val blocked=dao.blockedInstruments().map{it.symbol}.toSet()
            val symbols=(listOf("XU100")+parseSymbols(snapshot.symbolsJson).filterNot{it in blocked}).distinct()

            suspend fun reconstructedTransferDecision():TransferQualityDecision? {
                val since=mainStartedAt ?: return mainResult?.let { main ->
                    TransferQualityLadder.evaluate(
                        main.succeeded,main.total,settings.transferQualityThresholdsPct
                    )
                }
                var successful=0
                for(symbol in symbols) if(persistedSince(symbol,since)) successful++
                return TransferQualityLadder.evaluate(
                    successful,symbols.size,settings.transferQualityThresholdsPct
                )
            }

            val targets=mutableListOf<String>()
            for(symbol in symbols) {
                val bars=dao.marketBars(symbol,now.toString())
                val latest=bars.lastOrNull()
                val hasMissingCell=latest==null ||
                    latest.openDecimal.isNullOrBlank() ||
                    latest.highDecimal.isNullOrBlank() ||
                    latest.lowDecimal.isNullOrBlank() ||
                    latest.closeDecimal.isBlank() ||
                    latest.volumeDecimal.isNullOrBlank()
                val obs=dao.latestObservation(symbol,now.toString())
                // The rule is based on source/data time, never transport receive time.
                // Missing marketTimestamp is itself missing data-time evidence and is repaired.
                val evidenceAt=obs?.marketTimestampUtc
                    ?.let{runCatching{Instant.parse(it)}.getOrNull()}
                if(HistoricalRepairPolicy.targetRow(hasMissingCell,evidenceAt,now)) targets+=symbol
            }

            repairProgress(operationId,"TARGETED",0,targets.size,null,startedAt,null,"RUNNING")
            if(targets.isEmpty()) {
                val finalDecision=reconstructedTransferDecision()
                val stage=when {
                    finalDecision?.acceptedThresholdPct!=null -> "COMPLETE_NO_GAPS_Q"+finalDecision.acceptedThresholdPct
                    finalDecision!=null -> "COMPLETE_NO_GAPS_BELOW_GATE"
                    else -> "COMPLETE_NO_GAPS"
                }
                val gateError=if(finalDecision!=null && finalDecision.acceptedThresholdPct==null)
                    "DATA_QUALITY_BELOW_GATE_DOWNSTREAM_FROZEN" else null
                repairProgress(operationId,stage,0,0,null,startedAt,gateError,"SUCCEEDED")
                return HistoricalRepairResult(
                    operationId,"TARGETED_NO_GAPS",0,0,emptyList(),
                    finalDecision?.acceptedThresholdPct,
                    finalDecision?.evaluatedThresholdsPct.orEmpty(),
                    finalDecision?.let{it.acceptedThresholdPct!=null},
                    finalDecision?.ratio?.toPlainString()
                )
            }

            val from=now.minusSeconds(settings.lookbackDays*86400)
            val to=now.plusSeconds(86400)
            val failures=mutableListOf<SyncFailure>()
            var succeeded=0
            targets.forEachIndexed { index,symbol ->
                repairProgress(operationId,"TARGETED_FETCH",index,targets.size,symbol,startedAt,null,"RUNNING")
                val providerSymbol=if(symbol=="XU100")"XU100.IS" else symbol+".IS"
                when(val result=fetchWithRetry(providerSymbol,from,to,settings.providerRetryCount)) {
                    is BarProviderResult.Success -> {
                        dao.putMarketBars(result.bars.map{it.toEntity(symbol)})
                        result.latestObservation?.let{dao.insertObservation(it.toEntity(symbol))}
                        succeeded++
                    }
                    is BarProviderResult.Failure ->
                        failures+=SyncFailure(symbol,result.provider,result.code,result.retryable)
                }
                repairProgress(
                    operationId,"TARGETED_FETCH",index+1,targets.size,symbol,startedAt,
                    failures.lastOrNull()?.takeIf{it.symbol==symbol}?.code,"RUNNING"
                )
            }
            val finalDecision=reconstructedTransferDecision()
            val finalStage=when {
                finalDecision?.acceptedThresholdPct!=null -> "COMPLETE_TARGETED_Q"+finalDecision.acceptedThresholdPct
                finalDecision!=null -> "COMPLETE_TARGETED_BELOW_GATE"
                else -> "COMPLETE_TARGETED"
            }
            val finalError=when {
                finalDecision!=null && finalDecision.acceptedThresholdPct==null ->
                    "DATA_QUALITY_BELOW_GATE_DOWNSTREAM_FROZEN"
                failures.isNotEmpty() -> "REPAIR_PARTIAL_FAILURES"
                else -> null
            }
            repairProgress(
                operationId,finalStage,targets.size,targets.size,null,startedAt,
                finalError,"SUCCEEDED"
            )
            return HistoricalRepairResult(
                operationId,"TARGETED_MISSING_OR_OLDER_THAN_30M",
                targets.size,succeeded,failures,
                finalDecision?.acceptedThresholdPct,
                finalDecision?.evaluatedThresholdsPct.orEmpty(),
                finalDecision?.let{it.acceptedThresholdPct!=null},
                finalDecision?.ratio?.toPlainString()
            )
        } catch(c:CancellationException) {
            val userCancelled=c.message=="USER_CANCELLED"
            val state=if(userCancelled)"CANCELLED" else "INTERRUPTED"
            val code=if(userCancelled)"USER_CANCELLED" else "PROCESS_INTERRUPTED_RECOVERABLE"
            repairProgress(operationId,state,0,0,null,startedAt,code,state)
            throw c
        } catch(t:Throwable) {
            repairProgress(operationId,"FAILED",0,0,null,startedAt,t::class.java.simpleName,"FAILED")
            throw t
        }
    }

    private suspend fun repairProgress(
        operationId:String,
        stage:String,
        processed:Int,
        total:Int,
        instrument:String?,
        startedAt:Instant,
        errorCode:String?,
        state:String
    ) {
        val now=clock()
        dao.putOperationProgress(
            OperationProgressEntity(
                operationId=operationId,
                operationType="HISTORICAL_REPAIR",
                stage=stage,
                processed=processed,
                total=total,
                currentInstrument=instrument,
                provider=barProvider.id,
                elapsedMs=Duration.between(startedAt,now).toMillis().coerceAtLeast(0),
                errorCode=errorCode,
                state=state,
                cancelRequested=false,
                startedAtUtc=startedAt.toString(),
                updatedAtUtc=now.toString()
            )
        )
    }

    private suspend fun persistedSince(symbol:String,since:Instant):Boolean {
        val received=dao.lastBarReceivedAt(symbol)
            ?.let{runCatching{Instant.parse(it)}.getOrNull()}
            ?: return false
        return !received.isBefore(since)
    }

    private suspend fun fetchWithRetry(
        symbol:String,from:Instant,to:Instant,maxAttempts:Int
    ):BarProviderResult {
        var last:BarProviderResult?=null
        repeat(maxAttempts) { index ->
            val result=withContext(Dispatchers.IO){barProvider.fetch(symbol,from,to)}
            last=result
            if(result is BarProviderResult.Success) return result
            if(result is BarProviderResult.Failure && !result.retryable) return result
            if(index<maxAttempts-1) kotlinx.coroutines.delay(750L*(index+1))
        }
        return requireNotNull(last)
    }

    private suspend fun checkCancellation(operationId:String,startedAt:Instant) {
        currentCoroutineContext().ensureActive()
        val row=dao.operationProgress(operationId)
        if(row?.cancelRequested==true) {
            progress(
                operationId,"CANCELLED",row.processed,row.total,row.currentInstrument,row.provider,
                startedAt,"USER_CANCELLED","CANCELLED",true
            )
            throw CancellationException("USER_CANCELLED")
        }
    }

    private suspend fun progress(
        operationId:String,
        stage:String,
        processed:Int,
        total:Int,
        instrument:String?,
        provider:String?,
        startedAt:Instant,
        errorCode:String?,
        state:String,
        cancelRequested:Boolean
    ) {
        val now=clock()
        dao.putOperationProgress(
            OperationProgressEntity(
                operationId=operationId,
                operationType="HISTORICAL_SYNC",
                stage=stage,
                processed=processed,
                total=total,
                currentInstrument=instrument,
                provider=provider,
                elapsedMs=Duration.between(startedAt,now).toMillis().coerceAtLeast(0),
                errorCode=errorCode,
                state=state,
                cancelRequested=cancelRequested,
                startedAtUtc=startedAt.toString(),
                updatedAtUtc=now.toString()
            )
        )
    }

    private fun parseSymbols(json:String):List<String> {
        val a=JSONArray(json)
        return (0 until a.length()).mapNotNull{
            a.optString(it).uppercase().trim()
                .takeIf{s->s.matches(Regex("[A-ZÇĞİÖŞÜ0-9]{2,7}"))}
        }.distinct().sorted()
    }

    private fun io.aurum.common.provider.Observation.toEntity(domainSymbol:String)=MarketObservationEntity(
        id=UUID.randomUUID().toString(),
        symbol=domainSymbol,
        provider=provenance.provider,
        requestedAtUtc=provenance.requestedAt.toString(),
        receivedAtUtc=provenance.receivedAt.toString(),
        marketTimestampUtc=provenance.marketTimestamp?.toString(),
        valueDecimal=value?.toPlainString(),
        currency=currency,
        quality=provenance.quality.name,
        freshness=provenance.freshness.name,
        rawSourceFingerprint=provenance.rawSourceFingerprint,
        transformVersion=provenance.transformVersion
    )

    private fun CanonicalBar.toEntity(domainSymbol:String)=MarketBarEntity(
        symbol=domainSymbol,
        atUtc=at.toString(),
        provider=provider,
        openDecimal=open?.toPlainString(),
        highDecimal=high?.toPlainString(),
        lowDecimal=low?.toPlainString(),
        closeDecimal=close.toPlainString(),
        adjustedCloseDecimal=adjustedClose?.toPlainString(),
        volumeDecimal=volume?.toPlainString(),
        currency=currency,
        requestedAtUtc=requestedAt.toString(),
        receivedAtUtc=receivedAt.toString(),
        quality=quality.name,
        freshness=freshness.name,
        rawSourceFingerprint=rawSourceFingerprint
    )
}
