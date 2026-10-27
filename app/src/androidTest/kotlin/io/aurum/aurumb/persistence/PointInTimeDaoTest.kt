package io.aurum.aurumb.persistence

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PointInTimeDaoTest {
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
    fun marketBarsExcludeDataReceivedAfterAsOf()=runBlocking {
        dao.putMarketBars(listOf(
            MarketBarEntity(
                symbol="AAA",atUtc="2026-01-01T00:00:00Z",provider="P",
                openDecimal="10",highDecimal="11",lowDecimal="9",closeDecimal="10",
                adjustedCloseDecimal="10",volumeDecimal="100",currency="TRY",
                requestedAtUtc="2026-01-01T12:00:00Z",receivedAtUtc="2026-01-01T12:01:00Z",
                quality="VALID",freshness="LIVE",rawSourceFingerprint="fp1"
            ),
            MarketBarEntity(
                symbol="AAA",atUtc="2026-01-02T00:00:00Z",provider="P",
                openDecimal="11",highDecimal="12",lowDecimal="10",closeDecimal="11",
                adjustedCloseDecimal="11",volumeDecimal="110",currency="TRY",
                requestedAtUtc="2026-01-05T12:00:00Z",receivedAtUtc="2026-01-05T12:01:00Z",
                quality="VALID",freshness="LIVE",rawSourceFingerprint="fp2"
            )
        ))
        val visible=dao.marketBars("AAA","2026-01-03T00:00:00Z")
        assertEquals(1,visible.size)
        assertEquals("2026-01-01T00:00:00Z",visible.single().atUtc)
    }


    @Test
    fun latestObservationRespectsAsOfReceiptTime()=runBlocking {
        dao.insertObservation(
            MarketObservationEntity(
                id="o1",symbol="AAA",provider="P",
                requestedAtUtc="2026-01-01T09:00:00Z",
                receivedAtUtc="2026-01-01T09:01:00Z",
                marketTimestampUtc="2026-01-01T09:00:30Z",
                valueDecimal="120",currency="TRY",quality="VALID",freshness="LIVE",
                rawSourceFingerprint="fp1",transformVersion="v1"
            )
        )
        dao.insertObservation(
            MarketObservationEntity(
                id="o2",symbol="AAA",provider="P",
                requestedAtUtc="2026-01-01T11:00:00Z",
                receivedAtUtc="2026-01-01T11:01:00Z",
                marketTimestampUtc="2026-01-01T11:00:30Z",
                valueDecimal="125",currency="TRY",quality="VALID",freshness="LIVE",
                rawSourceFingerprint="fp2",transformVersion="v1"
            )
        )

        val visible=dao.latestObservation("AAA","2026-01-01T10:00:00Z")
        assertEquals("o1",visible?.id)
        assertEquals("120",visible?.valueDecimal)
    }

    @Test
    fun latestObservationExcludesFutureMarketTimeAndIncludesExactBoundary()=runBlocking {
        dao.insertObservation(
            MarketObservationEntity(
                id="known",symbol="AAA",provider="P",
                requestedAtUtc="2026-01-01T09:00:00Z",
                receivedAtUtc="2026-01-01T09:01:00Z",
                marketTimestampUtc="2026-01-01T09:00:30Z",
                valueDecimal="120",currency="TRY",quality="VALID",freshness="LIVE",
                rawSourceFingerprint="known",transformVersion="v1"
            )
        )
        dao.insertObservation(
            MarketObservationEntity(
                id="future",symbol="AAA",provider="P",
                requestedAtUtc="2026-01-01T09:02:00Z",
                receivedAtUtc="2026-01-01T09:03:00Z",
                marketTimestampUtc="2026-01-01T11:00:00Z",
                valueDecimal="999",currency="TRY",quality="VALID",freshness="LIVE",
                rawSourceFingerprint="future",transformVersion="v1"
            )
        )
        assertEquals("known",dao.latestObservation("AAA","2026-01-01T10:00:00Z")?.id)
        assertEquals("future",dao.latestObservation("AAA","2026-01-01T11:00:00Z")?.id)
    }

    @Test
    fun observationReceiptAndOrderingPreserveSubsecondPrecision()=runBlocking {
        fun observation(id:String,symbol:String,received:String,market:String)=MarketObservationEntity(
            id=id,symbol=symbol,provider="P",
            requestedAtUtc="2026-01-01T09:00:00Z",receivedAtUtc=received,
            marketTimestampUtc=market,valueDecimal="120",currency="TRY",
            quality="VALID",freshness="LIVE",rawSourceFingerprint=id,transformVersion="v1"
        )
        dao.insertObservation(observation("fractional-receipt","AAA",
            "2026-01-01T09:01:00.500Z","2026-01-01T09:00:00Z"))
        assertEquals(null,dao.latestObservation("AAA","2026-01-01T09:01:00Z"))
        assertEquals("fractional-receipt",dao.latestObservation("AAA","2026-01-01T09:01:00.500Z")?.id)
        dao.insertObservation(observation("whole-receipt","BBB",
            "2026-01-01T09:01:00Z","2026-01-01T09:00:00Z"))
        assertEquals("whole-receipt",dao.latestObservation("BBB","2026-01-01T09:01:00.500Z")?.id)
        dao.insertObservation(observation("later-market","BBB",
            "2026-01-01T09:01:00Z","2026-01-01T09:00:00.500Z"))
        assertEquals("later-market",dao.latestObservation("BBB","2026-01-01T10:00:00Z")?.id)
    }

    @Test
    fun marketBarsPreserveSubsecondReceiptAndMarketBoundaries()=runBlocking {
        fun bar(symbol:String,market:String,received:String)=MarketBarEntity(
            symbol=symbol,atUtc=market,provider="P",
            openDecimal="10",highDecimal="11",lowDecimal="9",closeDecimal="10",
            adjustedCloseDecimal="10",volumeDecimal="100",currency="TRY",
            requestedAtUtc="2026-01-01T09:00:00Z",receivedAtUtc=received,
            quality="VALID",freshness="LIVE",rawSourceFingerprint=symbol
        )
        dao.putMarketBars(listOf(
            bar("RECEIPT","2026-01-01T09:00:00Z","2026-01-01T09:01:00.500Z"),
            bar("MARKET","2026-01-01T09:01:00.500Z","2026-01-01T09:00:00Z"),
            bar("WHOLE","2026-01-01T09:01:00Z","2026-01-01T09:00:00Z")
        ))
        val before="2026-01-01T09:01:00Z"
        val exact="2026-01-01T09:01:00.500Z"
        assertEquals(0,dao.marketBars("RECEIPT",before).size)
        assertEquals(0,dao.marketBars("MARKET",before).size)
        assertEquals(1,dao.marketBars("RECEIPT",exact).size)
        assertEquals(1,dao.marketBars("MARKET",exact).size)
        assertEquals(1,dao.marketBars("WHOLE",exact).size)
    }

    @Test
    fun newsQueryExcludesFuturePublication()=runBlocking {
        dao.insertNewsItems(listOf(
            NewsItemEntity("n1","NL","past","https://example.com/1",null,
                "2026-01-01T10:00:00Z","2026-01-01T10:01:00Z","P","fp1"),
            NewsItemEntity("n2","NL","future","https://example.com/2",null,
                "2026-01-04T10:00:00Z","2026-01-04T10:01:00Z","P","fp2")
        ))
        val visible=dao.newsAsOf("NL","2026-01-03T00:00:00Z",20)
        assertEquals(listOf("n1"),visible.map{it.id})
    }

    @Test
    fun newsUsesPublicationAndReceiptCutoffsWithSubsecondOrdering()=runBlocking {
        fun news(id:String,published:String,received:String)=NewsItemEntity(
            id,"NL",id,"https://example.com/"+id,null,published,received,"P",id
        )
        dao.insertNewsItems(listOf(
            news("known","2026-01-01T10:00:00Z","2026-01-01T10:01:00Z"),
            news("late-receipt","2026-01-01T09:00:00Z","2026-01-01T12:00:00Z"),
            news("fractional-publication","2026-01-01T10:30:00.500Z","2026-01-01T10:20:00Z"),
            news("fractional-receipt","2026-01-01T10:10:00Z","2026-01-01T10:30:00.500Z")
        ))
        assertEquals(listOf("known"),dao.newsAsOf("NL","2026-01-01T10:30:00Z",20).map{it.id})
        assertEquals(listOf("fractional-publication","fractional-receipt","known"),
            dao.newsAsOf("NL","2026-01-01T10:30:00.500Z",20).map{it.id})
        assertEquals(listOf("fractional-publication","fractional-receipt","known","late-receipt"),
            dao.newsAsOf("NL","2026-01-01T12:00:00Z",20).map{it.id})
    }

    @Test
    fun outcomeEvidenceUsesNanosecondCutoffAndChronologicalOrdering()=runBlocking {
        fun outcome(id:String,evaluated:String,eligible:Boolean=true)=SelectionOutcomeEntity(
            id=id,runId=id,symbol="AAA",decisionAtUtc="2026-01-01T08:00:00Z",
            evaluatedAtUtc=evaluated,entryAtUtc="2026-01-01T08:00:00Z",
            entryPriceDecimal="100",exitAtUtc="2026-01-01T09:00:00Z",
            exitCloseDecimal="101",maxHighDecimal="101",grossReturnDecimal="1",
            netReturnDecimal="1",targetReturnPctDecimal="1",targetHit=true,
            decisionScoreDecimal="80",regime="TEST",decisionWindow="TEST",
            modelVersion="test",formulaVersion="test",eligibleForLearning=eligible,
            ineligibilityReason=if(eligible)null else "TEST_INELIGIBLE"
        )
        dao.appendSelectionOutcome(outcome("whole","2026-01-01T10:00:00Z"))
        dao.appendSelectionOutcome(outcome("fractional","2026-01-01T10:00:00.500Z"))
        dao.appendSelectionOutcome(outcome("nano","2026-01-01T10:00:00.500000001Z"))
        dao.appendSelectionOutcome(outcome("ineligible","2026-01-01T09:00:00Z",false))
        assertEquals(listOf("whole"),dao.eligibleSelectionOutcomesAsOf("2026-01-01T10:00:00Z").map{it.id})
        assertEquals(listOf("whole","fractional"),
            dao.eligibleSelectionOutcomesAsOf("2026-01-01T10:00:00.5Z").map{it.id})
        assertEquals(listOf("whole","fractional","nano"),
            dao.eligibleSelectionOutcomesAsOf("2026-01-01T10:00:00.500000001Z").map{it.id})
    }
}
