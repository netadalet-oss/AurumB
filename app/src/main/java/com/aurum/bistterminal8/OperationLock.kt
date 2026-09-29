package com.aurum.bistterminal8

/**
 * Process-wide operation lock shared by the foreground Activity WebView and the scheduled
 * PipelineService WebView. Both components run in the same application process.
 * Process death clears the lock, which is correct because no in-process pipeline survives it.
 */
object OperationLock {
    private val owners = mutableMapOf<String, String>()

    @Synchronized
    fun acquire(kind: String, owner: String): Boolean {
        val key = kind.trim().lowercase()
        if (key.isBlank() || owner.isBlank()) return false
        val current = owners[key]
        if (current != null && current != owner) return false
        owners[key] = owner
        return true
    }

    @Synchronized
    fun release(kind: String, owner: String): Boolean {
        val key = kind.trim().lowercase()
        if (key.isBlank() || owner.isBlank()) return false
        if (owners[key] != owner) return false
        owners.remove(key)
        return true
    }

    @Synchronized
    fun owner(kind: String): String? = owners[kind.trim().lowercase()]
}
