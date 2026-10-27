package io.aurum.aurumb

import io.aurum.aurumb.formula.K10RewardEvent
import io.aurum.aurumb.formula.K10RewardMemoryEngine
import java.math.BigDecimal

fun k10RewardMemoryChecks() {
    check(K10RewardMemoryEngine.percentileQuality(1,5)==BigDecimal.ONE)
    check(K10RewardMemoryEngine.percentileQuality(5,5)==BigDecimal.ZERO)

    val perfect=K10RewardMemoryEngine.pairReward(1,5,1,5)
    val inverted=K10RewardMemoryEngine.pairReward(5,5,1,5)
    check(perfect.compareTo(BigDecimal("100"))==0)
    check(inverted.compareTo(BigDecimal.ZERO)==0)

    val event=K10RewardEvent(
        eventId="E1",
        predictedUniverseSize=5,
        realizedRanks=mapOf("AAA" to 1,"BBB" to 2),
        predictedCriterionRanks=mapOf(
            "AAA" to (1..7).associate{"K$it" to 1},
            "BBB" to (1..7).associate{"K$it" to 5}
        )
    )
    val scores=K10RewardMemoryEngine.eventScores(event)
    check(scores.getValue("AAA").compareTo(BigDecimal("100"))==0)
    check(scores.getValue("BBB").compareTo(BigDecimal.ZERO)==0)

    val memory=K10RewardMemoryEngine.memory(setOf("AAA","NONE"),listOf(event))
    check(memory.getValue("AAA").score>BigDecimal("50"))
    check(memory.getValue("AAA").evidenceCount==1)
    check(memory.getValue("AAA").memoryConfidence>BigDecimal.ZERO)
    check("NONE" !in memory)
    check(K10RewardMemoryEngine.memory(setOf("AAA"),emptyList()).isEmpty())

    val oldGood=event.copy(eventId="OLD")
    val recentBad=event.copy(
        eventId="NEW",
        realizedRanks=mapOf("AAA" to 2,"BBB" to 1)
    )
    val weighted=K10RewardMemoryEngine.memory(setOf("AAA"),listOf(recentBad,oldGood)).getValue("AAA")
    check(weighted.score<BigDecimal("50"))
}
