package io.aurum.aurumb.signal

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import java.time.*
import kotlin.math.max
import kotlin.math.min

private val QT_MC=MathContext(18,RoundingMode.HALF_EVEN)

enum class QualifiedStatus { WATCHING, BUY, SELL }

data class QualifiedTradePolicy(
    val sfContinuousMinutes:Int=240,
    val sfFinalWindowMinutes:Int=120,
    val sfPostOpenMinutes:Int=120,
    val maxStopLossPct:BigDecimal=BigDecimal("3"),
    val technicalStopAtrMultiplier:BigDecimal=BigDecimal("1.5"),
    val technicalStopFallbackPct:BigDecimal=BigDecimal("5"),
    val technicalStopSupportBufferPct:BigDecimal=BigDecimal("0.5"),
    val profitLockStartPct:BigDecimal=BigDecimal("5"),
    val profitLockInitialPullbackPct:BigDecimal=BigDecimal("2"),
    val profitLockStepStartPct:BigDecimal=BigDecimal("20"),
    val profitLockStepSizePct:BigDecimal=BigDecimal("10"),
    val profitLockStepPullbackPct:BigDecimal=BigDecimal("2")
) {
    init {
        require(sfContinuousMinutes>0 && sfFinalWindowMinutes>0 && sfPostOpenMinutes>0)
        require(maxStopLossPct>BigDecimal.ZERO && maxStopLossPct<BigDecimal("100"))
        require(technicalStopAtrMultiplier>BigDecimal.ZERO)
        require(technicalStopFallbackPct>BigDecimal.ZERO && technicalStopFallbackPct<BigDecimal("100"))
        require(technicalStopSupportBufferPct>=BigDecimal.ZERO && technicalStopSupportBufferPct<BigDecimal("100"))
        require(profitLockStartPct>BigDecimal.ZERO)
        require(profitLockInitialPullbackPct>BigDecimal.ZERO)
        require(profitLockStepStartPct>=profitLockStartPct)
        require(profitLockStepSizePct>BigDecimal.ZERO && profitLockStepPullbackPct>BigDecimal.ZERO)
    }
}

data class QualifiedTradeState(
    val symbol:String,
    val status:QualifiedStatus,
    val firstSeenAt:Instant,
    val firstMarketAt:Instant?,
    val entryRunToken:String,
    val processedRunTokens:Set<String>,
    val observationCount:Int,
    val buyAt:Instant?=null,
    val buyPrice:BigDecimal?=null,
    val stopLossPrice:BigDecimal?=null,
    val stopMethod:String?=null,
    val stopEvidenceAt:Instant?=null,
    val maxPrice:BigDecimal?=null,
    val maxPriceAt:Instant?=null,
    val activeProfitLockPct:BigDecimal?=null,
    val profitLockEvidenceAt:Instant?=null,
    val sellAt:Instant?=null,
    val sellPrice:BigDecimal?=null,
    val exitReason:String?=null,
    val aboveEntrySeen:Boolean=false,
    val leftSelection:Boolean=false
)

data class QualifiedMarketInput(
    val symbol:String,
    val inSelection:Boolean,
    val price:BigDecimal?,
    val marketAt:Instant?,
    val atr14:BigDecimal?,
    val support10:BigDecimal?,
    val analysisEligible:Boolean=true,
    val entitlementSince:Instant?=null,
    val entitlementFailClosedReason:String?=null,
    val completedFullSessionsSinceBuy:Int=0,
    val maxReturnSinceBuyPct:BigDecimal?=null,
    val maxVolumeIncreasePctSinceBuy:BigDecimal?=null,
    val pricePerformanceEvidenceComplete:Boolean=false,
    val volumePerformanceEvidenceComplete:Boolean=false
)

data class SfEntitlementEvidencePoint(
    val runId:String,
    val at:Instant,
    val formulaVersion:String,
    val integrityPassed:Boolean,
    val selectedSymbols:Set<String>,
    /**
     * Earliest instant for which this evidence point explicitly proves
     * uninterrupted membership through [at]. A null value is point evidence
     * only and must never be stretched across an unseen interval.
     */
    val coverageStart:Instant?=null
)

