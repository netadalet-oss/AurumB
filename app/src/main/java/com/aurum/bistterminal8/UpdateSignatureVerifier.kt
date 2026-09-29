package com.aurum.bistterminal8

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Base64
import java.security.MessageDigest
import java.security.Signature
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate

object UpdateSignatureVerifier {
    private const val MAX_MESSAGE_BYTES = 16 * 1024

    private fun signingCertificate(context: Context): X509Certificate {
        val pm = context.packageManager
        val raw = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val info = pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
            val signingInfo = info.signingInfo ?: error("SIGNING_INFO_UNAVAILABLE")
            val signers = if (signingInfo.hasMultipleSigners()) signingInfo.apkContentsSigners
                else signingInfo.signingCertificateHistory
            signers.firstOrNull()?.toByteArray() ?: error("SIGNING_CERT_UNAVAILABLE")
        } else {
            @Suppress("DEPRECATION")
            val info = pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES)
            @Suppress("DEPRECATION")
            info.signatures?.firstOrNull()?.toByteArray() ?: error("SIGNING_CERT_UNAVAILABLE")
        }
        return CertificateFactory.getInstance("X.509")
            .generateCertificate(raw.inputStream()) as X509Certificate
    }

    fun fingerprintSha256(context: Context): String = signingCertificate(context).encoded
        .let { MessageDigest.getInstance("SHA-256").digest(it) }
        .joinToString("") { "%02x".format(it) }

    fun verify(context: Context, message: String, signatureBase64: String): Boolean {
        val bytes = message.toByteArray(Charsets.UTF_8)
        if (bytes.isEmpty() || bytes.size > MAX_MESSAGE_BYTES || signatureBase64.length > 8192) return false
        val cert = signingCertificate(context)
        val algorithm = when (cert.publicKey.algorithm.uppercase()) {
            "RSA" -> "SHA256withRSA"
            "EC", "ECDSA" -> "SHA256withECDSA"
            else -> return false
        }
        val signature = runCatching { Base64.decode(signatureBase64, Base64.DEFAULT) }.getOrNull() ?: return false
        return runCatching {
            Signature.getInstance(algorithm).apply {
                initVerify(cert.publicKey)
                update(bytes)
            }.verify(signature)
        }.getOrDefault(false)
    }
}
