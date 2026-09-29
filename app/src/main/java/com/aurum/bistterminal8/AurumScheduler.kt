package com.aurum.bistterminal8
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONObject
import java.time.*
import java.time.format.DateTimeFormatter
object AurumScheduler{
 private const val PREFS="aurum_scheduler";private const val ACTION_SLOT="com.aurum.bistterminal8.SCHEDULED_SLOT"
 private val zone=ZoneId.of("Europe/Istanbul");private val fmt=DateTimeFormatter.ofPattern("HH:mm")
 private val weekdayDefaults=listOf("00:30","04:30","08:20","09:20","10:20","11:20","12:20","13:20","14:20","15:20","16:20","17:20","18:20","19:20","20:30","21:30","22:30","23:30")
 private val weekendDefaults=listOf("12:30")
 fun valid(v:String)=runCatching{LocalTime.parse(v,fmt);true}.getOrDefault(false)
 private fun defaultTimes(date:LocalDate)=if(date.dayOfWeek==DayOfWeek.SATURDAY||date.dayOfWeek==DayOfWeek.SUNDAY)weekendDefaults else weekdayDefaults
 fun configuredTimes(c:Context,kind:String="data"):List<String>{val p=c.getSharedPreferences(PREFS,0);val key=if(kind=="market")"market_times" else "times";val raw=p.getString(key,null);val custom=raw?.split(',')?.map(String::trim)?.filter(::valid)?.distinct()?.sorted().orEmpty();if(custom.isNotEmpty())return custom;val base=defaultTimes(LocalDate.now(zone));return if(kind=="market")base.map(::plus30) else base}
 fun enabled(c:Context,kind:String)=c.getSharedPreferences(PREFS,0).getBoolean(if(kind=="market")"market_enabled" else "enabled",false)
 fun install(c:Context,on:Boolean,times:List<String>,kind:String="data"):Boolean{val clean=times.map(String::trim).filter(::valid).distinct().sorted();if(on&&times.isNotEmpty()&&clean.isEmpty())return false;cancelAll(c,kind);c.getSharedPreferences(PREFS,0).edit().putBoolean(if(kind=="market")"market_enabled" else "enabled",on).putString(if(kind=="market")"market_times" else "times",clean.joinToString(",")).apply();if(on)scheduleKind(c,kind,Instant.now());return true}
 fun exactAllowed(c:Context):Boolean{val am=c.getSystemService(AlarmManager::class.java);return Build.VERSION.SDK_INT<31||am.canScheduleExactAlarms()}
 fun rearm(c:Context){SchedulerLedger.reconcileStale(c);for(k in listOf("data","market"))if(enabled(c,k)){cancelAll(c,k);scheduleKind(c,k,Instant.now())}}
 private fun scheduleKind(c:Context,kind:String,after:Instant){val custom=configuredCustom(c,kind);val dates=(0..7).map{after.atZone(zone).toLocalDate().plusDays(it.toLong())};val candidates=dates.flatMap{d->val base=if(custom.isNotEmpty())custom else if(kind=="market")defaultTimes(d).map(::plus30) else defaultTimes(d);base.map{t->t to ZonedDateTime.of(d,LocalTime.parse(t,fmt),zone).toInstant()}}.filter{it.second.isAfter(after.plusSeconds(1))};candidates.groupBy{it.first}.forEach{(_,v)->v.minByOrNull{it.second}?.let{scheduleAt(c,it.first,it.second.toEpochMilli(),kind)}}}
 fun scheduleNextForTime(c:Context,time:String,after:Instant,kind:String="data"){if(!valid(time)||!enabled(c,kind))return;val custom=configuredCustom(c,kind);var cursor=after.atZone(zone).toLocalDate();repeat(8){val allowed=if(custom.isNotEmpty())time in custom else {val base=if(kind=="market")defaultTimes(cursor).map(::plus30) else defaultTimes(cursor);time in base};if(allowed){val target=ZonedDateTime.of(cursor,LocalTime.parse(time,fmt),zone).toInstant();if(target.isAfter(after.plusSeconds(1))){scheduleAt(c,time,target.toEpochMilli(),kind);return}};cursor=cursor.plusDays(1)}}
 fun statusJson(c:Context):String{val p=c.getSharedPreferences(PREFS,0);val o=JSONObject().put("exactAllowed",exactAllowed(c)).put("sdk",Build.VERSION.SDK_INT).put("staleRecovered",SchedulerLedger.reconcileStale(c));for(k in listOf("data","market")){o.put(k+"Enabled",enabled(c,k));o.put(k+"Times",org.json.JSONArray(configuredTimes(c,k)));o.put(k+"Next",JSONObject(p.all.filterKeys{it.startsWith("next_"+k+"_")}))};return o.put("ledger",SchedulerLedger.latest(c)).toString()}
 private fun configuredCustom(c:Context,kind:String):List<String>{val key=if(kind=="market")"market_times" else "times";return c.getSharedPreferences(PREFS,0).getString(key,null)?.split(',')?.map(String::trim)?.filter(::valid)?.distinct()?.sorted().orEmpty()}
 private fun scheduleAt(c:Context,time:String,epoch:Long,kind:String){val am=c.getSystemService(AlarmManager::class.java);val pi=pending(c,time,epoch,kind);if(Build.VERSION.SDK_INT>=31&&!am.canScheduleExactAlarms())am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,epoch,pi) else am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,epoch,pi);c.getSharedPreferences(PREFS,0).edit().putLong("next_"+kind+"_"+time.replace(":",""),epoch).apply()}
 private fun cancelAll(c:Context,kind:String){val am=c.getSystemService(AlarmManager::class.java);(weekdayDefaults+weekendDefaults+weekdayDefaults.map(::plus30)+weekendDefaults.map(::plus30)+configuredCustom(c,kind)).distinct().forEach{t->PendingIntent.getBroadcast(c,requestCode(t,kind),Intent(c,TriggerReceiver::class.java).setAction(ACTION_SLOT),PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)?.let{am.cancel(it);it.cancel()}}}
 fun pending(c:Context,time:String,epoch:Long,kind:String)=PendingIntent.getBroadcast(c,requestCode(time,kind),Intent(c,TriggerReceiver::class.java).setAction(ACTION_SLOT).putExtra("slotTime",time).putExtra("epoch",epoch).putExtra("pipelineKind",kind),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
 private fun requestCode(t:String,k:String)=(k+"|"+t).hashCode()
 private fun plus30(t:String)=LocalTime.parse(t,fmt).plusMinutes(30).format(fmt)
}