data class SfEntitlementDecision(
    val since:Instant?,
    val failClosedReason:String?
)

object SfEntitlementReconstruction {
    /**
     * Reconstructs entitlement only from explicitly covered evidence intervals.
     * A persisted analysis snapshot without [SfEntitlementEvidencePoint.coverageStart]
     * is point evidence, not proof of the unseen time until another snapshot.
     */
    fun reconstruct(
        symbol:String,
        currentRunId:String,
        formulaVersion:String,
        points:List<SfEntitlementEvidencePoint>
    ):SfEntitlementDecision {
        val ordered=points.sortedByDescending{it.at}
        val currentIndex=ordered.indexOfFirst{it.runId==currentRunId}
        if(currentIndex<0) return SfEntitlementDecision(null,"CURRENT_EVIDENCE_MISSING")

        val current=ordered[currentIndex]
        if(!current.integrityPassed) return SfEntitlementDecision(null,"FAILED_OR_INVALID_EVIDENCE")
        if(current.formulaVersion!=formulaVersion) return SfEntitlementDecision(null,"FORMULA_VERSION_BOUNDARY")
        if(symbol !in current.selectedSymbols) return SfEntitlementDecision(null,null)

        var since=current.coverageStart?:current.at
        var newer=current
        var reason:String?=null
        for(i in currentIndex+1 until ordered.size) {
            val older=ordered[i]
            if(!older.integrityPassed) {
                reason="FAILED_OR_INVALID_EVIDENCE"
                break
            }
            if(older.formulaVersion!=formulaVersion) {
                reason="FORMULA_VERSION_BOUNDARY"
                break
            }
            if(symbol !in older.selectedSymbols) break

            val coveredFrom=newer.coverageStart
            if(coveredFrom==null || coveredFrom.isAfter(older.at)) {
                reason="UNVERIFIED_EVIDENCE_GAP"
                break
            }
            since=minOf(since,older.coverageStart?:older.at)
            newer=older
        }
        return SfEntitlementDecision(since,reason)
    }

    fun since(
        symbol:String,
        currentRunId:String,
        formulaVersion:String,
        points:List<SfEntitlementEvidencePoint>
    ):Instant? = reconstruct(symbol,currentRunId,formulaVersion,points).since
}

data class QualifiedLifecycleEvent(
    val symbol:String,
    val side:SignalSide,
    val at:Instant,
    val price:BigDecimal,
    val reason:String,
    val stopLoss:BigDecimal?,
    val activeProfitLockPct:BigDecimal?
)

data class QualifiedAdvanceResult(
    val states:Map<String,QualifiedTradeState>,
    val events:List<QualifiedLifecycleEvent>
)

object QualifiedTradeLifecycle {
    private val istanbul=ZoneId.of("Europe/Istanbul")
    private val open=LocalTime.of(10,0)
    private val close=LocalTime.of(18,0)
    private val halfDayClose=LocalTime.of(12,40)

    fun technicalStop(
        entry:BigDecimal,atr14:BigDecimal?,support10:BigDecimal?,
        policy:QualifiedTradePolicy=QualifiedTradePolicy()
    ):Pair<BigDecimal,String> {
        require(entry>BigDecimal.ZERO)
        var stop=atr14?.takeIf{it>BigDecimal.ZERO}
            ?.let{entry.subtract(it.multiply(policy.technicalStopAtrMultiplier,QT_MC),QT_MC)}
            ?:entry.multiply(BigDecimal.ONE.subtract(policy.technicalStopFallbackPct.divide(BigDecimal("100"),QT_MC),QT_MC),QT_MC)
        var method=if(atr14!=null && atr14>BigDecimal.ZERO)"ATR_X_"+policy.technicalStopAtrMultiplier.stripTrailingZeros().toPlainString() else "FALLBACK_"+policy.technicalStopFallbackPct.stripTrailingZeros().toPlainString()+"PCT"
        support10?.takeIf{it>BigDecimal.ZERO && it<entry}?.let {
            val supportFactor=BigDecimal.ONE.subtract(policy.technicalStopSupportBufferPct.divide(BigDecimal("100"),QT_MC),QT_MC)
            stop=maxOf(stop,it.multiply(supportFactor,QT_MC))
            method=if(atr14!=null && atr14>BigDecimal.ZERO)"SUPPORT10_PLUS_ATR" else "SUPPORT10"
        }
        stop=minOf(stop,entry)
        val maxLossStop=entry.multiply(
            BigDecimal.ONE.subtract(policy.maxStopLossPct.divide(BigDecimal("100"),QT_MC),QT_MC),QT_MC
        )
        if(stop<maxLossStop) {
            stop=maxLossStop
            method+="_MAX_LOSS_"+policy.maxStopLossPct.stripTrailingZeros().toPlainString()+"PCT"
        }
        return stop to method
    }

