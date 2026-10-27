package io.aurum.aurumb.scheduler

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.net.Uri
import android.provider.Settings
import androidx.work.*
import io.aurum.aurumb.calendar.BistCalendarFactory
import io.aurum.common.scheduler.WallClockScheduleProfile
import java.time.*
import java.util.concurrent.TimeUnit

data class SchedulerConfig(
    val dataEnabled:Boolean,
    val dataTimes:List<LocalTime>,
    val marketEnabled:Boolean,
    val marketTimes:List<LocalTime>
)

object AppScheduler {
    const val MARKET_REFRESH="aurumb.market.refresh"
    const val DAILY_AUDIT="aurumb.daily.audit"
    const val MODEL_EVALUATION="aurumb.model.evaluation"
    const val PORTAL_REFRESH="aurumb.portal.refresh"
    private const val LEGACY_LOG_RETENTION="aurumb.log.retention"
    const val LOG_RETENTION="aurumb.log.retention.sunday.v2"

    const val ACTION_DATA_ALARM="io.aurum.aurumb.action.DATA_ALARM"
    const val ACTION_MARKET_ALARM="io.aurum.aurumb.action.MARKET_ALARM"
    const val ACTION_LOG_RETENTION_ALARM="io.aurum.aurumb.action.LOG_RETENTION_ALARM"
    const val EXTRA_SCHEDULED_AT="scheduledAtEpochMs"

    private const val DATA_SERIAL="aurumb.data.pipeline.serial"
    private const val PORTAL_SERIAL="aurumb.portal.serial"
    private const val DATA_ALARM_REQUEST_CODE=23001
    private const val MARKET_ALARM_REQUEST_CODE=23002
    private const val LOG_RETENTION_ALARM_REQUEST_CODE=23003
    private const val SCHEDULER_PREFS="aurumb.scheduler.native.v1"

    private val DEFAULT_DATA_TIMES=listOf(
        "00:30","04:30","08:20","09:20","10:20","11:20","12:20","13:20","14:20",
        "15:20","16:20","17:20","18:20","19:20","20:30","21:30","22:30","23:30"
    ).map(LocalTime::parse)
    private val DEFAULT_DATA_HOLIDAY_TIMES=listOf("00:30","12:30").map(LocalTime::parse)
    private val DEFAULT_MARKET_TIMES=DEFAULT_DATA_TIMES.map{it.plusMinutes(30)}
    private val DEFAULT_MARKET_HOLIDAY_TIMES=DEFAULT_DATA_HOLIDAY_TIMES.map{it.plusMinutes(30)}

    val dataProfile=WallClockScheduleProfile(
        weekdaySlots=DEFAULT_DATA_TIMES,
        holidaySlots=DEFAULT_DATA_HOLIDAY_TIMES
    )
    val marketProfile=WallClockScheduleProfile(
        weekdaySlots=DEFAULT_MARKET_TIMES,
        holidaySlots=DEFAULT_MARKET_HOLIDAY_TIMES
    )

    fun ensurePeriodic(context:Context) {
        val app=context.applicationContext
        val wm=WorkManager.getInstance(app)

        // Forensic scheduler ownership is wall-clock based; periodic owners are removed.
        wm.cancelUniqueWork(MARKET_REFRESH)
        wm.cancelUniqueWork(PORTAL_REFRESH)
        scheduleNextDataAlarm(app)
        scheduleNextMarketAlarm(app)

        val audit=PeriodicWorkRequestBuilder<DailyAuditWorker>(24,TimeUnit.HOURS)
            .addTag(DAILY_AUDIT)
            .build()
        wm.enqueueUniquePeriodicWork(DAILY_AUDIT,ExistingPeriodicWorkPolicy.KEEP,audit)

        // The weekly maintenance contract is a wall-clock contract (Sunday 00:00
        // Europe/Istanbul), not a drifting 7-day WorkManager interval.
        wm.cancelUniqueWork(LEGACY_LOG_RETENTION)
        wm.cancelUniqueWork(LOG_RETENTION)
        scheduleNextLogRetentionAlarm(app)

        val model=PeriodicWorkRequestBuilder<ModelEvaluationWorker>(24,TimeUnit.HOURS)
            .addTag(MODEL_EVALUATION)
            .build()
        wm.enqueueUniquePeriodicWork(MODEL_EVALUATION,ExistingPeriodicWorkPolicy.KEEP,model)
    }

    private val LOG_RETENTION_ZONE:ZoneId=ZoneId.of("Europe/Istanbul")

