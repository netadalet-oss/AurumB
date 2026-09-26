'use strict';
(()=>{
 if(globalThis.__AURUM_MARKET_DISPLAY_FIX2__)return;globalThis.__AURUM_MARKET_DISPLAY_FIX2__=true;
 const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null}, pct=(v,p)=>v!=null&&p!=null&&p!==0?(v/p-1)*100:null, OZ=31.1034768;
 async function prev(symbol){
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com'])try{
   const u='https://'+host+'/v8/finance/chart/'+encodeURIComponent(symbol)+'?range=5d&interval=1d&events=history';
   const r=await globalThis.AurumNativeHTTP.request(u,{headers:{Accept:'application/json'}},12000);
   if(!r.ok)continue;const z=await r.json(),q=z?.chart?.result?.[0],m=q?.meta||{},a=(q?.indicators?.quote?.[0]?.close||[]).map(n).filter(x=>x!=null);
   const p=n(m.chartPreviousClose??m.previousClose)??(a.length>1?a[a.length-2]:null);if(p!=null)return p;
  }catch{} return null;
 }
 async function complete(){
  const d=globalThis.cachedMarketIndicators?.(),f=d?.fields||{};if(!d)return;
  const map={XU100:'XU100.IS',USDTRY:'TRY=X',EURTRY:'EURTRY=X'};
  await Promise.allSettled(Object.entries(map).map(async([k,s])=>{const x=f[k];if(!x||n(x.value)==null||n(x.changePct)!=null)return;const p=n(x.previousClose)??await prev(s);if(p!=null){x.previousClose=p;x.changePct=pct(n(x.value),p);x.stale=false}}));
  if(f.GRAMTRY&&n(f.GRAMTRY.value)!=null&&n(f.GRAMTRY.changePct)==null){let p=n(f.GRAMTRY.previousClose);if(p==null){const [g,u]=await Promise.all([prev('GC=F'),prev('TRY=X')]);if(g!=null&&u!=null)p=g*u/OZ}if(p!=null){f.GRAMTRY.previousClose=p;f.GRAMTRY.changePct=pct(n(f.GRAMTRY.value),p);f.GRAMTRY.stale=false}}
  const ep=n(f.EURTRY?.previousClose),up=n(f.USDTRY?.previousClose),gp=n(f.GRAMTRY?.previousClose);
  if(f.EURUSD&&n(f.EURUSD.value)!=null&&n(f.EURUSD.changePct)==null&&ep!=null&&up!=null){const p=ep/up;f.EURUSD.previousClose=p;f.EURUSD.changePct=pct(n(f.EURUSD.value),p);f.EURUSD.stale=false}
  if(f.GOLDUSD&&n(f.GOLDUSD.value)!=null&&n(f.GOLDUSD.changePct)==null){let p=n(f.GOLDUSD.previousClose);if(p==null&&gp!=null&&up!=null)p=gp*OZ/up;if(p==null)p=await prev('GC=F');if(p!=null){f.GOLDUSD.previousClose=p;f.GOLDUSD.changePct=pct(n(f.GOLDUSD.value),p);f.GOLDUSD.stale=false}}
  try{writeLocal('marketIndicatorsREV2042',d);writeLocal('marketIndicatorsREV2041',d);writeLocal('marketIndicatorsREV2040',d)}catch{}
 }
 function paint(){
  const d=globalThis.cachedMarketIndicators?.(),f=d?.fields||{},cards=document.querySelectorAll('#aurumDataMarketStrip .aurum-r205-market-card');
  cards.forEach(card=>{const label=card.querySelector('.aurum-r205-market-label')?.textContent?.trim();const key={'BIST 100':'XU100','USD/TRY':'USDTRY','EUR/TRY':'EURTRY','EUR/USD':'EURUSD','Gram Altın':'GRAMTRY','Altın Ons':'GOLDUSD'}[label],x=f[key];if(!x)return;
   if(key==='XU100'&&n(x.value)!=null){const e=card.querySelector('.aurum-r205-market-value');if(e)e.textContent=n(x.value).toLocaleString('tr-TR',{minimumFractionDigits:1,maximumFractionDigits:2})}
   const p=n(x.changePct),e=card.querySelector('.aurum-r205-market-pct');if(e&&p!=null){e.className='aurum-r205-market-pct '+(p>0?'up':p<0?'down':'flat');e.textContent=(p>0?'↑ +':p<0?'↓ ':'')+p.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%'}
  });
 }
 const b=globalThis.refreshAurumDataMarketStrip;if(typeof b==='function')globalThis.refreshAurumDataMarketStrip=async function(ev){const ok=await b(ev);await complete();paint();return ok};
 const oldMarkup=globalThis.marketIndicatorsMarkup;if(typeof oldMarkup==='function')globalThis.marketIndicatorsMarkup=function(){const h=oldMarkup();queueMicrotask(paint);return h};
 globalThis.AurumMarketDisplayComplete=async()=>{await complete();paint();return true};
})();