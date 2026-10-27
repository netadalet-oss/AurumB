package io.aurum.aurumb.formula

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

private val MC = MathContext(18, RoundingMode.HALF_EVEN)

data class AurumBFeatures(
    val symbol: String,
    val distanceHigh20Pct: BigDecimal?,
    val closeLocation: BigDecimal?,
    val volumeBreakout: BigDecimal?,
    val turnoverRatio: BigDecimal?,
    val obvSlope: BigDecimal?,
    val volume: BigDecimal?,
    val adx14: BigDecimal?,
    val upperWickPct: BigDecimal?,
    val limitUpRisk: Boolean,
    val dayChange: BigDecimal?,
    val deg3: BigDecimal?,
    val rsi14: BigDecimal?,
    val mfi14: BigDecimal?,
    val emaTrendState: BigDecimal?,
    val macdHistDelta: BigDecimal?,
    val atrPct: BigDecimal?,
    val volRatio5_21: BigDecimal?,
    val bbCompression: BigDecimal?,
    val rangeExpansion: BigDecimal?,
    val relative5: BigDecimal?,
    val relative10: BigDecimal?,
    val relative21: BigDecimal?,
    val shortTrendPct: BigDecimal?,
    val beta: BigDecimal?,
    val marketRegime: String?,
    val medianTurnover21: BigDecimal?,
    val estimatedCostPct: BigDecimal?,
    val participationPct: BigDecimal?,
    val amihud: BigDecimal?,
    val tickImpactPct: BigDecimal?,
    val gapPct: BigDecimal?,
    val intradayContinuation: BigDecimal?,
    val lowerWickPct: BigDecimal?,
    val rsiDelta: BigDecimal?,
    val distanceBollLowPct: BigDecimal?,
    val prevDayChange: BigDecimal?,
)

data class FormulaScore(val symbol: String, val scores: Map<String, BigDecimal?>)

object AurumBFormulaEngine {
    private fun d(v: String) = BigDecimal(v)
    private fun sub(a: BigDecimal?, b: BigDecimal?): BigDecimal? = if (a == null || b == null) null else a.subtract(b, MC)

