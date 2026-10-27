package io.aurum.aurumb

import io.aurum.common.eligibility.ExtremeMoveEligibility
import java.math.BigDecimal

fun extremeMoveEligibilityChecks() {
    check(ExtremeMoveEligibility.MAX_ABS_MOVE_PCT.compareTo(BigDecimal("12.5"))==0)

    val atBoundary=ExtremeMoveEligibility.assess(
        currentMovePct=BigDecimal("12.5"),
        dailyMovePct=BigDecimal("-12.5")
    )
    check(atBoundary.eligible)
    check(atBoundary.reasons.isEmpty())

    val currentBlocked=ExtremeMoveEligibility.assess(
        currentMovePct=BigDecimal("12.5001"),
        dailyMovePct=BigDecimal.ZERO
    )
    check(!currentBlocked.eligible)
    check(currentBlocked.reasons==listOf("CURRENT_MOVE_GT_12_5"))

    val dailyBlocked=ExtremeMoveEligibility.assess(
        currentMovePct=BigDecimal.ZERO,
        dailyMovePct=BigDecimal("-12.6")
    )
    check(!dailyBlocked.eligible)
    check(dailyBlocked.reasons==listOf("DAILY_MOVE_GT_12_5"))

    val bothBlocked=ExtremeMoveEligibility.assess(
        currentMovePct=BigDecimal("13"),
        dailyMovePct=BigDecimal("-14")
    )
    check(!bothBlocked.eligible)
    check(bothBlocked.reasons==listOf("CURRENT_MOVE_GT_12_5","DAILY_MOVE_GT_12_5"))

    val reentered=ExtremeMoveEligibility.assess(
        currentMovePct=BigDecimal("12.49"),
        dailyMovePct=BigDecimal("-12.49")
    )
    check(reentered.eligible)

    val unknownInstant=ExtremeMoveEligibility.assess(
        currentMovePct=null,
        dailyMovePct=BigDecimal("5")
    )
    check(unknownInstant.eligible)

    check(ExtremeMoveEligibility.percentChange(BigDecimal("112.5"),BigDecimal("100"))?.compareTo(BigDecimal("12.5"))==0)
    check(ExtremeMoveEligibility.percentChange(BigDecimal.ZERO,BigDecimal("100"))==null)
    check(ExtremeMoveEligibility.percentChange(BigDecimal("100"),BigDecimal.ZERO)==null)
    check(!ExtremeMoveEligibility.assess(
        BigDecimal("10.1"),null,BigDecimal("10")
    ).eligible)
    check(ExtremeMoveEligibility.assess(
        BigDecimal("10.0"),null,BigDecimal("10")
    ).eligible)
}
