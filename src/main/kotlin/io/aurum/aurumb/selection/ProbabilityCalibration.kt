package io.aurum.aurumb.selection

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import java.time.Duration
import java.time.Instant
import kotlin.math.pow

private val PC_MC=MathContext(18,RoundingMode.HALF_EVEN)

data class ProbabilityEvidence(
    val id:String,
    val decisionAt:Instant,
    val evaluatedAt:Instant,
    val score:BigDecimal,
    val hit:Boolean,
    val regime:String,
    val decisionWindow:String
)

data class CalibratedProbability(
    val probability:BigDecimal,
    val effectiveObservations:BigDecimal,
    val source:String
)

data class ProbabilityCalibrationPolicy(
    val priorStrength:BigDecimal=BigDecimal("24"),
    val scoreRadius:BigDecimal=BigDecimal("12"),
    val halfLifeDays:BigDecimal=BigDecimal("40"),
    val sameRegimeWeight:BigDecimal=BigDecimal.ONE,
    val otherRegimeWeight:BigDecimal=BigDecimal("0.55"),
    val sameWindowWeight:BigDecimal=BigDecimal.ONE,
    val otherWindowWeight:BigDecimal=BigDecimal("0.40")
) {
    init {
        require(priorStrength>BigDecimal.ZERO)
        require(scoreRadius>BigDecimal.ZERO)
        require(halfLifeDays>BigDecimal.ZERO)
    }
}

object ProbabilityCalibrator {
    fun calibrate(
        score:BigDecimal,
        regime:String,
        decisionWindow:String,
        asOf:Instant,
        evidence:List<ProbabilityEvidence>,
        policy:ProbabilityCalibrationPolicy=ProbabilityCalibrationPolicy()
    ):CalibratedProbability {
        val prior=LegacyTargetProbability.prior(score)
        var hitWeight=BigDecimal.ZERO
        var totalWeight=BigDecimal.ZERO

        for(row in evidence.sortedWith(compareBy<ProbabilityEvidence>{it.evaluatedAt}.thenBy{it.id})) {
            if(row.evaluatedAt.isAfter(asOf)) continue
            if(!row.evaluatedAt.isAfter(row.decisionAt)) continue
            val distance=row.score.subtract(score,PC_MC).abs()
            if(distance>policy.scoreRadius) continue

            val ageDays=BigDecimal.valueOf(
                Duration.between(row.evaluatedAt,asOf).toMillis().coerceAtLeast(0).toDouble()/86_400_000.0
            )
            val decay=BigDecimal.valueOf(
                0.5.pow(ageDays.divide(policy.halfLifeDays,PC_MC).toDouble())
            )
            val regimeWeight=if(row.regime==regime)policy.sameRegimeWeight else policy.otherRegimeWeight
            val windowWeight=if(row.decisionWindow==decisionWindow)policy.sameWindowWeight else policy.otherWindowWeight
            val distanceWeight=BigDecimal.ONE.subtract(
                distance.divide(policy.scoreRadius.add(BigDecimal("2"),PC_MC),PC_MC)
            ).coerceIn(BigDecimal.ZERO,BigDecimal.ONE)
            val weight=decay.multiply(regimeWeight,PC_MC)
                .multiply(windowWeight,PC_MC)
                .multiply(distanceWeight,PC_MC)
            totalWeight=totalWeight.add(weight,PC_MC)
            if(row.hit) hitWeight=hitWeight.add(weight,PC_MC)
        }

        if(totalWeight.signum()==0) return CalibratedProbability(prior,BigDecimal.ZERO,"PRIOR_ONLY")
        val probability=prior.multiply(policy.priorStrength,PC_MC)
            .add(hitWeight,PC_MC)
            .divide(policy.priorStrength.add(totalWeight,PC_MC),PC_MC)
            .coerceIn(BigDecimal.ZERO,BigDecimal.ONE)
        return CalibratedProbability(probability,totalWeight,"EMPIRICAL_BLEND")
    }
}
