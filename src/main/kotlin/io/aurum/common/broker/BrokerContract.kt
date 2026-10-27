package io.aurum.common.broker

import java.math.BigDecimal
import java.time.Instant

enum class BrokerSide { BUY, SELL }
enum class BrokerOrderStatus { REJECTED, ACCEPTED, FILLED, CANCELLED, FAILED }

data class BrokerRiskLimits(
    val activated:Boolean=false,
    val maxOrderAmount:BigDecimal=BigDecimal.ZERO,
    val dailyLossLimit:BigDecimal=BigDecimal.ZERO,
    val maxPriceDeviationPct:BigDecimal=BigDecimal("1")
) {
    init {
        require(maxOrderAmount>=BigDecimal.ZERO)
        require(dailyLossLimit>=BigDecimal.ZERO)
        require(maxPriceDeviationPct>=BigDecimal.ZERO)
    }
}

data class BrokerOrderRequest(
    val idempotencyKey:String,
    val instrument:String,
    val side:BrokerSide,
    val quantity:BigDecimal,
    val referencePrice:BigDecimal,
    val estimatedAmount:BigDecimal,
    val createdAt:Instant,
    val explicitUserConfirmation:Boolean,
    val observedMarketPrice:BigDecimal?=null
) {
    init {
        require(idempotencyKey.isNotBlank())
        require(instrument.isNotBlank())
        require(quantity>BigDecimal.ZERO)
        require(referencePrice>BigDecimal.ZERO)
        require(estimatedAmount>BigDecimal.ZERO)
    }
}

data class BrokerOrderResult(
    val status:BrokerOrderStatus,
    val brokerOrderId:String?,
    val message:String,
    val acceptedAt:Instant?
)

interface BrokerAdapter {
    val id:String
    suspend fun submit(request:BrokerOrderRequest,limits:BrokerRiskLimits,currentDailyPnl:BigDecimal):BrokerOrderResult
}

class DisabledBrokerAdapter:BrokerAdapter {
    override val id="DISABLED"
    override suspend fun submit(
        request:BrokerOrderRequest,
        limits:BrokerRiskLimits,
        currentDailyPnl:BigDecimal
    )=BrokerOrderResult(
        BrokerOrderStatus.REJECTED,null,
        "Gerçek emir varsayılan olarak devre dışıdır.",null
    )
}

object BrokerSafetyGate {
    fun validate(
        request:BrokerOrderRequest,
        limits:BrokerRiskLimits,
        currentDailyPnl:BigDecimal,
        seenIdempotencyKeys:Set<String> = emptySet()
    ):String? {
        if(!limits.activated) return "BROKER_NOT_ACTIVATED"
        if(!request.explicitUserConfirmation) return "USER_CONFIRMATION_REQUIRED"
        if(request.idempotencyKey in seenIdempotencyKeys) return "DUPLICATE_ORDER"
        if(limits.maxOrderAmount<=BigDecimal.ZERO || request.estimatedAmount>limits.maxOrderAmount) return "ORDER_LIMIT"
        if(limits.dailyLossLimit>BigDecimal.ZERO && currentDailyPnl < limits.dailyLossLimit.negate()) return "DAILY_LOSS_LIMIT"
        val market=request.observedMarketPrice ?: return "MARKET_PRICE_REQUIRED"
        if(market<=BigDecimal.ZERO) return "MARKET_PRICE_INVALID"
        val deviation=request.referencePrice
            .subtract(market).abs()
            .divide(market,java.math.MathContext.DECIMAL128)
            .multiply(BigDecimal("100"))
        if(deviation>limits.maxPriceDeviationPct) return "PRICE_DEVIATION_LIMIT"
        return null
    }
}
