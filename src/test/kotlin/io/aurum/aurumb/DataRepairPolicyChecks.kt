package io.aurum.aurumb

import io.aurum.aurumb.quality.*
import java.time.Instant

fun dataRepairPolicyChecks() {
    val now=Instant.parse("2026-10-02T12:00:00Z")
    check(HistoricalRepairPolicy.mode(null,now)==HistoricalRepairMode.FULL_TABLE)
    check(HistoricalRepairPolicy.mode(Instant.parse("2026-10-02T11:29:59Z"),now)==HistoricalRepairMode.FULL_TABLE) // 30m01s old
    check(HistoricalRepairPolicy.mode(Instant.parse("2026-10-02T11:30:00Z"),now)==HistoricalRepairMode.TARGETED) // exact 30m stays targeted
    check(HistoricalRepairPolicy.mode(Instant.parse("2026-10-02T11:45:00Z"),now)==HistoricalRepairMode.TARGETED)

    check(HistoricalRepairPolicy.targetRow(true,now,now))
    check(HistoricalRepairPolicy.targetRow(false,null,now))
    check(HistoricalRepairPolicy.targetRow(false,Instant.parse("2026-10-02T11:29:59Z"),now))
    check(!HistoricalRepairPolicy.targetRow(false,Instant.parse("2026-10-02T11:30:00Z"),now))
    check(!HistoricalRepairPolicy.targetRow(false,Instant.parse("2026-10-02T11:45:00Z"),now))
}
