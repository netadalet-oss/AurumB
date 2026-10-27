package io.aurum.aurumb.exchange

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.nio.charset.StandardCharsets
import java.security.MessageDigest

@RunWith(AndroidJUnit4::class)
class DataExchangeIntegrityTest {
    @Test
    fun snapshotValidatesAndRoundTripsWithoutLosingSchema() {
        val context=ApplicationProvider.getApplicationContext<Context>()
        val service=DataExchangeService(context)
        val snapshot=service.snapshotJson()

        service.validatePayload(snapshot,replaceAll=false)
        val report=service.restorePayload(snapshot,replaceAll=false)

        assertTrue(report.tables>0)
        assertTrue(report.rows>=0)
        service.validatePayload(service.snapshotJson(),replaceAll=false)
    }

    @Test
    fun selectiveSnapshotContainsOnlyChosenTablesAndKeepsIntegrity() {
        val context=ApplicationProvider.getApplicationContext<Context>()
        val service=DataExchangeService(context)
        val all=service.snapshotJson()
        val names=all.getJSONObject("tables").keys().asSequence().toList().sorted()
        assertTrue(names.isNotEmpty())
        val chosen=names.first()

        val selected=service.snapshotJson(setOf(chosen))
        service.validatePayload(selected,replaceAll=false)
        val selectedNames=selected.getJSONObject("tables").keys().asSequence().toList()

        assertTrue(selectedNames==listOf(chosen))
        assertTrue(selected.getString("payloadSha256").matches(Regex("[a-f0-9]{64}")))
    }

    @Test
    fun explicitlyClearedSelectionDoesNotFallBackToAllTables() {
        val context=ApplicationProvider.getApplicationContext<Context>()
        val service=DataExchangeService(context)

        val rejected=runCatching { service.snapshotJson(emptySet()) }.exceptionOrNull()

        assertTrue(rejected is IllegalArgumentException)
        assertTrue(rejected?.message?.contains("EXPORT_NO_TABLE_SELECTED")==true)
    }

    @Test
    fun tamperedSnapshotIsRejectedBeforeMutation() {
        val context=ApplicationProvider.getApplicationContext<Context>()
        val service=DataExchangeService(context)
        val snapshot=JSONObject(service.snapshotJson().toString())
        snapshot.put("generatedAtUtc","2099-01-01T00:00:00Z")

        val rejected=runCatching {
            service.validatePayload(snapshot,replaceAll=false)
        }.exceptionOrNull()

        assertTrue(rejected is IllegalArgumentException)
        assertTrue(rejected?.message?.contains("IMPORT_CHECKSUM_MISMATCH")==true)
    }
    @Test
    fun olderCompatibleSchemaIsAcceptedButNewerSchemaIsRejected() {
        val context=ApplicationProvider.getApplicationContext<Context>()
        val service=DataExchangeService(context)
        val current=service.snapshotJson()
        val currentVersion=current.getInt("sqliteUserVersion")

        if(currentVersion>1) {
            val older=JSONObject(current.toString())
            older.put("sqliteUserVersion",currentVersion-1)
            older.remove("payloadSha256")
            older.put(
                "payloadSha256",
                sha256(canonical(older).toByteArray(StandardCharsets.UTF_8))
            )
            service.validatePayload(older,replaceAll=true)
        }

        val newer=JSONObject(current.toString())
        newer.put("sqliteUserVersion",currentVersion+1)
        val rejected=runCatching {
            service.validatePayload(newer,replaceAll=true)
        }.exceptionOrNull()
        assertTrue(rejected is IllegalArgumentException)
        assertTrue(rejected?.message?.contains("IMPORT_SCHEMA_VERSION_UNSUPPORTED")==true)
    }

    private fun canonical(value:Any?):String = when(value) {
        null,JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().sorted().joinToString(
            prefix="{",postfix="}",separator=","
        ) { key -> JSONObject.quote(key)+":"+canonical(value.opt(key)) }
        is JSONArray -> (0 until value.length()).joinToString(
            prefix="[",postfix="]",separator=","
        ) { i -> canonical(value.opt(i)) }
        is String -> JSONObject.quote(value)
        is Number,is Boolean -> value.toString()
        else -> JSONObject.quote(value.toString())
    }

    private fun sha256(bytes:ByteArray):String =
        MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString(""){"%02x".format(it)}

}
