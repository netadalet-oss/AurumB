package io.aurum.aurumb.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureSecretStore(context:Context) {
    private val appContext=context.applicationContext
    private val legacyPrefs=appContext.getSharedPreferences("aurumb.secure.v1",Context.MODE_PRIVATE)
    private val secretFile=File(appContext.filesDir,"key.txt")
    private val alias="aurumb-local-secrets-v1"

    init { migrateLegacySecrets() }

    private fun key():SecretKey {
        val ks=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
        (ks.getKey(alias,null) as? SecretKey)?.let{return it}
        val gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore")
        gen.init(KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
         .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
         .setKeySize(256)
         .build())
        return gen.generateKey()
    }

    fun put(name:String,value:CharArray) {
        require(name.matches(Regex("[A-Za-z0-9_.-]{1,64}")))
        val plain=String(value).toByteArray(StandardCharsets.UTF_8)
        try {
            val cipher=Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE,key())
            val iv=Base64.encodeToString(cipher.iv,Base64.NO_WRAP)
            val encrypted=Base64.encodeToString(cipher.doFinal(plain),Base64.NO_WRAP)
            synchronized(this) {
                val values=readEncryptedValues().toMutableMap()
                values[name]="v1:$iv:$encrypted"
                writeEncryptedValues(values)
            }
        } finally {
            plain.fill(0)
            value.fill('\u0000')
        }
    }

    fun get(name:String):CharArray? {
        val encoded=synchronized(this) { readEncryptedValues()[name] } ?: return null
        val parts=encoded.split(':')
        require(parts.size==3 && parts[0]=="v1") { "unsupported secret format" }
        val cipher=Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,Base64.decode(parts[1],Base64.NO_WRAP)))
        val bytes=cipher.doFinal(Base64.decode(parts[2],Base64.NO_WRAP))
        return try { String(bytes,StandardCharsets.UTF_8).toCharArray() } finally { bytes.fill(0) }
    }

    fun remove(name:String) {
        synchronized(this) {
            val values=readEncryptedValues().toMutableMap()
            values.remove(name)
            writeEncryptedValues(values)
        }
    }

    /** Names only; secret values are encrypted in private filesDir/key.txt until get(). */
    fun names():Set<String> = synchronized(this) { readEncryptedValues().keys }

    private fun readEncryptedValues():Map<String,String> {
        if(!secretFile.exists()) return emptyMap()
        return secretFile.readLines(StandardCharsets.UTF_8).mapNotNull { line ->
            val split=line.indexOf('=')
            if(split<=0) null else line.substring(0,split) to line.substring(split+1)
        }.toMap()
    }

    private fun writeEncryptedValues(values:Map<String,String>) {
        val tmp=File(secretFile.parentFile,secretFile.name+".tmp")
        tmp.writeText(values.toSortedMap().entries.joinToString("\n"){(name,value)->name+"="+value},StandardCharsets.UTF_8)
        // key.txt contains encrypted secrets, but still enforce owner-only filesystem permissions.
        check(tmp.setReadable(false,false) || !tmp.canRead())
        check(tmp.setReadable(true,true))
        tmp.setWritable(false,false)
        check(tmp.setWritable(true,true))
        tmp.setExecutable(false,false)
        if(secretFile.exists() && !secretFile.delete()) throw IllegalStateException("Unable to replace key.txt")
        if(!tmp.renameTo(secretFile)) throw IllegalStateException("Unable to publish key.txt")
        secretFile.setReadable(false,false); check(secretFile.setReadable(true,true))
        secretFile.setWritable(false,false); check(secretFile.setWritable(true,true))
        secretFile.setExecutable(false,false)
    }

    private fun migrateLegacySecrets() {
        if(legacyPrefs.all.isEmpty()) return
        synchronized(this) {
            val values=readEncryptedValues().toMutableMap()
            legacyPrefs.all.forEach { (name,value) ->
                (value as? String)?.let { values.putIfAbsent(name,it) }
            }
            writeEncryptedValues(values)
            legacyPrefs.edit().clear().commit()
        }
    }
}
