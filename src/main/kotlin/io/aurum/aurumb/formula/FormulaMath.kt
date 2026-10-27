package io.aurum.aurumb.formula

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

private val MC = MathContext(18, RoundingMode.HALF_EVEN)

object FormulaMath {
    fun clamp(v: BigDecimal, min: BigDecimal = BigDecimal.ZERO, max: BigDecimal = BigDecimal.ONE): BigDecimal =
        when {
            v < min -> min
            v > max -> max
            else -> v
        }

    /**
     * APK parity for legacy bandValue(v, lo, hi, outerLo, outerHi).
     * Returns null for missing input, 1 inside the preferred band, and a linear fade to 0 outside it.
     */
    fun bandValue(v: BigDecimal?, lo: BigDecimal, hi: BigDecimal, outerLo: BigDecimal, outerHi: BigDecimal): BigDecimal? {
        if (v == null) return null
        if (v >= lo && v <= hi) return BigDecimal.ONE
        return if (v < lo) {
            clamp(v.subtract(outerLo, MC).divide(lo.subtract(outerLo, MC), MC))
        } else {
            clamp(outerHi.subtract(v, MC).divide(outerHi.subtract(hi, MC), MC))
        }
    }

    /**
     * Tie-aware percentile parity. Equal values receive their average rank.
     * Missing values remain null and do not enter the rank population.
     */
    fun percentile(values: List<BigDecimal?>, invert: Boolean = false): List<BigDecimal?> {
        val valid = values.mapIndexedNotNull { index, value -> value?.let { index to it } }
            .sortedWith(compareBy<Pair<Int, BigDecimal>> { it.second }.thenBy { it.first })
        val out = MutableList<BigDecimal?>(values.size) { null }
        var p = 0
        while (p < valid.size) {
            var q = p + 1
            while (q < valid.size && valid[q].second.compareTo(valid[p].second) == 0) q++
            val rank = BigDecimal(p + q - 1).divide(BigDecimal("2"), MC)
            val score = if (valid.size <= 1) BigDecimal("0.5")
            else rank.divide(BigDecimal(valid.size - 1), MC)
            val applied = if (invert) BigDecimal.ONE.subtract(score, MC) else score
            for (k in p until q) out[valid[k].first] = applied
            p = q
        }
        return out
    }

    /**
     * APK parity: missing components are omitted and the remaining weights are re-normalized.
     */
    fun weighted100(parts: List<Pair<BigDecimal?, BigDecimal>>): BigDecimal? {
        var sum = BigDecimal.ZERO
        var weight = BigDecimal.ZERO
        for ((value, w) in parts) {
            if (value != null) {
                sum = sum.add(value.multiply(w, MC), MC)
                weight = weight.add(w, MC)
            }
        }
        if (weight.signum() == 0) return null
        return sum.divide(weight, MC).multiply(BigDecimal("100"), MC)
    }

    fun safeRatio(numerator: BigDecimal?, denominator: BigDecimal?): BigDecimal? =
        if (numerator == null || denominator == null || denominator.signum() == 0) null
        else numerator.divide(denominator, MC)
}
