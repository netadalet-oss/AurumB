package io.aurum.aurumb

import io.aurum.common.calendar.RuleBasedMarketCalendar
import java.time.LocalDate

fun calendarChecks() {
    val cal=RuleBasedMarketCalendar(
        holidays=setOf(LocalDate.parse("2026-01-01")),
        halfDays=setOf(LocalDate.parse("2026-10-28"))
    )
    check(!cal.isOpen(LocalDate.parse("2026-01-01")))
    check(!cal.isOpen(LocalDate.parse("2026-10-03")))
    check(cal.isOpen(LocalDate.parse("2026-10-02")))
    check(cal.isHalfDay(LocalDate.parse("2026-10-28")))
    check(cal.tradingDaysBetween(LocalDate.parse("2026-10-01"),LocalDate.parse("2026-10-05"))==2)
}
