package io.aurum.aurumb.selection

import io.aurum.aurumb.criteria.*
import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

private val MC=MathContext(18,RoundingMode.HALF_EVEN)

internal fun blendSelectionScores(raw:BigDecimal,rank:BigDecimal):BigDecimal =
    raw.multiply(BigDecimal(".30"),MC).add(rank.multiply(BigDecimal(".70"),MC),MC)

data class CandidateEvidence(
    val symbol:String,
    val results:Map<String,CriterionResult>,
    val executionRisk:BigDecimal=BigDecimal.ZERO
)

data class Contribution(
    val criterionId:String,
    val score:BigDecimal,
    val weight:BigDecimal,
    val criterionRank:Int,
    val rankScore:BigDecimal,
    val rawContribution:BigDecimal,
    val rankContribution:BigDecimal,
    val contribution:BigDecimal
)

data class SelectionRow(
    val symbol:String,
    val score:BigDecimal,
    val rank:Int,
    val contributions:List<Contribution>,
    val rawWeightedScore:BigDecimal,
    val rankWeightedScore:BigDecimal,
    val consensusScore:BigDecimal,
    val executionRisk:BigDecimal
)

class SelectionEngine(private val specs:List<CriterionSpec> = AurumBCriteriaCatalog.decision){
    init {
        require(specs.isNotEmpty())
        require(specs.map{it.id}.distinct().size==specs.size)
        require(specs.all{it.role==CriterionRole.DECISION&&it.baseWeight.signum()>0})
        val sum=specs.fold(BigDecimal.ZERO){a,s->a+s.baseWeight}
        require(sum.subtract(BigDecimal.ONE).abs()<=BigDecimal("0.00001"))
    }

    fun rank(candidates:List<CandidateEvidence>):List<SelectionRow> {
        require(candidates.map{it.symbol}.distinct().size==candidates.size)
        val eligible=candidates.filter { c ->
            c.executionRisk>=BigDecimal.ZERO && c.executionRisk<=BigDecimal.ONE &&
            specs.all { spec ->
                val r=c.results[spec.id]
                r?.eligible==true && r.score!=null &&
                    r.score>=BigDecimal.ZERO && r.score<=BigDecimal("100")
            }
        }
        if(eligible.isEmpty()) return emptyList()

        val rankMaps=specs.associate { spec ->
            val ordered=eligible.sortedWith(
                compareByDescending<CandidateEvidence>{it.results[spec.id]!!.score!!}
                    .thenBy{it.symbol}
            )
            spec.id to ordered.mapIndexed { index,c ->
                val rankScore=if(ordered.size<=1) BigDecimal("50")
                else BigDecimal("100").multiply(
                    BigDecimal.ONE.subtract(
                        BigDecimal(index).divide(BigDecimal(ordered.size-1),MC),MC
                    ),MC
                )
                c.symbol to ((index+1) to rankScore)
            }.toMap()
        }

        val rows=eligible.map { c ->
            val contributions=specs.map { spec ->
                val score=c.results[spec.id]!!.score!!
                val rankPair=rankMaps[spec.id]!![c.symbol]!!
                val raw=score.multiply(spec.baseWeight,MC)
                val rank=rankPair.second.multiply(spec.baseWeight,MC)
                val combined=blendSelectionScores(raw,rank)
                Contribution(
                    spec.id,score,spec.baseWeight,rankPair.first,rankPair.second,
                    raw,rank,combined
                )
            }
            val rawScore=contributions.fold(BigDecimal.ZERO){a,x->a.add(x.rawContribution,MC)}
            val rankScore=contributions.fold(BigDecimal.ZERO){a,x->a.add(x.rankContribution,MC)}
            val consensus=blendSelectionScores(rawScore,rankScore)
            val finalScore=consensus.subtract(
                BigDecimal("12").multiply(c.executionRisk,MC),MC
            ).coerceIn(BigDecimal.ZERO,BigDecimal("100"))
            SelectionRow(
                c.symbol,
                finalScore.setScale(8,RoundingMode.HALF_EVEN),
                0,
                contributions,
                rawScore,
                rankScore,
                consensus,
                c.executionRisk
            )
        }.sortedWith(
            compareByDescending<SelectionRow>{it.score}
                .thenByDescending{it.consensusScore}
                .thenBy{it.symbol}
        )
        return rows.mapIndexed{i,r->r.copy(rank=i+1)}
    }
}