    /**
     * Maximum permitted pullback from the best return reached since BUY.
     * 5-<20% peak return => 2 percentage points.
     * From 20% onward each completed 10-point band permits 2 more points:
     * 20=>4, 30=>6, ... 100=>20 (and the pattern continues above 100).
     */
    fun profitLockDrawdownPct(
        maxReturnPct:BigDecimal,
        policy:QualifiedTradePolicy=QualifiedTradePolicy()
    ):BigDecimal? {
        if(maxReturnPct<policy.profitLockStartPct) return null
        if(maxReturnPct<policy.profitLockStepStartPct) return policy.profitLockInitialPullbackPct
        val completedSteps=maxReturnPct.divideToIntegralValue(policy.profitLockStepSizePct)
        return completedSteps.multiply(policy.profitLockStepPullbackPct,QT_MC)
    }

    fun completedTradingSessionsSinceBuy(
        dates:Iterable<LocalDate>,
        buyDate:LocalDate,
        currentDate:LocalDate,
        isOpen:(LocalDate)->Boolean
    ):Int = dates.distinct().count { d -> d>buyDate && d<currentDate && isOpen(d) }

    fun manualExitReason(
        entry:BigDecimal,
        price:BigDecimal,
        persistedStop:BigDecimal?,
        persistedPeak:BigDecimal?,
        policy:QualifiedTradePolicy=QualifiedTradePolicy()
    ):String {
        require(entry>BigDecimal.ZERO && price>BigDecimal.ZERO)
        val peak=maxOf(persistedPeak?:entry,price)
        val ret=price.divide(entry,QT_MC).subtract(BigDecimal.ONE,QT_MC).multiply(BigDecimal("100"),QT_MC)
        val peakRet=peak.divide(entry,QT_MC).subtract(BigDecimal.ONE,QT_MC).multiply(BigDecimal("100"),QT_MC)
        val lock=highestArmedLock(peakRet,policy)
        return when {
            persistedStop!=null && price<=persistedStop -> "ZARAR_KES"
            lock!=null && ret<lock -> "KAR_KILIDI"
            else -> "MANUAL_PRODUCT_CARD"
        }
    }

    /** Return floor implied by the current peak. Sell only below this floor. */
    fun highestArmedLock(
        maxReturnPct:BigDecimal,
        policy:QualifiedTradePolicy=QualifiedTradePolicy()
    ):BigDecimal? =
        profitLockDrawdownPct(maxReturnPct,policy)?.let { maxReturnPct.subtract(it,QT_MC) }

