package io.aurum.aurumb.formula

import io.aurum.aurumb.feature.MarketBar
import java.math.BigDecimal
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sign
import kotlin.math.sqrt
import kotlin.math.tanh

data class K12MetaInput(
    val symbol:String,
    val bars:List<MarketBar>,
    val indexBars:List<MarketBar>,
    val features:AurumBFeatures,
    val behavior:BehaviorMetaScore?
)

data class K12MetaPolicy(
    val targetReturnPct:Double=5.0,
    val crossSectionalTargetPct:Double=.05,
    val genomeLookbackDays:Int=252,
    val nearestNeighbors:Int=40,
    val minAnalogs:Int=20,
    val priorStrength:Double=16.0
)

data class K12ScenarioStats(
    val n:Int,
    val dualRate:BigDecimal?,
    val fiveRate:BigDecimal?,
    val top20Rate:BigDecimal?,
    val avgMax:BigDecimal?
)

data class K12MetaScore(
    val score:BigDecimal,
    val marketCharacterScore:BigDecimal,
    val k10RewardScore:BigDecimal,
    val marketCompatibility:BigDecimal,
    val regimeFit:BigDecimal,
    val characterConfidence:BigDecimal,
    val marketRegime:String,
    val genomeScore:BigDecimal,
    val genomeConfidence:BigDecimal,
    val genomeFeatureCount:Int,
    val genomeTotalFeatures:Int,
    val temperament:String,
    val genomeDualRate:BigDecimal?=null,
    val genomeLift:BigDecimal?=null,
    val analogNeighbors:Int=0,
    val analogEffectiveN:BigDecimal=BigDecimal.ZERO,
    val currentScenario:String="—",
    val scenarioDualRate:BigDecimal?=null,
    val topTraits:List<String> = emptyList(),
    val scenarios:Map<String,K12ScenarioStats> = emptyMap()
)

/**
 * Effective R29 K12:
 * 70% market/stock-character fit + 30% K10 reward-memory.
 * It is diagnostic/meta only and has no S/AL/SAT decision weight.
 */
object K12MetaEngine {
    const val TOTAL_GENOME_TRAITS=89
    private val MARKET_SHARE=BigDecimal("0.70")
    private val K10_SHARE=BigDecimal("0.30")
    private val zone=ZoneId.of("Europe/Istanbul")

    private data class Series(
        val dates:List<LocalDate>, val close:List<Double>, val open:List<Double?>,
        val high:List<Double>, val low:List<Double>, val volume:List<Double>,
        val index:List<Double?>
    )
    private data class Analog(
        val neighbors:Int,val effectiveN:Double,val dualRate:Double?,val fiveRate:Double?,
        val top20Rate:Double?,val expectedMax:Double?,val expectedClose:Double?,val similarity:Double?
    )
    private data class Scenario(
        var n:Int=0,var dual:Int=0,var five:Int=0,var top20:Int=0,var sumMax:Double=0.0
    ) {
        val dualRate:Double? get()=if(n==0)null else dual.toDouble()/n
        val fiveRate:Double? get()=if(n==0)null else five.toDouble()/n
        val top20Rate:Double? get()=if(n==0)null else top20.toDouble()/n
        val avgMax:Double? get()=if(n==0)null else sumMax/n
    }
    private data class Genome(
        val features:Map<String,Double>,val featureCount:Int,val analog:Analog,
        val scenarios:Map<String,Scenario>
    )
    private data class Profile(
        val score:Double,val dualRate:Double,val fiveRate:Double?,val top20Rate:Double?,
        val lift:Double?,val confidence:Double,val featureCount:Int,val temperament:String,
        val features:Map<String,Double>,val analog:Analog,val currentScenario:String,
        val scenario:Scenario?,val scenarios:Map<String,Scenario>
    )
    private data class Market(
        val regime:String,val confidence:Double,val vector:Map<String,Double>
    )
    private data class Character(
        val vector:Map<String,Double>,val confidence:Double,val temperament:String
    )
    private data class Tmp(
        val input:K12MetaInput,val series:Series,val genome:Genome,val profile:Profile
    )

    fun score(
        inputs:List<K12MetaInput>,
        k10:Map<String,K10RewardMemory>,
        policy:K12MetaPolicy=K12MetaPolicy()
    ):Map<String,K12MetaScore> {
        if(inputs.isEmpty()) return emptyMap()
        val seriesBySymbol=inputs.associate { it.symbol to series(it) }
        val reel=historicalReelTop20(seriesBySymbol,policy.crossSectionalTargetPct)
        val globalDual=globalDualRate(inputs,seriesBySymbol,reel,policy) ?: return emptyMap()
        val tmp=inputs.mapNotNull { input ->
            val s=seriesBySymbol[input.symbol] ?: return@mapNotNull null
            if(s.close.size<24) return@mapNotNull null
            val start=max(63,s.close.size-policy.genomeLookbackDays-2)
            val g=computeGenome(input,s,reel,start,policy)
            val p=finalizeProfile(input,g,globalDual)
            Tmp(input,s,g,p)
        }
        if(tmp.isEmpty()) return emptyMap()

        val market=marketCharacter(tmp)
        val character=tmp.associate { it.input.symbol to stockCharacter(it) }
        data class MarketRow(val symbol:String,val score:Double,val compatibility:Double,val regimeEvidence:Double,val confidence:Double,val temperament:String,val genome:Profile)
        val pre=tmp.map { t ->
            val ch=character.getValue(t.input.symbol)
            val compatibility=cosineFit(market.vector,ch.vector)
            MarketRow(t.input.symbol,0.0,compatibility,regimeRaw(t.profile,market.regime),ch.confidence,ch.temperament,t.profile)
        }
        val regimePct=percentileMap(pre.associate{it.symbol to it.regimeEvidence})
        return pre.mapNotNull { row ->
            val regimeFit=regimePct[row.symbol] ?: return@mapNotNull null
            val memory=k10[row.symbol]?.takeIf{it.evidenceCount>0} ?: return@mapNotNull null
            val base=.60*row.compatibility+.25*regimeFit+.15*(100*row.confidence)
            val trust=.25+.75*market.confidence
            val marketScore=cap(50+(base-50)*trust)
            val marketScoreDecimal=bd(marketScore)
            val k10Score=memory.score
            val final=combineMarketAndMemory(marketScoreDecimal,k10Score)
            val traits=row.genome.features.entries
                .filter { it.value.isFinite() }
                .sortedByDescending { kotlin.math.abs(it.value) }
                .take(3).map { it.key }
            row.symbol to K12MetaScore(
                score=final,
                marketCharacterScore=marketScoreDecimal,
                k10RewardScore=k10Score,
                marketCompatibility=bd(row.compatibility),
                regimeFit=bd(regimeFit),
                characterConfidence=bd(row.confidence),
                marketRegime=market.regime,
                genomeScore=bd(row.genome.score),
                genomeConfidence=bd(row.genome.confidence),
                genomeFeatureCount=row.genome.featureCount,
                genomeTotalFeatures=TOTAL_GENOME_TRAITS,
                temperament=row.temperament,
                genomeDualRate=bd(row.genome.dualRate),
                genomeLift=row.genome.lift?.let(::bd),
                analogNeighbors=row.genome.analog.neighbors,
                analogEffectiveN=bd(row.genome.analog.effectiveN),
                currentScenario=row.genome.currentScenario,
                scenarioDualRate=row.genome.scenario?.dualRate?.let(::bd),
                topTraits=traits,
                scenarios=row.genome.scenarios.mapValues { (_,s) ->
                    K12ScenarioStats(
                        n=s.n,
                        dualRate=s.dualRate?.let(::bd),
                        fiveRate=s.fiveRate?.let(::bd),
                        top20Rate=s.top20Rate?.let(::bd),
                        avgMax=s.avgMax?.let(::bd)
                    )
                }
            )
        }.toMap()
    }

