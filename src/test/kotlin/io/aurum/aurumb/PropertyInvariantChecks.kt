package io.aurum.aurumb

import io.aurum.aurumb.criteria.*
import io.aurum.aurumb.formula.FormulaMath
import io.aurum.aurumb.selection.*
import java.math.BigDecimal
import java.util.Random

fun propertyInvariantChecks() {
    val rng=Random(0xA0B0C0D0L)
    repeat(250) { iteration ->
        val candidates=(0 until 8).map { index ->
            val results=AurumBCriteriaCatalog.decision.associate { spec ->
                val score=BigDecimal.valueOf(rng.nextDouble()*100.0)
                spec.id to CriterionResult(spec.id,score,true)
            }
            CandidateEvidence(
                symbol="S"+iteration.toString().padStart(3,'0')+"_"+index,
                results=results,
                executionRisk=BigDecimal.valueOf(rng.nextDouble())
            )
        }
        val engine=SelectionEngine()
        val forward=engine.rank(candidates)
        val reversed=engine.rank(candidates.reversed())
        IntegrityValidator.validate(forward)
        check(forward.map{it.symbol}==reversed.map{it.symbol})
        check(forward.all{it.score in BigDecimal.ZERO..BigDecimal("100")})
        check(forward.all{it.executionRisk in BigDecimal.ZERO..BigDecimal.ONE})
    }

    repeat(500) {
        val low=BigDecimal.valueOf(rng.nextDouble()*40.0)
        val high=low+BigDecimal.valueOf(1.0+rng.nextDouble()*40.0)
        val outerLow=low-BigDecimal.valueOf(1.0+rng.nextDouble()*20.0)
        val outerHigh=high+BigDecimal.valueOf(1.0+rng.nextDouble()*20.0)
        val value=outerLow+BigDecimal.valueOf(rng.nextDouble()).multiply(outerHigh-outerLow)
        val score=requireNotNull(FormulaMath.bandValue(value,low,high,outerLow,outerHigh))
        check(score in BigDecimal.ZERO..BigDecimal.ONE)
    }
}
