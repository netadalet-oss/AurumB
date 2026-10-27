package io.aurum.aurumb

import io.aurum.aurumb.feature.MarketBar
import io.aurum.aurumb.formula.BehaviorArchiveEvidence
import io.aurum.aurumb.formula.BehaviorMetaEngine
import io.aurum.aurumb.formula.BehaviorMetaInput
import io.aurum.aurumb.formula.BehaviorMetaPolicy
import java.math.BigDecimal
import java.time.Instant
import java.time.temporal.ChronoUnit

fun behaviorMetaChecks() {
    val start=Instant.parse("2026-01-01T15:00:00Z")
    fun bars(multiplier:Double):List<MarketBar> =
        (0 until 100).map { i ->
            val base=100.0*multiplier*(1.0+i*.0025)
            val open=base*(1.0+(if(i%9==0) .004 else -.001))
            val close=base*(1.0+(if(i%5==0) .012 else .003))
            MarketBar(
                at=start.plus(i.toLong(),ChronoUnit.DAYS),
                open=BigDecimal.valueOf(open),
                high=BigDecimal.valueOf(maxOf(open,close)*1.012),
                low=BigDecimal.valueOf(minOf(open,close)*.988),
                close=BigDecimal.valueOf(close),
                adjustedClose=BigDecimal.valueOf(close),
                volume=BigDecimal.valueOf(1_000_000.0+i*7_500.0)
            )
        }
    val index=bars(.95)
    val inputs=listOf(
        BehaviorMetaInput("AAA",bars(1.0),index,BigDecimal(".35"),"BULL"),
        BehaviorMetaInput("BBB",bars(.8),index,BigDecimal(".45"),"BULL")
    )
    val now=start.plus(101,ChronoUnit.DAYS)
    val policy=BehaviorMetaPolicy(
        targetReturnPct=5.0,
        crossSectionalTargetPct=.05,
        lookbackSessions=80,
        lifetimeWeight=.30,
        learningHalfLifeDays=20
    )
    val first=BehaviorMetaEngine.score(inputs,emptyList(),policy,now)
    val second=BehaviorMetaEngine.score(inputs,emptyList(),policy,now)
    check(first==second)
    check(first.keys==setOf("AAA","BBB"))
    check(first.values.all{it.score>=BigDecimal.ZERO && it.score<=BigDecimal("100")})
    check(first.values.all{it.confidence>=BigDecimal.ZERO && it.confidence<=BigDecimal("100")})
    check(first.values.all{it.recentObservations>0})

    val future=BehaviorArchiveEvidence(
        symbol="AAA",
        evaluatedAt=now.plus(1,ChronoUnit.DAYS),
        targetHit=true
    )
    val withFuture=BehaviorMetaEngine.score(inputs,listOf(future),policy,now)
    check(withFuture==first) // point-in-time: future archive evidence must be invisible
}
