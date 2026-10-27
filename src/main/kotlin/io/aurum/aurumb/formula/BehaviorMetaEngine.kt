package io.aurum.aurumb.formula

import io.aurum.aurumb.feature.MarketBar
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sign
import kotlin.math.sqrt

data class BehaviorMetaInput(
    val symbol:String,
    val bars:List<MarketBar>,
    val indexBars:List<MarketBar>,
    val estimatedCostPct:BigDecimal?,
    val currentRegime:String?
)

data class BehaviorArchiveEvidence(
    val symbol:String,
    val evaluatedAt:Instant,
    val targetHit:Boolean
)

data class BehaviorMetaPolicy(
    val targetReturnPct:Double=5.0,
    val crossSectionalTargetPct:Double=.05,
    val lookbackSessions:Int=252,
    val lifetimeWeight:Double=.30,
    val learningHalfLifeDays:Int=20
)

data class BehaviorMetaScore(
    val score:BigDecimal,
    val dualRate:BigDecimal,
    val fiveRate:BigDecimal,
    val top20Rate:BigDecimal,
    val lift:BigDecimal?,
    val confidence:BigDecimal,
    val recentObservations:Int,
    val character:String,
    val activePatterns:List<String> = emptyList(),
    val lifetimeSessions:Int = 0
)

/**
 * Native translation of the effective APK K11 behavior-profile formula.
 * This class has no decision weight and cannot create an S/AL/SAT entitlement.
 */
object BehaviorMetaEngine {
    private val zone=ZoneId.of("Europe/Istanbul")
    private val patterns=listOf("BREAKOUT","VOLUME","MOMENTUM","SQUEEZE","GAP","REBOUND","RELATIVE")
    private val regimes=listOf("BULL","BEAR","VOLATILE","NEUTRAL")

    private data class Series(
        val dates:List<LocalDate>,
        val close:List<Double>,
        val open:List<Double?>,
        val high:List<Double>,
        val low:List<Double>,
        val volume:List<Double>,
        val index:List<Double?>
    )
    private data class Stat(
        var n:Int=0,var positive:Double=0.0,var five:Double=0.0,var top20:Double=0.0,
        var dual:Double=0.0,var sameDay:Double=0.0,var nextDay:Double=0.0,
        var sumNext:Double=0.0,var sumMax:Double=0.0,var sumClose:Double=0.0
    )
    private data class Window(
        val all:Stat=Stat(),
        val patterns:MutableMap<String,Stat> = BehaviorMetaEngine.patterns.associateWith{Stat()}.toMutableMap(),
        val regimes:MutableMap<String,Stat> = BehaviorMetaEngine.regimes.associateWith{Stat()}.toMutableMap()
    )
    private data class Raw(val input:BehaviorMetaInput,val series:Series,val recent:Window,val lifetime:Window)

