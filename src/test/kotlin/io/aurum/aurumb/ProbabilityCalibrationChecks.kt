package io.aurum.aurumb

import io.aurum.aurumb.selection.*
import java.math.BigDecimal
import java.time.Instant

fun probabilityCalibrationChecks() {
    val asOf=Instant.parse("2026-10-01T00:00:00Z")
    val prior=ProbabilityCalibrator.calibrate(
        BigDecimal("76"),"BULL","NEXT_OPEN",asOf,emptyList()
    )
    check(prior.source=="PRIOR_ONLY")
    check(prior.effectiveObservations==BigDecimal.ZERO)

    val rows=(1..30).map { i ->
        ProbabilityEvidence(
            id="e"+i,
            decisionAt=Instant.parse("2026-08-01T00:00:00Z").plusSeconds(i.toLong()*86400),
            evaluatedAt=Instant.parse("2026-08-04T00:00:00Z").plusSeconds(i.toLong()*86400),
            score=BigDecimal("76"),
            hit=true,
            regime="BULL",
            decisionWindow="NEXT_OPEN"
        )
    }
    val blended=ProbabilityCalibrator.calibrate(
        BigDecimal("76"),"BULL","NEXT_OPEN",asOf,rows
    )
    check(blended.source=="EMPIRICAL_BLEND")
    check(blended.probability>prior.probability)

    val future=ProbabilityEvidence(
        "future",asOf.minusSeconds(60),asOf.plusSeconds(60),
        BigDecimal("76"),false,"BULL","NEXT_OPEN"
    )
    val withFuture=ProbabilityCalibrator.calibrate(
        BigDecimal("76"),"BULL","NEXT_OPEN",asOf,rows+future
    )
    check(withFuture.probability==blended.probability)
}
