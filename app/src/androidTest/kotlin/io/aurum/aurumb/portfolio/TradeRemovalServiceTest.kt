package io.aurum.aurumb.portfolio

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.aurum.aurumb.persistence.*
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.math.BigDecimal
import java.time.Instant

@RunWith(AndroidJUnit4::class)
class TradeRemovalServiceTest {
    private lateinit var db:AurumDatabase
    private lateinit var dao:AurumDao

    @Before fun setUp() {
        db=Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext<Context>(),AurumDatabase::class.java
        ).allowMainThreadQueries().build()
        dao=db.aurumDao()
    }
    @After fun tearDown(){ db.close() }

    private suspend fun signal(id:String,symbol:String,at:String)=dao.appendSignal(SignalEntity(
        id=id,instrument=symbol,signal="BUY",signalTimeUtc=at,effectiveEntryTimeUtc=at,
        entryBasis="100",reasonsJson="[]",contributionsJson="[]",confidenceDecimal="0.8",
        marketRegime="TEST",dataFreshness="LIVE",invalidationCondition="test",
        targetHorizon="SHORT_TERM",appVersion="test",modelVersion="m",formulaVersion="f",
        dataSchemaVersion="15"
    ))

    @Test fun removalTombstonesSignalAndReplaysRemainingPortfolio()=runBlocking {
        val t1="2026-10-01T10:00:00Z"; val t2="2026-10-01T11:00:00Z"
        signal("sig-a","AAA",t1); signal("sig-b","BBB",t2)
        dao.putPortfolioState(PortfolioStateEntity(
            startingCapitalDecimal="10000",cashDecimal="8000",realizedPnlDecimal="0",
            defaultPositionDecimal="1000",createdAtUtc=t1,resetAtUtc=t1,lastUpdatedAtUtc=t2
        ))
        dao.insertPortfolioPositions(listOf(
            PortfolioPositionEntity("AAA","10","1000","100",t1,"110",t2,"1000","sig-a"),
            PortfolioPositionEntity("BBB","10","1000","100",t2,"120",t2,"1000","sig-b")
        ))
        dao.insertPortfolioTransactions(listOf(
            PortfolioTransactionEntity("tx-a","key-a",t1,"BUY","AAA","10","100","1000","0","-1000",null,"TEST","sig-a"),
            PortfolioTransactionEntity("tx-b","key-b",t2,"BUY","BBB","10","100","1000","0","-1000",null,"TEST","sig-b")
        ))
        dao.putQualifiedTradeStates(listOf(QualifiedTradeStateEntity(
            symbol="AAA",status="BUY",firstSeenAtUtc=t1,firstMarketAtUtc=t1,entryRunToken="r",
            processedRunTokensJson="[\"r\"]",observationCount=2,buyAtUtc=t1,buyPriceDecimal="100",
            stopLossPriceDecimal="95",stopMethod="TEST",maxPriceDecimal="110",
            activeProfitLockPctDecimal=null,sellAtUtc=null,sellPriceDecimal=null,exitReason=null,
            aboveEntrySeen=true,leftSelection=false
        )))
        val removed=TradeRemovalService(dao){Instant.parse("2026-10-02T10:00:00Z")}.removeInstrument("AAA")
        assertEquals(1,removed)
        assertNull(dao.signalById("sig-a"))
        assertNotNull(dao.signalById("sig-b"))
        assertNotNull(dao.tradeRemovalTombstone("sig-a"))
        assertNull(dao.tradeRemovalTombstone("sig-b"))
        assertEquals(listOf("BBB"),dao.portfolioPositions().map{it.symbol})
        assertEquals(listOf("BBB"),dao.portfolioTransactions().map{it.symbol})
        assertEquals("9000",dao.portfolioState()!!.cashDecimal)
        assertTrue(dao.qualifiedTradeStates().none{it.symbol=="AAA"})
        val snap=dao.latestPortfolioSnapshot()!!
        assertEquals(0,BigDecimal("10200").compareTo(snap.equityDecimal.toBigDecimal()))
        assertEquals(0,BigDecimal("200").compareTo(snap.unrealizedPnlDecimal.toBigDecimal()))
        assertEquals(0,BigDecimal("120").compareTo(dao.portfolioPositions().single().lastPriceDecimal.toBigDecimal()))
        val auditCount=dao.recentAudit(100).count{it.code=="TRADE_REMOVED_AS_NEVER_TRADED"}
        assertEquals(0,TradeRemovalService(dao){Instant.parse("2026-10-03T10:00:00Z")}.removeInstrument("AAA"))
        assertEquals(auditCount,dao.recentAudit(100).count{it.code=="TRADE_REMOVED_AS_NEVER_TRADED"})
    }
}
