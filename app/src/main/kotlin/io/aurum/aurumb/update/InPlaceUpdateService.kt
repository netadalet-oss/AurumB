package io.aurum.aurumb.update

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.security.MessageDigest

data class ApkUpdateInspection(
    val packageName:String?,
    val versionCode:Long?,
    val versionName:String?,
    val signerMatches:Boolean,
    val accepted:Boolean,
    val reason:String
)

class InPlaceUpdateService(context:Context) {
    private val app=context.applicationContext
    private val pm=app.packageManager

    suspend fun inspect(uri:Uri):ApkUpdateInspection=withContext(Dispatchers.IO) {
        val cache=java.io.File(app.cacheDir,"aurum-update-"+System.nanoTime()+".apk")
        try {
            app.contentResolver.openInputStream(uri)?.use { input ->
                cache.outputStream().use { output -> input.copyTo(output) }
            } ?: return@withContext ApkUpdateInspection(null,null,null,false,false,"APK_STREAM_UNAVAILABLE")
            val archive=archiveInfo(cache.absolutePath)
                ?:return@withContext ApkUpdateInspection(null,null,null,false,false,"APK_PARSE_FAILED")
            val current=currentInfo()
            val samePackage=archive.packageName==app.packageName
            val sameSigner=signerDigests(archive).isNotEmpty() &&
                signerDigests(archive)==signerDigests(current)
            val archiveCode=longVersionCode(archive)
            val currentCode=longVersionCode(current)
            val accepted=samePackage && sameSigner && archiveCode>=currentCode
            ApkUpdateInspection(
                archive.packageName,
                archiveCode,
                archive.versionName,
                sameSigner,
                accepted,
                when {
                    !samePackage -> "APK_PACKAGE_MISMATCH"
                    !sameSigner -> "APK_SIGNER_MISMATCH"
                    archiveCode<currentCode -> "APK_DOWNGRADE_BLOCKED"
                    else -> "VERIFIED_IN_PLACE_UPDATE"
                }
            )
        } finally {
            cache.delete()
        }
    }

    fun canRequestInstalls():Boolean =
        Build.VERSION.SDK_INT<26 || pm.canRequestPackageInstalls()

    fun openInstallPermission() {
        if(Build.VERSION.SDK_INT<26) return
        app.startActivity(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+app.packageName))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    fun launchInstaller(uri:Uri) {
        require(canRequestInstalls()){"APK_INSTALL_PERMISSION_REQUIRED"}
        app.startActivity(
            Intent(Intent.ACTION_INSTALL_PACKAGE)
                .setData(uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    @Suppress("DEPRECATION")
    private fun archiveInfo(path:String):PackageInfo? =
        if(Build.VERSION.SDK_INT>=33)
            pm.getPackageArchiveInfo(path,PackageManager.PackageInfoFlags.of(signingFlags().toLong()))
        else pm.getPackageArchiveInfo(path,signingFlags())

    @Suppress("DEPRECATION")
    private fun currentInfo():PackageInfo =
        if(Build.VERSION.SDK_INT>=33)
            pm.getPackageInfo(app.packageName,PackageManager.PackageInfoFlags.of(signingFlags().toLong()))
        else pm.getPackageInfo(app.packageName,signingFlags())

    @Suppress("DEPRECATION")
    private fun signingFlags():Int =
        if(Build.VERSION.SDK_INT>=28) PackageManager.GET_SIGNING_CERTIFICATES
        else PackageManager.GET_SIGNATURES

    private fun longVersionCode(info:PackageInfo):Long =
        if(Build.VERSION.SDK_INT>=28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()

    @Suppress("DEPRECATION")
    private fun signerDigests(info:PackageInfo):Set<String> {
        val certs=if(Build.VERSION.SDK_INT>=28) {
            val signing=info.signingInfo ?: return emptySet()
            if(signing.hasMultipleSigners()) signing.apkContentsSigners
            else signing.signingCertificateHistory
        } else info.signatures
        return certs.orEmpty().map { signature ->
            MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())
                .joinToString(""){"%02x".format(it)}
        }.toSet()
    }
}
