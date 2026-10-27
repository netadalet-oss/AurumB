package io.aurum.aurumb

import io.aurum.aurumb.learning.*
import java.math.BigDecimal
import java.time.Instant

fun modelValidatorChecks() {
    val weights=mapOf(
        "K1" to BigDecimal("0.18"),
        "K2" to BigDecimal("0.17"),
        "K3" to BigDecimal("0.14"),
        "K4" to BigDecimal("0.15"),
        "K5" to BigDecimal("0.13"),
        "K6" to BigDecimal("0.12"),
        "K7" to BigDecimal("0.11")
    )
    val base=Instant.parse("2026-01-01T00:00:00Z")
    val rows=(0 until 12).flatMap { run ->
        (0 until 25).map { i ->
            val strong=i<15
            ModelValidationObservation(
                id="r"+run+"-"+i,
                runId="r"+run,
                decisionAt=base.plusSeconds(run.toLong()*86400),
                realizedAt=base.plusSeconds((run+3L)*86400),
                criterionScores=(1..7).associate { k ->
                    "K"+k to BigDecimal(if(strong)"85" else "35")
                },
                executionRisk=BigDecimal(if(strong)"0.10" else "0.35"),
                netReturn=BigDecimal(if(strong)"0.03" else "-0.01"),
                hit=strong,
                regime=listOf("BULL","BEAR","VOLATILE")[run%3],
            )
        }
    }
    val metrics=ModelValidator.evaluate(weights,rows,20)
    check(metrics.sampleCount==240)
    check(metrics.regimeCount==3)
    check(metrics.netEconomicUtility>BigDecimal.ZERO)
    check(metrics.precisionAtN>BigDecimal("0.5"))
    check(metrics.ndcg>BigDecimal("0.8"))
    check(metrics.maximumOrZero()>=BigDecimal.ZERO)
    check(metrics.stability==BigDecimal.ONE)
}

private fun ValidationMetrics.maximumOrZero()=maxDrawdown.coerceAtLeast(BigDecimal.ZERO)
