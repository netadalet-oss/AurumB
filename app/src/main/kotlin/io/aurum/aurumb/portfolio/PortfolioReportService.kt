package io.aurum.aurumb.portfolio

import io.aurum.aurumb.persistence.AurumDao
import io.aurum.aurumb.persistence.PortfolioPositionEntity
import io.aurum.aurumb.persistence.PortfolioTransactionEntity
import java.math.BigDecimal
import java.math.MathContext

private val PR_MC=MathContext.DECIMAL128

data class PortfolioReport(
    val cash:BigDecimal,
    val equity:BigDecimal,
    val realizedPnl:BigDecimal,
    val unrealizedPnl:BigDecimal,
    val exposure:BigDecimal,
    val maximumDrawdown:BigDecimal,
    val hitRate:BigDecimal?,
    val expectancy:BigDecimal?,
    val turnover:BigDecimal,
    val positions:List<PortfolioPositionEntity>,
    val transactions:List<PortfolioTransactionEntity>
)

class PortfolioReportService(private val dao:AurumDao) {
    suspend fun report():PortfolioReport? {
        val latest=dao.latestPortfolioSnapshot() ?: return null
        val snapshots=dao.portfolioSnapshots()
        val transactions=dao.portfolioTransactions()
        val sells=transactions.filter{it.type=="SELL" && it.realizedPnlDecimal!=null}
        val closed=sells.map { tx ->
            ClosedTradeMetric(
                realizedPnl=tx.realizedPnlDecimal!!.toBigDecimal(),
                costBasis=tx.grossAmountDecimal.toBigDecimal()
            )
        }
        val equities=snapshots.map{EquityPoint(it.equityDecimal.toBigDecimal())}
        val gross=transactions.fold(BigDecimal.ZERO){a,x->a.add(x.grossAmountDecimal.toBigDecimal(),PR_MC)}
        val avgEq=if(equities.isEmpty())latest.equityDecimal.toBigDecimal()
        else equities.fold(BigDecimal.ZERO){a,x->a.add(x.equity,PR_MC)}
            .divide(BigDecimal(equities.size),PR_MC)
        val metrics=PortfolioMetrics.calculate(closed,equities,gross,avgEq)
        return PortfolioReport(
            cash=latest.cashDecimal.toBigDecimal(),
            equity=latest.equityDecimal.toBigDecimal(),
            realizedPnl=latest.realizedPnlDecimal.toBigDecimal(),
            unrealizedPnl=latest.unrealizedPnlDecimal.toBigDecimal(),
            exposure=latest.exposureDecimal.toBigDecimal(),
            maximumDrawdown=metrics.maximumDrawdown,
            hitRate=metrics.hitRate,
            expectancy=metrics.expectancy,
            turnover=metrics.turnover,
            positions=dao.portfolioPositions(),
            transactions=transactions
        )
    }
}
