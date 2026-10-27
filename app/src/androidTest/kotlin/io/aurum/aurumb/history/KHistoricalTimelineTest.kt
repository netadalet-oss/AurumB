package io.aurum.aurumb.history

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.aurum.aurumb.persistence.AurumDatabase
import io.aurum.aurumb.persistence.MarketBarEntity
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class KHistoricalTimelineTest {
    @Test
    fun liveT0RollsToT1AgainstNextDayReelTop()=runBlocking {
        val context=ApplicationProvider.getApplicationContext<Context>()
        val db=Room.inMemoryDatabaseBuilder(context,AurumDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        try {
            val dao=db.aurumDao()
            dao.putMarketBars(listOf(
                bar("AAA","2026-10-01T18:00:00Z","100"),
                bar("BBB","2026-10-01T18:00:00Z","100"),
                bar("AAA","2026-10-02T18:00:00Z","110"),
                bar("BBB","2026-10-02T18:00:00Z","105")
            ))
            val service=KHistoricalService(dao){java.time.Instant.parse("2026-10-02T18:05:00Z")}
            service.mirrorKn(payload("run-d",listOf("AAA","BBB")),"2026-10-02T18:04:00Z")

            val t0=service.latestTrend()
            assertNotNull(t0)
            assertEquals("T0",t0!!.rows.single().label)
            assertEquals("2026-10-02",t0.rows.single().knSourceDate)
            assertEquals("2026-10-02",t0.rows.single().reelSourceDate)
            assertEquals("2026-10-02T18:00:00Z",t0.rows.single().reelTimestampUtc)
            assertEquals(listOf("AAA","BBB"),t0.rows.single().reelTop.map{it.first})

            dao.putMarketBars(listOf(
                bar("BBB","2026-10-03T18:00:00Z","120")
            ))
            service.refreshFromData()
            val partial=requireNotNull(service.latestTrend())
            assertEquals(listOf("T0","T1"),partial.rows.map{it.label})
            assertEquals("2026-10-03",partial.rows[0].knSourceDate)
            assertEquals(true,partial.rows[0].knRunId.startsWith("PENDING:"))
            assertEquals(true,partial.rows[0].knTop.getValue("K1").isEmpty())
            assertEquals("2026-10-02",partial.rows[1].knSourceDate)
            assertEquals(1,partial.rows[0].reelTop.size)
            assertEquals(1,partial.rows[1].reelTop.size)
            assertEquals(partial.rows[0].reelTop,partial.rows[1].reelTop)
            assertEquals(true,partial.entries.isEmpty())

            dao.putMarketBars(listOf(
                bar("AAA","2026-10-03T18:00:00Z","111")
            ))
            service.refreshFromData()
            service.mirrorKn(payload("run-d1",listOf("BBB","AAA")),"2026-10-03T18:04:00Z")

            val timeline=requireNotNull(service.latestTrend())
            assertEquals(listOf("T0","T1"),timeline.rows.map{it.label})
            val live=timeline.rows[0]
            val archived=timeline.rows[1]
            assertEquals("2026-10-03",live.knSourceDate)
            assertEquals("2026-10-03",live.reelSourceDate)
            assertEquals("2026-10-02",archived.knSourceDate)
            assertEquals("2026-10-03",archived.reelSourceDate)
            assertEquals("2026-10-03T18:00:00Z",archived.reelTimestampUtc)
            assertEquals(listOf("BBB","AAA"),archived.reelTop.map{it.first})
            assertEquals(listOf("AAA","BBB"),archived.knTop.getValue("K1"))
            assertEquals(2 to 2,archived.hits.getValue("K1"))
            assertEquals(null,archived.hits["K8"])
            assertEquals(listOf("AAA","BBB"),archived.knTop.getValue("K8"))
            assertEquals(true,archived.frozen)

            // A further next-day entitlement must cascade the former T0 into T1
            // and the former T1 into T2 without rewriting their source dates.
            dao.putMarketBars(listOf(
                bar("AAA","2026-10-04T18:00:00Z","112"),
                bar("BBB","2026-10-04T18:00:00Z","121")
            ))
            service.refreshFromData()
            val cascaded=requireNotNull(service.latestTrend())
            assertEquals(listOf("T0","T1","T2"),cascaded.rows.map{it.label})
            assertEquals("2026-10-04",cascaded.rows[0].knSourceDate)
            assertEquals("2026-10-03",cascaded.rows[1].knSourceDate)
            assertEquals("2026-10-04",cascaded.rows[1].reelSourceDate)
            assertEquals("2026-10-02",cascaded.rows[2].knSourceDate)
            assertEquals("2026-10-03",cascaded.rows[2].reelSourceDate)
            assertEquals("2026-10-03T18:00:00Z",cascaded.rows[2].reelTimestampUtc)
        } finally {
            db.close()
        }
    }

    private fun bar(symbol:String,at:String,close:String)=MarketBarEntity(
        symbol=symbol,
        atUtc=at,
        provider="TEST",
        openDecimal=close,
        highDecimal=close,
        lowDecimal=close,
        closeDecimal=close,
        adjustedCloseDecimal=close,
        volumeDecimal="1000",
        currency="TRY",
        requestedAtUtc=at,
        receivedAtUtc=at.replace("18:00:00Z","18:01:00Z"),
        quality="OK",
        freshness="FRESH",
        rawSourceFingerprint=symbol+"|"+at
    )

    private fun payload(runId:String,ordered:List<String>):String {
        val rows=JSONArray()
        ordered.forEachIndexed { index,symbol ->
            rows.put(JSONObject()
                .put("symbol",symbol)
                .put("contributionsJson",JSONArray()
                    .put(JSONObject().put("criterion","K1").put("criterionRank",index+1))
                    .put(JSONObject().put("criterion","K8").put("criterionRank",index+1))
                    .toString()))
        }
        return JSONObject()
            .put("topN",2)
            .put("run",JSONObject()
                .put("id",runId)
                .put("asOfUtc","2026-10-02T18:00:00Z"))
            .put("selectionRows",rows)
            .toString()
    }
}
