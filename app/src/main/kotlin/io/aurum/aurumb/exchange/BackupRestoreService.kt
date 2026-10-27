package io.aurum.aurumb.exchange

import android.content.Context
import android.net.Uri
import android.util.Base64
import androidx.documentfile.provider.DocumentFile
import io.aurum.aurumb.notification.TradeAlertDeliveryService
import io.aurum.aurumb.persistence.DatabaseFactory
import io.aurum.aurumb.persistence.DataMutationCoordinator
import io.aurum.aurumb.scheduler.AppScheduler
import io.aurum.aurumb.security.SecureSecretStore
import io.aurum.aurumb.settings.SettingsRepository
import io.aurum.common.settings.SettingsSchema
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.time.Instant
import java.time.LocalTime
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

data class BackupRestoreReport(
    val tables:Int,
    val rows:Int,
    val settings:Int,
    val secrets:Int
)

class BackupRestoreService(private val context:Context) {
    private val app=context.applicationContext
    private val product="B"
    private val exchange=DataExchangeService(app)
    private val settings=SettingsRepository(app)
    private val secrets=SecureSecretStore(app)
    private val recovery=RestoreRecoveryJournal(app)
    private val exchangePrefs=app.getSharedPreferences("aurumb.exchange.v1",Context.MODE_PRIVATE)

    suspend fun backupToTree(treeUri:Uri,passphrase:CharArray):Uri =
        DataMutationCoordinator.serialized {
            withContext(Dispatchers.IO) {
                require(passphrase.size>=8){"BACKUP_PASSPHRASE_MIN_8"}
                try {
                    val plain=buildZip()
                    val wrapper=try { encrypt(plain,passphrase) } finally { plain.fill(0) }
                    val tree=DocumentFile.fromTreeUri(app,treeUri)
                        ?: throw IllegalArgumentException("BACKUP_FOLDER_UNAVAILABLE")
                    val name="Aurum_"+product+"_FULL_"+Instant.now().toString().replace(":","-")+".aurumbackup"
                    val file=tree.createFile("application/octet-stream",name)
                        ?: throw IllegalStateException("BACKUP_FILE_CREATE_FAILED")
                    app.contentResolver.openOutputStream(file.uri,"w")?.use {
                        it.write(wrapper.toString().toByteArray(StandardCharsets.UTF_8))
                    } ?: throw IllegalStateException("BACKUP_STREAM_UNAVAILABLE")
                    file.uri
                } finally {
                    passphrase.fill('\u0000')
                }
            }
        }

    suspend fun restoreFrom(uri:Uri,passphrase:CharArray):BackupRestoreReport =
        DataMutationCoordinator.serialized {
            withContext(Dispatchers.IO) {
                require(passphrase.size>=8){"BACKUP_PASSPHRASE_MIN_8"}
                try {
                    val wrapper=app.contentResolver.openInputStream(uri)?.use {
                        JSONObject(String(it.readBytes(),StandardCharsets.UTF_8))
                    } ?: throw IllegalArgumentException("BACKUP_STREAM_UNAVAILABLE")
                    require(wrapper.optString("format")=="AURUM_ENCRYPTED_BACKUP_V1"){"BACKUP_FORMAT_UNSUPPORTED"}
                    require(wrapper.optString("product")==product){"BACKUP_PRODUCT_MISMATCH"}
                    val zip=decrypt(wrapper,passphrase)
                    val incomingEntries=try { unzip(zip) } finally { zip.fill(0) }

                    // Validate the package before creating a rollback journal.
                    validateEntries(incomingEntries)

                    val rollbackZip=buildZip()
                    try { recovery.write(rollbackZip) } finally { rollbackZip.fill(0) }

                    try {
                        val report=applyEntries(incomingEntries,reinstallScheduler=true)
                        recovery.clear()
                        report
                    } catch(t:Throwable) {
                        val rolledBack=runCatching { recoverJournalInternal(reinstallScheduler=true) }.getOrDefault(false)
                        val code=if(rolledBack)
                            "BACKUP_RESTORE_ROLLED_BACK:"
                        else
                            "BACKUP_RESTORE_RECOVERY_PENDING:"
                        throw IllegalStateException(code+t::class.java.simpleName,t)
                    }
                } finally {
                    passphrase.fill('\u0000')
                }
            }
        }

    /**
     * Runs at process start before normal scheduling. If Android killed the
     * process during a full restore, the previous complete state is restored
     * idempotently from the app-private Keystore-encrypted journal.
     */
    suspend fun recoverInterruptedRestore():Boolean =
        DataMutationCoordinator.serialized {
            withContext(Dispatchers.IO) { recoverJournalInternal(reinstallScheduler=false) }
        }

    private fun recoverJournalInternal(reinstallScheduler:Boolean):Boolean {
        val zip=recovery.read() ?: return false
        return try {
            val entries=unzip(zip)
            validateEntries(entries)
            applyEntries(entries,reinstallScheduler)
            recovery.clear()
            true
        } finally {
            zip.fill(0)
        }
    }

