package io.aurum.aurumb.network

import okhttp3.OkHttpClient
import java.time.Duration

object HttpClientFactory {
    val MARKET_HOSTS=setOf(
        "query1.finance.yahoo.com",
            "query2.finance.yahoo.com",
            "www.borsamatik.com.tr",
            "static.altinkaynak.com",
            "www.isyatirim.com.tr",
            "feeds.nos.nl",
            "web-paragaranti-pubsub.foreks.com",
            "stooq.com",
        "www.tcmb.gov.tr",
        "bigpara.hurriyet.com.tr",
        "www.kap.org.tr",
        "data-api.ecb.europa.eu",
        "news.google.com"
    )

    fun market():OkHttpClient=OkHttpClient.Builder()
        .followRedirects(false)
        .followSslRedirects(false)
        .connectTimeout(Duration.ofSeconds(10))
        .readTimeout(Duration.ofSeconds(15))
        .writeTimeout(Duration.ofSeconds(15))
        .callTimeout(Duration.ofSeconds(20))
        .addInterceptor(AllowedHostsInterceptor(MARKET_HOSTS))
        .build()

    fun aiGateway(host:String):OkHttpClient {
        val canonical=host.lowercase().trim()
        require(canonical.isNotBlank())
        return OkHttpClient.Builder()
            .followRedirects(false)
            .followSslRedirects(false)
            .connectTimeout(Duration.ofSeconds(8))
            .readTimeout(Duration.ofSeconds(25))
            .callTimeout(Duration.ofSeconds(30))
            .addInterceptor(AllowedHostsInterceptor(setOf(canonical)))
            .build()
    }
}
