package io.aurum.common.calendar

import java.time.DayOfWeek
import java.time.LocalDate

interface MarketCalendar {
    fun isOpen(date:LocalDate):Boolean
    fun isHalfDay(date:LocalDate):Boolean
    fun tradingDaysBetween(fromExclusive:LocalDate,toInclusive:LocalDate):Int
}

class RuleBasedMarketCalendar(
    private val holidays:Set<LocalDate>,
    private val halfDays:Set<LocalDate> = emptySet(),
    private val overrides:Map<LocalDate,Boolean> = emptyMap()
):MarketCalendar {
    override fun isOpen(date:LocalDate):Boolean {
        overrides[date]?.let{return it}
        if(date.dayOfWeek==DayOfWeek.SATURDAY || date.dayOfWeek==DayOfWeek.SUNDAY) return false
        return date !in holidays
    }
    override fun isHalfDay(date:LocalDate):Boolean = isOpen(date) && date in halfDays
    override fun tradingDaysBetween(fromExclusive:LocalDate,toInclusive:LocalDate):Int {
        if(toInclusive<=fromExclusive) return 0
        var d=fromExclusive.plusDays(1)
        var n=0
        while(!d.isAfter(toInclusive)) {
            if(isOpen(d)) n++
            d=d.plusDays(1)
        }
        return n
    }
}
