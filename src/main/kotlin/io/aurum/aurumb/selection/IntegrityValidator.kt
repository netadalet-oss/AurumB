package io.aurum.aurumb.selection

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

private val IV_MC=MathContext(18,RoundingMode.HALF_EVEN)

object IntegrityValidator {
    fun validate(rows:List<SelectionRow>) {
        require(rows.map{it.symbol}.distinct().size==rows.size) { "duplicate symbol" }
        require(rows.map{it.rank}==(1..rows.size).toList()) { "ranking inconsistency" }
        require(rows.all{it.score>=BigDecimal.ZERO&&it.score<=BigDecimal("100")}) { "score out of bounds" }
        rows.forEach { row ->
            require(row.contributions.map{it.criterionId}.toSet()==setOf("K1","K2","K3","K4","K5","K6","K7")) {
                "criterion set mismatch"
            }
            val weightSum=row.contributions.fold(BigDecimal.ZERO){a,x->a.add(x.weight,IV_MC)}
            require(weightSum.subtract(BigDecimal.ONE).abs()<=BigDecimal("0.00001")) { "weight sum mismatch" }
            require(row.contributions.all {
                it.score>=BigDecimal.ZERO && it.score<=BigDecimal("100") &&
                    it.rankScore>=BigDecimal.ZERO && it.rankScore<=BigDecimal("100")
            }) { "invalid contribution" }
            val raw=row.contributions.fold(BigDecimal.ZERO){a,x->a.add(x.rawContribution,IV_MC)}
            val rank=row.contributions.fold(BigDecimal.ZERO){a,x->a.add(x.rankContribution,IV_MC)}
            val consensus=blendSelectionScores(raw,rank)
            require(consensus.subtract(row.consensusScore).abs()<=BigDecimal("0.000001")) {
                "consensus inconsistency"
            }
        }
    }
}
