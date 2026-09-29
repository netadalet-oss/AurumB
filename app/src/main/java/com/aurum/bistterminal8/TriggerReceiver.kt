package com.aurum.bistterminal8
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import java.time.Instant
class TriggerReceiver:BroadcastReceiver(){
 override fun onReceive(context:Context,intent:Intent){
  val slotTime=intent.getStringExtra("slotTime")?:return
  val kind=intent.getStringExtra("pipelineKind").let{if(it=="market")"market" else "data"}
  val epoch=intent.getLongExtra("epoch",0L).takeIf{it>0L}?:System.currentTimeMillis()
  val (token,shouldStart)=SchedulerLedger.triggered(context,epoch,slotTime,kind)
  try{if(shouldStart)ContextCompat.startForegroundService(context,Intent(context,PipelineService::class.java).putExtra("epoch",epoch).putExtra("jobToken",token).putExtra("pipelineKind",kind))}
  catch(t:Throwable){SchedulerLedger.fail(context,token,"SERVICE_START_FAILED:"+t.javaClass.simpleName+":"+t.message.orEmpty())}
  finally{AurumScheduler.scheduleNextForTime(context,slotTime,Instant.now(),kind)}
 }
}