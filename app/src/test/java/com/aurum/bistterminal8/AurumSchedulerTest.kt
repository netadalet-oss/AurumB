package com.aurum.bistterminal8

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate

class AurumSchedulerTest {
    @Test fun weekendDefaultsAreSeparated() =
        assertEquals(listOf("12:30"), AurumScheduler.defaultTimesForDate(LocalDate.of(2026, 10, 3)))

    @Test fun marketWeekendDefaultIsPlusThirty() =
        assertEquals(listOf("13:00"), AurumScheduler.defaultTimesForDate(LocalDate.of(2026, 10, 3), "market"))

    @Test fun weekdayDefaultsRemainCanonical() =
        assertEquals(listOf("00:30","04:30","08:20","09:20","10:20","11:20","12:20","13:20","14:20","15:20","16:20","17:20","18:20","19:20","20:30","21:30","22:30","23:30"), AurumScheduler.defaultTimesForDate(LocalDate.of(2026, 10, 5)))

    @Test fun marketWeekdayDefaultsRemainPlusThirty() {
        val xs=AurumScheduler.defaultTimesForDate(LocalDate.of(2026, 10, 5), "market")
        assertEquals("01:00", xs.first()); assertEquals("00:00", xs.last())
    }

    @Test fun fridayLateSlotSkipsWeekendForWeekdayOnlyTime() =
        assertEquals(Instant.parse("2026-10-05T20:30:00Z"), AurumScheduler.nextSlot("23:30", Instant.parse("2026-10-02T20:31:00Z")))

    @Test fun weekendSlotSchedulesOnSaturday() =
        assertEquals(Instant.parse("2026-10-03T09:30:00Z"), AurumScheduler.nextSlot("12:30", Instant.parse("2026-10-02T21:00:00Z")))

    @Test fun customTimeRemainsValidAcrossWeekend() =
        assertEquals(Instant.parse("2026-10-03T06:00:00Z"), AurumScheduler.nextSlot("09:00", Instant.parse("2026-10-02T21:00:00Z"), custom=listOf("09:00")))

    @Test fun customListRejectsTimeOutsideConfiguredSet() =
        assertNull(AurumScheduler.nextSlot("10:00", Instant.parse("2026-10-05T05:00:00Z"), custom=listOf("09:00")))

    @Test fun validAndMalformedTimesAreDistinguished() {
        assertTrue(AurumScheduler.valid("00:00")); assertFalse(AurumScheduler.valid("9:20")); assertFalse(AurumScheduler.valid("25:00"))
    }

    @Test fun exactBoundaryMovesToNextEligibleDay() =
        assertEquals(Instant.parse("2026-10-06T20:30:00Z"), AurumScheduler.nextSlot("23:30", Instant.parse("2026-10-05T20:30:00Z")))
    @Test fun marketWeekdayTimeUsesPlusThirty() {
        assertEquals(listOf("01:00","05:00","08:50","09:50","10:50","11:50","12:50","13:50","14:50","15:50","16:50","17:50","18:50","19:50","21:00","22:00","23:00","00:00"), AurumScheduler.defaultTimesForDate(LocalDate.of(2026, 10, 2), "market"))
    }

    @Test fun sundayWeekdayOnlyTimeMovesToMonday() {
        val after = Instant.parse("2026-10-04T08:00:00Z")
        assertEquals(Instant.parse("2026-10-05T06:20:00Z"), AurumScheduler.nextSlot("09:20", after))
    }

    @Test fun customTimeCanScheduleSameDay() {
        val after = Instant.parse("2026-10-03T05:00:00Z")
        assertEquals(Instant.parse("2026-10-03T06:00:00Z"), AurumScheduler.nextSlot("09:00", after, custom=listOf("09:00")))
    }

    @Test fun timeOutsideCustomListHasNoSlot() {
        assertNull(AurumScheduler.nextSlot("09:00", Instant.parse("2026-10-03T05:00:00Z"), custom=listOf("10:00")))
    }
}
