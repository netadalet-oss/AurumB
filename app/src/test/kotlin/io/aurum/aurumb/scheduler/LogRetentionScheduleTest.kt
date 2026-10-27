package io.aurum.aurumb.scheduler

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Duration
import java.time.Instant

class LogRetentionScheduleTest {
    @Test
    fun nextCleanupTargetsSundayMidnightIstanbul() {
        val oneSecondBefore=Instant.parse("2026-10-03T20:59:59Z")
        assertEquals(
            Instant.parse("2026-10-03T21:00:00Z"),
            AppScheduler.nextSundayMidnight(oneSecondBefore)
        )
        assertEquals(Duration.ofSeconds(1),AppScheduler.nextSundayMidnightDelay(oneSecondBefore))
    }

    @Test
    fun exactBoundaryMovesToFollowingSunday() {
        val boundary=Instant.parse("2026-10-03T21:00:00Z")
        assertEquals(
            Instant.parse("2026-10-10T21:00:00Z"),
            AppScheduler.nextSundayMidnight(boundary)
        )
    }
}
