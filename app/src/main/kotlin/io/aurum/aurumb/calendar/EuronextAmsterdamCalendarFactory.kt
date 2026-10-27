package io.aurum.aurumb.calendar

import io.aurum.common.calendar.RuleBasedMarketCalendar
import java.time.LocalDate

object EuronextAmsterdamCalendarFactory {
    const val SOURCE="Euronext Trading Hours & Holidays"
    const val SOURCE_VERSION="2026-v1"

    fun create(year:Int):CalendarDefinition {
        require(year==2026) { "EURONEXT_AMSTERDAM_CALENDAR_YEAR_UNSUPPORTED" }
        val holidays=setOf(
            "2026-01-01",
            "2026-04-03",
            "2026-04-06",
            "2026-05-01",
            "2026-12-25"
        ).map(LocalDate::parse).toSet()
        val halfDays=setOf(
            "2026-12-24",
            "2026-12-31"
        ).map(LocalDate::parse).toSet()
        return CalendarDefinition(
            market="EURONEXT_AMSTERDAM",
            year=year,
            source=SOURCE,
            sourceVersion=SOURCE_VERSION,
            calendar=RuleBasedMarketCalendar(holidays,halfDays)
        )
    }
}
