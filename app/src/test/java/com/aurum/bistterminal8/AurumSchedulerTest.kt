package com.aurum.bistterminal8

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate

class AurumSchedulerTest {
    @Test fun t01_weekendDefaultsAreSeparated() =
        assertEquals(listOf("12:30"), AurumScheduler.defaultTimesForDate(LocalDate.of(2026,10,3)))

    @Test fun t02_marketWeekendDefaultIsPlusThirty() =
        assertEquals(listOf("13:00"), AurumScheduler.defaultTimesForDate(LocalDate.of(2026,10,3),"market"))

    @Test fun t03_weekdayDefaultsRemainCanonical() =
        assertEquals(listOf("00:30","04:30","08:20","09:20","10:20","11:20","12:20","13:20","14:20","15:20","16:20","17:20","18:20","19:20","20:30","21:30","22:30","23:30"), AurumScheduler.defaultTimesForDate(LocalDate.of(2026,10,5)))

    @Test fun t04_marketWeekdayDefaultsRemainPlusThirty() {
        val xs=AurumScheduler.defaultTimesForDate(LocalDate.of(2026,10,5),"market")
        assertEquals("01:00",xs.first()); assertEquals("00:00",xs.last())
    }

    @Test fun t05_fridayLateSlotSkipsWeekend() =
        assertEquals(Instant.parse("2026-10-05T20:30:00Z"), AurumScheduler.nextSlot("23:30",Instant.parse("2026-10-02T20:31:00Z")))

    @Test fun t06_weekendSlotSchedulesSaturday() =
        assertEquals(Instant.parse("2026-10-03T09:30:00Z"), AurumScheduler.nextSlot("12:30",Instant.parse("2026-10-02T21:00:00Z")))

    @Test fun t07_customTimeRemainsValidAcrossWeekend() =
        assertEquals(Instant.parse("2026-10-03T06:00:00Z"), AurumScheduler.nextSlot("09:00",Instant.parse("2026-10-02T21:00:00Z"),custom=listOf("09:00")))

    @Test fun t08_customListRejectsUnconfiguredTime() =
        assertNull(AurumScheduler.nextSlot("10:00",Instant.parse("2026-10-05T05:00:00Z"),custom=listOf("09:00")))

    @Test fun t09_timeValidationRejectsMalformedValues() {
        assertTrue(AurumScheduler.valid("00:00")); assertFalse(AurumScheduler.valid("9:20")); assertFalse(AurumScheduler.valid("25:00"))
    }

    @Test fun t10_exactBoundaryDoesNotReplaySameSlot() =
        assertEquals(Instant.parse("2026-10-06T06:20:00Z"), AurumScheduler.nextSlot("09:20",Instant.parse("2026-10-05T06:20:00Z")))

    @Test fun t11_sundayWeekdayTimeMovesToMonday() =
        assertEquals(Instant.parse("2026-10-05T06:20:00Z"), AurumScheduler.nextSlot("09:20",Instant.parse("2026-10-04T08:00:00Z")))

    @Test fun t12_sameDayFutureSlotIsSelected() =
        assertEquals(Instant.parse("2026-10-05T06:20:00Z"), AurumScheduler.nextSlot("09:20",Instant.parse("2026-10-05T06:00:00Z")))
}
