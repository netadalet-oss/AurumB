package io.aurum.aurumb

import io.aurum.aurumb.indicator.IndicatorMath
import kotlin.math.abs

fun indicatorChecks() {
    val prices=(1..40).map{it.toDouble() as Double?}
    val changes=IndicatorMath.changes(prices)
    check(changes.first()==null)
    check(changes.drop(1).all{it!=null && it!!>-99.5})
    val ema=IndicatorMath.ema(prices,20)
    check(ema.last()!=null)
    val rsi=IndicatorMath.rsi(prices,14)
    check(abs((rsi.last()?:0.0)-100.0)<1e-9)
    val highs=prices.map{it!!+1.0}
    val lows=prices.map{it!!-1.0}
    val atr=IndicatorMath.atr(highs,lows,prices,14)
    check(atr.last()!=null && atr.last()!!>0)
    val volume=prices.map{1000.0}
    check(IndicatorMath.obv(prices,volume).last()!!>0)
    check(IndicatorMath.mfi(highs,lows,prices,volume,14).last()==100.0)
    check(IndicatorMath.maxDrawdown(listOf(100.0,120.0,90.0,110.0))==-25.0)
    val rr=IndicatorMath.rollingReturn(prices,5)
    check(rr.last()!=null)
}
