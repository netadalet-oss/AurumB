package io.aurum.aurumb.provider

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import okhttp3.OkHttpClient
import okhttp3.Request
import org.jsoup.Jsoup
import org.w3c.dom.Element
import java.io.ByteArrayInputStream
import java.net.URLEncoder
import java.security.MessageDigest
import java.time.Instant
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Native port of the final standalone Aurum finance/news portal source map.
 * Provider tags deliberately include the legacy lane so UI filtering can stay
 * schema-neutral: legacy-finance-portal|<category>.
 */
class LegacyFinancePortalProvider(private val client:OkHttpClient) {
    private data class Lane(
        val category:String,
        val query:String?=null,
        val rssUrl:String?=null,
        val htmlUrl:String?=null,
        val language:String="tr",
        val country:String="TR",
        val ceid:String="TR:tr"
    )

    suspend fun fetchTurkey(limit:Int=160):NewsResult = coroutineScope {
        val lanes=listOf(
            Lane("Piyasa",query="Türkiye Borsa İstanbul finans piyasaları döviz altın faiz son dakika when:1d"),
            Lane("Yorum / Öneri",query="piyasa yorum öneri analiz borsa döviz altın yatırım strateji when:1d"),
            Lane("Ekonomi / Makro",query="Türkiye ekonomi TCMB enflasyon faiz büyüme işsizlik bütçe vergi son dakika when:1d"),
            Lane("Siyaset",query="Türkiye siyaset meclis hükümet yasa düzenleme son dakika when:1d"),
            Lane("Asayiş / Adalet",query="Türkiye adalet yargı mahkeme savcılık asayiş son dakika when:1d"),
            Lane("Dış Politika",query="Türkiye dış politika diplomasi AB NATO bölge son dakika when:1d"),
            Lane("Dünya",query="dünya önemli son dakika ABD Avrupa Çin Orta Doğu küresel gelişmeler when:1d"),
            Lane("Şirket / KAP",query="BIST şirket KAP bilanço temettü yatırım şirket açıklama when:2d"),
            Lane("Piyasa",htmlUrl="https://bigpara.hurriyet.com.tr/haberler/"),
            Lane("Yorum / Öneri",htmlUrl="https://www.isyatirim.com.tr/tr-tr/analiz/Haberler/Sayfalar/default.aspx")
        )
        merge(lanes.map { lane -> async(Dispatchers.IO) { fetchLane(lane) } }.map { it.await() },limit)
    }

    suspend fun fetchNetherlands(limit:Int=180):NewsResult = coroutineScope {
        val nl={ category:String,query:String -> Lane(category,query=query,language="nl",country="NL",ceid="NL:nl") }
        val lanes=listOf(
            nl("Financiën & Beurs","Nederland AEX beurs financiële markten DNB AFM Euronext"),
            nl("Economie & Bedrijven","Nederland economie bedrijven ondernemingen kwartaalcijfers overname"),
            nl("Politiek","Nederland politiek kabinet Tweede Kamer regering"),
            nl("Justitie & Veiligheid","Nederland politie justitie rechtbank OM misdaad veiligheid"),
            nl("Migratie & Asiel","Nederland migratie asiel IND vluchtelingen arbeidsmigratie asielbeleid"),
            nl("Handel","Nederland handel export import retail ondernemers haven Rotterdam Schiphol"),
            nl("Formule 1","Nederland Formule 1 Verstappen Zandvoort"),
            Lane("Justitie & Veiligheid",rssUrl="https://feeds.nos.nl/nosnieuwsbinnenland",language="nl",country="NL",ceid="NL:nl"),
            Lane("Politiek",rssUrl="https://feeds.nos.nl/nosnieuwspolitiek",language="nl",country="NL",ceid="NL:nl"),
            Lane("Economie & Bedrijven",rssUrl="https://feeds.nos.nl/nosnieuwseconomie",language="nl",country="NL",ceid="NL:nl"),
            Lane("Formule 1",rssUrl="https://feeds.nos.nl/nossportformule1",language="nl",country="NL",ceid="NL:nl"),
            Lane("Economie & Bedrijven",rssUrl="https://feeds.nos.nl/nosnieuwsalgemeen",language="nl",country="NL",ceid="NL:nl"),
            Lane("Economie & Bedrijven",rssUrl="https://feeds.nos.nl/nosnieuwstech",language="nl",country="NL",ceid="NL:nl"),
            nl("Handel","Nederland logistiek transport havens export ondernemers"),
            nl("Economie & Bedrijven","Nederland CBS inflatie werkloosheid industrie economie"),
            nl("Migratie & Asiel","site:rijksoverheid.nl migratie asiel Nederland"),
            nl("Financiën & Beurs","site:dnb.nl financiële markten Nederland"),
            nl("Financiën & Beurs","site:afm.nl nieuws markt Nederland")
        )
        merge(lanes.map { lane -> async(Dispatchers.IO) { fetchLane(lane) } }.map { it.await() },limit)
    }

