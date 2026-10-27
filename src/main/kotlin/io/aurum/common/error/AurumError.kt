package io.aurum.common.error

enum class ErrorKind { NETWORK, PROVIDER, PARSE, VALIDATION, PERSISTENCE, MODEL, AI, SCHEDULER, NATIVE, UI }

data class AurumError(
    val kind:ErrorKind,
    val code:String,
    val userMessage:String,
    val diagnosticMessage:String?,
    val retryable:Boolean
) {
    init {
        require(code.matches(Regex("[A-Z0-9_.-]{2,80}")))
        require(userMessage.isNotBlank())
    }
}
