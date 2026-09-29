package com.aurum.bistterminal8

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SchedulerLedgerPolicyTest {
    @Test fun pendingBlocksDuplicate() = assertTrue(SchedulerLedgerPolicy.blocksDuplicate("PENDING"))
    @Test fun runningBlocksDuplicate() = assertTrue(SchedulerLedgerPolicy.blocksDuplicate("RUNNING"))
    @Test fun completedBlocksDuplicate() = assertTrue(SchedulerLedgerPolicy.blocksDuplicate("COMPLETED"))
    @Test fun failedAllowsRetry() = assertFalse(SchedulerLedgerPolicy.blocksDuplicate("FAILED"))
    @Test fun timedOutAllowsRetry() = assertFalse(SchedulerLedgerPolicy.blocksDuplicate("TIMED_OUT"))
    @Test fun missedAllowsRetry() = assertFalse(SchedulerLedgerPolicy.blocksDuplicate("MISSED"))
    @Test fun attemptStartsAtOne() = assertEquals(1, SchedulerLedgerPolicy.nextAttempt(0))
    @Test fun attemptIncrements() = assertEquals(4, SchedulerLedgerPolicy.nextAttempt(3))
    @Test fun negativeAttemptNormalizesToOne() = assertEquals(1, SchedulerLedgerPolicy.nextAttempt(-4))
    @Test fun staleRunningIsRecovered() = assertTrue(SchedulerLedgerPolicy.isStaleRunning("RUNNING",1_000L,8_201_001L,7_200_000L))
    @Test fun freshRunningIsNotRecovered() = assertFalse(SchedulerLedgerPolicy.isStaleRunning("RUNNING",1_000L,7_200_999L,7_200_000L))
    @Test fun exactStaleBoundaryIsNotRecoveredEarly() = assertFalse(SchedulerLedgerPolicy.isStaleRunning("RUNNING",1_000L,7_201_000L,7_200_000L))
    @Test fun stalePendingIsRecoverableAsMissedOnly() { assertTrue(SchedulerLedgerPolicy.isStalePending("PENDING",1_000L,8_201_001L,7_200_000L)); assertFalse(SchedulerLedgerPolicy.isStalePending("RUNNING",1_000L,8_201_001L,7_200_000L)) }
    @Test fun negativeAttemptIsNormalized() = assertEquals(1, SchedulerLedgerPolicy.nextAttempt(-5))

    @Test fun missingActivityTimestampIsNotStale() =
        assertFalse(SchedulerLedgerPolicy.isStaleRunning("RUNNING", 0L, 20_000_000L, 7_200_000L))

    @Test fun completedJobIsNeverRecoveredAsStale() =
        assertFalse(SchedulerLedgerPolicy.isStaleRunning("COMPLETED", 1_000L, 20_000_000L, 7_200_000L))
    @Test fun stalePendingBecomesRecoverableMissed() =
        assertTrue(SchedulerLedgerPolicy.isStalePending("PENDING", 1_000L, 8_201_001L, 7_200_000L))

    @Test fun freshPendingIsPreserved() =
        assertFalse(SchedulerLedgerPolicy.isStalePending("PENDING", 1_000L, 7_201_000L, 7_200_000L))
    @Test fun negativeAttemptIsNormalizedToOne() =
        assertEquals(1, SchedulerLedgerPolicy.nextAttempt(-4))

    @Test fun exactlyAtStaleThresholdIsNotRecovered() =
        assertFalse(SchedulerLedgerPolicy.isStaleRunning("RUNNING", 1_000L, 7_201_000L, 7_200_000L))
}
