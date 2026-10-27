package io.aurum.aurumb.calendar

import io.aurum.common.calendar.RuleBasedMarketCalendar
import java.time.LocalDate

data class CalendarDefinition(
    val market:String,
    val year:Int,
    val source:String,
    val sourceVersion:String,
    val calendar:RuleBasedMarketCalendar
)

object BistCalendarFactory {
    const val SOURCE="Borsa Istanbul official holidays"
    const val SOURCE_VERSION="2026-v1"

    fun create2026():RuleBasedMarketCalendar=create(2026).calendar

    fun create(year:Int):CalendarDefinition {
        require(year==2026) { "BIST_CALENDAR_YEAR_UNSUPPORTED" }
        val holidays=setOf(
            "2026-01-01","2026-03-20","2026-03-21","2026-03-22",
            "2026-04-23","2026-05-01","2026-05-19",
            "2026-05-27","2026-05-28","2026-05-29","2026-05-30",
            "2026-07-15","2026-08-30","2026-10-29"
        ).map(LocalDate::parse).toSet()
        val halfDays=setOf(
            "2026-03-19","2026-05-26","2026-10-28"
        ).map(LocalDate::parse).toSet()
        return CalendarDefinition(
            market="BIST",
            year=year,
            source=SOURCE,
            sourceVersion=SOURCE_VERSION,
            calendar=RuleBasedMarketCalendar(holidays,halfDays)
        )
    }
}