    fun combineMarketAndMemory(
        marketCharacterScore:BigDecimal,
        k10RewardScore:BigDecimal
    ):BigDecimal {
        require(marketCharacterScore in BigDecimal.ZERO..BigDecimal("100"))
        require(k10RewardScore in BigDecimal.ZERO..BigDecimal("100"))
        return marketCharacterScore.multiply(MARKET_SHARE)
            .add(k10RewardScore.multiply(K10_SHARE))
            .coerceIn(BigDecimal.ZERO,BigDecimal("100"))
    }

    private fun series(input:K12MetaInput):Series {
        val bars=input.bars.sortedBy{it.at}
        val idxByDate=input.indexBars.associateBy{LocalDate.ofInstant(it.at,zone)}
        return Series(
            bars.map{LocalDate.ofInstant(it.at,zone)},
            bars.map{(it.adjustedClose?:it.close).toDouble()},
            bars.map{it.open?.toDouble()},
            bars.map{it.high.toDouble()},
            bars.map{it.low.toDouble()},
            bars.map{it.volume.toDouble()},
            bars.map{b->idxByDate[LocalDate.ofInstant(b.at,zone)]?.let{(it.adjustedClose?:it.close).toDouble()}}
        )
    }

    private fun historicalReelTop20(series:Map<String,Series>,targetPct:Double):Map<LocalDate,Set<String>> {
        val byDate=linkedMapOf<LocalDate,MutableList<Pair<String,Double>>>()
        for((symbol,s) in series) for(i in 1 until s.close.size) {
            val p=s.close[i-1]; val c=s.close[i]
            if(p<=0||c<=0) continue
            val r=100*(c/p-1)
            if(r.isFinite()&&r>-99.5) byDate.getOrPut(s.dates[i]){mutableListOf()} += symbol to r
        }
        return byDate.mapValues { (_,rows) ->
            val ordered=rows.sortedWith(compareByDescending<Pair<String,Double>>{it.second}.thenBy{it.first})
            val n=min(20,max(1,ceil(ordered.size*targetPct).toInt()))
            ordered.take(n).map{it.first}.toSet()
        }
    }

    private fun globalDualRate(
        inputs:List<K12MetaInput>,series:Map<String,Series>,reel:Map<LocalDate,Set<String>>,policy:K12MetaPolicy
    ):Double? {
        var n=0; var dual=0
        for(input in inputs) {
            val s=series[input.symbol] ?: continue
            val start=max(21,s.close.size-policy.genomeLookbackDays-2)
            for(i in start until s.close.size-2) {
                val entry=s.open.getOrNull(i+1) ?: continue
                if(entry<=0) continue
                val maxPx=max(s.high[i+1],s.high[i+2])
                val maxNet=100*(maxPx/entry-1)-(input.features.estimatedCostPct?.toDouble()?:0.0)
                val five=maxNet>=policy.targetReturnPct
                val top=reel[s.dates[i+1]]?.contains(input.symbol)==true || reel[s.dates[i+2]]?.contains(input.symbol)==true
                n++; if(five&&top) dual++
            }
        }
        return if(n==0)null else dual.toDouble()/n
    }

