package com.aurum.bistterminal8

// RECONSTRUCTED_FROM_DEX
// DEX proves request/cancel/allowed and asynchronous execution.
// The exact original Kotlin syntax is not claimed.

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

object NativeMarketHttp {
    private val active = ConcurrentHashMap<String, HttpURLConnection>()

    fun allowed(url: URL): Boolean {
        if (!url.protocol.equals("https", ignoreCase = true)) return false
        val host = url.host.lowercase()
        return host.isNotBlank() && !host.contains("localhost") && host != "127.0.0.1"
    }

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
                connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = method.uppercase()
                    connectTimeout = timeoutMs
                    readTimeout = timeoutMs
                    useCaches = false
                    setRequestProperty("Accept", "application/json,text/plain,*/*")
                    if (body.isNotEmpty()) {
                        doOutput = true
                        setRequestProperty("Content-Type", "application/json; charset=utf-8")
                        outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                    }
                }
                active[id] = connection
                val status = connection.responseCode
                val stream = if (status in 200..399) connection.inputStream else connection.errorStream
                val responseBody = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                callback(
                    JSONObject()
                        .put("ok", true)
                        .put("status", status)
                        .put("body", responseBody)
                        .toString()
                )
            } catch (t: Throwable) {
                callback(
                    JSONObject()
                        .put("ok", false)
                        .put("error", t.message ?: t.javaClass.simpleName)
                        .toString()
                )
            } finally {
                active.remove(id)
                connection?.disconnect()
            }
        }
    }
}
