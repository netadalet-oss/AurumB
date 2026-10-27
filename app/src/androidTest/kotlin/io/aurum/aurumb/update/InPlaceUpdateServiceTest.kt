package io.aurum.aurumb.update

import android.content.Context
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class InPlaceUpdateServiceTest {
    @Test
    fun installedApkRetainsPackageAndSignerEvidence()=runBlocking {
        val context=ApplicationProvider.getApplicationContext<Context>()
        val result=InPlaceUpdateService(context).inspect(
            Uri.fromFile(File(context.applicationInfo.sourceDir))
        )
        assertEquals(context.packageName,result.packageName)
        assertTrue(result.signerMatches)
        assertTrue(result.reason,result.accepted)
        assertEquals("VERIFIED_IN_PLACE_UPDATE",result.reason)
    }

    @Test
    fun anotherPackageIsRejectedEvenWhenSignedWithTheSameDebugKey()=runBlocking {
        val context=ApplicationProvider.getApplicationContext<Context>()
        val other=InstrumentationRegistry.getInstrumentation().context
        val result=InPlaceUpdateService(context).inspect(
            Uri.fromFile(File(other.applicationInfo.sourceDir))
        )
        assertEquals(other.packageName,result.packageName)
        assertFalse(result.accepted)
        assertEquals("APK_PACKAGE_MISMATCH",result.reason)
    }
}
