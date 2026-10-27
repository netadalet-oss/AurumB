package io.aurum.aurumb.learning

import io.aurum.aurumb.criteria.AurumBCriteriaCatalog
import io.aurum.aurumb.criteria.CriterionResult
import io.aurum.aurumb.selection.CandidateEvidence
import io.aurum.aurumb.selection.LegacyTargetProbability
import io.aurum.aurumb.selection.SelectionEngine
import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import java.time.Instant
import kotlin.math.ln

private val MV_MC=MathContext(18,RoundingMode.HALF_EVEN)

data class ModelValidationObservation(
    val id:String,
    val runId:String,
    val decisionAt:Instant,
    val realizedAt:Instant,
    val criterionScores:Map<String,BigDecimal>,
    val executionRisk:BigDecimal,
    val netReturn:BigDecimal,
    val hit:Boolean,
    val regime:String
)

private data class ScoredObservation(
    val row:ModelValidationObservation,
    val score:BigDecimal
)

object ModelValidator {
    fun evaluate(
        weights:Map<String,BigDecimal>,
        observations:List<ModelValidationObservation>,
        topN:Int=20
    ):ValidationMetrics {
        require(topN>0)
        require(weights.keys==(1..7).map{"K$it"}.toSet())
        require(weights.values.fold(BigDecimal.ZERO,BigDecimal::add)
            .subtract(BigDecimal.ONE).abs()<=BigDecimal("0.00001"))

        val valid=observations.filter { row ->
            row.realizedAt.isAfter(row.decisionAt) &&
                row.executionRisk in BigDecimal.ZERO..BigDecimal.ONE &&
                row.netReturn>=BigDecimal("-1") &&
                row.criterionScores.keys.containsAll(weights.keys) &&
                weights.keys.all { id ->
                    row.criterionScores[id]?.let{it in BigDecimal.ZERO..BigDecimal("100")}==true
                }
        }
        if(valid.isEmpty()) return emptyMetrics()

        val specs=AurumBCriteriaCatalog.decision.map { spec ->
            spec.copy(baseWeight=weights.getValue(spec.id))
        }
        val groups=valid.groupBy{it.runId}.values
            .map { rows ->
                val byId=rows.associateBy{it.id}
                val ranked=SelectionEngine(specs).rank(
                    rows.map { row ->
                        CandidateEvidence(
                            symbol=row.id,
                            results=row.criterionScores.mapValues { (id,score) ->
                                CriterionResult(id,score,true)
                            },
                            executionRisk=row.executionRisk
                        )
                    }
                )
                ranked.mapNotNull { selection ->
                    byId[selection.symbol]?.let { row ->
                        ScoredObservation(row,selection.score)
                    }
                }
            }
            .sortedBy { it.minOf{s->s.row.decisionAt} }

        val selected=groups.flatMap{it.take(topN)}
        if(selected.isEmpty()) return emptyMetrics()

        val utility=selected.map{it.row.netReturn}.averageDecimal()
        val precision=BigDecimal(selected.count{it.row.hit})
            .divide(BigDecimal(selected.size),MV_MC)
        val ndcg=groups.map{ndcg(it)}.averageDecimal()
        val calibration=expectedCalibrationError(selected,5)
        val runReturns=groups.map { group ->
            group.take(topN).map{it.row.netReturn}.averageDecimal()
        }
        val drawdown=maxDrawdown(runReturns)
        val stability=BigDecimal(runReturns.count{it>=BigDecimal.ZERO})
            .divide(BigDecimal(runReturns.size),MV_MC)

        return ValidationMetrics(
            sampleCount=selected.size,
            regimeCount=selected.map{it.row.regime}.distinct().size,
            netEconomicUtility=utility,
            maxDrawdown=drawdown,
            precisionAtN=precision,
            ndcg=ndcg,
            calibrationError=calibration,
            stability=stability
        )
    }

    private fun ndcg(group:List<ScoredObservation>):BigDecimal {
        if(group.isEmpty()) return BigDecimal.ZERO
        fun discount(index:Int):Double = ln(2.0)/ln(index+2.0)
        val dcg=group.mapIndexed { index,item ->
            (if(item.row.hit)1.0 else 0.0)*discount(index)
        }.sum()
        val relevant=group.count{it.row.hit}
        if(relevant==0) return BigDecimal.ZERO
        val ideal=(0 until relevant).sumOf{discount(it)}
        return BigDecimal.valueOf((dcg/ideal).coerceIn(0.0,1.0))
    }

    /**
     * Five-bin expected calibration error. Predictions are the canonical legacy-compatible prior;
     * empirical evidence is only used for evaluation here, never to rewrite historical scores.
     */
    private fun expectedCalibrationError(
        selected:List<ScoredObservation>,
        bins:Int
    ):BigDecimal {
        require(bins>0)
        var weighted=0.0
        for(bin in 0 until bins) {
            val lo=bin.toDouble()/bins
            val hi=(bin+1).toDouble()/bins
            val rows=selected.map { item ->
                item to LegacyTargetProbability.prior(item.score).toDouble()
            }.filter { (_,p) ->
                if(bin==bins-1) p>=lo && p<=hi else p>=lo && p<hi
            }
            if(rows.isEmpty()) continue
            val predicted=rows.map{it.second}.average()
            val actual=rows.count{it.first.row.hit}.toDouble()/rows.size
            weighted += rows.size.toDouble()/selected.size * kotlin.math.abs(predicted-actual)
        }
        return BigDecimal.valueOf(weighted.coerceIn(0.0,1.0))
    }

    private fun maxDrawdown(returns:List<BigDecimal>):BigDecimal {
        var equity=BigDecimal.ONE
        var peak=BigDecimal.ONE
        var maxDd=BigDecimal.ZERO
        for(r in returns) {
            equity=equity.multiply(BigDecimal.ONE.add(r.coerceAtLeast(BigDecimal("-1")),MV_MC),MV_MC)
            if(equity>peak) peak=equity
            if(peak.signum()>0) {
                val dd=BigDecimal.ONE.subtract(equity.divide(peak,MV_MC),MV_MC)
                if(dd>maxDd) maxDd=dd
            }
        }
        return maxDd.coerceIn(BigDecimal.ZERO,BigDecimal.ONE)
    }

    private fun emptyMetrics()=ValidationMetrics(
        sampleCount=0,
        regimeCount=0,
        netEconomicUtility=BigDecimal.ZERO,
        maxDrawdown=BigDecimal.ONE,
        precisionAtN=BigDecimal.ZERO,
        ndcg=BigDecimal.ZERO,
        calibrationError=BigDecimal.ONE,
        stability=BigDecimal.ZERO
    )

    private fun List<BigDecimal>.averageDecimal():BigDecimal =
        if(isEmpty()) BigDecimal.ZERO
        else fold(BigDecimal.ZERO,BigDecimal::add).divide(BigDecimal(size),MV_MC)
}