    private fun computeGenome(
        input:K12MetaInput,s:Series,reel:Map<LocalDate,Set<String>>,start:Int,policy:K12MetaPolicy
    ):Genome {
        val c=s.close; val o=s.open; val h=s.high; val l=s.low; val v=s.volume; val idx=s.index
        val n=c.size; val look=min(policy.genomeLookbackDays,n); val begin=max(1,n-look)
        val r=changesD(c); val ir=changesN(idx); val rw=r.subList(begin,r.size)
        fun roll(w:Int)=rw.takeLast(min(w,rw.size))
        fun iroll(w:Int)=ir.subList(begin.coerceAtMost(ir.size),ir.size).takeLast(min(w,(ir.size-begin).coerceAtLeast(0)))
        val turnover=c.indices.map{i->c[i]*v[i]}
        val gaps=mutableListOf<Double>(); val locs=mutableListOf<Double>(); val upp=mutableListOf<Double>()
        val loww=mutableListOf<Double>(); val bodies=mutableListOf<Double>(); val ranges=mutableListOf<Double>()
        val posGap=mutableListOf<Double>(); val negGap=mutableListOf<Double>()
        data class Count(var n:Int=0,var ok:Int=0,var no:Int=0)
        val break20=Count(); val break63=Count(); val support=Count(); val reject=Count()
        val upVol=mutableListOf<Double>(); val dnVol=mutableListOf<Double>()
        var acc=0; var dist=0
        val reg=linkedMapOf("BULL" to mutableListOf<Double>(),"BEAR" to mutableListOf<Double>(),"VOLATILE" to mutableListOf<Double>(),"NEUTRAL" to mutableListOf<Double>())
        val regFive=linkedMapOf("BULL" to intArrayOf(0,0),"BEAR" to intArrayOf(0,0),"VOLATILE" to intArrayOf(0,0),"NEUTRAL" to intArrayOf(0,0))
        val recover=mutableListOf<Double>()

        for(i in max(begin,1) until n) {
            val prev=c[i-1]; val open=o[i]; val range=h[i]-l[i]
            val gap=if(open!=null&&prev>0)100*(open/prev-1) else null
            val loc=if(range!=0.0) cap01((c[i]-l[i])/range) else .5
            val up=if(open!=null&&prev>0&&range!=0.0)100*(h[i]-max(open,c[i]))/prev else null
            val lw=if(open!=null&&prev>0&&range!=0.0)100*(min(open,c[i])-l[i])/prev else null
            val body=if(open!=null&&prev>0)100*abs(c[i]-open)/prev else null
            gap?.takeIf{it.isFinite()}?.let(gaps::add); locs+=loc
            up?.takeIf{it.isFinite()}?.let(upp::add); lw?.takeIf{it.isFinite()}?.let(loww::add)
            body?.takeIf{it.isFinite()}?.let(bodies::add)
            if(prev>0) ranges+=100*range/prev
            if(gap!=null&&gap>0&&i+1<n&&open!=null) posGap+=if(c[i]>open)1.0 else 0.0
            if(gap!=null&&gap<0&&i+1<n&&open!=null) negGap+=if(c[i]>open)1.0 else 0.0
            val ri=r[i]
            if(ri!=null&&ri>0)upVol+=v[i]
            if(ri!=null&&ri<0)dnVol+=v[i]
            if(ri!=null&&ri>0&&loc>=.65)acc++
            if(ri!=null&&ri<0&&loc<=.35)dist++
            val rg=historicalRegime(s,i); ri?.let{reg.getValue(rg)+=it}
            if(i+2<n) {
                val entry=o[i+1]
                if(entry!=null&&entry>0) {
                    val mx=max(h[i+1],h[i+2])
                    val five=100*(mx/entry-1)-(input.features.estimatedCostPct?.toDouble()?:0.0)>=policy.targetReturnPct
                    regFive.getValue(rg)[1]++; if(five)regFive.getValue(rg)[0]++
                }
            }
            val ph20=h.subList(max(0,i-20),i).maxOrNull()
            val ph63=h.subList(max(0,i-63),i).maxOrNull()
            val pl10=l.subList(max(0,i-10),i).minOrNull()
            if(ph20!=null&&c[i]>=ph20*.995&&i+2<n){break20.n++;if(max(h[i+1],h[i+2])>=c[i]*1.05)break20.ok++;if(c[i+2]<c[i])break20.no++}
            if(ph63!=null&&c[i]>=ph63*.995&&i+2<n){break63.n++;if(max(h[i+1],h[i+2])>=c[i]*1.05)break63.ok++}
            if(pl10!=null&&l[i]<=pl10*1.01){support.n++;if(i+2<n&&c[i+2]>c[i])support.ok++}
            if(ph20!=null&&h[i]>=ph20*.99){reject.n++;if(i+1<n&&c[i+1]<c[i])reject.ok++}
            if((ri?:0.0)<=-3){for(j in i+1 until min(n,i+21))if(c[j]>=prev){recover+=(j-i).toDouble();break}}
        }

        fun pairedBeta(w:Int)=beta(roll(w),iroll(w))
        fun pairedCorr(w:Int)=corr(roll(w),iroll(w))
        val upIdx=mutableListOf<Double>(); val upSt=mutableListOf<Double>()
        val dnIdx=mutableListOf<Double>(); val dnSt=mutableListOf<Double>(); val shock=mutableListOf<Double>()
        for(i in max(begin,1) until n) {
            val a=r[i]; val b=ir.getOrNull(i)
            if(a==null||b==null)continue
            if(b>0){upIdx+=b;upSt+=a}; if(b<0){dnIdx+=b;dnSt+=a}; if(abs(b)>=2)shock+=a
        }
        val q05=quantile(roll(252),.05); val tail=roll(252).filterNotNull().filter{q05!=null&&it<=q05}
        val peak=c.subList(begin,n).maxOrNull(); val peakIx=peak?.let{c.lastIndexOf(it)}
        val drawDur=peakIx?.let{n-1-it}?.toDouble()
        val same=mutableListOf<Double>()
        for(i in max(begin+1,2) until n) {
            val a=r[i]; val b=r[i-1]; if(a!=null&&b!=null&&a!=0.0&&b!=0.0)same+=if(sign(a)==sign(b))1.0 else 0.0
        }
        val absR=rw.map{it?.let(::abs)}; val absLag=absR.dropLast(1); val absNow=absR.drop(1)
        val v5=meanD(v.takeLast(5)); val v21=meanD(v.takeLast(21)); val v63=meanD(v.takeLast(63))
        val t5=meanD(turnover.takeLast(5)); val t21=meanD(turnover.takeLast(21)); val t63=meanD(turnover.takeLast(63))
        val volCh=changesD(v)
        val last=n-1
        val features=linkedMapOf<String,Double?>(
            "ret1d" to retAt(c,last,1),"ret3d" to retAt(c,last,3),"ret5d" to retAt(c,last,5),
            "ret10d" to retAt(c,last,10),"ret21d" to retAt(c,last,21),"ret63d" to retAt(c,last,63),
            "ret126d" to retAt(c,last,126),"ret252d" to retAt(c,last,min(252,last)),
            "positiveDayRate" to ratioCount(rw){(it?:0.0)>0},
            "trendPersistence" to meanD(same),
            "returnAcceleration" to pair(retAt(c,last,5),retAt(c,last,10)){a,b->a-b/2},
            "reversalTendency" to meanD(same.map{1-it}),
            "alpha1" to pair(r[last],ir.getOrNull(last)){a,b->a-b},
            "alpha5" to pair(retAt(c,last,5),retAtN(idx,last,5)){a,b->a-b},
            "alpha10" to pair(retAt(c,last,10),retAtN(idx,last,10)){a,b->a-b},
            "alpha21" to pair(retAt(c,last,21),retAtN(idx,last,21)){a,b->a-b},
            "alpha63" to pair(retAt(c,last,63),retAtN(idx,last,63)){a,b->a-b},
            "beta21" to pairedBeta(21),"beta63" to pairedBeta(63),"beta126" to pairedBeta(126),
            "corr21" to pairedCorr(21),"corr63" to pairedCorr(63),"corr126" to pairedCorr(126),
            "upCapture" to safeRatio(meanD(upSt),meanD(upIdx)),
            "downCapture" to safeRatio(meanD(dnSt),meanD(dnIdx)),
            "shockSensitivity" to meanD(shock),"recoverySpeed" to meanD(recover),
            "vol5" to stdevN(roll(5)),"vol21" to stdevN(roll(21)),"vol63" to stdevN(roll(63)),"vol126" to stdevN(roll(126)),
            "downsideVol21" to stdevD(roll(21).filterNotNull().filter{it<0}),
            "upsideVol21" to stdevD(roll(21).filterNotNull().filter{it>0}),
            "atrMean21" to meanD(ranges.takeLast(21)),"rangeMean21" to meanD(ranges.takeLast(21)),
            "rangeExpansion" to safeRatio(meanD(ranges.takeLast(5)),meanD(ranges.takeLast(21))),
            "skew21" to skew(roll(21)),"kurt21" to kurt(roll(21)),
            "var95" to q05,"cvar95" to meanD(tail.filterNotNull()),
            "maxDrawdown252" to maxDrawdown(c.subList(begin,n)),"drawdownDuration" to drawDur,
            "volClustering" to corr(absLag,absNow),
            "volumeRatio5_21" to safeRatio(v5,v21),"volumeRatio21_63" to safeRatio(v21,v63),
            "turnoverRatio5_21" to safeRatio(t5,t21),"turnoverRatio21_63" to safeRatio(t21,t63),
            "upDownVolumeRatio" to safeRatio(meanD(upVol),meanD(dnVol)),
            "priceVolumeCorr21" to corr(c.takeLast(21),v.takeLast(21)),
            "volumeReturnCorr21" to corr(roll(21),v.takeLast(21)),
            "volumePersistence" to corr(volCh.dropLast(1).takeLast(21),volCh.takeLast(21)),
            "accumulationRate" to if(rw.isEmpty())null else acc.toDouble()/rw.size,
            "distributionRate" to if(rw.isEmpty())null else dist.toDouble()/rw.size,
            "amihud21" to input.features.amihud?.toDouble(),
            "zeroVolumeRate" to if(v.subList(begin,n).isEmpty())null else v.subList(begin,n).count{it==0.0}.toDouble()/(n-begin),
            "moneyFlowSurge" to null, // MFI delta history is not persisted; do not fabricate.
            "obvTrend" to input.features.obvSlope?.toDouble(),
            "avgGap21" to meanD(gaps.takeLast(21)),"gapVol21" to stdevD(gaps.takeLast(21)),
            "positiveGapContinuation" to meanD(posGap),"negativeGapReversal" to meanD(negGap),
            "closeLocationMean21" to meanD(locs.takeLast(21)),"upperWickMean21" to meanD(upp.takeLast(21)),
            "lowerWickMean21" to meanD(loww.takeLast(21)),"bodyMean21" to meanD(bodies.takeLast(21)),
            "breakout20Success" to if(break20.n==0)null else break20.ok.toDouble()/break20.n,
            "breakout63Success" to if(break63.n==0)null else break63.ok.toDouble()/break63.n,
            "falseBreakoutRate" to if(break20.n==0)null else break20.no.toDouble()/break20.n,
            "supportBounceRate" to if(support.n==0)null else support.ok.toDouble()/support.n,
            "resistanceRejectRate" to if(reject.n==0)null else reject.ok.toDouble()/reject.n,
            "streakStrength" to longestSignedRun(rw).toDouble(),
            "bullAvgReturn" to meanD(reg.getValue("BULL")),"bearAvgReturn" to meanD(reg.getValue("BEAR")),
            "volatileAvgReturn" to meanD(reg.getValue("VOLATILE")),"neutralAvgReturn" to meanD(reg.getValue("NEUTRAL")),
            "bullPositiveRate" to positiveRate(reg.getValue("BULL")),"bearPositiveRate" to positiveRate(reg.getValue("BEAR")),
            "volatilePositiveRate" to positiveRate(reg.getValue("VOLATILE")),
            "bullFiveRate" to ratePair(regFive.getValue("BULL")),"bearFiveRate" to ratePair(regFive.getValue("BEAR")),
            "volatileFiveRate" to ratePair(regFive.getValue("VOLATILE")),
            "regimeConsistency" to (1-(stdevD(listOfNotNull(meanD(reg.getValue("BULL")),meanD(reg.getValue("BEAR")),meanD(reg.getValue("VOLATILE")),meanD(reg.getValue("NEUTRAL"))))?:0.0)/8),
            "downsideResilience" to pair(meanD(dnSt),meanD(dnIdx)){a,b->a-b},
            "pe" to null,"pb" to null,"evEbitda" to null,"roe" to null,"freeFloat" to null,"logMarketCap" to null
        )
        val present=features.mapNotNull{(k,v)->v?.takeIf{it.isFinite()}?.let{k to it}}.toMap()
        return Genome(
            present,present.size,
            analogForecast(input,s,reel,start,policy),
            scenarioMatrix(input,s,reel,start,policy)
        )
    }

