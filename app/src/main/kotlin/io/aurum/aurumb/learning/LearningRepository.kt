package io.aurum.aurumb.learning

import io.aurum.aurumb.persistence.AuditEventEntity
import io.aurum.aurumb.persistence.AurumDao
import io.aurum.aurumb.persistence.ModelEntity
import io.aurum.common.model.AurumVersions
import org.json.JSONObject
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

data class PromotionOutcome(
    val promoted:Boolean,
    val reason:String,
    val championVersion:String
)

class LearningRepository(
    private val dao:AurumDao,
    private val policy:PromotionPolicy=PromotionPolicy(),
    private val clock:()->Instant={Instant.now()}
) {
    suspend fun registerCandidate(
        version:String,
        parentVersion:String?,
        proposal:WeightProposal,
        metrics:ValidationMetrics,
        reason:String
    ) {
        require(version.isNotBlank())
        require(proposal.weights.keys==(1..7).map{"K"+it}.toSet())
        dao.insertModel(
            ModelEntity(
                version=version,
                role="CANDIDATE",
                createdAtUtc=clock().toString(),
                weightsJson=JSONObject(proposal.weights.mapValues{it.value.toPlainString()}).toString(),
                validationJson=metricsJson(metrics),
                sampleCount=metrics.sampleCount,
                reason=reason,
                parentVersion=parentVersion,
                active=false
            )
        )
    }

    suspend fun validateCandidate(
        candidateVersion:String,
        proposal:WeightProposal,
        metrics:ValidationMetrics,
        reason:String
    ):Boolean {
        val target=dao.models().firstOrNull{it.version==candidateVersion}
            ?: throw IllegalArgumentException("unknown candidate")
        require(target.role=="CANDIDATE") { "model is not a candidate" }
        if(!policy.eligible(metrics,proposal)) {
            appendAudit(
                code="MODEL_CANDIDATE_REJECTED",
                message="Candidate validation failed",
                metadata=mapOf(
                    "candidate" to candidateVersion,
                    "sampleCount" to metrics.sampleCount.toString(),
                    "regimeCount" to metrics.regimeCount.toString(),
                    "reason" to reason
                )
            )
            return false
        }
        dao.transitionModelRoleWithAudit(
            candidateVersion,
            "CANDIDATE",
            "CHALLENGER",
            buildAudit(
                code="MODEL_CHALLENGER_ACCEPTED",
                message="Validated candidate entered challenger stage",
                metadata=mapOf(
                    "from" to "CANDIDATE",
                    "to" to candidateVersion,
                    "sampleCount" to metrics.sampleCount.toString(),
                    "regimeCount" to metrics.regimeCount.toString(),
                    "netEconomicUtility" to metrics.netEconomicUtility.toPlainString(),
                    "maxDrawdown" to metrics.maxDrawdown.toPlainString(),
                    "precisionAtN" to metrics.precisionAtN.toPlainString(),
                    "ndcg" to metrics.ndcg.toPlainString(),
                    "calibrationError" to metrics.calibrationError.toPlainString(),
                    "stability" to metrics.stability.toPlainString(),
                    "reason" to reason
                )
            )
        )
        return true
    }

    suspend fun evaluateAndPromote(
        challengerVersion:String,
        proposal:WeightProposal,
        metrics:ValidationMetrics,
        reason:String
    ):PromotionOutcome {
        val current=dao.champion()
        if(!policy.eligible(metrics,proposal)) {
            appendAudit(
                code="MODEL_PROMOTION_REJECTED",
                message="Challenger validation failed",
                metadata=mapOf(
                    "challenger" to challengerVersion,
                    "champion" to (current?.version?:"NONE"),
                    "sampleCount" to metrics.sampleCount.toString(),
                    "regimeCount" to metrics.regimeCount.toString(),
                    "reason" to reason
                )
            )
            return PromotionOutcome(false,"VALIDATION_FAILED",current?.version?:"NONE")
        }

        val target=dao.models().firstOrNull{it.version==challengerVersion}
            ?: throw IllegalArgumentException("unknown challenger")
        require(target.role=="CHALLENGER") { "only a validated challenger is promotable" }

        val promotionAudit=buildAudit(
            code="MODEL_PROMOTED",
            message="Validated challenger promoted to champion",
            metadata=mapOf(
                "from" to (current?.version?:"NONE"),
                "to" to challengerVersion,
                "sampleCount" to metrics.sampleCount.toString(),
                "regimeCount" to metrics.regimeCount.toString(),
                "netEconomicUtility" to metrics.netEconomicUtility.toPlainString(),
                "maxDrawdown" to metrics.maxDrawdown.toPlainString(),
                "precisionAtN" to metrics.precisionAtN.toPlainString(),
                "ndcg" to metrics.ndcg.toPlainString(),
                "calibrationError" to metrics.calibrationError.toPlainString(),
                "stability" to metrics.stability.toPlainString(),
                "reason" to reason
            )
        )
        dao.promoteModelWithAudit(challengerVersion,promotionAudit)
        return PromotionOutcome(true,"PROMOTED",challengerVersion)
    }

    suspend fun recordChallengerRejection(
        challengerVersion:String,
        candidateMetrics:ValidationMetrics,
        incumbentVersion:String,
        incumbentMetrics:ValidationMetrics,
        reason:String
    ) {
        appendAudit(
            code="MODEL_CHALLENGER_NOT_PROMOTED",
            message="Challenger did not beat incumbent on locked test",
            metadata=mapOf(
                "challenger" to challengerVersion,
                "champion" to incumbentVersion,
                "candidateUtility" to candidateMetrics.netEconomicUtility.toPlainString(),
                "incumbentUtility" to incumbentMetrics.netEconomicUtility.toPlainString(),
                "candidatePrecision" to candidateMetrics.precisionAtN.toPlainString(),
                "incumbentPrecision" to incumbentMetrics.precisionAtN.toPlainString(),
                "candidateNdcg" to candidateMetrics.ndcg.toPlainString(),
                "incumbentNdcg" to incumbentMetrics.ndcg.toPlainString(),
                "reason" to reason
            )
        )
    }

    suspend fun retireChallenger(version:String,reason:String) {
        val target=dao.models().firstOrNull{it.version==version}
            ?: throw IllegalArgumentException("unknown challenger")
        require(target.role=="CHALLENGER") { "only challenger can be retired by validation" }
        dao.transitionModelRoleWithAudit(
            version,
            "CHALLENGER",
            "RETIRED",
            buildAudit(
                code="MODEL_CHALLENGER_RETIRED",
                message="Challenger retired after locked-test failure",
                metadata=mapOf("from" to version,"to" to "RETIRED","reason" to reason)
            )
        )
    }

    suspend fun rollback(targetVersion:String,reason:String):PromotionOutcome {
        val current=dao.champion()
        val target=dao.models().firstOrNull{it.version==targetVersion}
            ?: throw IllegalArgumentException("unknown rollback target")
        require(current?.version!=target.version) { "target already champion" }
        require(target.role=="RETIRED" && !target.active) { "rollback target must be retired" }
        val wasChampion=dao.recentAudit(10_000)
            .asSequence()
            .filter { it.code=="MODEL_PROMOTED" || it.code=="MODEL_ROLLBACK" }
            .mapNotNull { runCatching{JSONObject(it.metadataJson)}.getOrNull() }
            .any { meta ->
                meta.optString("to")==targetVersion || meta.optString("from")==targetVersion
            }
        require(wasChampion) { "rollback target was never a champion" }
        val rollbackAudit=buildAudit(
            code="MODEL_ROLLBACK",
            message="Champion rolled back",
            metadata=mapOf(
                "from" to (current?.version?:"NONE"),
                "to" to target.version,
                "reason" to reason
            )
        )
        dao.promoteModelWithAudit(target.version,rollbackAudit)
        return PromotionOutcome(true,"ROLLED_BACK",target.version)
    }

    private suspend fun appendAudit(code:String,message:String,metadata:Map<String,String>) {
        dao.appendAudit(buildAudit(code,message,metadata))
    }

    private fun buildAudit(code:String,message:String,metadata:Map<String,String>):AuditEventEntity {
        val at=clock()
        return AuditEventEntity(
                id=UUID.randomUUID().toString(),
                timestampUtc=at.toString(),
                level="INFO",
                subsystem="LEARNING",
                operationId="model:"+metadata["to"].orEmpty()+":"+at.toEpochMilli(),
                code=code,
                message=message,
                metadataJson=JSONObject(metadata).toString(),
                appVersion=AurumVersions.APP,
                modelVersion=metadata["to"] ?: metadata["champion"] ?: AurumVersions.MODEL,
                formulaVersion=AurumVersions.FORMULA,
                dataSchemaVersion=AurumVersions.DATA_SCHEMA,
                provenanceJson=JSONObject().put("source","deterministic-validation").toString()
            )
    }

    private fun metricsJson(m:ValidationMetrics)=JSONObject()
        .put("sampleCount",m.sampleCount)
        .put("regimeCount",m.regimeCount)
        .put("netEconomicUtility",m.netEconomicUtility.toPlainString())
        .put("maxDrawdown",m.maxDrawdown.toPlainString())
        .put("precisionAtN",m.precisionAtN.toPlainString())
        .put("ndcg",m.ndcg.toPlainString())
        .put("calibrationError",m.calibrationError.toPlainString())
        .put("stability",m.stability.toPlainString())
        .toString()
}
