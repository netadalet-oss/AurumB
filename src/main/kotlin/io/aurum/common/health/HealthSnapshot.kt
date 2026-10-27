package io.aurum.common.health

import java.time.Instant

enum class HealthLevel { HEALTHY, DEGRADED, FAILED, UNKNOWN }

data class HealthComponent(
    val name:String,
    val level:HealthLevel,
    val message:String,
    val observedAt:Instant
)

data class HealthSnapshot(
    val observedAt:Instant,
    val components:List<HealthComponent>,
    val marketBarCount:Int,
    val universeSnapshotCount:Int,
    val successfulAiAuditCount:Int,
    val lastMarketDataAt:Instant?,
    val lastAnalysisAt:Instant?,
    val activeModelVersion:String?,
    val storageBytes:Long
) {
    val overall:HealthLevel
        get() = when {
            components.any{it.level==HealthLevel.FAILED} -> HealthLevel.FAILED
            components.any{it.level==HealthLevel.DEGRADED} -> HealthLevel.DEGRADED
            components.all{it.level==HealthLevel.HEALTHY} -> HealthLevel.HEALTHY
            else -> HealthLevel.UNKNOWN
        }
}