    private fun analogForecast(
        input:K12MetaInput,s:Series,reel:Map<LocalDate,Set<String>>,start:Int,policy:K12MetaPolicy
    ):Analog {
        val cur=contextAt(s,s.close.lastIndex) ?: return Analog(0,0.0,null,null,null,null,null,null)
        if(s.close.size<70) return Analog(0,0.0,null,null,null,null,null,null)
        data class Row(val sim:Double,val dual:Boolean,val five:Boolean,val top:Boolean,val maxNet:Double,val closeNet:Double)
        val rows=mutableListOf<Row>()
        for(i in max(63,start) until s.close.size-2) {
            val ctx=contextAt(s,i); val dist=distance(cur,ctx) ?: continue
            val entry=s.open.getOrNull(i+1) ?: continue
            if(entry<=0)continue
            val maxPx=max(s.high[i+1],s.high[i+2]); val closePx=s.close[i+2]
            var sim=exp(-3.2*dist)
            if(historicalRegime(s,i)==historicalRegime(s,s.close.lastIndex))sim*=1.18
            val cost=input.features.estimatedCostPct?.toDouble()?:0.0
            val maxNet=100*(maxPx/entry-1)-cost; val closeNet=100*(closePx/entry-1)-cost
            val five=maxNet>=policy.targetReturnPct
            val top=reel[s.dates[i+1]]?.contains(input.symbol)==true || reel[s.dates[i+2]]?.contains(input.symbol)==true
            rows+=Row(sim,five&&top,five,top,maxNet,closeNet)
        }
        val take=rows.sortedByDescending{it.sim}.take(policy.nearestNeighbors)
        val w=take.sumOf{it.sim}; val p=policy.priorStrength
        val dual=(take.sumOf{it.sim*(if(it.dual)1.0 else 0.0)}+.06*p)/(w+p)
        val five=(take.sumOf{it.sim*(if(it.five)1.0 else 0.0)}+.12*p)/(w+p)
        val top=(take.sumOf{it.sim*(if(it.top)1.0 else 0.0)}+.18*p)/(w+p)
        return Analog(
            take.size,w,dual,five,top,
            if(w>0)take.sumOf{it.sim*it.maxNet}/w else null,
            if(w>0)take.sumOf{it.sim*it.closeNet}/w else null,
            if(take.isEmpty())null else take.map{it.sim}.average()
        )
    }

