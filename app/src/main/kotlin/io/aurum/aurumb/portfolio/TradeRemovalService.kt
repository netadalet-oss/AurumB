package io.aurum.aurumb.portfolio

import io.aurum.aurumb.persistence.*
import io.aurum.common.model.AurumVersions
import org.json.JSONObject
import java.math.BigDecimal
import java.time.Instant
import java.util.UUID

class TradeRemovalService(private val dao:AurumDao, private val clock:()->Instant={Instant.now()}) {
    suspend fun removeInstrument(symbol:String):Int {
        val signals=dao.signalsForInstrument(symbol)
        val existingTransactions=dao.portfolioTransactions()
        val existingPosition=dao.portfolioPositions().any{it.symbol==symbol}
        val existingQualified=dao.qualifiedTradeStates().any{it.symbol==symbol}
        if(signals.isEmpty() && existingTransactions.none{it.symbol==symbol} && !existingPosition && !existingQualified) return 0
        val now=clock()
        val tombstones=signals.map {
            TradeRemovalTombstoneEntity(it.id,symbol,now.toString(),"USER_REMOVE_AS_NEVER_TRADED")
        }
        val removedIds=signals.map{it.id}.toSet()
        val remaining=existingTransactions.filter { tx ->
            tx.symbol!=symbol && (tx.sourceSignalId==null || tx.sourceSignalId !in removedIds)
        }.sortedWith(compareBy<PortfolioTransactionEntity>{it.atUtc}.thenBy{it.id})
        val old=dao.portfolioState() ?: throw IllegalStateException("Portfolio state evidence unavailable; removal fails closed")
        val starting=old.startingCapitalDecimal.toBigDecimalOrNull()?.takeIf{it>BigDecimal.ZERO}
            ?: throw IllegalStateException("Invalid starting capital evidence")
        val defaultPosition=old.defaultPositionDecimal.toBigDecimalOrNull()?.takeIf{it>BigDecimal.ZERO}
            ?: throw IllegalStateException("Invalid default position evidence")
        var cash=starting
        var realized=BigDecimal.ZERO
        val positions=linkedMapOf<String,PortfolioPositionEntity>()
        val replaySnapshots=mutableListOf<PortfolioSnapshotEntity>()
        for(tx in remaining) {
            require(tx.type=="BUY" || tx.type=="SELL") { "Unsupported portfolio transaction type: "+tx.type }
            val cashDelta=tx.cashDeltaDecimal.toBigDecimalOrNull() ?: throw IllegalStateException("Invalid cash delta evidence")
            cash=cash.add(cashDelta)
            if(tx.realizedPnlDecimal!=null) {
                val pnl=tx.realizedPnlDecimal.toBigDecimalOrNull() ?: throw IllegalStateException("Invalid realized P/L evidence")
                realized=realized.add(pnl)
            }
            when(tx.type) {
                "BUY" -> {
                    require(positions[tx.symbol]==null) { "Duplicate BUY without SELL for "+tx.symbol }
                    val qty=tx.quantityDecimal.toBigDecimalOrNull()?.takeIf{it>BigDecimal.ZERO}
                        ?: throw IllegalStateException("Invalid BUY quantity evidence")
                    val price=tx.priceDecimal.toBigDecimalOrNull()?.takeIf{it>BigDecimal.ZERO}
                        ?: throw IllegalStateException("Invalid BUY price evidence")
                    val gross=tx.grossAmountDecimal.toBigDecimalOrNull()
                        ?: throw IllegalStateException("Invalid BUY gross evidence")
                    val fee=tx.feeDecimal.toBigDecimalOrNull()
                        ?: throw IllegalStateException("Invalid BUY fee evidence")
                    positions[tx.symbol]=PortfolioPositionEntity(
                        tx.symbol,qty.toPlainString(),gross.add(fee).toPlainString(),
                        price.toPlainString(),tx.atUtc,price.toPlainString(),tx.atUtc,
                        gross.toPlainString(),tx.sourceSignalId?:""
                    )
                }
                "SELL" -> require(positions.remove(tx.symbol)!=null) { "SELL without active BUY for "+tx.symbol }
            }
            var replayMarketValue=BigDecimal.ZERO
            var replayUnrealized=BigDecimal.ZERO
            positions.values.forEach { p ->
                val mark=p.lastPriceDecimal.toBigDecimalOrNull()?.takeIf{it>BigDecimal.ZERO}
                    ?: throw IllegalStateException("Invalid replay mark evidence for "+p.symbol)
                val value=mark.multiply(p.quantityDecimal.toBigDecimal())
                replayMarketValue=replayMarketValue.add(value)
                replayUnrealized=replayUnrealized.add(value.subtract(p.costDecimal.toBigDecimal()))
            }
            val replayEquity=cash.add(replayMarketValue)
            val replayExposure=if(replayEquity.signum()>0) replayMarketValue.divide(replayEquity,java.math.MathContext.DECIMAL128) else BigDecimal.ZERO
            replaySnapshots+=PortfolioSnapshotEntity(
                tx.atUtc,cash.toPlainString(),realized.toPlainString(),replayUnrealized.toPlainString(),
                replayEquity.toPlainString(),replayExposure.toPlainString(),null
            )
        }
        val rebuilt=PortfolioStateEntity(
            startingCapitalDecimal=starting.toPlainString(),cashDecimal=cash.toPlainString(),
            realizedPnlDecimal=realized.toPlainString(),defaultPositionDecimal=defaultPosition.toPlainString(),
            createdAtUtc=old.createdAtUtc,resetAtUtc=old.resetAtUtc,lastUpdatedAtUtc=now.toString()
        )
        val oldPositions=dao.portfolioPositions().associateBy{it.symbol}
        val restoredPositions=positions.values.map { replayed ->
            val persisted=oldPositions[replayed.symbol]
            if(persisted!=null && persisted.sourceSignalId==replayed.sourceSignalId) replayed.copy(
                lastPriceDecimal=persisted.lastPriceDecimal,
                lastMarkedAtUtc=persisted.lastMarkedAtUtc
            ) else replayed
        }
        var marketValue=BigDecimal.ZERO
        var unrealized=BigDecimal.ZERO
        restoredPositions.forEach { p ->
            val mark=p.lastPriceDecimal.toBigDecimal()
            require(mark>BigDecimal.ZERO) { "Invalid persisted mark for "+p.symbol }
            val value=mark.multiply(p.quantityDecimal.toBigDecimal())
            marketValue=marketValue.add(value)
            unrealized=unrealized.add(value.subtract(p.costDecimal.toBigDecimal()))
        }
        val equity=cash.add(marketValue)
        val exposure=if(equity.signum()>0) marketValue.divide(equity,java.math.MathContext.DECIMAL128) else BigDecimal.ZERO
        val currentSnapshot=PortfolioSnapshotEntity(
            now.toString(),cash.toPlainString(),realized.toPlainString(),unrealized.toPlainString(),
            equity.toPlainString(),exposure.toPlainString(),null
        )
        val snapshots=(replaySnapshots+currentSnapshot).associateBy{it.atUtc}.values.sortedBy{it.atUtc}
        val audit=AuditEventEntity(
            UUID.randomUUID().toString(),now.toString(),"INFO","qualified-trade","manual-remove:"+symbol,
            "TRADE_REMOVED_AS_NEVER_TRADED",symbol+" · AL/SAT ve sanal portföy etkileri kaldırıldı; kalan portföy geçmişi yeniden hesaplandı.",
            JSONObject(mapOf("symbol" to symbol,"removedSignalCount" to signals.size,"remainingTransactionCount" to remaining.size)).toString(),
            AurumVersions.APP,signals.lastOrNull()?.modelVersion?:AurumVersions.MODEL,
            signals.lastOrNull()?.formulaVersion?:AurumVersions.FORMULA,AurumVersions.DATA_SCHEMA,
            JSONObject(mapOf("source" to "MANUAL_PRODUCT_CARD","tombstonedSignalIds" to signals.map{it.id})).toString()
        )
        dao.commitTradeRemoval(tombstones,rebuilt,restoredPositions,remaining,snapshots,symbol,signals.map{it.id},audit)
        return signals.size
    }
}
