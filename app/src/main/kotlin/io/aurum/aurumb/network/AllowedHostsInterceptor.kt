package io.aurum.aurumb.network

import okhttp3.Interceptor
import okhttp3.Response

class AllowedHostsInterceptor(private val hosts:Set<String>):Interceptor {
    init { require(hosts.isNotEmpty()); require(hosts.all{it==it.lowercase() && '/' !in it}) }
    override fun intercept(chain:Interceptor.Chain):Response {
        val request=chain.request()
        val host=request.url.host.lowercase()
        require(request.url.isHttps) { "HTTPS_REQUIRED" }
        require(host in hosts) { "HOST_NOT_ALLOWED" }
        return chain.proceed(request)
    }
}