    private fun scenarioMatrix(
        input:K12MetaInput,s:Series,reel:Map<LocalDate,Set<String>>,start:Int,policy:K12MetaPolicy
    ):Map<String,Scenario> {
        val out=linkedMapOf<String,Scenario>()
        for(i in max(63,start) until s.close.size-2) {
            val avgV=meanD(s.volume.subList(i-20,i)); val vr=safeRatio(s.volume[i],avgV)?:1.0
            val volState=if(vr>=1.4)"HIGH" else if(vr<=.75)"LOW" else "NORMAL"
            val rg=historicalRegime(s,i); val key="$rg|$volState"
            val entry=s.open.getOrNull(i+1) ?: continue
            if(entry<=0)continue
            val maxPx=max(s.high[i+1],s.high[i+2])
            val maxNet=100*(maxPx/entry-1)-(input.features.estimatedCostPct?.toDouble()?:0.0)
            val five=maxNet>=policy.targetReturnPct
            val top=reel[s.dates[i+1]]?.contains(input.symbol)==true || reel[s.dates[i+2]]?.contains(input.symbol)==true
            val x=out.getOrPut(key){Scenario()}; x.n++; if(five&&top)x.dual++;if(five)x.five++;if(top)x.top20++;x.sumMax+=maxNet
        }
        return out
    }

    private fun finalizeProfile(input:K12MetaInput,g:Genome,globalDual:Double):Profile {
        val reg=input.features.marketRegime?:"NEUTRAL"
        val vr=input.features.volumeBreakout?.toDouble()?.let{if(it>=1.4)"HIGH" else if(it<=.75)"LOW" else "NORMAL"}?:"NORMAL"
        val key="$reg|$vr"; val scenario=g.scenarios[key]
        val scenarioDual=if((scenario?.n?:0)>=5)scenario?.dualRate?:globalDual else globalDual
        val dual=.68*(g.analog.dualRate?:globalDual)+.20*scenarioDual+.12*globalDual
        val lift=if(globalDual!=0.0)dual/globalDual else null
        val confidence=cap(
            100*(1-exp(-((g.analog.effectiveN)+(scenario?.n?:0)*.25)/18))*(g.featureCount.toDouble()/TOTAL_GENOME_TRAITS)
        )
        val score=100*(
            .42*cap01(((lift?:1.0)-.65)/2)+
            .25*cap01(dual/.25)+
            .13*cap01(((g.analog.expectedMax?:0.0)+2)/12)+
            .12*confidence/100+
            .08*cap01(g.featureCount.toDouble()/TOTAL_GENOME_TRAITS)
        )
        return Profile(
            score,dual,g.analog.fiveRate,g.analog.top20Rate,lift,confidence,g.featureCount,
            temperament(g.features,g.analog),g.features,g.analog,key,scenario,g.scenarios
        )
    }

