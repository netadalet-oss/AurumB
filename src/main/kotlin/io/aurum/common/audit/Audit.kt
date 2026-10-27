package io.aurum.common.audit
import io.aurum.common.model.VersionStamp
import java.time.Instant
data class AuditEvent(val id:String,val at:Instant,val subsystem:String,val operationId:String,val code:String,val message:String,val metadata:Map<String,String>,val versions:VersionStamp)
interface AuditSink { fun append(event:AuditEvent) }
