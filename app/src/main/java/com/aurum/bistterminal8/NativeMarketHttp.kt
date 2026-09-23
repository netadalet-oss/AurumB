package com.aurum.bistterminal8

// RECONSTRUCTED_FROM_DEX
// DEX proves request/cancel/allowed and asynchronous execution.
// Host policy and request envelope are constrained by APK-exact native-market-http.js.

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

object NativeMarketHttp {
    private val active = ConcurrentHashMap<String, HttpURLConnection>()
    private val allowedHosts = setOf(
        "www.isyatirim.com.tr", "isyatirim.com.tr",
        "query1.finance.yahoo.com", "query2.finance.yahoo.com",
        "bigpara.hurriyet.com.tr", "www.bigpara.hurriyet.com.tr",
        "web-paragaranti-pubsub.foreks.com",
        "stooq.com", "www.stooq.com",
        "www.kap.org.tr", "kap.org.tr",
        "www.borsaistanbul.com", "borsaistanbul.com",
        "news.google.com", "www.tcmb.gov.tr", "tcmb.gov.tr",
        "script.google.com", "script.googleusercontent.com",
        "theunat.com", "www.theunat.com",
        "borsaistanbulcanli.com", "www.borsaistanbulcanli.com"
    )

    fun allowed(url: URL): Boolean =
        url.protocol.equals("https", ignoreCase = true) &&
            url.host.lowercase() in allowedHosts

    fun cancel(id: String) {
        active.remove(id)?.disconnect()
    }

    fun request(
        context: Context,
        id: String,
        method: String,
        rawUrl: String,
        body: String,
        timeoutMs: Int,
        callback: (String) -> Unit
    ) {
        thread(name = "AurumMarketHttp-$id") {
            var connection: HttpURLConnection? = null
            try {
                val verb = method.uppercase()
                require(verb == "GET" || verb == "HEAD") { "Yalnız GET/HEAD desteklenir" }
                val envelope = runCatching { JSONObject(body) }.getOrElse { JSONObject() }
                val headers = envelope.optJSONObject("headers") ?: JSONObject()
                var url = URL(rawUrl)
                require(allowed(url)) { "İzin verilmeyen veri sağlayıcısı" }

                var redirects = 0
                while (true) {
                    connection = (url.openConnection() as HttpURLConnection).apply {
                        instanceFollowRedirects = false
                        requestMethod = verb
                        connectTimeout = timeoutMs
                        readTimeout = timeoutMs
                        useCaches = false
                        setRequestProperty("Accept", "*/*")
                        setRequestProperty("User-Agent", "AurumB-REV20/4 Android")
                        for (key in headers.keys()) {
                            if (key.equals("Accept", true) ||
                                key.equals("Referer", true) ||
                                key.equals("X-Requested-With", true)
                            ) setRequestProperty(key, headers.optString(key))
                        }
                    }
                    active[id] = connection
                    val status = connection.responseCode
                    if (status in 300..399) {
                        val location = connection.getHeaderField("Location")
                            ?: throw IllegalStateException("HTTP $status yönlendirmesi konumsuz")
                        if (++redirects > 5) throw IllegalStateException("Çok fazla HTTP yönlendirmesi")
                        val next = URL(url, location)
                        if (!allowed(next)) throw IllegalStateException("Yönlendirme izin verilmeyen hosta gidiyor")
                        connection.disconnect()
                        url = next
                        continue
                    }

                    val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                    val responseBody = if (verb == "HEAD") "" else
                        stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                    val responseHeaders = JSONObject()
                    fun header(name: String) {
                        connection.getHeaderField(name)?.let { responseHeaders.put(name.lowercase(), it) }
                    }
                    header("Content-Type"); header("Retry-After"); header("Date")
                    callback(JSONObject()
                        .put("ok", status in 200..299)
                        .put("status", status)
                        .put("url", url.toString())
                        .put("headers", responseHeaders)
                        .put("body", responseBody)
                        .toString())
                    break
                }
            } catch (t: Throwable) {
                callback(JSONObject()
                    .put("ok", false)
                    .put("status", 0)
                    .put("error", t.message ?: "Native veri isteği başarısız")
                    .toString())
            } finally {
                active.remove(id)
                connection?.disconnect()
            }
        }
    }
}
