package io.aurum.aurumb.selection

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

private val ER_MC=MathContext(18,RoundingMode.HALF_EVEN)

data class ExecutionRiskInput(
    val estimatedCostPct:BigDecimal?,
    val participationPct:BigDecimal?,
    val maxParticipationPct:BigDecimal=BigDecimal("2"),
    val limitUpRisk:Boolean,
    val upperWickPct:BigDecimal?,
    val dataQuality:BigDecimal?,
    val provisionalDayRank:Int?
)

object ExecutionRisk {
    private fun clamp(v:BigDecimal)=v.coerceIn(BigDecimal.ZERO,BigDecimal.ONE)

    fun calculate(x:ExecutionRiskInput):BigDecimal {
        require(x.maxParticipationPct>BigDecimal.ZERO)
        val cost=clamp((x.estimatedCostPct?:BigDecimal.ZERO).divide(BigDecimal("2"),ER_MC))
        val participation=clamp((x.participationPct?:BigDecimal.ZERO).divide(x.maxParticipationPct,ER_MC))
        val limit=if(x.limitUpRisk)BigDecimal.ONE else BigDecimal.ZERO
        val wick=clamp((x.upperWickPct?:BigDecimal.ZERO).divide(BigDecimal("6"),ER_MC))
        val quality=(x.dataQuality?:BigDecimal("50")).divide(BigDecimal("100"),ER_MC).coerceIn(BigDecimal.ZERO,BigDecimal.ONE)
        val chase=x.provisionalDayRank?.takeIf{it in 1..20}?.let { rank ->
            val bonus=BigDecimal(21-rank).divide(BigDecimal("20"),ER_MC)
            BigDecimal(".5").add(BigDecimal(".5").multiply(bonus,ER_MC),ER_MC).coerceIn(BigDecimal(".5"),BigDecimal.ONE)
        }?:BigDecimal.ZERO
        return BigDecimal(".26").multiply(cost,ER_MC)
            .add(BigDecimal(".18").multiply(participation,ER_MC),ER_MC)
            .add(BigDecimal(".16").multiply(limit,ER_MC),ER_MC)
            .add(BigDecimal(".12").multiply(wick,ER_MC),ER_MC)
            .add(BigDecimal(".10").multiply(BigDecimal.ONE.subtract(quality,ER_MC),ER_MC),ER_MC)
            .add(BigDecimal(".18").multiply(chase,ER_MC),ER_MC)
            .coerceIn(BigDecimal.ZERO,BigDecimal.ONE)
    }
}
