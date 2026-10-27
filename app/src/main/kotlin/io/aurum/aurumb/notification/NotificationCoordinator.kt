package io.aurum.aurumb.notification

import io.aurum.aurumb.persistence.AurumDao
import io.aurum.aurumb.persistence.NotificationDeliveryEntity
import io.aurum.common.notification.*
import java.time.*
import java.util.UUID

data class NotificationDecision(val delivered:Boolean,val reason:String)

class NotificationCoordinator(
    private val dao:AurumDao,
    private val adapters:List<NotificationAdapter>,
    private val zone:ZoneId=ZoneId.of("Europe/Istanbul"),
    private val clock:()->Instant={Instant.now()}
) {
    init { require(adapters.map{it.kind}.distinct().size==adapters.size) }

    suspend fun deliver(event:NotificationEvent,policy:NotificationPolicy):NotificationDecision {
        val now=clock()
        if(!io.aurum.common.logging.OperationalEventPolicy.isImportantNotification(event))
            return NotificationDecision(false,"ROUTINE_SUPPRESSED")
        if(isQuiet(now,policy) && event.importance!=NotificationImportance.CRITICAL) return NotificationDecision(false,"QUIET_HOURS")
        if(dao.notificationCountForFingerprint(event.fingerprint)>=policy.maxRepeatsPerFingerprint)
            return NotificationDecision(false,"REPEAT_LIMIT")
        if(dao.notificationCountSince(now.minus(Duration.ofHours(24)).toString())>=policy.maxPer24Hours) {
            return NotificationDecision(false,"RATE_LIMIT")
        }
        val enabled=adapters.filter{it.kind in policy.enabledChannels}
        if(enabled.isEmpty()) return NotificationDecision(false,"NO_CHANNEL")
        var any=false
        for(adapter in enabled) {
            if(adapter.deliver(event)) {
                any=true
                dao.appendNotificationDelivery(NotificationDeliveryEntity(
                    UUID.randomUUID().toString(),event.fingerprint,event.type,adapter.kind.name,event.importance.name,
                    now.toString(),event.title,event.body
                ))
            }
        }
        return NotificationDecision(any,if(any)"DELIVERED" else "DELIVERY_FAILED")
    }

    private fun isQuiet(now:Instant,policy:NotificationPolicy):Boolean {
        if(!policy.quietHoursEnabled) return false
        val start=runCatching{LocalTime.parse(policy.quietStart)}.getOrNull()?:return false
        val end=runCatching{LocalTime.parse(policy.quietEnd)}.getOrNull()?:return false
        val t=now.atZone(zone).toLocalTime()
        return if(start<=end) t>=start && t<end else t>=start || t<end
    }
}
