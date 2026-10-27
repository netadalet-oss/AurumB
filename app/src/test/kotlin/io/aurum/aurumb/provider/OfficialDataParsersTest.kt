package io.aurum.aurumb.provider

import org.junit.Assert.*
import org.junit.Test
import java.math.BigDecimal

class OfficialDataParsersTest {
    @Test
    fun parsesTcmbSellingRates() {
        val xml="""<?xml version="1.0" encoding="UTF-8"?>
            <Tarih_Date Tarih="01.10.2026" Date="10/01/2026">
              <Currency CurrencyCode="USD">
                <ForexBuying>41.1000</ForexBuying>
                <ForexSelling>41.2000</ForexSelling>
              </Currency>
              <Currency CurrencyCode="EUR">
                <ForexBuying>48.1000</ForexBuying>
                <ForexSelling>48.3000</ForexSelling>
              </Currency>
            </Tarih_Date>
        """.trimIndent().toByteArray()

        val parsed=OfficialDataParsers.parseTcmbDailyFx(xml)
        assertEquals("01.10.2026",parsed.sourceDate)
        assertEquals(BigDecimal("41.2000"),parsed.sellingRates["USD"])
        assertEquals(BigDecimal("48.3000"),parsed.sellingRates["EUR"])
    }

    @Test
    fun rejectsTcmbDoctype() {
        val xml="""<?xml version="1.0"?>
            <!DOCTYPE x [ <!ENTITY e SYSTEM "file:///etc/passwd"> ]>
            <Tarih_Date Tarih="01.10.2026">
              <Currency CurrencyCode="USD"><ForexSelling>&e;</ForexSelling></Currency>
            </Tarih_Date>
        """.trimIndent().toByteArray()
        assertThrows(Exception::class.java) {
            OfficialDataParsers.parseTcmbDailyFx(xml)
        }
    }

    @Test
    fun parsesSingleEcbObservation() {
        val json="""
        {
          "dataSets":[{"series":{"0:0:0":{"observations":{"0":[2.4]}}}}],
          "structure":{
            "dimensions":{
              "observation":[
                {"id":"TIME_PERIOD","values":[{"id":"2026-06-17"}]}
              ]
            }
          }
        }
        """.trimIndent().toByteArray()
        val parsed=OfficialDataParsers.parseEcbSingleObservation(json)
        assertEquals("2026-06-17",parsed.period)
        assertEquals(BigDecimal.valueOf(2.4),parsed.value)
    }

    @Test
    fun rejectsEcbPayloadWithoutObservation() {
        val json="""
        {
          "dataSets":[{"series":{"0:0:0":{"observations":{}}}}],
          "structure":{"dimensions":{"observation":[{"id":"TIME_PERIOD","values":[]}]}}
        }
        """.trimIndent().toByteArray()
        assertThrows(IllegalArgumentException::class.java) {
            OfficialDataParsers.parseEcbSingleObservation(json)
        }
    }
}
