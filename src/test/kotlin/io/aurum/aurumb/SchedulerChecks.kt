package io.aurum.aurumb

import io.aurum.common.scheduler.*
import java.time.Instant
import java.time.LocalTime

private class StubJob(
    override val id:String,
    private val state:JobState=JobState.SUCCEEDED
):ScheduledJob {
    override fun run(now:Instant)=JobStatus(
        id=id,
        lastRun=now,
        nextRun=now.plusSeconds(60),
        state=state,
        durationMs=10,
        retry=0,
        error=null
    )
}

fun schedulerChecks() {
    val registry=SchedulerRegistry(listOf(StubJob("a"),StubJob("b",JobState.FAILED)))
    check(registry.ids()==listOf("a","b"))
    val now=Instant.parse("2026-10-01T12:00:00Z")
    check(registry.run("a",now).state==JobState.SUCCEEDED)
    check(registry.run("b",now).state==JobState.FAILED)
    check(runCatching{registry.run("missing",now)}.isFailure)
    check(runCatching{SchedulerRegistry(listOf(StubJob("dup"),StubJob("dup")))}.isFailure)

    val forensic=WallClockScheduleProfile(
        weekdaySlots=listOf(
            "00:30","04:30","08:20","09:20","10:20","11:20","12:20","13:20","14:20",
            "15:20","16:20","17:20","18:20","19:20","20:30","21:30","22:30","23:30"
        ).map(LocalTime::parse),
        holidaySlots=listOf("00:30","12:30").map(LocalTime::parse)
    )
    check(forensic.weekdaySlots.size==18)
    check(forensic.nextAfter(Instant.parse("2026-10-02T07:19:59Z")){false}==
        Instant.parse("2026-10-02T07:20:00Z"))
    check(forensic.nextAfter(Instant.parse("2026-10-02T07:20:00Z")){false}==
        Instant.parse("2026-10-02T08:20:00Z"))
    // Saturday automatically uses the holiday profile.
    check(forensic.nextAfter(Instant.parse("2026-10-03T00:00:00Z")){false}==
        Instant.parse("2026-10-03T09:30:00Z"))
}
