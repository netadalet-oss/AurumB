package io.aurum.aurumb

import io.aurum.aurumb.history.KTrendOrdering
import io.aurum.aurumb.history.KTrendValue

fun kTrendOrderingChecks() {
    val sorted=KTrendOrdering.descending(listOf(
        KTrendValue("K1",3,20),
        KTrendValue("K3",5,20),
        KTrendValue("K2",5,20),
        KTrendValue("K7",1,20)
    ))
    check(sorted.map{it.criterion}==listOf("K2","K3","K1","K7"))
}
