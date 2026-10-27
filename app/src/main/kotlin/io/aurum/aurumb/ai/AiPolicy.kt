package io.aurum.aurumb.ai

import io.aurum.common.ai.AiAdvisory
import java.math.BigDecimal

data class AiCandidateReview(
    val accepted:Boolean,
    val reasons:List<String>,
    val proposedWeights:Map<String,BigDecimal>?
)

object AiPolicy {
    fun review(advisory:AiAdvisory):AiCandidateReview {
        val raw=advisory.candidateWeights ?: return AiCandidateReview(false,listOf("no weight proposal"),null)
        if(raw.keys != (1..7).map{"K$it"}.toSet()) return AiCandidateReview(false,listOf("proposal must contain K1-K7 only"),null)
        val weights=raw.mapValues { BigDecimal.valueOf(it.value) }
        if(weights.values.any{it<BigDecimal("0.05") || it>BigDecimal("0.30")})
            return AiCandidateReview(false,listOf("weight outside floor/ceiling"),null)
        val sum=weights.values.fold(BigDecimal.ZERO,BigDecimal::add)
        if(sum.subtract(BigDecimal.ONE).abs()>BigDecimal("0.00001"))
            return AiCandidateReview(false,listOf("weights do not sum to one"),null)
        return AiCandidateReview(false,listOf("AI proposals are advisory; deterministic validation required before challenger creation"),weights)
    }
}
