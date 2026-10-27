package io.aurum.aurumb.pipeline

import io.aurum.aurumb.criteria.CriterionResult
import io.aurum.aurumb.feature.FeatureBuilder
import io.aurum.aurumb.feature.FeatureSettings
import io.aurum.aurumb.feature.MarketBar
import io.aurum.aurumb.formula.AurumBFormulaEngine
import io.aurum.aurumb.formula.FormulaMath
import io.aurum.aurumb.formula.BehaviorMetaEngine
import io.aurum.aurumb.formula.BehaviorMetaInput
import io.aurum.aurumb.formula.BehaviorMetaPolicy
import io.aurum.aurumb.formula.BehaviorMetaScore
import io.aurum.aurumb.formula.BehaviorArchiveEvidence
import io.aurum.aurumb.formula.K12MetaEngine
import io.aurum.aurumb.formula.K12MetaInput
import io.aurum.aurumb.formula.K12MetaPolicy
import io.aurum.aurumb.formula.K12MetaScore
import io.aurum.aurumb.formula.K10RewardEvent
import io.aurum.aurumb.formula.K10RewardMemory
import io.aurum.aurumb.formula.K10RewardMemoryEngine
import io.aurum.aurumb.learning.EffectiveModelResolver
import io.aurum.aurumb.persistence.*
import io.aurum.aurumb.selection.*
import io.aurum.aurumb.universe.*
import io.aurum.common.calendar.MarketCalendar
import io.aurum.common.eligibility.ExtremeMoveEligibility
import io.aurum.common.quality.CellCompletenessGate
import io.aurum.common.model.AurumVersions
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

private val SC_MC=MathContext(18,RoundingMode.HALF_EVEN)

data class SelectionPublishResult(
    val runId:String,
    val eligible:Int,
    val selected:Int,
    val rejected:Int,
    val asOf:Instant
)

data class SelectionPreparation(
    val run:AnalysisRunEntity,
    val rows:List<SelectionResultEntity>,
    val eligible:Int,
    val selected:Int,
    val rejected:Int,
    val asOf:Instant
)

