package io.aurum.common.notification

import java.time.Instant

enum class NotificationImportance { LOW, NORMAL, HIGH, CRITICAL }
enum class NotificationChannelKind { ANDROID_LOCAL, EMAIL, PUSH }

data class NotificationEvent(
    val id:String,
    val type:String,
    val title:String,
    val body:String,
    val importance:NotificationImportance,
    val fingerprint:String,
    val createdAt:Instant
) {
    init {
        require(id.isNotBlank())
        require(type.isNotBlank())
        require(fingerprint.isNotBlank())
        require(title.length<=200)
        require(body.length<=4000)
    }
}

data class NotificationPolicy(
    val enabledChannels:Set<NotificationChannelKind>,
    val quietHoursEnabled:Boolean,
    val quietStart:String,
    val quietEnd:String,
    val maxPer24Hours:Int=20,
    val maxRepeatsPerFingerprint:Int=1
) {
    init {
        require(maxPer24Hours>=0)
        require(maxRepeatsPerFingerprint>=1)
    }
}

interface NotificationAdapter {
    val kind:NotificationChannelKind
    suspend fun deliver(event:NotificationEvent):Boolean
}
