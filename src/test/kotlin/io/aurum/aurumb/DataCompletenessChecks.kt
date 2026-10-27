package io.aurum.aurumb

import io.aurum.common.quality.CellCompletenessGate
import java.math.BigDecimal

fun dataCompletenessChecks() {
    val rows=listOf("R1","R2","R3","R4")
    val cols=listOf("A","B","C","D","E")
    val missing=setOf(
        "R1:E",
        "R2:D","R2:E",
        "R3:C","R3:D","R3:E",
        "R4:B","R4:C","R4:D","R4:E"
    )
    val d=CellCompletenessGate.assess(rows,cols){r,c -> "$r:$c" !in missing}
    check(d.tableRatio==BigDecimal("0.5"))
    check(!d.tableEligible)
    check(d.rowRatios.getValue("R1")==BigDecimal("0.8"))
    check(d.rowEligibility.getValue("R1"))
    check(!d.rowEligibility.getValue("R2")) // 3/5 = 60%
    check(d.columnRatios.getValue("A")==BigDecimal.ONE)
    check(d.columnRatios.getValue("B")==BigDecimal("0.75"))
    check(d.columnEligibility.getValue("B"))
    check(!d.columnEligibility.getValue("C")) // 2/4 = 50%

    val exact=CellCompletenessGate.assess(
        (1..10).map{it.toString()},
        (1..10).map{it.toString()}
    ){r,c -> r.toInt()<=7}
    check(exact.tableRatio.compareTo(BigDecimal("0.70"))==0)
    check(!exact.tableEligible) // exact configured gate is not enough; it must be exceeded
    check(exact.rowEligibility.values.count{it}==7)
    check(!exact.columnEligibility.values.all{it}) // each column is exactly 70% complete
    val custom75=CellCompletenessGate.assess(
        listOf("R1","R2"),listOf("A","B"),
        java.math.BigDecimal("0.75")
    ){r,col -> !(r=="R2" && col=="B")}
    check(!custom75.tableEligible) // exact 75% is still below the strict >75% gate
    val custom80=CellCompletenessGate.assess(
        listOf("R1","R2"),listOf("A","B"),
        java.math.BigDecimal("0.80")
    ){r,col -> !(r=="R2" && col=="B")}
    check(!custom80.tableEligible)
}
