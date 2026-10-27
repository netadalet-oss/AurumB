package io.aurum.aurumb.update

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import io.aurum.aurumb.settings.SettingsRepository
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RuntimePatchServiceTest {
    @Test
    fun checksumIsMandatoryAndTamperingIsRejectedBeforeApply() {
        val context=ApplicationProvider.getApplicationContext<Context>()
        val service=RuntimePatchService(context)

        val missing=JSONObject()
            .put("format","AURUM_RUNTIME_PATCH_V1")
            .put("product","B")
            .put("patchId","test-missing-checksum")

        val missingError=runCatching { service.apply(missing) }.exceptionOrNull()
        assertTrue(missingError is IllegalArgumentException)
        assertTrue(missingError?.message?.contains("PATCH_CHECKSUM_REQUIRED")==true)

        val bad=JSONObject(missing.toString())
            .put("patchId","test-bad-checksum")
            .put("payloadSha256","0".repeat(64))
        val badError=runCatching { service.apply(bad) }.exceptionOrNull()
        assertTrue(badError is IllegalArgumentException)
        assertTrue(badError?.message?.contains("PATCH_CHECKSUM_MISMATCH")==true)
    }
    @Test
    fun settingsValidationRejectsCrossPolicyAndUnknownKeysWithoutWrites() {
        val context=ApplicationProvider.getApplicationContext<Context>()
        val repo=SettingsRepository(context)
        val before=repo.load().first
        val prefs=context.getSharedPreferences("aurumb.settings.v1",Context.MODE_PRIVATE)
        val persistedBefore=prefs.all.toMap()
        val valid=before.toMutableMap().apply { put("maxStopLossPct","4") }
        assertTrue(repo.validate(valid))
        val invalid=valid.toMutableMap().apply {
            put("transferQualityTier2Pct",getValue("transferQualityTier1Pct"))
        }
        assertFalse(repo.validate(invalid))
        assertFalse(repo.validate(valid+mapOf("unknownSetting" to "1")))
        assertEquals(persistedBefore,prefs.all)
        assertEquals(before,repo.load().first)
    }
}
