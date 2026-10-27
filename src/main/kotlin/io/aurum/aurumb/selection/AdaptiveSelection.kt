package io.aurum.aurumb.selection

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import kotlin.math.ceil
import kotlin.math.exp

private val ASP_MC=MathContext(18,RoundingMode.HALF_EVEN)

data class AdaptiveSelectionPolicy(
    val enabled:Boolean=true,
    val maxN:Int=20,
    val minScore:BigDecimal=BigDecimal("58"),
    val minTargetProbability:BigDecimal=BigDecimal("0.04"),
    val maxExecutionRisk:BigDecimal=BigDecimal("0.70"),
    val sectorMaxPct:BigDecimal=BigDecimal("0.20"),
    val pairwiseMaxCorr:BigDecimal=BigDecimal("0.80")
) {
    init {
        require(maxN in 1..20)
        require(minScore in BigDecimal.ZERO..BigDecimal("100"))
        require(minTargetProbability in BigDecimal.ZERO..BigDecimal.ONE)
        require(maxExecutionRisk in BigDecimal.ZERO..BigDecimal.ONE)
        require(sectorMaxPct>BigDecimal.ZERO && sectorMaxPct<=BigDecimal.ONE)
        require(pairwiseMaxCorr>=BigDecimal("-1") && pairwiseMaxCorr<=BigDecimal.ONE)
    }
}

data class AdaptiveCandidate(
    val row:SelectionRow,
    val targetProbability:BigDecimal,
    val sector:String?=null
)

data class AdaptiveSelectionResult(
    val selected:List<AdaptiveCandidate>,
    val rejected:Map<String,String>
)

object LegacyTargetProbability {
    fun prior(score:BigDecimal):BigDecimal {
        val x=(score.toDouble()-76.0)/7.0
        val sigmoid=1.0/(1.0+exp(-x))
        return BigDecimal.valueOf(0.025+0.28*sigmoid)
            .coerceIn(BigDecimal("0.02"),BigDecimal("0.35"))
    }
}

object AdaptiveSelector {
    fun select(
        ranked:List<AdaptiveCandidate>,
        policy:AdaptiveSelectionPolicy,
        correlation:(String,String)->BigDecimal?
    ):AdaptiveSelectionResult {
        require(ranked.map{it.row.symbol}.distinct().size==ranked.size)
        val selected=mutableListOf<AdaptiveCandidate>()
        val rejected=linkedMapOf<String,String>()
        val sectorCounts=mutableMapOf<String,Int>()
        val sectorCap=ceil(policy.maxN*policy.sectorMaxPct.toDouble()).toInt().coerceAtLeast(1)

        for(candidate in ranked) {
            val symbol=candidate.row.symbol
            if(selected.size>=policy.maxN) {
                rejected[symbol]="TOP_N_CAP"
                continue
            }
            if(policy.enabled) {
                val hardReasons=buildList {
                    if(candidate.row.score<policy.minScore) add("MIN_SCORE")
                    if(candidate.targetProbability<policy.minTargetProbability) add("MIN_TARGET_PROBABILITY")
                    if(candidate.row.executionRisk>policy.maxExecutionRisk) add("MAX_EXECUTION_RISK")
                }
                if(hardReasons.isNotEmpty()) {
                    rejected[symbol]=hardReasons.joinToString(",")
                    continue
                }
            }

            val sector=candidate.sector?.trim()?.takeIf{it.isNotEmpty() && it!="BILINMIYOR"}
            if(sector!=null && (sectorCounts[sector]?:0)>=sectorCap) {
                rejected[symbol]="SECTOR_CAP"
                continue
            }

            val blockedBy=selected.firstOrNull { prior ->
                correlation(symbol,prior.row.symbol)?.let{it>policy.pairwiseMaxCorr}==true
            }
            if(blockedBy!=null) {
                rejected[symbol]="PAIRWISE_CORRELATION:"+blockedBy.row.symbol
                continue
            }

            selected+=candidate
            if(sector!=null) sectorCounts[sector]=(sectorCounts[sector]?:0)+1
        }

        return AdaptiveSelectionResult(selected.toList(),rejected.toMap())
    }
}
