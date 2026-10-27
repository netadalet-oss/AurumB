package io.aurum.aurumb.backtest
import java.math.BigDecimal
import java.math.MathContext
private val MC=MathContext.DECIMAL128
data class EquityCostModel(val commissionBps:BigDecimal,val halfSpreadBps:BigDecimal,val slippageBps:BigDecimal,val taxAndFeesBps:BigDecimal){init{require(listOf(commissionBps,halfSpreadBps,slippageBps,taxAndFeesBps).all{it>=BigDecimal.ZERO})};fun roundTripFraction()=listOf(commissionBps,halfSpreadBps,slippageBps,taxAndFeesBps).fold(BigDecimal.ZERO,BigDecimal::add).multiply(BigDecimal("2"),MC).divide(BigDecimal("10000"),MC);fun netReturn(gross:BigDecimal)=gross.subtract(roundTripFraction(),MC).max(BigDecimal("-1"))}
