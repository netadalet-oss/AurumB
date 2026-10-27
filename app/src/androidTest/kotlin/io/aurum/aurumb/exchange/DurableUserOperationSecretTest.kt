package io.aurum.aurumb.exchange

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import io.aurum.aurumb.security.SecureSecretStore
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import java.time.Instant

@RunWith(AndroidJUnit4::class)
class DurableUserOperationSecretTest {
    @Test
    fun staleOneTimeSecretsAreReapedWithoutTouchingFreshWork() {
        val context=ApplicationProvider.getApplicationContext<Context>()
        val store=SecureSecretStore(context)
        val now=Instant.parse("2026-10-03T00:00:00Z")
        val stale="tmp-backup-"+(now.epochSecond-86_401)+"-stale001"
        val fresh="tmp-restore-"+(now.epochSecond-3_600)+"-fresh001"

        store.put(stale,"stale-passphrase".toCharArray())
        store.put(fresh,"fresh-passphrase".toCharArray())
        try {
            DurableUserOperations.cleanupStaleTemporarySecrets(context,now,86_400)
            assertNull(store.get(stale))
            val freshValue=store.get(fresh)
            assertNotNull(freshValue)
            freshValue?.fill('\u0000')
        } finally {
            store.remove(stale)
            store.remove(fresh)
        }
    }
    @Test fun secretFileIsKeyTxtAndDoesNotContainPlaintext() {
        val context=ApplicationProvider.getApplicationContext<Context>()
        val store=SecureSecretStore(context)
        val name="at-rest-check"; val secret="plain-secret-must-not-appear"
        store.put(name,secret.toCharArray())
        try {
            val file=java.io.File(context.filesDir,"key.txt")
            org.junit.Assert.assertTrue(file.isFile)
            val raw=file.readText(Charsets.UTF_8)
            org.junit.Assert.assertFalse(raw.contains(secret))
            org.junit.Assert.assertTrue(raw.contains(name+"="))
            val roundTrip=store.get(name)
            org.junit.Assert.assertEquals(secret,roundTrip?.concatToString())
            roundTrip?.fill('\u0000')
        } finally { store.remove(name) }
    }
}
