package io.aurum.aurumb.backtest

import io.aurum.aurumb.criteria.CriterionResult
import io.aurum.aurumb.formula.AurumBFeatures
import io.aurum.aurumb.formula.AurumBFormulaEngine
import io.aurum.aurumb.market.PointInTime
import io.aurum.aurumb.market.TimedFact
import io.aurum.aurumb.selection.CandidateEvidence
import io.aurum.aurumb.selection.SelectionEngine
import io.aurum.common.eligibility.ExtremeMoveEligibility
import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import java.time.Instant

private val MC = MathContext(18, RoundingMode.HALF_EVEN)

data class PriceFact(val symbol:String,val price:BigDecimal)
data class BacktestInput(
    val asOf:Instant,
    val features:List<AurumBFeatures>,
    val prices:List<TimedFact<PriceFact>>,
    val futureExitPrices:List<TimedFact<PriceFact>>,
    val topN:Int,
    val costModel:EquityCostModel,
    val maxDailyMovePct:BigDecimal=ExtremeMoveEligibility.MAX_ABS_MOVE_PCT
)
data class BacktestTrade(
    val symbol:String,
    val entryAsOf:Instant,
    val entryPrice:BigDecimal,
    val exitPrice:BigDecimal,
    val grossReturn:BigDecimal,
    val netReturn:BigDecimal
)
data class BacktestResult(val asOf:Instant,val selected:List<String>,val trades:List<BacktestTrade>)

object BacktestEngine {
    fun run(input:BacktestInput):BacktestResult {
        require(input.topN > 0)
        val visibleEntries=PointInTime.visible(input.prices,input.asOf)
        PointInTime.assertNoLeakage(visibleEntries,input.asOf)
        val entryBySymbol=visibleEntries.groupBy{it.value.symbol}.mapValues{(_,rows)->rows.maxBy{it.effectiveAt}.value.price}
        val eligibleFeatures=input.features.filter { feature ->
            ExtremeMoveEligibility.assess(
                currentMovePct=null,dailyMovePct=feature.dayChange,maxAbsMovePct=input.maxDailyMovePct
            ).eligible
        }
        val formula=AurumBFormulaEngine.score(eligibleFeatures)
        val candidates=formula.map { row ->
            CandidateEvidence(row.symbol,row.scores.mapValues{(k,v)->CriterionResult(k,v,v!=null,if(v==null)"missing formula output" else null)})
        }
        val ranked=SelectionEngine().rank(candidates).take(input.topN)
        val trades=ranked.mapNotNull { selection ->
            val entry=entryBySymbol[selection.symbol] ?: return@mapNotNull null
            require(entry > BigDecimal.ZERO) { "entry price <= 0" }
            val exits=input.futureExitPrices.filter {
                it.value.symbol==selection.symbol && it.effectiveAt.isAfter(input.asOf) && !it.availableAt.isBefore(it.effectiveAt)
            }.sortedBy{it.effectiveAt}
            val exit=exits.firstOrNull()?.value?.price ?: return@mapNotNull null
            require(exit > BigDecimal.ZERO) { "exit price <= 0" }
            val gross=exit.divide(entry,MC).subtract(BigDecimal.ONE,MC)
            require(gross >= BigDecimal("-1")) { "impossible long-only return" }
            BacktestTrade(selection.symbol,input.asOf,entry,exit,gross,input.costModel.netReturn(gross))
        }
        return BacktestResult(input.asOf,ranked.map{it.symbol},trades)
    }
}