    fun score(universe: List<AurumBFeatures>): List<FormulaScore> {
        require(universe.map { it.symbol }.distinct().size == universe.size) { "duplicate symbol" }
        val pVolBreak = FormulaMath.percentile(universe.map { it.volumeBreakout })
        val pTurnRatio = FormulaMath.percentile(universe.map { it.turnoverRatio })
        val pObvNorm = FormulaMath.percentile(universe.map { FormulaMath.safeRatio(it.obvSlope, it.volume) })
        val pMacdDelta = FormulaMath.percentile(universe.map { it.macdHistDelta })
        val pRel5 = FormulaMath.percentile(universe.map { it.relative5 })
        val pRel10 = FormulaMath.percentile(universe.map { it.relative10 })
        val pRel21 = FormulaMath.percentile(universe.map { it.relative21 })
        val pShortTrend = FormulaMath.percentile(universe.map { it.shortTrendPct })

        val logTurn = universe.map { f ->
            f.medianTurnover21?.takeIf { it.signum() > 0 }?.let { BigDecimal(kotlin.math.log10(it.toDouble()), MC) }
        }
        val pLogTurn = FormulaMath.percentile(logTurn)
        val costInv = FormulaMath.percentile(universe.map { it.estimatedCostPct }, true)
        val partInv = FormulaMath.percentile(universe.map { it.participationPct }, true)
        val amihudInv = FormulaMath.percentile(universe.map { it.amihud }, true)
        val tickInv = FormulaMath.percentile(universe.map { it.tickImpactPct }, true)
        val wickInv = FormulaMath.percentile(universe.map { it.upperWickPct }, true)
        val lowerWick = FormulaMath.percentile(universe.map { it.lowerWickPct })
        val rsiUp = FormulaMath.percentile(universe.map { it.rsiDelta })

        return universe.mapIndexed { i, f ->
            val k1Base = FormulaMath.weighted100(listOf(
                FormulaMath.bandValue(f.distanceHigh20Pct, d("-2"), d("2"), d("-9"), d("6")) to d(".25"),
                f.closeLocation?.let { FormulaMath.clamp(it.subtract(d(".4"), MC).divide(d(".55"), MC)) } to d(".20"),
                pVolBreak[i] to d(".20"),
                pTurnRatio[i] to d(".15"),
                pObvNorm[i] to d(".10"),
                FormulaMath.bandValue(f.adx14, d("20"), d("45"), d("10"), d("70")) to d(".10")
            ))
            val k1 = k1Base?.subtract(d("12").multiply(FormulaMath.clamp((f.upperWickPct ?: BigDecimal.ZERO).divide(d("5"), MC)), MC), MC)
                ?.subtract(if (f.limitUpRisk) d("18") else BigDecimal.ZERO, MC)

            val k2 = FormulaMath.weighted100(listOf(
                FormulaMath.bandValue(f.dayChange, d("1"), d("6"), d("-3"), d("10")) to d(".20"),
                FormulaMath.bandValue(f.deg3, d("2"), d("12"), d("-6"), d("22")) to d(".15"),
                FormulaMath.bandValue(f.rsi14, d("55"), d("72"), d("38"), d("86")) to d(".18"),
                FormulaMath.bandValue(f.mfi14, d("50"), d("80"), d("28"), d("92")) to d(".12"),
                f.emaTrendState to d(".18"),
                pMacdDelta[i] to d(".17")
            ))

            val k3 = FormulaMath.weighted100(listOf(
                FormulaMath.bandValue(f.atrPct, d("3.2"), d("7.5"), d("1.2"), d("13")) to d(".28"),
                FormulaMath.bandValue(f.volRatio5_21, d("1.05"), d("2.3"), d(".45"), d("4")) to d(".17"),
                FormulaMath.bandValue(f.bbCompression, d("1.0"), d("1.8"), d(".45"), d("3.5")) to d(".16"),
                FormulaMath.bandValue(f.rangeExpansion, d("1.05"), d("2.6"), d(".4"), d("5")) to d(".16"),
                pVolBreak[i] to d(".13"),
                f.closeLocation to d(".10")
            ))

            val betaFit = if (f.marketRegime == "BEAR")
                FormulaMath.bandValue(f.beta, d(".5"), d("1.2"), d("0"), d("2"))
            else FormulaMath.bandValue(f.beta, d(".8"), d("1.8"), d("0"), d("3"))
            val k4 = FormulaMath.weighted100(listOf(
                pRel5[i] to d(".30"),
                pRel10[i] to d(".25"),
                pRel21[i] to d(".20"),
                pShortTrend[i] to d(".15"),
                betaFit to d(".10")
            ))

            val k5 = FormulaMath.weighted100(listOf(
                pLogTurn[i] to d(".25"),
                pTurnRatio[i] to d(".18"),
                costInv[i] to d(".22"),
                partInv[i] to d(".15"),
                amihudInv[i] to d(".12"),
                tickInv[i] to d(".08")
            ))

            val k6Base = FormulaMath.weighted100(listOf(
                FormulaMath.bandValue(f.gapPct, d("0"), d("4"), d("-5"), d("9")) to d(".20"),
                FormulaMath.bandValue(f.intradayContinuation, d("1"), d("6"), d("-4"), d("11")) to d(".24"),
                FormulaMath.bandValue(f.dayChange, d("1.5"), d("7"), d("-3"), d("10")) to d(".12"),
                f.closeLocation to d(".18"),
                pVolBreak[i] to d(".16"),
                wickInv[i] to d(".10")
            ))
            val k6 = k6Base?.subtract(if (f.limitUpRisk) d("20") else BigDecimal.ZERO, MC)

            val k7 = FormulaMath.weighted100(listOf(
                lowerWick[i] to d(".19"),
                FormulaMath.bandValue(f.rsi14, d("36"), d("56"), d("22"), d("70")) to d(".18"),
                rsiUp[i] to d(".17"),
                pMacdDelta[i] to d(".18"),
                FormulaMath.bandValue(f.distanceBollLowPct, d("0"), d("6"), d("-5"), d("18")) to d(".13"),
                FormulaMath.bandValue(f.prevDayChange, d("-5"), d("0"), d("-10"), d("4")) to d(".08"),
                pVolBreak[i] to d(".07")
            ))

            FormulaScore(f.symbol, mapOf("K1" to k1, "K2" to k2, "K3" to k3, "K4" to k4, "K5" to k5, "K6" to k6, "K7" to k7).mapValues { (_,v) -> v?.let { FormulaMath.clamp(it, BigDecimal.ZERO, BigDecimal("100")) } })
        }
    }
}
