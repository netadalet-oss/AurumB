package io.aurum.aurumb

import io.aurum.common.provider.*
import io.aurum.common.model.*
import java.math.BigDecimal
import java.time.Duration
import java.time.Instant

fun providerChecks() {
    val now=Instant.parse("2026-10-01T10:00:00Z")
    val policy=ConsensusPolicy(Duration.ofHours(6),Duration.ofMinutes(30),BigDecimal("0.02"),1)
    val attempts=listOf(
        ProviderAttempt("A",true,BigDecimal("100"),now.minusSeconds(60),now.minusSeconds(50),null,null),
        ProviderAttempt("B",true,BigDecimal("101"),now.minusSeconds(70),now.minusSeconds(40),null,null),
        ProviderAttempt("C",false,null,null,now.minusSeconds(30),"HTTP_503","temporary")
    )
    val p=ConsensusEngine.resolve("XYZ","TRY",attempts,now,policy,"t1","fp1")
    check(p.quality==DataQuality.VALID)
    check(p.freshness==DataState.LIVE)
    check(p.selectedProviders==listOf("A","B"))
    check(p.attempts.any{!it.success && it.provider=="C"})

    val outlier=attempts.dropLast(1)+ProviderAttempt("C",true,BigDecimal("150"),now.minusSeconds(60),now.minusSeconds(20),null,null)
    val q=ConsensusEngine.resolve("XYZ","TRY",outlier,now,policy,"t1","fp2")
    check(q.quality==DataQuality.DEGRADED)
    check("C" !in q.selectedProviders)

    val future=listOf(ProviderAttempt("A",true,BigDecimal("100"),now.plusSeconds(1),now,null,null))
    val r=ConsensusEngine.resolve("XYZ","TRY",future,now,policy,"t1","fp3")
    check(r.freshness==DataState.UNAVAILABLE)
    check(r.value==null)
}
