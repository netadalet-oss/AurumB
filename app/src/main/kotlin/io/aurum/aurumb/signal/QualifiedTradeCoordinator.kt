package io.aurum.aurumb.signal

import io.aurum.aurumb.indicator.IndicatorMath
import io.aurum.aurumb.persistence.*
import io.aurum.aurumb.portfolio.*
import io.aurum.common.calendar.MarketCalendar
import io.aurum.common.model.AurumVersions
import io.aurum.common.eligibility.ExtremeMoveEligibility
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

class QualifiedTradeCoordinator(
    private val dao:AurumDao,
    private val calendar:MarketCalendar,
    private val topN:Int,
    private val portfolio:VirtualPortfolioService,
    private val maxDailyMovePct:BigDecimal=ExtremeMoveEligibility.MAX_ABS_MOVE_PCT,
    private val policy:QualifiedTradePolicy=QualifiedTradePolicy(),
    private val clock:()->Instant={Instant.now()}
) {
    private val zone=ZoneId.of("Europe/Istanbul")

    suspend fun advance(runId:String):List<QualifiedLifecycleEvent> {
        val run=dao.recentRuns(50).firstOrNull{it.id==runId} ?: throw IllegalArgumentException("unknown run")
        val selections=dao.selectionsForRun(runId)
        val blockedSymbols=dao.blockedInstruments().map{it.symbol}.toSet()
        val selected=selections.filter{it.rank in 1..topN}.map{it.symbol}.filterNot{it in blockedSymbols}.toSet()
        val entitlement=continuousSfEntitlementSince(run,selected)
        val dataEligibility=selections.associate { row ->
            val blocked=row.rejectionReason?.let {
                it.startsWith("DATA_ROW_COMPLETENESS_LT_") ||
                it.startsWith("DATA_COLUMN_COMPLETENESS_LT_") ||
                it.startsWith("DATA_TABLE_COMPLETENESS_LT_")
            }==true
            row.symbol to !blocked
        }
        val previous=dao.qualifiedTradeStates().associate{it.symbol to it.toDomain()}
        val portfolioSymbols=dao.portfolioPositions().map{it.symbol}.toSet()
        val symbols=(selected+previous.filterValues{it.status==QualifiedStatus.BUY}.keys+portfolioSymbols).sorted()
        val now=Instant.parse(run.asOfUtc)
        val inputs=symbols.map { symbol ->
            val bars=dao.marketBars(symbol,now.toString())
            val closes=bars.map{it.closeDecimal.toDoubleOrNull()}
            val highs=bars.map{it.highDecimal?.toDoubleOrNull()}
            val lows=bars.map{it.lowDecimal?.toDoubleOrNull()}
            val atr=IndicatorMath.atr(highs,lows,closes,14).lastOrNull()?.let{it?.let(BigDecimal::valueOf)}
            val support=bars.takeLast(10).mapNotNull{it.lowDecimal?.toBigDecimalOrNull()}.filter{it>BigDecimal.ZERO}.minOrNull()
            val latest=bars.lastOrNull()
            val previousBar=bars.getOrNull(bars.lastIndex-1)
            val latestPrice=latest?.closeDecimal?.toBigDecimalOrNull()
            val previousClose=previousBar?.closeDecimal?.toBigDecimalOrNull()
            val dailyChange=ExtremeMoveEligibility.percentChange(latestPrice,previousClose)
            val observation=dao.latestObservation(symbol,now.toString())
            val instantChange=observation?.let { row ->
                val at=row.marketTimestampUtc?.let { raw -> runCatching{Instant.parse(raw)}.getOrNull() }
                val sameTradingDate=at?.let{
                    LocalDate.ofInstant(it,zone)==LocalDate.ofInstant(now,zone)
                }==true
                if(!sameTradingDate) null
                else ExtremeMoveEligibility.percentChange(row.valueDecimal?.toBigDecimalOrNull(),previousClose)
            }
            val moveEligible=ExtremeMoveEligibility.assess(
                currentMovePct=instantChange,dailyMovePct=dailyChange,maxAbsMovePct=maxDailyMovePct
            ).eligible
            val held=previous[symbol]?.takeIf{it.status==QualifiedStatus.BUY && it.buyAt!=null && it.buyPrice!=null}
            val buyAt=held?.buyAt
            val buyDate=buyAt?.atZone(zone)?.toLocalDate()
            val completedFullSessions=if(buyDate==null) 0 else QualifiedTradeLifecycle.completedTradingSessionsSinceBuy(
                dates=bars.mapNotNull { row -> runCatching{Instant.parse(row.atUtc).atZone(zone).toLocalDate()}.getOrNull() },
                buyDate=buyDate,
                currentDate=LocalDate.ofInstant(now,zone),
                isOpen=calendar::isOpen
            )
            val heldBars=if(buyAt==null) emptyList() else bars.filter { row ->
                runCatching{Instant.parse(row.atUtc)}.getOrNull()?.isAfter(buyAt)!=false
            }
            val entry=held?.buyPrice
            val maxReturnSinceBuy=if(entry!=null && entry>BigDecimal.ZERO) heldBars.mapNotNull{it.highDecimal?.toBigDecimalOrNull()?:it.closeDecimal.toBigDecimalOrNull()}
                .maxOrNull()?.divide(entry,java.math.MathContext.DECIMAL128)?.subtract(BigDecimal.ONE)?.multiply(BigDecimal("100")) else null
            val baselineVolume=if(buyAt==null) null else bars.lastOrNull { row ->
                runCatching{!Instant.parse(row.atUtc).isAfter(buyAt)}.getOrDefault(false)
            }?.volumeDecimal?.toBigDecimalOrNull()?.takeIf{it>BigDecimal.ZERO}
            val maxVolumeIncrease=baselineVolume?.let { base -> heldBars.mapNotNull{it.volumeDecimal?.toBigDecimalOrNull()?.takeIf{x->x>=BigDecimal.ZERO}}
                .maxOrNull()?.divide(base,java.math.MathContext.DECIMAL128)?.subtract(BigDecimal.ONE)?.multiply(BigDecimal("100")) }
            QualifiedMarketInput(
                symbol=symbol,
                inSelection=symbol in selected,
                price=latestPrice,
                marketAt=now,
                atr14=atr,
                support10=support,
                analysisEligible=run.integrityPassed && moveEligible && (dataEligibility[symbol] ?: false),
                entitlementSince=entitlement[symbol]?.since,
                entitlementFailClosedReason=entitlement[symbol]?.failClosedReason,
                completedFullSessionsSinceBuy=completedFullSessions,
                maxReturnSinceBuyPct=maxReturnSinceBuy,
                maxVolumeIncreasePctSinceBuy=maxVolumeIncrease,
                pricePerformanceEvidenceComplete=completedFullSessions>=2 && maxReturnSinceBuy!=null,
                volumePerformanceEvidenceComplete=completedFullSessions>=2 && maxVolumeIncrease!=null
            )
        }
        val advanced=QualifiedTradeLifecycle.advance(
            previous,inputs,runId,now,policy,
            isHalfDay={d:LocalDate -> calendar.isHalfDay(d)}
        ){d:LocalDate -> calendar.isOpen(d)}

        val removed=previous.keys-advanced.states.keys
        removed.forEach{dao.deleteQualifiedTradeState(it)}
        dao.putQualifiedTradeStates(advanced.states.values.map{it.toEntity()})

        val rowsBySymbol=selections.associateBy{it.symbol}
        for(event in advanced.events) {
            val id=runId+":"+event.symbol+":"+event.side.name
            val selection=rowsBySymbol[event.symbol]
            val signal=SignalEntity(
                id=id,
                instrument=event.symbol,
                signal=event.side.name,
                signalTimeUtc=event.at.toString(),
                effectiveEntryTimeUtc=event.at.toString(),
                entryBasis=event.price.toPlainString(),
                reasonsJson=JSONArray(listOf(event.reason)).toString(),
                contributionsJson=selection?.contributionsJson?:"[]",
                confidenceDecimal=selection?.confidenceDecimal?:"0",
                marketRegime=run.marketRegime,
                dataFreshness="CACHED_OR_LIVE",
                invalidationCondition=event.stopLoss?.let{"price <= "+it.toPlainString()}?:"qualified lifecycle exit",
                targetHorizon="SHORT_TERM",
                appVersion=AurumVersions.APP,
                modelVersion=run.modelVersion,
                formulaVersion=run.formulaVersion,
                dataSchemaVersion=AurumVersions.DATA_SCHEMA
            )
            if(dao.tradeRemovalTombstone(id)!=null) continue
            if(dao.signalById(id)==null) {
                dao.appendSignal(signal)
            }
            portfolio.apply(event,id,id)
        }
        val marks=inputs.filter{it.analysisEligible}.mapNotNull{it.price?.let{p->it.symbol to p}}.toMap()
        portfolio.mark(marks,now)
        if(advanced.events.isNotEmpty()) {
            val buys=advanced.events.filter{it.side==SignalSide.BUY}.map{it.symbol}
            val sells=advanced.events.filter{it.side==SignalSide.SELL}.map{it.symbol}
            dao.appendAudit(AuditEventEntity(
                id=UUID.randomUUID().toString(), timestampUtc=now.toString(), level="INFO",
                subsystem="qualified-trade", operationId=runId,
                code="QUALIFIED_LIFECYCLE_SUMMARY",
                message="AL "+buys.size+" · SAT "+sells.size+" · toplam "+advanced.events.size+" enstrüman",
                metadataJson=JSONObject()
                    .put("buySymbols",JSONArray(buys))
                    .put("sellSymbols",JSONArray(sells))
                    .put("count",advanced.events.size)
                    .toString(),
                appVersion=AurumVersions.APP, modelVersion=run.modelVersion, formulaVersion=run.formulaVersion,
                dataSchemaVersion=AurumVersions.DATA_SCHEMA,
                provenanceJson=JSONObject(mapOf("analysisRunId" to runId,"source" to "AUTO_LIFECYCLE")).toString()
            ))
        }
        return advanced.events
    }


    /**
     * S/F continuity is reconstructed from persisted successful formula runs,
     * not from Activity uptime or UI observation frequency. Missing device/UI
     * activity alone is not entitlement evidence. Reconstruction never crosses
     * a failed/invalid run, formula-version boundary, or explicit non-membership;
     * those are UNKNOWN/discontinuity boundaries and therefore fail closed.
     */
    private suspend fun continuousSfEntitlementSince(
        currentRun:AnalysisRunEntity,
        currentSelected:Set<String>
    ):Map<String,SfEntitlementDecision> {
        if(currentSelected.isEmpty()) return emptyMap()
        val currentAt=Instant.parse(currentRun.asOfUtc)
        val runs=dao.recentRuns(256)
            .filter{runCatching{Instant.parse(it.asOfUtc)}.getOrNull()?.let{x->!x.isAfter(currentAt)}==true}
            .sortedByDescending{it.asOfUtc}
        val points=mutableListOf<SfEntitlementEvidencePoint>()
        for(r in runs) {
            val members=if(r.integrityPassed && r.formulaVersion==currentRun.formulaVersion) {
                dao.selectionsForRun(r.id)
                    .filter{it.rank in 1..topN}
                    .map{it.symbol}
                    .toSet()
            } else emptySet()
            points+=SfEntitlementEvidencePoint(
                runId=r.id,
                at=Instant.parse(r.asOfUtc),
                formulaVersion=r.formulaVersion,
                integrityPassed=r.integrityPassed,
                selectedSymbols=members
            )
        }
        val out=linkedMapOf<String,SfEntitlementDecision>()
        val failClosedItems=mutableListOf<JSONObject>()
        for(symbol in currentSelected.sorted()) {
            val decision=SfEntitlementReconstruction.reconstruct(
                symbol,currentRun.id,currentRun.formulaVersion,points
            )
            out[symbol]=decision
            decision.failClosedReason?.let { reason ->
                failClosedItems += JSONObject()
                    .put("symbol",symbol)
                    .put("reason",reason)
                    .put("effectiveSinceUtc",decision.since?.toString())
            }
        }
        if(failClosedItems.isNotEmpty()) {
            dao.appendAudit(AuditEventEntity(
                id=UUID.randomUUID().toString(),
                timestampUtc=currentAt.toString(),
                level="WARN",
                subsystem="qualified-trade",
                operationId=currentRun.id,
                code="SF_ENTITLEMENT_FAIL_CLOSED",
                message="S/F entitlement reconstruction stopped at unknown evidence boundaries · "+failClosedItems.size+" enstrüman",
                metadataJson=JSONObject()
                    .put("count",failClosedItems.size)
                    .put("items",JSONArray(failClosedItems))
                    .toString(),
                appVersion=AurumVersions.APP,
                modelVersion=currentRun.modelVersion,
                formulaVersion=currentRun.formulaVersion,
                dataSchemaVersion=AurumVersions.DATA_SCHEMA,
                provenanceJson=JSONObject(mapOf(
                    "analysisRunId" to currentRun.id,
                    "evidencePointCount" to points.size
                )).toString()
            ))
        }
        return out
    }

    private fun QualifiedTradeStateEntity.toDomain()=QualifiedTradeState(
        symbol=symbol,status=QualifiedStatus.valueOf(status),
        firstSeenAt=Instant.parse(firstSeenAtUtc),
        firstMarketAt=firstMarketAtUtc?.let(Instant::parse),
        entryRunToken=entryRunToken,
        processedRunTokens=(0 until JSONArray(processedRunTokensJson).length()).map{
            JSONArray(processedRunTokensJson).getString(it)
        }.toSet(),
        observationCount=observationCount,
        buyAt=buyAtUtc?.let(Instant::parse),
        buyPrice=buyPriceDecimal?.toBigDecimalOrNull(),
        stopLossPrice=stopLossPriceDecimal?.toBigDecimalOrNull(),
        stopMethod=stopMethod,stopEvidenceAt=stopEvidenceAtUtc?.let(Instant::parse),
        maxPrice=maxPriceDecimal?.toBigDecimalOrNull(),maxPriceAt=maxPriceAtUtc?.let(Instant::parse),
        activeProfitLockPct=activeProfitLockPctDecimal?.toBigDecimalOrNull(),
        profitLockEvidenceAt=profitLockEvidenceAtUtc?.let(Instant::parse),
        sellAt=sellAtUtc?.let(Instant::parse),
        sellPrice=sellPriceDecimal?.toBigDecimalOrNull(),
        exitReason=exitReason,aboveEntrySeen=aboveEntrySeen,leftSelection=leftSelection
    )

    private fun QualifiedTradeState.toEntity()=QualifiedTradeStateEntity(
        symbol,status.name,firstSeenAt.toString(),firstMarketAt?.toString(),entryRunToken,
        JSONArray(processedRunTokens.toList()).toString(),observationCount,
        buyAt?.toString(),buyPrice?.toPlainString(),stopLossPrice?.toPlainString(),stopMethod,
        stopEvidenceAt?.toString(),maxPrice?.toPlainString(),maxPriceAt?.toString(),
        activeProfitLockPct?.toPlainString(),profitLockEvidenceAt?.toString(),
        sellAt?.toString(),sellPrice?.toPlainString(),exitReason,aboveEntrySeen,leftSelection
    )
}
