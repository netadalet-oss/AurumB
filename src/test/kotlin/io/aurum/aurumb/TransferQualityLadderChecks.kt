package io.aurum.aurumb

import io.aurum.common.quality.TransferQualityLadder

fun transferQualityLadderChecks() {
    fun checkCase(ok:Int,total:Int,expected:Int?,evaluated:List<Int>) {
        val d=TransferQualityLadder.evaluate(ok,total)
        check(d.acceptedThresholdPct==expected) { "quality threshold mismatch: $d" }
        check(d.evaluatedThresholdsPct==evaluated) { "quality evaluation order mismatch: $d" }
    }
    checkCase(100,100,100,listOf(100))
    checkCase(97,100,95,listOf(100,95))
    checkCase(92,100,90,listOf(100,95,90))
    checkCase(85,100,80,listOf(100,95,90,80))
    checkCase(70,100,70,listOf(100,95,90,80,70))
    checkCase(69,100,null,listOf(100,95,90,80,70))
    val custom=TransferQualityLadder.evaluate(88,100,listOf(99,88,77))
    check(custom.acceptedThresholdPct==88)
    check(custom.evaluatedThresholdsPct==listOf(99,88))
    check(runCatching{TransferQualityLadder.evaluate(90,100,listOf(90,95,70))}.isFailure)
}
