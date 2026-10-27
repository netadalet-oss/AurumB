package io.aurum.aurumb.market

import io.aurum.aurumb.network.HttpClientFactory
import io.aurum.aurumb.network.YahooChartProvider
import io.aurum.aurumb.persistence.AurumDao
import io.aurum.aurumb.persistence.NewsItemEntity
import io.aurum.aurumb.persistence.PortalQuoteEntity
import io.aurum.aurumb.provider.*
import io.aurum.common.provider.ProviderResult
import java.math.BigDecimal
import java.time.Duration
import java.time.Instant
import org.json.JSONArray

data class PortalQuote(
    val key:String,
    val label:String,
    val region:String,
    val value:BigDecimal?,
    val currency:String?,
    val provider:String,
    val marketTimestamp:Instant?,
    val freshness:String,
    val quality:String,
    val errorCode:String?,
    val attempts:List<String>
)

class MarketPortalService(
    private val dao:AurumDao?=null,
    private val yahoo:YahooChartProvider=YahooChartProvider(HttpClientFactory.market()),
    private val tcmb:TcmbDailyFxProvider=TcmbDailyFxProvider(HttpClientFactory.market()),
    private val ecb:EcbDataPortalProvider=EcbDataPortalProvider(HttpClientFactory.market()),
    private val news:LegacyFinancePortalProvider=LegacyFinancePortalProvider(HttpClientFactory.market())
) {
    private data class Spec(val key:String,val label:String,val region:String,val symbol:String)
    private val specs=listOf(
        Spec("BIST100","BIST 100","TR","XU100.IS"),
        Spec("USDTRY","USD/TRY","TR","TRY=X"),
        Spec("EURTRY","EUR/TRY","TR","EURTRY=X"),
        Spec("GOLD","Altın","TR","GC=F"),
        Spec("AEX","AEX","NL","^AEX"),
        Spec("EURUSD","EUR/USD","EU","EURUSD=X")
    )

    data class PortalNewsSnapshot(
        val turkey:NewsResult,
        val netherlands:NewsResult
    )

    data class PortalRefreshSnapshot(
        val quotes:List<PortalQuote>,
        val news:PortalNewsSnapshot,
        val capturedAt:Instant
    )

    suspend fun refreshAndPersist(asOf:Instant=Instant.now()):PortalRefreshSnapshot {
        val quotes=refresh(asOf)
        persistQuotes(quotes,asOf)
        val newsSnapshot=refreshNews()
        return PortalRefreshSnapshot(quotes,newsSnapshot,asOf)
    }

    private suspend fun persistQuotes(quotes:List<PortalQuote>,capturedAt:Instant) {
        val target=dao ?: return
        // Preserve the immediately preceding persisted quote inside the audit trail.
        // The legacy market cards show a real percentage move; keeping the previous
        // observation here lets the native UI reproduce it without inventing data
        // or changing the Room schema.
        val previous=target.portalQuotes().associateBy { it.key }
        target.putPortalQuotes(quotes.map { q ->
            val old=previous[q.key]
            val attempts=q.attempts.toMutableList()
            old?.valueDecimal?.toBigDecimalOrNull()?.let {
                attempts += "PREVIOUS_VALUE:"+it.toPlainString()
            }
            if(q.value==null && old?.valueDecimal?.toBigDecimalOrNull()!=null) {
                // Legacy market runtime never blanked a previously valid indicator
                // because one provider attempt failed. Keep the last valid field
                // visible and mark the new attempt as stale/degraded.
                old.copy(
                    capturedAtUtc=capturedAt.toString(),
                    freshness="STALE",
                    quality="DEGRADED",
                    errorCode=q.errorCode ?: old.errorCode,
                    attemptsJson=JSONArray(attempts).toString()
                )
            } else {
                PortalQuoteEntity(
                    key=q.key,
                    label=q.label,
                    region=q.region,
                    valueDecimal=q.value?.toPlainString(),
                    currency=q.currency,
                    provider=q.provider,
                    marketTimestampUtc=q.marketTimestamp?.toString(),
                    capturedAtUtc=capturedAt.toString(),
                    freshness=q.freshness,
                    quality=q.quality,
                    errorCode=q.errorCode,
                    attemptsJson=JSONArray(attempts).toString()
                )
            }
        })
    }

    suspend fun refreshNews():PortalNewsSnapshot {
        val turkey=news.fetchTurkey()
        val netherlands=news.fetchNetherlands()
        persistNews("TR",turkey)
        persistNews("NL",netherlands)
        return PortalNewsSnapshot(turkey=turkey,netherlands=netherlands)
    }

    private suspend fun persistNews(region:String,result:NewsResult) {
        val target=dao ?: return
        val success=result as? NewsResult.Success ?: return
        if(success.items.isEmpty()) return
        val visible=success.items.filter { item -> !item.publishedAt.isAfter(success.receivedAt.plusSeconds(300)) }
        if(visible.isEmpty()) return
        target.insertNewsItems(visible.map { item ->
            val id=Fingerprint.sha256(
                (item.provider+"|"+item.link+"|"+item.publishedAt.toString()).toByteArray(Charsets.UTF_8)
            )
            NewsItemEntity(
                id=id,
                region=region,
                title=item.title,
                link=item.link,
                source=item.source,
                publishedAtUtc=item.publishedAt.toString(),
                receivedAtUtc=success.receivedAt.toString(),
                provider=item.provider,
                rawSourceFingerprint=item.rawSourceFingerprint
            )
        })
    }

    fun refresh(asOf:Instant=Instant.now()):List<PortalQuote> {
        val market=specs.map { spec ->
            when(spec.key) {
                "USDTRY","EURTRY" -> fx(spec,asOf)
                "EURUSD" -> eurUsd(spec,asOf)
                else -> fromYahoo(spec,asOf)
            }
        }
        return market + listOf(
            ecbIndicator(ecb.mro,"EU",asOf),
            ecbIndicator(ecb.hicp,"EU",asOf)
        )
    }

    private fun pctAttempt(current:BigDecimal?,previous:BigDecimal?):String? {
        if(current==null || previous==null || previous.signum()==0) return null
        val pct=current.subtract(previous)
            .divide(previous,java.math.MathContext.DECIMAL64)
            .multiply(BigDecimal("100"))
        return "CHANGE_PCT:"+pct.stripTrailingZeros().toPlainString()
    }

    private fun yahooMoveAttempts(symbol:String,asOf:Instant):List<String> {
        val snap=yahoo.fetchWithPreviousClose(symbol,asOf)
        val success=snap.result as? ProviderResult.Success
        val pct=pctAttempt(success?.observation?.value,snap.previousClose)
        return buildList {
            add(if(success!=null)"YAHOO_MOVE:SUCCESS" else "YAHOO_MOVE:UNAVAILABLE")
            if(pct!=null) add(pct)
        }
    }

    private fun fx(spec:Spec,asOf:Instant):PortalQuote {
        val canonical=if(spec.key=="USDTRY")"USDTRY" else "EURTRY"
        return when(val primary=tcmb.fetch(canonical,asOf)) {
            is ProviderResult.Success -> success(
                spec,primary,listOf("TCMB:SUCCESS")+yahooMoveAttempts(spec.symbol,asOf)
            )
            is ProviderResult.Failure -> {
                val yahooSnapshot=yahoo.fetchWithPreviousClose(spec.symbol,asOf)
                when(val fallback=yahooSnapshot.result) {
                    is ProviderResult.Success -> {
                        success(
                            spec,fallback,
                            listOf("TCMB:FAIL:"+primary.code,"YAHOO:SUCCESS")+
                                listOfNotNull(pctAttempt(fallback.observation.value,yahooSnapshot.previousClose))
                        ).copy(quality="DEGRADED",errorCode="PRIMARY_"+primary.code)
                    }
                    is ProviderResult.Failure -> unavailable(
                        spec,
                        primary.provider+"+"+fallback.provider,
                        primary.code+"|"+fallback.code,
                        listOf("TCMB:FAIL:"+primary.code,"YAHOO:FAIL:"+fallback.code)
                    )
                }
            }
        }
    }

    private fun eurUsd(spec:Spec,asOf:Instant):PortalQuote {
        return when(val primary=ecb.fetch(ecb.eurUsd)) {
            is EcbIndicatorResult.Success -> {
                val x=primary.indicator
                if(x.marketTimestamp.isAfter(asOf.plusSeconds(300))) return unavailable(
                    spec,"ECB_DATA_PORTAL","FUTURE_TIMESTAMP",listOf("ECB:"+x.seriesKey+":FUTURE_TIMESTAMP")
                )
                PortalQuote(
                    key=spec.key,label=spec.label,region=spec.region,
                    value=x.value,currency=x.unit,provider="ECB_DATA_PORTAL",
                    marketTimestamp=x.marketTimestamp,
                    freshness=freshness(x.marketTimestamp,asOf,Duration.ofDays(4),Duration.ofDays(10)),
                    quality="VALID",errorCode=null,
                    attempts=listOf("ECB:"+x.seriesKey+":SUCCESS:"+x.period)+
                        yahooMoveAttempts(spec.symbol,asOf)
                )
            }
            is EcbIndicatorResult.Failure -> {
                val yahooSnapshot=yahoo.fetchWithPreviousClose(spec.symbol,asOf)
                when(val fallback=yahooSnapshot.result) {
                    is ProviderResult.Success ->
                        success(
                            spec,fallback,
                            listOf("ECB:FAIL:"+primary.code,"YAHOO:SUCCESS")+
                                listOfNotNull(pctAttempt(fallback.observation.value,yahooSnapshot.previousClose))
                        ).copy(quality="DEGRADED",errorCode="PRIMARY_"+primary.code)
                    is ProviderResult.Failure ->
                        unavailable(
                            spec,
                            "ECB_DATA_PORTAL+"+fallback.provider,
                            primary.code+"|"+fallback.code,
                            listOf("ECB:FAIL:"+primary.code,"YAHOO:FAIL:"+fallback.code)
                        )
                }
            }
        }
    }

    private fun ecbIndicator(
        spec:EcbDataPortalProvider.Spec,
        region:String,
        asOf:Instant
    ):PortalQuote {
        return when(val result=ecb.fetch(spec)) {
            is EcbIndicatorResult.Success -> {
                val x=result.indicator
                if(x.marketTimestamp.isAfter(asOf.plusSeconds(300))) {
                    return PortalQuote(
                        key=spec.key,label=spec.label,region=region,value=null,currency=null,
                        provider="ECB_DATA_PORTAL",marketTimestamp=null,freshness="UNAVAILABLE",
                        quality="MISSING",errorCode="FUTURE_TIMESTAMP",
                        attempts=listOf("ECB:"+x.seriesKey+":FUTURE_TIMESTAMP")
                    )
                }
                val live=if(spec.key=="EA_HICP")Duration.ofDays(45) else Duration.ofDays(10)
                val stale=if(spec.key=="EA_HICP")Duration.ofDays(75) else Duration.ofDays(45)
                PortalQuote(
                    key=spec.key,
                    label=spec.label,
                    region=region,
                    value=x.value,
                    currency=x.unit,
                    provider="ECB_DATA_PORTAL",
                    marketTimestamp=x.marketTimestamp,
                    freshness=freshness(x.marketTimestamp,asOf,live,stale),
                    quality="VALID",
                    errorCode=null,
                    attempts=listOf("ECB:"+x.seriesKey+":SUCCESS:"+x.period)
                )
            }
            is EcbIndicatorResult.Failure -> PortalQuote(
                key=spec.key,label=spec.label,region=region,
                value=null,currency=null,provider="ECB_DATA_PORTAL",
                marketTimestamp=null,freshness="UNAVAILABLE",quality="MISSING",
                errorCode=result.code,attempts=listOf("ECB:FAIL:"+result.code)
            )
        }
    }

    private fun fromYahoo(spec:Spec,asOf:Instant):PortalQuote {
        val snapshot=yahoo.fetchWithPreviousClose(spec.symbol,asOf)
        return when(val result=snapshot.result) {
            is ProviderResult.Success -> success(
                spec,result,
                listOf("YAHOO:SUCCESS")+
                    listOfNotNull(pctAttempt(result.observation.value,snapshot.previousClose))
            )
            is ProviderResult.Failure -> unavailable(
                spec,result.provider,result.code,listOf("YAHOO:FAIL:"+result.code)
            )
        }
    }

    private fun success(
        spec:Spec,
        result:ProviderResult.Success,
        attempts:List<String>
    ):PortalQuote {
        val o=result.observation
        return PortalQuote(
            key=spec.key,label=spec.label,region=spec.region,
            value=o.value,currency=o.currency,provider=o.provenance.provider,
            marketTimestamp=o.provenance.marketTimestamp,
            freshness=o.provenance.freshness.name,
            quality=o.provenance.quality.name,
            errorCode=null,attempts=attempts
        )
    }

    private fun unavailable(
        spec:Spec,
        provider:String,
        code:String,
        attempts:List<String>
    )=PortalQuote(
        key=spec.key,label=spec.label,region=spec.region,
        value=null,currency=null,provider=provider,
        marketTimestamp=null,freshness="UNAVAILABLE",quality="MISSING",
        errorCode=code,attempts=attempts
    )

    private fun freshness(
        marketTimestamp:Instant,
        asOf:Instant,
        liveWithin:Duration,
        staleAfter:Duration
    ):String {
        if(marketTimestamp.isAfter(asOf.plusSeconds(300))) return "UNAVAILABLE"
        val age=Duration.between(marketTimestamp,asOf)
        return when {
            age<=liveWithin -> "LIVE"
            age<=staleAfter -> "CACHED"
            else -> "STALE"
        }
    }
}
