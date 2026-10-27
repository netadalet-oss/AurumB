package io.aurum.aurumb.learning

import io.aurum.aurumb.criteria.AurumBCriteriaCatalog
import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import java.time.Instant

private val WL_MC=MathContext(18,RoundingMode.HALF_EVEN)

data class LearningSample(
    val id:String,
    val decisionAt:Instant,
    val realizedAt:Instant,
    val criterionScores:Map<String,BigDecimal>,
    val netReturn:BigDecimal,
    val regime:String
)

data class LearnedCandidate(
    val proposal:WeightProposal,
    val sampleCount:Int,
    val regimeCount:Int,
    val usedSampleIds:List<String>
)

data class WeightLearningPolicy(
    val minSamples:Int=30,
    val floor:BigDecimal=BigDecimal("0.05"),
    val ceiling:BigDecimal=BigDecimal("0.30"),
    val maxAdaptation:BigDecimal=BigDecimal("0.35")
) {
    init {
        require(minSamples>0)
        require(floor>=BigDecimal.ZERO && ceiling>floor)
        require(maxAdaptation>=BigDecimal.ZERO && maxAdaptation<=BigDecimal.ONE)
        require(floor.multiply(BigDecimal("7"))<=BigDecimal.ONE)
        require(ceiling.multiply(BigDecimal("7"))>=BigDecimal.ONE)
    }
}

object DeterministicWeightLearner {
    fun learn(
        samples:List<LearningSample>,
        asOf:Instant,
        policy:WeightLearningPolicy=WeightLearningPolicy()
    ):LearnedCandidate? {
        val ids=AurumBCriteriaCatalog.decision.map{it.id}
        val valid=samples.filter { s ->
            !s.realizedAt.isAfter(asOf) &&
            s.realizedAt.isAfter(s.decisionAt) &&
            s.netReturn>=BigDecimal("-1") &&
            s.criterionScores.keys.containsAll(ids) &&
            ids.all { id ->
                s.criterionScores[id]?.let { it>=BigDecimal.ZERO && it<=BigDecimal("100") }==true
            }
        }.sortedWith(compareBy<LearningSample>{it.realizedAt}.thenBy{it.id})

        if(valid.size<policy.minSamples) return null

        val utility=ids.associateWith { id ->
            var numerator=BigDecimal.ZERO
            var denominator=BigDecimal.ZERO
            for(s in valid) {
                val centered=s.criterionScores.getValue(id)
                    .subtract(BigDecimal("50"),WL_MC)
                    .divide(BigDecimal("50"),WL_MC)
                numerator=numerator.add(centered.multiply(s.netReturn,WL_MC),WL_MC)
                denominator=denominator.add(s.netReturn.abs(),WL_MC)
            }
            if(denominator.signum()==0) BigDecimal.ZERO
            else numerator.divide(denominator,WL_MC)
        }

        val minU=utility.values.minOrNull() ?: BigDecimal.ZERO
        val shifted=utility.mapValues { (_,v)->
            v.subtract(minU,WL_MC).add(BigDecimal("0.000001"),WL_MC)
        }
        val utilitySum=shifted.values.fold(BigDecimal.ZERO,BigDecimal::add)
        val learned=if(utilitySum.signum()==0) {
            AurumBCriteriaCatalog.decision.associate{it.id to it.baseWeight}
        } else {
            shifted.mapValues{(_,v)->v.divide(utilitySum,WL_MC)}
        }

        val sampleStrength=BigDecimal(valid.size)
            .divide(BigDecimal(valid.size+policy.minSamples),WL_MC)
            .multiply(policy.maxAdaptation,WL_MC)

        val raw=AurumBCriteriaCatalog.decision.associate { spec ->
            val base=spec.baseWeight
            val adaptive=learned.getValue(spec.id)
            spec.id to base.multiply(BigDecimal.ONE.subtract(sampleStrength,WL_MC),WL_MC)
                .add(adaptive.multiply(sampleStrength,WL_MC),WL_MC)
        }

        val projected=project(raw,policy.floor,policy.ceiling)
        return LearnedCandidate(
            proposal=WeightProposal(
                projected,
                "deterministic utility learner; samples="+valid.size+
                    "; regimes="+valid.map{it.regime}.distinct().size+
                    "; asOf="+asOf
            ),
            sampleCount=valid.size,
            regimeCount=valid.map{it.regime}.distinct().size,
            usedSampleIds=valid.map{it.id}
        )
    }

    private fun project(
        raw:Map<String,BigDecimal>,
        floor:BigDecimal,
        ceiling:BigDecimal
    ):Map<String,BigDecimal> {
        val w=raw.mapValues{(_,v)->v.coerceIn(floor,ceiling)}.toMutableMap()
        repeat(24) {
            val sum=w.values.fold(BigDecimal.ZERO,BigDecimal::add)
            val diff=BigDecimal.ONE.subtract(sum,WL_MC)
            if(diff.abs()<=BigDecimal("0.000000000001")) return@repeat
            if(diff.signum()>0) {
                val capacity=w.mapValues{(_,v)->ceiling.subtract(v,WL_MC).max(BigDecimal.ZERO)}
                val total=capacity.values.fold(BigDecimal.ZERO,BigDecimal::add)
                if(total.signum()==0) return@repeat
                for(k in w.keys.sorted()) {
                    val add=diff.multiply(capacity.getValue(k),WL_MC).divide(total,WL_MC)
                    w[k]=w.getValue(k).add(add,WL_MC).coerceAtMost(ceiling)
                }
            } else {
                val need=diff.negate()
                val reducible=w.mapValues{(_,v)->v.subtract(floor,WL_MC).max(BigDecimal.ZERO)}
                val total=reducible.values.fold(BigDecimal.ZERO,BigDecimal::add)
                if(total.signum()==0) return@repeat
                for(k in w.keys.sorted()) {
                    val sub=need.multiply(reducible.getValue(k),WL_MC).divide(total,WL_MC)
                    w[k]=w.getValue(k).subtract(sub,WL_MC).coerceAtLeast(floor)
                }
            }
        }
        val rounded=w.mapValues{(_,v)->v.setScale(12,RoundingMode.HALF_EVEN)}.toMutableMap()
        val sum=rounded.values.fold(BigDecimal.ZERO,BigDecimal::add)
        val diff=BigDecimal.ONE.subtract(sum)
        val adjustable=rounded.keys.sorted().firstOrNull { k ->
            val next=rounded.getValue(k).add(diff)
            next>=floor && next<=ceiling
        } ?: error("weight projection cannot normalize")
        rounded[adjustable]=rounded.getValue(adjustable).add(diff)
        require(rounded.values.all{it>=floor && it<=ceiling})
        require(rounded.values.fold(BigDecimal.ZERO,BigDecimal::add)
            .subtract(BigDecimal.ONE).abs()<=BigDecimal("0.000000000001"))
        return rounded.toSortedMap()
    }
}
