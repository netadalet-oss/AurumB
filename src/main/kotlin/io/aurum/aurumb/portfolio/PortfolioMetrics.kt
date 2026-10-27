package io.aurum.aurumb.portfolio

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

private val PM_MC=MathContext(18,RoundingMode.HALF_EVEN)

data class ClosedTradeMetric(val realizedPnl:BigDecimal,val costBasis:BigDecimal)
data class EquityPoint(val equity:BigDecimal)
data class PortfolioPerformance(
    val realizedPnl:BigDecimal,
    val maximumDrawdown:BigDecimal,
    val hitRate:BigDecimal?,
    val expectancy:BigDecimal?,
    val turnover:BigDecimal,
    val closedTrades:Int
)

object PortfolioMetrics {
    fun calculate(
        closed:List<ClosedTradeMetric>,
        equity:List<EquityPoint>,
        grossTransactionValue:BigDecimal,
        averageEquity:BigDecimal
    ):PortfolioPerformance {
        require(grossTransactionValue>=BigDecimal.ZERO)
        require(averageEquity>=BigDecimal.ZERO)
        val realized=closed.fold(BigDecimal.ZERO){a,x->a.add(x.realizedPnl,PM_MC)}
        val wins=closed.count{it.realizedPnl>BigDecimal.ZERO}
        val hit=if(closed.isEmpty())null else BigDecimal(wins).divide(BigDecimal(closed.size),PM_MC)
        val expectancy=if(closed.isEmpty())null else realized.divide(BigDecimal(closed.size),PM_MC)
        var peak:BigDecimal?=null
        var mdd=BigDecimal.ZERO
        for(point in equity) {
            require(point.equity>=BigDecimal.ZERO)
            peak=if(peak==null || point.equity>peak)point.equity else peak
            val currentPeak=peak ?: continue
            if(currentPeak.signum()>0) {
                val dd=point.equity.divide(currentPeak,PM_MC).subtract(BigDecimal.ONE,PM_MC)
                if(dd<mdd)mdd=dd
            }
        }
        val turnover=if(averageEquity.signum()>0)
            grossTransactionValue.divide(averageEquity,PM_MC)
        else BigDecimal.ZERO
        return PortfolioPerformance(realized,mdd.abs(),hit,expectancy,turnover,closed.size)
    }
}
