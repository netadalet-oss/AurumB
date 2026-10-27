package io.aurum.aurumb

import io.aurum.aurumb.signal.QualifiedTradeLifecycle
import java.time.LocalDate

fun tradingSessionCountChecks() {
    val buy=LocalDate.of(2026,3,18)
    val halfDay=LocalDate.of(2026,3,19)
    val normal=LocalDate.of(2026,3,20)
    val current=LocalDate.of(2026,3,23)
    val open=setOf(halfDay,normal)
    val count=QualifiedTradeLifecycle.completedTradingSessionsSinceBuy(
        dates=listOf(halfDay,halfDay,normal),
        buyDate=buy,
        currentDate=current,
        isOpen={it in open}
    )
    check(count==2) { "Half trading day must count as one completed session; got "+count }
    check(QualifiedTradeLifecycle.completedTradingSessionsSinceBuy(
        dates=listOf(halfDay),buyDate=buy,currentDate=normal,isOpen={it in open}
    )==1)
}