    private fun marketCharacter(rows:List<Tmp>):Market {
        fun ratioRows(fn:(Tmp)->Boolean):Double=if(rows.isEmpty()).5 else rows.count(fn).toDouble()/rows.size
        val pos=ratioRows{retAt(it.series.close,it.series.close.lastIndex,1)?.let{x->x>0}==true}
        val above20=ratioRows{t->ema(t.series.close,20)?.let{t.series.close.last()>it}==true}
        val above50=ratioRows{t->ema(t.series.close,50)?.let{t.series.close.last()>it}==true}
        val macd=ratioRows{it.input.features.macdHistDelta?.let{x->x>BigDecimal.ZERO}==true}
        val breakout=ratioRows{it.input.features.volumeBreakout?.toDouble()?.let{x->x>=1.2}==true}
        val mDay=median(rows.mapNotNull{retAt(it.series.close,it.series.close.lastIndex,1)})
        val mRet5=median(rows.mapNotNull{retAt(it.series.close,it.series.close.lastIndex,5)})
        val mRel5=median(rows.mapNotNull{t->pair(retAt(t.series.close,t.series.close.lastIndex,5),retAtN(t.series.index,t.series.close.lastIndex,5)){a,b->a-b}})
        val mRoc5=mRet5
        val mAtr=median(rows.mapNotNull{it.input.features.atrPct?.toDouble()})
        val disp=stdevD(rows.mapNotNull{retAt(it.series.close,it.series.close.lastIndex,1)})
        val mVol=median(rows.mapNotNull{it.input.features.volumeBreakout?.toDouble()})
        val mTurn=median(rows.mapNotNull{it.input.features.turnoverRatio?.toDouble()})
        val counts=rows.groupingBy{it.input.features.marketRegime?:"NEUTRAL"}.eachCount()
        val dom=counts.maxWithOrNull(compareBy<Map.Entry<String,Int>>{it.value}.thenBy{it.key})
        val domReg=dom?.key?:"NEUTRAL"; val share=if(rows.isEmpty())0.0 else (dom?.value?:0).toDouble()/rows.size
        val breadth=capSigned(.42*(2*pos-1)+.33*(2*above20-1)+.25*(2*above50-1))
        val trend=capSigned(.30*squash(mRet5,6.0)+.20*squash(mRel5,5.0)+.28*(2*above20-1)+.12*(2*above50-1)+.10*(if(domReg=="BULL")share else if(domReg=="BEAR")-share else 0.0))
        val momentum=capSigned(.28*squash(mDay,2.2)+.27*squash(mRet5,6.0)+.15*squash(mRoc5,6.0)+.18*(2*macd-1)+.12*(2*breakout-1))
        val volatility=capSigned(.62*squash((mAtr?:3.5)-3.5,2.8)+.38*squash((disp?:1.8)-1.8,2.3))
        val volume=capSigned(.58*squash(if((mVol?:1.0)>0)ln(mVol?:1.0) else 0.0,.55)+.27*squash((mTurn?:1.0)-1,.75)+.15*(2*breakout-1))
        val risk=capSigned(.42*breadth+.28*momentum+.18*trend+.12*(volatility*sign(if(momentum!=0.0)momentum else if(trend!=0.0)trend else 1.0)))
        var regime=domReg
        if(share<.38) regime=if(volatility>.48)"VOLATILE" else if(trend>.24&&breadth>.08)"BULL" else if(trend<-.24&&breadth<-.08)"BEAR" else "NEUTRAL"
        val coverage=if(rows.isEmpty())0.0 else rows.count {
            listOfNotNull(
                retAt(it.series.close,it.series.close.lastIndex,1),
                ema(it.series.close,20),
                it.input.features.atrPct?.toDouble(),
                it.input.features.volumeBreakout?.toDouble()
            ).size>=3
        }.toDouble()/rows.size
        val magnitude=listOf(abs(trend),abs(momentum),abs(volatility),abs(volume),abs(risk),abs(breadth)).average()
        val agreement=1-cap01(abs(trend-breadth)/2)
        val confidence=cap01(.45*coverage+.30*magnitude+.25*agreement)
        return Market(regime,confidence,mapOf("trend" to trend,"momentum" to momentum,"volatility" to volatility,"volume" to volume,"risk" to risk))
    }

    private fun stockCharacter(t:Tmp):Character {
        val f=t.profile.features; val a=t.profile.analog
        val trend=capSigned(
            .30*n01(f["trendPersistence"])+.25*squash(f["alpha21"],8.0)+.20*squash(f["ret21d"],14.0)+
            .15*n01(f["breakout20Success"])+.10*n01(f["breakout63Success"])
        )
        val momentum=capSigned(
            .28*squash(f["alpha5"],6.0)+.20*squash(f["alpha10"],8.0)+.18*squash(f["returnAcceleration"],5.0)+
            .17*n01(f["positiveDayRate"])+.17*squash(a.expectedMax,8.0)
        )
        val volatility=capSigned(
            .48*squash((f["vol21"]?:t.input.features.atrPct?.toDouble()?:3.5)-3.5,2.8)+
            .27*squash((f["rangeExpansion"]?:1.0)-1,.7)+
            .25*squash((f["atrMean21"]?:3.5)-3.5,2.8)
        )
        val volume=capSigned(
            .35*squash((f["volumeRatio5_21"]?:1.0)-1,.65)+
            .25*squash((f["turnoverRatio5_21"]?:1.0)-1,.65)+
            .20*n01(f["accumulationRate"])+
            .20*capSigned((f["accumulationRate"]?:.5)-(f["distributionRate"]?:.5))
        )
        val risk=capSigned(
            .34*squash((f["beta63"]?:1.0)-1,.55)+
            .24*squash((f["upCapture"]?:1.0)-1,.55)+
            .18*squash((f["downCapture"]?:1.0)-1,.55)+
            .14*squash(f["alpha21"],8.0)+.10*squash(f["shockSensitivity"],5.0)
        )
        val gconf=cap01(t.profile.confidence/100)
        val bconf=cap01((t.input.behavior?.confidence?.toDouble()?:0.0)/100)
        val feature=cap01(t.profile.featureCount.toDouble()/TOTAL_GENOME_TRAITS)
        val confidence=cap01(.50*gconf+.30*bconf+.20*feature)
        return Character(
            mapOf("trend" to trend,"momentum" to momentum,"volatility" to volatility,"volume" to volume,"risk" to risk),
            confidence,t.profile.temperament
        )
    }

