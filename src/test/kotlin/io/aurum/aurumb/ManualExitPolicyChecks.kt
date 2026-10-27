package io.aurum.aurumb

import io.aurum.aurumb.signal.QualifiedTradeLifecycle
import io.aurum.aurumb.signal.QualifiedTradePolicy
import java.math.BigDecimal

fun manualExitPolicyChecks() {
    val policy=QualifiedTradePolicy(
        maxStopLossPct=BigDecimal("3"),
        profitLockStartPct=BigDecimal("5"),
        profitLockInitialPullbackPct=BigDecimal("2"),
        profitLockStepStartPct=BigDecimal("20"),
        profitLockStepSizePct=BigDecimal("10"),
        profitLockStepPullbackPct=BigDecimal("2")
    )
    check(QualifiedTradeLifecycle.manualExitReason(
        BigDecimal("100"),BigDecimal("96"),BigDecimal("97"),BigDecimal("100"),policy
    )=="ZARAR_KES")
    check(QualifiedTradeLifecycle.manualExitReason(
        BigDecimal("100"),BigDecimal("103"),BigDecimal("97"),BigDecimal("110"),policy
    )=="KAR_KILIDI")
    check(QualifiedTradeLifecycle.manualExitReason(
        BigDecimal("100"),BigDecimal("109"),BigDecimal("97"),BigDecimal("110"),policy
    )=="MANUAL_PRODUCT_CARD")
}