    fun score(
        inputs:List<BehaviorMetaInput>,
        archive:List<BehaviorArchiveEvidence>,
        policy:BehaviorMetaPolicy=BehaviorMetaPolicy(),
        now:Instant=Instant.now()
    ):Map<String,BehaviorMetaScore> {
        if(inputs.isEmpty()) return emptyMap()
        val seriesBySymbol=inputs.associate { it.symbol to series(it) }
        val reel=historicalReelTop20(seriesBySymbol,policy.crossSectionalTargetPct)
        val raws=inputs.mapNotNull { input ->
            val s=seriesBySymbol[input.symbol] ?: return@mapNotNull null
            if(s.close.size<24) return@mapNotNull null
            val look=policy.lookbackSessions.coerceAtMost(s.close.size)
            Raw(
                input,s,
                rawWindow(input,s,reel,max(21,s.close.size-look-2),policy),
                rawWindow(input,s,reel,21,policy)
            )
        }
        if(raws.isEmpty()) return emptyMap()
        val globalRecent=merge(raws.map{it.recent})
        val globalLife=merge(raws.map{it.lifetime})
        val globalDual=rate(globalRecent.all,"dual") ?: .06
        val archiveBySymbol=archive.filter{!it.evaluatedAt.isAfter(now)}.groupBy{it.symbol}

        return raws.associate { raw ->
            val active=behaviorFlags(raw.series,raw.series.close.lastIndex)
            val regime=raw.input.currentRegime ?: historicalRegime(raw.series,raw.series.close.lastIndex)
            val lifeW=policy.lifetimeWeight.coerceIn(0.0,.6)
            fun blend(a:Double?,b:Double?):Double? = when {
                a!=null && b!=null -> (1-lifeW)*a+lifeW*b
                a!=null -> a
                else -> b
            }
            val details=active.map { k ->
                val rr=raw.recent.patterns.getValue(k)
                val lr=raw.lifetime.patterns.getValue(k)
                val gr=globalRecent.patterns.getValue(k)
                val gl=globalLife.patterns.getValue(k)
                Triple(
                    blend(posterior(rr,gr,"dual",18),posterior(lr,gl,"dual",30)),
                    blend(posterior(rr,gr,"five",18),posterior(lr,gl,"five",30)),
                    rr.n
                )
            }
            val baseDual=posterior(raw.recent.all,globalRecent.all,"dual",24)
            val lifeDual=posterior(raw.lifetime.all,globalLife.all,"dual",40)
            val patternDual=avgD(details.mapNotNull{it.first}) ?: baseDual
            val patternFive=avgD(details.mapNotNull{it.second})
                ?: posterior(raw.recent.all,globalRecent.all,"five",24)
            val regimeDual=posterior(
                raw.recent.regimes.getValue(regime),
                globalRecent.regimes.getValue(regime),
                "dual",22
            )
            val archiveRows=archiveBySymbol[raw.input.symbol].orEmpty()
            var wSum=0.0
            var dualWeighted=0.0
            for(e in archiveRows) {
                val ageDays=max(0.0,(now.toEpochMilli()-e.evaluatedAt.toEpochMilli()).toDouble()/86_400_000.0)
                val w=.5.pow(ageDays/policy.learningHalfLifeDays.coerceAtLeast(1))
                wSum+=w
                if(e.targetHit) dualWeighted+=w
            }
            val archiveDual=if(wSum>0) dualWeighted/wSum else globalDual
            val dual=.42*patternDual+.18*baseDual+.12*lifeDual+.13*regimeDual+.15*archiveDual
            val lift=if(globalDual!=0.0) dual/globalDual else null
            val confidence=clamp(100*(1-exp(-(raw.recent.all.n+wSum*2)/95.0)),0.0,100.0)
            val edgeNorm=clamp(((lift?:1.0)-.65)/1.9,0.0,1.0)
            val absNorm=clamp(dual/.25,0.0,1.0)
            val fiveNorm=clamp(patternFive/.38,0.0,1.0)
            val score=100*(.42*edgeNorm+.25*absNorm+.18*fiveNorm+.15*confidence/100)
            val character=behaviorCharacter(raw.series,raw.recent,policy.lookbackSessions)
            raw.input.symbol to BehaviorMetaScore(
                bd(score),bd(dual),bd(patternFive),
                bd(posterior(raw.recent.all,globalRecent.all,"top20",24)),
                lift?.let(::bd),bd(confidence),raw.recent.all.n,character,
                active,raw.lifetime.all.n
            )
        }
    }

    private fun series(input:BehaviorMetaInput):Series {
        val bars=input.bars.sortedBy{it.at}
        val indexByDate=input.indexBars.associateBy{LocalDate.ofInstant(it.at,zone)}
        return Series(
            dates=bars.map{LocalDate.ofInstant(it.at,zone)},
            close=bars.map{(it.adjustedClose?:it.close).toDouble()},
            open=bars.map{it.open?.toDouble()},
            high=bars.map{it.high.toDouble()},
            low=bars.map{it.low.toDouble()},
            volume=bars.map{it.volume.toDouble()},
            index=bars.map{b->indexByDate[LocalDate.ofInstant(b.at,zone)]?.let{(it.adjustedClose?:it.close).toDouble()}}
        )
    }

    private fun historicalReelTop20(series:Map<String,Series>,targetPct:Double):Map<LocalDate,Set<String>> {
        val byDate=linkedMapOf<LocalDate,MutableList<Pair<String,Double>>>()
        for((symbol,s) in series) {
            for(i in 1 until s.close.size) {
                val prev=s.close[i-1]; val now=s.close[i]
                if(prev<=0||now<=0) continue
                val ret=100*(now/prev-1)
                if(!ret.isFinite()||ret<=-99.5) continue
                byDate.getOrPut(s.dates[i]){mutableListOf()} += symbol to ret
            }
        }
        return byDate.mapValues { (_,rows) ->
            val sorted=rows.sortedWith(compareByDescending<Pair<String,Double>>{it.second}.thenBy{it.first})
            val n=min(20,max(1,ceil(sorted.size*targetPct).toInt()))
            sorted.take(n).map{it.first}.toSet()
        }
    }

