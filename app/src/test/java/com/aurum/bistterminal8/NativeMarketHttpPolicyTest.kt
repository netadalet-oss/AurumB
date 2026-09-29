package com.aurum.bistterminal8

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URL

class NativeMarketHttpPolicyTest {
    @Test
    fun requiresHttpsAndAllowlistedHost() {
        assertTrue(NativeMarketHttp.allowed(URL("https://query1.finance.yahoo.com/v8/finance/chart/XU100.IS")))
        assertFalse(NativeMarketHttp.allowed(URL("http://query1.finance.yahoo.com/v8/finance/chart/XU100.IS")))
        assertFalse(NativeMarketHttp.allowed(URL("https://example.com/data")))
    }

    @Test
    fun appsScriptEntryIsStructurallyNarrowAndRedirectHostIsNotDirectlyCallable() {
        assertTrue(NativeMarketHttp.allowed(URL("https://script.google.com/macros/s/ABC123/exec?token=secret")))
        assertFalse(NativeMarketHttp.allowed(URL("https://script.google.com/home?token=secret")))
        assertFalse(NativeMarketHttp.allowed(URL("https://script.googleusercontent.com/macros/echo?x=1")))
    }
}
