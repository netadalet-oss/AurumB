package io.aurum.aurumb

import io.aurum.common.broker.*
import java.math.BigDecimal
import java.time.Instant

fun brokerChecks() {
    val req=BrokerOrderRequest("k1","AAA",BrokerSide.BUY,BigDecimal.ONE,BigDecimal("100"),BigDecimal("100"),Instant.EPOCH,false,BigDecimal("100"))
    val limits=BrokerRiskLimits(true,BigDecimal("1000"),BigDecimal("500"),BigDecimal.ONE)
    check(BrokerSafetyGate.validate(req,limits,BigDecimal.ZERO)=="USER_CONFIRMATION_REQUIRED")
    val confirmed=req.copy(explicitUserConfirmation=true)
    check(BrokerSafetyGate.validate(confirmed,limits,BigDecimal("-600"))=="DAILY_LOSS_LIMIT")
    check(BrokerSafetyGate.validate(confirmed,limits,BigDecimal.ZERO,setOf("k1"))=="DUPLICATE_ORDER")
    check(BrokerSafetyGate.validate(confirmed.copy(observedMarketPrice=null),limits,BigDecimal.ZERO)=="MARKET_PRICE_REQUIRED")
    check(BrokerSafetyGate.validate(confirmed.copy(observedMarketPrice=BigDecimal("102")),limits,BigDecimal.ZERO)=="PRICE_DEVIATION_LIMIT")
    check(BrokerSafetyGate.validate(confirmed,limits,BigDecimal.ZERO)==null)
}
