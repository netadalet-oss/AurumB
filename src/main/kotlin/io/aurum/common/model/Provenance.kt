package io.aurum.common.model

import java.time.Instant

enum class DataState { LIVE, CACHED, STALE, UNAVAILABLE }
enum class DataQuality { VALID, DEGRADED, INVALID, MISSING }

data class Provenance(
    val provider: String,
    val requestedAt: Instant,
    val receivedAt: Instant,
    val marketTimestamp: Instant?,
    val symbol: String,
    val currency: String?,
    val quality: DataQuality,
    val freshness: DataState,
    val rawSourceFingerprint: String,
    val transformVersion: String,
)
