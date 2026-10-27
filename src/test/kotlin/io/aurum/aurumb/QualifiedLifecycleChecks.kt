package io.aurum.aurumb

import io.aurum.aurumb.signal.*
import java.math.BigDecimal
import java.time.*

fun qualifiedLifecycleChecks() {
    val buy=BigDecimal("100")
    val stop=QualifiedTradeLifecycle.technicalStop(buy,BigDecimal("4"),BigDecimal("95")).first
    check(stop in BigDecimal("97")..BigDecimal("99"))
    check(QualifiedTradeLifecycle.highestArmedLock(BigDecimal("6"))==BigDecimal("4"))
    check(QualifiedTradeLifecycle.highestArmedLock(BigDecimal("21"))==BigDecimal("17"))

    check(QualifiedTradeLifecycle.profitLockDrawdownPct(BigDecimal("4.99"))==null)
    check(QualifiedTradeLifecycle.profitLockDrawdownPct(BigDecimal("5"))==BigDecimal("2"))
    check(QualifiedTradeLifecycle.profitLockDrawdownPct(BigDecimal("10"))==BigDecimal("2"))
    check(QualifiedTradeLifecycle.profitLockDrawdownPct(BigDecimal("20"))==BigDecimal("4"))
    check(QualifiedTradeLifecycle.profitLockDrawdownPct(BigDecimal("30"))==BigDecimal("6"))
    check(QualifiedTradeLifecycle.profitLockDrawdownPct(BigDecimal("50"))==BigDecimal("10"))
    check(QualifiedTradeLifecycle.profitLockDrawdownPct(BigDecimal("100"))==BigDecimal("20"))
    check(QualifiedTradeLifecycle.technicalStop(
        BigDecimal("100"),BigDecimal("20"),BigDecimal("80")
    ).first==BigDecimal("97.00"))
    // A tighter technical stop is never loosened merely to create a 1% minimum distance.
    check(QualifiedTradeLifecycle.technicalStop(
        BigDecimal("100"),BigDecimal("0.1"),null
    ).first.compareTo(BigDecimal("99.85"))==0)
    val customTechnical=QualifiedTradePolicy(
        technicalStopAtrMultiplier=BigDecimal("2"),
        technicalStopFallbackPct=BigDecimal("7"),
        technicalStopSupportBufferPct=BigDecimal("1")
    )
    check(QualifiedTradeLifecycle.technicalStop(
        BigDecimal("100"),null,null,customTechnical
    ).first.compareTo(BigDecimal("97"))==0) // 7% fallback is capped by default 3% max loss

    fun bought(peak:String)=QualifiedTradeState(
        symbol="BOUND",status=QualifiedStatus.BUY,
        firstSeenAt=Instant.parse("2026-10-01T07:00:00Z"),
        firstMarketAt=Instant.parse("2026-10-01T07:00:00Z"),entryRunToken="b0",
        processedRunTokens=setOf("b0"),observationCount=1,
        buyAt=Instant.parse("2026-10-01T11:00:00Z"),buyPrice=BigDecimal("100"),
        stopLossPrice=BigDecimal("97"),stopMethod="MAX_LOSS_3PCT",
        stopEvidenceAt=Instant.parse("2026-10-01T11:00:00Z"),
        maxPrice=BigDecimal(peak),maxPriceAt=Instant.parse("2026-10-01T12:00:00Z")
    )
    fun boundary(state:QualifiedTradeState,price:String,token:String)=QualifiedTradeLifecycle.advance(
        mapOf("BOUND" to state),
        listOf(QualifiedMarketInput("BOUND",true,BigDecimal(price),Instant.parse("2026-10-01T13:00:00Z"),null,null)),
        token,Instant.parse("2026-10-01T13:00:00Z")
    ){true}
    check(boundary(bought("100"),"97","s-exact").events.single().reason=="ZARAR_KES")
    check(boundary(bought("100"),"96.99","s-over").events.single().reason=="ZARAR_KES")
    check(boundary(bought("105"),"103","p5-exact").events.isEmpty())
    check(boundary(bought("105"),"102.99","p5-over").events.single().reason=="KAR_KILIDI")
    check(boundary(bought("110"),"108","p10-exact").events.isEmpty())
    check(boundary(bought("120"),"116","p20-exact").events.isEmpty())
    check(boundary(bought("120"),"115.99","p20-over").events.single().reason=="KAR_KILIDI")
    check(boundary(bought("130"),"124","p30-exact").events.isEmpty())
    check(boundary(bought("130"),"123.99","p30-over").events.single().reason=="KAR_KILIDI")
    check(boundary(bought("200"),"180","p100-exact").events.isEmpty())
    check(boundary(bought("200"),"179.99","p100-over").events.single().reason=="KAR_KILIDI")

    val day1=Instant.parse("2026-10-01T12:00:00Z")
    val input=QualifiedMarketInput("AAA",true,buy,day1,BigDecimal("4"),BigDecimal("95"))
    val first=QualifiedTradeLifecycle.advance(emptyMap(),listOf(input),"r1",day1){true}
    check(first.events.isEmpty())
    check(first.states["AAA"]!!.status==QualifiedStatus.WATCHING)

    val day2=Instant.parse("2026-10-02T12:00:00Z")
    val second=QualifiedTradeLifecycle.advance(
        first.states,listOf(input.copy(marketAt=day2,price=BigDecimal("101"))),"r2",day2
    ){true}
    check(second.events.single().side==SignalSide.BUY)
    check(second.states["AAA"]!!.status==QualifiedStatus.BUY)

    val blocked=QualifiedTradeLifecycle.advance(
        second.states,
        listOf(input.copy(
            marketAt=day2.plusSeconds(1800),
            price=BigDecimal("130"),
            analysisEligible=false
        )),
        "r-blocked",
        day2.plusSeconds(1800)
    ){true}
    check(blocked.events.isEmpty())
    check(blocked.states["AAA"]==second.states["AAA"])

    val rise=QualifiedTradeLifecycle.advance(
        second.states,listOf(input.copy(marketAt=day2.plusSeconds(3600),price=BigDecimal("108"))),
        "r3",day2.plusSeconds(3600)
    ){true}
    check(rise.states["AAA"]!!.activeProfitLockPct!!.let{it>BigDecimal("4.9") && it<BigDecimal("5.0")})

    val fall=QualifiedTradeLifecycle.advance(
        rise.states,listOf(input.copy(marketAt=day2.plusSeconds(7200),price=BigDecimal("104"))),
        "r4",day2.plusSeconds(7200)
    ){true}
    check(fall.events.single().side==SignalSide.SELL)
    check(fall.states["AAA"]!!.exitReason=="KAR_KILIDI")

    val duplicate=QualifiedTradeLifecycle.advance(fall.states,listOf(input.copy(marketAt=day2,price=BigDecimal("104"))),"r4",day2){true}
    check(duplicate.events.isEmpty())

    fun watch(at:Instant,token:String="w"):QualifiedAdvanceResult =
        QualifiedTradeLifecycle.advance(
            emptyMap(),
            listOf(QualifiedMarketInput("RULE",true,BigDecimal("100"),at,BigDecimal("2"),BigDecimal("95"))),
            token,at
        ){d->d.dayOfWeek !in setOf(DayOfWeek.SATURDAY,DayOfWeek.SUNDAY)}

    // 10:00 Istanbul entry: not qualified at 13:59, qualified at 14:00.
    run {
        val firstAt=Instant.parse("2026-10-01T07:00:00Z")
        val first=watch(firstAt,"n1")
        val before=QualifiedTradeLifecycle.advance(
            first.states,
            listOf(QualifiedMarketInput("RULE",true,BigDecimal("101"),Instant.parse("2026-10-01T10:59:00Z"),BigDecimal("2"),BigDecimal("95"))),
            "n2",Instant.parse("2026-10-01T10:59:00Z")
        ){true}
        check(before.events.isEmpty())
        val atFour=QualifiedTradeLifecycle.advance(
            before.states,
            listOf(QualifiedMarketInput("RULE",true,BigDecimal("101"),Instant.parse("2026-10-01T11:00:00Z"),BigDecimal("2"),BigDecimal("95"))),
            "n3",Instant.parse("2026-10-01T11:00:00Z")
        ){true}
        check(atFour.events.single().side==SignalSide.BUY)
    }

    // Entry in the final two session hours: remaining in S/F through close qualifies.
    run {
        val firstAt=Instant.parse("2026-10-01T14:00:00Z") // 17:00 Istanbul
        val first=watch(firstAt,"l1")
        val beforeClose=QualifiedTradeLifecycle.advance(
            first.states,
            listOf(QualifiedMarketInput("RULE",true,BigDecimal("101"),Instant.parse("2026-10-01T14:59:00Z"),BigDecimal("2"),BigDecimal("95"))),
            "l2",Instant.parse("2026-10-01T14:59:00Z")
        ){true}
        check(beforeClose.events.isEmpty())
        val close=QualifiedTradeLifecycle.advance(
            beforeClose.states,
            listOf(QualifiedMarketInput("RULE",true,BigDecimal("101"),Instant.parse("2026-10-01T15:00:00Z"),BigDecimal("2"),BigDecimal("95"))),
            "l3",Instant.parse("2026-10-01T15:00:00Z")
        ){true}
        check(close.events.single().side==SignalSide.BUY)
    }

    // BIST half-day closes at 12:40 Istanbul; final-two-hour entitlement uses that close.
    run {
        val start=Instant.parse("2026-03-19T07:40:00Z") // 10:40 Istanbul
        val state=QualifiedTradeState(
            symbol="HALF",status=QualifiedStatus.WATCHING,
            firstSeenAt=start,firstMarketAt=start,entryRunToken="h0",
            processedRunTokens=setOf("h0"),observationCount=1
        )
        check(QualifiedTradeLifecycle.buyQualification(
            state,Instant.parse("2026-03-19T09:39:00Z"),{true},QualifiedTradePolicy(),{true}
        )==null)
        check(QualifiedTradeLifecycle.buyQualification(
            state,Instant.parse("2026-03-19T09:40:00Z"),{true},QualifiedTradePolicy(),{true}
        )=="SF_LAST_2H_THROUGH_CLOSE")
    }

    // After-session entry: next trading session requires two in-session hours.
    run {
        val firstAt=Instant.parse("2026-10-01T17:00:00Z") // 20:00 Istanbul
        val first=watch(firstAt,"o1")
        val before=QualifiedTradeLifecycle.advance(
            first.states,
            listOf(QualifiedMarketInput("RULE",true,BigDecimal("101"),Instant.parse("2026-10-02T08:59:00Z"),BigDecimal("2"),BigDecimal("95"))),
            "o2",Instant.parse("2026-10-02T08:59:00Z")
        ){true}
        check(before.events.isEmpty())
        val twoHours=QualifiedTradeLifecycle.advance(
            before.states,
            listOf(QualifiedMarketInput("RULE",true,BigDecimal("101"),Instant.parse("2026-10-02T09:00:00Z"),BigDecimal("2"),BigDecimal("95"))),
            "o3",Instant.parse("2026-10-02T09:00:00Z")
        ){true}
        check(twoHours.events.single().side==SignalSide.BUY)
    }

    // Leaving S/F before qualification resets the entitlement clock.
    run {
        val firstAt=Instant.parse("2026-10-01T07:00:00Z")
        val first=watch(firstAt,"r1")
        val left=QualifiedTradeLifecycle.advance(
            first.states,
            listOf(QualifiedMarketInput("RULE",false,BigDecimal("100"),Instant.parse("2026-10-01T08:00:00Z"),BigDecimal("2"),BigDecimal("95"))),
            "r2",Instant.parse("2026-10-01T08:00:00Z")
        ){true}
        check("RULE" !in left.states)
    }

    // offline catch-up may realize matured entitlement immediately on the first persisted run
    run {
        val now=Instant.parse("2026-10-01T12:00:00Z") // 15:00 Istanbul
        val matured=QualifiedTradeLifecycle.advance(
            emptyMap(),
            listOf(QualifiedMarketInput(
                symbol="CATCH",inSelection=true,price=BigDecimal("100"),marketAt=now,
                atr14=BigDecimal("2"),support10=BigDecimal("95"),
                entitlementSince=Instant.parse("2026-10-01T07:00:00Z") // 10:00 Istanbul
            )),
            "catch-1",now
        ){true}
        check(matured.events.single().side==SignalSide.BUY)
        check(matured.events.single().reason=="SF_CONTINUOUS_4H")
        check(matured.states.getValue("CATCH").status==QualifiedStatus.BUY)
    }

    // Historical reconstruction must not bridge across UNKNOWN/failed evidence.
    run {
        val points=listOf(
            SfEntitlementEvidencePoint("r3",Instant.parse("2026-10-01T11:00:00Z"),"f1",true,setOf("AAA")),
            SfEntitlementEvidencePoint("r2",Instant.parse("2026-10-01T10:00:00Z"),"f1",false,emptySet()),
            SfEntitlementEvidencePoint("r1",Instant.parse("2026-10-01T07:00:00Z"),"f1",true,setOf("AAA"))
        )
        check(SfEntitlementReconstruction.since("AAA","r3","f1",points)==Instant.parse("2026-10-01T11:00:00Z"))
        check(SfEntitlementReconstruction.reconstruct("AAA","r3","f1",points).failClosedReason=="FAILED_OR_INVALID_EVIDENCE")
    }

    // Failed current evidence cannot establish entitlement at all.
    run {
        val points=listOf(
            SfEntitlementEvidencePoint("bad",Instant.parse("2026-10-01T11:00:00Z"),"f1",false,setOf("AAA"))
        )
        val decision=SfEntitlementReconstruction.reconstruct("AAA","bad","f1",points)
        check(decision.since==null)
        check(decision.failClosedReason=="FAILED_OR_INVALID_EVIDENCE")

        val blocked=QualifiedTradeLifecycle.advance(
            emptyMap(),
            listOf(QualifiedMarketInput(
                symbol="BAD",inSelection=true,price=BigDecimal("100"),
                marketAt=Instant.parse("2026-10-01T11:00:00Z"),
                atr14=null,support10=null,analysisEligible=false
            )),
            "bad",Instant.parse("2026-10-01T11:00:00Z")
        ){true}
        check(blocked.events.isEmpty())
        check(blocked.states.isEmpty())

        val waiting=QualifiedTradeState(
            symbol="BAD2",status=QualifiedStatus.WATCHING,
            firstSeenAt=Instant.parse("2026-10-01T07:00:00Z"),
            firstMarketAt=Instant.parse("2026-10-01T07:00:00Z"),
            entryRunToken="old",processedRunTokens=setOf("old"),observationCount=1
        )
        val invalidated=QualifiedTradeLifecycle.advance(
            mapOf("BAD2" to waiting),
            listOf(QualifiedMarketInput(
                symbol="BAD2",inSelection=true,price=BigDecimal("100"),
                marketAt=Instant.parse("2026-10-01T11:00:00Z"),
                atr14=null,support10=null,analysisEligible=false
            )),
            "bad2",Instant.parse("2026-10-01T11:00:00Z")
        ){true}
        check("BAD2" !in invalidated.states)
    }

    // Two successful snapshots do not prove the unseen interval between them.
    run {
        val points=listOf(
            SfEntitlementEvidencePoint("g2",Instant.parse("2026-10-01T11:00:00Z"),"f1",true,setOf("AAA")),
            SfEntitlementEvidencePoint("g1",Instant.parse("2026-10-01T07:00:00Z"),"f1",true,setOf("AAA"))
        )
        val decision=SfEntitlementReconstruction.reconstruct("AAA","g2","f1",points)
        check(decision.since==Instant.parse("2026-10-01T11:00:00Z"))
        check(decision.failClosedReason=="UNVERIFIED_EVIDENCE_GAP")

        val old=QualifiedTradeState(
            symbol="GAP",status=QualifiedStatus.WATCHING,
            firstSeenAt=Instant.parse("2026-10-01T07:00:00Z"),
            firstMarketAt=Instant.parse("2026-10-01T07:00:00Z"),
            entryRunToken="g1",processedRunTokens=setOf("g1"),observationCount=1
        )
        val reset=QualifiedTradeLifecycle.advance(
            mapOf("GAP" to old),
            listOf(QualifiedMarketInput(
                symbol="GAP",inSelection=true,price=BigDecimal("100"),
                marketAt=Instant.parse("2026-10-01T11:00:00Z"),
                atr14=null,support10=null,
                entitlementSince=decision.since,
                entitlementFailClosedReason=decision.failClosedReason
            )),
            "g2",Instant.parse("2026-10-01T11:00:00Z")
        ){true}
        check(reset.events.isEmpty())
        check(reset.states.getValue("GAP").firstMarketAt==Instant.parse("2026-10-01T11:00:00Z"))
        check(reset.states.getValue("GAP").observationCount==1)
    }

    // Formula-version changes are also entitlement continuity boundaries.
    run {
        val points=listOf(
            SfEntitlementEvidencePoint("r2",Instant.parse("2026-10-01T11:00:00Z"),"f2",true,setOf("AAA")),
            SfEntitlementEvidencePoint("r1",Instant.parse("2026-10-01T07:00:00Z"),"f1",true,setOf("AAA"))
        )
        check(SfEntitlementReconstruction.since("AAA","r2","f2",points)==Instant.parse("2026-10-01T11:00:00Z"))
        check(SfEntitlementReconstruction.reconstruct("AAA","r2","f2",points).failClosedReason=="FORMULA_VERSION_BOUNDARY")
    }

    val customPolicy=QualifiedTradePolicy(
        sfContinuousMinutes=60,
        sfFinalWindowMinutes=30,
        sfPostOpenMinutes=30,
        maxStopLossPct=BigDecimal("2"),
        profitLockStartPct=BigDecimal("4"),
        profitLockInitialPullbackPct=BigDecimal("1"),
        profitLockStepStartPct=BigDecimal("10"),
        profitLockStepSizePct=BigDecimal("10"),
        profitLockStepPullbackPct=BigDecimal("3")
    )
    check(QualifiedTradeLifecycle.technicalStop(
        BigDecimal("100"),BigDecimal("20"),BigDecimal("80"),customPolicy
    ).first==BigDecimal("98.00"))
    check(QualifiedTradeLifecycle.profitLockDrawdownPct(BigDecimal("4"),customPolicy)==BigDecimal("1"))
    check(QualifiedTradeLifecycle.profitLockDrawdownPct(BigDecimal("20"),customPolicy)==BigDecimal("6"))

    run {
        val start=Instant.parse("2026-10-01T07:00:00Z")
        val state=QualifiedTradeState(
            symbol="CUSTOM",status=QualifiedStatus.WATCHING,
            firstSeenAt=start,firstMarketAt=start,entryRunToken="c0",
            processedRunTokens=setOf("c0"),observationCount=1
        )
        check(QualifiedTradeLifecycle.buyQualification(
            state,Instant.parse("2026-10-01T08:00:00Z"),{true},customPolicy
        )=="SF_CONTINUOUS_4H")
    }
    // User-configured risk policy must alter runtime thresholds without changing defaults.
    run {
        val p=QualifiedTradePolicy(
            maxStopLossPct=BigDecimal("5"),
            profitLockStartPct=BigDecimal("8"),
            profitLockInitialPullbackPct=BigDecimal("3"),
            profitLockStepStartPct=BigDecimal("20"),
            profitLockStepSizePct=BigDecimal("10"),
            profitLockStepPullbackPct=BigDecimal("2")
        )
        val stop=QualifiedTradeLifecycle.technicalStop(BigDecimal("100"),BigDecimal("20"),BigDecimal("80"),p)
        check(stop.first.compareTo(BigDecimal("95"))==0)
        check(stop.second.contains("MAX_LOSS_5PCT"))
        check(QualifiedTradeLifecycle.profitLockDrawdownPct(BigDecimal("7.99"),p)==null)
        check(QualifiedTradeLifecycle.profitLockDrawdownPct(BigDecimal("8"),p)==BigDecimal("3"))
    }

    // Two-session SELL evidence: a half-day counts as one session; missing evidence fails closed.
    run {
        val held=QualifiedTradeState(
            symbol="SESS",status=QualifiedStatus.BUY,
            firstSeenAt=Instant.parse("2026-03-18T07:00:00Z"),
            firstMarketAt=Instant.parse("2026-03-18T07:00:00Z"),
            entryRunToken="sess-buy",processedRunTokens=setOf("sess-buy"),observationCount=1,
            buyAt=Instant.parse("2026-03-18T12:00:00Z"),buyPrice=BigDecimal("100"),
            stopLossPrice=BigDecimal("97"),stopMethod="TEST",maxPrice=BigDecimal("102")
        )
        fun sellInput(sessions:Int, priceComplete:Boolean, volumeComplete:Boolean)=QualifiedMarketInput(
            symbol="SESS",inSelection=false,price=BigDecimal("102"),
            marketAt=Instant.parse("2026-03-23T10:00:00Z"),atr14=null,support10=null,
            completedFullSessionsSinceBuy=sessions,maxReturnSinceBuyPct=BigDecimal("2"),
            maxVolumeIncreasePctSinceBuy=if(volumeComplete) BigDecimal("40") else null,
            pricePerformanceEvidenceComplete=priceComplete,
            volumePerformanceEvidenceComplete=volumeComplete
        )
        val one=QualifiedTradeLifecycle.advance(
            mapOf("SESS" to held),listOf(sellInput(1,true,true)),
            "sess-1",Instant.parse("2026-03-23T10:00:00Z")
        ){true}
        check(one.events.isEmpty())
        val missing=QualifiedTradeLifecycle.advance(
            mapOf("SESS" to held),listOf(sellInput(2,false,false)),
            "sess-missing",Instant.parse("2026-03-23T10:00:00Z")
        ){true}
        check(missing.events.isEmpty())
        val two=QualifiedTradeLifecycle.advance(
            mapOf("SESS" to held),listOf(sellInput(2,true,false)),
            "sess-2",Instant.parse("2026-03-23T10:00:00Z")
        ){true}
        check(two.events.single().reason=="SF_DISI_2_TAM_SEANS_PERFORMANS")
    }

}
