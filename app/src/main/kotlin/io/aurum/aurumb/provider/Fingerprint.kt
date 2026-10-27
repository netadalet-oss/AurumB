package io.aurum.aurumb.provider

import java.security.MessageDigest

object Fingerprint {
    fun sha256(bytes:ByteArray):String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)}
}
