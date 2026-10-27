package io.aurum.aurumb.update

import android.content.Context
import android.net.Uri
import io.aurum.aurumb.exchange.DataExchangeService
import io.aurum.aurumb.persistence.DataMutationCoordinator
import io.aurum.aurumb.scheduler.AppScheduler
import io.aurum.aurumb.settings.SettingsRepository
import io.aurum.common.settings.SettingsSchema
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalTime

data class RuntimePatchReport(
    val patchId:String,
    val settingsChanged:Int,
    val dataTables:Int,
    val dataRows:Int,
    val schedulerChanged:Boolean
)

class RuntimePatchService(private val context:Context) {
    private val app=context.applicationContext
    private val product="B"
    private val settingsRepo=SettingsRepository(app)
    private val exchange=DataExchangeService(app)

    suspend fun applyFrom(uri:Uri):RuntimePatchReport =
        DataMutationCoordinator.serialized {
            withContext(Dispatchers.IO) {
                val raw=app.contentResolver.openInputStream(uri)?.use{it.readBytes()}
                    ?: throw IllegalArgumentException("PATCH_STREAM_UNAVAILABLE")
                require(raw.size<=MAX_PATCH_BYTES){"PATCH_TOO_LARGE"}
                val root=JSONObject(String(raw,StandardCharsets.UTF_8))
                apply(root)
            }
        }

    fun apply(root:JSONObject):RuntimePatchReport {
        require(root.optString("format")=="AURUM_RUNTIME_PATCH_V1"){"PATCH_FORMAT_UNSUPPORTED"}
        require(root.optString("product")==product){"PATCH_PRODUCT_MISMATCH"}
        val unknown=root.keys().asSequence().filter{it !in ALLOWED_ROOT_KEYS}.toList()
        require(unknown.isEmpty()){"PATCH_UNKNOWN_FIELDS:"+unknown.joinToString(",")}
        val patchId=root.optString("patchId").trim()
        require(patchId.matches(Regex("[A-Za-z0-9._:-]{3,120}"))){"PATCH_ID_INVALID"}
        verifyChecksum(root)

        val previousDb=exchange.snapshotJson()
        val previousSettings=settingsRepo.load().first
        val previousScheduler=AppScheduler.config(app)

        val requestedSettings=linkedMapOf<String,String>()
        root.optJSONObject("settings")?.let { o ->
            o.keys().forEach { key ->
                val spec=runCatching{SettingsSchema.spec(key)}.getOrNull()
                    ?: throw IllegalArgumentException("PATCH_SETTING_UNKNOWN:"+key)
                require(spec.userEditable){"PATCH_SETTING_NOT_USER_EDITABLE:"+key}
                requestedSettings[key]=o.get(key).toString()
            }
        }
        val merged=previousSettings.toMutableMap().apply{putAll(requestedSettings)}
        // Validate before changing any persistent owner.
        if(requestedSettings.isNotEmpty()) {
            require(settingsRepo.validate(merged)){"PATCH_SETTINGS_INVALID"}
        }

        val scheduler=root.optJSONObject("scheduler")?.let(::parseScheduler)
        val dataPayload=root.optJSONObject("dataPayload")
        if(dataPayload!=null) {
            require(dataPayload.optString("format")=="AURUM_DATA_EXCHANGE_V1"){"PATCH_DATA_FORMAT_INVALID"}
            require(dataPayload.optString("product")==product){"PATCH_DATA_PRODUCT_MISMATCH"}
            // Validate the complete incoming exchange payload before any settings,
            // scheduler or database owner is mutated.
            exchange.validatePayload(dataPayload,replaceAll=false)
        }

        var importedTables=0
        var importedRows=0
        try {
            if(requestedSettings.isNotEmpty()) {
                require(settingsRepo.replaceValidated(merged)){"PATCH_SETTINGS_APPLY_FAILED"}
            }
            if(scheduler!=null) {
                AppScheduler.saveConfig(
                    app,scheduler.dataEnabled,scheduler.dataTimes,
                    scheduler.marketEnabled,scheduler.marketTimes
                )
            }
            if(dataPayload!=null) {
                val report=exchange.restorePayload(dataPayload,replaceAll=false)
                importedTables=report.tables
                importedRows=report.rows
            }
            AppScheduler.ensurePeriodic(app)
        } catch(t:Throwable) {
            runCatching{exchange.restorePayload(previousDb,replaceAll=true)}
            runCatching{settingsRepo.replaceValidated(previousSettings)}
            runCatching{
                AppScheduler.saveConfig(
                    app,
                    previousScheduler.dataEnabled,previousScheduler.dataTimes,
                    previousScheduler.marketEnabled,previousScheduler.marketTimes
                )
            }
            throw t
        }

        return RuntimePatchReport(
            patchId=patchId,
            settingsChanged=requestedSettings.size,
            dataTables=importedTables,
            dataRows=importedRows,
            schedulerChanged=scheduler!=null
        )
    }

