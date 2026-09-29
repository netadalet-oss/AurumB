package com.aurum.bistterminal8

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OperationLockTest {
    @Test
    fun sameDataPipelineCannotBeOwnedByTwoJobs() {
        val first = "unit-first"
        val second = "unit-second"
        assertTrue(OperationLock.acquire("data", first))
        try {
            assertFalse(OperationLock.acquire("data", second))
            assertFalse(OperationLock.release("data", second))
        } finally {
            assertTrue(OperationLock.release("data", first))
        }
        assertTrue(OperationLock.acquire("data", second))
        assertTrue(OperationLock.release("data", second))
    }

    @Test
    fun differentPipelineKindsRemainIndependent() {
        assertTrue(OperationLock.acquire("data", "unit-data"))
        assertTrue(OperationLock.acquire("market", "unit-market"))
        assertTrue(OperationLock.release("market", "unit-market"))
        assertTrue(OperationLock.release("data", "unit-data"))
    }
}
