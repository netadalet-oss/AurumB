package io.aurum.aurumb.formula

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

private val K10_MC=MathContext(18,RoundingMode.HALF_EVEN)

data class K10RewardEvent(
    val eventId:String,
    val predictedUniverseSize:Int,
    val realizedRanks:Map<String,Int>,
    val predictedCriterionRanks:Map<String,Map<String,Int>>
)

data class K10RewardMemory(
    val score:BigDecimal,
    val evidenceCount:Int,
    val memoryConfidence:BigDecimal
)

object K10RewardMemoryEngine {
    const val MAX_EVENTS:Int=30
    val MEMORY_DECAY:BigDecimal=BigDecimal("0.92")
    val MEMORY_PRIOR_WEIGHT:BigDecimal=BigDecimal("2")
    val PRIOR_SCORE:BigDecimal=BigDecimal("50")

    fun percentileQuality(rank:Int,n:Int):BigDecimal {
        require(rank>=1)
        require(n>=1)
        require(rank<=n)
        if(n==1) return BigDecimal.ONE
        return BigDecimal.ONE.subtract(
            BigDecimal(rank-1).divide(BigDecimal(n-1),K10_MC),
            K10_MC
        ).coerceIn(BigDecimal.ZERO,BigDecimal.ONE)
    }

    fun pairReward(predictedRank:Int,predictedN:Int,realizedRank:Int,realizedN:Int):BigDecimal {
        val predicted=percentileQuality(predictedRank,predictedN)
        val realized=percentileQuality(realizedRank,realizedN)
        val agreement=BigDecimal.ONE.subtract(predicted.subtract(realized,K10_MC).abs(),K10_MC)
            .coerceIn(BigDecimal.ZERO,BigDecimal.ONE)
        return BigDecimal("100").multiply(realized,K10_MC).multiply(agreement,K10_MC)
            .coerceIn(BigDecimal.ZERO,BigDecimal("100"))
    }

    fun eventScores(event:K10RewardEvent):Map<String,BigDecimal> {
        if(event.predictedUniverseSize<1 || event.realizedRanks.isEmpty()) return emptyMap()
        val realizedN=event.realizedRanks.size
        return event.predictedCriterionRanks.mapNotNull { (symbol,ranks) ->
            val realizedRank=event.realizedRanks[symbol] ?: return@mapNotNull null
            val rewards=(1..7).mapNotNull { k ->
                val predictedRank=ranks["K$k"] ?: return@mapNotNull null
                if(predictedRank !in 1..event.predictedUniverseSize || realizedRank !in 1..realizedN) return@mapNotNull null
                pairReward(predictedRank,event.predictedUniverseSize,realizedRank,realizedN)
            }
            if(rewards.size!=7) null
            else symbol to rewards.reduce{a,b->a.add(b,K10_MC)}
                .divide(BigDecimal(rewards.size),K10_MC)
        }.toMap()
    }

    /**
     * [eventsNewestFirst] must be locked, realized events ordered newest first.
     * Memory age is event age, not wall-clock age, matching the reference runtime.
     */
    fun memory(
        symbols:Set<String>,
        eventsNewestFirst:List<K10RewardEvent>
    ):Map<String,K10RewardMemory> {
        val events=eventsNewestFirst.take(MAX_EVENTS)
        val eventScores=events.map(::eventScores)
        return symbols.mapNotNull { symbol ->
            var weighted=BigDecimal.ZERO
            var weight=BigDecimal.ZERO
            var evidence=0
            eventScores.forEachIndexed { age,scores ->
                val score=scores[symbol] ?: return@forEachIndexed
                val w=MEMORY_DECAY.pow(age,K10_MC)
                weighted=weighted.add(score.multiply(w,K10_MC),K10_MC)
                weight=weight.add(w,K10_MC)
                evidence++
            }
            if(evidence==0) return@mapNotNull null
            val numerator=weighted.add(
                PRIOR_SCORE.multiply(MEMORY_PRIOR_WEIGHT,K10_MC),K10_MC
            )
            val denominator=weight.add(MEMORY_PRIOR_WEIGHT,K10_MC)
            val score=numerator.divide(denominator,K10_MC)
                .coerceIn(BigDecimal.ZERO,BigDecimal("100"))
            val confidence=if(weight.signum()==0) BigDecimal.ZERO
                else weight.divide(denominator,K10_MC).coerceIn(BigDecimal.ZERO,BigDecimal.ONE)
            symbol to K10RewardMemory(score,evidence,confidence)
        }.toMap()
    }
}
