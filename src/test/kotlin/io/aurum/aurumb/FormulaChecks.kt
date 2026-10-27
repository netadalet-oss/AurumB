package io.aurum.aurumb

import io.aurum.aurumb.formula.*
import java.math.BigDecimal

private fun d(v:String)=BigDecimal(v)
private fun base(symbol:String, shift:String="0")=AurumBFeatures(
    symbol=symbol,
    distanceHigh20Pct=d(shift),
    closeLocation=d(".8"),
    volumeBreakout=d("1.5").add(d(shift)),
    turnoverRatio=d("1.4").add(d(shift)),
    obvSlope=d("100"),
    volume=d("1000"),
    adx14=d("30"),
    upperWickPct=d("1"),
    limitUpRisk=false,
    dayChange=d("3"),
    deg3=d("6"),
    rsi14=d("62"),
    mfi14=d("65"),
    emaTrendState=d("1"),
    macdHistDelta=d(".2").add(d(shift)),
    atrPct=d("5"),
    volRatio5_21=d("1.5"),
    bbCompression=d("1.2"),
    rangeExpansion=d("1.4"),
    relative5=d("2").add(d(shift)),
    relative10=d("3").add(d(shift)),
    relative21=d("4").add(d(shift)),
    shortTrendPct=d("3").add(d(shift)),
    beta=d("1"),
    marketRegime="BULL",
    medianTurnover21=d("100000000").add(d(shift)),
    estimatedCostPct=d(".5"),
    participationPct=d(".2"),
    amihud=d(".01"),
    tickImpactPct=d(".05"),
    gapPct=d("1"),
    intradayContinuation=d("2"),
    lowerWickPct=d("1").add(d(shift)),
    rsiDelta=d("2").add(d(shift)),
    distanceBollLowPct=d("3"),
    prevDayChange=d("-2")
)

fun formulaChecks() {
    check(FormulaMath.bandValue(d("30"), d("20"), d("45"), d("10"), d("70")) == BigDecimal.ONE)
    check(FormulaMath.bandValue(null, d("20"), d("45"), d("10"), d("70")) == null)
    val ties=FormulaMath.percentile(listOf(d("1"),d("1"),d("3")))
    check(ties[0] == ties[1])
    check(ties[2] == BigDecimal.ONE)

    val scores=AurumBFormulaEngine.score(listOf(base("AAA"),base("BBB",".1")))
    check(scores.size==2)
    check(scores.all { it.scores.keys == setOf("K1","K2","K3","K4","K5","K6","K7") })
    check(scores.flatMap { it.scores.values }.filterNotNull().all { it.toDouble().isFinite() })

    // Golden outputs derived from the effective legacy APK core.js buildModels K1-K7 formulas.
    val golden=mapOf(
        "AAA" to mapOf(
            "K1" to d("52.145454545454545"),
            "K2" to d("83.0"),
            "K3" to d("85.0"),
            "K4" to d("10.0"),
            "K5" to d("28.5"),
            "K6" to d("75.4"),
            "K7" to d("31.285714285714286")
        ),
        "BBB" to mapOf(
            "K1" to d("87.145454545454545"),
            "K2" to d("100"),
            "K3" to d("98.0"),
            "K4" to d("100"),
            "K5" to d("71.5"),
            "K6" to d("91.4"),
            "K7" to d("92.285714285714286")
        )
    )
    val tolerance=d("0.0000001")
    for(row in scores) {
        val expected=golden.getValue(row.symbol)
        for((criterion,value) in expected) {
            val actual=requireNotNull(row.scores[criterion])
            check(actual.subtract(value).abs()<=tolerance) {
                row.symbol+" "+criterion+" parity mismatch: "+actual+" vs "+value
            }
        }
    }
    val risky=base("RISK").copy(limitUpRisk=true)
    val normal=base("NORMAL")
    val pair=AurumBFormulaEngine.score(listOf(normal,risky)).associateBy{it.symbol}
    check(requireNotNull(pair["RISK"]!!.scores["K1"]) < requireNotNull(pair["NORMAL"]!!.scores["K1"]))
    check(requireNotNull(pair["RISK"]!!.scores["K6"]) < requireNotNull(pair["NORMAL"]!!.scores["K6"]))
}
