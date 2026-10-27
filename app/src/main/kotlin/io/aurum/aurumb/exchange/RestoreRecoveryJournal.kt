package io.aurum.aurumb.exchange

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * App-private crash-recovery journal for full restore.
 *
 * The rollback payload can contain database state and encrypted-secret values,
 * therefore it is encrypted again with a dedicated Android Keystore key and is
 * stored under noBackupFilesDir. It survives process death and in-place update,
 * but not uninstall (which is correct: user-selected .aurumbackup is the
 * cross-install recovery source).
 */
class RestoreRecoveryJournal(context:Context) {
    private val app=context.applicationContext
    private val file=File(app.noBackupFilesDir,"aurum-full-restore-recovery-v1.json")
    private val atomicFile=AtomicFile(file)
    private val alias="aurumb-full-restore-recovery-v1"

    fun write(plain:ByteArray) {
        val cipher=Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE,key())
        val encrypted=cipher.doFinal(plain)
        val wrapper=JSONObject()
            .put("format","AURUM_RESTORE_RECOVERY_V1")
            .put("iv",Base64.encodeToString(cipher.iv,Base64.NO_WRAP))
            .put("ciphertext",Base64.encodeToString(encrypted,Base64.NO_WRAP))
        val output=atomicFile.startWrite()
        try {
            output.write(wrapper.toString().toByteArray(Charsets.UTF_8))
            atomicFile.finishWrite(output)
        } catch(t:Throwable) {
            atomicFile.failWrite(output)
            throw t
        }
    }

    fun read():ByteArray? {
        if(!exists()) return null
        val wrapper=atomicFile.openRead().use {
            JSONObject(String(it.readBytes(),Charsets.UTF_8))
        }
        require(wrapper.optString("format")=="AURUM_RESTORE_RECOVERY_V1"){
            "RESTORE_RECOVERY_FORMAT_INVALID"
        }
        val iv=Base64.decode(wrapper.getString("iv"),Base64.NO_WRAP)
        val encrypted=Base64.decode(wrapper.getString("ciphertext"),Base64.NO_WRAP)
        return try {
            val cipher=Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,iv))
            cipher.doFinal(encrypted)
        } finally {
            encrypted.fill(0)
        }
    }

    fun exists():Boolean=file.exists() || File(file.path+".bak").exists()

    fun clear() {
        atomicFile.delete()
        require(!exists() && !File(file.path+".new").exists()){"RESTORE_RECOVERY_DELETE_FAILED"}
    }

    private fun key():SecretKey {
        val ks=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
        (ks.getKey(alias,null) as? SecretKey)?.let{return it}
        val gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }
}