    private fun fetchLane(lane:Lane):NewsResult {
        val url=lane.rssUrl ?: lane.htmlUrl ?: googleUrl(lane)
        val requested=Instant.now()
        return try {
            client.newCall(Request.Builder().url(url).get().header("Accept","application/rss+xml,application/xml,text/xml,text/html;q=0.9,*/*;q=0.5").build())
                .execute().use { response ->
                    val received=Instant.now()
                    if(!response.isSuccessful) return NewsResult.Failure("legacy-finance-portal","HTTP_"+response.code,response.code==429||response.code>=500)
                    val raw=response.body?.bytes() ?: return NewsResult.Failure("legacy-finance-portal","EMPTY_BODY",false)
                    if(raw.size>3_000_000) return NewsResult.Failure("legacy-finance-portal","BODY_TOO_LARGE",false)
                    val fingerprint=sha256(raw)
                    val provider="legacy-finance-portal|"+lane.category
                    val items=if(lane.htmlUrl!=null) parseHtml(raw,url,lane.category,provider,fingerprint,received)
                              else parseRss(raw,provider,fingerprint)
                    if(items.isEmpty()) NewsResult.Failure(provider,"NO_ITEMS",false)
                    else NewsResult.Success(items,requested,received)
                }
        } catch(_:Throwable) {
            NewsResult.Failure("legacy-finance-portal|"+lane.category,"NETWORK_OR_PARSE",true)
        }
    }

    private fun googleUrl(lane:Lane):String {
        val encoded=URLEncoder.encode(lane.query.orEmpty(),Charsets.UTF_8.name())
        return "https://news.google.com/rss/search?q="+encoded+
            "&hl="+lane.language+"&gl="+lane.country+"&ceid="+
            URLEncoder.encode(lane.ceid,Charsets.UTF_8.name())
    }

    private fun merge(results:List<NewsResult>,limit:Int):NewsResult {
        val successes=results.filterIsInstance<NewsResult.Success>()
        if(successes.isEmpty()) return NewsResult.Failure("legacy-finance-portal","ALL_SOURCES_FAILED",true)
        val now=Instant.now()
        val cutoff=now.minusSeconds(5L*24L*60L*60L)
        val seen=linkedSetOf<String>()
        val merged=successes.flatMap { it.items }
            .filter { it.publishedAt>=cutoff && it.publishedAt<=now.plusSeconds(6*60*60) }
            .sortedByDescending { it.publishedAt }
            .filter { item -> seen.add(normalizeTitle(item.title)) }
            .take(limit.coerceIn(1,240))
        return if(merged.isEmpty()) NewsResult.Failure("legacy-finance-portal","NO_FRESH_ITEMS",false)
        else NewsResult.Success(
            merged,
            successes.minOf { it.requestedAt },
            successes.maxOf { it.receivedAt }
        )
    }

    private fun parseRss(raw:ByteArray,provider:String,fingerprint:String):List<NewsItem> {
        val factory=DocumentBuilderFactory.newInstance()
        factory.isNamespaceAware=false
        factory.isXIncludeAware=false
        factory.setExpandEntityReferences(false)
        runCatching{factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl",true)}
        runCatching{factory.setFeature("http://xml.org/sax/features/external-general-entities",false)}
        runCatching{factory.setFeature("http://xml.org/sax/features/external-parameter-entities",false)}
        val doc=factory.newDocumentBuilder().parse(ByteArrayInputStream(raw))
        val nodes=doc.getElementsByTagName("item")
        return buildList {
            for(i in 0 until nodes.length) {
                val item=nodes.item(i) as? Element ?: continue
                val title=item.text("title")?.trim()?.takeIf{it.length in 8..500} ?: continue
                val link=(item.text("link")?:item.text("guid"))?.trim()?.takeIf{it.startsWith("http://")||it.startsWith("https://")} ?: continue
                val pubRaw=item.text("pubDate")?.trim() ?: item.text("dc:date")?.trim()
                val pub=parseDate(pubRaw) ?: continue
                val source=item.text("source")?.trim()?.takeIf{it.isNotBlank()}
                add(NewsItem(title.take(500),link,source,pub,provider,fingerprint))
            }
        }
    }

    private fun parseHtml(
        raw:ByteArray,baseUrl:String,category:String,provider:String,fingerprint:String,received:Instant
    ):List<NewsItem> {
        val doc=Jsoup.parse(raw.toString(Charsets.UTF_8),baseUrl)
        val source=when {
            baseUrl.contains("bigpara") -> "Bigpara"
            baseUrl.contains("isyatirim") -> "İş Yatırım"
            else -> category
        }
        return doc.select("a[href]").mapNotNull { a ->
            val title=a.text().replace(Regex("\\s+")," ").trim()
            if(title.length !in 24..240) return@mapNotNull null
            val href=a.absUrl("href").takeIf{it.startsWith("https://")} ?: return@mapNotNull null
            NewsItem(title,href,source,received,provider,fingerprint)
        }
    }

    private fun parseDate(raw:String?):Instant? {
        if(raw.isNullOrBlank()) return null
        return runCatching { ZonedDateTime.parse(raw,DateTimeFormatter.RFC_1123_DATE_TIME).toInstant() }.getOrNull()
            ?: runCatching { Instant.parse(raw) }.getOrNull()
    }

    private fun normalizeTitle(value:String)=value.lowercase()
        .replace(Regex("[^a-z0-9çğıöşüéëïäöü]+")," ").trim()

    private fun Element.text(tag:String):String? = getElementsByTagName(tag).item(0)?.textContent

    private fun sha256(bytes:ByteArray)=MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString(""){"%02x".format(it)}
}
