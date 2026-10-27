package io.aurum.common.provider

import io.aurum.common.model.DataQuality
import io.aurum.common.model.DataState
import io.aurum.common.model.Provenance
import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import java.time.Duration
import java.time.Instant

private val MC = MathContext(18, RoundingMode.HALF_EVEN)

data class ProviderAttempt(
    val provider:String,
    val success:Boolean,
    val value:BigDecimal?,
    val marketTimestamp:Instant?,
    val receivedAt:Instant,
    val code:String?,
    val message:String?
)

data class ConsensusPoint(
    val symbol:String,
    val value:BigDecimal?,
    val currency:String?,
    val selectedProviders:List<String>,
    val attempts:List<ProviderAttempt>,
    val quality:DataQuality,
    val freshness:DataState,
    val maxRelativeDisagreement:BigDecimal?,
    val provenance:Provenance?
)

data class ConsensusPolicy(
    val maxAge:Duration,
    val staleAfter:Duration,
    val maxRelativeDisagreement:BigDecimal = BigDecimal("0.02"),
    val minimumSuccessfulProviders:Int = 1
) {
    init {
        require(!maxAge.isNegative && !maxAge.isZero)
        require(!staleAfter.isNegative && !staleAfter.isZero)
        require(staleAfter <= maxAge)
        require(maxRelativeDisagreement >= BigDecimal.ZERO)
        require(minimumSuccessfulProviders >= 1)
    }
}

object ConsensusEngine {
    fun resolve(
        symbol:String,
        currency:String?,
        attempts:List<ProviderAttempt>,
        now:Instant,
        policy:ConsensusPolicy,
        transformVersion:String,
        rawFingerprint:String
    ):ConsensusPoint {
        require(attempts.map { it.provider }.distinct().size == attempts.size) { "duplicate provider attempt" }
        val usable = attempts.filter {
            it.success && it.value != null && it.marketTimestamp != null &&
                !it.marketTimestamp.isAfter(now) &&
                Duration.between(it.marketTimestamp, now) <= policy.maxAge
        }
        if (usable.size < policy.minimumSuccessfulProviders) {
            return ConsensusPoint(symbol,null,currency,emptyList(),attempts,DataQuality.MISSING,DataState.UNAVAILABLE,null,null)
        }

        val sorted=usable.sortedBy { it.value }
        val median = if (sorted.size % 2 == 1) sorted[sorted.size/2].value!!
        else sorted[sorted.size/2-1].value!!.add(sorted[sorted.size/2].value!!,MC).divide(BigDecimal("2"),MC)

        val disagreement = usable.mapNotNull {
            if (median.signum()==0) null else it.value!!.subtract(median,MC).abs().divide(median.abs(),MC)
        }.maxOrNull()

        val selected = if (disagreement != null && disagreement > policy.maxRelativeDisagreement && usable.size > 1) {
            usable.filter {
                median.signum()!=0 &&
                    it.value!!.subtract(median,MC).abs().divide(median.abs(),MC) <= policy.maxRelativeDisagreement
            }.ifEmpty { listOf(sorted[sorted.size/2]) }
        } else usable

        val value = selected.map { it.value!! }.let { xs ->
            xs.fold(BigDecimal.ZERO, BigDecimal::add).divide(BigDecimal(xs.size),MC)
        }
        val newestTs = selected.maxOf { it.marketTimestamp!! }
        val age = Duration.between(newestTs,now)
        val freshness = if (age <= policy.staleAfter) DataState.LIVE else DataState.STALE
        val quality = if (usable.size > 1 && disagreement != null && disagreement > policy.maxRelativeDisagreement)
            DataQuality.DEGRADED else DataQuality.VALID
        val receivedAt = selected.maxOf { it.receivedAt }
        val provenance = Provenance(
            provider=selected.joinToString("+") { it.provider },
            requestedAt=selected.minOf { it.receivedAt },
            receivedAt=receivedAt,
            marketTimestamp=newestTs,
            symbol=symbol,
            currency=currency,
            quality=quality,
            freshness=freshness,
            rawSourceFingerprint=rawFingerprint,
            transformVersion=transformVersion
        )
        return ConsensusPoint(symbol,value,currency,selected.map{it.provider}.sorted(),attempts,quality,freshness,disagreement,provenance)
    }
}
