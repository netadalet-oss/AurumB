package io.aurum.common.provider

import io.aurum.common.model.DataQuality
import io.aurum.common.model.DataState
import java.math.BigDecimal
import java.time.Instant

data class CanonicalBar(
    val symbol:String,
    val at:Instant,
    val open:BigDecimal?,
    val high:BigDecimal?,
    val low:BigDecimal?,
    val close:BigDecimal,
    val adjustedClose:BigDecimal?,
    val volume:BigDecimal?,
    val currency:String?,
    val provider:String,
    val requestedAt:Instant,
    val receivedAt:Instant,
    val quality:DataQuality,
    val freshness:DataState,
    val rawSourceFingerprint:String
)

sealed interface BarProviderResult {
    data class Success(
        val provider:String,
        val symbol:String,
        val bars:List<CanonicalBar>,
        val requestedAt:Instant,
        val receivedAt:Instant,
        val sourceFingerprint:String,
        val latestObservation:Observation?=null
    ):BarProviderResult
    data class Failure(
        val provider:String,
        val symbol:String,
        val code:String,
        val message:String,
        val retryable:Boolean,
        val requestedAt:Instant,
        val receivedAt:Instant?
    ):BarProviderResult
}

interface HistoricalBarProvider {
    val id:String
    fun fetch(symbol:String,from:Instant,to:Instant):BarProviderResult
}
