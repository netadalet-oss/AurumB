package io.aurum.aurumb.portfolio

import io.aurum.aurumb.persistence.AurumDao
import java.math.BigDecimal

data class PortfolioIntegrityReport(
    val valid:Boolean,
    val reasons:List<String>
)

class PortfolioIntegrityService(private val dao:AurumDao) {
    suspend fun inspect():PortfolioIntegrityReport {
        val reasons=mutableListOf<String>()
        val state=dao.portfolioState()
        val positions=dao.portfolioPositions()
        val transactions=dao.portfolioTransactions()
        val signals=dao.allSignals().associateBy{it.id}
        val qualified=dao.qualifiedTradeStates().associateBy{it.symbol}

        val cash=state?.cashDecimal?.toBigDecimalOrNull()
        if(state!=null && cash==null) {
            reasons+="INVALID_CASH"
        } else if(cash!=null && cash<BigDecimal.ZERO) {
            reasons+="NEGATIVE_CASH"
        }

        for(p in positions) {
            val qty=p.quantityDecimal.toBigDecimalOrNull()
            val cost=p.costDecimal.toBigDecimalOrNull()
            val entry=p.entryPriceDecimal.toBigDecimalOrNull()
            val last=p.lastPriceDecimal.toBigDecimalOrNull()
            if(qty==null || qty<=BigDecimal.ZERO) reasons+="INVALID_POSITION_QTY:"+p.symbol
            if(cost==null || cost<BigDecimal.ZERO) reasons+="INVALID_POSITION_COST:"+p.symbol
            if(entry==null || entry<=BigDecimal.ZERO) reasons+="INVALID_POSITION_ENTRY:"+p.symbol
            if(last==null || last<=BigDecimal.ZERO) reasons+="INVALID_POSITION_MARK:"+p.symbol
            val source=signals[p.sourceSignalId]
            if(source==null || source.signal!="BUY" || source.instrument!=p.symbol) {
                reasons+="POSITION_SOURCE_SIGNAL_MISMATCH:"+p.symbol
            }
            if(qualified[p.symbol]?.status!="BUY") {
                reasons+="POSITION_WITHOUT_ACTIVE_BUY_STATE:"+p.symbol
            }
        }

        val ids=transactions.map{it.id}
        if(ids.distinct().size!=ids.size) reasons+="DUPLICATE_TRANSACTION_ID"
        val keys=transactions.map{it.idempotencyKey}
        if(keys.distinct().size!=keys.size) reasons+="DUPLICATE_IDEMPOTENCY_KEY"
        transactions.forEach { tx ->
            val source=tx.sourceSignalId?.let(signals::get)
            if(source==null || source.instrument!=tx.symbol || source.signal!=tx.type) {
                reasons+="TRANSACTION_SOURCE_SIGNAL_MISMATCH:"+tx.id
            }
        }

        return PortfolioIntegrityReport(reasons.isEmpty(),reasons.distinct().sorted())
    }
}
