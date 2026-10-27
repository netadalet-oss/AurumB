package io.aurum.aurumb

import io.aurum.aurumb.portfolio.*
import java.math.BigDecimal

fun portfolioMetricsChecks() {
    val m=PortfolioMetrics.calculate(
        listOf(
            ClosedTradeMetric(BigDecimal("100"),BigDecimal("1000")),
            ClosedTradeMetric(BigDecimal("-50"),BigDecimal("1000"))
        ),
        listOf(EquityPoint(BigDecimal("1000")),EquityPoint(BigDecimal("1200")),EquityPoint(BigDecimal("900"))),
        BigDecimal("4000"),
        BigDecimal("1000")
    )
    check(m.realizedPnl==BigDecimal("50"))
    check(m.maximumDrawdown==BigDecimal("0.25"))
    check(m.hitRate==BigDecimal("0.5"))
    check(m.expectancy==BigDecimal("25"))
    check(m.turnover==BigDecimal("4"))
}
