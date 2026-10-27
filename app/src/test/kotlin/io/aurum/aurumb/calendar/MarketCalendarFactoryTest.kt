package io.aurum.aurumb.calendar

import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

class MarketCalendarFactoryTest {
    @Test
    fun official2026CalendarsRespectClosuresAndHalfDays() {
        val bist=BistCalendarFactory.create(2026)
        assertEquals("BIST",bist.market)
        assertFalse(bist.calendar.isOpen(LocalDate.parse("2026-10-29")))
        assertTrue(bist.calendar.isHalfDay(LocalDate.parse("2026-10-28")))

        val ams=EuronextAmsterdamCalendarFactory.create(2026)
        assertEquals("EURONEXT_AMSTERDAM",ams.market)
        assertFalse(ams.calendar.isOpen(LocalDate.parse("2026-04-03")))
        assertFalse(ams.calendar.isOpen(LocalDate.parse("2026-12-25")))
        assertTrue(ams.calendar.isHalfDay(LocalDate.parse("2026-12-24")))
        assertTrue(ams.calendar.isOpen(LocalDate.parse("2026-05-25")))
    }

    @Test
    fun unsupportedYearFailsClosed() {
        assertThrows(IllegalArgumentException::class.java) { BistCalendarFactory.create(2027) }
        assertThrows(IllegalArgumentException::class.java) { EuronextAmsterdamCalendarFactory.create(2027) }
    }
}
