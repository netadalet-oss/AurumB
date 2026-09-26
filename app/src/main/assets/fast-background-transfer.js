'use strict';
/* REV20 transfer profile: fast-by-default without weakening validation/staging/atomic publish.
   Native partial wake lock is held only while a data operation is actually busy. */
(()=>{
 if(globalThis.__AURUM_FAST_BG_TRANSFER__)return;globalThis.__AURUM_FAST_BG_TRANSFER__=true;
 const apply=async()=>{
  try{
   const s=globalThis.state?.settings;if(!s)return;
   s.concurrency=Math.max(Number(s.concurrency||0),56);
   s.maxGlobalConcurrency=Math.max(Number(s.maxGlobalConcurrency||0),56);
   s.adaptiveConcurrency=true;s.providerHealthAdaptive=true;
   s.richParallelAllProviders=true;s.providerWaveSize=Math.max(Number(s.providerWaveSize||0),12);
   s.stageBatchSize=Math.max(Number(s.stageBatchSize||0),384);s.stageFlushMs=1;
   if(typeof saveSettings==='function')await saveSettings();
  }catch{}
 };
 const keep=on=>{try{globalThis.AurumNativeCall?.('aurum://native?cmd=transfer_keepalive&enabled='+(on?'1':'0'),'')}catch{}};
 const busy=()=>{try{const r=typeof currentRuntime==='function'?currentRuntime():null;return !!(r&&typeof operationBusyStatus==='function'&&operationBusyStatus(r.status))}catch{return false}};
 let held=false;
 const sync=()=>{const b=busy();if(b!==held){held=b;keep(b)}};
 /* No startup, polling or lifecycle trigger. Transfer policy is applied only by an authorized data job. */
 const old=globalThis.AurumRuntime?.manualData;
 if(typeof old==='function'){
  globalThis.AurumRuntime.manualData=async function(...a){await apply();keep(true);held=true;try{return await old.apply(this,a)}finally{keep(false);held=false}};
 }
})();