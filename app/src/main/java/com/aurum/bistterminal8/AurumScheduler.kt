package com.aurum.bistterminal8
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.time.*
import java.time.format.DateTimeFormatter

object AurumScheduler {
 private const val PREFS="aurum_scheduler"; private const val ACTION_SLOT="com.aurum.bistterminal8.SCHEDULED_SLOT"
 private val zone=ZoneId.of("Europe/Istanbul"); private val fmt=DateTimeFormatter.ofPattern("HH:mm")
 private val weekdayDefaults=listOf("00:30","04:30","08:20","09:20","10:20","11:20","12:20","13:20","14:20","15:20","16:20","17:20","18:20","19:20","20:30","21:30","22:30","23:30")
 private val weekendDefaults=listOf("12:30"); private val defaults=(weekdayDefaults+weekendDefaults).distinct().sorted()
 fun valid(v:String)=runCatching{LocalTime.parse(v,fmt);true}.getOrDefault(false)
 fun configuredTimes(c:Context,kind:String="data"):List<String>{val key=if(kind=="market")"market_times" else "times";val raw=c.getSharedPreferences(PREFS,0).getString(key,null);val p=raw?.split(',')?.map(String::trim)?.filter(::valid)?.distinct()?.sorted().orEmpty();return if(p.isNotEmpty())p else if(kind=="market") configuredTimes(c,"data").map(::plus30) else defaults}
 fun enabled(c:Context,kind:String)=c.getSharedPreferences(PREFS,0).getBoolean(if(kind=="market")"market_enabled" else "enabled",false)
 fun install(c:Context,enabled:Boolean,times:List<String>,kind:String="data"):Boolean{val clean=times.map(String::trim).filter(::valid).distinct().sorted();if(enabled&&clean.isEmpty())return false;cancel(c,configuredTimes(c,kind),kind);c.getSharedPreferences(PREFS,0).edit().putBoolean(if(kind=="market")"market_enabled" else "enabled",enabled).putString(if(kind=="market")"market_times" else "times",clean.joinToString(",")).apply();if(enabled)clean.forEach{scheduleNextForTime(c,it,Instant.now(),kind)};return true}
 fun rearm(c:Context){for(k in listOf("data","market"))if(enabled(c,k))configuredTimes(c,k).forEach{scheduleNextForTime(c,it,Instant.now(),k)}}
 fun scheduleNextForTime(c:Context,time:String,after:Instant,kind:String="data"){if(!valid(time)||!enabled(c,kind))return;var target=ZonedDateTime.of(after.atZone(zone).toLocalDate(),LocalTime.parse(time,fmt),zone);if(!target.toInstant().isAfter(after.plusSeconds(1)))target=target.plusDays(1);val epoch=target.toInstant().toEpochMilli();val am=c.getSystemService(AlarmManager::class.java);val pi=pending(c,time,epoch,kind);if(Build.VERSION.SDK_INT>=31&&!am.canScheduleExactAlarms())am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,epoch,pi) else am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,epoch,pi)}
 private fun cancel(c:Context,times:List<String>,kind:String){val am=c.getSystemService(AlarmManager::class.java);times.forEach{PendingIntent.getBroadcast(c,requestCode(it,kind),Intent(c,TriggerReceiver::class.java).setAction(ACTION_SLOT),PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)?.let{p->am.cancel(p);p.cancel()}}}
 fun pending(c:Context,time:String,epoch:Long,kind:String)=PendingIntent.getBroadcast(c,requestCode(time,kind),Intent(c,TriggerReceiver::class.java).setAction(ACTION_SLOT).putExtra("slotTime",time).putExtra("epoch",epoch).putExtra("pipelineKind",kind),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
 private fun requestCode(t:String,k:String)=(k+"|"+t).hashCode()
 private fun plus30(t:String)=LocalTime.parse(t,fmt).plusMinutes(30).format(fmt)
}