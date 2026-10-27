package io.aurum.aurumb

import io.aurum.common.health.*
import io.aurum.common.log.*
import io.aurum.common.settings.*
import io.aurum.common.time.*
import java.time.*

fun systemChecks() {
    val settings=SettingsSchema.resolve(mapOf(
        "commissionBps" to "-1",
        "quietHoursEnabled" to "true",
        "topN" to "not-a-number"
    ))
    check(settings.values["commissionBps"]=="8")
    check(settings.values["quietHoursEnabled"]=="true")
    check(settings.values["topN"]=="20")
    check(settings.repairedKeys.containsAll(setOf("commissionBps","topN")))

    val instant=Instant.parse("2026-10-01T12:00:00Z")
    check(AurumTime.display(instant,AurumTime.ISTANBUL).zone==AurumTime.ISTANBUL)
    check(AurumTime.display(instant,AurumTime.AMSTERDAM).zone==AurumTime.AMSTERDAM)
    check(AurumTime.toUtc(instant)=="2026-10-01T12:00:00Z")

    val sanitized=LogSanitizer.sanitize(mapOf("apiKey" to "secret-value","symbol" to "AAA"))
    check(sanitized["apiKey"]=="***")
    check(sanitized["symbol"]=="AAA")

    val health=HealthSnapshot(
        observedAt=instant,
        components=listOf(
            HealthComponent("database",HealthLevel.HEALTHY,"ok",instant),
            HealthComponent("provider",HealthLevel.DEGRADED,"one source unavailable",instant)
        ),
        marketBarCount=10,
        universeSnapshotCount=1,
        successfulAiAuditCount=0,
        lastMarketDataAt=instant,
        lastAnalysisAt=instant,
        activeModelVersion="m1",
        storageBytes=100
    )
    check(health.overall==HealthLevel.DEGRADED)
}
