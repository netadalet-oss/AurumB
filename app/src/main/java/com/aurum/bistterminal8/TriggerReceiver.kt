package com.aurum.bistterminal8
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import java.time.Instant
class TriggerReceiver:BroadcastReceiver(){
 override fun onReceive(c:Context,i:Intent){
  val time=i.getStringExtra("slotTime")?:return
  val kind=i.getStringExtra("pipelineKind").let{if(it=="market")"market" else "data"}
  val epoch=i.getLongExtra("epoch",0L).takeIf{it>0}?:System.currentTimeMillis()
  val token=SchedulerLedger.token(epoch,time,kind)
  val gate=SchedulerLedger.begin(c,token,epoch,time,kind)
  if(gate==SchedulerLedger.BeginResult.STARTED){
   runCatching{ContextCompat.startForegroundService(c,Intent(c,PipelineService::class.java).putExtra("epoch",epoch).putExtra("jobToken",token).putExtra("pipelineKind",kind))}
    .onFailure{SchedulerLedger.complete(c,token,"FAILED",it.javaClass.simpleName,"SERVICE_START")}
  }
  AurumScheduler.scheduleNextForTime(c,time,Instant.ofEpochMilli(maxOf(epoch,System.currentTimeMillis())).plusSeconds(1),kind)
 }
}
