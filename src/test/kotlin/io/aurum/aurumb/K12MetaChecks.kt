package io.aurum.aurumb

import io.aurum.aurumb.formula.K12MetaEngine
import java.math.BigDecimal

fun k12MetaChecks() {
    check(
        K12MetaEngine.combineMarketAndMemory(BigDecimal("80"),BigDecimal("40"))
            .compareTo(BigDecimal("68.00"))==0
    )
    check(
        K12MetaEngine.combineMarketAndMemory(BigDecimal("100"),BigDecimal.ZERO)
            .compareTo(BigDecimal("70.00"))==0
    )
    check(
        K12MetaEngine.combineMarketAndMemory(BigDecimal.ZERO,BigDecimal("100"))
            .compareTo(BigDecimal("30.00"))==0
    )
    check(K12MetaEngine.TOTAL_GENOME_TRAITS==89)
}
