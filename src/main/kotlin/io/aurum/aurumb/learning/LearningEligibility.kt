package io.aurum.aurumb.learning

import java.math.BigDecimal
import java.time.Instant

data class HistoricalRunEvidence(
    val runId:String,
    val decisionAt:Instant,
    val evaluatedAt:Instant?,
    val formulaVersion:String?,
    val modelVersion:String?,
    val entryPrice:BigDecimal?,
    val outcomeReturn:BigDecimal?,
    val containsFutureData:Boolean,
    val integrityPassed:Boolean
)
data class EligibilityDecision(val runId:String,val eligible:Boolean,val reasons:List<String>)

object LearningEligibility {
    fun assess(rows:List<HistoricalRunEvidence>,now:Instant):List<EligibilityDecision> =
        rows.map { row ->
            val reasons=mutableListOf<String>()
            if (!row.integrityPassed) reasons += "INTEGRITY_FAILED"
            if (row.formulaVersion.isNullOrBlank()) reasons += "UNKNOWN_FORMULA_VERSION"
            if (row.modelVersion.isNullOrBlank()) reasons += "UNKNOWN_MODEL_VERSION"
            if (row.entryPrice==null || row.entryPrice<=BigDecimal.ZERO) reasons += "INVALID_ENTRY_PRICE"
            if (row.outcomeReturn==null) reasons += "MISSING_OUTCOME"
            if (row.containsFutureData) reasons += "LOOKAHEAD_CONTAMINATION"
            if (row.evaluatedAt==null) reasons += "NOT_EVALUATED"
            else {
                if (row.evaluatedAt.isAfter(now)) reasons += "FUTURE_EVALUATION"
                if (row.evaluatedAt.isBefore(row.decisionAt)) reasons += "TIMESTAMP_ORDER"
            }
            EligibilityDecision(row.runId,reasons.isEmpty(),reasons)
        }
}