class SelectionComputationService(
    private val dao:AurumDao,
    private val calendar:MarketCalendar,
    private val clock:()->Instant={Instant.now()}
) {
    suspend fun prepare(settings:PipelineSettings):SelectionPreparation {
        val now=clock()
        val date=LocalDate.ofInstant(now,ZoneId.of("Europe/Istanbul"))
        val snapshot=dao.universeAtOrBefore(date.toString()) ?: throw IllegalStateException("UNIVERSE_UNAVAILABLE")
        val symbols=parseSymbols(snapshot.symbolsJson)
        val lifecycles=dao.instrumentLifecycles().groupBy{it.symbol}
        val indexBars=toFeatureBars(dao.marketBars("XU100",now.toString()))
        if(indexBars.size<60) throw IllegalStateException("INDEX_DATA_INSUFFICIENT")

        data class Prepared(
            val symbol:String,
            val feature:io.aurum.aurumb.formula.AurumBFeatures,
            val quality:Int,
            val lastPrice:BigDecimal,
            val medianVolume:BigDecimal,
            val latestDate:LocalDate,
            val bars:List<MarketBar>
        )
        val prepared=mutableListOf<Prepared>()
        val rejected=mutableMapOf<String,String>()
        val fingerprintParts=mutableListOf(snapshot.sourceFingerprint)

        for(symbol in symbols) {
            val entities=dao.marketBars(symbol,now.toString())
            if(entities.isEmpty()) { rejected[symbol]="NO_BARS"; continue }
            fingerprintParts += entities.takeLast(1).map{it.rawSourceFingerprint}
            val complete=entities.filter { e ->
                e.highDecimal?.toBigDecimalOrNull()?.let{it>BigDecimal.ZERO}==true &&
                e.lowDecimal?.toBigDecimalOrNull()?.let{it>BigDecimal.ZERO}==true &&
                e.closeDecimal.toBigDecimalOrNull()?.let{it>BigDecimal.ZERO}==true &&
                e.volumeDecimal?.toBigDecimalOrNull()?.let{it>=BigDecimal.ZERO}==true
            }
            val bars=toFeatureBars(complete)
            if(bars.size<60) { rejected[symbol]="INSUFFICIENT_VALID_BARS"; continue }
            val latest=bars.last()
            val previous=bars[bars.lastIndex-1]
            val latestDate=LocalDate.ofInstant(latest.at,ZoneId.of("Europe/Istanbul"))
            val dailyChange=ExtremeMoveEligibility.percentChange(latest.close,previous.close)
            val latestObservation=dao.latestObservation(symbol,now.toString())
            val instantChange=latestObservation?.let { observation ->
                val marketAt=observation.marketTimestampUtc?.let { raw ->
                    runCatching{Instant.parse(raw)}.getOrNull()
                }
                val sameTradingDate=marketAt?.let {
                    LocalDate.ofInstant(it,ZoneId.of("Europe/Istanbul"))==date
                }==true
                if(!sameTradingDate) null
                else ExtremeMoveEligibility.percentChange(
                    observation.valueDecimal?.toBigDecimalOrNull(),
                    previous.close
                )
            }
            val moveGate=ExtremeMoveEligibility.assess(currentMovePct=instantChange,dailyMovePct=dailyChange,maxAbsMovePct=settings.maxDailyMovePct)
            if(!moveGate.eligible) {
                rejected[symbol]=moveGate.reasons.joinToString(",")
                continue
            }
            val age=calendar.tradingDaysBetween(latestDate,date)
            val completeness=(100.0*complete.size/entities.size).toInt().coerceIn(0,100)
            val quality=(completeness-(if(age>4)30 else if(age>2)15 else 0)).coerceIn(0,100)
            val featureResult=runCatching{
                FeatureBuilder.build(
                    symbol,bars,indexBars,
                    FeatureSettings(
                        assumedPositionTry=settings.assumedPositionTRY,
                        maxParticipationPct=settings.maxParticipationPct,
                        commissionBps=settings.commissionBps,
                        slippageBps=settings.slippageBps
                    )
                )
            }
            if(featureResult.isFailure) {
                rejected[symbol]="FEATURE_ERROR"
                continue
            }
            val feature=featureResult.getOrThrow()
            val medianVolume=median(bars.takeLast(21).map{it.volume.toDouble()})
            val lifecycle=lifecycles[symbol]
                ?.mapNotNull { row ->
                    val listed=runCatching{Instant.parse(row.listedAtUtc)}.getOrNull() ?: return@mapNotNull null
                    val delisted=row.delistedAtUtc?.let{runCatching{Instant.parse(it)}.getOrNull()}
                    ListingInterval(listed,delisted)
                }
                ?.filter { interval ->
                    !interval.listedAt.isAfter(now) &&
                        (interval.delistedAt==null || now.isBefore(interval.delistedAt))
                }
                ?.maxByOrNull { it.listedAt }
            if(lifecycle==null) {
                rejected[symbol]="NO_ACTIVE_LIFECYCLE"
                continue
            }
            val universeDecision=UniverseBuilder.build(
                now,
                listOf(UniverseInstrument(
                    symbol,
                    lifecycle,
                    latest.close,
                    feature.medianTurnover21,
                    BigDecimal.valueOf(medianVolume),
                    quality,
                    false
                )),
                UniversePolicy(settings.minPrice,settings.minMedianTurnover21,settings.minMedianVolume21,settings.qualityMin)
            ).single()
            val reasons=universeDecision.reasons.toMutableList()
            if(feature.participationPct?.let{it>settings.maxParticipationPct}==true) reasons += "PARTICIPATION"
            if(feature.estimatedCostPct?.let{it>BigDecimal("2")}==true) reasons += "ESTIMATED_COST"
            if(reasons.isNotEmpty()) { rejected[symbol]=reasons.joinToString(","); continue }
            prepared += Prepared(symbol,feature,quality,latest.close,BigDecimal.valueOf(medianVolume),latestDate,bars)
        }

        if(prepared.isEmpty()) throw IllegalStateException("NO_ELIGIBLE_INSTRUMENTS")

        val dataColumns=featureColumns()
        val featureBySymbol=prepared.associate{it.symbol to it.feature}
        val dataMatrix=CellCompletenessGate.assess(
            rowIds=prepared.map{it.symbol},
            columnIds=dataColumns,
            minRatio=settings.dataCellCompletenessPct.divide(BigDecimal("100"),SC_MC)
        ) { symbol,column -> featureCellPresent(featureBySymbol.getValue(symbol),column) }
        if(!dataMatrix.tableEligible) {
            throw IllegalStateException("DATA_TABLE_COMPLETENESS_BELOW_GATE")
        }
        val disabledColumns=dataMatrix.columnEligibility.filterValues{!it}.keys.toSet()
        val matrixEligiblePrepared=prepared.filter { p ->
            if(dataMatrix.rowEligibility[p.symbol]==true) true
            else {
                rejected[p.symbol]="DATA_ROW_COMPLETENESS_BELOW_GATE"
                false
            }
        }
        if(matrixEligiblePrepared.isEmpty()) throw IllegalStateException("NO_DATA_MATRIX_ELIGIBLE_INSTRUMENTS")
        val preparedForScoring=matrixEligiblePrepared.map { p ->
            p.copy(feature=maskFeatureColumns(p.feature,disabledColumns))
        }

        val formula=AurumBFormulaEngine.score(preparedForScoring.map{it.feature})
        val formulaBySymbol=formula.associateBy{it.symbol}
        val metaScoresBySymbol=buildReferenceMetaScores(
            preparedForScoring.map { it.symbol to (it.feature to it.quality) },
            formulaBySymbol,
            settings.topN
        ).mapValues { it.value.toMutableMap() }.toMutableMap()
        val behaviorArchive=dao.eligibleSelectionOutcomesAsOf(now.toString()).mapNotNull { outcome ->
            val evaluated=runCatching{Instant.parse(outcome.evaluatedAtUtc)}.getOrNull()
                ?: return@mapNotNull null
            if(evaluated.isAfter(now)) null
            else BehaviorArchiveEvidence(outcome.symbol,evaluated,outcome.targetHit)
        }
        val behaviorMeta=BehaviorMetaEngine.score(
            inputs=preparedForScoring.map { p ->
                BehaviorMetaInput(
                    symbol=p.symbol,
                    bars=p.bars,
                    indexBars=indexBars,
                    estimatedCostPct=p.feature.estimatedCostPct,
                    currentRegime=p.feature.marketRegime
                )
            },
            archive=behaviorArchive,
            policy=BehaviorMetaPolicy(
                targetReturnPct=settings.targetReturnPct.toDouble(),
                crossSectionalTargetPct=settings.crossSectionalTargetPct.toDouble(),
                lookbackSessions=settings.behaviorLookbackDays,
                lifetimeWeight=settings.behaviorLifetimeWeight.toDouble(),
                learningHalfLifeDays=settings.learningHalfLifeDays
            ),
            now=now
        )
        behaviorMeta.forEach { (symbol,meta) ->
            metaScoresBySymbol.getOrPut(symbol){mutableMapOf()}["K11"]=meta.score
        }
        val dayRanks=preparedForScoring.sortedWith(compareByDescending<Prepared>{it.feature.dayChange}.thenBy{it.symbol})
            .mapIndexed{i,p->p.symbol to (i+1)}.toMap()
        val candidates=preparedForScoring.map { p ->
            val row=requireNotNull(formulaBySymbol[p.symbol])
            val risk=ExecutionRisk.calculate(ExecutionRiskInput(
                p.feature.estimatedCostPct,p.feature.participationPct,settings.maxParticipationPct,
                p.feature.limitUpRisk,p.feature.upperWickPct,BigDecimal(p.quality),dayRanks[p.symbol]
            ))
            CandidateEvidence(
                p.symbol,
                row.scores.mapValues{(k,v)->CriterionResult(k,v,v!=null,if(v==null)"MISSING_FORMULA" else null)},
                risk
            )
        }
        val champion=dao.champion()
        val championWeights=champion?.let { model ->
            runCatching {
                val json=JSONObject(model.weightsJson)
                (1..7).associate { index ->
                    val id="K"+index
                    id to json.getString(id).toBigDecimal()
                }
            }.getOrNull()
        }
        val effectiveModel=EffectiveModelResolver.resolve(
            baseVersion=AurumVersions.MODEL,
            championVersion=champion?.version,
            championWeights=championWeights
        )
        val ranked=SelectionEngine(effectiveModel.criterionSpecs()).rank(candidates)
        IntegrityValidator.validate(ranked)
        val k10Memory=K10RewardMemoryEngine.memory(
            ranked.map{it.symbol}.toSet(),
            buildK10RewardEvents(now)
        )
        // Effective R29 override: visible K10 is the decayed reward/penalty
        // memory from locked next-session Reel rankings of pure K1-K7.
        k10Memory.forEach { (symbol,memory) ->
            metaScoresBySymbol.getOrPut(symbol){mutableMapOf()}["K10"]=memory.score
        }
        val k12Meta=K12MetaEngine.score(
            inputs=preparedForScoring.map { p ->
                K12MetaInput(
                    symbol=p.symbol,
                    bars=p.bars,
                    indexBars=indexBars,
                    features=p.feature,
                    behavior=behaviorMeta[p.symbol]
                )
            },
            k10=k10Memory,
            policy=K12MetaPolicy(
                targetReturnPct=settings.targetReturnPct.toDouble(),
                crossSectionalTargetPct=settings.crossSectionalTargetPct.toDouble(),
                genomeLookbackDays=settings.genomeLookbackDays,
                nearestNeighbors=settings.genomeNearestNeighbors,
                minAnalogs=settings.genomeMinAnalogs,
                priorStrength=settings.genomePriorStrength.toDouble()
            )
        )
        k12Meta.forEach { (symbol,meta) ->
            metaScoresBySymbol.getOrPut(symbol){mutableMapOf()}["K12"]=meta.score
        }
        val metaRanks=metaCriterionRanks(metaScoresBySymbol)
        val prepBySymbol=preparedForScoring.associateBy{it.symbol}
        val currentRegime=preparedForScoring.groupingBy{it.feature.marketRegime?:"NEUTRAL"}
            .eachCount().maxByOrNull{it.value}?.key?:"NEUTRAL"
        val calibrationEvidence=SelectionOutcomeService(dao).calibrationEvidence(now)
        val probabilityBySymbol=ranked.associate { row ->
            row.symbol to ProbabilityCalibrator.calibrate(
                score=row.score,
                regime=currentRegime,
                decisionWindow="NEXT_OPEN_2S",
                asOf=now,
                evidence=calibrationEvidence
            ).probability
        }
        val adaptive=AdaptiveSelector.select(
            ranked.map { row ->
                AdaptiveCandidate(
                    row=row,
                    targetProbability=requireNotNull(probabilityBySymbol[row.symbol]),
                    sector=null
                )
            },
            AdaptiveSelectionPolicy(
                enabled=settings.adaptiveSelection,
                maxN=settings.topN,
                minScore=settings.minSelectionScore,
                minTargetProbability=settings.minTargetProbability,
                maxExecutionRisk=settings.maxExecutionRisk,
                sectorMaxPct=settings.sectorMaxPct,
                pairwiseMaxCorr=settings.pairwiseMaxCorr
            )
        ) { a,b ->
            pairCorrelation(
                prepBySymbol.getValue(a).bars,
                prepBySymbol.getValue(b).bars
            )
        }
        val selectionRank=adaptive.selected.mapIndexed { index,candidate ->
            candidate.row.symbol to (index+1)
        }.toMap()

        val runId=UUID.randomUUID().toString()
        val dataFingerprint=sha256(
            (fingerprintParts.sorted()+listOf(
                effectiveModel.version,
                effectiveModel.weights.toSortedMap().entries.joinToString(","){it.key+"="+it.value.toPlainString()},
                calibrationEvidence.joinToString(","){it.id+":"+it.evaluatedAt+":"+it.hit+":"+it.score.toPlainString()},
                settings.minSelectionScore.toPlainString(),
                settings.minTargetProbability.toPlainString(),
                settings.maxExecutionRisk.toPlainString(),
                settings.sectorMaxPct.toPlainString(),
                settings.pairwiseMaxCorr.toPlainString(),
                settings.topN.toString(),
                "EXTREME_MOVE="+settings.maxDailyMovePct.toPlainString(),
                "DATA_TABLE_RATIO="+dataMatrix.tableRatio.toPlainString(),
                "DATA_MIN_RATIO="+settings.dataCellCompletenessPct.toPlainString(),
                "DATA_DISABLED_COLUMNS="+disabledColumns.sorted().joinToString(",")
            )).joinToString("|")
        )
        val run=AnalysisRunEntity(
            id=runId,
            asOfUtc=now.toString(),
            appVersion=AurumVersions.APP,
            modelVersion=effectiveModel.version,
            formulaVersion=AurumVersions.FORMULA,
            dataSchemaVersion=AurumVersions.DATA_SCHEMA,
            marketRegime=currentRegime,
            dataFingerprint=dataFingerprint,
            status="SUCCESS",
            integrityPassed=true
        )
        val rows=ranked.map { row ->
            val p=prepBySymbol.getValue(row.symbol)
            val confidence=(
                BigDecimal(".35")+
                BigDecimal(".35")*BigDecimal(p.quality).divide(BigDecimal("100"))+
                BigDecimal(".15")*(BigDecimal.ONE-row.executionRisk)
            ).coerceIn(BigDecimal.ZERO,BigDecimal.ONE)
            SelectionResultEntity(
                runId,
                row.symbol,
                selectionRank[row.symbol]?:0,
                row.score.toPlainString(),
                row.consensusScore.toPlainString(),
                BigDecimal(p.quality).divide(BigDecimal("100")).toPlainString(),
                confidence.toPlainString(),
                (BigDecimal.ONE-row.executionRisk).coerceIn(BigDecimal.ZERO,BigDecimal.ONE).toPlainString(),
                requireNotNull(probabilityBySymbol[row.symbol]).toPlainString(),
                contributionsJson(
                    row,p.feature,metaScoresBySymbol[row.symbol].orEmpty(),metaRanks,
                    k10Memory[row.symbol],behaviorMeta[row.symbol],k12Meta[row.symbol]
                ),
                adaptive.rejected[row.symbol]
            )
        } + rejected.toSortedMap().map { (symbol,reason) ->
            SelectionResultEntity(
                runId,symbol,0,"0","0","0","0","0","0","[]",reason
            )
        }
        return SelectionPreparation(
            run=run,
            rows=rows,
            eligible=preparedForScoring.size,
            selected=adaptive.selected.size,
            rejected=rejected.size+adaptive.rejected.size,
            asOf=now
        )
    }

    suspend fun publish(prepared:SelectionPreparation):SelectionPublishResult {
        dao.publishRun(prepared.run,prepared.rows)
        return SelectionPublishResult(
            prepared.run.id,prepared.eligible,prepared.selected,prepared.rejected,prepared.asOf
        )
    }

    suspend fun compute(settings:PipelineSettings):SelectionPublishResult =
        publish(prepare(settings))

    private fun featureColumns():List<String> = listOf(
        "distanceHigh20Pct","closeLocation","volumeBreakout","turnoverRatio","obvSlope","volume",
        "adx14","upperWickPct","limitUpRisk","dayChange","deg3","rsi14","mfi14","emaTrendState",
        "macdHistDelta","atrPct","volRatio5_21","bbCompression","rangeExpansion","relative5",
        "relative10","relative21","shortTrendPct","beta","marketRegime","medianTurnover21",
        "estimatedCostPct","participationPct","amihud","tickImpactPct","gapPct",
        "intradayContinuation","lowerWickPct","rsiDelta","distanceBollLowPct","prevDayChange"
    )

    private fun featureCellPresent(f:io.aurum.aurumb.formula.AurumBFeatures,column:String):Boolean = when(column) {
        "distanceHigh20Pct" -> f.distanceHigh20Pct!=null
        "closeLocation" -> f.closeLocation!=null
        "volumeBreakout" -> f.volumeBreakout!=null
        "turnoverRatio" -> f.turnoverRatio!=null
        "obvSlope" -> f.obvSlope!=null
        "volume" -> f.volume!=null
        "adx14" -> f.adx14!=null
        "upperWickPct" -> f.upperWickPct!=null
        "limitUpRisk" -> true
        "dayChange" -> f.dayChange!=null
        "deg3" -> f.deg3!=null
        "rsi14" -> f.rsi14!=null
        "mfi14" -> f.mfi14!=null
        "emaTrendState" -> f.emaTrendState!=null
        "macdHistDelta" -> f.macdHistDelta!=null
        "atrPct" -> f.atrPct!=null
        "volRatio5_21" -> f.volRatio5_21!=null
        "bbCompression" -> f.bbCompression!=null
        "rangeExpansion" -> f.rangeExpansion!=null
        "relative5" -> f.relative5!=null
        "relative10" -> f.relative10!=null
        "relative21" -> f.relative21!=null
        "shortTrendPct" -> f.shortTrendPct!=null
        "beta" -> f.beta!=null
        "marketRegime" -> f.marketRegime!=null
        "medianTurnover21" -> f.medianTurnover21!=null
        "estimatedCostPct" -> f.estimatedCostPct!=null
        "participationPct" -> f.participationPct!=null
        "amihud" -> f.amihud!=null
        "tickImpactPct" -> f.tickImpactPct!=null
        "gapPct" -> f.gapPct!=null
        "intradayContinuation" -> f.intradayContinuation!=null
        "lowerWickPct" -> f.lowerWickPct!=null
        "rsiDelta" -> f.rsiDelta!=null
        "distanceBollLowPct" -> f.distanceBollLowPct!=null
        "prevDayChange" -> f.prevDayChange!=null
        else -> false
    }

    private fun maskFeatureColumns(
        f:io.aurum.aurumb.formula.AurumBFeatures,
        disabled:Set<String>
    ):io.aurum.aurumb.formula.AurumBFeatures = f.copy(
        distanceHigh20Pct=f.distanceHigh20Pct.takeUnless{"distanceHigh20Pct" in disabled},
        closeLocation=f.closeLocation.takeUnless{"closeLocation" in disabled},
        volumeBreakout=f.volumeBreakout.takeUnless{"volumeBreakout" in disabled},
        turnoverRatio=f.turnoverRatio.takeUnless{"turnoverRatio" in disabled},
        obvSlope=f.obvSlope.takeUnless{"obvSlope" in disabled},
        volume=f.volume.takeUnless{"volume" in disabled},
        adx14=f.adx14.takeUnless{"adx14" in disabled},
        upperWickPct=f.upperWickPct.takeUnless{"upperWickPct" in disabled},
        dayChange=f.dayChange.takeUnless{"dayChange" in disabled},
        deg3=f.deg3.takeUnless{"deg3" in disabled},
        rsi14=f.rsi14.takeUnless{"rsi14" in disabled},
        mfi14=f.mfi14.takeUnless{"mfi14" in disabled},
        emaTrendState=f.emaTrendState.takeUnless{"emaTrendState" in disabled},
        macdHistDelta=f.macdHistDelta.takeUnless{"macdHistDelta" in disabled},
        atrPct=f.atrPct.takeUnless{"atrPct" in disabled},
        volRatio5_21=f.volRatio5_21.takeUnless{"volRatio5_21" in disabled},
        bbCompression=f.bbCompression.takeUnless{"bbCompression" in disabled},
        rangeExpansion=f.rangeExpansion.takeUnless{"rangeExpansion" in disabled},
        relative5=f.relative5.takeUnless{"relative5" in disabled},
        relative10=f.relative10.takeUnless{"relative10" in disabled},
        relative21=f.relative21.takeUnless{"relative21" in disabled},
        shortTrendPct=f.shortTrendPct.takeUnless{"shortTrendPct" in disabled},
        beta=f.beta.takeUnless{"beta" in disabled},
        marketRegime=f.marketRegime.takeUnless{"marketRegime" in disabled},
        medianTurnover21=f.medianTurnover21.takeUnless{"medianTurnover21" in disabled},
        estimatedCostPct=f.estimatedCostPct.takeUnless{"estimatedCostPct" in disabled},
        participationPct=f.participationPct.takeUnless{"participationPct" in disabled},
        amihud=f.amihud.takeUnless{"amihud" in disabled},
        tickImpactPct=f.tickImpactPct.takeUnless{"tickImpactPct" in disabled},
        gapPct=f.gapPct.takeUnless{"gapPct" in disabled},
        intradayContinuation=f.intradayContinuation.takeUnless{"intradayContinuation" in disabled},
        lowerWickPct=f.lowerWickPct.takeUnless{"lowerWickPct" in disabled},
        rsiDelta=f.rsiDelta.takeUnless{"rsiDelta" in disabled},
        distanceBollLowPct=f.distanceBollLowPct.takeUnless{"distanceBollLowPct" in disabled},
        prevDayChange=f.prevDayChange.takeUnless{"prevDayChange" in disabled}
    )

    private fun parseSymbols(json:String):List<String> {
        val a=JSONArray(json)
        return (0 until a.length()).map{a.optString(it)}.filter{it.isNotBlank()}.distinct().sorted()
    }

    private fun toFeatureBars(rows:List<MarketBarEntity>,includeOpen:Boolean=true):List<MarketBar> =
        rows.sortedBy{it.atUtc}.mapNotNull { e ->
            val high=e.highDecimal?.toBigDecimalOrNull() ?: return@mapNotNull null
            val low=e.lowDecimal?.toBigDecimalOrNull() ?: return@mapNotNull null
            val volume=e.volumeDecimal?.toBigDecimalOrNull() ?: return@mapNotNull null
            val close=e.closeDecimal.toBigDecimalOrNull() ?: return@mapNotNull null
            MarketBar(
                Instant.parse(e.atUtc),
                if(includeOpen)e.openDecimal?.toBigDecimalOrNull() else null,
                high,low,close,e.adjustedCloseDecimal?.toBigDecimalOrNull(),volume
            )
        }

    private fun pairCorrelation(a:List<MarketBar>,b:List<MarketBar>,lookback:Int=63):BigDecimal? {
        val am=a.associateBy{it.at}
        val bm=b.associateBy{it.at}
        val dates=am.keys.intersect(bm.keys).sorted().takeLast(lookback+1)
        if(dates.size<16) return null
        val pairs=mutableListOf<Pair<Double,Double>>()
        for(i in 1 until dates.size) {
            val pa=am[dates[i-1]]?.close?.toDouble()
            val ca=am[dates[i]]?.close?.toDouble()
            val pb=bm[dates[i-1]]?.close?.toDouble()
            val cb=bm[dates[i]]?.close?.toDouble()
            if(listOf(pa,ca,pb,cb).all{it!=null && it.isFinite() && it>0.0}) {
                pairs += ((ca!!/pa!!)-1.0) to ((cb!!/pb!!)-1.0)
            }
        }
        if(pairs.size<15) return null
        val ma=pairs.map{it.first}.average()
        val mb=pairs.map{it.second}.average()
        val cov=pairs.map{(x,y)->(x-ma)*(y-mb)}.average()
        val sa=kotlin.math.sqrt(pairs.map{(x,_)->(x-ma)*(x-ma)}.average())
        val sb=kotlin.math.sqrt(pairs.map{(_,y)->(y-mb)*(y-mb)}.average())
        if(sa==0.0 || sb==0.0) return null
        return BigDecimal.valueOf((cov/(sa*sb)).coerceIn(-1.0,1.0))
    }

    private fun median(xs:List<Double>):Double {
        require(xs.isNotEmpty())
        val s=xs.sorted()
        return if(s.size%2==1)s[s.size/2] else (s[s.size/2-1]+s[s.size/2])/2.0
    }

    private fun contributionsJson(
        row:SelectionRow,
        f:io.aurum.aurumb.formula.AurumBFeatures,
        metaScores:Map<String,BigDecimal>,
        metaRanks:Map<String,Map<String,Int>>,
        k10Memory:K10RewardMemory?,
        behaviorMeta:BehaviorMetaScore?,
        k12Meta:K12MetaScore?
    ):String {
        val a=JSONArray()
        row.contributions.forEach { c ->
            a.put(JSONObject().apply {
                put("criterion",c.criterionId)
                put("score",c.score.toPlainString())
                put("weight",c.weight.toPlainString())
                put("criterionRank",c.criterionRank)
                put("rankScore",c.rankScore.toPlainString())
                put("rawContribution",c.rawContribution.toPlainString())
                put("rankContribution",c.rankContribution.toPlainString())
                put("contribution",c.contribution.toPlainString())
                put("inputs",criterionInputs(c.criterionId,f))
            })
        }
        listOf("K8","K9","K10","K11","K12").forEach { id ->
            metaScores[id]?.let { score ->
                a.put(JSONObject().apply {
                    put("criterion",id)
                    put("score",score.toPlainString())
                    put("weight","0")
                    put("criterionRank",metaRanks[id]?.get(row.symbol)?:JSONObject.NULL)
                    put("rankScore",JSONObject.NULL)
                    put("rawContribution","0")
                    put("rankContribution","0")
                    put("contribution","0")
                    put("inputs",JSONObject().apply {
                        put("role","ANALYSIS_META")
                        put("decisionWeight","0")
                        if(id=="K10" && k10Memory!=null) {
                            put("memoryEvents",k10Memory.evidenceCount)
                            put("memoryConfidence",k10Memory.memoryConfidence.toPlainString())
                            put("memoryDecay",K10RewardMemoryEngine.MEMORY_DECAY.toPlainString())
                            put("memoryPriorWeight",K10RewardMemoryEngine.MEMORY_PRIOR_WEIGHT.toPlainString())
                            put("memoryPriorScore",K10RewardMemoryEngine.PRIOR_SCORE.toPlainString())
                        }
                        if(id=="K11" && behaviorMeta!=null) {
                            put("dualRate",behaviorMeta.dualRate.toPlainString())
                            put("fiveRate",behaviorMeta.fiveRate.toPlainString())
                            put("top20Rate",behaviorMeta.top20Rate.toPlainString())
                            put("lift",behaviorMeta.lift?.toPlainString()?:JSONObject.NULL)
                            put("confidence",behaviorMeta.confidence.toPlainString())
                            put("recentObservations",behaviorMeta.recentObservations)
                            put("lifetimeSessions",behaviorMeta.lifetimeSessions)
                            put("character",behaviorMeta.character)
                            put("activePatterns",JSONArray(behaviorMeta.activePatterns))
                        }
                        if(id=="K12" && k12Meta!=null) {
                            put("formula","0.70*MARKET_CHARACTER+0.30*K10_MEMORY")
                            put("marketCharacterScore",k12Meta.marketCharacterScore.toPlainString())
                            put("k10RewardScore",k12Meta.k10RewardScore.toPlainString())
                            put("marketCompatibility",k12Meta.marketCompatibility.toPlainString())
                            put("regimeFit",k12Meta.regimeFit.toPlainString())
                            put("characterConfidence",k12Meta.characterConfidence.toPlainString())
                            put("marketRegime",k12Meta.marketRegime)
                            put("genomeScore",k12Meta.genomeScore.toPlainString())
                            put("genomeConfidence",k12Meta.genomeConfidence.toPlainString())
                            put("genomeFeatureCount",k12Meta.genomeFeatureCount)
                            put("genomeTotalFeatures",k12Meta.genomeTotalFeatures)
                            put("temperament",k12Meta.temperament)
                            put("genomeDualRate",k12Meta.genomeDualRate?.toPlainString()?:JSONObject.NULL)
                            put("genomeLift",k12Meta.genomeLift?.toPlainString()?:JSONObject.NULL)
                            put("analogNeighbors",k12Meta.analogNeighbors)
                            put("analogEffectiveN",k12Meta.analogEffectiveN.toPlainString())
                            put("currentScenario",k12Meta.currentScenario)
                            put("scenarioDualRate",k12Meta.scenarioDualRate?.toPlainString()?:JSONObject.NULL)
                            put("topTraits",JSONArray(k12Meta.topTraits))
                            put("scenarios",JSONObject().apply {
                                k12Meta.scenarios.toSortedMap().forEach { (key,s) ->
                                    put(key,JSONObject()
                                        .put("n",s.n)
                                        .put("dualRate",s.dualRate?.toPlainString()?:JSONObject.NULL)
                                        .put("fiveRate",s.fiveRate?.toPlainString()?:JSONObject.NULL)
                                        .put("top20Rate",s.top20Rate?.toPlainString()?:JSONObject.NULL)
                                        .put("avgMax",s.avgMax?.toPlainString()?:JSONObject.NULL))
                                }
                            })
                            put("sDecisionShare","0")
                        }
                    })
                })
            }
        }
        return a.toString()
    }

    private fun criterionInputs(
        id:String,
        f:io.aurum.aurumb.formula.AurumBFeatures
    ):JSONObject {
        val o=JSONObject()
        fun putDecimal(key:String,value:BigDecimal?) {
            if(value==null) o.put(key,JSONObject.NULL) else o.put(key,value.toPlainString())
        }
        when(id) {
            "K1" -> {
                putDecimal("distanceHigh20Pct",f.distanceHigh20Pct)
                putDecimal("closeLocation",f.closeLocation)
                putDecimal("volumeBreakout",f.volumeBreakout)
                putDecimal("turnoverRatio",f.turnoverRatio)
                putDecimal("obvSlope",f.obvSlope)
                putDecimal("volume",f.volume)
                putDecimal("adx14",f.adx14)
                putDecimal("upperWickPct",f.upperWickPct)
                o.put("limitUpRisk",f.limitUpRisk)
            }
            "K2" -> {
                putDecimal("dayChange",f.dayChange)
                putDecimal("deg3",f.deg3)
                putDecimal("rsi14",f.rsi14)
                putDecimal("mfi14",f.mfi14)
                putDecimal("emaTrendState",f.emaTrendState)
                putDecimal("macdHistDelta",f.macdHistDelta)
            }
            "K3" -> {
                putDecimal("atrPct",f.atrPct)
                putDecimal("volRatio5_21",f.volRatio5_21)
                putDecimal("bbCompression",f.bbCompression)
                putDecimal("rangeExpansion",f.rangeExpansion)
                putDecimal("volumeBreakout",f.volumeBreakout)
                putDecimal("closeLocation",f.closeLocation)
            }
            "K4" -> {
                putDecimal("relative5",f.relative5)
                putDecimal("relative10",f.relative10)
                putDecimal("relative21",f.relative21)
                putDecimal("shortTrendPct",f.shortTrendPct)
                putDecimal("beta",f.beta)
                o.put("marketRegime",f.marketRegime?:JSONObject.NULL)
            }
            "K5" -> {
                putDecimal("medianTurnover21",f.medianTurnover21)
                putDecimal("turnoverRatio",f.turnoverRatio)
                putDecimal("estimatedCostPct",f.estimatedCostPct)
                putDecimal("participationPct",f.participationPct)
                putDecimal("amihud",f.amihud)
                putDecimal("tickImpactPct",f.tickImpactPct)
            }
            "K6" -> {
                putDecimal("gapPct",f.gapPct)
                putDecimal("intradayContinuation",f.intradayContinuation)
                putDecimal("dayChange",f.dayChange)
                putDecimal("closeLocation",f.closeLocation)
                putDecimal("volumeBreakout",f.volumeBreakout)
                putDecimal("upperWickPct",f.upperWickPct)
                o.put("limitUpRisk",f.limitUpRisk)
            }
            "K7" -> {
                putDecimal("lowerWickPct",f.lowerWickPct)
                putDecimal("rsi14",f.rsi14)
                putDecimal("rsiDelta",f.rsiDelta)
                putDecimal("macdHistDelta",f.macdHistDelta)
                putDecimal("distanceBollLowPct",f.distanceBollLowPct)
                putDecimal("prevDayChange",f.prevDayChange)
                putDecimal("volumeBreakout",f.volumeBreakout)
            }
        }
        return o
    }

    /**
     * APK parity for the visible, zero-decision-weight meta criteria:
     * K8 = K1-K7 top-cut agreement + eight technical rule votes.
     * K9 = failure-risk/data-quality view. Source-conflict evidence is not
     * persisted in the clean-room schema, so that component is omitted rather
     * than fabricated; remaining reference components are weight-renormalized.
     * K10 is supplied by the effective R29 next-session reward/penalty memory.
     */
    private fun buildReferenceMetaScores(
        prepared:List<Pair<String,Pair<io.aurum.aurumb.formula.AurumBFeatures,Int>>>,
        formulaBySymbol:Map<String,io.aurum.aurumb.formula.FormulaScore>,
        topN:Int
    ):Map<String,Map<String,BigDecimal>> {
        val symbols=prepared.map{it.first}
        val n=symbols.size
        val topCut=maxOf(topN,kotlin.math.ceil(n*.10).toInt())
        val decisionRanks=(1..7).associate { index ->
            val id="K"+index
            val ordered=symbols.mapNotNull { symbol ->
                formulaBySymbol[symbol]?.scores?.get(id)?.let{symbol to it}
            }.sortedWith(compareByDescending<Pair<String,BigDecimal>>{it.second}.thenBy{it.first})
            id to ordered.mapIndexed{i,p->p.first to (i+1)}.toMap()
        }
        fun b(v:Boolean)=if(v)BigDecimal.ONE else BigDecimal.ZERO
        fun clamp01(v:BigDecimal)=v.coerceIn(BigDecimal.ZERO,BigDecimal.ONE)
        return prepared.associate { (symbol,pair) ->
            val (f,quality)=pair
            val agreement=(1..7).map { decisionRanks["K"+it]?.get(symbol)?.let{r->r<=topCut}==true }
                .count{it}.let{BigDecimal(it).divide(BigDecimal("7"),SC_MC)}
            val votes=listOf(
                f.emaTrendState?.let{it>=BigDecimal(".6")}==true,
                f.macdHistDelta?.let{it>BigDecimal.ZERO}==true,
                f.rsi14?.let{it>=BigDecimal("50")&&it<=BigDecimal("75")}==true,
                f.volumeBreakout?.let{it>=BigDecimal("1.2")}==true,
                f.closeLocation?.let{it>=BigDecimal(".65")}==true,
                f.relative5?.let{it>BigDecimal.ZERO}==true,
                f.atrPct?.let{it>=BigDecimal("2.5")&&it<=BigDecimal("9")}==true,
                f.estimatedCostPct?.let{it<=BigDecimal.ONE}==true
            ).count{it}.let{BigDecimal(it).divide(BigDecimal("8"),SC_MC)}
            val k8=BigDecimal("100").multiply(
                BigDecimal(".62").multiply(agreement,SC_MC)
                    .add(BigDecimal(".38").multiply(votes,SC_MC),SC_MC),SC_MC
            ).coerceIn(BigDecimal.ZERO,BigDecimal("100"))

            val q=BigDecimal(quality).divide(BigDecimal("100"),SC_MC)
            val wick=BigDecimal.ONE.subtract(
                clamp01((f.upperWickPct?:BigDecimal.ZERO).divide(BigDecimal("6"),SC_MC)),SC_MC
            )
            val excess=(f.dayChange?:BigDecimal.ZERO).abs().subtract(BigDecimal("7"),SC_MC)
                .coerceAtLeast(BigDecimal.ZERO)
            val extreme=BigDecimal.ONE.subtract(
                clamp01(excess.divide(BigDecimal("5"),SC_MC)),SC_MC
            )
            val limit=if(f.limitUpRisk)BigDecimal.ZERO else BigDecimal.ONE
            val k9=requireNotNull(FormulaMath.weighted100(listOf(
                q to BigDecimal(".30"),
                wick to BigDecimal(".20"),
                extreme to BigDecimal(".18"),
                null to BigDecimal(".16"), // source-conflict evidence unavailable: do not invent it
                limit to BigDecimal(".16")
            ))).coerceIn(BigDecimal.ZERO,BigDecimal("100"))
            symbol to mapOf("K8" to k8,"K9" to k9)
        }
    }

    private suspend fun buildK10RewardEvents(asOf:Instant):List<K10RewardEvent> {
        val locked=mutableListOf<Pair<Instant,K10RewardEvent>>()
        val barsCache=mutableMapOf<String,List<MarketBarEntity>>()
        suspend fun bars(symbol:String):List<MarketBarEntity> {
            barsCache[symbol]?.let{return it}
            val rows=dao.marketBars(symbol,asOf.toString()).sortedBy{it.atUtc}
            barsCache[symbol]=rows
            return rows
        }
        fun localDate(raw:String):LocalDate? =
            runCatching{LocalDate.ofInstant(Instant.parse(raw),ZoneId.of("Europe/Istanbul"))}.getOrNull()
        suspend fun dayReturn(symbol:String,date:LocalDate):BigDecimal? {
            val daily=bars(symbol)
                .mapNotNull { row ->
                    val d=localDate(row.atUtc) ?: return@mapNotNull null
                    val close=row.closeDecimal.toBigDecimalOrNull()?.takeIf{it>BigDecimal.ZERO}
                        ?: return@mapNotNull null
                    Triple(d,row.atUtc,close)
                }
                .groupBy{it.first}
                .mapValues { (_,rows) -> rows.maxByOrNull{it.second}!! }
                .toSortedMap()
            val dates=daily.keys.toList()
            val index=dates.indexOf(date)
            if(index<=0) return null
            val current=daily.getValue(dates[index]).third
            val previous=daily.getValue(dates[index-1]).third
            if(previous.signum()==0) return null
            val pct=current.divide(previous,SC_MC).subtract(BigDecimal.ONE,SC_MC)
                .multiply(BigDecimal("100"),SC_MC)
            return pct.takeIf{it.abs()<BigDecimal("80")}
        }

        for(run in dao.recentRuns(200)) {
            val runAt=runCatching{Instant.parse(run.asOfUtc)}.getOrNull() ?: continue
            if(runAt.isAfter(asOf) || !run.integrityPassed) continue
            val selections=dao.selectionsForRun(run.id)
                .filter { row ->
                    val blocked=row.rejectionReason?.let {
                        it.startsWith("DATA_ROW_COMPLETENESS_BELOW_GATE") ||
                        it.startsWith("DATA_COLUMN_COMPLETENESS_BELOW_GATE") ||
                        it.startsWith("DATA_TABLE_COMPLETENESS_BELOW_GATE") ||
                        it.startsWith("DATA_ROW_COMPLETENESS_LT_70") ||
                        it.startsWith("DATA_COLUMN_COMPLETENESS_LT_70") ||
                        it.startsWith("DATA_TABLE_COMPLETENESS_LT_70")
                    }==true
                    !blocked && row.scoreDecimal.toBigDecimalOrNull()?.let{it>BigDecimal.ZERO}==true
                }
            if(selections.size<20) continue

            // Outcome rows are used as the durable lock/evidence that the next-session
            // date is resolved. The actual R29 "Reel" ranking is rebuilt from that
            // session's close/previous-close return, not from the two-session learning return.
            val lockedOutcomes=dao.selectionOutcomesForRun(run.id).mapNotNull { outcome ->
                val entry=runCatching{Instant.parse(outcome.entryAtUtc)}.getOrNull()
                    ?: return@mapNotNull null
                val evaluated=runCatching{Instant.parse(outcome.evaluatedAtUtc)}.getOrNull()
                    ?: return@mapNotNull null
                if(evaluated.isAfter(asOf) || !evaluated.isAfter(runAt)) return@mapNotNull null
                Triple(outcome.symbol,LocalDate.ofInstant(entry,ZoneId.of("Europe/Istanbul")),evaluated)
            }
            if(lockedOutcomes.isEmpty()) continue
            val outcomeDate=lockedOutcomes.groupingBy{it.second}.eachCount().entries
                .sortedWith(compareByDescending<Map.Entry<LocalDate,Int>>{it.value}.thenBy{it.key})
                .firstOrNull()?.key ?: continue

            val realized=mutableListOf<Pair<String,BigDecimal>>()
            for(selection in selections) {
                val ret=dayReturn(selection.symbol,outcomeDate) ?: continue
                realized += selection.symbol to ret
            }
            val minimumRealized=maxOf(20,kotlin.math.ceil(selections.size*.60).toInt())
            if(realized.size<minimumRealized) continue
            val realizedRanks=realized
                .sortedWith(compareByDescending<Pair<String,BigDecimal>>{it.second}.thenBy{it.first})
                .mapIndexed { index,row -> row.first to (index+1) }.toMap()

            val predictedRanks=selections.mapNotNull { row ->
                val ranks=parseDecisionCriterionRanks(row.contributionsJson)
                if(ranks.size==7) row.symbol to ranks else null
            }.toMap()
            if(predictedRanks.size<minimumRealized) continue
            val eventAt=lockedOutcomes.filter{it.second==outcomeDate}.maxOf{it.third}
            locked += eventAt to K10RewardEvent(
                eventId=run.id+"|"+outcomeDate,
                predictedUniverseSize=selections.size,
                realizedRanks=realizedRanks,
                predictedCriterionRanks=predictedRanks
            )
        }
        return locked.sortedWith(
            compareByDescending<Pair<Instant,K10RewardEvent>>{it.first}.thenByDescending{it.second.eventId}
        ).map{it.second}.take(K10RewardMemoryEngine.MAX_EVENTS)
    }

    private fun parseDecisionCriterionRanks(raw:String):Map<String,Int> = runCatching {
        val a=JSONArray(raw)
        buildMap {
            for(i in 0 until a.length()) {
                val x=a.optJSONObject(i) ?: continue
                val id=x.optString("criterion")
                if(id !in (1..7).map{"K"+it}) continue
                val rank=x.optInt("criterionRank").takeIf{it>0} ?: continue
                put(id,rank)
            }
        }
    }.getOrDefault(emptyMap())

    private fun metaCriterionRanks(
        scores:Map<String,Map<String,BigDecimal>>
    ):Map<String,Map<String,Int>> =
        listOf("K8","K9","K10","K11","K12").associateWith { id ->
            scores.mapNotNull { (symbol,row) -> row[id]?.let{symbol to it} }
                .sortedWith(compareByDescending<Pair<String,BigDecimal>>{it.second}.thenBy{it.first})
                .mapIndexed { index,pair -> pair.first to (index+1) }.toMap()
        }

    private fun sha256(text:String):String =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString(""){"%02x".format(it)}
}
