package io.aurum.aurumb.provider

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.math.BigDecimal
import java.security.MessageDigest
import java.time.*
import java.util.Locale

data class EcbIndicator(
    val key:String,
    val label:String,
    val value:BigDecimal,
    val unit:String,
    val period:String,
    val marketTimestamp:Instant,
    val receivedAt:Instant,
    val sourceFingerprint:String,
    val seriesKey:String
)

sealed interface EcbIndicatorResult {
    data class Success(val indicator:EcbIndicator):EcbIndicatorResult
    data class Failure(val key:String,val code:String,val retryable:Boolean):EcbIndicatorResult
}

class EcbDataPortalProvider(
    private val client:OkHttpClient,
    private val clock:()->Instant={Instant.now()}
) {
    data class Spec(
        val key:String,
        val label:String,
        val flow:String,
        val series:String,
        val unit:String
    )

    val mro=Spec(
        "ECB_MRO","ECB MRO","FM",
        "D.U2.EUR.4F.KR.MRR_FR.LEV",
        "% p.a."
    )
    val hicp=Spec(
        "EA_HICP","Euro Bölgesi HICP","HICP",
        "M.U2.N.000000.4D0.ANR",
        "% y/y"
    )
    val eurUsd=Spec(
        "EURUSD_ECB","EUR/USD · ECB","EXR",
        "D.USD.EUR.SP00.A",
        "USD per EUR"
    )

    fun fetch(spec:Spec):EcbIndicatorResult {
        val url="https://data-api.ecb.europa.eu/service/data/"+
            spec.flow+"/"+spec.series+
            "?format=jsondata&lastNObservations=1&detail=dataonly"
        val request=Request.Builder()
            .url(url)
            .header("Accept","application/vnd.sdmx.data+json;version=1.0.0-wd")
            .header("User-Agent","Aurum/1.0")
            .get()
            .build()
        return try {
            client.newCall(request).execute().use { response ->
                val received=clock()
                if(!response.isSuccessful) {
                    return EcbIndicatorResult.Failure(spec.key,"HTTP_"+response.code,response.code==429||response.code>=500)
                }
                val bytes=response.body?.bytes()
                    ?: return EcbIndicatorResult.Failure(spec.key,"EMPTY_BODY",true)
                if(bytes.size>2_000_000) return EcbIndicatorResult.Failure(spec.key,"BODY_TOO_LARGE",false)
                parse(spec,bytes,received)
            }
        } catch(_:Throwable) {
            EcbIndicatorResult.Failure(spec.key,"NETWORK_OR_PARSE",true)
        }
    }

    private fun parse(spec:Spec,bytes:ByteArray,received:Instant):EcbIndicatorResult {
        return try {
            val parsed=OfficialDataParsers.parseEcbSingleObservation(bytes)
            val timestamp=periodToInstant(parsed.period)
                ?: return EcbIndicatorResult.Failure(spec.key,"TIME_PERIOD_INVALID",false)
            EcbIndicatorResult.Success(
                EcbIndicator(
                    key=spec.key,
                    label=spec.label,
                    value=parsed.value,
                    unit=spec.unit,
                    period=parsed.period,
                    marketTimestamp=timestamp,
                    receivedAt=received,
                    sourceFingerprint=sha256(bytes),
                    seriesKey=spec.flow+"."+spec.series
                )
            )
        } catch(_:Throwable) {
            EcbIndicatorResult.Failure(spec.key,"PARSE",false)
        }
    }

    private fun periodToInstant(period:String):Instant? {
        return runCatching {
            when {
                Regex("\\d{4}-\\d{2}-\\d{2}").matches(period) ->
                    LocalDate.parse(period).atStartOfDay(ZoneId.of("Europe/Amsterdam")).toInstant()
                Regex("\\d{4}-\\d{2}").matches(period) ->
                    YearMonth.parse(period).atDay(1).atStartOfDay(ZoneId.of("Europe/Amsterdam")).toInstant()
                Regex("\\d{4}").matches(period) ->
                    LocalDate.of(period.toInt(),1,1).atStartOfDay(ZoneId.of("Europe/Amsterdam")).toInstant()
                else -> null
            }
        }.getOrNull()
    }

    private fun sha256(bytes:ByteArray)=MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString(""){"%02x".format(it)}
}
