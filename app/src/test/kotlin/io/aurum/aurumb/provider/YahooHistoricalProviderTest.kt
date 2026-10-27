package io.aurum.aurumb.provider

import io.aurum.common.provider.BarProviderResult
import okhttp3.OkHttpClient
import org.junit.Assert.*
import org.junit.Test
import java.math.BigDecimal
import java.time.Instant

class YahooHistoricalProviderTest {
    private val requested=Instant.parse("2026-10-01T11:50:00Z")
    private val received=Instant.parse("2026-10-01T12:00:00Z")

    @Test
    fun extractsCurrentObservationFromSameChartPayload() {
        val t1=Instant.parse("2026-09-30T07:00:00Z").epochSecond
        val t2=Instant.parse("2026-10-01T07:00:00Z").epochSecond
        val current=Instant.parse("2026-10-01T11:59:00Z").epochSecond
        val json="""
        {
          "chart":{"result":[{
            "meta":{"currency":"TRY","regularMarketPrice":121.0,"regularMarketTime":$current},
            "timestamp":[$t1,$t2],
            "indicators":{
              "quote":[{
                "open":[100.0,119.0],
                "high":[102.0,122.0],
                "low":[99.0,118.0],
                "close":[100.0,121.0],
                "volume":[1000,2000]
              }],
              "adjclose":[{"adjclose":[100.0,121.0]}]
            }
          }],"error":null}
        }
        """.trimIndent().toByteArray()

        val provider=YahooHistoricalProvider(OkHttpClient()){received}
        val result=provider.parse("AAA.IS",json,requested,received)
        assertTrue(result is BarProviderResult.Success)
        result as BarProviderResult.Success
        assertEquals(2,result.bars.size)
        val observation=requireNotNull(result.latestObservation)
        assertEquals("AAA.IS",observation.symbol)
        assertEquals(0,observation.value!!.compareTo(BigDecimal("121.0")))
        assertEquals(Instant.parse("2026-10-01T11:59:00Z"),observation.provenance.marketTimestamp)
        assertEquals("YAHOO_CHART",observation.provenance.provider)
        assertEquals("yahoo-chart-v2",observation.provenance.transformVersion)
    }

    @Test
    fun rejectsFutureCurrentTimestampButKeepsHistoricalBars() {
        val t1=Instant.parse("2026-09-30T07:00:00Z").epochSecond
        val t2=Instant.parse("2026-10-01T07:00:00Z").epochSecond
        val future=Instant.parse("2026-10-01T12:10:01Z").epochSecond
        val json="""
        {
          "chart":{"result":[{
            "meta":{"currency":"TRY","regularMarketPrice":121.0,"regularMarketTime":$future},
            "timestamp":[$t1,$t2],
            "indicators":{
              "quote":[{
                "open":[100.0,119.0],
                "high":[102.0,122.0],
                "low":[99.0,118.0],
                "close":[100.0,121.0],
                "volume":[1000,2000]
              }],
              "adjclose":[{"adjclose":[100.0,121.0]}]
            }
          }],"error":null}
        }
        """.trimIndent().toByteArray()

        val provider=YahooHistoricalProvider(OkHttpClient()){received}
        val result=provider.parse("AAA.IS",json,requested,received) as BarProviderResult.Success
        assertEquals(2,result.bars.size)
        assertNull(result.latestObservation)
    }
}
