'use strict';
/* REV20.42 — resilient independent market indicators.
   No network request on app start. First manual refresh arms the 30-minute timer.
   Each base field is resolved independently; one provider failure never blanks other fields.
   Maximum five provider attempts per base field. */
(()=>{
  if(globalThis.__AURUM_REV2042_MARKET_REVISION)return;
  globalThis.__AURUM_REV2042_MARKET_REVISION=true;

  const KEY='marketIndicatorsREV2042', OZ=31.1034768, PERIOD=30*60*1000;
  const KEYS=['XU100','USDTRY','EURTRY','EURUSD','GRAMTRY','GOLDUSD'];
  const LABELS={XU100:'BIST 100',USDTRY:'USD/TRY',EURTRY:'EUR/TRY',EURUSD:'EUR/USD',GRAMTRY:'Gram Altın',GOLDUSD:'Altın Ons'};
  const priorCached=globalThis.cachedMarketIndicators;
  let timer=null,running=null;

  const num=v=>{if(typeof v==='number')return Number.isFinite(v)?v:null;let s=String(v??'').trim().replace(/\s/g,'');if(!s)return null;
    if(s.includes(',')&&s.includes('.'))s=s.lastIndexOf(',')>s.lastIndexOf('.')?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');
    else if(s.includes(','))s=s.replace(',','.'); const n=Number(s);return Number.isFinite(n)?n:null};
  const pct=(v,p)=>Number.isFinite(v)&&Number.isFinite(p)&&p!==0?(v/p-1)*100:null;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const now=()=>new Date().toISOString();

  async function http(url,label,timeout=12000){
    const opts={headers:{Accept:'*/*'},cache:'no-store',__provider:label,__timeout:timeout};
    const r=await fetchWithTimeout(url,opts,timeout);
    if(!r?.ok)throw new Error(label+' HTTP '+(r?.status||0));
    return r;
  }
  async function json(url,label){return responseJSON(await http(url,label))}
  async function text(url,label){return (await http(url,label)).text()}

  async function altCurrency(code){
    const rows=await json('https://static.altinkaynak.com/public/Currency','ALTINKAYNAK_CURRENCY');
    const x=Array.isArray(rows)?rows.find(r=>String(r?.Kod).toUpperCase()===code):null;
    const buy=num(x?.Alis),sell=num(x?.Satis),value=buy!=null&&sell!=null?(buy+sell)/2:(sell??buy);
    if(value==null)throw new Error('Altinkaynak '+code+' yok');
    return {value,source:'ALTINKAYNAK',providerAt:x?.GuncellenmeZamani||null};
  }
  async function altGold(code){
    const rows=await json('https://static.altinkaynak.com/public/Gold','ALTINKAYNAK_GOLD');
    const x=Array.isArray(rows)?rows.find(r=>String(r?.Kod).toUpperCase()===code):null;
    const buy=num(x?.Alis),sell=num(x?.Satis),value=buy!=null&&sell!=null?(buy+sell)/2:(sell??buy);
    if(value==null)throw new Error('Altinkaynak '+code+' yok');
    return {value,source:'ALTINKAYNAK',providerAt:x?.GuncellenmeZamani||null};
  }
  async function yahooChart(symbol,key,host='query1.finance.yahoo.com'){
    const z=await json('https://'+host+'/v8/finance/chart/'+encodeURIComponent(symbol)+'?range=5d&interval=1d&includePrePost=false&events=history','YAHOO_CHART');
    const r=z?.chart?.result?.[0]; if(!r)throw new Error('Yahoo '+symbol+' yok');
    const meta=r.meta||{},cl=(r.indicators?.quote?.[0]?.close||[]).map(num).filter(v=>v!=null);
    const value=num(meta.regularMarketPrice)??cl.at(-1),previousClose=num(meta.chartPreviousClose??meta.previousClose)??(cl.length>1?cl.at(-2):null);
    if(value==null)throw new Error('Yahoo '+symbol+' fiyat yok');
    return {value,previousClose,changePct:pct(value,previousClose),source:host.startsWith('query1')?'YAHOO_Q1':'YAHOO_Q2',providerAt:meta.regularMarketTime?new Date(Number(meta.regularMarketTime)*1000).toISOString():null,key};
  }
  async function tcmb(code){
    const xml=await text('https://www.tcmb.gov.tr/kurlar/today.xml','TCMB');
    const block=xml.match(new RegExp('<Currency[^>]*(?:CurrencyCode|Kod)="'+code+'"[\\s\\S]*?<\\/Currency>','i'))?.[0]||'';
    const pick=tag=>num(block.match(new RegExp('<'+tag+'>([^<]+)<\\/'+tag+'>','i'))?.[1]);
    const value=pick('ForexSelling')??pick('BanknoteSelling')??pick('ForexBuying');
    if(value==null)throw new Error('TCMB '+code+' yok');
    return {value,source:'TCMB',providerAt:null};
  }
  async function bigpara(){
    const h=await text('https://bigpara.hurriyet.com.tr/Partial/GetPiyasaBandContent/?rev=2042','BIGPARA');
    const clean=h.replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/\s+/g,' ');
    function around(re){const m=clean.match(re);return m?{value:num(m[1]),changePct:num(m[2])}:null}
    return {
      XU100:around(/BIST\s*100[^0-9-]*([0-9.,]+)[^%+\-]*([+\-]?[0-9.,]+)\s*%?/i),
      USDTRY:around(/(?:DOLAR|USD)[^0-9-]*([0-9.,]+)[^%+\-]*([+\-]?[0-9.,]+)\s*%?/i),
      EURTRY:around(/(?:EURO|EUR)[^0-9-]*([0-9.,]+)[^%+\-]*([+\-]?[0-9.,]+)\s*%?/i),
      GRAMTRY:around(/(?:ALTIN|GRAM)[^0-9-]*([0-9.,]+)[^%+\-]*([+\-]?[0-9.,]+)\s*%?/i)
    };
  }

  async function first(key,attempts,errors){
    for(let i=0;i<Math.min(5,attempts.length);i++){
      try{const x=await attempts[i]();if(x&&num(x.value)!=null)return {...x,value:num(x.value),previousClose:num(x.previousClose),changePct:num(x.changePct),attempt:i+1,stale:false,at:now()}}
      catch(e){errors.push(key+'#'+(i+1)+': '+String(e?.message||e))}
    }
    return null;
  }
  async function resolveBase(key,errors){
    if(key==='XU100')return first(key,[
      ()=>yahooChart('XU100.IS',key,'query1.finance.yahoo.com'),
      ()=>yahooChart('XU100.IS',key,'query2.finance.yahoo.com'),
      async()=>{const x=(await bigpara()).XU100;if(!x)throw Error('Bigpara XU100 yok');return {...x,source:'BIGPARA'}},
      ()=>yahooChart('^XU100',key,'query1.finance.yahoo.com'),
      ()=>yahooChart('^XU100',key,'query2.finance.yahoo.com')
    ],errors);
    if(key==='USDTRY')return first(key,[
      ()=>yahooChart('TRY=X',key,'query1.finance.yahoo.com'),()=>yahooChart('TRY=X',key,'query2.finance.yahoo.com'),
      async()=>{const x=(await bigpara()).USDTRY;if(!x)throw Error('Bigpara USD yok');return {...x,source:'BIGPARA'}},()=>altCurrency('USD'),()=>tcmb('USD')
    ],errors);
    if(key==='EURTRY')return first(key,[
      ()=>yahooChart('EURTRY=X',key,'query1.finance.yahoo.com'),()=>yahooChart('EURTRY=X',key,'query2.finance.yahoo.com'),
      async()=>{const x=(await bigpara()).EURTRY;if(!x)throw Error('Bigpara EUR yok');return {...x,source:'BIGPARA'}},()=>altCurrency('EUR'),()=>tcmb('EUR')
    ],errors);
    if(key==='GRAMTRY')return first(key,[
      async()=>{const g=await yahooChart('GC=F',key,'query1.finance.yahoo.com'),u=await yahooChart('TRY=X',key,'query1.finance.yahoo.com');return {value:g.value*u.value/OZ,previousClose:g.previousClose&&u.previousClose?g.previousClose*u.previousClose/OZ:null,changePct:(g.changePct!=null&&u.changePct!=null)?((1+g.changePct/100)*(1+u.changePct/100)-1)*100:null,source:'YAHOO_DERIVED',providerAt:g.providerAt||u.providerAt}},
      async()=>{const g=await yahooChart('GC=F',key,'query2.finance.yahoo.com'),u=await yahooChart('TRY=X',key,'query2.finance.yahoo.com');return {value:g.value*u.value/OZ,previousClose:g.previousClose&&u.previousClose?g.previousClose*u.previousClose/OZ:null,changePct:(g.changePct!=null&&u.changePct!=null)?((1+g.changePct/100)*(1+u.changePct/100)-1)*100:null,source:'YAHOO_DERIVED',providerAt:g.providerAt||u.providerAt}},
      async()=>{const x=(await bigpara()).GRAMTRY;if(!x)throw Error('Bigpara gram yok');return {...x,source:'BIGPARA'}},()=>altGold('GA'),()=>altGold('CH_T')
    ],errors);
  }

  function oldFields(){try{return (cached()||{}).fields||{}}catch{return {}}}
  async function refresh(opts={}){
    if(running)return running;
    const force=opts.force===true,auto=opts.auto===true;
    if(!force&&!auto)return cached();
    running=(async()=>{
      const errors=[],old=oldFields(),fields={};
      const settled=await Promise.allSettled(['XU100','USDTRY','EURTRY','GRAMTRY'].map(async k=>[k,await resolveBase(k,errors)]));
      for(const s of settled)if(s.status==='fulfilled'){const [k,x]=s.value;if(x)fields[k]=x}
      for(const k of ['XU100','USDTRY','EURTRY','GRAMTRY']){
        const f=fields[k];if(f&&f.changePct==null&&f.previousClose!=null)f.changePct=pct(f.value,f.previousClose);
        if(!f&&old[k])fields[k]={...old[k],stale:true};
      }
      const usd=num(fields.USDTRY?.value),eur=num(fields.EURTRY?.value),gram=num(fields.GRAMTRY?.value);
      const up=num(fields.USDTRY?.previousClose),ep=num(fields.EURTRY?.previousClose),gp=num(fields.GRAMTRY?.previousClose);
      if(eur!=null&&usd!=null&&usd!==0){const value=eur/usd,previousClose=ep!=null&&up!=null&&up!==0?ep/up:null;fields.EURUSD={value,previousClose,changePct:pct(value,previousClose),source:'DERIVED_EURTRY_USDTRY',at:now(),stale:!!(fields.EURTRY?.stale||fields.USDTRY?.stale)}}
      else if(old.EURUSD)fields.EURUSD={...old.EURUSD,stale:true};
      if(gram!=null&&usd!=null&&usd!==0){const value=gram*OZ/usd,previousClose=gp!=null&&up!=null&&up!==0?gp*OZ/up:null;fields.GOLDUSD={value,previousClose,changePct:pct(value,previousClose),source:'DERIVED_GRAMTRY_USDTRY',at:now(),stale:!!(fields.GRAMTRY?.stale||fields.USDTRY?.stale)}}
      else {
        const direct=await first('GOLDUSD',[()=>altGold('XAUUSD'),()=>yahooChart('GC=F','GOLDUSD','query1.finance.yahoo.com'),()=>yahooChart('GC=F','GOLDUSD','query2.finance.yahoo.com')],errors);
        if(direct)fields.GOLDUSD=direct;else if(old.GOLDUSD)fields.GOLDUSD={...old.GOLDUSD,stale:true};
      }
      for(const k of KEYS){const x=fields[k];if(x&&x.changePct==null)x.changePct=null;} const payload={at:now(),updatedAt:now(),source:'REV20.51_CONSISTENT_MARKET',fields,errors:errors.slice(-20),policy:'SAME_PROVIDER_VALUE_PREVCLOSE_PERCENT_FIRST'};
      state.marketIndicators=payload;try{writeLocal(KEY,payload);writeLocal('marketIndicatorsREV2041',payload);writeLocal('marketIndicatorsREV2040',payload)}catch{}
      try{await dbPut('meta',{key:KEY,value:payload,updatedAt:now()})}catch{}
      return payload;
    })();
    try{return await running}finally{running=null}
  }
  function cached(){return state.marketIndicators?.fields?state.marketIndicators:readLocal(KEY,null)||readLocal('marketIndicatorsREV2041',null)||(typeof priorCached==='function'?priorCached():null)||null}
  function fmt(v,k){if(num(v)==null)return '—';const d=k==='XU100'?0:(['USDTRY','EURTRY','EURUSD'].includes(k)?4:2);return Number(v).toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d,useGrouping:true})}
  function markup(){
    const f=(cached()||{}).fields||{};
    return '<div class="aurum-r209-market-wrap" id="aurumDataMarketStrip"><button type="button" class="aurum-r209-market-refresh" title="Piyasa bilgilerini yenile" aria-label="Piyasa bilgilerini yenile" onclick="refreshAurumDataMarketStrip(event)"><span aria-hidden="true">↻</span></button><div class="aurum-r205-market">'+KEYS.map(k=>{const x=f[k]||{},p=x.stale?null:num(x.changePct),ok=p!=null,cls=ok?(p>0?'up':p<0?'down':'flat'):'flat',arrow=ok?(p>0?'↑':p<0?'↓':''):'',pt=ok?((p>0?'+':'')+p.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%'):(x.stale?'eski':'—');return '<div class="aurum-r205-market-card" title="'+esc([x.source,x.providerAt,x.attempt?'Deneme '+x.attempt:''].filter(Boolean).join(' · '))+'"><span class="aurum-r205-market-label">'+LABELS[k]+'</span><strong class="aurum-r205-market-value">'+fmt(x.value,k)+'</strong><span class="aurum-r205-market-pct '+cls+'">'+(arrow?'<i class="aurum-market-dir" aria-hidden="true">'+arrow+'</i>':'')+pt+'</span></div>'}).join('')+'</div></div>';
  }
  function arm(){if(timer)return;timer=setInterval(()=>{void refresh({auto:true}).then(()=>rerender())},PERIOD)}
  function rerender(){const h=document.getElementById('aurumDataMarketStrip');if(h)h.outerHTML=markup();if(state?.page==='market')try{renderCurrentPagePreservingView()}catch{}}

  globalThis.cachedMarketIndicators=cached;globalThis.refreshMarketIndicators=refresh;globalThis.marketIndicatorsMarkup=markup;
  try{refreshMarketIndicators=refresh;marketIndicatorsMarkup=markup}catch{}
  globalThis.refreshAurumDataMarketStrip=async function(ev){const btn=ev?.currentTarget||document.querySelector('.aurum-r209-market-refresh');if(btn?.dataset.busy==='1')return false;try{if(btn){btn.dataset.busy='1';btn.disabled=true}await refresh({force:true});rerender();return true}catch(e){globalThis.showAurumNotice?.('Piyasa bilgileri alınamadı: '+(e?.message||e),'error',2400);return false}finally{const b=document.querySelector('.aurum-r209-market-refresh');if(b){delete b.dataset.busy;b.disabled=false}}};
  document.addEventListener('click',ev=>{const el=ev.target?.closest?.('button,[role="button"]');const t=(el?.textContent||'').trim().toLocaleLowerCase('tr-TR');if(t.includes('piyasayı yenile')||t.includes('piyasayi yenile')){void refresh({force:true}).then(()=>rerender())}},true);
  // One owner for the 30-minute cadence. Manual refresh does not create another timer.
  arm();
  try{AurumUpdateAPI.state.r242={version:'REV20.42-RESILIENT-MARKET',activatedAt:now(),features:['NO_STARTUP_NETWORK','SINGLE_30M_OWNER','MANUAL_REFRESH','INDEPENDENT_FIELDS','MAX_5_ATTEMPTS','ALTINKAYNAK','YAHOO_Q1_Q2','TCMB','BIGPARA','DERIVED_EURUSD','DERIVED_GOLDUSD']}}catch{}
})();