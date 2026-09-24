'use strict';
/* REV20.41 — market indicator revision
   Scope: only the six compact market indicators used on Veriler and Piyasa Özeti.
   Primary acquisition remains the existing multi-provider chain (Altinkaynak, Yahoo Q1/Q2,
   Bigpara and its fallbacks). This layer adds previous-close fallback math, deterministic
   EUR/USD + ounce derivation, startup refresh and preserves the existing 30-minute cadence. */
(()=>{
  if(globalThis.__AURUM_REV2041_MARKET_REVISION)return;
  globalThis.__AURUM_REV2041_MARKET_REVISION=true;

  const KEY='marketIndicatorsREV2041';
  const KEYS=['XU100','USDTRY','EURTRY','EURUSD','GRAMTRY','GOLDUSD'];
  const LABELS={XU100:'BIST 100',USDTRY:'USD/TRY',EURTRY:'EUR/TRY',EURUSD:'EUR/USD',GRAMTRY:'Gram Altın',GOLDUSD:'Altın Ons'};
  const YSYM={XU100:'XU100.IS',USDTRY:'TRY=X',EURTRY:'EURTRY=X',GOLDUSD:'GC=F'};
  const OZ=31.1034768;
  const priorRefresh=globalThis.refreshMarketIndicators;
  const priorCached=globalThis.cachedMarketIndicators;
  let armed=false, manualPending=false, autoTimer=null;
  const finite=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pct=(v,p)=>Number.isFinite(v)&&Number.isFinite(p)&&p!==0?(v/p-1)*100:null;

  async function yahooQuote(){
    const out={};
    for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
      try{
        const url='https://'+host+'/v7/finance/quote?symbols='+encodeURIComponent(Object.values(YSYM).join(','));
        const r=await fetchWithTimeout(url,{headers:{Accept:'application/json'},cache:'no-store',__provider:'YAHOO_QUOTE'},'Piyasa gösterge quote');
        if(!r.ok)continue;
        const rows=(await responseJSON(r))?.quoteResponse?.result||[];
        for(const [key,sym] of Object.entries(YSYM)){
          const q=rows.find(x=>x?.symbol===sym); if(!q)continue;
          const value=finite(q.regularMarketPrice),previousClose=finite(q.regularMarketPreviousClose),changePct=finite(q.regularMarketChangePercent);
          if(value==null)continue;
          out[key]={value,previousClose,changePct,source:host.startsWith('query1')?'YAHOO_Q1':'YAHOO_Q2',
            providerAt:q.regularMarketTime?new Date(Number(q.regularMarketTime)*1000).toISOString():null,url};
        }
        if(Object.keys(out).length>=3)break;
      }catch{}
    }
    return out;
  }

  async function yahooPreviousClose(symbol){
    for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
      try{
        const url='https://'+host+'/v8/finance/chart/'+encodeURIComponent(symbol)+'?range=5d&interval=1d&events=history';
        const r=await fetchWithTimeout(url,{headers:{Accept:'application/json'},cache:'no-store',__provider:'YAHOO'},'Önceki kapanış');
        if(!r.ok)continue;
        const z=(await responseJSON(r))?.chart?.result?.[0],cl=z?.indicators?.quote?.[0]?.close||[];
        const vals=cl.map(finite).filter(v=>v!=null);
        if(vals.length>=2)return vals[vals.length-2];
        const pc=finite(z?.meta?.chartPreviousClose??z?.meta?.previousClose);
        if(pc!=null)return pc;
      }catch{}
    }
    return null;
  }

  async function refresh(opts={}){
    const force=opts?.force===true;
    const auto=opts?.auto===true;
    if(!force&&!auto&&!manualPending)return cached();
    manualPending=false;
    const errors=[];
    let base=null;
    try{if(typeof priorRefresh==='function')base=await priorRefresh()}catch(e){errors.push('çoklu kaynak: '+String(e?.message||e))}
    const fields={};
    for(const [k,x] of Object.entries(base?.fields||{})){
      if(x&&finite(x.value)!=null&&!x.stale)fields[k]={...x,value:finite(x.value),changePct:finite(x.changePct),previousClose:finite(x.previousClose)};
    }

    let yq={};
    try{yq=await yahooQuote()}catch(e){errors.push('Yahoo quote: '+String(e?.message||e))}
    for(const k of ['XU100','USDTRY','EURTRY']){
      const y=yq[k],f=fields[k];
      if(!f&&y)fields[k]={...y,at:y.providerAt||new Date().toISOString(),stale:false};
      else if(f&&finite(f.changePct)==null&&y){
        if(finite(y.changePct)!=null)f.changePct=finite(y.changePct);
        if(finite(f.previousClose)==null)f.previousClose=finite(y.previousClose);
      }
    }

    const needPrev=['XU100','USDTRY','EURTRY','GOLDUSD'];
    const prev={};
    await Promise.all(needPrev.map(async k=>{
      prev[k]=finite(fields[k]?.previousClose??yq[k]?.previousClose);
      if(prev[k]==null)prev[k]=await yahooPreviousClose(YSYM[k]);
    }));

    for(const k of ['XU100','USDTRY','EURTRY']){
      const f=fields[k]; if(!f)continue;
      if(finite(f.previousClose)==null&&prev[k]!=null)f.previousClose=prev[k];
      if(finite(f.changePct)==null)f.changePct=pct(finite(f.value),finite(f.previousClose));
      f.percentOrigin=finite(f.changePct)!=null?(f.percentOrigin||'PREVIOUS_CLOSE_FALLBACK'):'UNAVAILABLE';
    }

    const usd=finite(fields.USDTRY?.value),eur=finite(fields.EURTRY?.value);
    const usdPrev=finite(fields.USDTRY?.previousClose??prev.USDTRY),eurPrev=finite(fields.EURTRY?.previousClose??prev.EURTRY);

    // Gram altın: doğrudan çoklu kaynaktan; yoksa mevcut ons + USD/TRY bileşenlerinden türet.
    if(!fields.GRAMTRY){
      const gold=finite(yq.GOLDUSD?.value);
      if(gold!=null&&usd!=null)fields.GRAMTRY={value:gold*usd/OZ,changePct:null,source:'DERIVED_GOLDUSD_USDTRY',providerAt:yq.GOLDUSD?.providerAt||fields.USDTRY?.providerAt||null,at:new Date().toISOString(),direct:false,stale:false};
    }
    const gram=finite(fields.GRAMTRY?.value);
    const goldPrev=finite(yq.GOLDUSD?.previousClose??prev.GOLDUSD);
    const gramPrev=goldPrev!=null&&usdPrev!=null?goldPrev*usdPrev/OZ:null;
    if(fields.GRAMTRY){
      if(finite(fields.GRAMTRY.previousClose)==null&&gramPrev!=null)fields.GRAMTRY.previousClose=gramPrev;
      if(finite(fields.GRAMTRY.changePct)==null)fields.GRAMTRY.changePct=pct(gram,finite(fields.GRAMTRY.previousClose));
      fields.GRAMTRY.percentOrigin=finite(fields.GRAMTRY.changePct)!=null?(fields.GRAMTRY.percentOrigin||'PREVIOUS_CLOSE_FALLBACK'):'UNAVAILABLE';
    }

    // EUR/USD ve ons istenildiği gibi elde edilen temel verilerden türetilir.
    if(eur!=null&&usd!=null&&usd!==0){
      const value=eur/usd,previousClose=eurPrev!=null&&usdPrev!=null&&usdPrev!==0?eurPrev/usdPrev:null;
      fields.EURUSD={value,previousClose,changePct:pct(value,previousClose),source:'DERIVED_EURTRY_USDTRY',providerAt:[fields.EURTRY?.providerAt,fields.USDTRY?.providerAt].filter(Boolean).sort()[0]||null,at:new Date().toISOString(),direct:false,stale:false,percentOrigin:'DERIVED_FROM_PREVIOUS_CLOSE'};
    }
    if(gram!=null&&usd!=null&&usd!==0){
      const value=gram*OZ/usd,previousClose=gramPrev!=null&&usdPrev!=null&&usdPrev!==0?gramPrev*OZ/usdPrev:null;
      fields.GOLDUSD={value,previousClose,changePct:pct(value,previousClose),source:'DERIVED_GRAMTRY_USDTRY',providerAt:[fields.GRAMTRY?.providerAt,fields.USDTRY?.providerAt].filter(Boolean).sort()[0]||null,at:new Date().toISOString(),direct:false,stale:false,percentOrigin:'DERIVED_FROM_PREVIOUS_CLOSE'};
    }

    const old=(cached()||{}).fields||{};
    for(const k of KEYS)if(!fields[k]&&old[k])fields[k]={...old[k],stale:true};

    const payload={at:new Date().toISOString(),updatedAt:new Date().toISOString(),source:'REV20.41_COMPLETE_MARKET',
      fields,values:Object.fromEntries(KEYS.map(k=>[k,finite(fields[k]?.value)])),errors:errors.slice(0,8),
      policy:'DIRECT_BASE_VALUES_MULTI_SOURCE; PUBLISHED_PERCENT_ELSE_PREVIOUS_CLOSE; EURUSD_AND_GOLDUSD_DERIVED'};
    state.marketIndicators=payload;
    try{writeLocal(KEY,payload);writeLocal('marketIndicatorsREV2040',payload)}catch{}
    try{await dbPut('meta',{key:KEY,value:payload,updatedAt:new Date().toISOString()})}catch{}
    return payload;
  }

  function cached(){return state.marketIndicators?.source==='REV20.41_COMPLETE_MARKET'?state.marketIndicators:readLocal(KEY,null)||(typeof priorCached==='function'?priorCached():null)||null}
  function armAutoRefresh(){
    if(armed)return;
    armed=true;
    if(autoTimer==null)autoTimer=setInterval(()=>{void refresh({auto:true})},30*60*1000);
  }
  function fmt(v,k){if(!Number.isFinite(Number(v)))return '—';const d=k==='XU100'?0:(k==='USDTRY'||k==='EURTRY'||k==='EURUSD'?4:2);return Number(v).toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d,useGrouping:true})}
  function markup(){
    const f=(cached()||{}).fields||{};
    return '<div class="aurum-r209-market-wrap" id="aurumDataMarketStrip"><button type="button" class="aurum-r209-market-refresh" title="Piyasa bilgilerini yenile" aria-label="Piyasa bilgilerini yenile" onclick="refreshAurumDataMarketStrip(event)"><span aria-hidden="true">↻</span></button><div class="aurum-r205-market">'+KEYS.map(k=>{
      const x=f[k]||{},p=x.stale?null:finite(x.changePct),ok=p!=null,cls=ok?(p>0?'up':p<0?'down':'flat'):'flat',arrow=ok?(p>0?'↑':p<0?'↓':''):'',pt=ok?((p>0?'+':'')+p.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%'):(x.stale?'eski':'—');
      const title=[x.source,x.providerAt?'Kaynak zamanı '+x.providerAt:'',x.percentOrigin].filter(Boolean).join(' · ');
      return '<div class="aurum-r205-market-card" title="'+esc(title)+'"><span class="aurum-r205-market-label">'+LABELS[k]+'</span><strong class="aurum-r205-market-value">'+fmt(x.value,k)+'</strong><span class="aurum-r205-market-pct '+cls+'">'+(arrow?'<i class="aurum-market-dir" aria-hidden="true">'+arrow+'</i>':'')+pt+'</span></div>';
    }).join('')+'</div></div>';
  }

  globalThis.cachedMarketIndicators=cached;
  globalThis.refreshMarketIndicators=refresh;
  globalThis.marketIndicatorsMarkup=markup;
  try{refreshMarketIndicators=refresh;marketIndicatorsMarkup=markup}catch{}
  globalThis.refreshAurumDataMarketStrip=async function(ev){
    const btn=ev?.currentTarget||document.querySelector('.aurum-r209-market-refresh');
    if(btn?.dataset.busy==='1')return false;
    try{
      if(btn){btn.dataset.busy='1';btn.disabled=true}
      armAutoRefresh();
      await refresh({force:true});
      const h=document.getElementById('aurumDataMarketStrip');if(h)h.outerHTML=markup();
      return true;
    }catch(e){globalThis.showAurumNotice?.('Piyasa bilgileri alınamadı: '+(e?.message||e),'error',2400);return false}
    finally{const b=document.querySelector('.aurum-r209-market-refresh');if(b){delete b.dataset.busy;b.disabled=false}}
  };

  // Uygulama açılışında ağ isteği yapılmaz. Kullanıcı ilk yenilemeyi yaptığında
  // otomatik 30 dakikalık döngü o andan itibaren başlar. Eski REV20.32 zamanlayıcısından
  // gelen çağrılar, kullanıcı henüz başlatmadıysa veya bizim auto çağrımız değilse no-op olur.
  document.addEventListener('click',ev=>{
    const el=ev.target?.closest?.('button,[role="button"]');
    const txt=(el?.textContent||'').trim().toLocaleLowerCase('tr-TR');
    if(txt.includes('piyasayı yenile')||txt.includes('piyasayi yenile')){
      manualPending=true;
      armAutoRefresh();
    }
  },true);

  try{AurumUpdateAPI.state.r241={version:'REV20.41-COMPLETE-MARKET-MANUAL-ARM',activatedAt:new Date().toISOString(),features:['NO_STARTUP_REFRESH','MANUAL_ARMED_30M_CADENCE','MANUAL_REFRESH','MULTI_SOURCE_BASE_VALUES','PREVIOUS_CLOSE_PERCENT_FALLBACK','DERIVED_EURUSD','DERIVED_GOLD_OUNCE','MARKET_ONLY_SCOPE']}}catch{}
})();
