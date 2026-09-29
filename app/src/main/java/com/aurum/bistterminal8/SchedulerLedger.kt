package com.aurum.bistterminal8
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
object SchedulerLedger {
 private const val PREFS="aurum_scheduler_ledger"; private const val STALE_MS=7200000L
 enum class BeginResult { ACCEPTED, SKIPPED_DUPLICATE }
 fun begin(c:Context,token:String,epoch:Long,time:String,kind:String):BeginResult=synchronized(this){
  val p=c.getSharedPreferences(PREFS,0); p.getString(token,null)?.let{val s=runCatching{JSONObject(it).optString("status")}.getOrDefault("");if(SchedulerLedgerPolicy.blocksDuplicate(s)){recordDuplicate(c,token);return@synchronized BeginResult.SKIPPED_DUPLICATE}}
  val now=System.currentTimeMillis();val r=JSONObject().put("eventId",token).put("jobToken",token).put("source",kind).put("scheduledAt",epoch).put("scheduledTime",time).put("acceptedAt",now).put("status","PENDING").put("attempt",SchedulerLedgerPolicy.nextAttempt(runCatching{JSONObject(p.getString(token,"{}")?:"{}").optInt("attempt",0)}.getOrDefault(0)))
  p.edit().putString(token,r.toString()).commit();BeginResult.ACCEPTED
 }
 fun markRunning(c:Context,token:String)=mutate(c,token){val now=System.currentTimeMillis();it.put("status","RUNNING").put("startedAt",now).put("lastHeartbeatAt",now)}
 fun heartbeat(c:Context,token:String)=mutate(c,token){if(it.optString("status")=="RUNNING")it.put("lastHeartbeatAt",System.currentTimeMillis())}
 fun complete(c:Context,token:String,status:String,detail:String="",stage:String="")=mutate(c,token){it.put("finishedAt",System.currentTimeMillis()).put("status",status).put("errorMessage",detail).put("failureStage",stage)}
 fun reconcileStale(c:Context,now:Long=System.currentTimeMillis()):Int{synchronized(this){val p=c.getSharedPreferences(PREFS,0);var n=0;p.all.forEach{(k,v)->val r=runCatching{JSONObject(v as String)}.getOrNull()?:return@forEach;{val h=r.optLong("lastHeartbeatAt",r.optLong("startedAt",0));if(SchedulerLedgerPolicy.isStaleRunning(r.optString("status"),h,now,STALE_MS)){r.put("status","TIMED_OUT").put("finishedAt",now).put("failureStage","RECOVERY").put("errorCode","STALE_RUNNING");p.edit().putString(k,r.toString()).commit();n++}}};return n}}
 fun latest(c:Context):JSONObject{val rows=c.getSharedPreferences(PREFS,0).all.values.mapNotNull{runCatching{JSONObject(it as String)}.getOrNull()}.filterNot{it.optString("status")=="SKIPPED_DUPLICATE"}.sortedByDescending{maxOf(it.optLong("startedAt",0),it.optLong("acceptedAt",0),it.optLong("finishedAt",0))};return JSONObject().put("latest",rows.firstOrNull()?:JSONObject()).put("recent",JSONArray(rows.take(20)))}
 fun token(epoch:Long,time:String,kind:String)="AUTO|"+kind+"|"+epoch+"|"+time.replace(":","")
 private fun recordDuplicate(c:Context,token:String){val p=c.getSharedPreferences(PREFS,0);val k=token+"|duplicate|"+System.currentTimeMillis();p.edit().putString(k,JSONObject().put("jobToken",token).put("status","SKIPPED_DUPLICATE").put("finishedAt",System.currentTimeMillis()).put("errorMessage","IDEMPOTENCY_GATE").toString()).commit()}
 private fun mutate(c:Context,token:String,block:(JSONObject)->Unit){if(token.isBlank())return;synchronized(this){val p=c.getSharedPreferences(PREFS,0);val r=runCatching{JSONObject(p.getString(token,"{}")?:"{}")}.getOrElse{JSONObject()};r.put("jobToken",token);block(r);p.edit().putString(token,r.toString()).commit()}}
}
