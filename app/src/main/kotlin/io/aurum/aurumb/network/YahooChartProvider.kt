package io.aurum.aurumb.network

import io.aurum.common.model.*
import io.aurum.common.provider.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.math.BigDecimal
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant

data class YahooChartSnapshot(
    val result:ProviderResult,
    val previousClose:BigDecimal?
)

class YahooChartProvider(
    private val client:OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(Duration.ofSeconds(10))
        .readTimeout(Duration.ofSeconds(15))
        .followRedirects(false)
        .followSslRedirects(false)
        .build()
):MarketProvider {
    override val id:String="yahoo-chart"

    override fun fetch(symbol:String,asOf:Instant):ProviderResult =
        fetchWithPreviousClose(symbol,asOf).result

    fun fetchWithPreviousClose(symbol:String,asOf:Instant):YahooChartSnapshot {
        return try {
            val url="https://query1.finance.yahoo.com/v8/finance/chart/" +
                java.net.URLEncoder.encode(symbol,Charsets.UTF_8.name()) +
                "?interval=1d&range=5d"
            val requested=Instant.now()
            client.newCall(Request.Builder().url(url.toHttpUrl()).get().build()).execute().use { response ->
                val received=Instant.now()
                if(!response.isSuccessful) return YahooChartSnapshot(
                    ProviderResult.Failure(id,"HTTP_"+response.code,"Yahoo chart request failed",response.code==429 || response.code>=500),
                    null
                )
                val raw=response.body?.bytes() ?: return YahooChartSnapshot(
                    ProviderResult.Failure(id,"EMPTY_BODY","Yahoo chart returned empty body",false),null
                )
                if(raw.size>2_000_000) return YahooChartSnapshot(
                    ProviderResult.Failure(id,"BODY_TOO_LARGE","Yahoo response exceeded limit",false),null
                )
                val json=JSONObject(raw.decodeToString())
                val result=json.getJSONObject("chart").getJSONArray("result").optJSONObject(0)
                    ?: return YahooChartSnapshot(ProviderResult.Failure(id,"NO_RESULT","No chart result",false),null)
                val meta=result.getJSONObject("meta")
                val price=meta.optDouble("regularMarketPrice",Double.NaN)
                val epoch=meta.optLong("regularMarketTime",0L)
                if(!price.isFinite() || price<=0.0 || epoch<=0L) return YahooChartSnapshot(
                    ProviderResult.Failure(id,"INVALID_PRICE","Invalid market price/time",false),null
                )
                val marketTs=Instant.ofEpochSecond(epoch)
                if(marketTs.isAfter(asOf.plusSeconds(300))) return YahooChartSnapshot(
                    ProviderResult.Failure(id,"FUTURE_TIMESTAMP","Market timestamp is after requested asOf",false),null
                )
                val currency=meta.optString("currency").ifBlank{null}
                val previous=sequenceOf(
                    meta.optDouble("chartPreviousClose",Double.NaN),
                    meta.optDouble("previousClose",Double.NaN)
                ).firstOrNull { it.isFinite() && it>0.0 }?.let(BigDecimal::valueOf)
                    ?: runCatching {
                        val closes=result.getJSONObject("indicators").getJSONArray("quote")
                            .optJSONObject(0)?.optJSONArray("close")
                        if(closes==null) null else {
                            val values=(0 until closes.length()).mapNotNull { i ->
                                closes.optDouble(i,Double.NaN).takeIf { it.isFinite() && it>0.0 }
                            }
                            values.dropLast(1).lastOrNull()?.let(BigDecimal::valueOf)
                        }
                    }.getOrNull()
                YahooChartSnapshot(
                    ProviderResult.Success(
                        Observation(
                            symbol=symbol,
                            value=BigDecimal.valueOf(price),
                            currency=currency,
                            provenance=Provenance(
                                provider=id,
                                requestedAt=requested,
                                receivedAt=received,
                                marketTimestamp=marketTs,
                                symbol=symbol,
                                currency=currency,
                                quality=DataQuality.VALID,
                                freshness=DataState.LIVE,
                                rawSourceFingerprint=sha256(raw),
                                transformVersion="yahoo-chart-v2-prevclose"
                            )
                        )
                    ),
                    previous
                )
            }
        } catch(e:Exception) {
            YahooChartSnapshot(
                ProviderResult.Failure(id,"NETWORK_OR_PARSE",e.javaClass.simpleName,true),
                null
            )
        }
    }

    private fun sha256(bytes:ByteArray)=MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString(""){"%02x".format(it)}
}
