/* R10: deliberate manual AL/SAT card market refresh and durable real alert recheck. */
'use strict';
(()=>{
  if(globalThis.AurumR10)return;
  const quoteMap=new Map();
  const fmt=x=>Number.isFinite(Number(x))?Number(x):null;
  const seen=()=>[...new Set(Object.values(globalThis.AurumQualifiedBuySell?.state?.()?.items||{})
     .filter(x=>x?.status==='BUY'||x?.status==='SELL').map(x=>String(x.sym||x.code||'').trim().toUpperCase()).filter(Boolean))];
  const market=k=>quoteMap.get(String(k||'').toUpperCase())||null;
  let working=false;
  async function manualRefresh(ev){
    try{ev?.preventDefault?.();ev?.stopPropagation?.()}catch{}
    if(working||state.syncing||state.calculating){showAurumNotice('Başka bir veri yenilemesi sürüyor.','info',2500);return false}
    const codes=seen();if(!codes.length){showAurumNotice('AL/SAT listesinde yenilenecek hisse yok.','info',2500);return true}
    working=true;let successes=0,failed=0;
    try{
      const end=new Date().toISOString().slice(0,10),start=new Date(Date.now()-10*86400000).toISOString().slice(0,10);
      for(let i=0;i<codes.length;i+=3){
        await Promise.all(codes.slice(i,i+3).map(async sym=>{
          try{
            const bundle=await fetchSymbolBundle(sym,start,end,{mode:'FORCE_ALL',providers:['YAHOO','YAHOO_QUOTE','ISYATIRIM']});
            const bars=(bundle.bars||[]).filter(x=>x?.date&&x?.close>0).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
            const bar=bars.at(-1),prior=bars.at(-2),now=bundle.live||{};
            const time=now.timestampVerified&&now.at?now.at:(bar?.date?bar.date:null);
            const px=fmt(now.price)||fmt(bar?.close);
            if(!(px>0)||!time)throw new Error('Doğrulanmış fiyat ve kaynak tarihi bulunamadı');
            const vol=fmt(bar?.volume),prevVol=fmt(prior?.volume),open=fmt(bar?.open),hi=fmt(bar?.high),lo=fmt(bar?.low);
            const dayChange=prior?.close>0?100*(px/prior.close-1):null;
            const volumeChange=vol!=null&&prevVol>0?100*(vol/prevVol-1):null;
            const quote={sym,price:px,open,high:hi,low:lo,volumeChange,dayChange,source:bundle.marketPoint?.provider||bundle.provider||bar?.source||'API',at:time};
            quoteMap.set(sym,quote);const rec=state.recordMap.get(sym)||state.records.find(x=>x.sym===sym);
            if(rec){rec.livePrice=px;rec.marketDataAt=time;if(dayChange!=null)rec.dayChange=dayChange;if(volumeChange!=null)rec.volumeChange=volumeChange;}
            successes++;
          }catch(e){failed++;console.warn('AL/SAT API yenileme',sym,e)}
        }));
      }
      try{await globalThis.AurumPortfolio?.reconcile?.()}catch(e){console.warn('Portföy eşleştirme',e)}
      await globalThis.AurumTradeAlerts?.sync?.();await globalThis.AurumTradeAlerts?.flush?.();
      try{renderCurrentPagePreservingView()}catch{}
      showAurumNotice(`AL/SAT API yenileme: ${successes}/${codes.length} hisse · başarısız ${failed}.` ,failed?'info':'success',4800);
      return failed===0;
    }finally{working=false}
  }
  globalThis.refreshAurumTradePanels=manualRefresh;
  globalThis.AurumR10=Object.freeze({market,manualRefresh,codes:seen});
  // Reconcile actual list changes when the app regains focus, even if the
  // trading-state mutation happened in another scheduler/code path.
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){
    Promise.resolve(globalThis.AurumTradeAlerts?.sync?.()).then(()=>globalThis.AurumTradeAlerts?.flush?.()).catch(e=>console.warn('AL/SAT email queue',e));
  }});
  setInterval(()=>{if(document.visibilityState==='visible'){
    Promise.resolve(globalThis.AurumTradeAlerts?.sync?.()).then(()=>globalThis.AurumTradeAlerts?.flush?.()).catch(e=>console.warn('AL/SAT email retry',e));
  }},60000);
})();
