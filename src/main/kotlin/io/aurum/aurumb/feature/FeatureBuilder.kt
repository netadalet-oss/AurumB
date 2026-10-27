package io.aurum.aurumb.feature

import io.aurum.aurumb.formula.AurumBFeatures
import io.aurum.aurumb.indicator.IndicatorMath
import java.math.BigDecimal
import java.math.MathContext
import java.time.Instant
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

private val MC=MathContext.DECIMAL128

data class MarketBar(
    val at:Instant,
    val open:BigDecimal?,
    val high:BigDecimal,
    val low:BigDecimal,
    val close:BigDecimal,
    val adjustedClose:BigDecimal?,
    val volume:BigDecimal
)

data class FeatureSettings(
    val assumedPositionTry:BigDecimal=BigDecimal("100000"),
    val maxParticipationPct:BigDecimal=BigDecimal("2"),
    val commissionBps:BigDecimal=BigDecimal("8"),
    val slippageBps:BigDecimal=BigDecimal("12")
)

object FeatureBuilder {
    private fun bd(v:Double?):BigDecimal?=v?.takeIf{it.isFinite()}?.let{BigDecimal.valueOf(it)}
    private fun median(xs:List<Double>):Double? {
        if(xs.isEmpty()) return null
        val s=xs.sorted()
        return if(s.size%2==1)s[s.size/2] else (s[s.size/2-1]+s[s.size/2])/2.0
    }
    private fun mean(xs:List<Double?>):Double? {
        val v=xs.filterNotNull().filter{it.isFinite()}
        return if(v.isEmpty())null else v.average()
    }
    private fun last(xs:List<Double?>):Double? = xs.asReversed().firstOrNull{it!=null && it.isFinite()}
    private fun safeRatio(a:Double?,b:Double?):Double?=if(a==null||b==null||b==0.0)null else a/b
    private fun tickSize(price:Double):Double=when {
        price<20 -> .01
        price<50 -> .02
        price<100 -> .05
        price<250 -> .10
        price<500 -> .25
        price<1000 -> .50
        price<2500 -> 1.0
        else -> 2.5
    }

    private fun beta(prices:List<Double?>,index:List<Double?>,window:Int=60):Double? {
        if(prices.size<=window || index.size!=prices.size)return null
        val rp=IndicatorMath.changes(prices)
        val ri=IndicatorMath.changes(index)
        val pairs=(prices.size-window until prices.size).mapNotNull{i->
            val a=rp[i];val b=ri[i];if(a!=null&&b!=null)a to b else null
        }
        if(pairs.size<kotlin.math.ceil(window*.7).toInt())return null
        val mp=pairs.map{it.first}.average();val mi=pairs.map{it.second}.average()
        val cov=pairs.map{(a,b)->(a-mp)*(b-mi)}.average()
        val vi=pairs.map{(_,b)->(b-mi)*(b-mi)}.average()
        return if(vi==0.0)null else cov/vi
    }

