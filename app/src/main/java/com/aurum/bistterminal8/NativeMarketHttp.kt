package com.aurum.bistterminal8

import org.json.JSONObject
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

object NativeMarketHttp {
    private val active = ConcurrentHashMap<String, HttpURLConnection>()
    private val cancelled = ConcurrentHashMap.newKeySet<String>()

    private val allowedHosts = setOf(
        "www.isyatirim.com.tr", "isyatirim.com.tr",
        "static.altinkaynak.com",
        "query1.finance.yahoo.com", "query2.finance.yahoo.com",
        "bigpara.hurriyet.com.tr", "www.bigpara.hurriyet.com.tr",
        "web-paragaranti-pubsub.foreks.com",
        "stooq.com", "www.stooq.com",
        "www.kap.org.tr", "kap.org.tr",
        "www.borsaistanbul.com", "borsaistanbul.com",
        "news.google.com", "feeds.nos.nl", "www.tcmb.gov.tr", "tcmb.gov.tr",
        "script.google.com", "script.googleusercontent.com",
        "theunat.com", "www.theunat.com",
        "borsaistanbulcanli.com", "www.borsaistanbulcanli.com",
        "api.genelpara.com",
        "borsamatik.com", "www.borsamatik.com.tr", "borsamatik.com.tr",
        "bilancoveri.com", "www.bilancoveri.com", "api.asenax.com", "api.bist-api.com"
    )

    private val responseHeaderBlocklist = setOf(
        "set-cookie", "set-cookie2", "www-authenticate", "proxy-authenticate"
    )

    fun allowed(url: URL): Boolean =
        url.protocol.equals("https", ignoreCase = true) &&
            url.host.lowercase() in allowedHosts

    fun cancel(id: String) {
        if (id.isBlank()) return
        cancelled.add(id)
        active.remove(id)?.disconnect()
    }

    fun request(
        @Suppress("UNUSED_PARAMETER") context: android.content.Context,
        id: String,
        method: String,
        rawUrl: String,
        body: String,
        timeoutMs: Int,
        callback: (String) -> Unit
    ) {
        if (id.isBlank()) {
            callback(errorPayload("MISSING_REQUEST_ID", "İstek kimliği eksik"))
            return
        }
        if (active.containsKey(id)) {
            callback(errorPayload("DUPLICATE_REQUEST_ID", "Aynı istek kimliği zaten çalışıyor"))
            return
        }
        cancelled.remove(id)

        thread(name = "AurumMarketHttp-" + id.take(24)) {
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
                    if (cancelled.contains(id)) throw RequestCancelled()
                    connection = (url.openConnection() as HttpURLConnection).apply {
                        instanceFollowRedirects = false
                        requestMethod = verb
                        connectTimeout = timeoutMs
                        readTimeout = timeoutMs
                        useCaches = false
                        setRequestProperty("Accept", "*/*")
                        setRequestProperty("User-Agent", "AurumB-REV20/5 Android")
                        for (key in headers.keys()) {
                            if (key.equals("Accept", true) ||
                                key.equals("Referer", true) ||
                                key.equals("X-Requested-With", true)
                            ) {
                                setRequestProperty(key, headers.optString(key))
                            }
                        }
                    }
                    active[id] = connection
                    val status = connection.responseCode
                    if (cancelled.contains(id)) throw RequestCancelled()

                    if (status in 300..399) {
                        val location = connection.getHeaderField("Location")
                            ?: throw IllegalStateException("HTTP " + status + " yönlendirmesi konumsuz")
                        if (++redirects > 5) throw IllegalStateException("Çok fazla HTTP yönlendirmesi")
                        val next = URL(url, location)
                        if (!allowed(next)) {
                            throw IllegalStateException("Yönlendirme izin verilmeyen hosta gidiyor")
                        }
                        connection.disconnect()
                        active.remove(id, connection)
                        url = next
                        continue
                    }

                    val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                    val responseBody = if (verb == "HEAD") "" else
                        stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()

                    val responseHeaders = JSONObject()
                    connection.headerFields.orEmpty().forEach { (name, values) ->
                        if (name != null && name.lowercase() !in responseHeaderBlocklist && !values.isNullOrEmpty()) {
                            responseHeaders.put(name.lowercase(), values.joinToString(", "))
                        }
                    }

                    callback(
                        JSONObject()
                            .put("ok", status in 200..299)
                            .put("status", status)
                            .put("url", url.toString())
                            .put("headers", responseHeaders)
                            .put("body", responseBody)
                            .put("networkError", JSONObject.NULL)
                            .toString()
                    )
                    break
                }
            } catch (_: RequestCancelled) {
                callback(errorPayload("CANCELLED", "İstek iptal edildi"))
            } catch (t: SocketTimeoutException) {
                callback(errorPayload("TIMEOUT", t.message ?: "İstek zaman aşımına uğradı"))
            } catch (t: UnknownHostException) {
                callback(errorPayload("DNS", t.message ?: "Sunucu adı çözümlenemedi"))
            } catch (t: ConnectException) {
                callback(errorPayload("CONNECTION", t.message ?: "Sunucuya bağlanılamadı"))
            } catch (t: SecurityException) {
                callback(errorPayload("SECURITY", t.message ?: "Güvenlik politikası isteği reddetti"))
            } catch (t: Throwable) {
                callback(errorPayload("NETWORK", t.message ?: "Native veri isteği başarısız"))
            } finally {
                active.remove(id)
                cancelled.remove(id)
                connection?.disconnect()
            }
        }
    }

    private fun errorPayload(code: String, message: String): String =
        JSONObject()
            .put("ok", false)
            .put("status", 0)
            .put("error", message)
            .put("networkError", code)
            .toString()

    private class RequestCancelled : RuntimeException()
}
