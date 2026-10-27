package io.aurum.common.update

import java.security.MessageDigest
import java.security.PublicKey
import java.security.Signature
import java.util.Base64

data class ReleaseDescriptor(
    val appVersion:String,
    val artifactSha256:String,
    val sourceCommit:String,
    val signatureBase64:String?
) {
    init {
        require(appVersion.isNotBlank())
        require(artifactSha256.matches(Regex("[a-f0-9]{64}")))
        require(sourceCommit.matches(Regex("[a-f0-9]{7,64}")))
    }

    fun canonicalPayload():ByteArray =
        ("appVersion="+appVersion+"\n"+
         "artifactSha256="+artifactSha256+"\n"+
         "sourceCommit="+sourceCommit+"\n").toByteArray(Charsets.UTF_8)
}

data class ReleaseVerification(
    val hashMatches:Boolean,
    val signatureValid:Boolean?,
    val accepted:Boolean,
    val reason:String
)

object ReleaseIntegrityVerifier {
    fun verify(
        artifact:ByteArray,
        descriptor:ReleaseDescriptor,
        publicKey:PublicKey?=null
    ):ReleaseVerification {
        val actual=sha256(artifact)
        if(actual!=descriptor.artifactSha256) {
            return ReleaseVerification(false,null,false,"ARTIFACT_HASH_MISMATCH")
        }

        val signature=descriptor.signatureBase64
        if(signature==null) {
            return ReleaseVerification(true,null,publicKey==null,"HASH_ONLY")
        }
        if(publicKey==null) {
            return ReleaseVerification(true,false,false,"SIGNATURE_KEY_REQUIRED")
        }

        val valid=runCatching {
            val verifier=Signature.getInstance("SHA256withECDSA")
            verifier.initVerify(publicKey)
            verifier.update(descriptor.canonicalPayload())
            verifier.verify(Base64.getDecoder().decode(signature))
        }.getOrDefault(false)
        return ReleaseVerification(
            hashMatches=true,
            signatureValid=valid,
            accepted=valid,
            reason=if(valid)"VERIFIED" else "SIGNATURE_INVALID"
        )
    }

    fun sha256(bytes:ByteArray):String =
        MessageDigest.getInstance("SHA-256")
            .digest(bytes)
            .joinToString(""){"%02x".format(it)}
}
