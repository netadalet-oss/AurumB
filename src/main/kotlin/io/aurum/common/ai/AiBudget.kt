package io.aurum.common.ai

import java.time.Instant
import java.time.ZoneOffset

object AiBudget {
    fun utcDayStart(at:Instant):Instant =
        at.atZone(ZoneOffset.UTC).toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant()

    fun allowsPaidCall(usedToday:Int,limit:Int):Boolean {
        require(usedToday>=0)
        require(limit>=0)
        return usedToday < limit
    }
}
