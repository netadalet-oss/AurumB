package io.aurum.aurumb.pipeline

import java.math.BigDecimal

data class PipelineSettings(
    val minPrice:BigDecimal=BigDecimal("0.5"),
    val minMedianTurnover21:BigDecimal=BigDecimal("5000000"),
    val minMedianVolume21:BigDecimal=BigDecimal.ZERO,
    val qualityMin:Int=60,
    val maxParticipationPct:BigDecimal=BigDecimal("2"),
    val maxDailyMovePct:BigDecimal=BigDecimal("12.5"),
    val dataCellCompletenessPct:BigDecimal=BigDecimal("70"),
    val transferQualityThresholdsPct:List<Int> = listOf(100,95,90,80,70),
    val providerRetryCount:Int=5,
    val sfContinuousMinutes:Int=240,
    val sfFinalWindowMinutes:Int=120,
    val sfPostOpenMinutes:Int=120,
    val maxStopLossPct:BigDecimal=BigDecimal("3"),
    val technicalStopAtrMultiplier:BigDecimal=BigDecimal("1.5"),
    val technicalStopFallbackPct:BigDecimal=BigDecimal("5"),
    val technicalStopSupportBufferPct:BigDecimal=BigDecimal("0.5"),
    val profitLockStartPct:BigDecimal=BigDecimal("5"),
    val profitLockInitialPullbackPct:BigDecimal=BigDecimal("2"),
    val profitLockStepStartPct:BigDecimal=BigDecimal("20"),
    val profitLockStepSizePct:BigDecimal=BigDecimal("10"),
    val profitLockStepPullbackPct:BigDecimal=BigDecimal("2"),
    val topN:Int=20,
    val adaptiveSelection:Boolean=true,
    val minSelectionScore:BigDecimal=BigDecimal("58"),
    val minTargetProbability:BigDecimal=BigDecimal("0.04"),
    val maxExecutionRisk:BigDecimal=BigDecimal("0.70"),
    val sectorMaxPct:BigDecimal=BigDecimal("0.20"),
    val pairwiseMaxCorr:BigDecimal=BigDecimal("0.80"),
    val targetReturnPct:BigDecimal=BigDecimal("5"),
    val crossSectionalTargetPct:BigDecimal=BigDecimal("0.05"),
    val learningHalfLifeDays:Int=20,
    val behaviorLookbackDays:Int=252,
    val behaviorMinSamples:Int=40,
    val behaviorLifetimeWeight:BigDecimal=BigDecimal("0.30"),
    val genomeLookbackDays:Int=252,
    val genomeNearestNeighbors:Int=40,
    val genomeMinAnalogs:Int=20,
    val genomePriorStrength:BigDecimal=BigDecimal("16"),
    val genomeHistoryDays:Int=400,
    val lookbackDays:Long=450,
    val commissionBps:BigDecimal=BigDecimal("8"),
    val slippageBps:BigDecimal=BigDecimal("12"),
    val assumedPositionTRY:BigDecimal=BigDecimal("100000")
) {
    init {
        require(minPrice>=BigDecimal.ZERO)
        require(minMedianTurnover21>=BigDecimal.ZERO)
        require(minMedianVolume21>=BigDecimal.ZERO)
        require(qualityMin in 0..100)
        require(maxParticipationPct>BigDecimal.ZERO)
        require(maxDailyMovePct>BigDecimal.ZERO)
        require(dataCellCompletenessPct in BigDecimal("1")..BigDecimal("100"))
        require(transferQualityThresholdsPct.isNotEmpty())
        require(transferQualityThresholdsPct.all{it in 1..100})
        require(transferQualityThresholdsPct.zipWithNext().all{(a,b)->a>b})
        require(providerRetryCount in 1..10)
        require(sfContinuousMinutes in 1..1440)
        require(sfFinalWindowMinutes in 1..480)
        require(sfPostOpenMinutes in 1..480)
        require(technicalStopAtrMultiplier>BigDecimal.ZERO)
        require(technicalStopFallbackPct>BigDecimal.ZERO && technicalStopFallbackPct<BigDecimal("100"))
        require(technicalStopSupportBufferPct>=BigDecimal.ZERO && technicalStopSupportBufferPct<BigDecimal("100"))
        require(maxStopLossPct>BigDecimal.ZERO && maxStopLossPct<=BigDecimal("50"))
        require(profitLockStartPct>BigDecimal.ZERO)
        require(profitLockInitialPullbackPct>BigDecimal.ZERO)
        require(profitLockStepStartPct>=profitLockStartPct)
        require(profitLockStepSizePct>BigDecimal.ZERO)
        require(profitLockStepPullbackPct>BigDecimal.ZERO)
        require(topN in 1..20)
        require(minSelectionScore in BigDecimal.ZERO..BigDecimal("100"))
        require(minTargetProbability in BigDecimal.ZERO..BigDecimal.ONE)
        require(maxExecutionRisk in BigDecimal.ZERO..BigDecimal.ONE)
        require(sectorMaxPct in BigDecimal("0.05")..BigDecimal.ONE)
        require(pairwiseMaxCorr in BigDecimal("-1")..BigDecimal.ONE)
        require(targetReturnPct>BigDecimal.ZERO)
        require(crossSectionalTargetPct>BigDecimal.ZERO && crossSectionalTargetPct<=BigDecimal.ONE)
        require(learningHalfLifeDays>0)
        require(behaviorLookbackDays in 21..2000)
        require(behaviorMinSamples in 1..1000)
        require(behaviorLifetimeWeight in BigDecimal.ZERO..BigDecimal("0.6"))
        require(genomeLookbackDays in 63..2000)
        require(genomeNearestNeighbors in 5..500)
        require(genomeMinAnalogs in 1..500)
        require(genomePriorStrength in BigDecimal.ZERO..BigDecimal("500"))
        require(genomeHistoryDays in 30..5000)
        require(lookbackDays>=120)
        require(commissionBps>=BigDecimal.ZERO)
        require(slippageBps>=BigDecimal.ZERO)
        require(assumedPositionTRY>BigDecimal.ZERO)
    }
}
