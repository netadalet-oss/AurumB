package com.aurum.bistterminal8

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SavedRelayPolicyTest {
    @Test
    fun canonicalAcceptsOnlyHttpsExecWithToken() {
        assertEquals(
            "https://script.google.com/macros/s/ABC123/exec|token=secret",
            SavedRelayPolicy.canonical("https://script.google.com/macros/s/ABC123/exec?token=secret")
        )
        assertNull(SavedRelayPolicy.canonical("http://script.google.com/macros/s/ABC123/exec?token=secret"))
        assertNull(SavedRelayPolicy.canonical("https://script.google.com/home?token=secret"))
        assertNull(SavedRelayPolicy.canonical("https://script.google.com/macros/s/ABC123/exec"))
        assertNull(SavedRelayPolicy.canonical("https://example.com/macros/s/ABC123/exec?token=secret"))
    }

    @Test
    fun canonicalIgnoresUnrelatedQueryButBindsToken() {
        assertEquals(
            "https://script.google.com/macros/s/ABC123/exec|token=a b",
            SavedRelayPolicy.canonical("https://script.google.com/macros/s/ABC123/exec?mode=send&token=a%20b&x=1")
        )
    }
}