    private fun validateEntries(entries:Map<String,String>) {
        val manifest=JSONObject(requireNotNull(entries["manifest.json"]){"BACKUP_MANIFEST_MISSING"})
        require(manifest.optString("product")==product){"BACKUP_PRODUCT_MISMATCH"}

        val dbPayload=JSONObject(requireNotNull(entries["database.json"]){"BACKUP_DATABASE_MISSING"})
        exchange.validatePayload(dbPayload,replaceAll=true)

        val settingsObj=JSONObject(requireNotNull(entries["settings.json"]){"BACKUP_SETTINGS_MISSING"})
        val settingsMap=settingsObj.keys().asSequence().associateWith{settingsObj.getString(it)}
        require(settings.validate(settingsMap)){"BACKUP_SETTINGS_INVALID"}

        val secretsObj=JSONObject(entries["secrets.json"]?:"{}")
        secretsObj.keys().forEach { name ->
            require(name.matches(Regex("[A-Za-z0-9._:-]{1,120}"))){"BACKUP_SECRET_NAME_INVALID"}
            require(secretsObj.get(name) is String){"BACKUP_SECRET_VALUE_INVALID"}
        }

        entries["scheduler.json"]?.let(::JSONObject)?.let { scheduler ->
            val dataEnabled=scheduler.optBoolean("dataEnabled",true)
            val marketEnabled=scheduler.optBoolean("marketEnabled",true)
            val dataTimes=jsonTimes(scheduler.optJSONArray("dataTimes"))
            val marketTimes=jsonTimes(scheduler.optJSONArray("marketTimes"))
            require(!dataEnabled || dataTimes.isNotEmpty()){"BACKUP_DATA_SCHEDULE_EMPTY"}
            require(!marketEnabled || marketTimes.isNotEmpty()){"BACKUP_MARKET_SCHEDULE_EMPTY"}
        }
        entries["exchange-ui.json"]?.let(::JSONObject)?.let { exchangeUi ->
            exchangeUi.optJSONArray("selectedTables")?.let { a ->
                for(i in 0 until a.length()) require(a.optString(i).isNotBlank()){"BACKUP_EXPORT_TABLE_INVALID"}
            }
        }
    }

    private fun applyEntries(
        entries:Map<String,String>,
        reinstallScheduler:Boolean
    ):BackupRestoreReport {
        val dbPayload=JSONObject(requireNotNull(entries["database.json"]){"BACKUP_DATABASE_MISSING"})
        val settingsObj=JSONObject(requireNotNull(entries["settings.json"]){"BACKUP_SETTINGS_MISSING"})
        val settingsMap=settingsObj.keys().asSequence().associateWith{settingsObj.getString(it)}
        val scheduler=entries["scheduler.json"]?.let(::JSONObject)

        val imported=exchange.restorePayload(dbPayload,replaceAll=true)
        require(settings.replaceValidated(settingsMap)){"BACKUP_SETTINGS_APPLY_FAILED"}

        entries["exchange-ui.json"]?.let(::JSONObject)?.let { exchangeUi ->
            val validTables=exchange.snapshotJson().getJSONObject("tables").keys().asSequence().toSet()
            val explicit=exchangeUi.optBoolean("selectionExplicit",false)
            val selected=exchangeUi.optJSONArray("selectedTables")?.let { a ->
                (0 until a.length()).map{a.optString(it)}
                    .filter{it.isNotBlank() && it in validTables}.toSet()
            }.orEmpty()
            exchangePrefs.edit().apply {
                putBoolean("separateFiles",exchangeUi.optBoolean("separateFiles",false))
                if(explicit) putStringSet("selectedTables",selected) else remove("selectedTables")
            }.apply()
        }

        secrets.names().forEach{secrets.remove(it)}
        val secretsObj=JSONObject(entries["secrets.json"]?:"{}")
        var secretCount=0
        secretsObj.keys().forEach { name ->
            val value=secretsObj.optString(name)
            if(value.isNotEmpty()) {
                val chars=value.toCharArray()
                try { secrets.put(name,chars) } finally { chars.fill('\u0000') }
                secretCount++
            }
        }

        val dao=DatabaseFactory.get(app).aurumDao()
        entries["trade-alert.json"]?.let(::JSONObject)?.let { trade ->
            TradeAlertDeliveryService(app,dao).saveConfig(
                trade.optString("email"),
                trade.optString("relayUrl")
            )
        }

        if(scheduler!=null) {
            AppScheduler.saveConfig(
                app,
                scheduler.optBoolean("dataEnabled",true),
                jsonTimes(scheduler.optJSONArray("dataTimes")),
                scheduler.optBoolean("marketEnabled",true),
                jsonTimes(scheduler.optJSONArray("marketTimes")),
                reinstall=reinstallScheduler
            )
        }
        if(reinstallScheduler) AppScheduler.ensurePeriodic(app)
        return BackupRestoreReport(imported.tables,imported.rows,settingsMap.size,secretCount)
    }

