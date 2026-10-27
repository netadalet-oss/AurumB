package io.aurum.common.quality

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

data class TransferQualityDecision(
    val successful:Int,
    val expected:Int,
    val ratio:BigDecimal,
    val acceptedThresholdPct:Int?,
    val evaluatedThresholdsPct:List<Int>
) {
    val accepted:Boolean get()=acceptedThresholdPct!=null
}

object TransferQualityLadder {
    private val MC=MathContext(18,RoundingMode.HALF_EVEN)
    val thresholdsPct=listOf(100,95,90,80,70)

    fun evaluate(
        successful:Int,
        expected:Int,
        thresholds:List<Int> = thresholdsPct
    ):TransferQualityDecision {
        require(expected>0)
        require(successful in 0..expected)
        require(thresholds.isNotEmpty())
        require(thresholds.all{it in 1..100})
        require(thresholds.zipWithNext().all{(a,b)->a>b})
        val ratio=BigDecimal(successful).divide(BigDecimal(expected),MC)
        val evaluated=mutableListOf<Int>()
        var accepted:Int?=null
        for(t in thresholds) {
            evaluated+=t
            val threshold=BigDecimal(t).divide(BigDecimal("100"),MC)
            if(ratio>=threshold) {
                accepted=t
                break
            }
        }
        return TransferQualityDecision(successful,expected,ratio,accepted,evaluated)
    }
}