    fun advance(
        previous:Map<String,QualifiedTradeState>,
        inputs:List<QualifiedMarketInput>,
        runToken:String,
        now:Instant,
        policy:QualifiedTradePolicy=QualifiedTradePolicy(),
        isHalfDay:(LocalDate)->Boolean={false},
        isTradingDay:(LocalDate)->Boolean
    ):QualifiedAdvanceResult {
        require(runToken.isNotBlank())
        require(inputs.map{it.symbol}.distinct().size==inputs.size)
        val next=previous.toMutableMap()
        val events=mutableListOf<QualifiedLifecycleEvent>()
        val current=inputs.associateBy{it.symbol}
        val currentSelection=inputs.filter{it.inSelection && it.analysisEligible}.map{it.symbol}.toSet()

        // Ineligible rows are outside the decision universe. A WATCHING entitlement
        // clock cannot survive such a gap; open BUY/SELL provenance is preserved.
        for(input in inputs.filter{it.inSelection && !it.analysisEligible}) {
            if(next[input.symbol]?.status==QualifiedStatus.WATCHING) next.remove(input.symbol)
        }

        for(input in inputs.filter{it.inSelection && it.analysisEligible}) {
            val price=input.price
            val old=next[input.symbol]
            if(old==null || old.status==QualifiedStatus.SELL) {
                val initial=QualifiedTradeState(
                    symbol=input.symbol,
                    status=QualifiedStatus.WATCHING,
                    firstSeenAt=input.entitlementSince?:now,
                    firstMarketAt=input.entitlementSince?:input.marketAt,
                    entryRunToken=runToken,
                    processedRunTokens=setOf(runToken),
                    observationCount=1
                )
                val qualification=buyQualification(initial,input.marketAt?:now,isTradingDay,policy,isHalfDay)
                if(price!=null && price>BigDecimal.ZERO && qualification!=null) {
                    val (stop,method)=technicalStop(price,input.atr14,input.support10,policy)
                    next[input.symbol]=initial.copy(
                        status=QualifiedStatus.BUY,buyAt=now,buyPrice=price,
                        stopLossPrice=stop,stopMethod=method,stopEvidenceAt=now,
                        maxPrice=price,maxPriceAt=now,
                        aboveEntrySeen=false,leftSelection=false
                    )
                    events+=QualifiedLifecycleEvent(input.symbol,SignalSide.BUY,now,price,qualification,stop,null)
                } else {
                    next[input.symbol]=initial
                }
                continue
            }
            if(runToken in old.processedRunTokens) continue

            if(old.status==QualifiedStatus.WATCHING) {
                val resetForUnknown=input.entitlementFailClosedReason!=null
                val earlierEntitlement=if(resetForUnknown) {
                    input.entitlementSince?:input.marketAt?:now
                } else {
                    listOfNotNull(old.firstMarketAt,input.entitlementSince).minOrNull()
                }
                val observed=old.copy(
                    firstSeenAt=if(resetForUnknown) (input.entitlementSince?:now)
                        else minOf(old.firstSeenAt,input.entitlementSince?:old.firstSeenAt),
                    firstMarketAt=earlierEntitlement,
                    entryRunToken=if(resetForUnknown) runToken else old.entryRunToken,
                    processedRunTokens=if(resetForUnknown) setOf(runToken)
                        else (old.processedRunTokens+runToken).takeLastSet(16),
                    observationCount=if(resetForUnknown) 1 else old.observationCount+1
                )
                val qualification=buyQualification(observed,input.marketAt?:now,isTradingDay,policy,isHalfDay)
                if(price!=null && price>BigDecimal.ZERO && qualification!=null) {
                    val (stop,method)=technicalStop(price,input.atr14,input.support10,policy)
                    next[input.symbol]=observed.copy(
                        status=QualifiedStatus.BUY,buyAt=now,buyPrice=price,
                        stopLossPrice=stop,stopMethod=method,stopEvidenceAt=now,
                        maxPrice=price,maxPriceAt=now,
                        aboveEntrySeen=false,leftSelection=false
                    )
                    events+=QualifiedLifecycleEvent(input.symbol,SignalSide.BUY,now,price,qualification,stop,null)
                } else next[input.symbol]=observed
                continue
            }

            if(old.status==QualifiedStatus.BUY && price!=null && price>BigDecimal.ZERO) {
                val entry=requireNotNull(old.buyPrice)
                val previousMax=old.maxPrice?:entry
                val maxPrice=maxOf(previousMax,price)
                val maxPriceAt=if(maxPrice>previousMax) now else old.maxPriceAt
                val maxReturn=maxPrice.divide(entry,QT_MC).subtract(BigDecimal.ONE,QT_MC).multiply(BigDecimal("100"),QT_MC)
                val armed=highestArmedLock(maxReturn,policy)
                val active=armed
                val lockEvidenceAt=if(active!=old.activeProfitLockPct) now else old.profitLockEvidenceAt
                val ret=price.divide(entry,QT_MC).subtract(BigDecimal.ONE,QT_MC).multiply(BigDecimal("100"),QT_MC)
                val stop=old.stopLossPrice
                val exit=when {
                    stop!=null && price<=stop -> "ZARAR_KES"
                    active!=null && ret<active -> "KAR_KILIDI"
                    else -> null
                }
                if(exit!=null) {
                    next[input.symbol]=old.copy(
                        status=QualifiedStatus.SELL,
                        processedRunTokens=(old.processedRunTokens+runToken).takeLastSet(16),
                        maxPrice=maxPrice,maxPriceAt=maxPriceAt,
                        activeProfitLockPct=active,profitLockEvidenceAt=lockEvidenceAt,
                        sellAt=now,sellPrice=price,exitReason=exit
                    )
                    events+=QualifiedLifecycleEvent(input.symbol,SignalSide.SELL,now,price,exit,stop,active)
                } else {
                    next[input.symbol]=old.copy(
                        processedRunTokens=(old.processedRunTokens+runToken).takeLastSet(16),
                        maxPrice=maxPrice,maxPriceAt=maxPriceAt,
                        activeProfitLockPct=active,profitLockEvidenceAt=lockEvidenceAt,
                        aboveEntrySeen=old.aboveEntrySeen || price>entry,
                        leftSelection=false
                    )
                }
            }
        }

        for((symbol,old) in previous) {
            val currentInput=current[symbol]
            if(currentInput!=null && !currentInput.analysisEligible) continue
            if(symbol in currentSelection) continue
            if(old.status==QualifiedStatus.WATCHING) {
                next.remove(symbol)
                continue
            }
            if(old.status!=QualifiedStatus.BUY || runToken in old.processedRunTokens) continue
            val input=current[symbol]
            val price=input?.price
            if(price==null || price<=BigDecimal.ZERO) {
                next[symbol]=old.copy(
                    processedRunTokens=(old.processedRunTokens+runToken).takeLastSet(16),
                    leftSelection=true
                )
                continue
            }
            val entry=requireNotNull(old.buyPrice)
            val previousMax=old.maxPrice?:entry
            val maxPrice=maxOf(previousMax,price)
            val maxPriceAt=if(maxPrice>previousMax) now else old.maxPriceAt
            val maxReturn=maxPrice.divide(entry,QT_MC).subtract(BigDecimal.ONE,QT_MC).multiply(BigDecimal("100"),QT_MC)
            val armed=highestArmedLock(maxReturn,policy)
            val active=armed
            val lockEvidenceAt=if(active!=old.activeProfitLockPct) now else old.profitLockEvidenceAt
            val ret=price.divide(entry,QT_MC).subtract(BigDecimal.ONE,QT_MC).multiply(BigDecimal("100"),QT_MC)
            val exit=when {
                old.stopLossPrice!=null && price<=old.stopLossPrice -> "ZARAR_KES"
                active!=null && ret<active -> "KAR_KILIDI"
                input!=null && input.completedFullSessionsSinceBuy>=2 && (
                    (input.pricePerformanceEvidenceComplete &&
                        (input.maxReturnSinceBuyPct?:maxReturn)<=BigDecimal("3") &&
                        ret>BigDecimal.ZERO && ret<BigDecimal("3")) ||
                    (input.volumePerformanceEvidenceComplete &&
                        input.maxVolumeIncreasePctSinceBuy!=null &&
                        input.maxVolumeIncreasePctSinceBuy<=BigDecimal("50"))
                ) -> "SF_DISI_2_TAM_SEANS_PERFORMANS"
                old.aboveEntrySeen && price<=entry -> "S_CIKIS_AL_FIYAT_DONUS"
                else -> null
            }
            if(exit!=null) {
                next[symbol]=old.copy(
                    status=QualifiedStatus.SELL,
                    processedRunTokens=(old.processedRunTokens+runToken).takeLastSet(16),
                    maxPrice=maxPrice,maxPriceAt=maxPriceAt,
                    activeProfitLockPct=active,profitLockEvidenceAt=lockEvidenceAt,
                    sellAt=now,sellPrice=price,exitReason=exit,leftSelection=true
                )
                events+=QualifiedLifecycleEvent(symbol,SignalSide.SELL,now,price,exit,old.stopLossPrice,active)
            } else next[symbol]=old.copy(
                processedRunTokens=(old.processedRunTokens+runToken).takeLastSet(16),
                maxPrice=maxPrice,maxPriceAt=maxPriceAt,
                activeProfitLockPct=active,profitLockEvidenceAt=lockEvidenceAt,leftSelection=true
            )
        }
        return QualifiedAdvanceResult(next.toSortedMap(),events)
    }

