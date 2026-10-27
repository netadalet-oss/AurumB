package io.aurum.common.provider

import java.time.Instant

data class CompanyDirectoryEntry(
    val symbol:String,
    val name:String,
    val city:String?,
    val source:String,
    val validatedAt:Instant,
    val rawSourceFingerprint:String
)

sealed interface CompanyDirectoryResult {
    data class Success(
        val provider:String,
        val entries:List<CompanyDirectoryEntry>,
        val requestedAt:Instant,
        val receivedAt:Instant,
        val sourceFingerprint:String
    ):CompanyDirectoryResult
    data class Failure(
        val provider:String,
        val code:String,
        val message:String,
        val retryable:Boolean,
        val requestedAt:Instant,
        val receivedAt:Instant?
    ):CompanyDirectoryResult
}

interface CompanyDirectoryProvider {
    val id:String
    fun fetch():CompanyDirectoryResult
}
