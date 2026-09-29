'use strict';
/* Resilient market indicators: explicit manual/scheduled refresh only, field-level fallback,
   source time separated from receive time, and last-valid preservation per indicator. */
(()=>{
  const KEY='aurum.market.rebuilt.v1';
  const URL='https://www.borsamatik.com.tr/piyasa-masasi';
  const GRAM_URL='https://www.borsamatik.com.tr/piyasa-masasi/altin/SGLD-serbest-piyasa-altin-gr';
  const ORDER=['XU100','USDTRY','EURTRY','EURUSD','GRAMTRY','GOLDUSD'];
  const LABEL={XU100:'BIST 100',USDTRY:'USD/TRY',EURTRY:'EUR/TRY',EURUSD:'EUR/USD',GRAMTRY:'Gram Altın',GOLDUSD:'Altın Ons'};
  const YAHOO={XU100:'XU100.IS',USDTRY:'TRY=X',EURTRY:'EURTRY=X',EURUSD:'EURUSD=X',GOLDUSD:'GC=F'};
  let busy=null;
  const now=()=>new Date().toISOString();
  const n=s=>{s=String(s??'').trim().replace(/\s/g,'');if(!s)return null;if(s.includes(',')&&s.includes('.'))s=s.lastIndexOf(',')>s.lastIndexOf('.')?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');else s=s.replace(',','.');const v=Number(s);return Number.isFinite(v)?v:null};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch{return null}};
  const save=x=>{try{localStorage.setItem(KEY,JSON.stringify(x))}catch{};return x};
  const stamp=(value,changePct,source,sourceTimestamp=null,receivedAt=now(),extra={})=>({value,changePct,source,sourceTimestamp,receivedAt,valid:Number.isFinite(value),...extra});
  function parsePrimary(html){
    const txt=new DOMParser().parseFromString(html,'text/html').body?.innerText?.replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ')||'';
    const specs={
      XU100:/BIST\s*100\s*[|:]?\s*([0-9.]+,[0-9]+)[\s\S]{0,35}?([+\-]?\s*[0-9]+,[0-9]+)\s*%/i,
      USDTRY:/(?:^|\n)\s*Dolar\s*[|:]?\s*([0-9.]+,[0-9]+)[\s\S]{0,35}?([+\-]?\s*[0-9]+,[0-9]+)\s*%/im,
      EURTRY:/(?:^|\n)\s*Euro\s*[|:]?\s*([0-9.]+,[0-9]+)[\s\S]{0,35}?([+\-]?\s*[0-9]+,[0-9]+)\s*%/im,
      GRAMTRY:/Altın\s*\(gr\)\s*[|:]?\s*([0-9.]+,[0-9]+)[\s\S]{0,35}?([+\-]?\s*[0-9]+,[0-9]+)\s*%/i,
      GOLDUSD:/Altın\s*\(ons\)\s*[|:]?\s*([0-9.]+,[0-9]+)[\s\S]{0,35}?([+\-]?\s*[0-9]+,[0-9]+)\s*%/i,
      EURUSD:/Euro\/Dolar\s*[|:]?\s*([0-9.]+,[0-9]+)[\s\S]{0,35}?([+\-]?\s*[0-9]+,[0-9]+)\s*%/i
    };
    const fields={};for(const [k,re] of Object.entries(specs)){const m=txt.match(re),value=n(m?.[1]),changePct=n(m?.[2]?.replace(/\s/g,''));if(value!=null)fields[k]=stamp(value,changePct,'BORSAMATIK');}
    return fields;
  }
  function parseGramDetail(html){
    const txt=new DOMParser().parseFromString(html,'text/html').body?.innerText?.replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ')||'';
    const m=txt.match(/Serbest\s+Piyasa\s+Altın\s*\(gr\)[\s\S]{0,180}?([0-9.]+,[0-9]{2})\s+[+\-]?[0-9.]+,[0-9]+\s*\/\s*([+\-]?[0-9]+,[0-9]+)\s*%/i)
      ||txt.match(/Son\s+İşlem\s+Fiyatı\s*:?\s*([0-9.]+,[0-9]{2})[\s\S]{0,180}?Günlük\s+Değişim\s*\(%\)\s*:?\s*([+\-]?[0-9]+,[0-9]+)/i);
    const value=n(m?.[1]),changePct=n(m?.[2]);return value==null?null:stamp(value,changePct,'BORSAMATIK');
  }
  async function fetchText(url,label){
    const opts={headers:{Accept:'text/html,application/xhtml+xml'},cache:'no-store',credentials:'omit'};
    const r=globalThis.AurumNativeHTTP?.canHandle?.(url)?await globalThis.AurumNativeHTTP.request(url,opts,15000):await fetch(url,opts);
    if(!r?.ok)throw new Error(label+' HTTP '+(r?.status||0));return r.text();
  }
  async function yahooField(key,symbol){
    const url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?range=2d&interval=5m&includePrePost=false';
    const r=globalThis.AurumNativeHTTP?.canHandle?.(url)?await globalThis.AurumNativeHTTP.request(url,{headers:{Accept:'application/json'},cache:'no-store'},12000):await fetch(url,{cache:'no-store'});
    if(!r?.ok)throw new Error('Yahoo '+key+' HTTP '+(r?.status||0));
    const j=await r.json(),m=j?.chart?.result?.[0]?.meta||{},value=Number(m.regularMarketPrice),prev=Number(m.chartPreviousClose??m.previousClose),ts=Number(m.regularMarketTime);
    if(!Number.isFinite(value))throw new Error('Yahoo '+key+' fiyat yok');
    const pct=Number.isFinite(prev)&&prev>0?100*(value/prev-1):null;
    return stamp(value,Number.isFinite(pct)?pct:null,'YAHOO',Number.isFinite(ts)?new Date(ts*1000).toISOString():null,now(),{previousClose:Number.isFinite(prev)&&prev>0?prev:null});
  }
  async function request(){
    const primary={};const status=[];
    const [summary,gram]=await Promise.allSettled([fetchText(URL,'Piyasa kaynağı'),fetchText(GRAM_URL,'Gram Altın kaynağı')]);
    if(summary.status==='fulfilled')Object.assign(primary,parsePrimary(summary.value));else status.push({provider:'BORSAMATIK_SUMMARY',ok:false,error:String(summary.reason?.message||summary.reason)});
    if(gram.status==='fulfilled'){const g=parseGramDetail(gram.value);if(g)primary.GRAMTRY=g;}else status.push({provider:'BORSAMATIK_GRAM',ok:false,error:String(gram.reason?.message||gram.reason)});
    const fallback={};const need=Object.entries(YAHOO).filter(([k])=>!primary[k]);
    const yr=await Promise.allSettled(need.map(([k,s])=>yahooField(k,s)));
    yr.forEach((r,i)=>{const k=need[i][0];if(r.status==='fulfilled'){fallback[k]=r.value;status.push({provider:'YAHOO_'+k,ok:true})}else status.push({provider:'YAHOO_'+k,ok:false,error:String(r.reason?.message||r.reason)})});
    if(!primary.GRAMTRY){
      const usd=primary.USDTRY||fallback.USDTRY,gold=primary.GOLDUSD||fallback.GOLDUSD;
      if(Number.isFinite(usd?.value)&&Number.isFinite(gold?.value)){
        const value=gold.value*usd.value/31.1034768;
        const prevValue=Number.isFinite(gold.previousClose)&&gold.previousClose>0&&Number.isFinite(usd.previousClose)&&usd.previousClose>0?gold.previousClose*usd.previousClose/31.1034768:null;
        const pct=Number.isFinite(prevValue)&&prevValue>0?100*(value/prevValue-1):null;
        const times=[usd.sourceTimestamp,gold.sourceTimestamp].filter(x=>Number.isFinite(Date.parse(x))).map(Date.parse);
        fallback.GRAMTRY=stamp(value,Number.isFinite(pct)?pct:null,'DERIVED_YAHOO_GOLD_USDTRY',times.length?new Date(Math.min(...times)).toISOString():null,now(),{derived:true,previousClose:prevValue});
      }
    }
    return {fields:{...fallback,...primary},status};
  }
  async function refresh({manual=false,scheduled=false}={}){
    if(!manual&&!scheduled)return load();
    if(busy)return busy;
    busy=(async()=>{
      const old=load(),attemptAt=now(),out=await request(),newKeys=Object.keys(out.fields);
      const fields={};for(const k of ORDER){const fresh=out.fields[k];const prior=old?.fields?.[k];fields[k]=fresh|| (prior?{...prior,stale:true}:null);}
      const validCount=ORDER.filter(k=>fields[k]?.valid).length;
      if(!newKeys.length&&!validCount)throw new Error('Hiçbir piyasa göstergesi doğrulanamadı');
      const x=save({updatedAt:newKeys.length?attemptAt:(old?.updatedAt||null),lastAttemptAt:attemptAt,lastAttemptOk:newKeys.length>0,fields,providerStatus:out.status});
      render();return x;
    })();
    try{return await busy}finally{busy=null}
  }
  const fmt=(v,k)=>Number(v).toLocaleString('tr-TR',{minimumFractionDigits:['USDTRY','EURTRY','EURUSD'].includes(k)?4:2,maximumFractionDigits:['USDTRY','EURTRY','EURUSD'].includes(k)?4:2});
  function markup(){const f=load()?.fields||{};return '<div class="aurum-r209-market-wrap" id="aurumDataMarketStrip"><button type="button" class="aurum-r209-market-refresh" title="Piyasa bilgilerini yenile" aria-label="Piyasa bilgilerini yenile" onclick="AurumRebuiltMarket.manual(event)"><span aria-hidden="true">↻</span></button><div class="aurum-r205-market">'+ORDER.map(k=>{const x=f[k],p=n(x?.changePct),ok=x&&p!=null,cls=!ok?'flat':p>0?'up':p<0?'down':'flat',arrow=!ok?'':p>0?'↑':p<0?'↓':'';const t=x?(x.source+' · kaynak zamanı '+(x.sourceTimestamp?new Date(x.sourceTimestamp).toLocaleString('tr-TR'):'doğrulanamadı')+(x.stale?' · son geçerli veri':'')):'Henüz veri alınmadı';return '<div class="aurum-r205-market-card" title="'+esc(t)+'"><span class="aurum-r205-market-label">'+LABEL[k]+'</span><strong class="aurum-r205-market-value">'+(x?fmt(x.value,k):'—')+'</strong><span class="aurum-r205-market-pct '+cls+'">'+(arrow?'<i class="aurum-market-dir" aria-hidden="true">'+arrow+'</i>':'')+(ok?((p>0?'+':'')+p.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%'):'—')+'</span></div>'}).join('')+'</div></div>'}
  function render(){const h=document.getElementById('aurumDataMarketStrip');if(h)h.outerHTML=markup()}
  async function manual(ev){const b=ev?.currentTarget;try{if(b)b.disabled=true;await refresh({manual:true});globalThis.showAurumNotice?.('Piyasa göstergeleri yenilendi.','success',1800);return true}catch(e){globalThis.showAurumNotice?.('Piyasa göstergeleri alınamadı; son geçerli kayıt korundu: '+(e?.message||e),'error',3200);return false}finally{if(b)b.disabled=false}}
  globalThis.AurumRebuiltMarket=Object.freeze({refresh,manual,scheduled:()=>refresh({scheduled:true}),markup,cached:load});
  globalThis.cachedMarketIndicators=load;globalThis.refreshMarketIndicators=o=>refresh({manual:o?.force===true||o?.manual===true,scheduled:o?.auto===true||o?.scheduled===true});globalThis.marketIndicatorsMarkup=markup;globalThis.refreshAurumDataMarketStrip=manual;
})();
