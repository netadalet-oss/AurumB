'use strict';
/* REV20.50 final stability layer: non-destructive health, market auto refresh and compact appearance strips. */
(()=>{
 if(globalThis.__AURUM_REV2050__)return; globalThis.__AURUM_REV2050__=true;
 const PERIOD=30*60*1000, HEALTH=5*60*1000, KEY='aurum.r250.health.v1';
 const iso=()=>new Date().toISOString(), n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
 function event(level,code,message,extra={}){try{const a=JSON.parse(localStorage.getItem(KEY)||'[]');a.unshift({at:iso(),level,code,message,...extra});localStorage.setItem(KEY,JSON.stringify(a.slice(0,240)))}catch{}}
 function marketRefresh(){try{return Promise.resolve(globalThis.refreshMarketIndicators?.({auto:true})).then(()=>{try{const h=document.getElementById('aurumDataMarketStrip');if(h&&globalThis.marketIndicatorsMarkup)h.outerHTML=globalThis.marketIndicatorsMarkup()}catch{};event('info','MARKET_REFRESH','Piyasa göstergeleri yenilendi')}).catch(e=>event('warn','MARKET_REFRESH_FAILED',String(e?.message||e)))}catch(e){event('warn','MARKET_REFRESH_FAILED',String(e?.message||e));return Promise.resolve()}}
 function health(){
  try{
   const s=globalThis.state||globalThis.AurumUpdateAPI?.state||{},rt=globalThis.AurumRuntime?.status?.()||{},mi=globalThis.cachedMarketIndicators?.()||null;
   const report={at:iso(),online:navigator.onLine!==false,runtime:rt.status||'IDLE',stage:rt.stage||null,marketAt:mi?.updatedAt||mi?.at||null,marketFieldCount:Object.values(mi?.fields||{}).filter(x=>n(x?.value)!=null).length,records:Array.isArray(s.records)?s.records.length:null};
   localStorage.setItem('aurum.r250.health.latest',JSON.stringify(report));
   if(!report.online)event('warn','OFFLINE','Ağ bağlantısı yok; mevcut tablolar korunuyor');
   if(mi&&report.marketFieldCount<4)event('warn','MARKET_PARTIAL','Piyasa göstergelerinin bir bölümü eski son geçerli değerde tutuluyor',{count:report.marketFieldCount});
   return report;
  }catch(e){event('warn','HEALTH_CHECK_FAILED',String(e?.message||e));return null}
 }
 function healthMarkup(){let r=null,logs=[];try{r=JSON.parse(localStorage.getItem('aurum.r250.health.latest')||'null');logs=JSON.parse(localStorage.getItem(KEY)||'[]').slice(0,12)}catch{}return '<details class="card gold-edge aurum-settings-details"><summary class="aurum-settings-summary"><div><strong>Süreklilik ve Sorun Denetimi</strong><small>Veri silmeden sağlık kontrolü · güvenli yeniden deneme</small></div><span class="aurum-details-chevron">⌄</span></summary><div class="aurum-settings-details-body"><div class="actions"><button class="gold-btn" onclick="AurumStability.health();showAurumNotice(\'Denetim tamamlandı\',\'success\',1800)">Şimdi Denetle</button><button class="ghost-btn" onclick="AurumStability.marketRefresh()">Piyasa Verisini Yenile</button></div><small class="muted">Denetim hiçbir tabloyu temizlemez. Başarısız veri alımında son geçerli tablo ve zaman damgası korunur.</small>'+(r?'<div class="list-row"><div><strong>Son denetim: '+String(r.runtime||'IDLE')+'</strong><small>'+String(r.at||'—')+' · Piyasa alanı '+String(r.marketFieldCount??'—')+'/6</small></div></div>':'')+logs.map(x=>'<div class="list-row"><div><strong>'+String(x.code||'LOG')+'</strong><small>'+String(x.at||'')+' · '+String(x.message||'')+'</small></div></div>').join('')+'</div></details>'}
 function installHealthModule(){const old=globalThis.settingsPage;if(typeof old==='function'&&!old.__r250){const w=function(){return old.apply(this,arguments)+healthMarkup()};w.__r250=true;globalThis.settingsPage=w;try{settingsPage=w}catch{}}}
 function compactMarketCss(){const st=document.createElement('style');st.id='aurumR250Css';st.textContent=`
#aurumDataMarketStrip{max-width:100%;overflow:hidden}
#aurumDataMarketStrip .aurum-r205-market{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;grid-template-rows:repeat(2,minmax(0,1fr));gap:5px!important;max-width:100%;overflow:hidden}
#aurumDataMarketStrip .aurum-r205-market-card{min-width:0!important;overflow:hidden!important;padding:6px 7px!important}
#aurumDataMarketStrip .aurum-r205-market-label{font-size:.68rem!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#aurumDataMarketStrip .aurum-r205-market-value{font-size:.82rem!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#aurumDataMarketStrip .aurum-r205-market-pct{font-size:.66rem!important;white-space:nowrap}
@media(max-width:430px){#aurumDataMarketStrip .aurum-r205-market{gap:3px!important}#aurumDataMarketStrip .aurum-r205-market-card{padding:5px!important}}
`;document.head.appendChild(st)}
 globalThis.AurumStability=Object.freeze({health,marketRefresh,logs:()=>{try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch{return []}}});
 compactMarketCss();installHealthModule();health();
 setInterval(health,HEALTH);
 // Market cadence is owned exclusively by market-indicators-revision.js.
 // Stability observes health only; it must not create startup or duplicate market requests.
 event('info','REV2050_ACTIVE','Nihai süreklilik katmanı etkin');
})();