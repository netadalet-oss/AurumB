package io.aurum.aurumb.portfolio

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.aurum.aurumb.persistence.*
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PortfolioIntegrityServiceTest {
    private lateinit var db:AurumDatabase
    private lateinit var dao:AurumDao

    @Before
    fun setUp() {
        val context=ApplicationProvider.getApplicationContext<Context>()
        db=Room.inMemoryDatabaseBuilder(context,AurumDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao=db.aurumDao()
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun validOpenPositionMustTraceToPersistedBuySignalAndActiveBuyState()=runBlocking {
        val at="2026-10-02T10:00:00Z"
        dao.appendSignal(SignalEntity(
            id="sig-buy",instrument="AAA",signal="BUY",signalTimeUtc=at,
            effectiveEntryTimeUtc=at,entryBasis="100",reasonsJson="[]",contributionsJson="[]",
            confidenceDecimal="0.8",marketRegime="TEST",dataFreshness="LIVE",
            invalidationCondition="test",targetHorizon="SHORT_TERM",
            appVersion="test",modelVersion="test",formulaVersion="test",dataSchemaVersion="15"
        ))
        dao.putQualifiedTradeStates(listOf(QualifiedTradeStateEntity(
            symbol="AAA",status="BUY",firstSeenAtUtc=at,firstMarketAtUtc=at,
            entryRunToken="run-1",processedRunTokensJson="[\"run-1\"]",observationCount=2,
            buyAtUtc=at,buyPriceDecimal="100",stopLossPriceDecimal="95",stopMethod="TEST",
            maxPriceDecimal="102",activeProfitLockPctDecimal=null,sellAtUtc=null,
            sellPriceDecimal=null,exitReason=null,aboveEntrySeen=true,leftSelection=false
        )))
        dao.putPortfolioState(PortfolioStateEntity(
            startingCapitalDecimal="100000",cashDecimal="95000",realizedPnlDecimal="0",
            defaultPositionDecimal="5000",createdAtUtc=at,resetAtUtc=at,lastUpdatedAtUtc=at
        ))
        dao.insertPortfolioPosition(PortfolioPositionEntity(
            symbol="AAA",quantityDecimal="50",costDecimal="5000",entryPriceDecimal="100",
            entryAtUtc=at,lastPriceDecimal="102",lastMarkedAtUtc=at,
            targetCostDecimal="5000",sourceSignalId="sig-buy"
        ))
        dao.appendPortfolioTransaction(PortfolioTransactionEntity(
            id="tx-buy",idempotencyKey="buy-key",atUtc=at,type="BUY",symbol="AAA",
            quantityDecimal="50",priceDecimal="100",grossAmountDecimal="5000",feeDecimal="0",
            cashDeltaDecimal="-5000",realizedPnlDecimal=null,reason="TEST",sourceSignalId="sig-buy"
        ))

        assertTrue(PortfolioIntegrityService(dao).inspect().valid)
    }

    @Test
    fun orphanPositionFailsClosed()=runBlocking {
        val at="2026-10-02T10:00:00Z"
        dao.putPortfolioState(PortfolioStateEntity(
            startingCapitalDecimal="100000",cashDecimal="95000",realizedPnlDecimal="0",
            defaultPositionDecimal="5000",createdAtUtc=at,resetAtUtc=at,lastUpdatedAtUtc=at
        ))
        dao.insertPortfolioPosition(PortfolioPositionEntity(
            symbol="AAA",quantityDecimal="50",costDecimal="5000",entryPriceDecimal="100",
            entryAtUtc=at,lastPriceDecimal="102",lastMarkedAtUtc=at,
            targetCostDecimal="5000",sourceSignalId="missing"
        ))

        val report=PortfolioIntegrityService(dao).inspect()
        assertFalse(report.valid)
        assertTrue(report.reasons.any{it.startsWith("POSITION_SOURCE_SIGNAL_MISMATCH:AAA")})
        assertTrue(report.reasons.any{it.startsWith("POSITION_WITHOUT_ACTIVE_BUY_STATE:AAA")})
    }
}