    private fun regimeRaw(p:Profile,regime:String):Double {
        val f=p.features
        val ar=when(regime){"BULL"->f["bullAvgReturn"];"BEAR"->f["bearAvgReturn"];"VOLATILE"->f["volatileAvgReturn"];else->f["neutralAvgReturn"]}
        val pr=when(regime){"BULL"->f["bullPositiveRate"];"BEAR"->f["bearPositiveRate"];"VOLATILE"->f["volatilePositiveRate"];else->f["positiveDayRate"]}
        val fr=when(regime){"BULL"->f["bullFiveRate"];"BEAR"->f["bearFiveRate"];"VOLATILE"->f["volatileFiveRate"];else->p.analog.fiveRate}
        val down=if(regime=="BEAR")squash(f["downsideResilience"],5.0) else 0.0
        val scenario=p.scenario?.dualRate?.let{2*it-1}?:0.0
        return .34*squash(ar,5.0)+.24*(pr?.let{2*it-1}?:0.0)+.20*(fr?.let{2*it-1}?:0.0)+.12*down+.10*scenario
    }

    private fun cosineFit(a:Map<String,Double>,b:Map<String,Double>):Double {
        val keys=listOf("trend","momentum","volatility","volume","risk")
        var dot=0.0;var na=0.0;var nb=0.0;var dist=0.0
        for(k in keys){val x=capSigned(a[k]?:0.0);val y=capSigned(b[k]?:0.0);dot+=x*y;na+=x*x;nb+=y*y;dist+=abs(x-y)}
        val cos=if(na>1e-8&&nb>1e-8)dot/sqrt(na*nb) else 0.0
        val cosScore=50+50*capSigned(cos); val distanceScore=100*(1-dist/(keys.size*2.0))
        return cap(.58*cosScore+.42*distanceScore)
    }

    private fun percentileMap(values:Map<String,Double>):Map<String,Double> {
        val sorted=values.entries.filter{it.value.isFinite()}.sortedWith(compareBy<Map.Entry<String,Double>>{it.value}.thenBy{it.key})
        if(sorted.isEmpty())return emptyMap()
        return sorted.mapIndexed{i,e->e.key to if(sorted.size==1)50.0 else 100.0*i/(sorted.size-1)}.toMap()
    }

    private fun contextAt(s:Series,i:Int):List<Double?>? {
        if(i<21||i>=s.close.size)return null
        val c=s.close; val o=s.open; val h=s.high; val l=s.low; val v=s.volume; val idx=s.index
        val avgV=meanD(v.subList(i-20,i)); val vol5=stdevN(changesD(c).subList(i-4,i+1)); val vol21=stdevN(changesD(c).subList(i-20,i+1))
        val priorHigh=h.subList(i-20,i).maxOrNull()
        val ranges=(i-20 until i).mapNotNull{j->if(j>0&&c[j-1]>0)100*(h[j]-l[j])/c[j-1] else null}
        val rangeMean=meanD(ranges); val range=if(c[i-1]>0)100*(h[i]-l[i])/c[i-1] else null
        val gap=if(o[i]!=null&&c[i-1]>0)100*(o[i]!!/c[i-1]-1) else null
        val intra=if(o[i]!=null&&o[i]!!>0)100*(c[i]/o[i]!!-1) else null
        val loc=if(h[i]!=l[i])(c[i]-l[i])/(h[i]-l[i]) else .5
        val rel5=pair(retAt(c,i,5),retAtN(idx,i,5)){a,b->a-b}
        val draw=priorHigh?.let{100*(c[i]/it-1)}
        val vr=safeRatio(v[i],avgV); val ir=changesN(idx); val idxVol=stdevN(ir.subList(i-20,i+1))
        val streak=longestSignedRun(changesD(c).subList(max(1,i-7),i+1))
        val raw=listOf(
            div(retAt(c,i,1),8.0),div(retAt(c,i,3),14.0),div(retAt(c,i,5),20.0),div(retAt(c,i,10),30.0),
            div(rel5,15.0), (vol5?:0.0)/6-1,(vol21?:0.0)/5-1,(vr?:1.0)-1,div(gap,6.0),div(intra,8.0),
            (loc-.5)*2,(safeRatio(range,rangeMean)?:1.0)-1,div(draw,10.0),div(ir.getOrNull(i),4.0),(idxVol?:0.0)/4-1,streak/6.0
        )
        return raw.map{it?.takeIf(Double::isFinite)?.let(::tanh)}
    }

    private fun distance(a:List<Double?>?,b:List<Double?>?):Double? {
        if(a==null||b==null)return null
        var sum=0.0;var n=0
        for(i in 0 until min(a.size,b.size)){val x=a[i];val y=b[i];if(x!=null&&y!=null){sum+=(x-y)*(x-y);n++}}
        return if(n>=8)sum/n else null
    }

    private fun historicalRegime(s:Series,i:Int):String {
        val current=s.index.getOrNull(i) ?: return "NEUTRAL"
        val m20=meanN(s.index.subList(max(0,i-19),i+1)); val m50=meanN(s.index.subList(max(0,i-49),i+1))
        val rr=changesN(s.index.subList(max(0,i-22),i+1)); val vol=stdevN(rr)
        if(abs(rr.lastOrNull()?:0.0)>=2||(vol?:0.0)>=2.5)return "VOLATILE"
        if(current>(m20?:current)&&current>(m50?:current))return "BULL"
        if(current<(m20?:current)&&current<(m50?:current))return "BEAR"
        return "NEUTRAL"
    }

    private fun temperament(f:Map<String,Double>,a:Analog):String = when {
        (f["beta63"]?:0.0)>1.35&&(f["vol21"]?:0.0)>3.5 -> "Yüksek Beta Hızlı"
        (f["downsideResilience"]?:0.0)>1&&(f["bearPositiveRate"]?:0.0)>.52 -> "Savunmacı Dayanıklı"
        (f["breakout20Success"]?:0.0)>.35&&(f["volumeRatio5_21"]?:0.0)>1.15 -> "Hacimle Kırılan"
        (f["negativeGapReversal"]?:0.0)>.58&&(f["supportBounceRate"]?:0.0)>.58 -> "Dipten Dönen"
        (f["trendPersistence"]?:0.0)>.56&&(f["regimeConsistency"]?:0.0)>.55 -> "İstikrarlı Trend"
        (f["reversalTendency"]?:0.0)>.58 -> "Ters Tepkili"
        (a.dualRate?:0.0)>.12 -> "Benzer Gün Avcısı"
        else -> "Dengeli Karma"
    }

