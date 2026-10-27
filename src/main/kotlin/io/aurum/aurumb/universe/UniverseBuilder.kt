package io.aurum.aurumb.universe

import java.math.BigDecimal
import java.time.Instant

data class ListingInterval(val listedAt:Instant,val delistedAt:Instant?)
data class UniverseInstrument(
    val symbol:String,
    val listing:ListingInterval,
    val price:BigDecimal?,
    val medianTurnover21:BigDecimal?,
    val medianVolume21:BigDecimal?,
    val dataQuality:Int,
    val suspended:Boolean
)
data class UniversePolicy(
    val minPrice:BigDecimal,
    val minMedianTurnover21:BigDecimal,
    val minMedianVolume21:BigDecimal,
    val minDataQuality:Int
)
data class UniverseDecision(val symbol:String,val eligible:Boolean,val reasons:List<String>)

object UniverseBuilder {
    fun build(asOf:Instant,instruments:List<UniverseInstrument>,policy:UniversePolicy):List<UniverseDecision> {
        require(instruments.map{it.symbol}.distinct().size==instruments.size) { "duplicate symbol" }
        return instruments.map { x ->
            val reasons=mutableListOf<String>()
            if (x.listing.listedAt.isAfter(asOf)) reasons += "NOT_YET_LISTED"
            if (x.listing.delistedAt?.let{!it.isAfter(asOf)}==true) reasons += "DELISTED_AT_ASOF"
            if (x.suspended) reasons += "SUSPENDED"
            if (x.price==null || x.price<=BigDecimal.ZERO) reasons += "INVALID_PRICE"
            else if (x.price<policy.minPrice) reasons += "MIN_PRICE"
            if (x.medianTurnover21==null) reasons += "MISSING_TURNOVER"
            else if (x.medianTurnover21<policy.minMedianTurnover21) reasons += "MIN_TURNOVER"
            if (x.medianVolume21==null) reasons += "MISSING_VOLUME"
            else if (x.medianVolume21<policy.minMedianVolume21) reasons += "MIN_VOLUME"
            if (x.dataQuality<policy.minDataQuality) reasons += "DATA_QUALITY"
            UniverseDecision(x.symbol,reasons.isEmpty(),reasons)
        }.sortedBy{it.symbol}
    }
}
