package io.aurum.aurumb.learning

import io.aurum.aurumb.persistence.AurumDao
import io.aurum.aurumb.selection.SelectionOutcomeService
import io.aurum.common.model.AurumVersions
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.security.MessageDigest
import java.time.Instant

data class LearningPipelineSummary(
    val status:String,
    val candidateVersion:String?,
    val trainSamples:Int,
    val validationSamples:Int,
    val testSamples:Int,
    val championVersion:String?,
    val detail:String
)

class LearningPipelineService(
    private val dao:AurumDao,
    private val repository:LearningRepository=LearningRepository(dao),
    private val clock:()->Instant={Instant.now()}
) {
    suspend fun run(topN:Int=20,minRuns:Int=30):LearningPipelineSummary {
        require(topN in 1..20)
        require(minRuns>=30)
        val now=clock()
        val outcomeService=SelectionOutcomeService(dao,clock)
        val outcomes=outcomeService.calibrationEvidence(now)
        if(outcomes.isEmpty()) {
            return summary("NO_EVIDENCE",null,0,0,0,null,"No eligible matured outcomes")
        }

        val persisted=dao.eligibleSelectionOutcomesAsOf(now.toString()).associateBy{it.id}
        val rowsByRun=mutableMapOf<String,Map<String,io.aurum.aurumb.persistence.SelectionResultEntity>>()
        val observations=outcomes.mapNotNull { evidence ->
            val entity=persisted[evidence.id] ?: return@mapNotNull null
            val selection=rowsByRun.getOrPut(entity.runId) {
                dao.selectionsForRun(entity.runId).associateBy{it.symbol}
            }[entity.symbol] ?: return@mapNotNull null
            val criterionScores=parseCriterionScores(selection.contributionsJson) ?: return@mapNotNull null
            val applicability=selection.applicabilityDecimal.toBigDecimalOrNull() ?: return@mapNotNull null
            val risk=BigDecimal.ONE.subtract(applicability).coerceIn(BigDecimal.ZERO,BigDecimal.ONE)
            ModelValidationObservation(
                id=entity.id,
                runId=entity.runId,
                decisionAt=Instant.parse(entity.decisionAtUtc),
                realizedAt=Instant.parse(entity.evaluatedAtUtc),
                criterionScores=criterionScores,
                executionRisk=risk,
                netReturn=entity.netReturnDecimal.toBigDecimalOrNull() ?: return@mapNotNull null,
                hit=entity.targetHit,
                regime=entity.regime
            )
        }

        val runGroups=observations.groupBy{it.runId}.entries
            .sortedBy{entry->entry.value.minOf{it.decisionAt}}
        if(runGroups.size<minRuns) {
            return summary(
                "INSUFFICIENT_RUNS",null,observations.size,0,0,dao.champion()?.version,
                "Need at least "+minRuns+" distinct mature runs; have "+runGroups.size
            )
        }

        val validationRunCount=maxOf(6,runGroups.size/5)
        val testRunCount=maxOf(6,runGroups.size/5)
        val trainRunCount=runGroups.size-validationRunCount-testRunCount
        if(trainRunCount<12) {
            return summary("INSUFFICIENT_SPLIT",null,0,0,0,dao.champion()?.version,"Train run count below 12")
        }

        val trainIds=runGroups.take(trainRunCount).map{it.key}.toSet()
        val validationGroups=runGroups.drop(trainRunCount).take(validationRunCount)
        val testGroups=runGroups.takeLast(testRunCount)
        val validationIds=validationGroups.map{it.key}.toSet()
        val testIds=testGroups.map{it.key}.toSet()
        val validationStart=validationGroups.minOf{g->g.value.minOf{it.decisionAt}}
        val testStart=testGroups.minOf{g->g.value.minOf{it.decisionAt}}

        val train=observations.filter{it.runId in trainIds && it.realizedAt.isBefore(validationStart)}
        val validation=observations.filter{it.runId in validationIds && it.realizedAt.isBefore(testStart)}
        val test=observations.filter{it.runId in testIds}

        if(train.size<120 || validation.size<120 || test.size<120) {
            return summary(
                "INSUFFICIENT_SAMPLES",null,train.size,validation.size,test.size,dao.champion()?.version,
                "Purge-safe train/validation/test each require at least 120 observations"
            )
        }

        val learningSamples=train.map { row ->
            LearningSample(
                id=row.id,
                decisionAt=row.decisionAt,
                realizedAt=row.realizedAt,
                criterionScores=row.criterionScores,
                netReturn=row.netReturn,
                regime=row.regime
            )
        }
        val trainAsOf=train.maxOf{it.realizedAt}
        val learned=DeterministicWeightLearner.learn(
            learningSamples,
            trainAsOf,
            WeightLearningPolicy(minSamples=120)
        ) ?: return summary(
            "NO_CANDIDATE",null,train.size,validation.size,test.size,dao.champion()?.version,
            "Deterministic learner did not produce a bounded candidate"
        )

        val incumbentEntity=dao.champion()
        val incumbentWeights=incumbentEntity?.let { parseWeights(it.weightsJson) }
        val incumbent=EffectiveModelResolver.resolve(
            AurumVersions.MODEL,
            incumbentEntity?.version,
            incumbentWeights
        )
        val validationMetrics=ModelValidator.evaluate(learned.proposal.weights,validation,topN)
        val version="aurumb-candidate-"+fingerprint(
            incumbent.version+"|"+
                train.map{it.id}.sorted().joinToString(",")+"|"+
                learned.proposal.weights.toSortedMap().entries.joinToString(","){it.key+"="+it.value.toPlainString()}
        ).take(16)

        val existing=dao.models().firstOrNull{it.version==version}
        if(existing?.role=="CHAMPION") {
            return summary("ALREADY_CHAMPION",version,train.size,validation.size,test.size,version,"Candidate already active")
        }
        if(existing?.role=="RETIRED") {
            return summary("ALREADY_RETIRED",version,train.size,validation.size,test.size,incumbent.version,"Locked evidence already rejected this candidate")
        }
        if(existing?.role=="CHALLENGER") {
            return summary("CHALLENGER_EXISTS",version,train.size,validation.size,test.size,incumbent.version,"Existing challenger awaits different evidence")
        }

        if(existing==null) {
            repository.registerCandidate(
                version=version,
                parentVersion=incumbent.version,
                proposal=learned.proposal,
                metrics=validationMetrics,
                reason="purged time split; train="+train.size+" validation="+validation.size
            )
        }

        if(!repository.validateCandidate(
                candidateVersion=version,
                proposal=learned.proposal,
                metrics=validationMetrics,
                reason="time-ordered validation before locked test"
            )) {
            return summary("VALIDATION_REJECTED",version,train.size,validation.size,test.size,incumbent.version,"Candidate remains non-production")
        }

        val candidateTest=ModelValidator.evaluate(learned.proposal.weights,test,topN)
        val incumbentTest=ModelValidator.evaluate(incumbent.weights,test,topN)
        val beatsIncumbent=
            candidateTest.netEconomicUtility>incumbentTest.netEconomicUtility &&
            candidateTest.precisionAtN>=incumbentTest.precisionAtN &&
            candidateTest.ndcg>=incumbentTest.ndcg

        if(!beatsIncumbent) {
            repository.recordChallengerRejection(
                version,candidateTest,incumbent.version,incumbentTest,
                "locked test did not improve utility without precision/NDCG regression"
            )
            repository.retireChallenger(version,"LOCKED_TEST_RELATIVE_FAILURE")
            return summary("LOCKED_TEST_REJECTED",version,train.size,validation.size,test.size,incumbent.version,"Challenger retired")
        }

        val promotion=repository.evaluateAndPromote(
            challengerVersion=version,
            proposal=learned.proposal,
            metrics=candidateTest,
            reason="locked OOS test beat incumbent"
        )
        if(!promotion.promoted) {
            repository.retireChallenger(version,"ABSOLUTE_PROMOTION_GATE_FAILURE")
            return summary("PROMOTION_REJECTED",version,train.size,validation.size,test.size,incumbent.version,promotion.reason)
        }

        return summary(
            "PROMOTED",version,train.size,validation.size,test.size,promotion.championVersion,
            "Candidate passed validation, locked test, relative incumbent comparison and absolute gates"
        )
    }

    private fun parseCriterionScores(json:String):Map<String,BigDecimal>? {
        return runCatching {
            val arr=JSONArray(json)
            val out=mutableMapOf<String,BigDecimal>()
            for(i in 0 until arr.length()) {
                val row=arr.optJSONObject(i) ?: continue
                val id=row.optString("criterion")
                if(id in (1..7).map{"K"+it}) {
                    val score=row.optString("score").toBigDecimalOrNull() ?: return null
                    out[id]=score
                }
            }
            if(out.keys==(1..7).map{"K"+it}.toSet()) out.toSortedMap() else null
        }.getOrNull()
    }

    private fun parseWeights(json:String):Map<String,BigDecimal>? =
        runCatching {
            val obj=JSONObject(json)
            (1..7).associate { i ->
                val id="K"+i
                id to obj.getString(id).toBigDecimal()
            }
        }.getOrNull()

    private fun fingerprint(text:String)=MessageDigest.getInstance("SHA-256")
        .digest(text.toByteArray()).joinToString(""){"%02x".format(it)}

    private fun summary(
        status:String,
        candidate:String?,
        train:Int,
        validation:Int,
        test:Int,
        champion:String?,
        detail:String
    )=LearningPipelineSummary(status,candidate,train,validation,test,champion,detail)
}
