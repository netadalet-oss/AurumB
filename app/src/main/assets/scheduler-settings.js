'use strict';
(()=>{
 const DATA_KEY='aurum.ui.dataScheduleTimes',NOTICE_KEY='aurum.ui.noticeHistory20',LOG_KEY='aurum.ui.systemLog20',MARKET_KEY='aurum.ui.marketScheduleTimes',DATA_ON='aurum.ui.dataScheduleEnabled',MARKET_ON='aurum.ui.marketScheduleEnabled';
 const DATA_DEF='00:30,04:30,08:20,09:20,10:20,11:20,12:20,13:20,14:20,15:20,16:20,17:20,18:20,19:20,20:30,21:30,22:30,23:30';
 const plus30=t=>{const m=String(t).match(/^(\d\d):(\d\d)$/);if(!m)return t;const n=(+m[1]*60 + +m[2]+30)%1440;return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')};
 const get=(k,d)=>{try{return localStorage.getItem(k)??d}catch{return d}},set=(k,v)=>{try{localStorage.setItem(k,v)}catch{}};
 const MIG='aurum.ui.dualScheduleMigrated.v1',LEGACY='aurum.b.scheduler.model.v13';
 function migrate(){
   if(get(MIG,'0')==='1')return;
   try{
     if(localStorage.getItem(DATA_KEY)==null){
       let old=null;try{old=JSON.parse(localStorage.getItem(LEGACY)||'null')}catch{}
       const legacyTimes=Array.isArray(old?.weekday)?old.weekday.filter(x=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(x))):[];
       if(legacyTimes.length){set(DATA_KEY,[...new Set(legacyTimes)].sort().join(','));set(DATA_ON,old?.enabled===false?'0':'1');}
       else{
         let native=null;try{native=JSON.parse(call('schedule_status')||'null')}catch{}
         const nativeTimes=Array.isArray(native?.dataTimes)?native.dataTimes.filter(x=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(x))):[];
         if(nativeTimes.length)set(DATA_KEY,[...new Set(nativeTimes)].sort().join(','));
         if(typeof native?.dataEnabled==='boolean')set(DATA_ON,native.dataEnabled?'1':'0');
       }
     }
     if(localStorage.getItem(MARKET_KEY)==null)set(MARKET_KEY,(localStorage.getItem(DATA_KEY)||DATA_DEF).split(',').map(plus30).join(','));
     if(localStorage.getItem(MARKET_ON)==null)set(MARKET_ON,'0');
   }finally{set(MIG,'1')}
 }
 const times=kind=>{migrate();return get(kind==='data'?DATA_KEY:MARKET_KEY,kind==='data'?DATA_DEF:DATA_DEF.split(',').map(plus30).join(',')).split(',').map(x=>x.trim()).filter(Boolean)};
 const enabled=kind=>{migrate();return get(kind==='data'?DATA_ON:MARKET_ON,'0')!=='0'};
 const call=(cmd,p={})=>{const u='aurum://native?cmd='+encodeURIComponent(cmd)+Object.entries(p).map(([k,v])=>'&'+encodeURIComponent(k)+'='+encodeURIComponent(v)).join('');try{return globalThis.AurumNativeBridge?.call?.(u,'')??prompt(u,'')}catch{return''}};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function editor(kind,title,sub){const xs=times(kind),cap=kind==='data'?'Data':'Market';return '<div class="aurum-schedule-profile" data-schedule-kind="'+kind+'"><div class="aurum-schedule-profile-head"><div><b>'+title+'</b><small>'+sub+'</small></div><label class="aurum-schedule-toggle"><input id="aurum'+cap+'ScheduleEnabled" type="checkbox" '+(enabled(kind)?'checked':'')+'><span>Aktif</span></label></div><div class="aurum-schedule-chips">'+xs.map(t=>'<span class="aurum-schedule-chip"><b>'+esc(t)+'</b><button type="button" onclick="AurumDualScheduler.remove(\''+kind+'\',\''+esc(t)+'\')">−</button></span>').join('')+'</div><div class="aurum-schedule-add"><input type="time" step="60" id="aurumScheduleAdd_'+kind+'" value="'+(kind==='data'?'09:20':'09:50')+'"><button class="ghost-btn" type="button" onclick="AurumDualScheduler.add(\''+kind+'\')">+ Ekle</button></div><input type="hidden" id="aurum'+cap+'ScheduleTimes" value="'+esc(xs.join(','))+'"></div>'}
 function historyBlock(){return '<details class="card gold-edge aurum-settings-details" id="aurumHistory20"><summary class="aurum-settings-summary"><div><strong>Bildirimler ve Sistem Logları</strong><small>Önemli olaylar · en fazla 20 + 20 · Pazar 00:00 temizlik</small></div><span class="aurum-details-chevron">⌄</span></summary><div class="aurum-settings-details-body"><div class="actions"><button class="ghost-btn" type="button" onclick="AurumSettingsHistory20.clear()">Geçmişi Temizle</button></div><div class="aurum-history-grid"><section><b>Bildirimler</b><div id="aurumNoticeHistory20"></div></section><section><b>Sistem Logları</b><div id="aurumSystemLog20"></div></section></div></div></details>'}
 function healthBlock(){return '<details class="card gold-edge aurum-settings-details" id="aurumReadOnlyHealth"><summary class="aurum-settings-summary"><div><strong>Sağlık / Süreklilik</strong><small>Salt okunur · veri, tablo ve snapshot değiştirmez</small></div><span class="aurum-details-chevron">⌄</span></summary><div class="aurum-settings-details-body"><div class="actions"><button class="ghost-btn" type="button" onclick="AurumReadOnlyHealth.refresh()">Durumu Yenile</button></div><div id="aurumReadOnlyHealthBody" class="aurum-health-grid"><small>Sağlık bilgisi okunuyor…</small></div></div></details>'}
 async function healthRead(){
   const runtime=globalThis.AurumRuntime?.status?.()||{};
   const readMeta=async key=>{try{return (await globalThis.dbGet?.('meta',key))?.value??null}catch{return null}};
   const [active,lastSuccessfulPublish,pending]=await Promise.all([readMeta('activeDataSnapshot'),readMeta('lastSuccessfulPublishAt'),readMeta('pendingDataRepair')]);
   const lastSummary=globalThis.AurumRuntime?.summary?.()||null;
   let scheduler=null;try{scheduler=JSON.parse(call('schedule_status')||'null')}catch{}
   const market=globalThis.cachedMarketIndicators?.()||null,fields=market?.fields||{},fieldKeys=Object.keys(fields),validFields=fieldKeys.filter(k=>fields[k]?.valid!==false&&Number.isFinite(Number(fields[k]?.value))).length;
   const marketTimes=fieldKeys.map(k=>fields[k]?.sourceTimestamp).filter(x=>Number.isFinite(Date.parse(x))).map(Date.parse);
   const marketAt=marketTimes.length?new Date(Math.max(...marketTimes)).toISOString():null;
   const pendingCount=Number(pending?.symbolCount??pending?.items?.length??0);
   return {runtime,active,lastSummary,lastSuccessfulPublish,scheduler,market:{validFields,totalFields:fieldKeys.length,marketAt,lastAttemptAt:market?.lastAttemptAt||null,lastAttemptOk:market?.lastAttemptOk??null},pendingCount};
 }
 async function renderHealth(){const host=document.getElementById('aurumReadOnlyHealthBody');if(!host)return null;try{const h=await healthRead(),fmt=v=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('tr-TR'):'—',fill=Number(h.lastSummary?.fillPct);const exact=h.scheduler?.exactAllowed===true?'Kesin':h.scheduler?'Yaklaşık / izin gerekli':'Durum alınamadı';host.innerHTML='<div><span>Runtime</span><b>'+esc(h.runtime?.status||'IDLE')+'</b></div><div><span>Son başarılı veri</span><b>'+esc(fmt(h.lastSuccessfulPublish?.value||h.lastSuccessfulPublish||h.active?.transferredAt||h.active?.completedAt))+'</b></div><div><span>Aktif snapshot</span><b>'+esc(h.active?.snapshotId||'—')+'</b></div><div><span>Doluluk</span><b>'+(Number.isFinite(fill)?esc(fill.toFixed(2)+'%'):'—')+'</b></div><div><span>Piyasa alanları</span><b>'+esc(h.market.validFields+'/'+h.market.totalFields)+'</b></div><div><span>Son piyasa zamanı</span><b>'+esc(fmt(h.market.marketAt))+'</b></div><div><span>Zamanlayıcı</span><b>'+esc(exact)+'</b></div><div><span>Bekleyen onarım</span><b>'+esc(String(h.pendingCount))+'</b></div>';return h}catch(e){host.innerHTML='<small>Sağlık bilgisi okunamadı. Veriler değiştirilmedi.</small>';return null}}
 function historyArray(k){try{const x=JSON.parse(localStorage.getItem(k)||'[]');return Array.isArray(x)?x:[]}catch{return[]}}
 function read20(k){return historyArray(k).slice(-20).reverse()}
 function historyType(type){const t=String(type||'info').toLowerCase();return t==='warn'?'warning':t}
 function importantEvent(type,message){
   const t=historyType(type),m=String(message||''),u=m.toLocaleUpperCase('tr-TR');
   if(t==='error'||t==='warning')return true;
   const important=/(FAIL|ERROR|HATA|BAŞARISIZ|GÜVEN|SECURITY|BLOCK|ENGEL|TRADE|İŞLEM|AL\/SAT|BİLDİRİM|NOTIFICATION|MODEL|YEDEK|BACKUP|RESTORE|GERİ YÜK|IMPORT|İÇE AKTAR|EXPORT|DIŞA AKTAR|INTEGRITY|BÜTÜNLÜK|REPAIR|ONAR|CANCEL|İPTAL|INTERRUPT|KESİNTİ|GATE|EŞİK|SCHEDULER|ZAMANLAYICI|ALARM|DATABASE|VERİTABANI|RESET|SIFIRLA|TEMİZ)/.test(u);
   const routineSuccess=/(SUCCESS|SUCCEEDED|BAŞARILI|\bOK\b|TAMAMLANDI)/.test(u)&&/\b[A-ZÇĞİÖŞÜ]{2,6}\b/.test(u)&&!important;
   if(routineSuccess)return false;
   return important || /(UYGULAMA|SİSTEM|PIPELINE|AYAR|KAYDEDİLDİ|VARSAYILAN|İZİN|PORTAL|ZAMANLAYICI)/.test(u);
 }
 function historyFingerprint(type,message){
   return historyType(type)+'|'+String(message||'')
     .toLocaleUpperCase('tr-TR')
     .replace(/\b[A-ZÇĞİÖŞÜ]{2,6}\b/g,'<ITEM>')
     .replace(/\d{1,4}([.,:]\d{1,4})*/g,'#')
     .replace(/\s+/g,' ').trim();
 }
 function pruneHistoryArray(a,now=Date.now()){
   const cutoff=now-7*86400000;
   // Persistence keeps every important event inside the weekly retention window.
   // The visible list is capped by read20(); the 20-row UI limit must not delete
   // other important events from persistent history.
   return (Array.isArray(a)?a:[]).filter(x=>Number.isFinite(Date.parse(x?.at))&&Date.parse(x.at)>=cutoff)
 }
 function cleanupHistory(manual=false){
   try{
     for(const k of [NOTICE_KEY,LOG_KEY])localStorage.setItem(k,JSON.stringify(manual?[]:pruneHistoryArray(historyArray(k))));
     set('aurum.ui.historyCleanupSunday.v1',new Date().toISOString());
   }catch{}
   try{
     const task=manual?globalThis.AurumCompactNotifications?.clear?.():globalThis.AurumCompactNotifications?.cleanup?.();
     if(task&&typeof task.then==='function')task.catch(()=>{});
   }catch{}
   renderHistory();
   return true
 }
 function push20(k,x){
   try{
     const type=historyType(x?.type),message=String(x?.message||x?.detail||'').slice(0,400);
     if(!importantEvent(type,message))return false;
     const now=new Date().toISOString(),fp=historyFingerprint(type,message),a=pruneHistoryArray(historyArray(k));
     const idx=a.findIndex(v=>v?.fingerprint===fp);
     if(idx>=0){
       const prev=a.splice(idx,1)[0];
       a.push({...prev,...x,type,message,at:now,fingerprint:fp,count:Number(prev?.count||1)+1});
     }else a.push({at:now,...x,type,message,fingerprint:fp,count:1});
     localStorage.setItem(k,JSON.stringify(a));
     return true
   }catch{return false}
 }
 function renderHistory(){
   const fmt=x=>'<div class="aurum-history-row '+esc(x.type||'info')+'"><small class="aurum-history-time">'+esc(new Date(x.at||Date.now()).toLocaleString('tr-TR',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'}))+'</small><span>'+esc(x.message||x.detail||'—')+(Number(x.count||1)>1?' ×'+esc(x.count):'')+'</span></div>';
   const n=document.getElementById('aurumNoticeHistory20'),l=document.getElementById('aurumSystemLog20');
   if(n)n.innerHTML=read20(NOTICE_KEY).map(fmt).join('')||'<small>Kayıt yok</small>';
   if(l)l.innerHTML=read20(LOG_KEY).map(fmt).join('')||'<small>Kayıt yok</small>'
 }
 function log(type,message){if(push20(LOG_KEY,{type,message}))renderHistory()}
 function notice(type,message){if(push20(NOTICE_KEY,{type,message}))renderHistory()}
 function istanbulSundayMidnight(now=Date.now(),next=false){
   const shifted=new Date(now+3*3600000),y=shifted.getUTCFullYear(),m=shifted.getUTCMonth(),d=shifted.getUTCDate(),dow=shifted.getUTCDay();
   const localDay=d-dow+(next?7:0);
   return Date.UTC(y,m,localDay,0,0,0)-3*3600000
 }
 function cleanupIfDue(){
   const last=Date.parse(get('aurum.ui.historyCleanupSunday.v1',''))||0,target=istanbulSundayMidnight(Date.now(),false);
   if(last<target)cleanupHistory(false);
 }
 function scheduleCleanup(){
   cleanupIfDue();
   const target=istanbulSundayMidnight(Date.now(),true);
   setTimeout(()=>{cleanupHistory(false);scheduleCleanup()},Math.max(1000,target-Date.now()))
 }
 function block(){return '<details class="card gold-edge aurum-settings-details" id="aurumDualSchedulerSettings"><summary class="aurum-settings-summary"><div><strong>Otomatik Güncelleme Zamanlayıcısı</strong><small>Veriler ile Piyasa + Finans/Nederland bağımsızdır · mevcut saatler korunur</small></div><span class="aurum-details-chevron">⌄</span></summary><div class="aurum-settings-details-body"><div class="aurum-schedule-editor-v13">'+editor('data','Veriler','Bağımsız veri zamanlayıcısı')+editor('market','Piyasa + Finans Portalı + Nederland','Bağımsız piyasa zamanlayıcısı · varsayılan Veriler +30 dk')+'</div><div class="actions"><button class="gold-btn" type="button" onclick="AurumDualScheduler.saveAll()">Kaydet ve Kur</button><button class="ghost-btn" type="button" onclick="AurumDualScheduler.reinstall()">Alarmları Yeniden Kur</button><button class="ghost-btn" type="button" onclick="AurumDualScheduler.defaults()">Varsayılana dön</button></div><div class="aurum-scheduler-health" id="aurumSchedulerHealth">Android alarm katmanı son durumu okunuyor…</div><div class="aurum-scheduler-report-head"><b>Çalışma raporu</b><small id="aurumSchedulerSummary">son durum</small></div><div id="aurumSchedulerRows" class="aurum-scheduler-report-grid"></div><small class="muted">Bu panel yalnız zamanlayıcı yapılandırmasını yönetir. Manuel modül düğmeleri ve otomatik pipeline tetikleri birbirine bağlanmaz.</small></div></details>'}
 function style(){if(document.getElementById('aurumOldSchedulerUi'))return;const s=document.createElement('style');s.id='aurumOldSchedulerUi';s.textContent='#aurumDualSchedulerSettings .aurum-settings-details-body{padding:7px 9px 9px;font-size:.76rem}#aurumDualSchedulerSettings .aurum-schedule-editor-v13{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}#aurumDualSchedulerSettings .aurum-schedule-profile{border:1px solid rgba(212,175,55,.14);border-radius:9px;padding:6px;background:rgba(2,8,28,.58)}#aurumDualSchedulerSettings .aurum-schedule-profile-head{display:flex;justify-content:space-between;gap:6px;align-items:center;margin-bottom:4px}#aurumDualSchedulerSettings .aurum-schedule-profile-head div{display:grid;gap:2px}#aurumDualSchedulerSettings .aurum-schedule-profile-head small{color:var(--muted)}#aurumDualSchedulerSettings .aurum-schedule-chips{display:flex;flex-wrap:wrap;gap:4px}#aurumDualSchedulerSettings .aurum-schedule-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(212,175,55,.22);border-radius:999px;padding:2px 4px 2px 6px;background:rgba(212,175,55,.055)}#aurumDualSchedulerSettings .aurum-schedule-chip button{width:17px;height:17px;padding:0;border-radius:50%;border:0;background:rgba(255,255,255,.06);color:var(--muted)}#aurumDualSchedulerSettings .aurum-schedule-add{display:flex;gap:5px;margin-top:4px}#aurumDualSchedulerSettings .aurum-schedule-add input{min-height:28px}#aurumDualSchedulerSettings .aurum-scheduler-health{margin-top:5px;padding:4px 6px;border:1px solid rgba(212,175,55,.14);border-radius:10px;color:var(--muted)}#aurumDualSchedulerSettings .aurum-scheduler-report-head{display:flex;justify-content:space-between;gap:8px;margin-top:6px;padding-top:5px;border-top:1px solid rgba(255,255,255,.07)}#aurumDualSchedulerSettings .aurum-scheduler-report-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:3px;margin:4px 0}#aurumDualSchedulerSettings .aurum-scheduler-row{display:grid;grid-template-columns:auto 1fr;grid-template-areas:\"time state\" \"kind state\";column-gap:5px;align-items:center;padding:4px 5px;border:1px solid rgba(212,175,55,.09);border-radius:7px;background:rgba(1,9,31,.48)}#aurumDualSchedulerSettings .aurum-scheduler-row>b{grid-area:time;color:var(--gold2);font-size:.68rem}#aurumDualSchedulerSettings .aurum-scheduler-row>small{grid-area:kind;color:var(--muted);font-size:.56rem;font-weight:400}#aurumDualSchedulerSettings .aurum-scheduler-row>em{grid-area:state;justify-self:end;font-size:.56rem;font-style:normal;font-weight:500;letter-spacing:.01em}#aurumDualSchedulerSettings .aurum-scheduler-row>em.ok{color:var(--positive,#45d79a);text-shadow:0 0 8px rgba(69,215,154,.25)}#aurumDualSchedulerSettings .aurum-scheduler-row>em.warn{color:var(--muted)}#aurumDualSchedulerSettings input,#aurumDualSchedulerSettings button{touch-action:pan-y}#aurumDualSchedulerSettings .actions{gap:5px;margin-top:7px}#aurumDualSchedulerSettings .actions button{min-height:28px;padding:4px 7px;font-size:.68rem}#aurumDualSchedulerSettings .aurum-schedule-profile-head b{font-size:.76rem}#aurumDualSchedulerSettings .aurum-schedule-profile-head small,#aurumDualSchedulerSettings .aurum-scheduler-row small{font-size:.61rem}#aurumDualSchedulerSettings .aurum-schedule-chip b{font-size:.72rem}#aurumDualSchedulerSettings .aurum-schedule-toggle{font-size:.64rem;display:flex;align-items:center;gap:4px}@media(max-width:520px){#aurumDualSchedulerSettings .aurum-schedule-editor-v13{grid-template-columns:1fr}#aurumDualSchedulerSettings .aurum-scheduler-report-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}';document.head.appendChild(s);const h=document.createElement('style');h.textContent='.aurum-history-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.aurum-history-grid section{min-width:0}.aurum-history-grid section>b{font-size:.68rem;font-weight:600}.aurum-history-row{display:grid;grid-template-columns:42px minmax(0,1fr);gap:5px;padding:3px 2px;border-bottom:1px solid rgba(255,255,255,.045);font-size:9px;font-weight:300;line-height:1.25}.aurum-history-row .aurum-history-time{color:var(--muted);font-size:8px}.aurum-history-row.success span{color:var(--positive,#45d79a)}.aurum-history-row.error span{color:var(--negative,#ff6474)}@media(max-width:430px){.aurum-history-grid{grid-template-columns:1fr}.aurum-history-row{font-size:9px}}.aurum-health-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 8px}.aurum-health-grid>div{display:grid;gap:2px;padding:5px 6px;border:1px solid rgba(212,175,55,.10);border-radius:7px}.aurum-health-grid span{font-size:8px;color:var(--muted)}.aurum-health-grid b{font-size:9px;overflow-wrap:anywhere}@media(max-width:430px){.aurum-health-grid{grid-template-columns:1fr}}';document.head.appendChild(h)}
 function sync(kind,xs){set(kind==='data'?DATA_KEY:MARKET_KEY,xs.join(','))}
 function rerender(){const d=document.getElementById('aurumDualSchedulerSettings');if(!d)return;const open=d.open,w=document.createElement('div');w.innerHTML=block();d.replaceWith(w.firstElementChild);document.getElementById('aurumDualSchedulerSettings').open=open;report()}
 function add(kind){const t=String(document.getElementById('aurumScheduleAdd_'+kind)?.value||'');if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))return;sync(kind,[...new Set([...times(kind),t])].sort());rerender()}
 function remove(kind,t){sync(kind,times(kind).filter(x=>x!==t));rerender()}
 function saveOne(kind){const cap=kind==='data'?'Data':'Market',on=document.getElementById('aurum'+cap+'ScheduleEnabled')?.checked!==false,xs=times(kind);set(kind==='data'?DATA_ON:MARKET_ON,on?'1':'0');return call('schedule',{kind,enabled:on?'1':'0',times:xs.join(',')})}
 function saveAll(){const a=saveOne('data'),b=saveOne('market'),ok=a==='OK'&&b==='OK';log(ok?'success':'error',ok?'Zamanlayıcı ayarları kaydedildi':'Zamanlayıcı kurulumu başarısız · Veriler: '+String(a||'yanıt yok')+' · Piyasa: '+String(b||'yanıt yok'));report();return {ok,data:a,market:b}}
 function sameTimes(a,b){const x=[...(a||[])].map(String).sort(),y=[...(b||[])].map(String).sort();return x.length===y.length&&x.every((v,i)=>v===y[i])}
 function ensureNativeParity(reason='STARTUP'){
   migrate();
   let st=null;try{st=JSON.parse(call('schedule_status')||'null')}catch{}
   if(!st)return {ok:false,reason:'NO_NATIVE_STATUS'};
   const results={};
   for(const kind of ['data','market']){
     const wantEnabled=enabled(kind),wantTimes=times(kind),nativeEnabled=st?.[kind+'Enabled']===true,nativeTimes=Array.isArray(st?.[kind+'Times'])?st[kind+'Times']:[];
     if(wantEnabled===nativeEnabled&&sameTimes(wantTimes,nativeTimes)){results[kind]='UNCHANGED';continue}
     const r=call('schedule',{kind,enabled:wantEnabled?'1':'0',times:wantTimes.join(',')});
     results[kind]=r||'NO_RESPONSE';
   }
   const ok=Object.values(results).every(x=>x==='UNCHANGED'||x==='OK');
   if(Object.values(results).some(x=>x!=='UNCHANGED'))log(ok?'success':'warning',ok?'Zamanlayıcı Android katmanı kayıtlı ayarlarla eşitlendi':'Zamanlayıcı Android eşitlemesi tamamlanamadı · '+JSON.stringify(results));
   return {ok,reason,results};
 }
 function defaults(){sync('data',DATA_DEF.split(','));sync('market',DATA_DEF.split(',').map(plus30));set(DATA_ON,'1');set(MARKET_ON,'1');log('info','Zamanlayıcı varsayılanları geri yüklendi');rerender()}
 function report(){const h=document.getElementById('aurumSchedulerHealth'),r=document.getElementById('aurumSchedulerRows'),s=document.getElementById('aurumSchedulerSummary');if(!h||!r)return;const raw=call('schedule_status');let st=null;try{st=JSON.parse(raw)}catch{}const ok=!!st,exact=st?.exactAllowed===true,rows=[['Veriler',enabled('data'),times('data')],['Piyasa',enabled('market'),times('market')]],anyOn=rows.some(x=>x[1]);h.innerHTML=!ok?'Android alarm katmanı durum yanıtı alınamadı':!anyOn?'Zamanlayıcı devre dışı · Veriler ve Piyasa profilleri kapalı':exact?'Android alarm katmanı hazır · kesin alarm izni AÇIK':'Kesin alarm izni KAPALI · yaklaşık alarm kullanılacak <button class="ghost-btn" type="button" onclick="AurumDualScheduler.exactSettings()">İzni Aç</button>';r.innerHTML=rows.flatMap(([n,on,x])=>x.map(t=>'<div class="aurum-scheduler-row"><b>'+esc(t)+'</b><small>'+esc(n)+'</small><em class="'+(on&&ok&&exact?'ok':'warn')+'">'+(on?(ok?(exact?'Kesin':'Yaklaşık'):'Kontrol'):'Kapalı')+'</em></div>')).join('');if(s)s.textContent=!ok?'Durum kontrolü':!anyOn?'Devre dışı':exact?'Kesin alarm hazır':'Yaklaşık alarm'}
 function install(){style();const old=globalThis.settingsPage;if(typeof old!=='function'||old.__dualOldScheduler)return;const fn=function(...a){let out=String(old.apply(this,a));out=out.replace(/<details[^>]*id="aurumSchedulerModule"[\s\S]*?<\/details>/,'');queueMicrotask(()=>document.querySelectorAll('.aurum-settings-details').forEach(x=>{if(x.id!=='aurumDualSchedulerSettings'&&x.querySelector('summary strong')?.textContent?.trim()==='Otomatik Güncelleme Zamanlayıcısı')x.remove()}));return block()+healthBlock()+historyBlock()+out};fn.__dualOldScheduler=true;globalThis.settingsPage=fn}
 globalThis.AurumDualScheduler={add,remove,saveAll,reinstall:saveAll,defaults,report,log,notice,ensureNativeParity,exactSettings:()=>{const r=call('schedule_exact_settings');if(r==='OPENED')notice('info','Kesin alarm izin ekranı açıldı');else if(r==='OK')notice('success','Kesin alarm izni zaten açık');else notice('error','Kesin alarm izin ekranı açılamadı');setTimeout(report,300);return r}};
 globalThis.AurumReadOnlyHealth=Object.freeze({refresh:renderHealth,read:healthRead});
 globalThis.AurumSettingsHistory20={log,notice,render:renderHistory,clear:()=>cleanupHistory(true),cleanup:()=>cleanupHistory(false)};
 if(!globalThis.__aurumHistory20Bridged){
   globalThis.__aurumHistory20Bridged=true;
   const baseNotice=globalThis.showAurumNotice;
   if(typeof baseNotice==='function')globalThis.showAurumNotice=function(message,type='info',duration){
     try{notice(['success','warning','error','info'].includes(type)?type:'info',String(message||'').slice(0,400))}catch{}
     return baseNotice.apply(this,arguments)
   };
   const baseSystemLog=globalThis.log;
   if(typeof baseSystemLog==='function')globalThis.log=async function(level,message,meta){
     const type=String(level||'info').toLowerCase()==='error'?'error':String(level||'info').toLowerCase()==='warn'?'warning':String(level||'info').toLowerCase()==='success'?'success':'info';
     try{log(type,String(message||'').slice(0,400))}catch{}
     return baseSystemLog.apply(this,arguments)
   };
 }
 if(!globalThis.__aurumSystemLogConsole){globalThis.__aurumSystemLogConsole=true;for(const k of ['warn','error']){const old=console[k].bind(console);console[k]=(...a)=>{try{log(k==='error'?'error':'warning',a.map(v=>v instanceof Error?(v.message||String(v)):typeof v==='string'?v:JSON.stringify(v)).join(' ').slice(0,240))}catch{}return old(...a)}}}
 install();scheduleCleanup();setTimeout(()=>{install();try{ensureNativeParity('STARTUP')}catch{}},0);document.addEventListener('toggle',e=>{if(e.target?.id==='aurumDualSchedulerSettings'&&e.target.open)setTimeout(report,0);if(e.target?.id==='aurumReadOnlyHealth'&&e.target.open)setTimeout(renderHealth,0);if(e.target?.id==='aurumHistory20'&&e.target.open)setTimeout(renderHistory,0)},true);
})();