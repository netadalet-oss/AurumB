'use strict';
/* Strict module-local trigger contract. Only explicit manual commands or native scheduled pipeline may start external work. */
(()=>{
 const q=new URLSearchParams(location.search), background=q.get('background')==='1', pipeline=q.get('pipeline')||'data';
 const call=(cmd,params={})=>{const u='aurum://native?cmd='+encodeURIComponent(cmd)+Object.entries(params).map(([k,v])=>'&'+encodeURIComponent(k)+'='+encodeURIComponent(v)).join('');try{return globalThis.AurumNativeBridge?.call?.(u,'')??prompt(u,'')}catch{return ''}};
 const parseTimes=id=>String(document.getElementById(id)?.value||'').split(',').map(x=>x.trim()).filter(Boolean);
 async function portal(){
   const jobs=[];
   if(typeof globalThis.refreshAurumFinancePortal==='function')jobs.push(globalThis.refreshAurumFinancePortal(true));
   if(typeof globalThis.refreshAurumFundMarketIntel==='function')jobs.push(globalThis.refreshAurumFundMarketIntel(true));
   if(typeof globalThis.AurumNLPortal?.refresh==='function')jobs.push(globalThis.AurumNLPortal.refresh(true)); // explicit market pipeline refresh
   return Promise.allSettled(jobs);
 }
 async function market(manual=false){
   if(globalThis.__aurumMarketRefreshActive)return {coalesced:true};
   let lockId=null;
   if(manual&&!background){
     lockId='MANUAL_MARKET|'+Date.now().toString(36)+'|'+Math.random().toString(36).slice(2,9);
     const ans=call('job_lock_acquire',{jobId:lockId,kind:'market',source:'MANUAL'});
     if(ans!=='ACQUIRED')throw new Error('Başka bir veri/piyasa işi sürüyor; ikinci paralel iş başlatılmadı');
   }
   globalThis.__aurumMarketRefreshActive=true;
   try{
     const a=globalThis.AurumRebuiltMarket?.refresh?globalThis.AurumRebuiltMarket.refresh({manual,scheduled:!manual}):Promise.resolve(null);
     const [indicators,financePortal]=await Promise.allSettled([a,portal()]);
     try{globalThis.renderCurrentPagePreservingView?.();globalThis.renderCurrent?.()}catch{}
     const result={indicators:indicators.status==='fulfilled'?indicators.value:null,financePortal:financePortal.status==='fulfilled'?financePortal.value:null,errors:[]};
     if(indicators.status==='rejected')result.errors.push('MARKET:'+String(indicators.reason?.message||indicators.reason));
     if(financePortal.status==='rejected')result.errors.push('PORTAL:'+String(financePortal.reason?.message||financePortal.reason));
     if(result.errors.length===2)throw new Error(result.errors.join(' | '));
     return result;
   }finally{globalThis.__aurumMarketRefreshActive=false;if(lockId)try{call('job_lock_release',{jobId:lockId})}catch{}}
 }
 globalThis.AurumStrictMarketRuntime=Object.freeze({manual:()=>market(true),scheduled:()=>market(false)});
 globalThis.AurumMarketRuntime=Object.freeze({manualRefresh:()=>market(true),scheduledRefresh:()=>market(false)});
 globalThis.AurumFundRefreshMarketModule=({manual=false}={})=>market(!!manual);
 globalThis.AurumScheduleSettings={
   saveData:()=>call('schedule',{kind:'data',enabled:document.getElementById('aurumDataScheduleEnabled')?.checked?'1':'0',times:parseTimes('aurumDataScheduleTimes').join(',')}),
   saveMarket:()=>call('schedule',{kind:'market',enabled:document.getElementById('aurumMarketScheduleEnabled')?.checked?'1':'0',times:parseTimes('aurumMarketScheduleTimes').join(',')})
 };
 if(background&&pipeline==='market'){
   addEventListener('DOMContentLoaded',async()=>{let ok=true,detail='MARKET_PIPELINE_COMPLETED';try{await market(false)}catch(e){ok=false;detail='MARKET_PIPELINE_FAILED:'+String(e?.message||e)}location.href='aurum://complete?ok='+(ok?'1':'0')+'&status='+(ok?'COMPLETED':'FAILED')+'&detail='+encodeURIComponent(detail)}, {once:true});
 }
})();