    private fun buildZip():ByteArray {
        val out=ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            fun put(name:String,text:String) {
                zip.putNextEntry(ZipEntry(name))
                zip.write(text.toByteArray(StandardCharsets.UTF_8))
                zip.closeEntry()
            }
            put("manifest.json",JSONObject()
                .put("format","AURUM_FULL_BACKUP_V1")
                .put("product",product)
                .put("createdAtUtc",Instant.now().toString())
                .toString())
            put("database.json",exchange.snapshotJson().toString())
            put("settings.json",JSONObject(settings.load().first).toString())

            val cfg=AppScheduler.config(app)
            put("scheduler.json",JSONObject()
                .put("dataEnabled",cfg.dataEnabled)
                .put("dataTimes",JSONArray(cfg.dataTimes.map{it.toString()}))
                .put("marketEnabled",cfg.marketEnabled)
                .put("marketTimes",JSONArray(cfg.marketTimes.map{it.toString()}))
                .toString())

            val selectionExplicit=exchangePrefs.contains("selectedTables")
            val selectedTables=exchangePrefs.getStringSet("selectedTables",emptySet()).orEmpty().sorted()
            put("exchange-ui.json",JSONObject()
                .put("selectionExplicit",selectionExplicit)
                .put("selectedTables",JSONArray(selectedTables))
                .put("separateFiles",exchangePrefs.getBoolean("separateFiles",false))
                .toString())

            val secretJson=JSONObject()
            secrets.names()
                .filterNot{it.startsWith("tmp-backup-") || it.startsWith("tmp-restore-")}
                .sorted()
                .forEach { name ->
                val chars=runCatching{secrets.get(name)}.getOrNull() ?: return@forEach
                try { secretJson.put(name,chars.concatToString()) } finally { chars.fill('\u0000') }
            }
            put("secrets.json",secretJson.toString())

            val trade=TradeAlertDeliveryService(app,DatabaseFactory.get(app).aurumDao()).config()
            put("trade-alert.json",JSONObject()
                .put("email",trade.email)
                .put("relayUrl",trade.relayUrl)
                .toString())
        }
        return out.toByteArray()
    }

    private fun encrypt(plain:ByteArray,passphrase:CharArray):JSONObject {
        val salt=ByteArray(16).also{SecureRandom().nextBytes(it)}
        val iv=ByteArray(12).also{SecureRandom().nextBytes(it)}
        val key=derive(passphrase,salt)
        val cipher=Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE,key,GCMParameterSpec(128,iv))
        val encrypted=cipher.doFinal(plain)
        passphrase.fill('\u0000')
        return JSONObject()
            .put("format","AURUM_ENCRYPTED_BACKUP_V1")
            .put("product",product)
            .put("kdf","PBKDF2WithHmacSHA256")
            .put("iterations",KDF_ITERATIONS)
            .put("salt",Base64.encodeToString(salt,Base64.NO_WRAP))
            .put("iv",Base64.encodeToString(iv,Base64.NO_WRAP))
            .put("ciphertext",Base64.encodeToString(encrypted,Base64.NO_WRAP))
    }

    private fun decrypt(wrapper:JSONObject,passphrase:CharArray):ByteArray {
        val salt=Base64.decode(wrapper.getString("salt"),Base64.NO_WRAP)
        val iv=Base64.decode(wrapper.getString("iv"),Base64.NO_WRAP)
        val encrypted=Base64.decode(wrapper.getString("ciphertext"),Base64.NO_WRAP)
        val iterations=wrapper.optInt("iterations",KDF_ITERATIONS)
        require(iterations>=150_000){"BACKUP_KDF_TOO_WEAK"}
        val key=derive(passphrase,salt,iterations)
        return try {
            val cipher=Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE,key,GCMParameterSpec(128,iv))
            cipher.doFinal(encrypted)
        } finally {
            passphrase.fill('\u0000')
            encrypted.fill(0)
        }
    }

    private fun derive(passphrase:CharArray,salt:ByteArray,iterations:Int=KDF_ITERATIONS):SecretKeySpec {
        val spec=PBEKeySpec(passphrase,salt,iterations,256)
        return try {
            val bytes=SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
            try { SecretKeySpec(bytes,"AES") } finally { bytes.fill(0) }
        } finally {
            spec.clearPassword()
        }
    }

    private fun unzip(bytes:ByteArray):Map<String,String> {
        val out=linkedMapOf<String,String>()
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            while(true) {
                val e=zip.nextEntry ?: break
                if(!e.isDirectory && e.name in ALLOWED_ENTRIES) {
                    out[e.name]=String(zip.readBytes(),StandardCharsets.UTF_8)
                }
            }
        }
        return out
    }

    private fun jsonTimes(a:JSONArray?):List<LocalTime> {
        if(a==null) return emptyList()
        return (0 until a.length()).mapNotNull { i ->
            runCatching{LocalTime.parse(a.optString(i))}.getOrNull()
        }.distinct().sorted()
    }

    companion object {
        private const val KDF_ITERATIONS=250_000
        private val ALLOWED_ENTRIES=setOf(
            "manifest.json","database.json","settings.json",
            "scheduler.json","secrets.json","trade-alert.json","exchange-ui.json"
        )
    }
}
