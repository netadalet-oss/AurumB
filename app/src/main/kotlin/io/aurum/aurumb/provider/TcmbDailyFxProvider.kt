package io.aurum.aurumb.provider

import io.aurum.common.model.*
import io.aurum.common.provider.*
import okhttp3.OkHttpClient
import okhttp3.Request
import java.math.BigDecimal
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class TcmbDailyFxProvider(
    private val client:OkHttpClient,
    private val clock:()->Instant={Instant.now()}
):MarketProvider {
    override val id="TCMB_DAILY_FX"
    private val zone=ZoneId.of("Europe/Istanbul")

    override fun fetch(symbol:String,asOf:Instant):ProviderResult {
        val currency=when(symbol.uppercase()) {
            "USDTRY","USD/TRY" -> "USD"
            "EURTRY","EUR/TRY" -> "EUR"
            else -> return ProviderResult.Failure(id,"UNSUPPORTED_SYMBOL","TCMB provider supports USDTRY/EURTRY",false)
        }
        val requestedAt=clock()
        val request=Request.Builder()
            .url("https://www.tcmb.gov.tr/kurlar/today.xml")
            .header("Accept","application/xml,text/xml")
            .header("User-Agent","Aurum/1.0")
            .get()
            .build()
        return try {
            client.newCall(request).execute().use { response ->
                val receivedAt=clock()
                if(!response.isSuccessful) {
                    return ProviderResult.Failure(id,"HTTP_"+response.code,"TCMB HTTP "+response.code,response.code==429||response.code>=500)
                }
                val bytes=response.body?.bytes()
                    ?: return ProviderResult.Failure(id,"EMPTY_BODY","TCMB returned no body",true)
                if(bytes.size>1_000_000) return ProviderResult.Failure(id,"BODY_TOO_LARGE","TCMB response exceeds bound",false)
                parse(currency,symbol.uppercase(),bytes,requestedAt,receivedAt,asOf)
            }
        } catch(t:Throwable) {
            ProviderResult.Failure(id,"NETWORK_OR_PARSE",t::class.java.simpleName,true)
        }
    }

    private fun parse(
        currencyCode:String,
        requestedSymbol:String,
        bytes:ByteArray,
        requestedAt:Instant,
        receivedAt:Instant,
        asOf:Instant
    ):ProviderResult {
        val parsed=runCatching { OfficialDataParsers.parseTcmbDailyFx(bytes) }
            .getOrElse {
                return ProviderResult.Failure(id,"PARSE",it.message?:"TCMB parse failure",false)
            }
        val date=runCatching {
            LocalDate.parse(parsed.sourceDate,DateTimeFormatter.ofPattern("dd.MM.yyyy"))
        }.getOrElse {
            return ProviderResult.Failure(id,"INVALID_SOURCE_DATE","TCMB source date invalid",false)
        }
        val marketTimestamp=date.atStartOfDay(zone).toInstant()
        if(marketTimestamp.isAfter(asOf.plusSeconds(300))) {
            return ProviderResult.Failure(id,"FUTURE_TIMESTAMP","TCMB source date is after asOf",false)
        }
        val value=parsed.sellingRates[currencyCode]
            ?: return ProviderResult.Failure(id,"RATE_UNAVAILABLE","TCMB selling rate unavailable",false)

        val ageDays=java.time.Duration.between(marketTimestamp,receivedAt).toDays()
        val freshness=if(ageDays<=1) DataState.LIVE else if(ageDays<=4) DataState.CACHED else DataState.STALE
        return ProviderResult.Success(
            Observation(
                symbol=requestedSymbol,
                value=value,
                currency="TRY",
                provenance=Provenance(
                    provider=id,
                    requestedAt=requestedAt,
                    receivedAt=receivedAt,
                    marketTimestamp=marketTimestamp,
                    symbol=requestedSymbol,
                    currency="TRY",
                    quality=DataQuality.VALID,
                    freshness=freshness,
                    rawSourceFingerprint=sha256(bytes),
                    transformVersion="tcmb-daily-fx-v1"
                )
            )
        )
    }

    private fun sha256(bytes:ByteArray)=MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString(""){"%02x".format(it)}
}
