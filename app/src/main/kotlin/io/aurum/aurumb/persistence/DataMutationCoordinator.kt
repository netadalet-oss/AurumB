package io.aurum.aurumb.persistence

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Single in-process owner for state-changing operations that can originate from
 * WorkManager or directly from user actions (import, restore, runtime patch).
 *
 * WorkManager unique chains serialize scheduled jobs, but UI-triggered exchange
 * operations live outside those chains. Sharing this mutex prevents concurrent
 * mutation of Room/settings/scheduler state inside the app process.
 */
object DataMutationCoordinator {
    private val mutex=Mutex()

    suspend fun <T> serialized(block:suspend ()->T):T =
        mutex.withLock { block() }
}
