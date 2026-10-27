package io.aurum.aurumb

import io.aurum.common.ai.AiBudget
import java.time.Instant

fun aiBudgetChecks() {
    check(AiBudget.allowsPaidCall(0,2))
    check(AiBudget.allowsPaidCall(1,2))
    check(!AiBudget.allowsPaidCall(2,2))
    check(!AiBudget.allowsPaidCall(0,0))
    check(
        AiBudget.utcDayStart(Instant.parse("2026-10-01T23:59:59Z")) ==
            Instant.parse("2026-10-01T00:00:00Z")
    )
}