    internal fun nextSundayMidnight(now:Instant=Instant.now()):Instant {
        val local=now.atZone(LOG_RETENTION_ZONE)
        val delta=(DayOfWeek.SUNDAY.value-local.dayOfWeek.value+7)%7
        var target=local.toLocalDate().plusDays(delta.toLong()).atStartOfDay(LOG_RETENTION_ZONE)
        if(!target.toInstant().isAfter(now)) target=target.plusWeeks(1)
        return target.toInstant()
    }

    internal fun nextSundayMidnightDelay(now:Instant=Instant.now()):Duration {
        val delay=Duration.between(now,nextSundayMidnight(now))
        return if(delay.isNegative) Duration.ZERO else delay
    }

    fun config(context:Context):SchedulerConfig {
        val p=context.applicationContext.getSharedPreferences(SCHEDULER_PREFS,Context.MODE_PRIVATE)
        val dataTimes=parseTimes(p.getString(KEY_DATA_TIMES,null),DEFAULT_DATA_TIMES)
        val marketTimes=parseTimes(p.getString(KEY_MARKET_TIMES,null),DEFAULT_MARKET_TIMES)
        return SchedulerConfig(
            dataEnabled=p.getBoolean(KEY_DATA_ENABLED,true),
            dataTimes=dataTimes,
            marketEnabled=p.getBoolean(KEY_MARKET_ENABLED,false),
            marketTimes=marketTimes
        )
    }

    fun saveConfig(
        context:Context,
        dataEnabled:Boolean,
        dataTimes:List<LocalTime>,
        marketEnabled:Boolean,
        marketTimes:List<LocalTime>,
        reinstall:Boolean=true
    ):SchedulerConfig {
        val d=normalizeTimes(dataTimes)
        val m=normalizeTimes(marketTimes)
        require(!dataEnabled || d.isNotEmpty()){"Etkin Veriler zamanlayıcısı için en az bir saat gerekli"}
        require(!marketEnabled || m.isNotEmpty()){"Etkin Piyasa zamanlayıcısı için en az bir saat gerekli"}
        context.applicationContext.getSharedPreferences(SCHEDULER_PREFS,Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_DATA_ENABLED,dataEnabled)
            .putString(KEY_DATA_TIMES,d.joinToString(","))
            .putBoolean(KEY_MARKET_ENABLED,marketEnabled)
            .putString(KEY_MARKET_TIMES,m.joinToString(","))
            .commit()
        if(reinstall) reinstallAlarms(context)
        return config(context)
    }

    fun resetConfig(context:Context):SchedulerConfig {
        context.applicationContext.getSharedPreferences(SCHEDULER_PREFS,Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_DATA_ENABLED,true)
            .putString(KEY_DATA_TIMES,DEFAULT_DATA_TIMES.joinToString(","))
            .putBoolean(KEY_MARKET_ENABLED,true)
            .putString(KEY_MARKET_TIMES,DEFAULT_MARKET_TIMES.joinToString(","))
            .commit()
        reinstallAlarms(context)
        return config(context)
    }

    fun nextDataAfter(now:Instant):Instant=dataProfile.nextAfter(now,::isHoliday)
    fun nextDataAfter(context:Context,now:Instant):Instant =
        WallClockScheduleProfile(config(context).dataTimes,DEFAULT_DATA_HOLIDAY_TIMES).nextAfter(now,::isHoliday)

    fun nextMarketAfter(context:Context,now:Instant):Instant =
        WallClockScheduleProfile(config(context).marketTimes,DEFAULT_MARKET_HOLIDAY_TIMES).nextAfter(now,::isHoliday)

    private fun isHoliday(date:LocalDate)=
        if(date.year==2026) !BistCalendarFactory.create2026().isOpen(date) else false

    fun scheduleNextDataAlarm(context:Context,now:Instant=Instant.now()):Instant? {
        val app=context.applicationContext
        val cfg=config(app)
        val alarm=app.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        if(!cfg.dataEnabled) {
            alarm.cancel(dataAlarmPendingIntent(app,0L))
            app.getSharedPreferences(SCHEDULER_PREFS,Context.MODE_PRIVATE).edit().remove("nextDataAt").apply()
            return null
        }
        val next=nextDataAfter(app,now)
        val pi=dataAlarmPendingIntent(app,next.toEpochMilli())
        schedule(alarm,next,pi)
        app.getSharedPreferences(SCHEDULER_PREFS,Context.MODE_PRIVATE).edit()
            .putLong("nextDataAt",next.toEpochMilli())
            .putBoolean("exact",exactAllowed(alarm))
            .apply()
        return next
    }

