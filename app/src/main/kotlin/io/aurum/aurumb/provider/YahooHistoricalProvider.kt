package io.aurum.aurumb.provider

import io.aurum.common.model.DataQuality
import io.aurum.common.model.DataState
import io.aurum.common.model.Provenance
import io.aurum.common.provider.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.math.BigDecimal
import java.time.Duration
import java.time.Instant

class YahooHistoricalProvider(
    private val client:OkHttpClient,
    private val clock:()->Instant={Instant.now()}
):HistoricalBarProvider {
    override val id="YAHOO_CHART"

    override fun fetch(symbol:String,from:Instant,to:Instant):BarProviderResult {
        require(symbol.matches(Regex("[A-Za-z0-9.^=-]{1,32}"))) { "invalid symbol" }
        require(from.isBefore(to))
        val requestedAt=clock()
        val url=("https://query1.finance.yahoo.com/v8/finance/chart/"+symbol)
            .toHttpUrl().newBuilder()
            .addQueryParameter("period1",from.epochSecond.toString())
            .addQueryParameter("period2",to.epochSecond.toString())
            .addQueryParameter("interval","1d")
            .addQueryParameter("events","div,splits")
            .addQueryParameter("includeAdjustedClose","true")
            .build()
        val request=Request.Builder()
            .url(url)
            .header("Accept","application/json")
            .header("User-Agent","Aurum/1.0")
            .get()
            .build()
        return try {
            client.newCall(request).execute().use { response ->
                val receivedAt=clock()
                if(!response.isSuccessful) {
                    return BarProviderResult.Failure(id,symbol,"HTTP_"+response.code,"Yahoo chart HTTP "+response.code,response.code==429||response.code>=500,requestedAt,receivedAt)
                }
                val bytes=response.body?.bytes() ?: return BarProviderResult.Failure(id,symbol,"EMPTY_BODY","Yahoo returned no body",true,requestedAt,receivedAt)
                if(bytes.size>8_000_000) return BarProviderResult.Failure(id,symbol,"BODY_TOO_LARGE","Yahoo response exceeds bound",false,requestedAt,receivedAt)
                parse(symbol,bytes,requestedAt,receivedAt)
            }
        } catch (t:Throwable) {
            BarProviderResult.Failure(id,symbol,"NETWORK",t.message?.take(200)?:"network failure",true,requestedAt,clock())
        }
    }

    internal fun parse(symbol:String,bytes:ByteArray,requestedAt:Instant,receivedAt:Instant):BarProviderResult {
        return try {
            val root=JSONObject(String(bytes,Charsets.UTF_8))
            val chart=root.getJSONObject("chart")
            if(!chart.isNull("error")) return BarProviderResult.Failure(id,symbol,"PROVIDER_ERROR",chart.get("error").toString().take(240),false,requestedAt,receivedAt)
            val result=chart.getJSONArray("result").optJSONObject(0)
                ?: return BarProviderResult.Failure(id,symbol,"PARSE_NO_RESULT","Yahoo chart result absent",true,requestedAt,receivedAt)
            val meta=result.optJSONObject("meta")
            val currency=meta?.optString("currency")?.takeIf{it.isNotBlank()}
            val timestamps=result.optJSONArray("timestamp")
                ?: return BarProviderResult.Failure(id,symbol,"PARSE_NO_TIMESTAMPS","Yahoo timestamps absent",true,requestedAt,receivedAt)
            val quote=result.getJSONObject("indicators").getJSONArray("quote").getJSONObject(0)
            val adj=result.getJSONObject("indicators").optJSONArray("adjclose")?.optJSONObject(0)?.optJSONArray("adjclose")
            val opens=quote.optJSONArray("open");val highs=quote.optJSONArray("high");val lows=quote.optJSONArray("low")
            val closes=quote.optJSONArray("close");val volumes=quote.optJSONArray("volume")
            val fingerprint=Fingerprint.sha256(bytes)
            val bars=(0 until timestamps.length()).mapNotNull { i ->
                val close=closes?.optDouble(i,Double.NaN)?.takeIf{it.isFinite()&&it>0} ?: return@mapNotNull null
                val at=Instant.ofEpochSecond(timestamps.getLong(i))
                if(at.isAfter(receivedAt.plus(Duration.ofDays(1)))) return@mapNotNull null
                CanonicalBar(
                    symbol=symbol,
                    at=at,
                    open=opens?.optDouble(i,Double.NaN)?.takeIf{it.isFinite()&&it>0}?.let(BigDecimal::valueOf),
                    high=highs?.optDouble(i,Double.NaN)?.takeIf{it.isFinite()&&it>0}?.let(BigDecimal::valueOf),
                    low=lows?.optDouble(i,Double.NaN)?.takeIf{it.isFinite()&&it>0}?.let(BigDecimal::valueOf),
                    close=BigDecimal.valueOf(close),
                    adjustedClose=adj?.optDouble(i,Double.NaN)?.takeIf{it.isFinite()&&it>0}?.let(BigDecimal::valueOf),
                    volume=volumes?.optDouble(i,Double.NaN)?.takeIf{it.isFinite()&&it>=0}?.let(BigDecimal::valueOf),
                    currency=currency,
                    provider=id,
                    requestedAt=requestedAt,
                    receivedAt=receivedAt,
                    quality=DataQuality.VALID,
                    freshness=if(Duration.between(at,receivedAt)<=Duration.ofDays(3))DataState.LIVE else DataState.CACHED,
                    rawSourceFingerprint=fingerprint
                )
            }.sortedBy{it.at}
            if(bars.size<2) BarProviderResult.Failure(id,symbol,"INSUFFICIENT_BARS","Yahoo returned fewer than 2 valid bars",true,requestedAt,receivedAt)
            else {
                val regularPrice=meta?.optDouble("regularMarketPrice",Double.NaN)
                    ?.takeIf{it.isFinite() && it>0.0}
                val regularTime=meta?.optLong("regularMarketTime",0L)
                    ?.takeIf{it>0L}
                    ?.let(Instant::ofEpochSecond)
                    ?.takeIf{!it.isAfter(receivedAt.plusSeconds(300))}
                val observation=if(regularPrice!=null && regularTime!=null) {
                    Observation(
                        symbol=symbol,
                        value=BigDecimal.valueOf(regularPrice),
                        currency=currency,
                        provenance=Provenance(
                            provider=id,
                            requestedAt=requestedAt,
                            receivedAt=receivedAt,
                            marketTimestamp=regularTime,
                            symbol=symbol,
                            currency=currency,
                            quality=DataQuality.VALID,
                            freshness=if(Duration.between(regularTime,receivedAt)<=Duration.ofDays(1))DataState.LIVE else DataState.CACHED,
                            rawSourceFingerprint=fingerprint,
                            transformVersion="yahoo-chart-v2"
                        )
                    )
                } else null
                BarProviderResult.Success(id,symbol,bars,requestedAt,receivedAt,fingerprint,observation)
            }
        } catch (t:Throwable) {
            BarProviderResult.Failure(id,symbol,"PARSE",t.message?.take(200)?:"parse failure",false,requestedAt,receivedAt)
        }
    }
}