    private fun rawWindow(
        input:BehaviorMetaInput,s:Series,reel:Map<LocalDate,Set<String>>,
        start:Int,policy:BehaviorMetaPolicy
    ):Window {
        val out=Window()
        for(i in max(21,start) until s.close.size-2) {
            val entry=s.open.getOrNull(i+1) ?: continue
            if(entry<=0) continue
            val maxPx=max(s.high[i+1],s.high[i+2])
            val closePx=s.close[i+2]
            val cost=input.estimatedCostPct?.toDouble()?:0.0
            val nextRet=100*(s.close[i+1]/entry-1)-cost
            val maxNet=100*(maxPx/entry-1)-cost
            val closeNet=100*(closePx/entry-1)-cost
            val five=maxNet>=policy.targetReturnPct
            val top1=reel[s.dates[i+1]]?.contains(input.symbol)==true
            val top2=reel[s.dates[i+2]]?.contains(input.symbol)==true
            val top=top1||top2
            update(out.all,nextRet>0,five,top,five&&top,five&&top1,five&&!top1&&top2,nextRet,maxNet,closeNet)
            for(flag in behaviorFlags(s,i)) {
                update(out.patterns.getValue(flag),nextRet>0,five,top,five&&top,five&&top1,five&&!top1&&top2,nextRet,maxNet,closeNet)
            }
            update(out.regimes.getValue(historicalRegime(s,i)),nextRet>0,five,top,five&&top,five&&top1,five&&!top1&&top2,nextRet,maxNet,closeNet)
        }
        return out
    }

    private fun behaviorFlags(s:Series,i:Int):List<String> {
        if(i<21||i>=s.close.size) return emptyList()
        fun ret(g:Int):Double?=if(i>=g&&s.close[i-g]>0)100*(s.close[i]/s.close[i-g]-1) else null
        val ret1=ret(1); val ret5=ret(5); val ret10=ret(10)
        val priorHigh=s.high.subList(i-20,i).maxOrNull()
        val avgVol=avgD(s.volume.subList(i-20,i))
        val volRatio=ratio(s.volume[i],avgVol)
        val ma20=avgD(s.close.subList(i-19,i+1))
        val ranges=(i-20 until i).mapNotNull { j ->
            if(j>0&&s.close[j-1]>0)100*(s.high[j]-s.low[j])/s.close[j-1] else null
        }
        val rangeNow=if(s.close[i-1]>0)100*(s.high[i]-s.low[i])/s.close[i-1] else null
        val rangeRatio=ratio(rangeNow,avgD(ranges))
        val rets=changesD(s.close)
        val vol5=stdevN(rets.subList(max(0,i-4),i+1))
        val vol21=stdevN(rets.subList(max(0,i-20),i+1))
        val open=s.open[i]
        val gap=if(open!=null&&s.close[i-1]>0)100*(open/s.close[i-1]-1) else null
        val intra=if(open!=null&&open>0)100*(s.close[i]/open-1) else null
        val barRange=s.high[i]-s.low[i]
        val lowerWick=if(open!=null&&barRange>0)(min(open,s.close[i])-s.low[i])/barRange else 0.0
        val idxNow=s.index.getOrNull(i); val idx5=s.index.getOrNull(i-5)
        val rel5=if(ret5!=null&&idxNow!=null&&idx5!=null&&idx5>0)ret5-100*(idxNow/idx5-1) else null
        return buildList {
            if(priorHigh!=null&&s.close[i]>=priorHigh*.995&&(volRatio?:0.0)>=1.15&&(ret1?:0.0)>0)add("BREAKOUT")
            if((volRatio?:0.0)>=1.5&&(ret1?:0.0)>=1)add("VOLUME")
            if((ret5?:0.0)>=2&&(ret5?:0.0)<=11&&(ret10?:0.0)>=3&&s.close[i]>=(ma20?:s.close[i]))add("MOMENTUM")
            if(vol5!=null&&vol21!=null&&vol5<vol21*.78&&(rangeRatio?:0.0)>=1.35&&(ret1?:0.0)>0)add("SQUEEZE")
            if(gap!=null&&gap>=0&&gap<=4&&intra!=null&&intra>=.5&&intra<=7)add("GAP")
            if((rets.getOrNull(i-1)?:0.0)<=-2.5&&(ret1?:0.0)>0&&lowerWick>=.22)add("REBOUND")
            if(rel5!=null&&rel5>=2&&(ret1?:0.0)>0)add("RELATIVE")
        }
    }

    private fun historicalRegime(s:Series,i:Int):String {
        val idx=s.index
        val current=idx.getOrNull(i) ?: return "NEUTRAL"
        val m20=avgN(idx.subList(max(0,i-19),i+1))
        val m50=avgN(idx.subList(max(0,i-49),i+1))
        val rr=changesN(idx.subList(max(0,i-22),i+1))
        val vol=stdevN(rr)
        if(abs(rr.lastOrNull()?:0.0)>=2||(vol?:0.0)>=2.5)return "VOLATILE"
        if(current>(m20?:current)&&current>(m50?:current))return "BULL"
        if(current<(m20?:current)&&current<(m50?:current))return "BEAR"
        return "NEUTRAL"
    }

