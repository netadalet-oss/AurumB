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
   if(typeof globalThis.AurumNLPortal?.refresh==='function'){} // NL portal is its own module; do not cross-trigger.
   return Promise.allSettled(jobs);
 }
 async function market(manual=false){
   const a=globalThis.AurumRebuiltMarket?.refresh?globalThis.AurumRebuiltMarket.refresh({manual,scheduled:!manual}):Promise.resolve(null);
   const [indicators,financePortal]=await Promise.all([a,portal()]);
   try{globalThis.renderCurrentPagePreservingView?.();globalThis.renderCurrent?.()}catch{}
   return {indicators,financePortal};
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