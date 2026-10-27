package io.aurum.aurumb

import io.aurum.aurumb.criteria.AurumBCriteriaCatalog
import io.aurum.aurumb.learning.*
import java.math.BigDecimal
import java.time.Instant

fun deterministicLearningChecks() {
    val ids=AurumBCriteriaCatalog.decision.map{it.id}
    val start=Instant.parse("2026-01-01T00:00:00Z")
    val samples=(0 until 40).map { i ->
        LearningSample(
            id="s"+i,
            decisionAt=start.plusSeconds(i*86400L),
            realizedAt=start.plusSeconds((i+5)*86400L),
            criterionScores=ids.associateWith { id ->
                val base=50 + ((i + id.drop(1).toInt()*3) % 35)
                BigDecimal(base)
            },
            netReturn=BigDecimal(if(i%3==0)"0.03" else "0.01"),
            regime=listOf("TREND","RISK_ON","VOLATILE")[i%3]
        )
    }
    val future=LearningSample(
        id="future",
        decisionAt=start.plusSeconds(10*86400L),
        realizedAt=start.plusSeconds(1000*86400L),
        criterionScores=ids.associateWith{BigDecimal("100")},
        netReturn=BigDecimal("1"),
        regime="TREND"
    )
    val asOf=start.plusSeconds(100*86400L)
    val learned=DeterministicWeightLearner.learn(
        samples+future,
        asOf,
        WeightLearningPolicy(minSamples=30)
    ) ?: error("learner unexpectedly returned null")

    check("future" !in learned.usedSampleIds)
    check(learned.sampleCount==40)
    check(learned.regimeCount==3)
    check(learned.proposal.weights.keys==ids.toSet())
    check(learned.proposal.weights.values.all{it>=BigDecimal("0.05") && it<=BigDecimal("0.30")})
    check(learned.proposal.weights.values.fold(BigDecimal.ZERO,BigDecimal::add)
        .subtract(BigDecimal.ONE).abs()<=BigDecimal("0.000000000001"))

    val tooFew=DeterministicWeightLearner.learn(samples.take(10),asOf,WeightLearningPolicy(minSamples=30))
    check(tooFew==null)
}
