package com.aurum.bistterminal8

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant
import java.time.LocalDate

class AurumSchedulerTest {
    @Test fun weekendDefaultsAreSeparated() {
        assertEquals(listOf("12:30"), AurumScheduler.defaultTimesForDate(LocalDate.of(2026, 10, 3)))
    }

    @Test fun marketWeekendDefaultIsPlusThirty() {
        assertEquals(listOf("13:00"), AurumScheduler.defaultTimesForDate(LocalDate.of(2026, 10, 3), "market"))
    }

    @Test fun fridayLateSlotSkipsWeekendForWeekdayOnlyTime() {
        val after = Instant.parse("2026-10-02T20:31:00Z")
        assertEquals(Instant.parse("2026-10-05T20:30:00Z"), AurumScheduler.nextSlot("23:30", after))
    }

    @Test fun weekendSlotSchedulesOnSaturday() {
        val after = Instant.parse("2026-10-02T21:00:00Z")
        assertEquals(Instant.parse("2026-10-03T09:30:00Z"), AurumScheduler.nextSlot("12:30", after))
    }

    @Test fun customTimeRemainsValidAcrossWeekend() {
        val after = Instant.parse("2026-10-02T21:00:00Z")
        assertEquals(Instant.parse("2026-10-03T06:00:00Z"), AurumScheduler.nextSlot("09:00", after, custom=listOf("09:00")))
    }

    @Test fun invalidTimeHasNoNextSlot() {
        assertNull(AurumScheduler.nextSlot("25:00", Instant.parse("2026-10-02T20:00:00Z")))
    }
}