    private data class ParsedScheduler(
        val dataEnabled:Boolean,
        val dataTimes:List<LocalTime>,
        val marketEnabled:Boolean,
        val marketTimes:List<LocalTime>
    )

    private fun parseScheduler(o:JSONObject):ParsedScheduler {
        val unknown=o.keys().asSequence().filter{it !in SCHEDULER_KEYS}.toList()
        require(unknown.isEmpty()){"PATCH_SCHEDULER_UNKNOWN_FIELDS:"+unknown.joinToString(",")}
        val current=AppScheduler.config(app)
        val dataEnabled=if(o.has("dataEnabled"))o.getBoolean("dataEnabled") else current.dataEnabled
        val marketEnabled=if(o.has("marketEnabled"))o.getBoolean("marketEnabled") else current.marketEnabled
        val dataTimes=if(o.has("dataTimes"))parseTimes(o.getJSONArray("dataTimes")) else current.dataTimes
        val marketTimes=if(o.has("marketTimes"))parseTimes(o.getJSONArray("marketTimes")) else current.marketTimes
        require(!dataEnabled || dataTimes.isNotEmpty()){"PATCH_DATA_SCHEDULE_EMPTY"}
        require(!marketEnabled || marketTimes.isNotEmpty()){"PATCH_MARKET_SCHEDULE_EMPTY"}
        return ParsedScheduler(dataEnabled,dataTimes,marketEnabled,marketTimes)
    }

    private fun parseTimes(a:JSONArray):List<LocalTime> =
        (0 until a.length()).map { i -> LocalTime.parse(a.getString(i)) }.distinct().sorted()

    private fun verifyChecksum(root:JSONObject) {
        val expected=root.optString("payloadSha256").trim().lowercase()
        require(expected.matches(Regex("[a-f0-9]{64}"))){"PATCH_CHECKSUM_REQUIRED"}
        val clone=JSONObject(root.toString()).apply{remove("payloadSha256")}
        val canonical=canonicalJson(clone)
        val actual=MessageDigest.getInstance("SHA-256")
            .digest(canonical.toByteArray(StandardCharsets.UTF_8))
            .joinToString(""){"%02x".format(it)}
        require(actual==expected){"PATCH_CHECKSUM_MISMATCH"}
    }

    private fun canonicalJson(value:Any?):String = when(value) {
        null, JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().sorted().joinToString(prefix="{",postfix="}") { key ->
            JSONObject.quote(key)+":"+canonicalJson(value.get(key))
        }
        is JSONArray -> (0 until value.length()).joinToString(prefix="[",postfix="]") { i ->
            canonicalJson(value.get(i))
        }
        is String -> JSONObject.quote(value)
        is Number, is Boolean -> value.toString()
        else -> JSONObject.quote(value.toString())
    }

    companion object {
        private const val MAX_PATCH_BYTES=32*1024*1024
        private val ALLOWED_ROOT_KEYS=setOf(
            "format","product","patchId","createdAtUtc","notes",
            "settings","scheduler","dataPayload","payloadSha256"
        )
        private val SCHEDULER_KEYS=setOf("dataEnabled","dataTimes","marketEnabled","marketTimes")
    }
}
