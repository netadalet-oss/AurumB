package com.aurum.bistterminal8

// RECONSTRUCTED_FROM_DEX
// OpenAI host, path policy, method/body behavior and response envelope are DEX-proven.

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

object NativeOpenAI {
    fun request(
        context: Context,
        path: String,
        method: String,
        body: String,
        callback: (String) -> Unit
    ) {
        thread(name = "AurumOpenAI") {
            var connection: HttpURLConnection? = null
            try {
                val verb = method.uppercase()
                val allowed = (path == "/v1/models" && verb == "GET") ||
                    (path == "/v1/responses" && verb == "POST")
                require(allowed) { "OpenAI path/method izinli değil" }
                val apiKey = SecureSecretStore.get(context)
                if (apiKey.isBlank()) throw IllegalStateException("OpenAI API anahtarı kayıtlı değil")
                val url = URL("https", "api.openai.com", path)
                connection = (url.openConnection() as HttpURLConnection).apply {
                    instanceFollowRedirects = false
                    connectTimeout = 30_000
                    readTimeout = 120_000
                    requestMethod = verb
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("Authorization", "Bearer $apiKey")
                    if (verb != "GET" && verb != "HEAD") {
                        doOutput = true
                        setRequestProperty("Content-Type", "application/json")
                        outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                    }
                }
                val status = connection.responseCode
                if (status in 300..399) throw IllegalStateException("OpenAI redirect reddedildi")
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val responseBody = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                callback(
                    JSONObject()
                        .put("status", status)
                        .put("ok", status in 200..299)
                        .put("requestId", connection.getHeaderField("x-request-id"))
                        .put("path", path)
                        .put("method", verb)
                        .put("body", responseBody)
                        .toString()
                )
            } catch (t: Throwable) {
                callback(
                    JSONObject()
                        .put("status", 0)
                        .put("ok", false)
                        .put("error", t.message ?: "Native OpenAI hatası")
                        .toString()
                )
            } finally {
                connection?.disconnect()
            }
        }
    }
}
