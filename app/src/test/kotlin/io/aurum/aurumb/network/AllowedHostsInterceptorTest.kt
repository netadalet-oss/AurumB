package io.aurum.aurumb.network

import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.assertTrue
import org.junit.Test

class AllowedHostsInterceptorTest {
    @Test fun rejectsHttpBeforeNetwork() {
        val client=OkHttpClient.Builder().addInterceptor(AllowedHostsInterceptor(setOf("example.com"))).build()
        val failure=runCatching{client.newCall(Request.Builder().url("http://example.com/").build()).execute()}
        assertTrue(failure.isFailure)
    }

    @Test fun rejectsUnknownHttpsHostBeforeNetwork() {
        val client=OkHttpClient.Builder().addInterceptor(AllowedHostsInterceptor(setOf("example.com"))).build()
        val failure=runCatching{client.newCall(Request.Builder().url("https://invalid.example/").build()).execute()}
        assertTrue(failure.isFailure)
    }
}
