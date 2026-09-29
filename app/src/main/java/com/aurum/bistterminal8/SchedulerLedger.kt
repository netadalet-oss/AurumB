package com.aurum.bistterminal8
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
object SchedulerLedger {
 private const val PREFS="aurum_scheduler_ledger_v2"; private const val MAX_RECORDS=160
 fun token(epoch:Long,time:String,kind:String)="AUTO|"+kind+"|"+epoch+"|"+time.replace(":","")
 @Synchronized fun triggered(c:Context,epoch:Long,time:String,kind:String):Pair<String,Boolean>{val token=token(epoch,time,kind);val p=c.getSharedPreferences(PREFS,0);val old=read(p.getString(token,null));val prior=old?.optString("status").orEmpty();if(prior in setOf("QUEUED","RUNNING","COMPLETED"))return token to false;val now=Instant.now().toString();val row=(old?:JSONObject()).put("eventId",token).put("jobToken",token).put("kind",kind).put("scheduledEpoch",epoch).put("scheduledTime",time).put("scheduledAt",Instant.ofEpochMilli(epoch).toString()).put("triggerReceivedAt",now).put("status","QUEUED").put("attempt",(old?.optInt("attempt",0)?:0)+1).put("error",JSONObject.NULL);p.edit().putString(token,row.toString()).apply();trim(p);return token to true}
 @Synchronized fun running(c:Context,token:String)=update(c,token){it.put("status","RUNNING").put("startedAt",Instant.now().toString()).put("error",JSONObject.NULL)}
 @Synchronized fun complete(c:Context,token:String,status:String,detail:String)=update(c,token){it.put("completedAt",Instant.now().toString()).put("status",status).put("detail",detail).put("error",if(status=="FAILED")detail else JSONObject.NULL)}
 @Synchronized fun fail(c:Context,token:String,detail:String)=complete(c,token,"FAILED",detail)
 fun status(c:Context,token:String)=read(c.getSharedPreferences(PREFS,0).getString(token,null))?.optString("status").orEmpty()
 fun latest(c:Context)=rows(c).firstOrNull()?:JSONObject()
 fun latestByKind(c:Context,kind:String)=rows(c).firstOrNull{it.optString("kind")==kind}?:JSONObject()
 fun recent(c:Context,limit:Int=40)=JSONArray(rows(c).take(limit))
 private fun rows(c:Context)=c.getSharedPreferences(PREFS,0).all.values.mapNotNull{read(it as? String)}.sortedByDescending{it.optString("triggerReceivedAt",it.optString("scheduledAt"))}
 private fun read(raw:String?)=raw?.let{runCatching{JSONObject(it)}.getOrNull()}
 private fun update(c:Context,token:String,f:(JSONObject)->JSONObject){if(token.isBlank())return;val p=c.getSharedPreferences(PREFS,0);val row=read(p.getString(token,null))?:JSONObject().put("eventId",token).put("jobToken",token);p.edit().putString(token,f(row).toString()).apply()}
 private fun trim(p:android.content.SharedPreferences){val xs=p.all.mapNotNull{(k,v)->read(v as? String)?.let{k to it.optString("triggerReceivedAt",it.optString("scheduledAt"))}}.sortedByDescending{it.second};if(xs.size>MAX_RECORDS)p.edit().also{e->xs.drop(MAX_RECORDS).forEach{e.remove(it.first)}}.apply()}
}