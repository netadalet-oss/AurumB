package io.aurum.common.eligibility

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

private val EM_MC=MathContext(18,RoundingMode.HALF_EVEN)

/**
 * Canonical cross-product eligibility gate.
 *
 * An instrument is excluded from downstream calculation/evaluation whenever either
 * its current/instant move or its daily move has absolute magnitude above the active product threshold.
 * The exclusion is not sticky: later fresh observations at/below the threshold make the instrument
 * eligible again, subject to all other independent eligibility rules.
 *
 * Missing observations remain null and are never converted to zero.
 */
object ExtremeMoveEligibility {
    val MAX_ABS_MOVE_PCT:BigDecimal=BigDecimal("12.5")

    data class Decision(
        val eligible:Boolean,
        val currentMovePct:BigDecimal?,
        val dailyMovePct:BigDecimal?,
        val reasons:List<String>
    )

    fun percentChange(current:BigDecimal?,base:BigDecimal?):BigDecimal? {
        if(current==null || base==null || current<=BigDecimal.ZERO || base<=BigDecimal.ZERO) return null
        return current.divide(base,EM_MC)
            .subtract(BigDecimal.ONE,EM_MC)
            .multiply(BigDecimal("100"),EM_MC)
    }

    fun assess(
        currentMovePct:BigDecimal?,
        dailyMovePct:BigDecimal?,
        maxAbsMovePct:BigDecimal=MAX_ABS_MOVE_PCT
    ):Decision {
        require(maxAbsMovePct>BigDecimal.ZERO)
        val label=maxAbsMovePct.stripTrailingZeros().toPlainString().replace(".","_")
        val reasons=buildList {
            if(currentMovePct?.abs()?.let{it>maxAbsMovePct}==true) add("CURRENT_MOVE_GT_"+label)
            if(dailyMovePct?.abs()?.let{it>maxAbsMovePct}==true) add("DAILY_MOVE_GT_"+label)
        }
        return Decision(reasons.isEmpty(),currentMovePct,dailyMovePct,reasons)
    }
}
