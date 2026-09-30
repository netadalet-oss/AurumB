package com.aurum.bistterminal8

import org.junit.Assert.assertEquals
import org.junit.Test

class PublicationBusTest {
    @Test
    fun publishOnlyReachesAttachedForegroundListener() {
        var calls = 0
        PublicationBus.attach { calls++ }
        PublicationBus.publish()
        assertEquals(1, calls)

        PublicationBus.detach()
        PublicationBus.publish()
        assertEquals(1, calls)
    }
}
