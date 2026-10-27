package io.aurum.aurumb.pipeline

import io.aurum.aurumb.history.KHistoricalService
import io.aurum.aurumb.persistence.AurumDao
import io.aurum.aurumb.persistence.AnalysisRunEntity
import io.aurum.aurumb.persistence.SelectionResultEntity
import io.aurum.aurumb.persistence.PipelineStagePublicationEntity
import io.aurum.aurumb.persistence.OperationProgressEntity
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.Duration
import java.util.UUID
import kotlinx.coroutines.CancellationException

enum class PipelineTriggerSource { AUTOMATIC, MANUAL }

object PipelineStages {
    const val KN="KN"
    const val K_HISTORICAL="K_TARIHSEL"
    const val S="S"
}

class DownstreamPipelineService(
    private val dao:AurumDao,
    private val selection:SelectionComputationService,
    private val clock:()->Instant={Instant.now()}
) {
    suspend fun runKn(
        settings:PipelineSettings,
        sourceDataPublicationUtc:String,
        triggerSource:PipelineTriggerSource
    ):SelectionPreparation {
        val operationId=UUID.randomUUID().toString()
        val startedAt=clock()
        track(operationId,"PIPELINE_KN","PREPARING",0,3,null,startedAt,null,"RUNNING")
        try {
            checkCancellation(operationId,"PIPELINE_KN",startedAt,0,3,"PREPARING")
            val prepared=selection.prepare(settings)
            track(operationId,"PIPELINE_KN","CALCULATING",1,3,prepared.rows.size.toString()+" aday",startedAt,null,"RUNNING")
            checkCancellation(operationId,"PIPELINE_KN",startedAt,1,3,"CALCULATING")
            val rows=JSONArray()
            prepared.rows
                .filter{it.scoreDecimal.toBigDecimalOrNull()?.let{x->x>java.math.BigDecimal.ZERO}==true}
                .sortedWith(compareByDescending<io.aurum.aurumb.persistence.SelectionResultEntity>{
                    it.scoreDecimal.toBigDecimalOrNull()?:java.math.BigDecimal.ZERO
                }.thenBy{it.symbol})
                .take(50)
                .forEach { row ->
                    rows.put(JSONObject()
                        .put("symbol",row.symbol)
                        .put("score",row.scoreDecimal)
                        .put("contributions",JSONArray(row.contributionsJson)))
                }
            val publishedAt=clock().toString()
            val payload=encodePreparation(prepared,rows,settings.topN)
            track(operationId,"PIPELINE_KN","PUBLISHING",2,3,null,startedAt,null,"RUNNING")
            checkCancellation(operationId,"PIPELINE_KN",startedAt,2,3,"PUBLISHING")
            dao.putPipelineStagePublication(PipelineStagePublicationEntity(
                stage=PipelineStages.KN,
                sourceDataPublicationUtc=sourceDataPublicationUtc,
                publishedAtUtc=publishedAt,
                triggerSource=triggerSource.name,
                payloadJson=payload
            ))
            KHistoricalService(dao).mirrorKn(payload,publishedAt)
            track(operationId,"PIPELINE_KN","COMPLETE",3,3,null,startedAt,null,"SUCCEEDED")
            return prepared
        } catch(c:CancellationException) {
            track(operationId,"PIPELINE_KN","CANCELLED",0,3,null,startedAt,"USER_CANCELLED","CANCELLED",true)
            throw c
        } catch(t:Throwable) {
            track(operationId,"PIPELINE_KN","FAILED",0,3,null,startedAt,t::class.java.simpleName,"FAILED")
            throw t
        }
    }

    suspend fun runKHistorical(
        sourceDataPublicationUtc:String,
        triggerSource:PipelineTriggerSource
    ) {
        val operationId=UUID.randomUUID().toString()
        val startedAt=clock()
        track(operationId,"PIPELINE_K_TARIHSEL","PREPARING",0,2,null,startedAt,null,"RUNNING")
        try {
            checkCancellation(operationId,"PIPELINE_K_TARIHSEL",startedAt,0,2,"PREPARING")
            requirePredecessor(PipelineStages.KN,sourceDataPublicationUtc)
            val trend=KHistoricalService(dao).latestTrend()
            track(operationId,"PIPELINE_K_TARIHSEL","PUBLISHING",1,2,trend?.rows?.size?.toString()?.plus(" dönem"),startedAt,null,"RUNNING")
            checkCancellation(operationId,"PIPELINE_K_TARIHSEL",startedAt,1,2,"PUBLISHING")
            val payload=JSONObject().put("available",trend!=null)
            if(trend!=null) {
                payload.put("runId",trend.runId)
                    .put("evaluatedAt",trend.evaluatedAt.toString())
                    .put("entries",JSONArray().apply {
                        trend.entries.forEach { e ->
                            put(JSONObject().put("criterion",e.criterion).put("hits",e.hits).put("total",e.total))
                        }
                    })
                    .put("rows",JSONArray().apply {
                        trend.rows.forEach { row ->
                            put(JSONObject()
                                .put("label",row.label)
                                .put("knRunId",row.knRunId)
                                .put("knSourceDate",row.knSourceDate)
                                .put("knTimestampUtc",row.knTimestampUtc)
                                .put("reelSourceDate",row.reelSourceDate?:JSONObject.NULL)
                                .put("reelTimestampUtc",row.reelTimestampUtc?:JSONObject.NULL)
                                .put("topN",row.topN)
                                .put("frozen",row.frozen))
                        }
                    })
            }
            dao.putPipelineStagePublication(PipelineStagePublicationEntity(
                stage=PipelineStages.K_HISTORICAL,
                sourceDataPublicationUtc=sourceDataPublicationUtc,
                publishedAtUtc=clock().toString(),
                triggerSource=triggerSource.name,
                payloadJson=payload.toString()
            ))
            track(operationId,"PIPELINE_K_TARIHSEL","COMPLETE",2,2,null,startedAt,null,"SUCCEEDED")
        } catch(c:CancellationException) {
            track(operationId,"PIPELINE_K_TARIHSEL","CANCELLED",0,2,null,startedAt,"USER_CANCELLED","CANCELLED",true)
            throw c
        } catch(t:Throwable) {
            track(operationId,"PIPELINE_K_TARIHSEL","FAILED",0,2,null,startedAt,t::class.java.simpleName,"FAILED")
            throw t
        }
    }

    suspend fun runSelection(
        settings:PipelineSettings,
        sourceDataPublicationUtc:String,
        triggerSource:PipelineTriggerSource,
        prepared:SelectionPreparation?=null
    ):SelectionPublishResult {
        val operationId=UUID.randomUUID().toString()
        val startedAt=clock()
        track(operationId,"PIPELINE_S","PREPARING",0,3,null,startedAt,null,"RUNNING")
        try {
            checkCancellation(operationId,"PIPELINE_S",startedAt,0,3,"PREPARING")
            requirePredecessor(PipelineStages.K_HISTORICAL,sourceDataPublicationUtc)
            val effective=prepared?:loadPreparedKn(sourceDataPublicationUtc)
            track(operationId,"PIPELINE_S","CALCULATING",1,3,effective.rows.size.toString()+" aday",startedAt,null,"RUNNING")
            checkCancellation(operationId,"PIPELINE_S",startedAt,1,3,"CALCULATING")
            val published=selection.publish(effective)
            track(operationId,"PIPELINE_S","PUBLISHING",2,3,published.selected.toString()+" seçili",startedAt,null,"RUNNING")
            checkCancellation(operationId,"PIPELINE_S",startedAt,2,3,"PUBLISHING")
            dao.putPipelineStagePublication(PipelineStagePublicationEntity(
                stage=PipelineStages.S,
                sourceDataPublicationUtc=sourceDataPublicationUtc,
                publishedAtUtc=clock().toString(),
                triggerSource=triggerSource.name,
                payloadJson=JSONObject()
                    .put("runId",published.runId)
                    .put("eligible",published.eligible)
                    .put("selected",published.selected)
                    .put("rejected",published.rejected)
                    .put("asOf",published.asOf.toString())
                    .toString()
            ))
            track(operationId,"PIPELINE_S","COMPLETE",3,3,null,startedAt,null,"SUCCEEDED")
            return published
        } catch(c:CancellationException) {
            track(operationId,"PIPELINE_S","CANCELLED",0,3,null,startedAt,"USER_CANCELLED","CANCELLED",true)
            throw c
        } catch(t:Throwable) {
            track(operationId,"PIPELINE_S","FAILED",0,3,null,startedAt,t::class.java.simpleName,"FAILED")
            throw t
        }
    }

    suspend fun runAutomatic(
        settings:PipelineSettings,
        sourceDataPublicationUtc:String
    ):SelectionPublishResult {
        val prepared=runKn(settings,sourceDataPublicationUtc,PipelineTriggerSource.AUTOMATIC)
        runKHistorical(sourceDataPublicationUtc,PipelineTriggerSource.AUTOMATIC)
        return runSelection(
            settings,sourceDataPublicationUtc,PipelineTriggerSource.AUTOMATIC,prepared
        )
    }

    private fun encodePreparation(prepared:SelectionPreparation,displayRows:JSONArray,topN:Int):String {
        val run=prepared.run
        return JSONObject()
            .put("preparedRunId",run.id)
            .put("topN",topN)
            .put("eligible",prepared.eligible)
            .put("selectedCandidateCount",prepared.selected)
            .put("rejected",prepared.rejected)
            .put("asOf",prepared.asOf.toString())
            .put("rows",displayRows)
            .put("run",JSONObject()
                .put("id",run.id)
                .put("asOfUtc",run.asOfUtc)
                .put("appVersion",run.appVersion)
                .put("modelVersion",run.modelVersion)
                .put("formulaVersion",run.formulaVersion)
                .put("dataSchemaVersion",run.dataSchemaVersion)
                .put("marketRegime",run.marketRegime)
                .put("dataFingerprint",run.dataFingerprint)
                .put("status",run.status)
                .put("integrityPassed",run.integrityPassed))
            .put("selectionRows",JSONArray().apply {
                prepared.rows.forEach { row ->
                    put(JSONObject()
                        .put("runId",row.runId)
                        .put("symbol",row.symbol)
                        .put("rank",row.rank)
                        .put("scoreDecimal",row.scoreDecimal)
                        .put("alphaScoreDecimal",row.alphaScoreDecimal)
                        .put("dataQualityDecimal",row.dataQualityDecimal)
                        .put("confidenceDecimal",row.confidenceDecimal)
                        .put("applicabilityDecimal",row.applicabilityDecimal)
                        .put("targetProbabilityDecimal",row.targetProbabilityDecimal)
                        .put("contributionsJson",row.contributionsJson)
                        .put("rejectionReason",row.rejectionReason?:JSONObject.NULL))
                }
            }).toString()
    }

    private suspend fun loadPreparedKn(sourceDataPublicationUtc:String):SelectionPreparation {
        val stage=dao.pipelineStagePublication(PipelineStages.KN)
            ?: throw IllegalStateException("PIPELINE_PREDECESSOR_NOT_RUN:"+PipelineStages.KN)
        require(stage.sourceDataPublicationUtc==sourceDataPublicationUtc) {
            "PIPELINE_PREDECESSOR_STALE:"+PipelineStages.KN
        }
        val root=JSONObject(stage.payloadJson)
        val r=root.getJSONObject("run")
        val run=AnalysisRunEntity(
            id=r.getString("id"),
            asOfUtc=r.getString("asOfUtc"),
            appVersion=r.getString("appVersion"),
            modelVersion=r.getString("modelVersion"),
            formulaVersion=r.getString("formulaVersion"),
            dataSchemaVersion=r.getString("dataSchemaVersion"),
            marketRegime=r.getString("marketRegime"),
            dataFingerprint=r.getString("dataFingerprint"),
            status=r.getString("status"),
            integrityPassed=r.getBoolean("integrityPassed")
        )
        val arr=root.getJSONArray("selectionRows")
        val rows=buildList {
            for(i in 0 until arr.length()) {
                val x=arr.getJSONObject(i)
                add(SelectionResultEntity(
                    runId=x.getString("runId"),
                    symbol=x.getString("symbol"),
                    rank=x.getInt("rank"),
                    scoreDecimal=x.getString("scoreDecimal"),
                    alphaScoreDecimal=x.getString("alphaScoreDecimal"),
                    dataQualityDecimal=x.getString("dataQualityDecimal"),
                    confidenceDecimal=x.getString("confidenceDecimal"),
                    applicabilityDecimal=x.getString("applicabilityDecimal"),
                    targetProbabilityDecimal=x.getString("targetProbabilityDecimal"),
                    contributionsJson=x.getString("contributionsJson"),
                    rejectionReason=x.optString("rejectionReason").takeUnless{it.isBlank()||it=="null"}
                ))
            }
        }
        return SelectionPreparation(
            run=run,
            rows=rows,
            eligible=root.getInt("eligible"),
            selected=root.getInt("selectedCandidateCount"),
            rejected=root.getInt("rejected"),
            asOf=Instant.parse(root.getString("asOf"))
        )
    }

    private suspend fun checkCancellation(
        operationId:String,operationType:String,startedAt:Instant,
        processed:Int,total:Int,stage:String
    ) {
        if(dao.operationProgress(operationId)?.cancelRequested==true) {
            track(operationId,operationType,stage,processed,total,null,startedAt,"USER_CANCELLED","CANCELLED",true)
            throw CancellationException("USER_CANCELLED")
        }
    }

    private suspend fun track(
        operationId:String,operationType:String,stage:String,processed:Int,total:Int,
        current:String?,startedAt:Instant,errorCode:String?,state:String,cancelRequested:Boolean=false
    ) {
        val now=clock()
        val existing=dao.operationProgress(operationId)
        dao.putOperationProgress(OperationProgressEntity(
            operationId=operationId,
            operationType=operationType,
            stage=stage,
            processed=processed,
            total=total,
            currentInstrument=current,
            provider="NATIVE_CALC",
            elapsedMs=Duration.between(startedAt,now).toMillis().coerceAtLeast(0),
            errorCode=errorCode,
            state=if(existing?.cancelRequested==true && state=="RUNNING")"CANCEL_REQUESTED" else state,
            cancelRequested=(existing?.cancelRequested==true)||cancelRequested,
            startedAtUtc=startedAt.toString(),
            updatedAtUtc=now.toString()
        ))
    }

    private suspend fun requirePredecessor(stage:String,sourceDataPublicationUtc:String) {
        val previous=dao.pipelineStagePublication(stage)
            ?: throw IllegalStateException("PIPELINE_PREDECESSOR_NOT_RUN:"+stage)
        require(previous.sourceDataPublicationUtc==sourceDataPublicationUtc) {
            "PIPELINE_PREDECESSOR_STALE:"+stage
        }
    }
}
