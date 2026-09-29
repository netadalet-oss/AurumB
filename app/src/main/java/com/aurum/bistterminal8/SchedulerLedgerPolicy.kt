package com.aurum.bistterminal8

object SchedulerLedgerPolicy {
    private val duplicateBlocking = setOf("PENDING", "RUNNING", "COMPLETED")

    fun blocksDuplicate(status: String): Boolean = status in duplicateBlocking

    fun nextAttempt(previousAttempt: Int): Int = previousAttempt.coerceAtLeast(0) + 1

    fun isStalePending(status: String, acceptedAt: Long, now: Long, staleMs: Long): Boolean =
        status == "PENDING" && acceptedAt > 0L && now - acceptedAt > staleMs

    fun isStaleRunning(status: String, lastActivityAt: Long, now: Long, staleMs: Long): Boolean =
        status == "RUNNING" && lastActivityAt > 0L && now - lastActivityAt > staleMs
}
