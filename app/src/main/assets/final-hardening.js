'use strict';
/* R226 final hardening: immutable sub-70 snapshot, source-time display, compact strip settings. */
(()=>{
 if(globalThis.AURUM_R226_HARDENING==='R226.0')return; globalThis.AURUM_R226_HARDENING='R226.0';
 const S=globalThis.AurumUpdateAPI?.state||globalThis.state;
 const iso=()=>new Date().toISOString(), num=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
 function audit(code,message,extra={}){try{globalThis.log?.('info',message,{code,...extra})}catch{}}
 function activeFill(){try{return Number(globalThis.dataSummary?.(S.records)?.fillPct||0)}catch{return 0}}
 function candidateGate(records){try{return globalThis.dataIntegrityGate?.(globalThis.dataSummary?.(records))||{ok:false,fillPct:0}}catch{return {ok:false,fillPct:0}}}

 /* Veriler publication is independent of the >=70 derived-calculation gate.
    Do not wrap atomicPublish with a sub-70 rejection here: runtime.js owns publication,
    while dataIntegrityGate/calculationGateStatus protects Kn/K_Tarihsel/S/AL-SAT. */
 try{
  const base=globalThis.atomicPublish;
  if(typeof base==='function'&&!base.__r226){
   const w=async function(){return base.apply(this,arguments)};
   w.__r226=true;globalThis.atomicPublish=w;try{atomicPublish=w}catch{}
  }
 }catch{}

 /* Orphan staging is diagnostic material, never an alternate publication channel. */
 try{
  const safe=async function(){
   if(!S?.db)return {recovered:0,retained:0,quarantined:0};
   const [rows,jobs]=await Promise.all([globalThis.dbAll('stagingRecords'),globalThis.dbAll('jobs')]);
   const active=new Set(jobs.filter(j=>globalThis.operationBusyStatus?.(String(j?.status||''))).map(j=>j.id));
   const orph=rows.filter(x=>!active.has(x.jobId));
   if(!orph.length)return {recovered:0,retained:0,quarantined:0};
   await globalThis.dbPut('meta',{key:'orphanStagingQuarantine',value:{at:iso(),count:orph.length,jobIds:[...new Set(orph.map(x=>x.jobId))]},updatedAt:iso()});
   audit('ORPHAN_STAGING_QUARANTINED','Aktif işe bağlı olmayan staging kayıtları canlı Veriler tablosuna yayımlanmadı',{count:orph.length});
   return {recovered:0,retained:orph.length,quarantined:orph.length};
  };globalThis.recoverOrphanStagingRecords=safe;try{recoverOrphanStagingRecords=safe}catch{}
 }catch{}

 /* Legacy local repair may run only against an already accepted snapshot and may never
    turn a sub-70 active table into a new timestamped state. */
 try{
  const base=globalThis.repairLegacyCorruptRecordsLocal;
  if(typeof base==='function'){
   const w=async function(){
    const fill=activeFill();
    if(fill<70){audit('LOCAL_REPAIR_HELD','Yerel onarım %70 altı aktif tabloda yayın yapmadı',{fillPct:fill});return {complete:false,held:true,repaired:0,failed:0,fillPct:fill}}
    return base.apply(this,arguments);
   };globalThis.repairLegacyCorruptRecordsLocal=w;try{repairLegacyCorruptRecordsLocal=w}catch{}
  }
 }catch{}

 function trParts(d=new Date()){try{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d),o={};for(const x of p)o[x.type]=x.value;return {date:o.year+'-'+o.month+'-'+o.day,wd:o.weekday,min:Number(o.hour)*60+Number(o.minute)}}catch{return null}}
 function sessionOpen(){const p=trParts();if(!p||p.wd==='Sat'||p.wd==='Sun')return false;try{if(globalThis.schedulerIsHolidayDate?.(p.date))return false}catch{}return p.min>=600&&p.min<=1080}
 function closePrice(rec){const a=rec?.series?.calcClose||rec?.series?.close||[];for(let i=a.length-1;i>=0;i--){const n=num(a[i]);if(n!=null&&n>0)return n}const n=num(rec?.price);return n!=null&&n>0?n:null}
 function sourceTime(rec){if(rec?.marketTimeVerified===true&&rec?.marketDataAt&&Number.isFinite(Date.parse(rec.marketDataAt)))return rec.marketDataAt;const z=rec?.series||{};for(const k of ['marketTime','timestamp','time','at']){const a=z[k];if(Array.isArray(a)){for(let i=a.length-1;i>=0;i--)if(a[i]&&Number.isFinite(Date.parse(a[i])))return a[i]}}const p=rec?.provenance;if(p?.marketTimeVerified===true&&p?.marketAt&&Number.isFinite(Date.parse(p.marketAt)))return p.marketAt;return rec?.lastVisibleMarketAt&&Number.isFinite(Date.parse(rec.lastVisibleMarketAt))?rec.lastVisibleMarketAt:null}
 function displayPrice(rec){if(sessionOpen()){const n=num(rec?.livePrice);if(n!=null&&n>0)return n;const h=num(rec?.lastVisiblePrice);if(h!=null&&h>0)return h}return closePrice(rec)??num(rec?.lastVisiblePrice)}
 try{
  const raw=globalThis.v141225Raw;if(typeof raw==='function'){const w=function(rec,key,skip){if(key==='Anlik')return displayPrice(rec);if(key==='VeriZamani')return sourceTime(rec);return raw(rec,key,skip)};globalThis.v141225Raw=w;try{v141225Raw=w}catch{}}
  globalThis.kn117LatestPrice=displayPrice;try{kn117LatestPrice=displayPrice}catch{}
  globalThis.kn117MarketTime=sourceTime;try{kn117MarketTime=sourceTime}catch{}
  const bt=globalThis.kh117T0;if(typeof bt==='function'){const w=function(){const r=bt.apply(this,arguments);return {...r,marketTime:(S.records||[]).map(sourceTime).filter(Boolean).sort().at(-1)||r?.marketTime||null}};globalThis.kh117T0=w;try{kh117T0=w}catch{}}
 }catch{}

 /* AurumB legacy appearance implementation removed; presentation-settings.js is the sole AurumF-derived authority. */

 /* Continuous diagnostics: no destructive auto-fix, but safe scheduler/market repair hooks. */
 async function health(){
  const fill=activeFill(),meta=await globalThis.dbGet?.('meta','activeDataSnapshot'),rt=globalThis.AurumRuntime?.status?.()||{},marketAt=globalThis.cachedMarketIndicators?.()?.updatedAt||null;
  const scheduler=await globalThis.r73SchedulerDiagnostic?.().catch?.(()=>null);
  /* Diagnostics are read-only. Repair/re-arm is allowed only through an explicit user command
     or the native Veriler scheduler trigger; diagnostics never start work by themselves. */
  const report={at:iso(),fillPct:fill,snapshotAt:meta?.value?.changedAt||meta?.value?.transferredAt||null,runtime:rt.status||'IDLE',scheduler,market:globalThis.cachedMarketIndicators?.()?.updatedAt||marketAt};
  try{localStorage.setItem('aurum.r226.health.latest',JSON.stringify(report))}catch{}return report
 }
 let centralDepth=0;
 const centralAllowed=()=>centralDepth>0;
 async function centralCompanionRun(context='DATA'){
  if(!centralAllowed()){audit('CENTRAL_TRIGGER_DENIED','Merkez dışı yardımcı çalışma engellendi',{context});return false}
  const out={at:iso(),context,market:false,portal:false,diagnostics:false};
  /* Market indicators are acquired inside the same Veriler phase; display completion may only
     fill presentation fields while this central authorization is active. */
  try{if(typeof globalThis.AurumMarketDisplayComplete==='function')await globalThis.AurumMarketDisplayComplete()}catch(e){audit('CENTRAL_MARKET_DISPLAY_FAILED','Piyasa gösterge tamamlama adımı başarısız',{error:e?.message||String(e)})}
  out.market=!!globalThis.cachedMarketIndicators?.()?.updatedAt;
  try{out.portal=!!(await globalThis.refreshAurumFinancePortal?.(String(context).startsWith('MANUAL')))}catch(e){audit('CENTRAL_PORTAL_FAILED','Veriler zincirindeki finans portalı güncellenemedi',{error:e?.message||String(e)})}
  try{await globalThis.refreshAurumRMarketIntel?.(true)}catch(e){audit('CENTRAL_INTEL_FAILED','Veriler zincirindeki piyasa istihbaratı güncellenemedi',{error:e?.message||String(e)})}
  try{await globalThis.AurumNLPortal?.refresh?.()}catch(e){audit('CENTRAL_NL_PORTAL_FAILED','Veriler zincirindeki Nederland portalı güncellenemedi',{error:e?.message||String(e)})}
  try{await health();out.diagnostics=true}catch(e){audit('CENTRAL_DIAGNOSTIC_FAILED','Veriler zincirindeki tanı çalışması tamamlanamadı',{error:e?.message||String(e)})}
  try{localStorage.setItem('aurum.r226.central.last',JSON.stringify(out))}catch{}
  return out
 }
 /* One trigger contract: companions can run only inside a Veriler MANUAL/AUTO job.
    No timer, startup, navigation, focus, reconnect or standalone market/portal action starts them. */
 try{
  const base=globalThis.prepareGeneralData;
  if(typeof base==='function'){
   const w=async function(job,mode){const allowed=['MANUAL','AUTO'].includes(String(job?.mode||'').toUpperCase());if(allowed)centralDepth++;try{const ok=await base.apply(this,arguments);return ok}finally{if(allowed)centralDepth=Math.max(0,centralDepth-1)}};
   globalThis.prepareGeneralData=w;try{prepareGeneralData=w}catch{}
  }
  const repair=globalThis.prepareMissingData;
  if(typeof repair==='function'){
   const w=async function(job){const allowed=['MANUAL','AUTO'].includes(String(job?.mode||'').toUpperCase());if(allowed)centralDepth++;try{const ok=await repair.apply(this,arguments);return ok}finally{if(allowed)centralDepth=Math.max(0,centralDepth-1)}};
   globalThis.prepareMissingData=w;try{prepareMissingData=w}catch{}
  }
  const moduleFns={};for(const name of ['refreshMarketIndicators','refreshAurumFinancePortal','refreshAurumMarketSummary','refreshAurumRMarketIntel']){const fn=globalThis[name];if(typeof fn==='function')moduleFns[name]=fn}
  globalThis.AurumMarketModuleRefresh=async function(){
   /* Hard module boundary: an explicit market refresh owns only market indicators + finance portal.
      It must never enter Veriler, completion/repair, Kn, K_Tarihsel, S, trade or unrelated portal modules. */
   try{
    const out={};
    centralDepth++;
    try{
     if(moduleFns.refreshMarketIndicators)out.indicators=await moduleFns.refreshMarketIndicators({force:true,manual:true});
     if(moduleFns.refreshAurumFinancePortal)out.portal=await moduleFns.refreshAurumFinancePortal(true);
    }finally{centralDepth=Math.max(0,centralDepth-1)}
    audit('MODULE_REFRESH','Piyasa göstergeleri ve finans portalı kullanıcı komutuyla yenilendi',{module:'market',scope:['indicators','financePortal']});
    return out
   }catch(e){audit('MODULE_REFRESH_FAILED','Piyasa modülü yenilenemedi',{error:e?.message||String(e)});throw e}
  };
  for(const name of Object.keys(moduleFns)){const fn=moduleFns[name];globalThis[name]=async function(){if(!centralAllowed()){audit('CENTRAL_NETWORK_DENIED',name+' merkez tetik dışında engellendi');return name==='refreshMarketIndicators'?globalThis.cachedMarketIndicators?.()||null:null}return fn.apply(this,arguments)};try{if(name==='refreshMarketIndicators')refreshMarketIndicators=globalThis[name]}catch{}}
  const marketArrow=globalThis.refreshAurumDataMarketStrip;globalThis.refreshAurumDataMarketStrip=async function(ev){const btn=ev?.currentTarget||document.querySelector('.aurum-r209-market-refresh');if(btn?.dataset.busy==='1')return false;try{if(btn){btn.dataset.busy='1';btn.disabled=true}await globalThis.AurumMarketModuleRefresh();try{const host=document.getElementById('aurumDataMarketStrip');if(host&&typeof globalThis.marketIndicatorsMarkup==='function')host.outerHTML=globalThis.marketIndicatorsMarkup()}catch{}globalThis.showAurumNotice?.('Piyasa modülü yenilendi','success',1500);return true}catch(e){globalThis.showAurumNotice?.('Piyasa modülü yenilenemedi: '+(e?.message||e),'error',2600);return false}finally{const b=document.querySelector('.aurum-r209-market-refresh');if(b){delete b.dataset.busy;b.disabled=false}}};
 }catch(e){audit('CENTRAL_TRIGGER_INSTALL_FAILED','Tek merkez tetik zinciri kurulamadı',{error:e?.message||String(e)})}
 globalThis.AurumCentralTrigger=Object.freeze({version:'R226.3',policy:'VERILER_SCHEDULER_OR_EXPLICIT_DATA_COMMAND_ONLY',authorized:centralAllowed});
 globalThis.AurumFinalHardening=Object.freeze({version:'R226.3-SINGLE-CENTRAL-TRIGGER',health,activeFill,sessionOpen});
 audit('R226_ACTIVE','Nihai süreklilik ve arayüz sertleştirmesi etkin');
})();