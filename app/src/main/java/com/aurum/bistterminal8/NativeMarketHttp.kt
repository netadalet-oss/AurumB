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
        "script.google.com", "script.googleusercontent.com"
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
                val url = URL(rawUrl)
                require(allowed(url)) { "URL_NOT_ALLOWED" }
                val envelope = runCatching { JSONObject(body) }.getOrElse { JSONObject() }
                val headers = envelope.optJSONObject("headers") ?: JSONObject()

                connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = method.uppercase()
                    connectTimeout = timeoutMs
                    readTimeout = timeoutMs
                    useCaches = false
                    for (key in headers.keys()) {
                        setRequestProperty(key, headers.optString(key))
                    }
                }
                active[id] = connection
                val status = connection.responseCode
                val stream = if (status in 200..399) connection.inputStream else connection.errorStream
                val responseBody = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                val responseHeaders = JSONObject()
                connection.headerFields.filterKeys { it != null }.forEach { (k, v) ->
                    responseHeaders.put(k, v.joinToString(", "))
                }
                callback(JSONObject()
                    .put("ok", status in 200..299)
                    .put("status", status)
                    .put("url", url.toString())
                    .put("headers", responseHeaders)
                    .put("body", responseBody)
                    .toString())
            } catch (t: Throwable) {
                callback(JSONObject()
                    .put("ok", false)
                    .put("status", 0)
                    .put("error", t.message ?: t.javaClass.simpleName)
                    .toString())
            } finally {
                active.remove(id)
                connection?.disconnect()
            }
        }
    }
}
