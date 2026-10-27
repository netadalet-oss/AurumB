package io.aurum.aurumb

import io.aurum.common.notification.*
import java.time.Instant

fun notificationContractChecks() {
    val policy=NotificationPolicy(
        enabledChannels=setOf(NotificationChannelKind.ANDROID_LOCAL),
        quietHoursEnabled=true,
        quietStart="22:00",
        quietEnd="08:00",
        maxPer24Hours=5
    )
    check(NotificationChannelKind.ANDROID_LOCAL in policy.enabledChannels)
    check(policy.maxPer24Hours>0)
    val event=NotificationEvent(
        id="n1",
        type="SELECTION",
        title="AAA",
        body="test",
        importance=NotificationImportance.NORMAL,
        fingerprint="selection:AAA:2026-10-01",
        createdAt=Instant.parse("2026-10-01T12:00:00Z")
    )
    check(event.fingerprint.isNotBlank())
}
