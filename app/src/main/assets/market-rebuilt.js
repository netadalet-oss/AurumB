'use strict';
/* Aurum market module rebuilt from scratch. Network is allowed only by explicit manual command or scheduler. */
(()=>{
  const KEY='aurum.market.rebuilt.v1', URL='https://www.borsamatik.com.tr/piyasa-masasi';
  const ORDER=['XU100','USDTRY','EURTRY','EURUSD','GRAMTRY','GOLDUSD'];
  const LABEL={XU100:'BIST 100',USDTRY:'USD/TRY',EURTRY:'EUR/TRY',EURUSD:'EUR/USD',GRAMTRY:'Gram Altın',GOLDUSD:'Altın Ons'};
  let busy=null;
  const n=s=>{s=String(s??'').trim().replace(/\s/g,'');if(!s)return null;if(s.includes(',')&&s.includes('.'))s=s.lastIndexOf(',')>s.lastIndexOf('.')?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');else s=s.replace(',','.');const v=Number(s);return Number.isFinite(v)?v:null};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch{return null}};
  const save=x=>{try{localStorage.setItem(KEY,JSON.stringify(x))}catch{};return x};
  function parse(html){
    const txt=new DOMParser().parseFromString(html,'text/html').body?.innerText?.replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ')||'';
    const specs={
      XU100:/BIST\s*100\s*[|:]?\s*([0-9.]+,[0-9]+)[\s\S]{0,35}?([+\-]?\s*[0-9]+,[0-9]+)\s*%/i,
      USDTRY:/(?:^|\n)\s*Dolar\s*[|:]?\s*([0-9.]+,[0-9]+)[\s\S]{0,35}?([+\-]?\s*[0-9]+,[0-9]+)\s*%/im,
      EURTRY:/(?:^|\n)\s*Euro\s*[|:]?\s*([0-9.]+,[0-9]+)[\s\S]{0,35}?([+\-]?\s*[0-9]+,[0-9]+)\s*%/im,
      GRAMTRY:/Altın\s*\(gr\)\s*[|:]?\s*([0-9.]+,[0-9]+)[\s\S]{0,35}?([+\-]?\s*[0-9]+,[0-9]+)\s*%/i,
      GOLDUSD:/Altın\s*\(ons\)\s*[|:]?\s*([0-9.]+,[0-9]+)[\s\S]{0,35}?([+\-]?\s*[0-9]+,[0-9]+)\s*%/i,
      EURUSD:/Euro\/Dolar\s*[|:]?\s*([0-9.]+,[0-9]+)[\s\S]{0,35}?([+\-]?\s*[0-9]+,[0-9]+)\s*%/i
    };
    const fields={};for(const [k,re] of Object.entries(specs)){const m=txt.match(re);const value=n(m?.[1]),changePct=n(m?.[2]?.replace(/\s/g,''));if(value!=null&&changePct!=null)fields[k]={value,changePct,source:'BORSAMATIK',providerAt:null};}
    if(ORDER.some(k=>!fields[k]))throw new Error('Piyasa kaynağında altı göstergenin tamamı doğrulanamadı');
    return fields;
  }
  async function request(){
    const opts={headers:{Accept:'text/html,application/xhtml+xml'},cache:'no-store',credentials:'omit'};
    let r;
    if(globalThis.AurumNativeHTTP?.canHandle?.(URL))r=await globalThis.AurumNativeHTTP.request(URL,opts,15000);else r=await fetch(URL,opts);
    if(!r?.ok)throw new Error('Piyasa kaynağı HTTP '+(r?.status||0));return parse(await r.text());
  }
  async function refresh({manual=false,scheduled=false}={}){
    if(!manual&&!scheduled) return load();
    if(busy)return busy;
    busy=(async()=>{const fields=await request(),x=save({updatedAt:new Date().toISOString(),source:'BORSAMATIK',fields});render();return x})();
    try{return await busy}finally{busy=null}
  }
  const fmt=(v,k)=>Number(v).toLocaleString('tr-TR',{minimumFractionDigits:k==='XU100'?0:(['USDTRY','EURTRY','EURUSD'].includes(k)?4:2),maximumFractionDigits:k==='XU100'?0:(['USDTRY','EURTRY','EURUSD'].includes(k)?4:2)});
  function markup(){const f=load()?.fields||{};return '<div class="aurum-r209-market-wrap" id="aurumDataMarketStrip"><button type="button" class="aurum-r209-market-refresh" title="Piyasa bilgilerini yenile" aria-label="Piyasa bilgilerini yenile" onclick="AurumRebuiltMarket.manual(event)"><span aria-hidden="true">↻</span></button><div class="aurum-r205-market">'+ORDER.map(k=>{const x=f[k],p=n(x?.changePct),ok=x&&p!=null,cls=!ok?'flat':p>0?'up':p<0?'down':'flat',arrow=!ok?'':p>0?'↑':p<0?'↓':'';return '<div class="aurum-r205-market-card" title="'+esc(x?'Borsamatik · fiyat ve günlük değişim aynı kayıttan':'Henüz veri alınmadı')+'"><span class="aurum-r205-market-label">'+LABEL[k]+'</span><strong class="aurum-r205-market-value">'+(x?fmt(x.value,k):'—')+'</strong><span class="aurum-r205-market-pct '+cls+'">'+(arrow?'<i class="aurum-market-dir" aria-hidden="true">'+arrow+'</i>':'')+(ok?((p>0?'+':'')+p.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%'):'—')+'</span></div>'}).join('')+'</div></div>'}
  function render(){const h=document.getElementById('aurumDataMarketStrip');if(h)h.outerHTML=markup()}
  async function manual(ev){const b=ev?.currentTarget;try{if(b)b.disabled=true;await refresh({manual:true});globalThis.showAurumNotice?.('Piyasa göstergeleri yenilendi.','success',1800);return true}catch(e){globalThis.showAurumNotice?.('Piyasa göstergeleri alınamadı; eski doğru kayıt korundu: '+(e?.message||e),'error',3200);return false}finally{if(b)b.disabled=false}}
  globalThis.AurumRebuiltMarket=Object.freeze({refresh,manual,scheduled:()=>refresh({scheduled:true}),markup,cached:load});
  globalThis.cachedMarketIndicators=load;globalThis.refreshMarketIndicators=o=>refresh({manual:o?.force===true,scheduled:o?.auto===true});globalThis.marketIndicatorsMarkup=markup;globalThis.refreshAurumDataMarketStrip=manual;
  if(globalThis.AurumMarketRuntime)globalThis.AurumMarketRuntime=Object.freeze({manualRefresh:()=>manual(),scheduledRefresh:async()=>{try{await refresh({scheduled:true});return {market:true,portal:false}}catch{return {market:false,portal:false}}}});
})();