package com.aurum.bistterminal8

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

class AurumSchedulerMaintenanceTest {
    @Test
    fun targetsSundayMidnightEuropeIstanbul() {
        assertEquals(
            Instant.parse("2026-10-03T21:00:00Z"),
            AurumScheduler.nextSundayMidnight(Instant.parse("2026-10-03T20:59:59Z"))
        )
    }

    @Test
    fun exactBoundaryMovesToFollowingSunday() {
        assertEquals(
            Instant.parse("2026-10-10T21:00:00Z"),
            AurumScheduler.nextSundayMidnight(Instant.parse("2026-10-03T21:00:00Z"))
        )
    }
}
