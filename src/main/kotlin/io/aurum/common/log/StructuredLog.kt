package io.aurum.common.log

import java.time.Instant

enum class LogLevel { DEBUG, INFO, WARN, ERROR }

data class LogEvent(
    val timestamp:Instant,
    val level:LogLevel,
    val subsystem:String,
    val operationId:String,
    val code:String,
    val message:String,
    val metadata:Map<String,String>
)

object LogSanitizer {
    private val secretKeys=Regex("(?i)(api[-_]?key|token|secret|authorization|password|credential)")
    fun sanitize(metadata:Map<String,String>)=metadata.mapValues { (k,v) ->
        if(secretKeys.containsMatchIn(k)) "***" else v.take(4000)
    }
}
