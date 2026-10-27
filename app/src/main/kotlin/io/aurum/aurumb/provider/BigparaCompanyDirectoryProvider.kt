package io.aurum.aurumb.provider

import io.aurum.common.provider.*
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

class BigparaCompanyDirectoryProvider(
    private val client:OkHttpClient,
    private val clock:()->Instant={Instant.now()}
):CompanyDirectoryProvider {
    override val id="BIGPARA_LIST"

    override fun fetch():CompanyDirectoryResult {
        val requestedAt=clock()
        val request=Request.Builder()
            .url("https://bigpara.hurriyet.com.tr/api/v1/hisse/list")
            .header("Accept","application/json")
            .header("User-Agent","Aurum/1.0")
            .get().build()
        return try {
            client.newCall(request).execute().use { response ->
                val receivedAt=clock()
                if(!response.isSuccessful) return CompanyDirectoryResult.Failure(id,"HTTP_"+response.code,"Bigpara HTTP "+response.code,response.code==429||response.code>=500,requestedAt,receivedAt)
                val bytes=response.body?.bytes() ?: return CompanyDirectoryResult.Failure(id,"EMPTY_BODY","Bigpara returned no body",true,requestedAt,receivedAt)
                if(bytes.size>4_000_000) return CompanyDirectoryResult.Failure(id,"BODY_TOO_LARGE","Bigpara response exceeds bound",false,requestedAt,receivedAt)
                val fp=Fingerprint.sha256(bytes)
                var raw=String(bytes,Charsets.UTF_8).trim()
                if(raw.startsWith(""") && raw.endsWith(""")) raw=JSONObject("{\"x\":"+raw+"}").getString("x")
                val root=when {
                    raw.startsWith("{") -> JSONObject(raw)
                    raw.startsWith("[") -> JSONArray(raw)
                    else -> return CompanyDirectoryResult.Failure(id,"PARSE","Bigpara root is not JSON object/array",false,requestedAt,receivedAt)
                }
                val arrays=mutableListOf<JSONArray>()
                collectArrays(root,arrays)
                val arr=arrays.maxByOrNull{it.length()} ?: JSONArray()
                val entries=(0 until arr.length()).mapNotNull { i ->
                    val x=arr.optJSONObject(i) ?: return@mapNotNull null
                    val symbol=listOf("kod","sembol","symbol","code","hisseKodu").firstNotNullOfOrNull{k->x.optString(k).takeIf{it.isNotBlank()}}
                        ?.uppercase()?.trim() ?: return@mapNotNull null
                    if(symbol.length>7 || !symbol.matches(Regex("[A-ZÇĞİÖŞÜ0-9]{2,7}"))) return@mapNotNull null
                    val name=listOf("ad","unvan","name","aciklama").firstNotNullOfOrNull{k->x.optString(k).takeIf{it.isNotBlank()}} ?: symbol
                    CompanyDirectoryEntry(symbol,name,null,id,receivedAt,fp)
                }.distinctBy{it.symbol}.sortedBy{it.symbol}
                if(entries.size<100) CompanyDirectoryResult.Failure(id,"INSUFFICIENT_DIRECTORY","Bigpara parsed "+entries.size+" companies",true,requestedAt,receivedAt)
                else CompanyDirectoryResult.Success(id,entries,requestedAt,receivedAt,fp)
            }
        } catch(t:Throwable) {
            CompanyDirectoryResult.Failure(id,"NETWORK_OR_PARSE",t.message?.take(200)?:"Bigpara failure",true,requestedAt,clock())
        }
    }

    private fun collectArrays(value:Any?,out:MutableList<JSONArray>) {
        when(value) {
            is JSONArray -> {
                if(value.length()>100) out += value
                for(i in 0 until value.length()) collectArrays(value.opt(i),out)
            }
            is JSONObject -> value.keys().forEachRemaining { key -> collectArrays(value.opt(key),out) }
        }
    }
}
