package io.aurum.aurumb

import io.aurum.aurumb.criteria.*
import io.aurum.aurumb.selection.*
import java.math.BigDecimal

private fun fullCandidate(symbol:String,score:String,risk:String="0")=
    CandidateEvidence(
        symbol,
        AurumBCriteriaCatalog.decision.associate{s->s.id to CriterionResult(s.id,BigDecimal(score),true)},
        BigDecimal(risk)
    )

fun selectionParityChecks() {
    val ranked=SelectionEngine().rank(listOf(
        fullCandidate("AAA","80","0"),
        fullCandidate("BBB","80","0.5"),
        fullCandidate("CCC","70","0")
    ))
    check(ranked.first().symbol=="AAA")
    val first=ranked.first()
    val expectedConsensus=first.rawWeightedScore.multiply(BigDecimal(".30"))
        .add(first.rankWeightedScore.multiply(BigDecimal(".70")))
    check(first.consensusScore.subtract(expectedConsensus).abs()<BigDecimal("0.0000001"))
    IntegrityValidator.validate(ranked)
    val tampered=ranked.map { row ->
        if(row.symbol=="AAA") row.copy(consensusScore=row.consensusScore+BigDecimal.ONE) else row
    }
    check(runCatching{IntegrityValidator.validate(tampered)}.exceptionOrNull()?.message=="consensus inconsistency")
    val b=ranked.first{it.symbol=="BBB"}
    check(b.score < b.consensusScore)
    check(b.contributions.all{it.criterionRank>0})
    check(b.contributions.all{it.rankScore in BigDecimal.ZERO..BigDecimal("100")})

    val low=ExecutionRisk.calculate(ExecutionRiskInput(
        estimatedCostPct=BigDecimal(".2"),participationPct=BigDecimal(".1"),
        limitUpRisk=false,upperWickPct=BigDecimal(".5"),dataQuality=BigDecimal("95"),provisionalDayRank=null
    ))
    val high=ExecutionRisk.calculate(ExecutionRiskInput(
        estimatedCostPct=BigDecimal("2"),participationPct=BigDecimal("2"),
        limitUpRisk=true,upperWickPct=BigDecimal("6"),dataQuality=BigDecimal("50"),provisionalDayRank=1
    ))
    check(high>low)
    check(high<=BigDecimal.ONE)

    val adaptiveRows=SelectionEngine().rank(listOf(
        fullCandidate("AAA","90","0.10"),
        fullCandidate("BBB","88","0.20"),
        fullCandidate("CCC","57","0.10"),
        fullCandidate("DDD","85","0.75")
    )).map { row ->
        AdaptiveCandidate(row,LegacyTargetProbability.prior(row.score),null)
    }
    val adaptive=AdaptiveSelector.select(
        adaptiveRows,
        AdaptiveSelectionPolicy(maxN=3),
        correlation={ a,b -> if(setOf(a,b)==setOf("AAA","BBB")) BigDecimal(".90") else BigDecimal.ZERO }
    )
    check(adaptive.selected.map{it.row.symbol}==listOf("AAA"))
    check(adaptive.rejected["BBB"]=="PAIRWISE_CORRELATION:AAA")
    check(adaptive.rejected["CCC"]=="MIN_SCORE,MIN_TARGET_PROBABILITY")
    check(adaptive.rejected["DDD"]?.contains("MAX_EXECUTION_RISK")==true)

    val p58=LegacyTargetProbability.prior(BigDecimal("58"))
    check(p58>=BigDecimal("0.04"))
}
