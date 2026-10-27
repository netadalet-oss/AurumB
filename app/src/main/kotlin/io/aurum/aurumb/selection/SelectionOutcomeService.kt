package io.aurum.aurumb.selection

import io.aurum.aurumb.backtest.EquityCostModel
import io.aurum.aurumb.persistence.AurumDao
import io.aurum.aurumb.persistence.MarketBarEntity
import io.aurum.aurumb.persistence.SelectionOutcomeEntity
import io.aurum.aurumb.pipeline.PipelineSettings
import io.aurum.common.eligibility.ExtremeMoveEligibility
import io.aurum.common.model.AurumVersions
import org.json.JSONArray
import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

private val SO_MC=MathContext(18,RoundingMode.HALF_EVEN)

data class OutcomeEvaluationSummary(
    val evaluated:Int,
    val pending:Int,
    val skipped:Int
)

class SelectionOutcomeService(
    private val dao:AurumDao,
    private val clock:()->Instant={Instant.now()}
) {
    private val zone=ZoneId.of("Europe/Istanbul")

    suspend fun evaluateMatured(settings:PipelineSettings,runLimit:Int=500):OutcomeEvaluationSummary {
        require(runLimit in 1..5000)
        val now=clock()
        val cost=EquityCostModel(
            commissionBps=settings.commissionBps,
            halfSpreadBps=BigDecimal.ZERO,
            slippageBps=settings.slippageBps,
            taxAndFeesBps=BigDecimal.ZERO
        )
        var evaluated=0
        var pending=0
        var skipped=0

        val runs=dao.recentRuns(runLimit).sortedBy{it.asOfUtc}
        for(run in runs) {
            if(!run.integrityPassed) {
                skipped += dao.selectionsForRun(run.id).count{it.scoreDecimal.toBigDecimalOrNull()?.let{v->v>BigDecimal.ZERO}==true}
                continue
            }
            val decisionAt=runCatching{Instant.parse(run.asOfUtc)}.getOrNull()
            if(decisionAt==null || decisionAt.isAfter(now)) {
                skipped += dao.selectionsForRun(run.id).count{it.rank>0}
                continue
            }

            val selections=dao.selectionsForRun(run.id)
                .filter { row ->
                    val blocked=row.rejectionReason?.let {
                        it.startsWith("DATA_ROW_COMPLETENESS_BELOW_GATE") ||
                        it.startsWith("DATA_COLUMN_COMPLETENESS_BELOW_GATE") ||
                        it.startsWith("DATA_TABLE_COMPLETENESS_BELOW_GATE") ||
                        it.startsWith("DATA_ROW_COMPLETENESS_LT_70") ||
                        it.startsWith("DATA_COLUMN_COMPLETENESS_LT_70") ||
                        it.startsWith("DATA_TABLE_COMPLETENESS_LT_70")
                    }==true
                    !blocked && row.scoreDecimal.toBigDecimalOrNull()?.let{v->v>BigDecimal.ZERO}==true
                }
                .sortedWith(compareByDescending<io.aurum.aurumb.persistence.SelectionResultEntity>{
                    it.scoreDecimal.toBigDecimalOrNull()?:BigDecimal.ZERO
                }.thenBy{it.symbol})
            for(selection in selections) {
                if(dao.selectionOutcome(run.id,selection.symbol)!=null) continue
                val all=dao.marketBars(selection.symbol,now.toString())
                val future=nextSessions(all,decisionAt)
                if(future.size<2) {
                    pending++
                    continue
                }

                val entryBar=future[0]
                val exitBar=future[1]
                val entry=entryBar.openDecimal?.toBigDecimalOrNull()
                val exit=exitBar.closeDecimal.toBigDecimalOrNull()
                val highs=future.take(2).mapNotNull{it.highDecimal?.toBigDecimalOrNull()}
                if(entry==null || entry<=BigDecimal.ZERO || exit==null || exit<=BigDecimal.ZERO || highs.size<2) {
                    pending++
                    continue
                }
                val maxHigh=highs.maxOrNull()!!
                if(maxHigh<=BigDecimal.ZERO) {
                    pending++
                    continue
                }

                val gross=exit.divide(entry,SO_MC).subtract(BigDecimal.ONE,SO_MC)
                if(gross<BigDecimal("-1")) {
                    skipped++
                    continue
                }
                val net=cost.netReturn(gross)
                val maxGross=maxHigh.divide(entry,SO_MC).subtract(BigDecimal.ONE,SO_MC)
                val maxNet=cost.netReturn(maxGross)
                val targetFraction=settings.targetReturnPct.divide(BigDecimal("100"),SO_MC)
                val evaluatedAt=listOf(entryBar.receivedAtUtc,exitBar.receivedAtUtc)
                    .mapNotNull{runCatching{Instant.parse(it)}.getOrNull()}
                    .maxOrNull() ?: now
                if(evaluatedAt.isAfter(now)) {
                    pending++
                    continue
                }

                val decisionDayChange=decisionDayChange(selection.contributionsJson)
                val moveEligible=ExtremeMoveEligibility.assess(
                    currentMovePct=null,dailyMovePct=decisionDayChange,maxAbsMovePct=settings.maxDailyMovePct
                ).eligible
                val formulaEligible=run.formulaVersion==AurumVersions.FORMULA
                val eligible=formulaEligible &&
                    run.modelVersion.isNotBlank() &&
                    entryBar.atUtc<exitBar.atUtc &&
                    evaluatedAt.isAfter(decisionAt) &&
                    moveEligible

                dao.appendSelectionOutcome(
                    SelectionOutcomeEntity(
                        id=run.id+":"+selection.symbol,
                        runId=run.id,
                        symbol=selection.symbol,
                        decisionAtUtc=decisionAt.toString(),
                        evaluatedAtUtc=evaluatedAt.toString(),
                        entryAtUtc=entryBar.atUtc,
                        entryPriceDecimal=entry.toPlainString(),
                        exitAtUtc=exitBar.atUtc,
                        exitCloseDecimal=exit.toPlainString(),
                        maxHighDecimal=maxHigh.toPlainString(),
                        grossReturnDecimal=gross.toPlainString(),
                        netReturnDecimal=net.toPlainString(),
                        targetReturnPctDecimal=settings.targetReturnPct.toPlainString(),
                        targetHit=maxNet>=targetFraction,
                        decisionScoreDecimal=selection.scoreDecimal,
                        regime=run.marketRegime,
                        decisionWindow="NEXT_OPEN_2S",
                        modelVersion=run.modelVersion,
                        formulaVersion=run.formulaVersion,
                        eligibleForLearning=eligible,
                        ineligibilityReason=when {
                            eligible -> null
                            !formulaEligible -> "FORMULA_VERSION_INELIGIBLE"
                            !moveEligible -> "EXTREME_MOVE_GT_"+settings.maxDailyMovePct.stripTrailingZeros().toPlainString().replace(".","_")
                            else -> "OUTCOME_INTEGRITY"
                        }
                    )
                )
                evaluated++
            }
        }
        return OutcomeEvaluationSummary(evaluated,pending,skipped)
    }

    suspend fun calibrationEvidence(asOf:Instant):List<ProbabilityEvidence> =
        dao.eligibleSelectionOutcomesAsOf(asOf.toString()).mapNotNull { row ->
            val decision=runCatching{Instant.parse(row.decisionAtUtc)}.getOrNull() ?: return@mapNotNull null
            val evaluated=runCatching{Instant.parse(row.evaluatedAtUtc)}.getOrNull() ?: return@mapNotNull null
            val score=row.decisionScoreDecimal.toBigDecimalOrNull() ?: return@mapNotNull null
            if(row.formulaVersion!=AurumVersions.FORMULA) return@mapNotNull null
            if(evaluated.isAfter(asOf) || !evaluated.isAfter(decision)) return@mapNotNull null
            ProbabilityEvidence(
                id=row.id,
                decisionAt=decision,
                evaluatedAt=evaluated,
                score=score,
                hit=row.targetHit,
                regime=row.regime,
                decisionWindow=row.decisionWindow
            )
        }

    private fun decisionDayChange(contributionsJson:String):BigDecimal? {
        return runCatching {
            val rows=JSONArray(contributionsJson)
            for(i in 0 until rows.length()) {
                val row=rows.optJSONObject(i) ?: continue
                if(row.optString("criterion")!="K2") continue
                val inputs=row.optJSONObject("inputs") ?: return null
                if(inputs.isNull("dayChange")) return null
                return inputs.optString("dayChange").toBigDecimalOrNull()
            }
            null
        }.getOrNull()
    }

    private fun nextSessions(rows:List<MarketBarEntity>,decisionAt:Instant):List<MarketBarEntity> {
        val grouped=rows.asSequence()
            .filter { row ->
                val at=runCatching{Instant.parse(row.atUtc)}.getOrNull()
                at!=null && at.isAfter(decisionAt)
            }
            .groupBy { row ->
                LocalDate.ofInstant(Instant.parse(row.atUtc),zone)
            }
            .toSortedMap()

        return grouped.values.mapNotNull { sameDay ->
            sameDay.maxByOrNull { row -> row.receivedAtUtc }
        }.take(2)
    }
}