    fun buyQualification(
        state:QualifiedTradeState,
        marketAt:Instant?,
        isTradingDay:(LocalDate)->Boolean,
        policy:QualifiedTradePolicy=QualifiedTradePolicy(),
        isHalfDay:(LocalDate)->Boolean={false}
    ):String? {
        val first=state.firstMarketAt ?: return null
        val current=marketAt ?: return null
        if(current.isBefore(first)) return null
        val firstZ=first.atZone(istanbul)
        val firstDate=firstZ.toLocalDate()
        val firstTime=firstZ.toLocalTime()
        val firstClose=if(isHalfDay(firstDate)) halfDayClose else close

        if(isTradingDay(firstDate) && firstTime>=firstClose.minusMinutes(policy.sfFinalWindowMinutes.toLong()) && firstTime<firstClose) {
            val closeAt=firstDate.atTime(firstClose).atZone(istanbul).toInstant()
            return if(!current.isBefore(closeAt)) "SF_LAST_2H_THROUGH_CLOSE" else null
        }

        if(!isTradingDay(firstDate) || firstTime<open || firstTime>=firstClose) {
            var d=firstDate
            if(!(isTradingDay(d) && firstTime<open)) {
                d=d.plusDays(1)
                while(!isTradingDay(d)) d=d.plusDays(1)
            }
            val qualifyTime=open.plusMinutes(policy.sfPostOpenMinutes.toLong())
            val sessionClose=if(isHalfDay(d)) halfDayClose else close
            if(qualifyTime>sessionClose) return null
            val qualifyAt=d.atTime(qualifyTime).atZone(istanbul).toInstant()
            return if(!current.isBefore(qualifyAt)) "SF_AFTER_SESSION_NEXT_OPEN_2H" else null
        }

        return if(tradingSessionMinutes(first,current,isTradingDay,isHalfDay)>=policy.sfContinuousMinutes.toLong()) "SF_CONTINUOUS_4H" else null
    }