    private fun ema(c:List<Double>,period:Int):Double? {
        if(c.size<period)return null
        val k=2.0/(period+1);var e=c.take(period).average()
        for(i in period until c.size)e=c[i]*k+e*(1-k)
        return e
    }
    private fun retAt(c:List<Double>,i:Int,g:Int):Double?=if(i<g||c[i-g]<=0||c[i]<=0)null else (100*(c[i]/c[i-g]-1)).takeIf{it.isFinite()&&it>-99.5}
    private fun retAtN(c:List<Double?>,i:Int,g:Int):Double? {
        if(i<g)return null;val a=c.getOrNull(i);val b=c.getOrNull(i-g)
        return if(a==null||b==null||a<=0||b<=0)null else (100*(a/b-1)).takeIf{it.isFinite()&&it>-99.5}
    }
    private fun changesD(c:List<Double>)=c.mapIndexed{i,x->if(i==0||c[i-1]<=0||x<=0)null else (100*(x/c[i-1]-1)).takeIf{it.isFinite()&&it>-99.5}}
    private fun changesN(c:List<Double?>)=c.mapIndexed{i,x->val p=if(i>0)c[i-1]else null;if(i==0||x==null||p==null||p<=0||x<=0)null else (100*(x/p-1)).takeIf{it.isFinite()&&it>-99.5}}
    private fun meanD(x:Collection<Double>):Double?=if(x.isEmpty())null else x.average()
    private fun meanN(x:Collection<Double?>):Double?=x.filterNotNull().filter{it.isFinite()}.let{if(it.isEmpty())null else it.average()}
    private fun median(x:List<Double>):Double? {if(x.isEmpty())return null;val s=x.sorted();val i=s.size/2;return if(s.size%2==1)s[i]else(s[i-1]+s[i])/2}
    private fun stdevD(x:Collection<Double>):Double? {if(x.size<2)return null;val m=x.average();return sqrt(x.sumOf{(it-m)*(it-m)}/(x.size-1))}
    private fun stdevN(x:Collection<Double?>):Double?=stdevD(x.filterNotNull().filter{it.isFinite()})
    private fun corr(a:List<Double?>,b:List<Double?>):Double? {
        val p=(0 until min(a.size,b.size)).mapNotNull{i->a[i]?.let{x->b[i]?.let{y->x to y}}};if(p.size<3)return null
        val ma=p.map{it.first}.average();val mb=p.map{it.second}.average();val cov=p.map{(x,y)->(x-ma)*(y-mb)}.average()
        val va=p.map{(x,_)->(x-ma)*(x-ma)}.average();val vb=p.map{(_,y)->(y-mb)*(y-mb)}.average()
        return if(va>0&&vb>0)cov/sqrt(va*vb) else null
    }
    private fun beta(a:List<Double?>,b:List<Double?>):Double? {
        val p=(0 until min(a.size,b.size)).mapNotNull{i->a[i]?.let{x->b[i]?.let{y->x to y}}};if(p.size<5)return null
        val ma=p.map{it.first}.average();val mb=p.map{it.second}.average();val cov=p.map{(x,y)->(x-ma)*(y-mb)}.average()
        val vb=p.map{(_,y)->(y-mb)*(y-mb)}.average();return if(vb>0)cov/vb else null
    }
    private fun quantile(a:List<Double?>,q:Double):Double? {
        val x=a.filterNotNull().filter{it.isFinite()}.sorted();if(x.isEmpty())return null
        val p=(x.size-1)*q;val i=p.toInt();val f=p-i;return if(i+1<x.size)x[i]+f*(x[i+1]-x[i])else x[i]
    }
    private fun skew(a:List<Double?>):Double? {val x=a.filterNotNull().filter{it.isFinite()};if(x.size<5)return null;val m=x.average();val sd=stdevD(x)?:return null;return if(sd==0.0)null else x.map{((it-m)/sd).pow(3)}.average()}
    private fun kurt(a:List<Double?>):Double? {val x=a.filterNotNull().filter{it.isFinite()};if(x.size<8)return null;val m=x.average();val sd=stdevD(x)?:return null;return if(sd==0.0)null else x.map{((it-m)/sd).pow(4)}.average()-3}
    private fun maxDrawdown(c:List<Double>):Double? {if(c.isEmpty())return null;var peak=c.first();var dd=0.0;for(x in c){if(x>peak)peak=x;if(peak>0)dd=min(dd,100*(x/peak-1))};return dd}
    private fun longestSignedRun(a:List<Double?>):Int {var best=0;var cur=0;var last=0.0;for(v in a){val s=sign(v?:0.0);if(s==0.0){cur=0;last=0.0}else{cur=if(s==last)cur+1 else 1;last=s;best=max(best,cur)}};return best}
    private fun ratioCount(a:List<Double?>,fn:(Double?)->Boolean):Double? {val n=a.count{it!=null};return if(n==0)null else a.count{it!=null&&fn(it)}.toDouble()/n}
    private fun positiveRate(a:List<Double>)=if(a.isEmpty())null else a.count{it>0}.toDouble()/a.size
    private fun ratePair(a:IntArray)=if(a[1]==0)null else a[0].toDouble()/a[1]
    private fun safeRatio(a:Double?,b:Double?)=if(a==null||b==null||b==0.0)null else a/b
    private fun pair(a:Double?,b:Double?,fn:(Double,Double)->Double)=if(a==null||b==null)null else fn(a,b)
    private fun div(a:Double?,b:Double)=a?.let{it/b}
    private fun cap(v:Double,a:Double=0.0,b:Double=100.0)=v.coerceIn(a,b)
    private fun cap01(v:Double)=v.coerceIn(0.0,1.0)
    private fun capSigned(v:Double)=v.coerceIn(-1.0,1.0)
    private fun squash(v:Double?,scale:Double)=if(v==null||!v.isFinite())0.0 else tanh(v/max(.0001,scale))
    private fun n01(v:Double?)=if(v==null||!v.isFinite())0.0 else capSigned(2*v-1)
    private fun bd(v:Double)=BigDecimal.valueOf(v)
}
