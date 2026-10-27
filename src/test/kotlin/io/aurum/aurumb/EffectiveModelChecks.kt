package io.aurum.aurumb

import io.aurum.aurumb.learning.*
import java.math.BigDecimal

fun effectiveModelChecks() {
    val base=EffectiveModelResolver.base("base-v1")
    check(base.source=="BASE")
    check(base.weights.values.fold(BigDecimal.ZERO,BigDecimal::add)
        .subtract(BigDecimal.ONE).abs()<=BigDecimal("0.00001"))

    val learned=mutableMapOf<String,BigDecimal>(
        "K1" to BigDecimal("0.18"),
        "K2" to BigDecimal("0.17"),
        "K3" to BigDecimal("0.14"),
        "K4" to BigDecimal("0.15"),
        "K5" to BigDecimal("0.13"),
        "K6" to BigDecimal("0.12"),
        "K7" to BigDecimal("0.11")
    )
    val champion=EffectiveModelResolver.resolve("base-v1","challenger-42",learned)
    check(champion.version=="challenger-42")
    check(champion.source=="CHAMPION")
    check(champion.criterionSpecs().first{it.id=="K1"}.baseWeight==BigDecimal("0.18"))

    learned["K7"]=BigDecimal("0.90")
    val fallback=EffectiveModelResolver.resolve("base-v1","corrupt",learned)
    check(fallback.source=="BASE")
    check(fallback.version=="base-v1")
}
