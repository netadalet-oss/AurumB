package io.aurum.aurumb

import io.aurum.common.update.*
import java.security.KeyPairGenerator
import java.security.Signature
import java.util.Base64

fun releaseIntegrityChecks() {
    val artifact="apk-bytes".toByteArray()
    val hash=ReleaseIntegrityVerifier.sha256(artifact)
    val unsigned=ReleaseDescriptor("1.0.0",hash,"abcdef1",null)
    val unsignedResult=ReleaseIntegrityVerifier.verify(artifact,unsigned,null)
    check(unsignedResult.hashMatches)
    check(unsignedResult.accepted)

    val kp=KeyPairGenerator.getInstance("EC").apply{initialize(256)}.generateKeyPair()
    val descriptor0=ReleaseDescriptor("1.0.0",hash,"abcdef1","placeholder")
    val signer=Signature.getInstance("SHA256withECDSA")
    signer.initSign(kp.private)
    signer.update(descriptor0.canonicalPayload())
    val sig=Base64.getEncoder().encodeToString(signer.sign())
    val signed=descriptor0.copy(signatureBase64=sig)
    val good=ReleaseIntegrityVerifier.verify(artifact,signed,kp.public)
    check(good.accepted && good.signatureValid==true)

    val tampered=ReleaseIntegrityVerifier.verify("other".toByteArray(),signed,kp.public)
    check(!tampered.accepted)
    check(!tampered.hashMatches)
}
