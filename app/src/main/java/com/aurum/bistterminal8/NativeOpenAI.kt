package com.aurum.bistterminal8

// RECONSTRUCTED_FROM_DEX
// DEX proves the request surface, api.openai.com and asynchronous worker.
// API credentials are obtained from SecureSecretStore, never from WebView storage.

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

object NativeOpenAI {
    fun request(
        context: Context,
        id: String,
        endpoint: String,
        body: String,
        callback: (String) -> Unit
    ) {
        thread(name = "AurumOpenAI-$id") {
            var connection: HttpURLConnection? = null
            try {
                val apiKey = SecureSecretStore.get(context)
                require(apiKey.isNotBlank()) { "OPENAI_API_KEY_NOT_CONFIGURED" }

                val path = endpoint.trim().removePrefix("/")
                val url = URL("https://api.openai.com/$path")
                connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 30_000
                    readTimeout = 120_000
                    useCaches = false
                    doOutput = true
                    setRequestProperty("Authorization", "Bearer $apiKey")
                    setRequestProperty("Content-Type", "application/json")
                    outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                }

                val status = connection.responseCode
                val stream = if (status in 200..399) connection.inputStream else connection.errorStream
                val responseBody = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                callback(
                    JSONObject()
                        .put("ok", status in 200..299)
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
                connection?.disconnect()
            }
        }
    }
}