    private fun behaviorCharacter(s:Series,recent:Window,lookback:Int):String {
        val c=s.close.takeLast(max(60,lookback))
        val rets=changesD(c).filterNotNull()
        val same=mutableListOf<Double>()
        for(i in 1 until rets.size) if(rets[i]!=0.0&&rets[i-1]!=0.0)
            same+=if(sign(rets[i])==sign(rets[i-1]))1.0 else 0.0
        var rebounds=0; var neg=0
        for(i in 1 until rets.size) if(rets[i-1]<=-2) { neg++; if(rets[i]>0)rebounds++ }
        val persistence=avgD(same)
        val rebound=if(neg>0)rebounds.toDouble()/neg else null
        val vol=stdevD(rets)
        return when {
            (vol?:0.0)>=3.5 -> "Yüksek Oynak"
            (persistence?:0.0)>=.56 -> "Trend Takipçisi"
            (rebound?:0.0)>=.60 -> "Ortalamaya Dönen"
            (rate(recent.patterns.getValue("BREAKOUT"),"dual")?:0.0)>.12 -> "Kırılım Duyarlı"
            else -> "Dengeli"
        }
    }

    private fun merge(windows:List<Window>):Window {
        val out=Window()
        for(w in windows) {
            add(out.all,w.all)
            for(k in patterns)add(out.patterns.getValue(k),w.patterns.getValue(k))
            for(k in regimes)add(out.regimes.getValue(k),w.regimes.getValue(k))
        }
        return out
    }
    private fun update(s:Stat,pos:Boolean,five:Boolean,top:Boolean,dual:Boolean,same:Boolean,next:Boolean,nr:Double,mx:Double,cl:Double) {
        s.n++; if(pos)s.positive++; if(five)s.five++; if(top)s.top20++; if(dual)s.dual++
        if(same)s.sameDay++; if(next)s.nextDay++; s.sumNext+=nr; s.sumMax+=mx; s.sumClose+=cl
    }
    private fun add(a:Stat,b:Stat) {
        a.n+=b.n;a.positive+=b.positive;a.five+=b.five;a.top20+=b.top20;a.dual+=b.dual
        a.sameDay+=b.sameDay;a.nextDay+=b.nextDay;a.sumNext+=b.sumNext;a.sumMax+=b.sumMax;a.sumClose+=b.sumClose
    }
    private fun rate(s:Stat,key:String):Double?=if(s.n==0)null else when(key) {
        "dual"->s.dual/s.n;"five"->s.five/s.n;"top20"->s.top20/s.n;"positive"->s.positive/s.n;else->null
    }
    private fun posterior(s:Stat,g:Stat,key:String,priorN:Int):Double {
        val prior=rate(g,key) ?: when(key){"dual"->.06;"five"->.12;"top20"->.18;else->.5}
        val num=when(key){"dual"->s.dual;"five"->s.five;"top20"->s.top20;"positive"->s.positive;else->0.0}
        return (num+prior*priorN)/(s.n+priorN)
    }
    private fun changesD(x:List<Double>):List<Double?> = x.mapIndexed { i,v ->
        if(i==0||x[i-1]<=0||v<=0)null else (100*(v/x[i-1]-1)).takeIf{it.isFinite()&&it>-99.5}
    }
    private fun changesN(x:List<Double?>):List<Double?> = x.mapIndexed { i,v ->
        val p=if(i>0)x[i-1] else null
        if(i==0||v==null||p==null||p<=0||v<=0)null else (100*(v/p-1)).takeIf{it.isFinite()&&it>-99.5}
    }
    private fun stdevN(xs:List<Double?>):Double? {
        val v=xs.filterNotNull().filter{it.isFinite()}; if(v.size<2)return null
        val m=v.average(); return sqrt(v.sumOf{(it-m)*(it-m)}/(v.size-1))
    }
    private fun stdevD(xs:List<Double>):Double? {
        if(xs.size<2)return null; val m=xs.average(); return sqrt(xs.sumOf{(it-m)*(it-m)}/(xs.size-1))
    }
    private fun ratio(a:Double?,b:Double?):Double?=if(a==null||b==null||b==0.0)null else a/b
    private fun avgD(xs:Collection<Double>):Double?=if(xs.isEmpty())null else xs.average()
    private fun avgN(xs:Collection<Double?>):Double?=xs.filterNotNull().filter{it.isFinite()}.let{if(it.isEmpty())null else it.average()}
    private fun clamp(v:Double,lo:Double,hi:Double)=v.coerceIn(lo,hi)
    private fun bd(v:Double)=BigDecimal.valueOf(v)
}