    fun scheduleNextMarketAlarm(context:Context,now:Instant=Instant.now()):Instant? {
        val app=context.applicationContext
        val cfg=config(app)
        val alarm=app.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        if(!cfg.marketEnabled) {
            alarm.cancel(marketAlarmPendingIntent(app,0L))
            app.getSharedPreferences(SCHEDULER_PREFS,Context.MODE_PRIVATE).edit().remove("nextMarketAt").apply()
            return null
        }
        val next=nextMarketAfter(app,now)
        val pi=marketAlarmPendingIntent(app,next.toEpochMilli())
        schedule(alarm,next,pi)
        app.getSharedPreferences(SCHEDULER_PREFS,Context.MODE_PRIVATE).edit()
            .putLong("nextMarketAt",next.toEpochMilli())
            .putBoolean("marketExact",exactAllowed(alarm))
            .apply()
        return next
    }

    fun scheduleNextLogRetentionAlarm(context:Context,now:Instant=Instant.now()):Instant {
        val app=context.applicationContext
        val alarm=app.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val next=nextSundayMidnight(now)
        val pi=logRetentionAlarmPendingIntent(app,next.toEpochMilli())
        schedule(alarm,next,pi)
        app.getSharedPreferences(SCHEDULER_PREFS,Context.MODE_PRIVATE).edit()
            .putLong("nextLogRetentionAt",next.toEpochMilli())
            .putBoolean("logRetentionExact",exactAllowed(alarm))
            .apply()
        return next
    }