    fun build(
        symbol:String,
        bars:List<MarketBar>,
        indexBars:List<MarketBar>,
        settings:FeatureSettings=FeatureSettings()
    ):AurumBFeatures {
        require(bars.size>=22) { "insufficient bars" }
        val sorted=bars.sortedBy{it.at}
        require(sorted.zipWithNext().all{(a,b)->a.at<b.at}) { "duplicate/out-of-order bars" }
        require(sorted.all{it.close>BigDecimal.ZERO && it.high>BigDecimal.ZERO && it.low>BigDecimal.ZERO && it.volume>=BigDecimal.ZERO})
        val indexByAt=indexBars.associateBy{it.at}

        val raw=sorted.map{it.close.toDouble()}
        val factors=sorted.map {
            val a=it.adjustedClose?.toDouble();val c=it.close.toDouble()
            if(a==null||a<=0||c<=0)1.0 else (a/c).takeIf{x->x>.01&&x<100}?:1.0
        }
        val close=raw.mapIndexed{i,v->v*factors[i]}
        val open=sorted.mapIndexed{i,b->b.open?.toDouble()?.times(factors[i])}
        val high=sorted.mapIndexed{i,b->b.high.toDouble()*factors[i]}
        val low=sorted.mapIndexed{i,b->b.low.toDouble()*factors[i]}
        val volume=sorted.map{it.volume.toDouble()}
        val index=sorted.map{indexByAt[it.at]?.adjustedClose?.toDouble() ?: indexByAt[it.at]?.close?.toDouble()}

        val changes=IndicatorMath.changes(close)
        val e12=IndicatorMath.ema(close,12);val e20=IndicatorMath.ema(close,20);val e26=IndicatorMath.ema(close,26);val e50=IndicatorMath.ema(close,50)
        val macd=close.indices.map{i->if(e12[i]!=null&&e26[i]!=null)e12[i]!!-e26[i]!! else null}
        val macdSig=IndicatorMath.ema(macd,9)
        val macdHist=close.indices.map{i->if(macd[i]!=null&&macdSig[i]!=null)macd[i]!!-macdSig[i]!! else null}
        val rsi=IndicatorMath.rsi(close,14)
        val mfi=IndicatorMath.mfi(high,low,close,volume,14)
        val atr=IndicatorMath.atr(high,low,close,14)
        val adx=IndicatorMath.adx(high,low,close,14)
        val obv=IndicatorMath.obv(close,volume)
        val vol5=IndicatorMath.rollingStdev(changes,5,3)
        val vol21=IndicatorMath.rollingStdev(changes,21,12)
        val bollMid=IndicatorMath.rollingMean(close,20)
        val bollStd=IndicatorMath.rollingStdev(close,20,20)
        val bollWidth=close.indices.map{i->if((bollMid[i]?:0.0)!=0.0&&bollStd[i]!=null)400.0*bollStd[i]!!/bollMid[i]!! else null}
        val roc5=IndicatorMath.rollingReturn(close,5)
        val roc10=IndicatorMath.rollingReturn(close,10)
        val ret21=IndicatorMath.rollingReturn(close,21)
        val idx5=IndicatorMath.rollingReturn(index,5)
        val idx10=IndicatorMath.rollingReturn(index,10)
        val idx21=IndicatorMath.rollingReturn(index,21)
        val idxE20=IndicatorMath.ema(index,20);val idxE50=IndicatorMath.ema(index,50)
        val idxVol21=IndicatorMath.rollingStdev(IndicatorMath.changes(index),21,12)

        val i=sorted.lastIndex
        val live=close[i]
        val prev=close[i-1]
        val dayChange=if(prev>0)100.0*(live/prev-1.0) else last(changes)
        val priorHigh20=high.subList(max(0,i-20),i).maxOrNull()
        val priorTurn=sorted.indices.drop(max(0,sorted.size-22)).dropLast(1).map{raw[it]*volume[it]}
        val medTurn=median(priorTurn)
        val avgVol21=mean(volume.drop(max(0,volume.size-22)).dropLast(1).map{it as Double?})
        val volumeBreakout=if(avgVol21!=null&&avgVol21>0)volume[i]/avgVol21 else null
        val turnoverRatio=if(medTurn!=null&&medTurn>0)(raw[i]*volume[i])/medTurn else null
        val obvSlope=if(obv.size>21 && obv[i]!=null && obv[i-21]!=null)obv[i]!!-obv[i-21]!! else null
        val range=high[i]-low[i]
        val closeLocation=if(range>0)((live-low[i])/range).coerceIn(0.0,1.0) else .5
        val currentOpen=open[i]
        val upperWick=if(live>0 && currentOpen!=null)100.0*(high[i]-max(currentOpen,live))/live else null
        val lowerWick=if(live>0 && currentOpen!=null)100.0*(min(currentOpen,live)-low[i])/live else null
        val gap=if(prev>0 && currentOpen!=null)100.0*(currentOpen/prev-1.0) else null
        val intraday=if(dayChange!=null&&gap!=null)dayChange-gap else null
        val rangePct=if(prev>0)100.0*range/prev else null
        val rangeSeries=close.indices.map{j->if(j>0&&close[j-1]>0)100.0*(high[j]-low[j])/close[j-1] else null}
        val rangeExpansion=safeRatio(rangePct,mean(rangeSeries.drop(max(0,rangeSeries.size-21)).dropLast(1)))
        val atrPct=last(atr)?.let{if(live>0)100.0*it/live else null}
        val bbWidth=last(bollWidth)
        val bbCompression=safeRatio(bbWidth,mean(bollWidth.drop(max(0,bollWidth.size-21)).dropLast(1)))
        val distHigh20=priorHigh20?.takeIf{it>0}?.let{100.0*(live/it-1.0)}
        val bollLow=if(last(bollMid)!=null&&last(bollStd)!=null)last(bollMid)!!-2*last(bollStd)!! else null
        val distBollLow=bollLow?.takeIf{it!=0.0}?.let{100.0*(live-it)/it}
        val shortTrend=last(e20)?.takeIf{it!=0.0}?.let{100.0*(live/it-1.0)}
        val indexClose=last(index);val indexPrev=index.dropLast(1).asReversed().firstOrNull{it!=null}
        val indexDay=if(indexClose!=null&&indexPrev!=null&&indexPrev>0)100.0*(indexClose/indexPrev-1.0) else null
        val trend20=if(indexClose!=null&&last(idxE20)!=null)100.0*(indexClose/last(idxE20)!!-1.0) else null
        val trend50=if(indexClose!=null&&last(idxE50)!=null)100.0*(indexClose/last(idxE50)!!-1.0) else null
        val regime=if(abs(indexDay?:0.0)>=2.0||(last(idxVol21)?:0.0)>=2.5)"VOLATILE"
            else if((trend20?:0.0)>0&&(trend50?:0.0)>0)"BULL"
            else if((trend20?:0.0)<0&&(trend50?:0.0)<0)"BEAR" else "NEUTRAL"

        val amihudRows=changes.drop(max(0,changes.size-22)).dropLast(1).mapIndexedNotNull{j,r->
            val turn=priorTurn.getOrNull(j)
            if(r!=null&&turn!=null&&turn>0)abs(r)/turn*1e9 else null
        }
        val amihud=if(amihudRows.isEmpty())null else amihudRows.average()
        val participation=medTurn?.takeIf{it>0}?.let{100.0*settings.assumedPositionTry.toDouble()/it}
        val tickImpact=if(raw[i]>0)100.0*tickSize(raw[i])/raw[i] else null
        val partRatio=if(participation!=null)participation/settings.maxParticipationPct.toDouble() else 50.0
        val impactBps=min(80.0,6.0*sqrt(max(0.0,partRatio))+max(0.0,(atrPct?:0.0)-3.0)*.8+min(25.0,abs(amihud?:0.0)*.15))
        val roundTrip=2.0*(settings.commissionBps.toDouble()+settings.slippageBps.toDouble()+impactBps)/100.0
        val estimatedCost=roundTrip+(tickImpact?:0.0)
        val emaTrendState=if(last(e20)!=null&&last(e50)!=null&&live>last(e20)!!&&last(e20)!!>last(e50)!!)1.0
            else if(last(e20)!=null&&live>last(e20)!!).6 else .1

        return AurumBFeatures(
            symbol=symbol,
            distanceHigh20Pct=bd(distHigh20),
            closeLocation=bd(closeLocation),
            volumeBreakout=bd(volumeBreakout),
            turnoverRatio=bd(turnoverRatio),
            obvSlope=bd(obvSlope),
            volume=bd(volume[i]),
            adx14=bd(last(adx)),
            upperWickPct=bd(upperWick),
            limitUpRisk=(dayChange?:0.0)>=9.2 && closeLocation>=.94,
            dayChange=bd(dayChange),
            deg3=bd(mean(changes.takeLast(3))),
            rsi14=bd(last(rsi)),
            mfi14=bd(last(mfi)),
            emaTrendState=bd(emaTrendState),
            macdHistDelta=bd(if(last(macdHist)!=null&&macdHist.getOrNull(i-1)!=null)last(macdHist)!!-macdHist[i-1]!! else null),
            atrPct=bd(atrPct),
            volRatio5_21=bd(safeRatio(last(vol5),last(vol21))),
            bbCompression=bd(bbCompression),
            rangeExpansion=bd(rangeExpansion),
            relative5=bd(if(last(roc5)!=null&&last(idx5)!=null)last(roc5)!!-last(idx5)!! else null),
            relative10=bd(if(last(roc10)!=null&&last(idx10)!=null)last(roc10)!!-last(idx10)!! else null),
            relative21=bd(if(last(ret21)!=null&&last(idx21)!=null)last(ret21)!!-last(idx21)!! else null),
            shortTrendPct=bd(shortTrend),
            beta=bd(beta(close,index)),
            marketRegime=regime,
            medianTurnover21=bd(medTurn),
            estimatedCostPct=bd(estimatedCost),
            participationPct=bd(participation),
            amihud=bd(amihud),
            tickImpactPct=bd(tickImpact),
            gapPct=bd(gap),
            intradayContinuation=bd(intraday),
            lowerWickPct=bd(lowerWick),
            rsiDelta=bd(if(last(rsi)!=null&&rsi.getOrNull(i-1)!=null)last(rsi)!!-rsi[i-1]!! else null),
            distanceBollLowPct=bd(distBollLow),
            prevDayChange=bd(changes.getOrNull(i-1))
        )
    }
}
