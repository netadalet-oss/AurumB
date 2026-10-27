package io.aurum.aurumb.provider

import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.math.BigDecimal
import javax.xml.parsers.DocumentBuilderFactory

data class ParsedTcmbFx(
    val sourceDate:String,
    val sellingRates:Map<String,BigDecimal>
)

data class ParsedEcbObservation(
    val period:String,
    val value:BigDecimal
)

object OfficialDataParsers {
    fun parseTcmbDailyFx(bytes:ByteArray):ParsedTcmbFx {
        val factory=DocumentBuilderFactory.newInstance().apply {
            isNamespaceAware=false
            setFeature("http://apache.org/xml/features/disallow-doctype-decl",true)
            setFeature("http://xml.org/sax/features/external-general-entities",false)
            setFeature("http://xml.org/sax/features/external-parameter-entities",false)
            isXIncludeAware=false
            isExpandEntityReferences=false
        }
        val doc=factory.newDocumentBuilder().parse(ByteArrayInputStream(bytes))
        val root=doc.documentElement
        val sourceDate=root.getAttribute("Tarih").takeIf{it.isNotBlank()}
            ?: error("MISSING_SOURCE_DATE")
        val rates=linkedMapOf<String,BigDecimal>()
        val nodes=doc.getElementsByTagName("Currency")
        for(i in 0 until nodes.length) {
            val node=nodes.item(i)
            val code=node.attributes?.getNamedItem("CurrencyCode")?.nodeValue ?: continue
            val children=node.childNodes
            for(j in 0 until children.length) {
                val child=children.item(j)
                if(child.nodeName=="ForexSelling") {
                    child.textContent?.trim()?.toBigDecimalOrNull()?.let { rate ->
                        if(rate>BigDecimal.ZERO) rates[code]=rate
                    }
                    break
                }
            }
        }
        return ParsedTcmbFx(sourceDate,rates.toMap())
    }

    fun parseEcbSingleObservation(bytes:ByteArray):ParsedEcbObservation {
        val root=JSONObject(String(bytes,Charsets.UTF_8))
        val dataSets=root.getJSONArray("dataSets")
        require(dataSets.length()>0) { "NO_DATASET" }
        val series=dataSets.getJSONObject(0).getJSONObject("series")
        require(series.length()>0) { "NO_SERIES" }
        val firstSeriesKey=series.keys().next()
        val observations=series.getJSONObject(firstSeriesKey).getJSONObject("observations")
        require(observations.length()>0) { "NO_OBSERVATION" }

        val obsKey=observations.keys().asSequence()
            .mapNotNull{it.toIntOrNull()}
            .maxOrNull() ?: error("INVALID_OBSERVATION_KEY")
        val value=observations.getJSONArray(obsKey.toString()).optDouble(0,Double.NaN)
        require(value.isFinite()) { "INVALID_VALUE" }

        val observationDimensions=root.getJSONObject("structure")
            .getJSONObject("dimensions")
            .getJSONArray("observation")
        val timeDimension=(0 until observationDimensions.length())
            .map{observationDimensions.getJSONObject(it)}
            .firstOrNull{it.optString("id").equals("TIME_PERIOD",ignoreCase=true)}
            ?: error("TIME_DIMENSION_MISSING")
        val values=timeDimension.getJSONArray("values")
        require(obsKey<values.length()) { "TIME_INDEX_OUT_OF_RANGE" }
        val period=values.getJSONObject(obsKey).optString("id")
        require(period.isNotBlank()) { "TIME_PERIOD_MISSING" }

        return ParsedEcbObservation(period,BigDecimal.valueOf(value))
    }
}
