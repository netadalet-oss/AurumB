package io.aurum.aurumb

import io.aurum.aurumb.feature.*
import io.aurum.aurumb.formula.AurumBFormulaEngine
import java.math.BigDecimal
import java.time.Instant

fun featureChecks() {
    val bars=(0 until 90).map { i ->
        val p=BigDecimal.valueOf(50.0+i*.2)
        MarketBar(
            Instant.parse("2026-01-01T00:00:00Z").plusSeconds(i*86400L),
            p-BigDecimal(".1"),p+BigDecimal(".5"),p-BigDecimal(".5"),p,p,
            BigDecimal.valueOf(1_000_000.0+i*10_000.0)
        )
    }
    val index=(0 until 90).map { i ->
        val p=BigDecimal.valueOf(100.0+i*.1)
        MarketBar(
            Instant.parse("2026-01-01T00:00:00Z").plusSeconds(i*86400L),
            p,p+BigDecimal(".2"),p-BigDecimal(".2"),p,p,BigDecimal("1000000")
        )
    }
    val f=FeatureBuilder.build("AAA",bars,index)
    check(f.symbol=="AAA")
    check(f.rsi14!=null)
    check(f.atrPct!=null)
    check(f.medianTurnover21!=null && f.medianTurnover21!!>BigDecimal.ZERO)
    val score=AurumBFormulaEngine.score(listOf(f)).single()
    check(score.scores.values.all{it==null || (it>=BigDecimal.ZERO && it<=BigDecimal("100"))})

    val missingOpen=bars.mapIndexed { i,row -> if(i==bars.lastIndex) row.copy(open=null) else row }
    val noOpen=FeatureBuilder.build("NO_OPEN",missingOpen,index)
    check(noOpen.gapPct==null)
    check(noOpen.intradayContinuation==null)
    check(noOpen.upperWickPct==null)
    check(noOpen.lowerWickPct==null)
}