    internal fun qualifies(
        state:QualifiedTradeState,
        marketAt:Instant?,
        isTradingDay:(LocalDate)->Boolean
    ):Boolean = buyQualification(state,marketAt,isTradingDay)!=null

    private fun tradingSessionMinutes(
        from:Instant,
        to:Instant,
        isTradingDay:(LocalDate)->Boolean,
        isHalfDay:(LocalDate)->Boolean={false}
    ):Long {
        if(to.isBefore(from)) return 0
        val fromDate=from.atZone(istanbul).toLocalDate()
        val toDate=to.atZone(istanbul).toLocalDate()
        var total=0L
        var d=fromDate
        while(!d.isAfter(toDate)) {
            if(isTradingDay(d)) {
                val sessionOpen=d.atTime(open).atZone(istanbul).toInstant()
                val sessionClose=d.atTime(if(isHalfDay(d)) halfDayClose else close).atZone(istanbul).toInstant()
                val a=maxOf(from,sessionOpen)
                val b=minOf(to,sessionClose)
                if(b.isAfter(a)) total+=Duration.between(a,b).toMinutes()
            }
            d=d.plusDays(1)
        }
        return total
    }

    private fun <T> Set<T>.takeLastSet(max:Int):Set<T> =
        if(size<=max)this else this.toList().takeLast(max).toSet()
}
