'use strict';
/* R226 final hardening: immutable sub-70 snapshot, source-time display, compact strip settings. */
(()=>{
 if(globalThis.AURUM_R226_HARDENING==='R226.0')return; globalThis.AURUM_R226_HARDENING='R226.0';
 const S=globalThis.AurumUpdateAPI?.state||globalThis.state;
 const iso=()=>new Date().toISOString(), num=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
 function audit(code,message,extra={}){try{globalThis.log?.('info',message,{code,...extra})}catch{}}
 function activeFill(){try{return Number(globalThis.dataSummary?.(S.records)?.fillPct||0)}catch{return 0}}
 function candidateGate(records){try{return globalThis.dataIntegrityGate?.(globalThis.dataSummary?.(records))||{ok:false,fillPct:0}}catch{return {ok:false,fillPct:0}}}

 /* Every late atomic publisher must retain the same >=70 invariant. */
 try{
  const base=globalThis.atomicPublish;
  if(typeof base==='function'&&!base.__r226){
   const w=async function(job,universe){
    const staged=(await globalThis.stageRows(job.id)).map(x=>x.record);
    const eligible=typeof globalThis.publishableStagedRecords==='function'?globalThis.publishableStagedRecords(staged,job):staged;
    const gate=candidateGate(eligible);
    if(!gate.ok)throw Object.assign(new Error('DATA_FILL_BELOW_70_KEEP_LAST_VALID_SNAPSHOT'),{code:'DATA_FILL_BELOW_70',gate});
    return base.apply(this,arguments);
   };w.__r226=true;globalThis.atomicPublish=w;try{atomicPublish=w}catch{}
  }
 }catch{}

 /* Orphan staging is diagnostic material, never an alternate publication channel. */
 try{
  const safe=async function(){
   if(!S?.db)return {recovered:0,retained:0,quarantined:0};
   const [rows,jobs]=await Promise.all([globalThis.dbAll('stagingRecords'),globalThis.dbAll('jobs')]);
   const active=new Set(jobs.filter(j=>globalThis.operationBusyStatus?.(String(j?.status||''))).map(j=>j.id));
   const orph=rows.filter(x=>!active.has(x.jobId));
   if(!orph.length)return {recovered:0,retained:0,quarantined:0};
   await globalThis.dbPut('meta',{key:'orphanStagingQuarantine',value:{at:iso(),count:orph.length,jobIds:[...new Set(orph.map(x=>x.jobId))]},updatedAt:iso()});
   audit('ORPHAN_STAGING_QUARANTINED','Aktif işe bağlı olmayan staging kayıtları canlı Veriler tablosuna yayımlanmadı',{count:orph.length});
   return {recovered:0,retained:orph.length,quarantined:orph.length};
  };globalThis.recoverOrphanStagingRecords=safe;try{recoverOrphanStagingRecords=safe}catch{}
 }catch{}

 /* Legacy local repair may run only against an already accepted snapshot and may never
    turn a sub-70 active table into a new timestamped state. */
 try{
  const base=globalThis.repairLegacyCorruptRecordsLocal;
  if(typeof base==='function'){
   const w=async function(){
    const fill=activeFill();
    if(fill<70){audit('LOCAL_REPAIR_HELD','Yerel onarım %70 altı aktif tabloda yayın yapmadı',{fillPct:fill});return {complete:false,held:true,repaired:0,failed:0,fillPct:fill}}
    return base.apply(this,arguments);
   };globalThis.repairLegacyCorruptRecordsLocal=w;try{repairLegacyCorruptRecordsLocal=w}catch{}
  }
 }catch{}

 function trParts(d=new Date()){try{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d),o={};for(const x of p)o[x.type]=x.value;return {date:o.year+'-'+o.month+'-'+o.day,wd:o.weekday,min:Number(o.hour)*60+Number(o.minute)}}catch{return null}}
 function sessionOpen(){const p=trParts();if(!p||p.wd==='Sat'||p.wd==='Sun')return false;try{if(globalThis.schedulerIsHolidayDate?.(p.date))return false}catch{}return p.min>=600&&p.min<=1080}
 function closePrice(rec){const a=rec?.series?.calcClose||rec?.series?.close||[];for(let i=a.length-1;i>=0;i--){const n=num(a[i]);if(n!=null&&n>0)return n}const n=num(rec?.price);return n!=null&&n>0?n:null}
 function sourceTime(rec){if(rec?.marketTimeVerified===true&&rec?.marketDataAt&&Number.isFinite(Date.parse(rec.marketDataAt)))return rec.marketDataAt;const z=rec?.series||{};for(const k of ['marketTime','timestamp','time','at']){const a=z[k];if(Array.isArray(a)){for(let i=a.length-1;i>=0;i--)if(a[i]&&Number.isFinite(Date.parse(a[i])))return a[i]}}const p=rec?.provenance;if(p?.marketTimeVerified===true&&p?.marketAt&&Number.isFinite(Date.parse(p.marketAt)))return p.marketAt;return rec?.lastVisibleMarketAt&&Number.isFinite(Date.parse(rec.lastVisibleMarketAt))?rec.lastVisibleMarketAt:null}
 function displayPrice(rec){if(sessionOpen()){const n=num(rec?.livePrice);if(n!=null&&n>0)return n;const h=num(rec?.lastVisiblePrice);if(h!=null&&h>0)return h}return closePrice(rec)??num(rec?.lastVisiblePrice)}
 try{
  const raw=globalThis.v141225Raw;if(typeof raw==='function'){const w=function(rec,key,skip){if(key==='Anlik')return displayPrice(rec);if(key==='VeriZamani')return sourceTime(rec);return raw(rec,key,skip)};globalThis.v141225Raw=w;try{v141225Raw=w}catch{}}
  globalThis.kn117LatestPrice=displayPrice;try{kn117LatestPrice=displayPrice}catch{}
  globalThis.kn117MarketTime=sourceTime;try{kn117MarketTime=sourceTime}catch{}
  const bt=globalThis.kh117T0;if(typeof bt==='function'){const w=function(){const r=bt.apply(this,arguments);return {...r,marketTime:(S.records||[]).map(sourceTime).filter(Boolean).sort().at(-1)||r?.marketTime||null}};globalThis.kh117T0=w;try{kh117T0=w}catch{}}
 }catch{}

 /* Compact, bounded presentation strips. Existing theme is the default and no financial
    state is touched. */
 const KEY='aurum.rev20.presentation.v1';
 const DEF={uiScale:100,fontScale:10,tableFont:9,titleScale:12,helperScale:8,iconScale:100,cardPadding:100,gapScale:100,radiusScale:100,cellPadding:100,navScale:100,headerScale:100,density:'base',fontFamily:'system',fontWeight:'400',accent:'',text:'',muted:'',background:'',cardBackground:'',tableBackground:'',tableHeader:'',positive:'',negative:''};
 const palettes={
  background:['#00062f','#000735','#01083B','#030a40','#050d46'],
  cardBackground:['#04101f','#061225','#071327','#09162c','#0b1931'],
  tableBackground:['#010512','#020718','#04091d','#060c22','#081027'],
  tableHeader:['#04122d','#061532','#071738','#091a3e','#0b1e44'],
  accent:['#c5a94f','#ddbd59','#f3d36f','#f6dc86','#f8e59d'],
  text:['#dfe3e9','#e9ecf1','#f5f7fb','#fafbfc','#ffffff'],
  muted:['#7f8da3','#8e9db3','#9cabc1','#aab9cf','#b9c7dc'],
  positive:['#48b77c','#56c78b','#65d69b','#79dfa9','#8ce7b7'],
  negative:['#e65368','#f16175','#ff7185','#ff8798','#ff9dac']
 };
 const fonts=[['system','400','Sistem · Normal'],['system','600','Sistem · Orta'],['system','700','Sistem · Kalın'],['serif','400','Serif · Normal'],['serif','700','Serif · Kalın'],['mono','400','Mono · Normal'],['mono','700','Mono · Kalın']];
 const load=()=>{try{return {...DEF,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{return {...DEF}}};
 const save=p=>localStorage.setItem(KEY,JSON.stringify(p));
 const fam=v=>v==='serif'?"Georgia,'Times New Roman',serif":v==='mono'?"ui-monospace,SFMono-Regular,Menlo,Consolas,monospace":"Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif";
 function apply(p=load()){const r=document.documentElement;r.dataset.r20Custom='1';r.style.setProperty('--r20-font',p.fontScale+'px');r.style.setProperty('--r20-table',p.tableFont+'px');r.style.setProperty('--r20-title',p.titleScale+'px');r.style.setProperty('--r20-helper',p.helperScale+'px');r.style.setProperty('--r20-card-pad',p.cardPadding/100);r.style.setProperty('--r20-gap',p.gapScale/100);r.style.setProperty('--r20-radius',p.radiusScale/100);r.style.setProperty('--r20-cell',p.cellPadding/100);r.style.setProperty('--r20-family',fam(p.fontFamily));r.style.setProperty('--r20-weight',p.fontWeight);r.style.zoom=p.uiScale/100;for(const [k,v] of [['--gold2',p.accent],['--text',p.text],['--muted',p.muted],['--r20-card-bg',p.cardBackground],['--r20-table-bg',p.tableBackground],['--r20-table-head',p.tableHeader],['--green',p.positive],['--red',p.negative]])v?r.style.setProperty(k,v):r.style.removeProperty(k);if(p.background)document.body.style.background=p.background;else document.body.style.removeProperty('background');return p}
 const strip=(id,title,val,min,max,def)=>'<div class="r226-strip"><label><button type="button" data-r226-reset="'+id+'" data-v="'+def+'">↶</button><span>'+title+'</span><b data-r226-out="'+id+'">'+val+'</b></label><input id="'+id+'" type="range" min="'+min+'" max="'+max+'" value="'+val+'" step="1"></div>';
 function markup(){const p=load(),fontIndex=Math.max(0,fonts.findIndex(x=>x[0]===p.fontFamily&&x[1]===String(p.fontWeight))),color=(k,t)=>{const a=palettes[k],v=p[k]||a[2],ix=Math.max(0,a.indexOf(v));return '<div class="r226-strip r226-color" data-color="'+k+'"><label><button type="button" data-r226-reset="'+k+'" data-v="">↶</button><span>'+t+'</span><b style="background:'+v+'"></b></label><input id="r226_'+k+'" type="range" min="0" max="'+(a.length-1)+'" value="'+ix+'" step="1"></div>'};return '<details class="card gold-edge aurum-settings-details" id="aurumRev20Appearance"><summary class="aurum-settings-summary"><div><strong>Arayüz ve Görünüm</strong><small>Yakın aralıklı canlı ayar şeritleri</small></div><span class="aurum-details-chevron">⌄</span></summary><div class="aurum-settings-details-body r226-shell">'+color('background','Arka plan')+color('cardBackground','Kart rengi')+color('tableBackground','Tablo rengi')+color('tableHeader','Tablo başlığı')+color('accent','Vurgu')+color('text','Ana yazı')+color('muted','İkincil yazı')+color('positive','Pozitif')+color('negative','Negatif')+strip('r226_font','Yazı tipi · '+fonts[fontIndex][2],fontIndex,0,fonts.length-1,0)+strip('r226_size','Yazı boyutu',p.fontScale,8,12,10)+strip('r226_table','Tablo yazısı',p.tableFont,8,11,9)+strip('r226_compact','Kart kompaktlığı',p.cardPadding,88,106,100)+strip('r226_gap','Alan aralığı',p.gapScale,90,106,100)+strip('r226_radius','Köşe biçimi',p.radiusScale,90,108,100)+'<div class="actions r226-actions"><button class="gold-btn" type="button" data-r226-save>Kaydet</button><button class="ghost-btn" type="button" data-r226-all>↶ Tümünü Varsayılana Döndür</button></div></div></details>'}
 function read(){const p=load();for(const k of Object.keys(palettes)){const el=document.getElementById('r226_'+k);if(el)p[k]=palettes[k][Number(el.value)]||''}const fi=Number(document.getElementById('r226_font')?.value||0);p.fontFamily=fonts[fi]?.[0]||'system';p.fontWeight=fonts[fi]?.[1]||'400';p.fontScale=Number(document.getElementById('r226_size')?.value||10);p.tableFont=Number(document.getElementById('r226_table')?.value||9);p.cardPadding=Number(document.getElementById('r226_compact')?.value||100);p.gapScale=Number(document.getElementById('r226_gap')?.value||100);p.radiusScale=Number(document.getElementById('r226_radius')?.value||100);return p}
 function preview(){const p=read(),box=document.getElementById('aurumRev20Appearance');if(!box)return;box.style.fontFamily=fam(p.fontFamily);box.style.fontWeight=p.fontWeight;box.style.fontSize=p.fontScale+'px';box.style.setProperty('--r226-pad',p.cardPadding/100);box.querySelectorAll('.r226-color').forEach(el=>{const k=el.dataset.color,v=p[k]||palettes[k][2];el.querySelector('b').style.background=v});const f=document.querySelector('#aurumRev20Appearance [data-r226-out="r226_font"]');if(f)f.textContent=fonts[Number(document.getElementById('r226_font')?.value||0)]?.[2]||''}
 if(!document.getElementById('aurumR226Css')){const st=document.createElement('style');st.id='aurumR226Css';st.textContent='.r226-shell{display:grid;gap:7px}.r226-strip{padding:7px 9px;border:1px solid rgba(255,255,255,.07);border-radius:9px;overflow:hidden}.r226-strip label{display:grid!important;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:6px;margin:0 0 3px!important;font-size:.72rem}.r226-strip label button{width:22px;height:22px;padding:0;border:0;border-radius:6px;background:rgba(255,255,255,.06);color:inherit}.r226-strip input[type=range]{width:100%;height:12px;margin:0;accent-color:var(--gold2)}.r226-color b{width:28px;height:9px;border-radius:999px;border:1px solid rgba(255,255,255,.18)}.r226-actions{display:grid!important;grid-template-columns:1fr 1fr;gap:7px}.r226-shell .r226-strip{padding:calc(7px * var(--r226-pad,1)) 9px}@media(max-width:520px){.r226-shell{gap:5px}.r226-strip{padding:6px 7px}.r226-actions{grid-template-columns:1fr 1fr}}';document.head.appendChild(st)}
 document.addEventListener('input',e=>{if(!e.target?.closest?.('#aurumRev20Appearance'))return;if(e.target.matches('input[type=range]'))preview()},true);
 document.addEventListener('click',e=>{const r=e.target?.closest?.('[data-r226-reset]');if(r){const id=r.dataset.r226Reset;if(palettes[id]){const el=document.getElementById('r226_'+id);if(el)el.value='2'}else{const el=document.getElementById(id);if(el)el.value=r.dataset.v}preview();return}if(e.target?.closest?.('[data-r226-save]')){const p=read();save(p);apply(p);S&&(S.settingsDirty=false);globalThis.showAurumNotice?.('Görünüm ayarları kaydedildi','success',1800);return}if(e.target?.closest?.('[data-r226-all]')){for(const k of Object.keys(palettes)){const el=document.getElementById('r226_'+k);if(el)el.value='2'}for(const [id,v] of [['r226_font',0],['r226_size',DEF.fontScale],['r226_table',DEF.tableFont],['r226_compact',DEF.cardPadding],['r226_gap',DEF.gapScale],['r226_radius',DEF.radiusScale]]){const el=document.getElementById(id);if(el)el.value=String(v)}preview();S&&(S.settingsDirty=true);globalThis.showAurumNotice?.('Varsayılan görünüm önizlemede · kalıcı olması için Kaydet','info',2200)}},true);
 globalThis.AurumPresentationSettings=Object.freeze({load,apply,markup,preview,reset:()=>{save({...DEF});apply({...DEF})}});apply(load());

 /* Continuous diagnostics: no destructive auto-fix, but safe scheduler/market repair hooks. */
 async function health(){
  const fill=activeFill(),meta=await globalThis.dbGet?.('meta','activeDataSnapshot'),rt=globalThis.AurumRuntime?.status?.()||{},marketAt=globalThis.cachedMarketIndicators?.()?.updatedAt||null;
  const scheduler=await globalThis.r73SchedulerDiagnostic?.().catch?.(()=>null);
  /* Diagnostics are read-only. Repair/re-arm is allowed only through an explicit user command
     or the native Veriler scheduler trigger; diagnostics never start work by themselves. */
  const report={at:iso(),fillPct:fill,snapshotAt:meta?.value?.changedAt||meta?.value?.transferredAt||null,runtime:rt.status||'IDLE',scheduler,market:globalThis.cachedMarketIndicators?.()?.updatedAt||marketAt};
  try{localStorage.setItem('aurum.r226.health.latest',JSON.stringify(report))}catch{}return report
 }
 let centralDepth=0;
 const centralAllowed=()=>centralDepth>0;
 async function centralCompanionRun(context='DATA'){
  if(!centralAllowed()){audit('CENTRAL_TRIGGER_DENIED','Merkez dışı yardımcı çalışma engellendi',{context});return false}
  const out={at:iso(),context,market:false,portal:false,diagnostics:false};
  /* Market indicators are acquired inside the same Veriler phase; display completion may only
     fill presentation fields while this central authorization is active. */
  try{if(typeof globalThis.AurumMarketDisplayComplete==='function')await globalThis.AurumMarketDisplayComplete()}catch(e){audit('CENTRAL_MARKET_DISPLAY_FAILED','Piyasa gösterge tamamlama adımı başarısız',{error:e?.message||String(e)})}
  out.market=!!globalThis.cachedMarketIndicators?.()?.updatedAt;
  try{out.portal=!!(await globalThis.refreshAurumFinancePortal?.(true))}catch(e){audit('CENTRAL_PORTAL_FAILED','Veriler zincirindeki finans portalı güncellenemedi',{error:e?.message||String(e)})}
  try{await globalThis.refreshAurumRMarketIntel?.(true)}catch(e){audit('CENTRAL_INTEL_FAILED','Veriler zincirindeki piyasa istihbaratı güncellenemedi',{error:e?.message||String(e)})}
  try{await globalThis.AurumNLPortal?.refresh?.()}catch(e){audit('CENTRAL_NL_PORTAL_FAILED','Veriler zincirindeki Nederland portalı güncellenemedi',{error:e?.message||String(e)})}
  try{await health();out.diagnostics=true}catch(e){audit('CENTRAL_DIAGNOSTIC_FAILED','Veriler zincirindeki tanı çalışması tamamlanamadı',{error:e?.message||String(e)})}
  try{localStorage.setItem('aurum.r226.central.last',JSON.stringify(out))}catch{}
  return out
 }
 /* One trigger contract: companions can run only inside a Veriler MANUAL/AUTO job.
    No timer, startup, navigation, focus, reconnect or standalone market/portal action starts them. */
 try{
  const base=globalThis.prepareGeneralData;
  if(typeof base==='function'){
   const w=async function(job,mode){const allowed=['MANUAL','AUTO'].includes(String(job?.mode||'').toUpperCase());if(allowed)centralDepth++;try{const ok=await base.apply(this,arguments);if(ok&&allowed)await centralCompanionRun(String(job.mode).toUpperCase());return ok}finally{if(allowed)centralDepth=Math.max(0,centralDepth-1)}};
   globalThis.prepareGeneralData=w;try{prepareGeneralData=w}catch{}
  }
  const repair=globalThis.prepareMissingData;
  if(typeof repair==='function'){
   const w=async function(job){const allowed=['MANUAL','AUTO'].includes(String(job?.mode||'').toUpperCase());if(allowed)centralDepth++;try{const ok=await repair.apply(this,arguments);if(ok&&allowed)await centralCompanionRun(String(job.mode).toUpperCase()+'_REPAIR');return ok}finally{if(allowed)centralDepth=Math.max(0,centralDepth-1)}};
   globalThis.prepareMissingData=w;try{prepareMissingData=w}catch{}
  }
  for(const name of ['refreshMarketIndicators','refreshAurumFinancePortal','refreshAurumMarketSummary','refreshAurumRMarketIntel']){
   const fn=globalThis[name];if(typeof fn!=='function')continue;
   globalThis[name]=async function(){if(!centralAllowed()){audit('CENTRAL_NETWORK_DENIED',name+' merkez tetik dışında engellendi');return name==='refreshMarketIndicators'?globalThis.cachedMarketIndicators?.()||null:null}return fn.apply(this,arguments)};
   try{if(name==='refreshMarketIndicators')refreshMarketIndicators=globalThis[name]}catch{}
  }
 }catch(e){audit('CENTRAL_TRIGGER_INSTALL_FAILED','Tek merkez tetik zinciri kurulamadı',{error:e?.message||String(e)})}
 globalThis.AurumCentralTrigger=Object.freeze({version:'R226.3',policy:'VERILER_SCHEDULER_OR_EXPLICIT_DATA_COMMAND_ONLY',authorized:centralAllowed});
 globalThis.AurumFinalHardening=Object.freeze({version:'R226.3-SINGLE-CENTRAL-TRIGGER',health,activeFill,sessionOpen});
 audit('R226_ACTIVE','Nihai süreklilik ve arayüz sertleştirmesi etkin');
})();