package io.aurum.aurumb.provider

import io.aurum.common.provider.*
import okhttp3.OkHttpClient
import okhttp3.Request
import org.jsoup.Jsoup
import java.time.Instant

class KapCompanyDirectoryProvider(
    private val client:OkHttpClient,
    private val clock:()->Instant={Instant.now()}
):CompanyDirectoryProvider {
    override val id="KAP"

    override fun fetch():CompanyDirectoryResult {
        val requestedAt=clock()
        val request=Request.Builder()
            .url("https://www.kap.org.tr/tr/bist-sirketler")
            .header("Accept","text/html")
            .header("User-Agent","Aurum/1.0")
            .get().build()
        return try {
            client.newCall(request).execute().use { response ->
                val receivedAt=clock()
                if(!response.isSuccessful) return CompanyDirectoryResult.Failure(id,"HTTP_"+response.code,"KAP HTTP "+response.code,response.code==429||response.code>=500,requestedAt,receivedAt)
                val bytes=response.body?.bytes() ?: return CompanyDirectoryResult.Failure(id,"EMPTY_BODY","KAP returned no body",true,requestedAt,receivedAt)
                if(bytes.size>4_000_000) return CompanyDirectoryResult.Failure(id,"BODY_TOO_LARGE","KAP response exceeds bound",false,requestedAt,receivedAt)
                val fp=Fingerprint.sha256(bytes)
                val doc=Jsoup.parse(String(bytes,Charsets.UTF_8))
                val symbolRegex=Regex("\\b[A-ZÇĞİÖŞÜ0-9]{2,7}\\b")
                val entries=doc.select("tr").mapNotNull { tr ->
                    val cells=tr.select("td").map{it.text().trim().replace(Regex("\\s+")," ")}
                    if(cells.size<2) return@mapNotNull null
                    val symbol=symbolRegex.find(cells[0])?.value?.uppercase() ?: return@mapNotNull null
                    if(symbol.length>6) return@mapNotNull null
                    CompanyDirectoryEntry(symbol,cells[1].ifBlank{symbol},cells.getOrNull(2)?.takeIf{it.isNotBlank()},id,receivedAt,fp)
                }.distinctBy{it.symbol}.sortedBy{it.symbol}
                if(entries.size<100) CompanyDirectoryResult.Failure(id,"INSUFFICIENT_DIRECTORY","KAP parsed "+entries.size+" companies",true,requestedAt,receivedAt)
                else CompanyDirectoryResult.Success(id,entries,requestedAt,receivedAt,fp)
            }
        } catch(t:Throwable) {
            CompanyDirectoryResult.Failure(id,"NETWORK",t.message?.take(200)?:"KAP failure",true,requestedAt,clock())
        }
    }
}
