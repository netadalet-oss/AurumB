package io.aurum.aurumb.portfolio

import io.aurum.aurumb.persistence.*
import io.aurum.aurumb.signal.QualifiedLifecycleEvent
import io.aurum.aurumb.signal.SignalSide
import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import java.time.Instant
import java.util.UUID

private val VP_MC=MathContext(18,RoundingMode.HALF_EVEN)

data class PortfolioExecutionPolicy(
    val startingCapital:BigDecimal=BigDecimal("100000"),
    val defaultPosition:BigDecimal=BigDecimal("5000"),
    val commissionBps:BigDecimal=BigDecimal("8"),
    val slippageBps:BigDecimal=BigDecimal("12")
) {
    init {
        require(startingCapital>BigDecimal.ZERO)
        require(defaultPosition>BigDecimal.ZERO)
        require(commissionBps>=BigDecimal.ZERO)
        require(slippageBps>=BigDecimal.ZERO)
    }
}

class VirtualPortfolioService(
    private val dao:AurumDao,
    private val policy:PortfolioExecutionPolicy,
    private val clock:()->Instant={Instant.now()}
) {
    suspend fun apply(event:QualifiedLifecycleEvent,signalId:String,idempotencyKey:String):Boolean {
        return when(event.side) {
            SignalSide.BUY -> buy(event,signalId,idempotencyKey)
            SignalSide.SELL -> sell(event,signalId,idempotencyKey)
            SignalSide.HOLD -> false
        }
    }

    suspend fun mark(prices:Map<String,BigDecimal>,at:Instant=clock()):PortfolioSnapshotEntity {
        val state=ensureState(at)
        val positions=dao.portfolioPositions()
        var marketValue=BigDecimal.ZERO
        var unrealized=BigDecimal.ZERO
        for(p in positions) {
            val mark=prices[p.symbol] ?: p.lastPriceDecimal.toBigDecimal()
            require(mark>BigDecimal.ZERO)
            val qty=p.quantityDecimal.toBigDecimal()
            marketValue=marketValue.add(mark.multiply(qty,VP_MC),VP_MC)
            unrealized=unrealized.add(
                mark.multiply(qty,VP_MC).subtract(p.costDecimal.toBigDecimal(),VP_MC),VP_MC
            )
            dao.updatePortfolioPosition(p.copy(lastPriceDecimal=mark.toPlainString(),lastMarkedAtUtc=at.toString()))
        }
        val cash=state.cashDecimal.toBigDecimal()
        val equity=cash.add(marketValue,VP_MC)
        val exposure=if(equity.signum()>0) marketValue.divide(equity,VP_MC) else BigDecimal.ZERO
        val snapshot=PortfolioSnapshotEntity(
            at.toString(),cash.toPlainString(),state.realizedPnlDecimal,
            unrealized.toPlainString(),equity.toPlainString(),exposure.toPlainString(),null
        )
        dao.putPortfolioSnapshot(snapshot)
        return snapshot
    }

    private suspend fun buy(event:QualifiedLifecycleEvent,signalId:String,idempotencyKey:String):Boolean {
        if(dao.portfolioPositions().any{it.symbol==event.symbol}) return false
        val at=event.at
        val state=ensureState(at)
        val cash=state.cashDecimal.toBigDecimal()
        if(cash<=BigDecimal.ZERO) return false
        if(dao.portfolioTransactionByIdempotencyKey(idempotencyKey)!=null) return false
        val grossTarget=minOf(policy.defaultPosition,cash)
        val feeRate=policy.commissionBps.divide(BigDecimal("10000"),VP_MC)
        val slipRate=policy.slippageBps.divide(BigDecimal("10000"),VP_MC)
        val fillPrice=event.price.multiply(BigDecimal.ONE.add(slipRate,VP_MC),VP_MC)
        val grossAffordable=cash.divide(BigDecimal.ONE.add(feeRate,VP_MC),VP_MC)
        val gross=minOf(grossTarget,grossAffordable)
        if(gross<=BigDecimal.ZERO || fillPrice<=BigDecimal.ZERO) return false
        val fee=gross.multiply(feeRate,VP_MC)
        val total=gross.add(fee,VP_MC)
        val qty=gross.divide(fillPrice,VP_MC)
        val tx=PortfolioTransactionEntity(
            id=UUID.randomUUID().toString(),
            idempotencyKey=idempotencyKey,
            atUtc=at.toString(),
            type="BUY",
            symbol=event.symbol,
            quantityDecimal=qty.toPlainString(),
            priceDecimal=fillPrice.toPlainString(),
            grossAmountDecimal=gross.toPlainString(),
            feeDecimal=fee.toPlainString(),
            cashDeltaDecimal=total.negate().toPlainString(),
            realizedPnlDecimal=null,
            reason=event.reason,
            sourceSignalId=signalId
        )
        val position=PortfolioPositionEntity(
            event.symbol,qty.toPlainString(),total.toPlainString(),fillPrice.toPlainString(),
            at.toString(),fillPrice.toPlainString(),at.toString(),gross.toPlainString(),signalId
        )
        val next=state.copy(
            cashDecimal=cash.subtract(total,VP_MC).toPlainString(),
            lastUpdatedAtUtc=at.toString()
        )
        dao.applyPortfolioBuy(next,position,tx)
        return true
    }

    private suspend fun sell(event:QualifiedLifecycleEvent,signalId:String,idempotencyKey:String):Boolean {
        if(dao.portfolioTransactionByIdempotencyKey(idempotencyKey)!=null) return false
        val position=dao.portfolioPositions().firstOrNull{it.symbol==event.symbol} ?: return false
        if(event.price<=BigDecimal.ZERO) return false
        val at=event.at
        val state=ensureState(at)
        val qty=position.quantityDecimal.toBigDecimal()
        val slipRate=policy.slippageBps.divide(BigDecimal("10000"),VP_MC)
        val fillPrice=event.price.multiply(BigDecimal.ONE.subtract(slipRate,VP_MC),VP_MC)
        require(fillPrice>BigDecimal.ZERO)
        val gross=qty.multiply(fillPrice,VP_MC)
        val fee=gross.multiply(policy.commissionBps.divide(BigDecimal("10000"),VP_MC),VP_MC)
        val proceeds=gross.subtract(fee,VP_MC)
        val realized=proceeds.subtract(position.costDecimal.toBigDecimal(),VP_MC)
        val tx=PortfolioTransactionEntity(
            id=UUID.randomUUID().toString(),
            idempotencyKey=idempotencyKey,
            atUtc=at.toString(),
            type="SELL",
            symbol=event.symbol,
            quantityDecimal=qty.toPlainString(),
            priceDecimal=fillPrice.toPlainString(),
            grossAmountDecimal=gross.toPlainString(),
            feeDecimal=fee.toPlainString(),
            cashDeltaDecimal=proceeds.toPlainString(),
            realizedPnlDecimal=realized.toPlainString(),
            reason=event.reason,
            sourceSignalId=signalId
        )
        val next=state.copy(
            cashDecimal=state.cashDecimal.toBigDecimal().add(proceeds,VP_MC).toPlainString(),
            realizedPnlDecimal=state.realizedPnlDecimal.toBigDecimal().add(realized,VP_MC).toPlainString(),
            lastUpdatedAtUtc=at.toString()
        )
        dao.applyPortfolioSell(next,event.symbol,tx)
        return true
    }

    private suspend fun ensureState(at:Instant):PortfolioStateEntity {
        dao.portfolioState()?.let{return it}
        val state=PortfolioStateEntity(
            startingCapitalDecimal=policy.startingCapital.toPlainString(),
            cashDecimal=policy.startingCapital.toPlainString(),
            realizedPnlDecimal=BigDecimal.ZERO.toPlainString(),
            defaultPositionDecimal=policy.defaultPosition.toPlainString(),
            createdAtUtc=at.toString(),resetAtUtc=at.toString(),lastUpdatedAtUtc=at.toString()
        )
        dao.putPortfolioState(state)
        return state
    }
}
