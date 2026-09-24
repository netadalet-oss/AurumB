'use strict';
(()=>{
  if(globalThis.__AURUM_MARKET_PERCENT_PATCH__)return;
  globalThis.__AURUM_MARKET_PERCENT_PATCH__=true;
  const OZ=31.1034768;
  const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
  const pc=(v,p)=>v!=null&&p!=null&&p!==0?(v/p-1)*100:null;
  async function chart(symbol){
    let last;
    for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
      try{
        const url='https://'+host+'/v8/finance/chart/'+encodeURIComponent(symbol)+'?range=5d&interval=1d&includePrePost=false&events=history';
        const r=globalThis.AurumNativeHTTP?.canHandle?.(url)?await globalThis.AurumNativeHTTP.request(url,{headers:{Accept:'application/json'}},12000):await fetch(url,{cache:'no-store'});
        if(!r.ok)throw Error('HTTP '+r.status);
        const z=await r.json(),q=z?.chart?.result?.[0],m=q?.meta||{},cl=(q?.indicators?.quote?.[0]?.close||[]).map(n).filter(x=>x!=null);
        const prev=n(m.chartPreviousClose??m.previousClose)??(cl.length>1?cl.at(-2):null);
        if(prev!=null)return prev;
      }catch(e){last=e}
    }
    throw last||Error('Önceki kapanış bulunamadı');
  }
  async function fill(payload){
    const f=payload?.fields||{};
    const jobs=[];
    const direct={XU100:'XU100.IS',USDTRY:'TRY=X',EURTRY:'EURTRY=X',GOLDUSD:'GC=F'};
    for(const [k,s] of Object.entries(direct)){
      if(f[k]&&n(f[k].value)!=null&&n(f[k].changePct)==null)jobs.push((async()=>{try{const p=await chart(s);f[k].previousClose=p;f[k].changePct=pc(n(f[k].value),p)}catch{}})());
    }
    if(f.GRAMTRY&&n(f.GRAMTRY.value)!=null&&n(f.GRAMTRY.changePct)==null)jobs.push((async()=>{try{const [g,u]=await Promise.all([chart('GC=F'),chart('TRY=X')]);const p=g*u/OZ;f.GRAMTRY.previousClose=p;f.GRAMTRY.changePct=pc(n(f.GRAMTRY.value),p)}catch{}})());
    await Promise.allSettled(jobs);
    if(f.EURUSD&&n(f.EURUSD.value)!=null&&n(f.EURUSD.changePct)==null){
      const ep=n(f.EURTRY?.previousClose),up=n(f.USDTRY?.previousClose);if(ep!=null&&up!=null&&up!==0){const p=ep/up;f.EURUSD.previousClose=p;f.EURUSD.changePct=pc(n(f.EURUSD.value),p)}
    }
    if(f.GOLDUSD&&n(f.GOLDUSD.value)!=null&&n(f.GOLDUSD.changePct)==null){
      const gp=n(f.GRAMTRY?.previousClose),up=n(f.USDTRY?.previousClose);if(gp!=null&&up!=null&&up!==0){const p=gp*OZ/up;f.GOLDUSD.previousClose=p;f.GOLDUSD.changePct=pc(n(f.GOLDUSD.value),p)}
    }
    return payload;
  }
  const base=globalThis.refreshMarketIndicators;
  if(typeof base==='function'){
    globalThis.refreshMarketIndicators=async function(opts){const x=await base(opts);await fill(x);return x};
    try{refreshMarketIndicators=globalThis.refreshMarketIndicators}catch{}
  }
  const style=document.createElement('style');
  style.textContent='.r225-news-url{display:none!important}.r207-news-link{justify-content:flex-end!important}';
  document.head.appendChild(style);
})();