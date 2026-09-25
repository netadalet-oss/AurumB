'use strict';
/* REV20 hardening contract — loaded last. Safety rules only; no layout redesign. */
(()=>{
  if(globalThis.__AURUM_HARDENING_20260925)return;
  globalThis.__AURUM_HARDENING_20260925=true;
  const MIN_FILL=70;
  const now=()=>new Date().toISOString();
  const log=(kind,detail={})=>{try{const k='aurum.hardening.log.v1',a=JSON.parse(localStorage.getItem(k)||'[]');a.push({at:now(),kind,...detail});localStorage.setItem(k,JSON.stringify(a.slice(-240)))}catch{}};

  /* Final publication gate. Every normal Veriler publication must satisfy the same
     >=70% rule before the underlying publisher can touch the active snapshot. */
  const basePublish=globalThis.atomicPublish;
  if(typeof basePublish==='function')globalThis.atomicPublish=async function hardenedAtomicPublish(job,universe){
    const rows=typeof globalThis.stageRows==='function'?await globalThis.stageRows(job?.id):[];
    const records=(rows||[]).map(x=>x?.record).filter(Boolean);
    const summary=typeof globalThis.dataSummary==='function'?globalThis.dataSummary(records):{fillPct:0};
    const gate=typeof globalThis.dataIntegrityGate==='function'?globalThis.dataIntegrityGate(summary):{ok:Number(summary?.fillPct||0)>=MIN_FILL,reason:'MIN_FILL_70'};
    const fill=Number(summary?.fillPct||0);
    if(!gate?.ok||fill<MIN_FILL){log('PUBLISH_BLOCKED',{jobId:job?.id||null,fillPct:fill,reason:gate?.reason||'MIN_FILL_70'});throw new Error('DATA_INTEGRITY_GATE:'+fill.toFixed(2))}
    return basePublish.apply(this,arguments);
  };

  /* Orphan staging is evidence for diagnostics, not permission to mutate the live table.
     A fresh/repair run can consume it later through the normal atomic publisher. */
  if(typeof globalThis.recoverOrphanStagingRecords==='function')globalThis.recoverOrphanStagingRecords=async function hardenedRecoverOrphans(){
    const rows=typeof globalThis.dbAll==='function'?await globalThis.dbAll('stagingRecords'):[];
    log('ORPHAN_STAGING_RETAINED',{count:rows?.length||0});
    return {recovered:0,retained:rows?.length||0,removed:0,safe:true};
  };

  /* Legacy local repair used to write active records directly. Disable that unsafe
     writer; online repair/re-fetch remains available through the normal pipeline. */
  if(typeof globalThis.repairLegacyCorruptRecordsLocal==='function')globalThis.repairLegacyCorruptRecordsLocal=async function hardenedLegacyRepair(){
    log('LEGACY_DIRECT_REPAIR_SKIPPED');
    return {ok:false,changed:0,reason:'SAFE_ATOMIC_REPAIR_REQUIRED'};
  };

  /* Repair buttons must never silently rewrite performance/network preferences. */
  if(typeof globalThis.r73FastTransferRepair==='function')globalThis.r73FastTransferRepair=async function hardenedTransferRepair(){
    try{for(const id of [...(globalThis.STAGE_BATCHES?.keys?.()||[])])await globalThis.flushStageBatch?.(id)}catch{}
    log('TRANSFER_REPAIR_SAFE');
    return true;
  };

  /* Persist one authoritative successful data timestamp when the active snapshot says
     publication succeeded. This survives restart and is never advanced on failure. */
  const baseRefreshMeta=globalThis.refreshTableMeta;
  if(typeof baseRefreshMeta==='function')globalThis.refreshTableMeta=async function hardenedRefreshMeta(){
    const out=await baseRefreshMeta.apply(this,arguments);
    try{
      const snap=(await globalThis.dbGet?.('meta','activeDataSnapshot'))?.value;
      const at=snap?.transferredAt||snap?.completedAt||null;
      if(at){
        if(globalThis.state)globalThis.state.lastSuccessfulSync=at;
        if(globalThis.AurumUpdateAPI?.state)globalThis.AurumUpdateAPI.state.lastSuccessfulSync=at;
        await globalThis.dbPut?.('meta',{key:'lastSuccessfulSync',value:at,updatedAt:at});
      }
    }catch(e){log('TIMESTAMP_PERSIST_FAILED',{error:String(e?.message||e)})}
    return out;
  };

  /* One market cadence: startup refresh arms the market module's own 30-minute timer.
     Do not create another interval here. */
  setTimeout(()=>{try{globalThis.refreshMarketIndicators?.()}catch{}},15000);

  globalThis.AurumHardening=Object.freeze({version:'2026.09.25',minFill:MIN_FILL,logs:()=>{try{return JSON.parse(localStorage.getItem('aurum.hardening.log.v1')||'[]')}catch{return []}}});
})();