package io.aurum.aurumb.quality

import java.time.Duration
import java.time.Instant

enum class HistoricalRepairMode { FULL_TABLE, TARGETED }

object HistoricalRepairPolicy {
    val RECENCY:Duration=Duration.ofMinutes(30)

    /**
     * Exactly 30 minutes is still inside the "last half hour" window.
     * Only an older main transfer requires a full-table refresh.
     */
    fun mode(lastMainCompletedAt:Instant?,now:Instant):HistoricalRepairMode =
        if(lastMainCompletedAt==null || Duration.between(lastMainCompletedAt,now)>RECENCY)
            HistoricalRepairMode.FULL_TABLE
        else HistoricalRepairMode.TARGETED

    /**
     * A row is targeted when a current-table cell is missing, when source/data
     * time is missing, or when source/data time is strictly older than 30 min.
     * Transport receive time is deliberately not a substitute for data time.
     */
    fun targetRow(hasMissingCurrentCells:Boolean,dataTime:Instant?,now:Instant):Boolean =
        hasMissingCurrentCells ||
            dataTime==null ||
            dataTime.isBefore(now.minus(RECENCY))
}