    private fun schedule(alarm:AlarmManager,next:Instant,pi:PendingIntent) {
        if(exactAllowed(alarm)) alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,next.toEpochMilli(),pi)
        else alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,next.toEpochMilli(),pi)
    }

    private fun exactAllowed(alarm:AlarmManager)=Build.VERSION.SDK_INT<31 || alarm.canScheduleExactAlarms()

    fun exactAlarmAllowed(context:Context):Boolean {
        val alarm=context.applicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        return exactAllowed(alarm)
    }

    fun reinstallAlarms(context:Context) {
        val app=context.applicationContext
        scheduleNextDataAlarm(app)
        scheduleNextMarketAlarm(app)
        scheduleNextLogRetentionAlarm(app)
    }

    fun openExactAlarmSettings(context:Context) {
        if(Build.VERSION.SDK_INT<31) return
        val intent=Intent(
            Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
            Uri.parse("package:"+context.packageName)
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.applicationContext.startActivity(intent)
    }

    fun schedulerState(context:Context):Pair<Instant?,Boolean> {
        val p=context.applicationContext.getSharedPreferences(SCHEDULER_PREFS,Context.MODE_PRIVATE)
        val at=p.getLong("nextDataAt",0L).takeIf{it>0}?.let(Instant::ofEpochMilli)
        return at to p.getBoolean("exact",false)
    }

    fun marketSchedulerState(context:Context):Pair<Instant?,Boolean> {
        val p=context.applicationContext.getSharedPreferences(SCHEDULER_PREFS,Context.MODE_PRIVATE)
        val at=p.getLong("nextMarketAt",0L).takeIf{it>0}?.let(Instant::ofEpochMilli)
        return at to p.getBoolean("marketExact",false)
    }

    fun logRetentionSchedulerState(context:Context):Pair<Instant?,Boolean> {
        val p=context.applicationContext.getSharedPreferences(SCHEDULER_PREFS,Context.MODE_PRIVATE)
        val at=p.getLong("nextLogRetentionAt",0L).takeIf{it>0}?.let(Instant::ofEpochMilli)
        return at to p.getBoolean("logRetentionExact",false)
    }

    fun enqueueScheduledLogRetention(context:Context,scheduledAtEpochMs:Long) {
        val at=scheduledAtEpochMs.takeIf{it>0}?:System.currentTimeMillis()
        val req=OneTimeWorkRequestBuilder<LogRetentionWorker>()
            .setInputData(workDataOf("scheduledAtUtc" to Instant.ofEpochMilli(at).toString()))
            .addTag(LOG_RETENTION)
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork(LOG_RETENTION,ExistingWorkPolicy.REPLACE,req)
    }

    fun enqueueScheduledData(context:Context,scheduledAtEpochMs:Long) {
        val network=Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val at=scheduledAtEpochMs.takeIf{it>0}?:System.currentTimeMillis()
        val req=OneTimeWorkRequestBuilder<MarketRefreshWorker>()
            .setConstraints(network)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS)
            .setInputData(workDataOf(
                "triggerSource" to "AUTO_SCHEDULE",
                "scheduledAtUtc" to Instant.ofEpochMilli(at).toString()
            ))
            .addTag(MARKET_REFRESH)
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork(DATA_SERIAL,ExistingWorkPolicy.APPEND_OR_REPLACE,req)
    }

    fun enqueueScheduledMarket(context:Context,scheduledAtEpochMs:Long) {
        val network=Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val at=scheduledAtEpochMs.takeIf{it>0}?:System.currentTimeMillis()
        val req=OneTimeWorkRequestBuilder<PortalRefreshWorker>()
            .setConstraints(network)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS)
            .setInputData(workDataOf(
                "triggerSource" to "AUTO_MARKET_SCHEDULE",
                "scheduledAtUtc" to Instant.ofEpochMilli(at).toString()
            ))
            .addTag(PORTAL_REFRESH)
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork(PORTAL_SERIAL,ExistingWorkPolicy.KEEP,req)
    }

    fun refreshDataNow(context:Context) {
        val network=Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val req=OneTimeWorkRequestBuilder<MarketRefreshWorker>()
            .setConstraints(network)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS)
            .setInputData(workDataOf("triggerSource" to "MANUAL"))
            .addTag(MARKET_REFRESH)
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork(DATA_SERIAL,ExistingWorkPolicy.APPEND_OR_REPLACE,req)
    }

    fun repairDataNow(context:Context) {
        val network=Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val req=OneTimeWorkRequestBuilder<DataRepairWorker>()
            .setConstraints(network)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork(DATA_SERIAL,ExistingWorkPolicy.APPEND_OR_REPLACE,req)
    }

    fun runStageNow(context:Context,stage:String) {
        require(stage in setOf("KN","K_TARIHSEL","S"))
        val req=OneTimeWorkRequestBuilder<ManualPipelineStageWorker>()
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS)
            .setInputData(workDataOf("stage" to stage))
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork(DATA_SERIAL,ExistingWorkPolicy.APPEND_OR_REPLACE,req)
    }

    fun refreshPortalNow(context:Context):java.util.UUID {
        val network=Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val req=OneTimeWorkRequestBuilder<PortalRefreshWorker>()
            .setConstraints(network)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS)
            .setInputData(workDataOf("triggerSource" to "MANUAL"))
            .addTag(PORTAL_REFRESH)
            .build()
        WorkManager.getInstance(context.applicationContext)
            .enqueueUniqueWork(PORTAL_SERIAL,ExistingWorkPolicy.APPEND_OR_REPLACE,req)
        return req.id
    }

    private fun dataAlarmPendingIntent(context:Context,scheduledAt:Long):PendingIntent {
        val intent=Intent(context,SchedulerAlarmReceiver::class.java)
            .setAction(ACTION_DATA_ALARM)
            .putExtra(EXTRA_SCHEDULED_AT,scheduledAt)
        return PendingIntent.getBroadcast(
            context,DATA_ALARM_REQUEST_CODE,intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun marketAlarmPendingIntent(context:Context,scheduledAt:Long):PendingIntent {
        val intent=Intent(context,SchedulerAlarmReceiver::class.java)
            .setAction(ACTION_MARKET_ALARM)
            .putExtra(EXTRA_SCHEDULED_AT,scheduledAt)
        return PendingIntent.getBroadcast(
            context,MARKET_ALARM_REQUEST_CODE,intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun logRetentionAlarmPendingIntent(context:Context,scheduledAt:Long):PendingIntent {
        val intent=Intent(context,SchedulerAlarmReceiver::class.java)
            .setAction(ACTION_LOG_RETENTION_ALARM)
            .putExtra(EXTRA_SCHEDULED_AT,scheduledAt)
        return PendingIntent.getBroadcast(
            context,LOG_RETENTION_ALARM_REQUEST_CODE,intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun parseTimes(raw:String?,fallback:List<LocalTime>):List<LocalTime> {
        val parsed=raw?.split(",")?.mapNotNull{runCatching{LocalTime.parse(it.trim())}.getOrNull()}
            ?.let(::normalizeTimes).orEmpty()
        return if(parsed.isEmpty()) fallback else parsed
    }

    private fun normalizeTimes(times:List<LocalTime>)=times.distinct().sorted()

    private const val KEY_DATA_ENABLED="dataEnabled"
    private const val KEY_DATA_TIMES="dataTimes"
    private const val KEY_MARKET_ENABLED="marketEnabled"
    private const val KEY_MARKET_TIMES="marketTimes"
}
