package io.aurum.common.scheduler

import java.time.*

enum class JobState { IDLE,RUNNING,SUCCEEDED,FAILED,CANCELLED }

data class JobStatus(
    val id:String,
    val lastRun:Instant?,
    val nextRun:Instant?,
    val state:JobState,
    val durationMs:Long?,
    val retry:Int,
    val error:String?
)

interface ScheduledJob {
    val id:String
    fun run(now:Instant):JobStatus
}

class SchedulerRegistry(jobs:List<ScheduledJob>) {
    private val jobsById=jobs.associateBy{it.id}.also{require(it.size==jobs.size){"duplicate job id"}}
    fun ids()=jobsById.keys.sorted()
    fun run(id:String,now:Instant)=requireNotNull(jobsById[id]){"unknown job"}.run(now)
}

/**
 * Canonical wall-clock scheduler profile. Slots are interpreted in [zone] and
 * the caller decides whether a calendar date uses weekday or holiday slots.
 * The function is pure so exact native alarm scheduling can be tested without Android.
 */
data class WallClockScheduleProfile(
    val weekdaySlots:List<LocalTime>,
    val holidaySlots:List<LocalTime>,
    val zone:ZoneId=ZoneId.of("Europe/Istanbul")
) {
    init {
        require(weekdaySlots.isNotEmpty()){"weekday slots required"}
        require(holidaySlots.isNotEmpty()){"holiday slots required"}
        require(weekdaySlots.distinct().size==weekdaySlots.size){"duplicate weekday slot"}
        require(holidaySlots.distinct().size==holidaySlots.size){"duplicate holiday slot"}
    }

    fun nextAfter(after:Instant,isHolidayDate:(LocalDate)->Boolean):Instant {
        var date=after.atZone(zone).toLocalDate()
        repeat(370) {
            val weekend=date.dayOfWeek==DayOfWeek.SATURDAY || date.dayOfWeek==DayOfWeek.SUNDAY
            val holiday=weekend || isHolidayDate(date)
            val slots=(if(holiday) holidaySlots else weekdaySlots).sorted()
            for(slot in slots) {
                val candidate=ZonedDateTime.of(date,slot,zone).toInstant()
                if(candidate.isAfter(after)) return candidate
            }
            date=date.plusDays(1)
        }
        error("no scheduler occurrence within 370 days")
    }
}
