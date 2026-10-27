package io.aurum.aurumb.provider

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.w3c.dom.Element
import java.io.ByteArrayInputStream
import java.net.URLEncoder
import java.security.MessageDigest
import java.time.Instant
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import javax.xml.parsers.DocumentBuilderFactory

data class NewsItem(
    val title:String,
    val link:String,
    val source:String?,
    val publishedAt:Instant,
    val provider:String,
    val rawSourceFingerprint:String
)

sealed interface NewsResult {
    data class Success(val items:List<NewsItem>,val requestedAt:Instant,val receivedAt:Instant):NewsResult
    data class Failure(val provider:String,val code:String,val retryable:Boolean):NewsResult
}

class GoogleNewsRssProvider(
    private val client:OkHttpClient
) {
    val id:String="google-news-rss"

    fun fetchTurkey(limit:Int=12):NewsResult =
        fetch("Borsa İstanbul OR TCMB OR Türkiye ekonomi", "tr", "TR", "TR:tr", limit)

    fun fetchNetherlands(limit:Int=12):NewsResult =
        fetch("Nederland financiën OR AEX OR ECB", "nl", "NL", "NL:nl", limit)

    private fun fetch(query:String,hl:String,gl:String,ceid:String,limit:Int):NewsResult {
        require(limit in 1..50)
        val encoded=URLEncoder.encode(query,Charsets.UTF_8.name())
        val url=("https://news.google.com/rss/search?q="+encoded+
            "&hl="+hl+"&gl="+gl+"&ceid="+URLEncoder.encode(ceid,Charsets.UTF_8.name())).toHttpUrl()
        val requestedAt=Instant.now()
        return try {
            client.newCall(Request.Builder().url(url).get().build()).execute().use { response ->
                val receivedAt=Instant.now()
                if(!response.isSuccessful) {
                    return NewsResult.Failure(id,"HTTP_"+response.code,response.code==429 || response.code>=500)
                }
                val raw=response.body?.bytes() ?: return NewsResult.Failure(id,"EMPTY_BODY",false)
                if(raw.size>2_000_000) return NewsResult.Failure(id,"BODY_TOO_LARGE",false)
                val fingerprint=sha256(raw)
                val items=parse(raw,id,fingerprint).take(limit)
                if(items.isEmpty()) NewsResult.Failure(id,"NO_ITEMS",false)
                else NewsResult.Success(items,requestedAt,receivedAt)
            }
        } catch(_:Exception) {
            NewsResult.Failure(id,"NETWORK_OR_PARSE",true)
        }
    }

    companion object {
        internal fun parse(raw:ByteArray,provider:String,fingerprint:String):List<NewsItem> {
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
                    val title=item.text("title")?.trim()?.takeIf{it.isNotEmpty()} ?: continue
                    val link=item.text("link")?.trim()?.takeIf{it.startsWith("https://")} ?: continue
                    val pub=item.text("pubDate")?.trim()?.let {
                        runCatching{ZonedDateTime.parse(it,DateTimeFormatter.RFC_1123_DATE_TIME).toInstant()}.getOrNull()
                    } ?: continue
                    val source=item.text("source")?.trim()?.takeIf{it.isNotEmpty()}
                    add(NewsItem(title.take(500),link,source,pub,provider,fingerprint))
                }
            }.sortedByDescending{it.publishedAt}
        }

        private fun Element.text(tag:String):String? =
            getElementsByTagName(tag).item(0)?.textContent

        private fun sha256(bytes:ByteArray)=MessageDigest.getInstance("SHA-256")
            .digest(bytes).joinToString(""){"%02x".format(it)}
    }
}
