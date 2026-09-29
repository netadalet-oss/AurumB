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
    @Test fun weekdayDefaultsRemainFullProfile() {
        assertEquals(18, AurumScheduler.defaultTimesForDate(LocalDate.of(2026, 10, 5)).size)
    }

    @Test fun marketWeekdayFirstSlotIsPlusThirty() {
        assertEquals("01:00", AurumScheduler.defaultTimesForDate(LocalDate.of(2026, 10, 5), "market").first())
    }

    @Test fun validMidnightAccepted() {
        assertEquals(true, AurumScheduler.valid("00:00"))
    }

    @Test fun malformedTimeRejected() {
        assertEquals(false, AurumScheduler.valid("9:20"))
    }

    @Test fun sameDayFutureSlotIsSelected() {
        val after = Instant.parse("2026-10-05T05:00:00Z")
        assertEquals(Instant.parse("2026-10-05T05:20:00Z"), AurumScheduler.nextSlot("08:20", after))
    }

    @Test fun elapsedSameDaySlotMovesToNextEligibleDay() {
        val after = Instant.parse("2026-10-05T05:21:00Z")
        assertEquals(Instant.parse("2026-10-06T05:20:00Z"), AurumScheduler.nextSlot("08:20", after))
    }

    @Test fun marketWeekendSlotUsesThirteenHundred() {
        val after = Instant.parse("2026-10-02T21:00:00Z")
        assertEquals(Instant.parse("2026-10-03T10:00:00Z"), AurumScheduler.nextSlot("13:00", after, "market"))
    }
    @Test fun weekdayDefaultsRemainCanonical() {
        assertEquals(18, AurumScheduler.defaultTimesForDate(LocalDate.of(2026, 10, 5)).size)
        assertEquals("00:30", AurumScheduler.defaultTimesForDate(LocalDate.of(2026, 10, 5)).first())
        assertEquals("23:30", AurumScheduler.defaultTimesForDate(LocalDate.of(2026, 10, 5)).last())
    }

    @Test fun marketWeekdayDefaultIsPlusThirty() {
        assertEquals("01:00", AurumScheduler.defaultTimesForDate(LocalDate.of(2026, 10, 5), "market").first())
    }

    @Test fun sameDayFutureSlotIsSelected() {
        val after = Instant.parse("2026-10-05T05:00:00Z")
        assertEquals(Instant.parse("2026-10-05T05:20:00Z"), AurumScheduler.nextSlot("08:20", after))
    }

    @Test fun elapsedSameDaySlotMovesToNextEligibleDay() {
        val after = Instant.parse("2026-10-05T05:21:00Z")
        assertEquals(Instant.parse("2026-10-06T05:20:00Z"), AurumScheduler.nextSlot("08:20", after))
    }

    @Test fun customListRejectsTimeNotConfigured() {
        assertNull(AurumScheduler.nextSlot("10:00", Instant.parse("2026-10-05T05:00:00Z"), custom=listOf("09:00")))
    }
    @Test fun weekdayDefaultsRemainCanonical() {
        assertEquals(listOf("00:30","04:30","08:20","09:20","10:20","11:20","12:20","13:20","14:20","15:20","16:20","17:20","18:20","19:20","20:30","21:30","22:30","23:30"), AurumScheduler.defaultTimesForDate(LocalDate.of(2026, 10, 5)))
    }

    @Test fun weekdayMarketDefaultsRemainPlusThirty() {
        assertEquals(listOf("01:00","05:00","08:50","09:50","10:50","11:50","12:50","13:50","14:50","15:50","16:50","17:50","18:50","19:50","21:00","22:00","23:00","00:00"), AurumScheduler.defaultTimesForDate(LocalDate.of(2026, 10, 5), "market"))
    }

    @Test fun nextSlotIsStrictlyAfterBoundary() {
        val boundary = Instant.parse("2026-10-05T20:30:00Z")
        assertEquals(Instant.parse("2026-10-06T20:30:00Z"), AurumScheduler.nextSlot("23:30", boundary))
    }

    @Test fun customListRejectsTimeNotConfigured() {
        assertNull(AurumScheduler.nextSlot("09:00", Instant.parse("2026-10-05T05:00:00Z"), custom=listOf("10:00")))
    }
    @Test fun weekdayDefaultsRemainCanonical() {
        assertEquals(listOf("00:30","04:30","08:20","09:20","10:20","11:20","12:20","13:20","14:20","15:20","16:20","17:20","18:20","19:20","20:30","21:30","22:30","23:30"), AurumScheduler.defaultTimesForDate(LocalDate.of(2026, 10, 5)))
    }

    @Test fun marketWeekdayDefaultsRemainPlusThirty() {
        assertEquals("01:00", AurumScheduler.defaultTimesForDate(LocalDate.of(2026, 10, 5), "market").first())
        assertEquals("00:00", AurumScheduler.defaultTimesForDate(LocalDate.of(2026, 10, 5), "market").last())
    }

    @Test fun sameDayFutureSlotIsSelected() {
        assertEquals(Instant.parse("2026-10-05T06:20:00Z"), AurumScheduler.nextSlot("09:20", Instant.parse("2026-10-05T06:00:00Z")))
    }

    @Test fun customListRejectsTimeOutsideConfiguredSet() {
        assertNull(AurumScheduler.nextSlot("10:00", Instant.parse("2026-10-05T05:00:00Z"), custom=listOf("09:00")))
    }
}
