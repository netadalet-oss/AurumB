package io.aurum.common.quality

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

private val CQ_MC=MathContext(18,RoundingMode.HALF_EVEN)

data class CellCompletenessDecision(
    val tableRatio:BigDecimal,
    val tableEligible:Boolean,
    val rowRatios:Map<String,BigDecimal>,
    val rowEligibility:Map<String,Boolean>,
    val columnRatios:Map<String,BigDecimal>,
    val columnEligibility:Map<String,Boolean>
)

object CellCompletenessGate {
    val MIN_RATIO:BigDecimal=BigDecimal("0.70")

    fun assess(
        rowIds:List<String>,
        columnIds:List<String>,
        minRatio:BigDecimal=MIN_RATIO,
        present:(rowId:String,columnId:String)->Boolean
    ):CellCompletenessDecision {
        require(minRatio>BigDecimal.ZERO && minRatio<=BigDecimal.ONE)
        require(rowIds.isNotEmpty()) { "rows required" }
        require(columnIds.isNotEmpty()) { "columns required" }
        require(rowIds.distinct().size==rowIds.size) { "duplicate row id" }
        require(columnIds.distinct().size==columnIds.size) { "duplicate column id" }

        fun ratio(hit:Int,total:Int)=BigDecimal(hit).divide(BigDecimal(total),CQ_MC)
        val rowRatios=rowIds.associateWith { r ->
            ratio(columnIds.count{c->present(r,c)},columnIds.size)
        }
        val columnRatios=columnIds.associateWith { c ->
            ratio(rowIds.count{r->present(r,c)},rowIds.size)
        }
        val total=rowIds.size*columnIds.size
        val hits=rowIds.sumOf { r -> columnIds.count { c -> present(r,c) } }
        val table=ratio(hits,total)
        return CellCompletenessDecision(
            tableRatio=table,
            tableEligible=table>minRatio,
            rowRatios=rowRatios,
            rowEligibility=rowRatios.mapValues{it.value>minRatio},
            columnRatios=columnRatios,
            columnEligibility=columnRatios.mapValues{it.value>minRatio}
        )
    }
}
