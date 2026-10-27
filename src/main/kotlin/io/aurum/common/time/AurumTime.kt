package io.aurum.common.time

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime

object AurumTime {
    val ISTANBUL:ZoneId=ZoneId.of("Europe/Istanbul")
    val AMSTERDAM:ZoneId=ZoneId.of("Europe/Amsterdam")

    fun toUtc(instant:Instant):String=instant.toString()
    fun display(instant:Instant,zone:ZoneId):ZonedDateTime=instant.atZone(zone)
}
