package com.aurum.bistterminal8

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SchedulerLedgerPolicyTest {
    @Test fun t13_pendingBlocksDuplicate() = assertTrue(SchedulerLedgerPolicy.blocksDuplicate("PENDING"))
    @Test fun t14_runningBlocksDuplicate() = assertTrue(SchedulerLedgerPolicy.blocksDuplicate("RUNNING"))
    @Test fun t15_completedBlocksDuplicate() = assertTrue(SchedulerLedgerPolicy.blocksDuplicate("COMPLETED"))
    @Test fun t16_failedAllowsRetry() = assertFalse(SchedulerLedgerPolicy.blocksDuplicate("FAILED"))
    @Test fun t17_timedOutAllowsRetry() = assertFalse(SchedulerLedgerPolicy.blocksDuplicate("TIMED_OUT"))
    @Test fun t18_attemptStartsAndIncrements() { assertEquals(1,SchedulerLedgerPolicy.nextAttempt(0)); assertEquals(4,SchedulerLedgerPolicy.nextAttempt(3)) }
    @Test fun t19_negativeAttemptNormalizesToOne() = assertEquals(1,SchedulerLedgerPolicy.nextAttempt(-4))
    @Test fun t20_staleRunningIsRecovered() = assertTrue(SchedulerLedgerPolicy.isStaleRunning("RUNNING",1_000L,8_201_001L,7_200_000L))
    @Test fun t21_exactStaleBoundaryIsNotRecoveredEarly() = assertFalse(SchedulerLedgerPolicy.isStaleRunning("RUNNING",1_000L,7_201_000L,7_200_000L))
    @Test fun t22_stalePendingIsMissedCandidate() = assertTrue(SchedulerLedgerPolicy.isStalePending("PENDING",1_000L,8_201_001L,7_200_000L))
    @Test fun t23_freshPendingIsPreserved() = assertFalse(SchedulerLedgerPolicy.isStalePending("PENDING",1_000L,7_201_000L,7_200_000L))
}
