package io.aurum.common.logging

import io.aurum.common.notification.NotificationEvent
import io.aurum.common.notification.NotificationImportance
import java.util.Locale

/**
 * Presentation/notification policy only. Domain evidence stays in its owning tables.
 * General history is intentionally reserved for events that need user attention or
 * carry application-wide operational significance.
 */
object OperationalEventPolicy {
    private val importantTokens=listOf(
        "FAIL","FAILED","FAILURE","ERROR","SECURITY","BLOCK",
        "AL_SAT","NOTIFICATION","BACKUP","RESTORE","IMPORT","EXPORT",
        "INTEGRITY","REPAIR","CANCEL","INTERRUPT","GATE",
        "SCHEDULER","WARNING","WARN"
    )

    fun isImportantAudit(level:String,subsystem:String,code:String,message:String):Boolean {
        val l=level.uppercase(Locale.ROOT)
        val c=code.uppercase(Locale.ROOT)
        val m=message.uppercase(Locale.ROOT)
        if(l=="ERROR" || l=="WARN" || l=="WARNING" || l=="CRITICAL") return true
        if(subsystem.equals("blocked-universe",ignoreCase=true)) return true
        if(c.startsWith("MANUAL_QUALIFIED_") || c=="TRADE_REMOVED_AS_NEVER_TRADED") return true
        if(c.startsWith("MODEL_") && "EVIDENCE" !in c) return true
        return importantTokens.any { it in c || it in m }
    }

    fun isImportantNotification(event:NotificationEvent):Boolean =
        isImportantNotification(event.type,event.title,event.body,event.importance.name)

    fun isImportantNotification(type:String,title:String,body:String,importance:String):Boolean {
        val imp=importance.uppercase(Locale.ROOT)
        if(imp=="HIGH" || imp=="CRITICAL") return true
        val t=type.uppercase(Locale.ROOT)
        val text=(title+" "+body).uppercase(Locale.ROOT)
        if("TRADE" in t || "BUY" in t || "SELL" in t || "AL_SAT" in t) return true
        if(t.startsWith("MODEL_") && "EVIDENCE" !in t) return true
        return importantTokens.any { it in t || it in text }
    }

    fun dedupeKey(subsystem:String,code:String,message:String):String {
        // Preserve meaningful instrument/user text. Only volatile identifiers and
        // timestamps are normalized so unrelated important events are never merged.
        val normalized=message.uppercase(Locale.ROOT)
            .replace(Regex("\\b[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\\b"),"<ID>")
            .replace(Regex("\\b\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?\\b"),"<TIME>")
            .replace(Regex("\\s+")," ")
            .trim()
        return subsystem.uppercase(Locale.ROOT)+"|"+code.uppercase(Locale.ROOT)+"|"+normalized
    }
}
