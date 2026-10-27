package io.aurum.aurumb

import io.aurum.aurumb.selection.*
import java.math.BigDecimal

private fun adaptiveCandidate(symbol:String,score:String,risk:String)=
    io.aurum.aurumb.selection.CandidateEvidence(
        symbol,
        io.aurum.aurumb.criteria.AurumBCriteriaCatalog.decision.associate { spec ->
            spec.id to io.aurum.aurumb.criteria.CriterionResult(spec.id,BigDecimal(score),true)
        },
        BigDecimal(risk)
    )

fun adaptiveSelectionChecks() {
    check(LegacyTargetProbability.prior(BigDecimal("76")) > BigDecimal("0.15"))
    check(LegacyTargetProbability.prior(BigDecimal("0")) >= BigDecimal("0.02"))
    check(LegacyTargetProbability.prior(BigDecimal("100")) <= BigDecimal("0.35"))

    val rows=SelectionEngine().rank(listOf(
        adaptiveCandidate("AAA","90","0.10"),
        adaptiveCandidate("BBB","88","0.10"),
        adaptiveCandidate("CCC","50","0.10"),
        adaptiveCandidate("DDD","85","0.90")
    ))
    val candidates=rows.map {
        AdaptiveCandidate(it,LegacyTargetProbability.prior(it.score),if(it.symbol in setOf("AAA","BBB"))"BANK" else null)
    }
    val result=AdaptiveSelector.select(
        candidates,
        AdaptiveSelectionPolicy(maxN=3,sectorMaxPct=BigDecimal("0.34")),
    ) { a,b -> if(setOf(a,b)==setOf("AAA","BBB")) BigDecimal("0.90") else BigDecimal.ZERO }

    check(result.selected.any{it.row.symbol=="AAA"})
    check(result.rejected["BBB"]?.startsWith("PAIRWISE_CORRELATION")==true)
    check(result.rejected["CCC"]?.contains("MIN_SCORE")==true)
    check(result.rejected["DDD"]?.contains("MAX_EXECUTION_RISK")==true)
}
