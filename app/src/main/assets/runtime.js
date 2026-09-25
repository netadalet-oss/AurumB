/* ===== clean runtime orchestration ===== */
'use strict';

const AURUM_RUNTIME_VERSION='3.1.0-r38-economic-purged';
const AURUM_APP_VERSION_CODE=123;
const AURUM_APP_VERSION_NAME='2.0.0-r38-separate-economic';
const AURUM_UPDATE_SCHEMA='aurum-update/v2';
const AURUM_UPDATE_SLOT_KEY='aurum.runtime.update.slot.v2';
const AURUM_UPDATE_PENDING_KEY='aurum.runtime.update.pending.v2';
const AURUM_UPDATE_HISTORY_KEY='aurum.runtime.update.history.v2';
const AURUM_UPDATE_LAST_ERROR_KEY='aurum.runtime.update.lastError.v2';
const AURUM_UPDATE_MAX_HISTORY=10;
/* NAV-STABILITY migration: APK-embedded runtime owns navigation on first launch of this build.
   User data and verified update history are preserved; only an active/pending runtime overlay is cleared once. */
try{
  const k='aurum.navStability.embeddedCore.v1';
  if(localStorage.getItem(k)!=='1'){
    localStorage.removeItem(AURUM_UPDATE_SLOT_KEY);
    localStorage.removeItem(AURUM_UPDATE_PENDING_KEY);
    localStorage.removeItem(AURUM_UPDATE_LAST_ERROR_KEY);
    localStorage.setItem(k,'1');
  }
}catch{}
const JOB_STATUS=Object.freeze({
  IDLE:'IDLE',SCHEDULED:'SCHEDULED',FETCHING_DATA:'FETCHING_DATA',DATA_COMPLETED:'DATA_COMPLETED',
  KN_RUNNING:'KN_RUNNING',KN_COMPLETED:'KN_COMPLETED',K_TARIHSEL_RUNNING:'K_TARIHSEL_RUNNING',
  K_TARIHSEL_COMPLETED:'K_TARIHSEL_COMPLETED',S_RUNNING:'S_RUNNING',COMPLETED:'COMPLETED',FAILED:'FAILED',
  WAITING_FOR_NETWORK:'WAITING_FOR_NETWORK',RETRY_PENDING:'RETRY_PENDING',PAUSED:'PAUSED'
});
const LIVE_WINDOW_MS=60*60*1000;
const MARKET_SYNC_WINDOW_MS=30*60*1000;
const MARKET_RECOVERY_ROUNDS=3;
const JOB_MAX_AGE_MS=48*60*60*1000;
const MAX_JOB_RETRIES=3;
const SOURCE_TIMEOUT_DEFAULT=12000;
const RUNTIME_META_KEY='aurum.runtime.current.v1';
const MANUAL_SEQUENCE_KEY='aurum.runtime.manual.sequence.v1';
const HISTORY_LOCK_KEY='aurum.r27.kHistoricalLocked.v1';
const PAUSE_KEY='aurum.runtime.pause.v2';
const INSTALL_EPOCH_KEY='aurum.runtime.install.epoch.v2';
const HISTORY_30_LEGACY_KIND='BACKFILL_K_TARIHSEL_30D';
const HISTORY_VALUE_KIND='K_TARIHSEL_VALUE';
let TABLE_META={data:null,kn:null,history:null,s:null};
const TRANSIENT_HTTP=[408,425,429,500,502,503,504];
const CANCEL_KEY='aurum.runtime.cancel.v1';
const OP_ROLLBACK_KEY='aurum.runtime.rollback.v1';
const SYMBOL_REPAIR_ROUNDS=2;

function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=e=>{const db=e.target.result;const keyed={settings:'key',records:'key',meta:'key',backtests:'key',behaviorProfiles:'key',jobs:'id',stagingRecords:'id',dataIssues:'id',sourceHealth:'key'};['settings','records','runs','logs','meta','bars','actions','criteria','backtests','snapshots','behaviorProfiles','genomeHistory','aiAudits','aiCandidates','aiEvents','universeHistory','jobs','stagingRecords','dataIssues','sourceHealth'].forEach(name=>{if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:keyed[name]||'id'});});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});}

function parseJSON(raw,fallback=null){try{return typeof raw==='string'?JSON.parse(raw):raw??fallback}catch{return fallback}}
function writeLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch{return false}}
function readLocal(key,fallback=null){try{const v=JSON.parse(localStorage.getItem(key)||'null');return v??fallback}catch{return fallback}}
function validNumber(v){if(v===null||v===undefined)return null;if(typeof v==='string'&&!v.trim())return null;const n=Number(v);return Number.isFinite(n)?n:null}
function sourceName(code){return ({ISYATIRIM:'İş Yatırım',ISYATIRIM_FINANCIALS:'İş Yatırım Mali Tablo',ISYATIRIM_LIVE:'İş Yatırım Canlı',YAHOO:'Yahoo Tarihsel',YAHOO_ALT:'Yahoo Alternatif Uç',YAHOO_QUOTE:'Yahoo Anlık/Temel',BIGPARA:'Bigpara Tarihsel',BIGPARA_LIVE:'Bigpara Canlı',FOREKS:'Foreks/ParaGaranti Açık Veri',STOOQ:'Stooq',LOCAL_PREVIOUS:'Önceki Doğrulanmış Veri'}[code]||code)}
function normalizeMode(v){const x=String(v||'GENERAL').toUpperCase();return ['GENERAL','REPAIR','LIVE','FULL','FORCE_ALL'].includes(x)?x:'GENERAL'}
function makeId(prefix='JOB'){return `${prefix}|${Date.now().toString(36)}|${Math.random().toString(36).slice(2,9)}`}
function isOnline(){return typeof navigator==='undefined'||navigator.onLine!==false}
function currentRuntime(){return readLocal(RUNTIME_META_KEY,{status:JOB_STATUS.IDLE,jobId:null,mode:null,stage:null,done:0,total:0,message:'Hazır'});}
function setRuntime(patch){const next={...currentRuntime(),...patch,updatedAt:nowISO()};writeLocal(RUNTIME_META_KEY,next);updateLiveStatus(next);return next;}
const OPERATION_SCOPE_STAGE=Object.freeze({data:'Veriler',kn:'Kn',history:'K_Tarihsel',s:'S'});
function operationStage(scope){return OPERATION_SCOPE_STAGE[String(scope||'')]||String(scope||'');}
function operationBusyStatus(status){return !['IDLE','COMPLETED','FAILED','DATA_COMPLETED','KN_COMPLETED','K_TARIHSEL_COMPLETED'].includes(String(status||''));}
function operationView(scope,rt=currentRuntime()){
  const expected=operationStage(scope),active=String(rt.stage||'')===expected,done=active?Number(rt.done||0):0,total=active?Number(rt.total||0):0,p=active&&total?Math.max(0,Math.min(100,Math.round(100*done/total))):0,pause=pauseState(),paused=active&&pause.requested&&pause.jobId===rt.jobId,busy=active&&operationBusyStatus(rt.status)&&!!rt.jobId;
  const validated=active?Number(rt.validated||0):0,failed=active?Number(rt.failed||0):0;
  let label='Hazır';
  if(active){
    const tail=String(rt.message||'').trim();
    if(rt.status===JOB_STATUS.PAUSED)label='Duraklatıldı';
    else label=tail||({DATA_COMPLETED:'Tamamlandı',KN_COMPLETED:'Tamamlandı',K_TARIHSEL_COMPLETED:'Tamamlandı',COMPLETED:'Tamamlandı',FAILED:`${rt.stage||'İşlem'} · ${rt.error||tail||'başarısız'}`,WAITING_FOR_NETWORK:'Ağ bekleniyor',RETRY_PENDING:'Yeniden denenecek'}[rt.status]||'Hazır');
  }
  const count=active&&total?(scope==='data'?`${done}/${total} denendi · ${validated} doğrulandı${failed?` · ${failed} başarısız`:''}`:`${done}/${total}`):'';
  return {active,busy,done,total,p,label,count,validated,failed,paused,jobId:active?rt.jobId:null};
}
function applyOperationStrip(strip,rt=currentRuntime()){
  const v=operationView(strip?.dataset?.operationScope||'',rt);if(!strip)return v;
  strip.dataset.active=v.active?'true':'false';strip.dataset.busy=v.busy?'true':'false';strip.dataset.paused=v.paused?'true':'false';
  const label=strip.querySelector('[data-aurum-runtime-label]');if(label)label.textContent=v.label;
  const count=strip.querySelector('[data-aurum-operation-count]');if(count)count.textContent=v.count;
  const pct=strip.querySelector('[data-aurum-operation-percent]');if(pct)pct.textContent=v.active&&v.total?`${v.p}%`:'';
  const fill=strip.querySelector('[data-aurum-progress-fill]');if(fill)fill.style.width=`${v.p}%`;
  const btn=strip.querySelector('[data-aurum-pause-toggle]');if(btn){btn.dataset.controlState=v.paused?'play':'pause';btn.title=v.paused?'İşleme devam et':'İşlemi güvenli noktada duraklat';btn.disabled=!v.busy;btn.setAttribute('aria-label',btn.title);}
  return v;
}
function updateLiveStatus(rt=currentRuntime()){
  document.querySelectorAll('.aurum-operation-strip[data-operation-scope]').forEach(strip=>applyOperationStrip(strip,rt));
  const busy=operationBusyStatus(rt.status);
  const badge=document.getElementById('dataBadge');if(badge){badge.textContent=busy?'İŞLEM SÜRÜYOR':state?.records?.length?'DOĞRULANMIŞ YEREL':'VERİ YOK';badge.className=`badge ${busy?'warn':state?.records?.length?'ok':'bad'}`;}
  const global=document.getElementById('refreshBtn');if(global)global.textContent=globalOperationLabel();
}


function pauseState(){return readLocal(PAUSE_KEY,{requested:false,jobId:null,requestedAt:null});}
function pauseRequested(job){const p=pauseState();return Boolean(job&&p.requested&&p.jobId===job.id);}
async function togglePause(scope=null){const rt=currentRuntime(),v=scope?operationView(scope,rt):{busy:operationBusyStatus(rt.status)&&!!rt.jobId,jobId:rt.jobId};if(!v.busy||!rt.jobId)return false;const p=pauseState(),requested=!(p.requested&&p.jobId===rt.jobId);writeLocal(PAUSE_KEY,{requested,jobId:rt.jobId,requestedAt:requested?nowISO():null});updateLiveStatus();return requested;}
async function pauseCheckpoint(job,resumeStatus){if(!job)return;if(cancelRequested(job))throw Object.assign(new Error('İşlem kullanıcı tarafından iptal edildi'),{code:'OPERATION_CANCELLED'});let announced=false;while(pauseRequested(job)){if(!announced){job.pausedFrom=resumeStatus;await transition(job,JOB_STATUS.PAUSED,{message:'Duraklatıldı · devam komutu bekleniyor'});announced=true;}await sleep(250);if(cancelRequested(job))throw Object.assign(new Error('İşlem kullanıcı tarafından iptal edildi'),{code:'OPERATION_CANCELLED'});}if(cancelRequested(job))throw Object.assign(new Error('İşlem kullanıcı tarafından iptal edildi'),{code:'OPERATION_CANCELLED'});if(announced){job.pausedFrom=null;await transition(job,resumeStatus,{message:'Devam ediyor'});}}
function safeTime(value){const t=typeof value==='number'?value:Date.parse(value||'');return Number.isFinite(t)?t:null;}
function verifiedMarketEpoch(records=state.records){const xs=[];for(const r of records||[]){if(r?.marketTimeVerified!==true&&r?.provenance?.marketTimeVerified!==true)continue;const t=safeTime(r?.marketDataAt||r?.liveAt||r?.provenance?.marketAt);if(t!=null)xs.push(t);}return xs.length?Math.max(...xs):null;}
function externalMarketTime(rec){if(!rec||rec.marketTimeVerified!==true)return null;const provider=String(rec.marketTimeProvider||rec?.provenance?.marketTimeProvider||'').toUpperCase();if(!provider||provider==='LOCAL_PREVIOUS')return null;const t=safeTime(rec.marketDataAt||rec?.provenance?.marketAt);return t==null?null:t;}
function marketWindowCheck(rec,canonicalAt){const c=safeTime(canonicalAt),t=externalMarketTime(rec),maxMinutes=Math.max(30,Math.min(180,Number(state.settings?.marketFreshMinutes||90)));if(c==null)return {ok:false,reason:'CANONICAL_MARKET_TIME_UNAVAILABLE',deltaMinutes:null,sameTradingDay:false};if(t==null)return {ok:false,reason:'SOURCE_MARKET_TIME_UNVERIFIED',deltaMinutes:null,sameTradingDay:false};const delta=Math.abs(c-t)/60000,day=x=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x))}catch{return new Date(x).toISOString().slice(0,10)}},sameTradingDay=day(c)===day(t),ok=delta<=maxMinutes;return {ok,reason:ok?null:(sameTradingDay?`SAME_TRADING_DAY_OUTSIDE_${maxMinutes}M`:`MARKET_TIME_OUTSIDE_${maxMinutes}M`),deltaMinutes:delta,sameTradingDay,marketAt:new Date(t).toISOString(),canonicalAt:new Date(c).toISOString()};}
function stableScalar(v){if(v==null||v==='')return '';if(typeof v==='number')return Number.isFinite(v)?String(Math.round(v*1e8)/1e8):'';if(typeof v==='boolean')return v?'1':'0';if(Array.isArray(v))return v.map(stableScalar).join(',');if(typeof v==='object')return Object.keys(v).sort().map(k=>`${k}:${stableScalar(v[k])}`).join('|');return String(v);}
function rollingFingerprint(parts){let h1=0x811c9dc5,h2=0x9e3779b9;for(const part of parts){const x=String(part);for(let i=0;i<x.length;i++){const c=x.charCodeAt(i);h1^=c;h1=Math.imul(h1,0x01000193)>>>0;h2=(Math.imul(h2^c,0x85ebca6b)+0xc2b2ae35)>>>0;}}return `${h1.toString(16).padStart(8,'0')}${h2.toString(16).padStart(8,'0')}`;}
function dataTableFingerprint(records=state.records){const rows=(records||[]).slice().sort((a,b)=>String(a?.sym||'').localeCompare(String(b?.sym||''))),parts=[];for(const r of rows){parts.push(r?.sym||'');for(const k of V141225_ALL_HEADERS)parts.push(k,stableScalar(v141225Raw(r,k,true)));}return rollingFingerprint(parts);}
function dataRecordFingerprint(r){const parts=[r?.sym||''];for(const k of V141225_ALL_HEADERS)parts.push(k,stableScalar(v141225Raw(r,k,true)));return rollingFingerprint(parts);}
function knTableFingerprint(){const parts=[];for(const k of CRITERIA){parts.push(k);for(const x of state.scores?.[k]||[])parts.push(x.sym,stableScalar(x.score));}return rollingFingerprint(parts);}
function historyTableFingerprint(){const rows=(state.runs||[]).filter(r=>/K_TARIHSEL|BACKFILL_K_TARIHSEL_30D/.test(String(r?.kind||''))).slice().sort((a,b)=>String(a?.signalTradingDate||a?.createdAt||'').localeCompare(String(b?.signalTradingDate||b?.createdAt||''))),parts=[];for(const r of rows){parts.push(r.kind||'',r.signalTradingDate||'',stableScalar(r.evaluated),stableScalar(r.metrics||{}));for(const x of r.selection||[])parts.push(x.sym,stableScalar(x.score??x.totalScore),stableScalar(x.targetProbability),stableScalar(x.dualHit),stableScalar(x.realizedReturn));}return rollingFingerprint(parts);}
function selectionTableFingerprint(){const parts=[];for(const x of state.selection||[])parts.push(x.sym,stableScalar(x.totalScore),stableScalar(x.targetProbability),stableScalar(x.entryStatus),stableScalar(x.entryPrice),stableScalar(x.livePrice),stableScalar(x.currentReturn),stableScalar(x.maxPotential));return rollingFingerprint(parts);}
function formatTableTime(value){const t=safeTime(value);if(!Number.isFinite(t))return '—';return new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(t));}
async function refreshTableMeta(){const [active,kn,historical,selection,lastSummary,persistedTimes]=await Promise.all([dbGet('meta','activeDataSnapshot'),dbGet('meta','knSnapshot'),dbGet('meta','historicalSnapshot'),dbGet('meta','selectionSnapshot'),dbGet('meta','lastDataSummary'),dbGet('meta','lastValidTableTimes')]);const a=active?.value||{},sv=selection?.value||{},lastValid=persistedTimes?.value||{};state.tableMetrics=state.tableMetrics||{};state.tableMetrics.s={...(state.tableMetrics.s||{}),gln:Array.isArray(sv.gln)?sv.gln.join(' · '):(sv.gln??null),gdn:Array.isArray(sv.gdn)?sv.gdn.join(' · '):(sv.gdn??null),glnChangedAt:sv.glnChangedAt||null,gdnChangedAt:sv.gdnChangedAt||null};let market=a.marketAt||null;if(!market){const stored=verifiedMarketEpoch(state.records);if(stored!=null){market=new Date(stored).toISOString();/* Upgrade migration: only already-stored, source-verified time is recovered. No app-open network request is made. */if(active?.value){a.marketAt=market;a.marketTimeBasis='SOURCE_REPORTED_VERIFIED_RECOVERED';try{await dbPut('meta',{key:'activeDataSnapshot',value:a,updatedAt:nowISO()})}catch{}}}}const dataTransfer=a.transferredAt||a.completedAt||state.lastSuccessfulSync||null;const candidate={data:{market,transfer:dataTransfer,changed:a.changedAt||dataTransfer,summary:lastSummary?.value||dataSummary(),excludedSymbols:a.excludedSymbols||[]},kn:{market,transfer:kn?.value?.transferredAt||kn?.value?.at||null,changed:kn?.value?.changedAt||kn?.value?.transferredAt||kn?.value?.at||null},history:{market,transfer:historical?.value?.transferredAt||historical?.value?.at||null,changed:historical?.value?.changedAt||historical?.value?.transferredAt||historical?.value?.at||null},s:{market,transfer:selection?.value?.transferredAt||selection?.value?.at||null,changed:selection?.value?.changedAt||selection?.value?.transferredAt||selection?.value?.at||null}};const keep=(kind,key,value)=>Number.isFinite(safeTime(value))?value:(lastValid?.[kind]?.[key]||TABLE_META?.[kind]?.[key]||null);TABLE_META={data:{...candidate.data,market:keep('data','market',candidate.data.market),transfer:keep('data','transfer',candidate.data.transfer),changed:keep('data','changed',candidate.data.changed)},kn:{...candidate.kn,market:keep('kn','market',candidate.kn.market),transfer:keep('kn','transfer',candidate.kn.transfer),changed:keep('kn','changed',candidate.kn.changed)},history:{...candidate.history,market:keep('history','market',candidate.history.market),transfer:keep('history','transfer',candidate.history.transfer),changed:keep('history','changed',candidate.history.changed)},s:{...candidate.s,market:keep('s','market',candidate.s.market),transfer:keep('s','transfer',candidate.s.transfer),changed:keep('s','changed',candidate.s.changed)}};const durable={data:{market:TABLE_META.data.market,transfer:TABLE_META.data.transfer,changed:TABLE_META.data.changed},kn:{market:TABLE_META.kn.market,transfer:TABLE_META.kn.transfer,changed:TABLE_META.kn.changed},history:{market:TABLE_META.history.market,transfer:TABLE_META.history.transfer,changed:TABLE_META.history.changed},s:{market:TABLE_META.s.market,transfer:TABLE_META.s.transfer,changed:TABLE_META.s.changed},updatedAt:nowISO()};try{await dbPut('meta',{key:'lastValidTableTimes',value:durable,updatedAt:nowISO()})}catch{}return TABLE_META;}
function pageMetaKind(){return state.page==='data'?'data':state.page==='criteria'?'kn':state.page==='history'?'history':state.page==='selection'?'s':'data';}
function tableTimePanel(kind=pageMetaKind()){const m=TABLE_META[kind]||{};return `<div class="aurum-time-card" data-aurum-time-kind="${html(kind)}"><div class="aurum-time-row"><span>Piyasa gerçek veri zamanı</span><b>${html(formatTableTime(m.market))}</b></div><div class="aurum-time-row"><span>Güncelleme zamanı</span><b>${html(formatTableTime(m.transfer))}</b></div><div class="aurum-time-row"><span>Tabloda son değişiklik zamanı</span><b>${html(formatTableTime(m.changed))}</b></div></div>`;}
function operationStrip(scope){const v=operationView(scope),pct=v.active&&v.total?`${v.p}%`:'';return `<div class="aurum-operation-strip" data-operation-scope="${html(scope)}" data-active="${v.active?'true':'false'}" data-busy="${v.busy?'true':'false'}" data-paused="${v.paused?'true':'false'}"><div class="aurum-operation-copy"><div class="aurum-operation-caption"><i class="aurum-operation-indicator" aria-hidden="true"></i><small data-aurum-runtime-label>${html(v.label)}</small><span data-aurum-operation-count>${html(v.count)}</span><b data-aurum-operation-percent>${html(pct)}</b></div><div class="aurum-progress-track" aria-hidden="true"><i data-aurum-progress-fill style="width:${v.p}%"></i></div></div><button class="aurum-pause-toggle" data-aurum-pause-toggle onclick="AurumRuntime.togglePause('${html(scope)}')" ${v.busy?'':'disabled'} title="${v.paused?'İşleme devam et':'İşlemi güvenli noktada duraklat'}" aria-label="${v.paused?'İşleme devam et':'İşlemi güvenli noktada duraklat'}" data-control-state="${v.paused?'play':'pause'}"></button></div>`;}
function operationActionZone(scope,buttons){return `<div class="aurum-action-zone"><div class="card aurum-fixed-actions aurum-compact-actions"><div class="actions">${buttons}</div></div>${operationStrip(scope)}</div>`;}
function operationMiniControls(scope){const s=String(scope||'data');return `<div class="aurum-mini-ops" data-mini-scope="${html(s)}"><button type="button" onclick="AurumRuntime.command('${html(s)}','restart')"><i>↺</i><span>Baştan başlat</span></button><button type="button" onclick="AurumRuntime.command('${html(s)}','repair')"><i>＋</i><span>Eksikleri tamamla</span></button><button type="button" onclick="AurumRuntime.command('${html(s)}','cancel')"><i>×</i><span>İptal</span></button><button type="button" onclick="AurumRuntime.command('${html(s)}','clear')"><i>⌫</i><span>Temizle</span></button></div>`;}
function operationBlock(scope,buttons){return `${operationActionZone(scope,buttons)}${operationMiniControls(scope)}`;}
function cancelState(){return readLocal(CANCEL_KEY,{requested:false,jobId:null,at:null});}
function cancelRequested(job){const c=cancelState();return !!(job&&(HARD_CANCELLED_JOBS?.has?.(String(job.id))||(c.requested&&c.jobId===job.id)));}
function clearCancel(jobId=null){const c=cancelState(),id=jobId||c?.jobId||null,rt=currentRuntime();if(id&&HARD_CANCELLED_JOBS?.has?.(String(id))&&rt?.jobId===id&&operationBusyStatus(rt.status))return false;if(id)HARD_CANCELLED_JOBS?.delete?.(String(id));if(!jobId||c.jobId===jobId)writeLocal(CANCEL_KEY,{requested:false,jobId:null,at:null});return true;}

function decorateTableTimePanels(){const kind=pageMetaKind();document.querySelectorAll('.table-wrap').forEach(w=>{if(w.closest('[data-aurum-explicit-time]'))return;if(w.previousElementSibling?.classList?.contains('aurum-time-card'))return;w.insertAdjacentHTML('beforebegin',tableTimePanel(kind));});}

const SOURCE_HEALTH_CACHE=new Map(),SOURCE_HEALTH_DIRTY=new Map(),PROVIDER_LIMIT_STATE=new Map();
async function sourceHealth(code){const k=String(code);if(SOURCE_HEALTH_CACHE.has(k))return SOURCE_HEALTH_CACHE.get(k);const h=(await dbGet('sourceHealth',k))||{key:k,success:0,failed:0,avgLatencyMs:null,rateLimitedUntil:0,circuitUntil:0,stale:0,lastSuccessAt:null,lastFailureAt:null};SOURCE_HEALTH_CACHE.set(k,h);return h;}
async function flushSourceHealth(code,force=false){const k=String(code),n=SOURCE_HEALTH_DIRTY.get(k)||0,threshold=Math.max(1,Math.min(100,Number(state.settings?.sourceHealthFlushEvery||8)));if(!force&&n<threshold)return;const h=SOURCE_HEALTH_CACHE.get(k);if(h){await dbPut('sourceHealth',h);SOURCE_HEALTH_DIRTY.set(k,0);}}
function baseProviderLimit(code){const configured=Number(state.settings?.providerConcurrency?.[code]);if(Number.isFinite(configured)&&configured>0)return Math.max(1,Math.min(24,configured));if(code==='ISYATIRIM')return 8;if(code==='ISYATIRIM_FINANCIALS')return 6;if(code==='KAP')return 4;if(code==='YAHOO'||code==='YAHOO_ALT'||code==='YAHOO_QUOTE')return 16;if(code==='TRADINGVIEW')return 8;if(code==='BIGPARA'||code==='BIGPARA_LIVE')return 8;if(code==='FOREKS'||code==='STOOQ')return 8;return 6;}
async function providerConcurrencyLimit(code){const base=baseProviderLimit(code);if(state.settings?.providerHealthAdaptive===false)return base;const h=await sourceHealth(code),total=(h.success||0)+(h.failed||0),err=total?(h.failed||0)/total:0;if((h.rateLimitedUntil||0)>Date.now())return 1;if(err>.45)return 1;if(err>.25)return Math.max(1,Math.floor(base/2));return base;}
async function withProviderSlot(code,fn){const k=String(code),s=PROVIDER_LIMIT_STATE.get(k)||{active:0,queue:[]};PROVIDER_LIMIT_STATE.set(k,s);const limit=await providerConcurrencyLimit(k);if(s.active>=limit)await new Promise(resolve=>s.queue.push(resolve));s.active++;try{return await fn();}finally{s.active--;const next=s.queue.shift();if(next)next();}}
function adaptiveWorkerCount(total=1){const configured=Math.max(1,Number(state.settings?.concurrency||28)),maxGlobal=Math.max(1,Math.min(32,Number(state.settings?.maxGlobalConcurrency||32)));if(state.settings?.adaptiveConcurrency===false)return Math.max(1,Math.min(total,configured,maxGlobal));const hc=Math.max(2,Number(navigator?.hardwareConcurrency||4)),network=String(navigator?.connection?.effectiveType||'');let cap=Math.min(maxGlobal,configured,Math.max(12,Math.floor(hc*4)));if(/2g/.test(network))cap=Math.min(cap,4);else if(/3g/.test(network))cap=Math.min(cap,10);return Math.max(1,Math.min(total,cap));}
async function updateSourceHealth(code,{ok,latencyMs,status,stale=false,error=null}={}){const h=await sourceHealth(code),failGate=Math.max(1,Math.min(20,Number(state.settings?.circuitBreakerFailures||3))),rateCooldown=Math.max(1000,Math.min(900000,Number(state.settings?.rateLimitCooldownMs||60000))),circuitBase=Math.max(1000,Math.min(900000,Number(state.settings?.circuitBreakerCooldownMs||30000)));if(ok){h.success=(h.success||0)+1;h.lastSuccessAt=nowISO();if(stale)h.stale=(h.stale||0)+1;}else{h.failed=(h.failed||0)+1;h.lastFailureAt=nowISO();h.lastError=String(error||'');if(status===429)h.rateLimitedUntil=Date.now()+rateCooldown;if((h.failed||0)>=failGate&&(h.failed||0)>(h.success||0)*.5)h.circuitUntil=Date.now()+Math.min(10*60*1000,circuitBase*Math.max(1,Math.ceil((h.failed||1)/failGate)));}if(Number.isFinite(latencyMs))h.avgLatencyMs=h.avgLatencyMs==null?latencyMs:(.8*h.avgLatencyMs+.2*latencyMs);h.updatedAt=nowISO();SOURCE_HEALTH_CACHE.set(String(code),h);SOURCE_HEALTH_DIRTY.set(String(code),(SOURCE_HEALTH_DIRTY.get(String(code))||0)+1);await flushSourceHealth(code,status===429||(!ok&&(h.failed||0)%Math.max(2,failGate)===0));return h;}
function providerScore(h,baseRank){const total=(h.success||0)+(h.failed||0),rate=total?(h.success||0)/total:.75,lat=Number(h.avgLatencyMs||1500),stalePenalty=total?(h.stale||0)/total:0,circuit=(h.circuitUntil||0)>Date.now()?1000:0,rateLimit=(h.rateLimitedUntil||0)>Date.now()?500:0;return baseRank*10+(1-rate)*35+Math.min(20,lat/1000)+stalePenalty*20+circuit+rateLimit;}
async function providerOrder(liveOnly=false){
  const base=['ISYATIRIM','ISYATIRIM_FINANCIALS','YAHOO','BIGPARA','BIGPARA_LIVE','YAHOO_ALT','FOREKS','STOOQ','ISYATIRIM_LIVE','YAHOO_QUOTE'],configured=(state.settings?.providerOrder||[]).map(x=>String(x).toUpperCase()),all=[...new Set([...base,...configured])],contentRank=new Map(base.map((c,i)=>[c,i])),allowed=liveOnly?new Set(['ISYATIRIM_LIVE','YAHOO','YAHOO_ALT','YAHOO_QUOTE','BIGPARA','BIGPARA_LIVE']):null,scored=[];
  for(let i=0;i<all.length;i++){const c=all[i];if(allowed&&!allowed.has(c))continue;const h=await sourceHealth(c);if((h.circuitUntil||0)>Date.now())continue;const rank=contentRank.has(c)?contentRank.get(c):base.length+i;scored.push({code:c,score:providerScore(h,rank)});}
  return scored.sort((a,b)=>a.score-b.score||a.code.localeCompare(b.code)).map(x=>x.code);
}

function providerCodeForRequest(url,label=''){const x=String(label||'').toLocaleUpperCase('tr-TR');if(x.includes('CANLI')&&x.includes('YATIRIM'))return 'ISYATIRIM_LIVE';if(x.includes('YATIRIM')&&(x.includes('MALI')||x.includes('MALİ')||x.includes('FINANS')))return 'ISYATIRIM_FINANCIALS';if(x.includes('YATIRIM'))return 'ISYATIRIM';if(x.includes('YAHOO')&&x.includes('QUOTE'))return 'YAHOO_QUOTE';if(x.includes('YAHOO')&&x.includes('ALTERNAT'))return 'YAHOO_ALT';if(x.includes('YAHOO'))return 'YAHOO';if(x.includes('BIGPARA')&&x.includes('CANLI'))return 'BIGPARA_LIVE';if(x.includes('BIGPARA'))return 'BIGPARA';if(x.includes('FOREKS')||x.includes('PARAGARANTI'))return 'FOREKS';if(x.includes('STOOQ'))return 'STOOQ';try{const h=new URL(url).hostname.toLowerCase();if(h.includes('isyatirim'))return 'ISYATIRIM';if(h.includes('query1.finance.yahoo.com'))return 'YAHOO';if(h.includes('query2.finance.yahoo.com'))return 'YAHOO_ALT';if(h.includes('bigpara'))return 'BIGPARA';if(h.includes('foreks.com'))return 'FOREKS';if(h.includes('stooq'))return 'STOOQ';if(h.includes('evds2.tcmb.gov.tr'))return 'TCMB_EVDS';if(h.includes('kap.org.tr'))return 'KAP';}catch{}return x.replace(/[^A-Z0-9_]+/g,'_')||'HTTP'}
async function fetchWithTimeout(url,opts={},timeoutOrLabel=state.settings?.requestTimeoutMs||SOURCE_TIMEOUT_DEFAULT){const label=typeof timeoutOrLabel==='string'?timeoutOrLabel:opts.__provider,timeout=typeof timeoutOrLabel==='number'?timeoutOrLabel:(Number(opts.__timeout)||state.settings?.requestTimeoutMs||SOURCE_TIMEOUT_DEFAULT),maxRetries=Math.max(0,Math.min(6,Number(state.settings?.sourceRetryCount??0))),max429=Math.max(0,Math.min(6,Number(state.settings?.maxProvider429Retries??3))),baseBackoff=Math.max(100,Math.min(10000,Number(state.settings?.retryBackoffBaseMs||600))),maxBackoff=Math.max(baseBackoff,Math.min(60000,Number(state.settings?.retryBackoffMaxMs||15000))),provider=providerCodeForRequest(url,label);let last,rateRetries=0;for(let attempt=0;attempt<=maxRetries;attempt++){if(cancelState()?.requested)throw Object.assign(new Error('İşlem kullanıcı tarafından iptal edildi'),{code:'OPERATION_CANCELLED'});const h=await sourceHealth(provider);if((h.circuitUntil||0)>Date.now())throw Object.assign(new Error(`${provider}: circuit breaker açık`),{code:'CIRCUIT_OPEN'});if((h.rateLimitedUntil||0)>Date.now())await sleep(Math.min(5000,(h.rateLimitedUntil||0)-Date.now()));const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),Number(timeout)||SOURCE_TIMEOUT_DEFAULT),started=performance.now();state.activeControllers.add(ctrl);try{const clean={...opts};delete clean.__provider;delete clean.__timeout;const requestInit={...clean,signal:ctrl.signal};const res=globalThis.AurumNativeHTTP?.canHandle?.(url)?await globalThis.AurumNativeHTTP.request(url,requestInit,Number(timeout)||SOURCE_TIMEOUT_DEFAULT):await fetch(url,requestInit);const latency=performance.now()-started;if(res.ok){await updateSourceHealth(provider,{ok:true,latencyMs:latency,status:res.status});return res;}const retryable=TRANSIENT_HTTP.includes(res.status);await updateSourceHealth(provider,{ok:false,latencyMs:latency,status:res.status,error:`HTTP_${res.status}`});if(res.status===429&&++rateRetries>max429)return res;if(!retryable||attempt>=maxRetries)return res;const ra=Number(res.headers?.get?.('retry-after')),wait=Number.isFinite(ra)?Math.min(maxBackoff,ra*1000):Math.min(maxBackoff,baseBackoff*2**attempt+Math.random()*250);await sleep(wait);if(cancelState()?.requested)throw Object.assign(new Error('İşlem kullanıcı tarafından iptal edildi'),{code:'OPERATION_CANCELLED'});}catch(e){last=e;if(cancelState()?.requested||e?.code==='OPERATION_CANCELLED')throw Object.assign(new Error('İşlem kullanıcı tarafından iptal edildi'),{code:'OPERATION_CANCELLED'});await updateSourceHealth(provider,{ok:false,latencyMs:performance.now()-started,error:e?.message||e});if(attempt>=maxRetries)throw e;await sleep(Math.min(maxBackoff,baseBackoff*2**attempt+Math.random()*250));if(cancelState()?.requested)throw Object.assign(new Error('İşlem kullanıcı tarafından iptal edildi'),{code:'OPERATION_CANCELLED'});}finally{clearTimeout(timer);state.activeControllers.delete(ctrl)}}throw last||new Error('İstek başarısız');}
function validateBar(bar){const o=validNumber(bar?.open),h=validNumber(bar?.high),l=validNumber(bar?.low),c=validNumber(bar?.close),v=validNumber(bar?.volume);if(!bar?.date||c==null||h==null||l==null)return {ok:false,reason:'BAR_REQUIRED_FIELDS'};if(l>h||c<0||h<0||l<0||(o!=null&&(o<0||o>h*5)))return {ok:false,reason:'BAR_RANGE'};if(v!=null&&v<0)return {ok:false,reason:'NEGATIVE_VOLUME'};return {ok:true};}
function chooseValue(candidates){return candidates.filter(x=>x&&x.value!=null&&Number.isFinite(Number(x.value))).sort((a,b)=>a.rank-b.rank||String(b.receivedAt||'').localeCompare(String(a.receivedAt||'')))[0]||null;}
const FUNDAMENTAL_ZERO_IS_MISSING=new Set(['marketCap','capital','enterpriseValue','ebitda','pe','pb','evEbitda','roe','freeFloat','priceBandPct']);
function validFundamentalCandidate(field,value){const n=validNumber(value);if(n==null)return null;if(FUNDAMENTAL_ZERO_IS_MISSING.has(field)&&n===0)return null;if(['marketCap','capital','pe','pb','freeFloat','priceBandPct'].includes(field)&&n<0)return null;return n;}
function mergeBundles(sym,bundles){
  const usable=(bundles||[]).filter(Boolean).slice().sort((a,b)=>(String(a?.provider)==='LOCAL_PREVIOUS'?1:0)-(String(b?.provider)==='LOCAL_PREVIOUS'?1:0)),rankMap=new Map(usable.map((b,i)=>[String(b.provider||`SRC${i}`),i]));
  const byDate=new Map(),conflicts=[],quarantined=[];
  for(const b of usable){const code=String(b.provider||'UNKNOWN'),rank=rankMap.get(code)??99;for(const raw of b.bars||[]){const bar={...raw,source:raw.source||code};const chk=validateBar(bar);if(!chk.ok){quarantined.push({provider:code,date:bar.date,reason:chk.reason});continue;}if(!byDate.has(bar.date))byDate.set(bar.date,[]);byDate.get(bar.date).push({bar,code,rank,receivedAt:b.receivedAt||b.requestedAt||null});}}
  const bars=[];
  for(const date of [...byDate.keys()].sort()){
    const rows=byDate.get(date).sort((a,b)=>a.rank-b.rank||String(b.receivedAt||'').localeCompare(String(a.receivedAt||''))),primary=rows[0],out={date,open:primary.bar.open??null,high:primary.bar.high,low:primary.bar.low,close:primary.bar.close,adjustedClose:primary.bar.adjustedClose??null,volume:primary.bar.volume??null,tradeCount:primary.bar.tradeCount??null,vwap:primary.bar.vwap??null,usdAof:primary.bar.usdAof??null,indexAof:primary.bar.indexAof??null,source:primary.code,sources:{}};
    for(const field of ['open','high','low','close','adjustedClose','volume','tradeCount','vwap','usdAof','indexAof']){const selected=chooseValue(rows.map(r=>({value:r.bar[field],rank:r.rank,receivedAt:r.receivedAt,code:r.code})));if(selected){out[field]=Number(selected.value);out.sources[field]=selected.code;}}
    if(out.low>out.high||out.close<out.low*.75||out.close>out.high*1.25){quarantined.push({date,reason:'MERGED_OHLC_INTEGRITY'});continue;}
    const closeVals=rows.map(r=>validNumber(r.bar.close)).filter(Number.isFinite);if(closeVals.length>1){const lo=Math.min(...closeVals),hi=Math.max(...closeVals);if(lo>0&&hi/lo>1.08)conflicts.push({date,field:'close',values:rows.map(r=>[r.code,r.bar.close])});}
    bars.push(out);
  }
  const fundamentals={},fundamentalSources={};
  const fields=['marketCap','capital','enterpriseValue','ebitda','pe','pb','evEbitda','roe','freeFloat','priceBandPct'];
  for(const field of fields){const c=[];usable.forEach((b,rank)=>{const value=validFundamentalCandidate(field,b.fundamentals?.[field]);if(value!=null){let effectiveRank=rank;if(field==='capital'){const p=String(b.provider||'');if(p==='ISYATIRIM_FINANCIALS'||p==='KAP')effectiveRank=-100;else if(p==='YAHOO'||p==='YAHOO_ALT'||p==='YAHOO_QUOTE'||p==='TRADINGVIEW')effectiveRank=100+rank;}c.push({value,rank:effectiveRank,receivedAt:b.receivedAt||b.requestedAt,code:b.provider});}});const nums=c.map(x=>Number(x.value)).filter(Number.isFinite);if(nums.length>1){const lo=Math.min(...nums),hi=Math.max(...nums);if(lo!==hi)conflicts.push({field,kind:'FUNDAMENTAL_SOURCE_MISMATCH',values:c.map(x=>[x.code,x.value])});}const chosen=chooseValue(c);if(chosen){fundamentals[field]=chosen.value;fundamentalSources[field]={source:chosen.code,receivedAt:chosen.receivedAt||null};}}
  const liveCandidates=[];usable.forEach((b,rank)=>{const p=validNumber(b.live?.price),rawAt=b.marketPoint?.at||b.live?.at||null,at=Date.parse(rawAt||'');if((p!=null||b.marketPoint?.at)&&Number.isFinite(at)&&(b.marketPoint?.timestampVerified===true||b.live?.timestampVerified===true))liveCandidates.push({price:p,at:new Date(at).toISOString(),ms:at,provider:b.marketPoint?.provider||b.live?.provider||b.provider,rank,timestampVerified:true});});
  liveCandidates.sort((a,b)=>b.ms-a.ms||a.rank-b.rank);const marketPoint=liveCandidates[0]?{at:liveCandidates[0].at,provider:liveCandidates[0].provider,timestampVerified:true}:null;const live=liveCandidates[0]&&liveCandidates[0].price!=null&&Date.now()-liveCandidates[0].ms<=LIVE_WINDOW_MS?{price:liveCandidates[0].price,at:liveCandidates[0].at,provider:liveCandidates[0].provider,timestampVerified:true}:null;
  const providers=[...new Set(usable.map(x=>String(x.provider||'UNKNOWN')))];const actions=[];for(const b of usable)for(const a of b.actions||[])if(!actions.some(x=>String(x.id||'')===String(a.id||'')))actions.push(a);
  return {provider:providers[0]||'NONE',symbol:sym,bars,fundamentals,fundamentalSources,live,marketPoint,actions,providers,conflicts,quarantinedBars:quarantined,mergePolicy:'DETERMINISTIC_FIELD_WITH_OHLC_PRIMARY',requestedAt:usable.map(x=>x.requestedAt).filter(Boolean).sort()[0]||null,receivedAt:usable.map(x=>x.receivedAt).filter(Boolean).sort().at(-1)||nowISO()};
}

function coverage(bundle){const b=bundle?.bars||[],n=b.length,f=bundle?.fundamentals||{};return {bars:n,open:n?b.filter(x=>validNumber(x.open)!=null&&Number(x.open)>0).length/n:0,volume:n?b.filter(x=>validNumber(x.volume)!=null&&Number(x.volume)>0).length/n:0,fund:['marketCap','capital','enterpriseValue','ebitda','pe','pb','evEbitda','roe','freeFloat'].filter(k=>validFundamentalCandidate(k,f[k])!=null).length,live:validNumber(bundle?.live?.price)!=null&&Number(bundle.live.price)>0};}
function needsMore(bundle,liveOnly=false){const c=coverage(bundle);if(liveOnly)return !c.live;const target=Math.max(120,Math.min(320,Math.round(Number(state.settings?.monthsBack||14)*21)));return c.bars<target||c.open<.80||c.volume<.80||c.fund<4||(state.settings?.liveEnabled!==false&&!c.live);}
async function invokeProvider(code,sym,start,end){
  if(code==='ISYATIRIM')return fetchIsYatirim(sym,start,end);
  if(code==='ISYATIRIM_FINANCIALS')return fetchIsYatirimFinancials(sym);
  if(code==='ISYATIRIM_LIVE')return {provider:'ISYATIRIM_LIVE',symbol:sym,bars:[],fundamentals:{},live:await fetchIsYatirimLive(sym),actions:[],requestedAt:nowISO(),receivedAt:nowISO()};
  if(code==='YAHOO')return fetchYahoo(sym,start,end);
  if(code==='YAHOO_ALT')return fetchYahooAlt(sym,start,end);
  if(code==='YAHOO_QUOTE')return fetchYahooQuote(sym);
  if(code==='BIGPARA')return fetchBigPara(sym,start,end);
  if(code==='BIGPARA_LIVE')return fetchBigParaLive(sym);
  if(code==='FOREKS')return fetchForeks(sym,start,end);
  if(code==='STOOQ')return fetchStooq(sym,start,end);
  const def=customProviders().find(x=>String(x.name||'CUSTOM').toUpperCase()===code);if(def)return fetchCustom(sym,start,end,def);
  throw new Error(`Bilinmeyen kaynak ${code}`);
}
async function fetchSymbolBundle(sym,start,end,options={}){
  const mode=normalizeMode(options.mode),liveOnly=mode==='LIVE',forceAll=mode==='FORCE_ALL',richTargeted=!liveOnly&&state.settings?.richParallelAllProviders!==false,explicitProviders=Array.isArray(options.providers)&&options.providers.length,
    bundles=options.baseBundle?[options.baseBundle]:[],attempts=[],onSource=typeof options.onSource==='function'?options.onSource:null;
  let merged=mergeBundles(sym,bundles),order=explicitProviders?[...new Set(options.providers.map(x=>String(x).toUpperCase()))]:await providerOrder(liveOnly);
  if((forceAll||richTargeted)&&!liveOnly&&!explicitProviders&&!order.includes('ISYATIRIM_FINANCIALS'))order.splice(Math.min(1,order.length),0,'ISYATIRIM_FINANCIALS');
  if(!explicitProviders)for(const def of customProviders())if(!order.includes(String(def.name||'CUSTOM').toUpperCase()))order.push(String(def.name||'CUSTOM').toUpperCase());
  const waveSize=Math.max(1,Math.min(12,Number(state.settings?.providerWaveSize||12)));
  const attempted=new Set();
  const fetchOne=async code=>{attempted.add(code);const started=performance.now();try{onSource?.({symbol:sym,provider:code,status:'FETCHING'});const bundle=await withProviderSlot(code,()=>invokeProvider(code,sym,start,end));bundles.push(bundle);attempts.push({provider:code,status:'OK',latencyMs:Math.round(performance.now()-started),bars:bundle.bars?.length||0,marketAt:bundle.marketPoint?.at||bundle.live?.at||null,receivedAt:bundle.receivedAt||nowISO()});state.sourceStats[code]=(state.sourceStats[code]||0)+1;onSource?.({symbol:sym,provider:code,status:'OK'});return true}catch(e){attempts.push({provider:code,status:'ERROR',error:e?.message||String(e)});onSource?.({symbol:sym,provider:code,status:'ERROR',error:e?.message||String(e)});await log('warn',`${sym}: ${code} başarısız`,{error:e?.message||String(e)});return false}};
  for(let i=0;i<order.length;i+=waveSize){
    if(i>0&&!forceAll&&!needsMore(merged,liveOnly)&&merged.marketPoint?.timestampVerified===true)break;
    const wave=order.slice(i,i+waveSize);await Promise.allSettled(wave.map(fetchOne));merged=mergeBundles(sym,bundles);
  }
  if(!merged.marketPoint?.timestampVerified){
    const timeSources=['YAHOO_QUOTE','YAHOO','YAHOO_ALT','BIGPARA_LIVE','BIGPARA','ISYATIRIM_LIVE'].filter(x=>!attempted.has(x));
    for(let i=0;i<timeSources.length&&!merged.marketPoint?.timestampVerified;i+=waveSize){await Promise.allSettled(timeSources.slice(i,i+waveSize).map(fetchOne));merged=mergeBundles(sym,bundles);}
  }
  merged=mergeBundles(sym,bundles);merged.attempts=attempts;
  if(!merged.bars.length&&!liveOnly)throw Object.assign(new Error('Tüm uygun kaynaklar denendi; geçerli tarihsel veri yok'),{code:'NO_HISTORICAL_DATA'});
  return merged;
}

function bundleRecordMissingFields(rec){const out=[];for(const field of V141225_ALL_HEADERS){if(field==='Hisse')continue;try{if(!v141225ValuePresent(rec,field))out.push(field);}catch{}}return out;}
function missingNeedsDeepHistory(fields){return (fields||[]).some(f=>/_T(?:[1-9]|[1-8][0-9]|90)$/.test(f)||/EMA|MACD|RSI|Momentum|Volatilite|Boll|Beta|Getiri_|HacimDegisim|Degisim3Gun|Destek|Direnc/.test(f));}
async function enrichRepairFromCompanyCard(rec,job,sym){if(!rec||!globalThis.AurumIsYatirimCompanyCard?.enrichRecord)return rec;try{return await globalThis.AurumIsYatirimCompanyCard.enrichRecord(rec,{force:false});}catch(e){await issue(job,sym,'*','ISYATIRIM_COMPANY_CARD','COMPANY_CARD_REPAIR_FAILED',e?.message||String(e));return rec;}}

async function exhaustiveSymbolRepair(sym,start,end,indexBundle,canonicalAt,bundle,job,onSource){
  let current=bundle,record=enrichBundle(mergeBundles(sym,[current]),indexBundle),missing=bundleRecordMissingFields(record),rounds=[];
  if(!missing.length&&marketWindowCheck(record,canonicalAt).ok)return {bundle:current,record,missing,rounds};
  for(let round=2;round<=Number(state.settings.symbolRepairRounds||3);round++){
    await pauseCheckpoint(job,JOB_STATUS.FETCHING_DATA);
    try{
      setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',done:job.processedSymbols||0,total:job.totalSymbols||currentSymbols().length,message:`${sym} · eksik ${missing.length} · tüm kaynaklar ${round}/${Number(state.settings.symbolRepairRounds||SYMBOL_REPAIR_ROUNDS)}`,symbol:sym,provider:'ALL'});
      const extra=await fetchSymbolBundle(sym,start,end,{mode:'FORCE_ALL',baseBundle:current,onSource});current=mergeBundles(sym,[current,extra]);current.attempts=[...(current.attempts||[]),...(extra.attempts||[])];record=enrichBundle(current,indexBundle);missing=bundleRecordMissingFields(record);const check=marketWindowCheck(record,canonicalAt);rounds.push({round,missing:missing.length,marketOk:check.ok,marketAt:record.marketDataAt||null,providers:[...new Set((extra.attempts||[]).map(x=>x.provider))],attempts:(extra.attempts||[]).length,at:nowISO()});if(!missing.length&&check.ok)break;
    }catch(e){rounds.push({round,missing:missing.length,error:e?.message||String(e),at:nowISO()});}
  }
  record=enrichBundle(mergeBundles(sym,[current]),indexBundle);missing=bundleRecordMissingFields(record);return {bundle:current,record,missing,rounds};
}

async function recoverSymbolMarketWindow(sym,start,end,canonicalAt,bundle,onSource){
  let current=bundle,lastCheck=null,rounds=[];
  const candidateFrom=x=>{const m=mergeBundles(sym,[x]),p=m?.marketPoint||m?.live||null;return p?.timestampVerified?{marketTimeVerified:true,marketDataAt:p.at,marketTimeProvider:p.provider||m.provider,provenance:{marketAt:p.at,marketTimeProvider:p.provider||m.provider}}:null;};
  for(let round=1;round<=Number(state.settings.marketRecoveryRounds??MARKET_RECOVERY_ROUNDS);round++){
    try{
      const extra=await fetchSymbolBundle(sym,start,end,{mode:'FORCE_ALL',baseBundle:current,onSource});
      current=mergeBundles(sym,[current,extra]);
      current.attempts=[...(current.attempts||[]),...(extra.attempts||[])];
      const probe=candidateFrom(current);lastCheck=marketWindowCheck(probe,canonicalAt);
      rounds.push({round,ok:lastCheck.ok,marketAt:probe?.marketDataAt||null,provider:probe?.marketTimeProvider||null,deltaMinutes:lastCheck.deltaMinutes});
      if(lastCheck.ok)return {bundle:current,check:lastCheck,rounds};
    }catch(e){rounds.push({round,ok:false,error:e?.message||String(e)});}
  }
  return {bundle:current,check:lastCheck||{ok:false,reason:'MARKET_TIME_RECOVERY_FAILED'},rounds};
}

async function resolveCanonicalMarketPoint(start,end){
  let best=null,attempts=[];
  const consider=(bundle,provider)=>{const p=bundle?.marketPoint||bundle?.live||null;if(p?.timestampVerified!==true)return;const t=safeTime(p.at);if(t==null)return;if(!best||t>safeTime(best.at))best={at:new Date(t).toISOString(),provider:p.provider||provider,timestampVerified:true};};
  const providers=['YAHOO','YAHOO_ALT','BIGPARA_LIVE','BIGPARA','ISYATIRIM_LIVE'];
  const results=await Promise.allSettled(providers.map(async code=>{try{const b=await withProviderSlot(code,()=>invokeProvider(code,INDEX_SYMBOL,start,end));consider(b,code);attempts.push({provider:code,status:'OK',marketAt:b?.marketPoint?.at||b?.live?.at||null});}catch(e){attempts.push({provider:code,status:'ERROR',error:e?.message||String(e)});}}));
  return best?{...best,attempts}:{at:null,provider:null,timestampVerified:false,attempts};
}

function makePlaceholder(sym,prior,issues=[]){const base=prior?JSON.parse(JSON.stringify(prior)):{sym,name:state.companyDirectory.get(sym)?.name||sym,sector:state.companyDirectory.get(sym)?.sector||null,series:{date:[],open:[],high:[],low:[],close:[],calcOpen:[],calcHigh:[],calcLow:[],calcClose:[],adjustmentFactor:[],volume:[],usd:[],index:[],deg:[],degVol:[]},providers:[],fundamentals:{},fundamentalSources:{},quality:0,warnings:[]};base.sym=sym;base.jobDataStatus=prior?'STALE_PRESERVED':'UNAVAILABLE';base.dataIssues=issues;base.warnings=[...new Set([...(base.warnings||[]),prior?'Yeni job için güncel veri alınamadı; önceki değerler aynen korundu':'Gerçek veri bulunamadı'])];base.storedAt=nowISO();base.validatedAt=nowISO();base.preservedFromPrevious=!!prior;return base;}
function validateRecord(rec,sym){const issues=[];if(!rec||rec.sym!==sym)issues.push('SYMBOL_MISMATCH');if(!Array.isArray(rec?.series?.date))issues.push('SERIES_DATE');const n=Array.isArray(rec?.series?.date)?rec.series.date.length:0;if(n<20)issues.push('SERIES_TOO_SHORT');if(n){for(const k of ['open','high','low','close','volume'])if(!Array.isArray(rec.series[k])||rec.series[k].length!==n)issues.push(`SERIES_LENGTH_${k}`);if(rec.latestDate!==rec.series.date.at(-1))issues.push('LATEST_DATE_MISMATCH');}if(Number.isFinite(rec?.livePrice)&&rec.livePrice<=0)issues.push('LIVE_PRICE_RANGE');if(Number.isFinite(rec?.apiAccessedAt))issues.push('API_TIME_TYPE');return {ok:!issues.length,issues};}
async function issue(job,sym,field,source,reason,detail=null){const row={id:`${job.id}|${sym}|${field}|${source}|${Date.now()}|${Math.random().toString(36).slice(2,6)}`,jobId:job.id,symbol:sym,field,source,reason,detail,createdAt:nowISO()};try{await dbPut('dataIssues',row)}catch{}return row;}

async function saveJob(job){job.updatedAt=nowISO();await dbPut('jobs',job);return job;}
async function getJob(id){return dbGet('jobs',id)}
const STAGE_BATCHES=new Map();
const HARD_CANCELLED_JOBS=new Set();
const STAGE_FLUSH_QUEUE=[];
let STAGE_FLUSH_PORT=null;
try{const ch=new MessageChannel();STAGE_FLUSH_PORT=ch.port2;ch.port1.onmessage=()=>{const id=STAGE_FLUSH_QUEUE.shift();if(id)flushStageBatch(id).catch(()=>{});};}catch{}
function scheduleStageFlush(jobId,delay=2){const q=STAGE_BATCHES.get(jobId);if(!q||q.timer)return;const wait=Math.max(2,Math.min(12,Number(delay)||4));if(typeof document!=='undefined'&&!document.hidden){q.timer=setTimeout(()=>flushStageBatch(jobId).catch(()=>{}),wait);}else if(STAGE_FLUSH_PORT){q.timer={channel:true};STAGE_FLUSH_QUEUE.push(jobId);STAGE_FLUSH_PORT.postMessage(0);}else q.timer=setTimeout(()=>flushStageBatch(jobId).catch(()=>{}),wait);}
async function flushStageBatch(jobId){const q=STAGE_BATCHES.get(jobId);if(!q||!q.items.length){if(q)q.timer=null;return;}const items=q.items.splice(0),waiters=q.waiters.splice(0);if(q.timer&&!q.timer.channel)clearTimeout(q.timer);q.timer=null;if(HARD_CANCELLED_JOBS.has(String(jobId))){const e=Object.assign(new Error('İşlem kullanıcı tarafından iptal edildi'),{code:'OPERATION_CANCELLED'});waiters.forEach(x=>x.reject(e));throw e;}try{await bulkPut('stagingRecords',items);if(HARD_CANCELLED_JOBS.has(String(jobId)))throw Object.assign(new Error('İşlem kullanıcı tarafından iptal edildi'),{code:'OPERATION_CANCELLED'});waiters.forEach(x=>x.resolve(true));}catch(e){waiters.forEach(x=>x.reject(e));throw e;}}
async function stagePut(jobId,sym,record){if(HARD_CANCELLED_JOBS.has(String(jobId)))throw Object.assign(new Error('İşlem kullanıcı tarafından iptal edildi'),{code:'OPERATION_CANCELLED'});let q=STAGE_BATCHES.get(jobId);if(!q){q={items:[],waiters:[],timer:null};STAGE_BATCHES.set(jobId,q);}const batch=Math.max(8,Math.min(500,Number(state.settings?.stageBatchSize||128))),delay=Math.max(2,Math.min(500,Number(state.settings?.stageFlushMs||2)));return new Promise((resolve,reject)=>{q.items.push({id:`${jobId}|${sym}`,jobId,sym,record,updatedAt:nowISO()});q.waiters.push({resolve,reject});if(q.items.length>=batch)flushStageBatch(jobId).catch(()=>{});else scheduleStageFlush(jobId,delay);});}
async function stageRows(jobId){return (await dbAll('stagingRecords')).filter(x=>x.jobId===jobId)}
async function clearStage(jobId){const rows=await stageRows(jobId);if(!rows.length)return;await new Promise((resolve,reject)=>{const tx=state.db.transaction('stagingRecords','readwrite'),s=tx.objectStore('stagingRecords');for(const x of rows)s.delete(x.id);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
async function recoverOrphanStagingRecords(){
  if(!state.db)return {recovered:0,retained:0};
  const [rows,jobs]=await Promise.all([dbAll('stagingRecords'),dbAll('jobs')]),active=new Set(jobs.filter(j=>operationBusyStatus(String(j?.status||''))).map(j=>j.id)),orph=rows.filter(x=>!active.has(x.jobId));
  if(!orph.length)return {recovered:0,retained:0};
  const current=new Map((state.records||[]).map(r=>[r.sym,r])),publish=[];
  for(const x of orph){const r=x?.record;if(!r?.sym||r.jobDataStatus!=='FRESH')continue;let valid=true;try{valid=validateRecord(r,r.sym).ok}catch{}if(!valid)continue;const old=current.get(r.sym),nt=Date.parse(r.marketDataAt||r.apiAccessedAt||r.storedAt||''),ot=Date.parse(old?.marketDataAt||old?.apiAccessedAt||old?.storedAt||'');if(!old||!Number.isFinite(ot)||!Number.isFinite(nt)||nt>=ot)publish.push(x);else publish.push({...x,__discardOnly:true});}
  if(!publish.length)return {recovered:0,retained:orph.length};
  await new Promise((resolve,reject)=>{const tx=state.db.transaction(['records','stagingRecords'],'readwrite'),rs=tx.objectStore('records'),ss=tx.objectStore('stagingRecords');for(const x of publish){if(!x.__discardOnly)rs.put({key:x.record.sym,value:{...x.record,tableTransferredAt:nowISO()},updatedAt:nowISO()});ss.delete(x.id);}tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});
  const reread=(await dbAll('records')).map(x=>x.value);state.records=reread;state.recordMap=new Map(reread.map(x=>[x.sym,x]));try{await refreshTableMeta()}catch{}return {recovered:publish.filter(x=>!x.__discardOnly).length,retained:orph.length-publish.length};
}
async function atomicPublish(job,universe){
  if(HARD_CANCELLED_JOBS.has(String(job?.id))||cancelRequested(job))throw Object.assign(new Error('İşlem kullanıcı tarafından iptal edildi'),{code:'OPERATION_CANCELLED'});
  const rows=await stageRows(job.id),by=new Map(rows.map(x=>[x.sym,x.record]));
  if(by.size!==universe.length)throw new Error(`STAGING_COUNT_MISMATCH:${by.size}/${universe.length}`);
  for(const sym of universe)if(!by.has(sym))throw new Error(`STAGING_SYMBOL_MISSING:${sym}`);
  const canonical=safeTime(job?.canonicalMarketAt);
  const previous=(await dbGet('meta','activeDataSnapshot'))?.value||{},previousRecords=new Map((state.records||[]).map(r=>[r.sym,r]));
  const exclusions=[],records=[];
  for(const sym of universe){
    let rec=by.get(sym);const chk=canonical!=null?marketWindowCheck(rec,job.canonicalMarketAt):{ok:false,reason:'CANONICAL_MARKET_TIME_UNAVAILABLE',deltaMinutes:null},fresh=rec?.jobDataStatus==='FRESH';
    if(!fresh){
      exclusions.push({sym,reason:rec?.dataIssues?.[0]||'CURRENT_JOB_DATA_UNAVAILABLE',marketAt:rec?.marketDataAt||null,provider:rec?.marketTimeProvider||null,deltaMinutes:chk.deltaMinutes??null});
      rec.marketWindowEligible=false;rec.marketWindowDeltaMinutes=chk.deltaMinutes;rec.calculationEligible=false;rec.calculationExclusionReasons=[...new Set([...(rec.calculationExclusionReasons||[]),'CURRENT_JOB_NOT_FRESH'])];
    }else{rec.marketWindowEligible=chk.ok;rec.marketWindowDeltaMinutes=chk.deltaMinutes;if(!chk.ok){rec.calculationEligible=false;rec.calculationExclusionReasons=[...new Set([...(rec.calculationExclusionReasons||[]),chk.reason||'MARKET_WINDOW_UNAVAILABLE'])];}}
    rec.unresolvedFields=Array.isArray(rec.unresolvedFields)?rec.unresolvedFields:bundleRecordMissingFields(rec);records.push(rec);
  }
  job.excludedSymbols=exclusions;
  const eligibility=classifyDataCompleteness(records,universe);for(const rec of records){const e=eligibility.bySymbol.get(rec.sym);rec.emptyCellCount=e?.emptyCells??0;if(rec?.jobDataStatus==='FRESH'&&rec?.marketWindowEligible===true){rec.calculationEligible=!!e?.eligible;rec.calculationExclusionReasons=e?.reasons||[];}rec.incompleteColumns=eligibility.incompleteColumns;}
  const transferredAt=nowISO(),verifiedTimes=records.map(r=>externalMarketTime(r)).filter(Number.isFinite),marketAt=canonical!=null?new Date(canonical).toISOString():(verifiedTimes.length?new Date(Math.max(...verifiedTimes)).toISOString():(previous.marketAt||null));
  for(const rec of records){const prev=previousRecords.get(rec.sym),rf=dataRecordFingerprint(rec),prevRf=prev?.recordFingerprint||(prev?dataRecordFingerprint(prev):null);rec.recordFingerprint=rf;rec.tableTransferredAt=transferredAt;rec.recordChangedAt=prev&&prevRf===rf?(prev.recordChangedAt||prev.tableTransferredAt||previous.changedAt||transferredAt):transferredAt;rec.datasetMarketAt=rec?.jobDataStatus==='FRESH'?(marketAt||rec.marketDataAt||prev?.datasetMarketAt||null):(prev?.datasetMarketAt||previous.marketAt||rec.datasetMarketAt||null);rec.provenance={...(rec.provenance||{}),marketAt:rec.marketDataAt||null,marketTimeVerified:rec.marketTimeVerified===true,marketTimeProvider:rec.marketTimeProvider||null,datasetMarketAt:rec.datasetMarketAt,tableTransferredAt:transferredAt,recordChangedAt:rec.recordChangedAt,marketWindowDeltaMinutes:rec.marketWindowDeltaMinutes};}
  const fingerprint=dataTableFingerprint(records),changedAt=previous.fingerprint===fingerprint&&previous.changedAt?previous.changedAt:transferredAt;
  const values=records.map(value=>({key:value.sym,value,updatedAt:transferredAt}));
  await new Promise((resolve,reject)=>{const tx=state.db.transaction(['records','meta'],'readwrite'),rs=tx.objectStore('records'),ms=tx.objectStore('meta');rs.clear();for(const v of values)rs.put(v);ms.put({key:'activeDataSnapshot',value:{snapshotId:job.dataSnapshotId,jobId:job.id,mode:job.mode,completedAt:transferredAt,transferredAt,changedAt,marketAt,fingerprint,marketTimeBasis:canonical!=null?'SOURCE_REPORTED_VERIFIED_90M_WINDOW_WITH_SAME_TRADING_DAY_PRESERVATION':'SOURCE_REPORTED_HISTORY_FRESH_MARKET_TIME_UNAVAILABLE',marketTimeProvider:job?.canonicalMarketProvider||null,universeCount:universe.length,publishedCount:records.length,excludedSymbols:exclusions,incompleteColumns:eligibility.incompleteColumns},updatedAt:transferredAt});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});
  const reread=(await dbAll('records')).map(x=>x.value),symbols=new Set(reread.map(x=>x.sym));if(reread.length!==records.length||records.some(x=>!symbols.has(x.sym)))throw new Error('POST_WRITE_VERIFICATION_FAILED');
  state.records=reread;state.recordMap=new Map(reread.map(x=>[x.sym,x]));return reread;
}


const DATA_REPAIR_META_KEY='pendingDataRepair';
function buildPendingRepairPlan(records=state.records,universe=currentSymbols()){
  const by=new Map((records||[]).map(r=>[r.sym,r])),items=[];let missingCellCount=0,staleSymbolCount=0;
  for(const sym of universe){const rec=by.get(sym);if(!rec){items.push({sym,fullSymbol:true,fields:[],reason:'TABLODA_YOK'});staleSymbolCount++;continue;}const fields=bundleRecordMissingFields(rec),stale=rec?.jobDataStatus!=='FRESH'||rec?.marketWindowEligible===false;if(stale||fields.length){items.push({sym,fullSymbol:stale,fields,reason:stale?(rec?.dataIssues?.[0]||'GUNCEL_VERI_ALINAMADI'):'EKSIK_HUCRE'});missingCellCount+=fields.length;if(stale)staleSymbolCount++;}}
  return {schema:1,generatedAt:nowISO(),symbolCount:items.length,staleSymbolCount,missingCellCount,items};
}
async function persistPendingRepairPlan(records=state.records,universe=currentSymbols()){const plan=buildPendingRepairPlan(records,universe);await dbPut('meta',{key:DATA_REPAIR_META_KEY,value:plan,updatedAt:nowISO()});return plan;}
function currentPendingRepairPlan(){return buildPendingRepairPlan(state.records,currentSymbols());}
function repairFallbackRecord(prior,issues=[]){if(!prior)return makePlaceholder('',null,issues);const rec=JSON.parse(JSON.stringify(prior));rec.repairLastError=issues.join(' · ');rec.repairAttemptedAt=nowISO();return rec;}
async function atomicRepairPublish(job,targetSymbols){
  if(HARD_CANCELLED_JOBS.has(String(job?.id))||cancelRequested(job))throw Object.assign(new Error('İşlem kullanıcı tarafından iptal edildi'),{code:'OPERATION_CANCELLED'});
  const staged=await stageRows(job.id),byStage=new Map(staged.map(x=>[x.sym,x.record])),all=new Map((state.records||[]).map(r=>[r.sym,r])),changed=[];
  const canonical=safeTime(job?.canonicalMarketAt);if(canonical==null)throw new Error('CANONICAL_MARKET_TIME_UNAVAILABLE');
  for(const sym of targetSymbols){const rec=byStage.get(sym);if(!rec)continue;const chk=marketWindowCheck(rec,job.canonicalMarketAt);if(rec?.jobDataStatus==='FRESH'&&chk.ok){rec.marketWindowEligible=true;rec.marketWindowDeltaMinutes=chk.deltaMinutes;rec.unresolvedFields=bundleRecordMissingFields(rec);all.set(sym,rec);changed.push(sym);}else if(!all.has(sym)){all.set(sym,rec);changed.push(sym);}}
  const universe=currentSymbols(),records=universe.map(sym=>all.get(sym)).filter(Boolean),eligibility=classifyDataCompleteness(records,universe),previous=(await dbGet('meta','activeDataSnapshot'))?.value||{},transferredAt=nowISO();
  for(const rec of records){const e=eligibility.bySymbol.get(rec.sym);rec.emptyCellCount=e?.emptyCells??0;if(rec?.jobDataStatus==='FRESH'&&rec?.marketWindowEligible===true){rec.calculationEligible=!!e?.eligible;rec.calculationExclusionReasons=e?.reasons||[];}else rec.calculationEligible=false;rec.incompleteColumns=eligibility.incompleteColumns;}
  const plan=buildPendingRepairPlan(records,universe),excludedSymbols=plan.items.filter(x=>x.fullSymbol).map(x=>({sym:x.sym,reason:x.reason||'REPAIR_PENDING'})),fingerprint=dataTableFingerprint(records),changedAt=previous.fingerprint===fingerprint&&previous.changedAt?previous.changedAt:transferredAt;
  await new Promise((resolve,reject)=>{const tx=state.db.transaction(['records','meta'],'readwrite'),rs=tx.objectStore('records'),ms=tx.objectStore('meta');for(const sym of changed){const value=all.get(sym);if(value)rs.put({key:sym,value,updatedAt:transferredAt});}ms.put({key:'activeDataSnapshot',value:{...previous,snapshotId:job.dataSnapshotId,jobId:job.id,completedAt:transferredAt,transferredAt,changedAt,fingerprint,universeCount:universe.length,publishedCount:records.length,excludedSymbols,incompleteColumns:eligibility.incompleteColumns,repairOnly:true},updatedAt:transferredAt});ms.put({key:DATA_REPAIR_META_KEY,value:plan,updatedAt:transferredAt});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});
  const reread=(await dbAll('records')).map(x=>x.value);state.records=reread;state.recordMap=new Map(reread.map(x=>[x.sym,x]));return {records:reread,plan,changed};
}

const V141225_BAND_KEY='aurum.v141225.band.v2';
function v141225DriveHeaders(){
  const h=['Hisse','VeriZamani','Anlik','AnlikDegisim%','Degisim3Gun(%)_T0','Destekler(3)_T0','Direncler(3)_T0','KapanisTarihi_T0','FiyatDegisim%_T0','Kapanis_T0','Min_T0','Max_T0','Hacim_T0','HacimDegisim%_T0','EMA20_T0','EMA50_T0','EMA200_T0','MACD_T0','MACDSignal_T0','MACDHist_T0','RSI14_T0','Momentum10_T0','Volatilite5G_T0','Volatilite21G_T0','Volatilite63G_T0','Boll_Orta_T0','Boll_Std_T0','Boll_Alt_T0','Boll_Ust_T0','PD_T0','SERMAYE_T0','FD_T0','FAVOK_T0','FD_FAVOK_T0','F_K_T0','PD_DD_T0','ROE_Yaklasik_T0','Beta_T0','Teknik_Sinyal_T0','Getiri_TL_1A_T0','Getiri_TL_3A_T0','Getiri_TL_6A_T0','Getiri_USD_1A_T0','Getiri_USD_3A_T0','Getiri_USD_6A_T0','Getiri_XU_1A_T0','Getiri_XU_3A_T0','Getiri_XU_6A_T0'];
  for(let t=1;t<=30;t++)h.push(`FiyatDegisim%_T${t}`,`Kapanis_T${t}`,`Min_T${t}`,`Max_T${t}`,`Hacim_T${t}`,`HacimDegisim%_T${t}`);
  for(let t=31;t<=90;t++)h.push(`FiyatDegisim%_T${t}`,`Kapanis_T${t}`,`Hacim_T${t}`,`HacimDegisim%_T${t}`);
  return h;
}
const V141225_DRIVE_HEADERS=Object.freeze(v141225DriveHeaders());
const V141225_EXTRA_HEADERS=Object.freeze(['Davranış Skoru','Davranış Tipi','DNA Skoru','DNA Olasılığı','ATR%','Hacim Kırılımı','Göreceli 5G','Tahmini Maliyet%','Piyasa Rejimi','Kalite','Veri Tamlık','Kaynak','İş Yatırım Öneri','İş Yatırım Hedef','İş Yatırım Potansiyel%','Çapraz Uyum']);
const V141225_ALL_HEADERS=Object.freeze([...V141225_DRIVE_HEADERS,...V141225_EXTRA_HEADERS]);
const V141225_BANDS=Object.freeze({T0:[0,48],T1_30:[48,228],T31_60:[228,348],T61_90:[348,468],EK:[468,484]});
function vBand(){const x=readLocal(V141225_BAND_KEY,'T0');return V141225_BANDS[x]?x:'T0'}
function setV141225Band(v){if(V141225_BANDS[v])writeLocal(V141225_BAND_KEY,v);renderCurrentPagePreservingView();}
function vAt(a,i){return Array.isArray(a)&&i>=0&&i<a.length?a[i]:null}
function vFinite(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null}
function safeSeriesReturn(series,gap){const a=Array.isArray(series)?series:[],i=a.length-1;if(i<gap)return null;const x=Number(a[i]),b=Number(a[i-gap]);if(!Number.isFinite(x)||!Number.isFinite(b)||x<=0||b<=0)return null;const r=100*(x/b-1);return Number.isFinite(r)&&r>-99.5?r:null;}
function safeDailyReturnFromSeries(series,index=null){const a=Array.isArray(series)?series:[],i=index==null?a.length-1:Number(index);if(i<=0||i>=a.length)return null;const x=Number(a[i]),b=Number(a[i-1]);if(!Number.isFinite(x)||!Number.isFinite(b)||x<=0||b<=0)return null;const r=100*(x/b-1);return Number.isFinite(r)&&r>-99.5?r:null;}
function safeRecordDayChange(rec){const direct=vFinite(rec?.dayChange);if(direct!=null&&direct>-99.5)return direct;const adjusted=safeDailyReturnFromSeries(rec?.series?.calcClose);if(adjusted!=null)return adjusted;return safeDailyReturnFromSeries(rec?.series?.close);}
function threeDayChangeValues(rec){const candidates=[rec?.series?.calcClose,rec?.series?.close];for(const a of candidates){if(!Array.isArray(a)||a.length<4)continue;const vals=[];for(let i=a.length-1;i>=a.length-3;i--){const r=safeDailyReturnFromSeries(a,i);if(r==null){vals.length=0;break;}vals.push(r);}if(vals.length===3)return vals;}return [];}
function threeDayChangeText(rec){const vals=threeDayChangeValues(rec);if(vals.length!==3)return null;return vals.map(x=>`${x>=0?'+':''}${globalThis.AurumNumberFormat?globalThis.AurumNumberFormat(x,2):fmt(x,2)}`).join(' | ');}
const V141225_ZERO_ALWAYS_MISSING=new Set(['Anlik','Kapanis_T0','Min_T0','Max_T0','Hacim_T0','EMA20_T0','EMA50_T0','EMA200_T0','Boll_Orta_T0','Boll_Std_T0','Boll_Alt_T0','Boll_Ust_T0','PD_T0','SERMAYE_T0','FD_T0','FAVOK_T0','FD_FAVOK_T0','F_K_T0','PD_DD_T0','ROE_Yaklasik_T0','Beta_T0']);
function v141225ZeroMeansMissing(field,v){if(Number(v)!==0)return false;if(V141225_ZERO_ALWAYS_MISSING.has(field))return true;if(/^(Kapanis|Min|Max|Hacim)_T\d+$/.test(field))return true;return false;}
function vRecordCompleteness(rec){let filled=0,total=0;for(const h of V141225_DRIVE_HEADERS){if(h==='Hisse')continue;total++;const v=v141225Raw(rec,h,true);if(!(v===null||v===undefined||v===''||(typeof v==='number'&&!Number.isFinite(v))||v141225ZeroMeansMissing(h,v)))filled++;}return total?100*filled/total:0}
function v141225Raw(rec,key,skipCompleteness=false){
  const s=rec?.series||{},n=s.date?.length||0,ix=n-1,fm=rec?.fundamentals||{};
  if(key==='Hisse')return rec?.sym||null;
  if(key==='VeriZamani')return rec?.marketDataAt||rec?.datasetMarketAt||rec?.provenance?.marketAt||rec?.apiAccessedAt||rec?.tableTransferredAt||rec?.storedAt||null;
  if(key==='Anlik'){const v=vFinite(rec?.livePrice);return v!=null&&v>0?v:null;}
  if(key==='AnlikDegisim%')return safeRecordDayChange(rec);
  if(key==='Degisim3Gun(%)_T0')return threeDayChangeText(rec);
  if(key==='Destekler(3)_T0')return (rec?.support||rec?.supports||rec?.supportLevels||[]).map(vFinite).filter(v=>v!=null&&v>0).slice(0,3).join(' | ')||null;
  if(key==='Direncler(3)_T0')return (rec?.resistance||rec?.resistances||rec?.resistanceLevels||[]).map(vFinite).filter(v=>v!=null&&v>0).slice(0,3).join(' | ')||null;
  if(key==='KapanisTarihi_T0')return vAt(s.date,ix)||rec?.latestDate||null;
  if(key==='FiyatDegisim%_T0')return safeRecordDayChange(rec);
  if(key==='Kapanis_T0'){const v=vFinite(rec?.price??vAt(s.close,ix));return v!=null&&v>0?v:null;}
  if(key==='Min_T0'){const v=vFinite(rec?.low??vAt(s.low,ix));return v!=null&&v>0?v:null;}
  if(key==='Max_T0'){const v=vFinite(rec?.high??vAt(s.high,ix));return v!=null&&v>0?v:null;}
  if(key==='Hacim_T0'){const v=vFinite(rec?.volume??vAt(s.volume,ix));return v!=null&&v>0?v:null;}
  if(key==='HacimDegisim%_T0')return vFinite(rec?.volumeChange);
  const hist=key.match(/^(FiyatDegisim%|Kapanis|Min|Max|Hacim|HacimDegisim%)_T(\d+)$/);
  if(hist){const t=Number(hist[2]),i=ix-t;if(i<0)return null;const close=vFinite(vAt(s.close,i)),prev=vFinite(vAt(s.close,i-1)),vol=vFinite(vAt(s.volume,i)),prevVol=vFinite(vAt(s.volume,i-1));switch(hist[1]){case'FiyatDegisim%':return close!=null&&close>0&&prev!=null&&prev>0?100*(close/prev-1):null;case'Kapanis':return close!=null&&close>0?close:null;case'Min':{const v=vFinite(vAt(s.low,i));return v!=null&&v>0?v:null;}case'Max':{const v=vFinite(vAt(s.high,i));return v!=null&&v>0?v:null;}case'Hacim':return vol!=null&&vol>0?vol:null;case'HacimDegisim%':return vol!=null&&vol>=0&&prevVol!=null&&prevVol>0?100*(vol/prevVol-1):null;}}
  const direct={EMA20_T0:'ema20',EMA50_T0:'ema50',EMA200_T0:'ema200',MACD_T0:'macd',MACDSignal_T0:'macdSignal',MACDHist_T0:'macdHist',RSI14_T0:'rsi14',Momentum10_T0:'momentum10',Volatilite5G_T0:'vol5',Volatilite21G_T0:'vol21',Volatilite63G_T0:'vol63',Boll_Orta_T0:'bollMid',Boll_Std_T0:'bollStd',Boll_Alt_T0:'bollLow',Boll_Ust_T0:'bollHigh',Beta_T0:'beta'};
  if(direct[key]){const v=vFinite(rec?.[direct[key]]);return v141225ZeroMeansMissing(key,v)?null:v;}
  if(key==='Teknik_Sinyal_T0')return rec?.technicalSignal||null;
  const fund={PD_T0:['marketCap'],SERMAYE_T0:['capital'],FD_T0:['enterpriseValue','fd'],FAVOK_T0:['ebitda','favok'],FD_FAVOK_T0:['evEbitda','fdFavok'],F_K_T0:['pe','fk'],PD_DD_T0:['pb','pdDd'],ROE_Yaklasik_T0:['roe','roePct']};
  if(fund[key]){for(const k of fund[key]){const v=vFinite(fm?.[k]??rec?.[k]);if(v==null)continue;if(['PD_T0','SERMAYE_T0','FD_T0','FAVOK_T0','FD_FAVOK_T0','F_K_T0','PD_DD_T0','ROE_Yaklasik_T0'].includes(key)&&v===0)continue;if(['PD_T0','SERMAYE_T0','F_K_T0','PD_DD_T0'].includes(key)&&v<0)continue;return v;}return null;}
  const retSpec={Getiri_TL_1A_T0:['calcClose',21,['retTL1','retTL21']],Getiri_TL_3A_T0:['calcClose',63,['retTL3','retTL63']],Getiri_TL_6A_T0:['calcClose',126,['retTL6','retTL126']],Getiri_USD_1A_T0:['usd',21,['retUSD1','retUSD21']],Getiri_USD_3A_T0:['usd',63,['retUSD3','retUSD63']],Getiri_USD_6A_T0:['usd',126,['retUSD6','retUSD126']],Getiri_XU_1A_T0:['index',21,['retXU1','retXU21']],Getiri_XU_3A_T0:['index',63,['retXU3','retXU63']],Getiri_XU_6A_T0:['index',126,['retXU6','retXU126']]};
  if(retSpec[key]){const [seriesName,gap,aliases]=retSpec[key];let computed=safeSeriesReturn(s?.[seriesName],gap);if(computed==null&&seriesName==='calcClose')computed=safeSeriesReturn(s?.close,gap);if(computed!=null)return computed;for(const k of aliases){const v=vFinite(rec?.[k]);if(v!=null&&v>-99.5)return v;}return null;}
  const card=rec?.companyCard||{},cv=rec?.crossValidation?.isYatirim||{};
  if(key==='Davranış Skoru')return vFinite(rec?.behaviorScore);
  if(key==='Davranış Tipi')return rec?.behaviorType||rec?.behaviorProfile?.character?.type||null;
  if(key==='DNA Skoru')return vFinite(rec?.genomeScore??rec?.genomeProfile?.score);
  if(key==='DNA Olasılığı'){const p=vFinite(rec?.genomeProbability??rec?.genomeProfile?.dualRate);return p==null?null:100*p;}
  if(key==='ATR%')return vFinite(rec?.atrPct);
  if(key==='Hacim Kırılımı')return vFinite(rec?.volumeBreakout);
  if(key==='Göreceli 5G'){const a=vFinite(rec?.retTL5),b=vFinite(rec?.retXU5);return a!=null&&b!=null?a-b:null;}
  if(key==='Tahmini Maliyet%')return vFinite(rec?.estimatedCostPct);
  if(key==='Piyasa Rejimi')return rec?.marketRegime||null;
  if(key==='Kalite')return vFinite(rec?.quality);
  if(key==='Veri Tamlık')return skipCompleteness?null:vRecordCompleteness(rec);
  if(key==='Kaynak')return rec?.source||(rec?.providers||[]).join(', ')||null;
  if(key==='İş Yatırım Öneri')return card?.recommendation?.recommendation||null;
  if(key==='İş Yatırım Hedef')return vFinite(card?.recommendation?.targetPrice);
  if(key==='İş Yatırım Potansiyel%')return vFinite(card?.recommendation?.upsidePotentialPct);
  if(key==='Çapraz Uyum'){const a=vFinite(cv?.agreementScore);return a==null?null:100*a;}
  return null;
}
function v141225Cell(rec,key){const raw=v141225Raw(rec,key);if(key==='Hisse')return `<button type="button" class="aurum-symbol-link" onclick="event.stopPropagation();showDetail('${html(rec.sym)}')">${html(rec.sym)}</button>`;const zeroPlaceholder=new Set(TABLE_META?.data?.summary?.zeroPlaceholderColumns||[]);if(raw==null||raw===''||(zeroPlaceholder.has(key)&&v141225NumericZero(rec,key)))return '—';if(key==='VeriZamani')return html(formatTableTime(raw));if(key==='Degisim3Gun(%)_T0')return html(String(raw));if(key==='KapanisTarihi_T0'||key==='Teknik_Sinyal_T0'||key==='Davranış Tipi'||key==='Piyasa Rejimi'||key==='Kaynak'||key==='İş Yatırım Öneri')return html(String(raw));if(key==='Destekler(3)_T0'||key==='Direncler(3)_T0')return html(String(raw).split('|').map(x=>{const t=x.trim(),n=Number(t);return Number.isFinite(n)?fmt(n,2):t}).join(' | '));if(/%/.test(key)||['ATR%','Göreceli 5G','Tahmini Maliyet%','İş Yatırım Potansiyel%','Çapraz Uyum','DNA Olasılığı'].includes(key))return `${Number(raw)>=0?'+':''}${fmt(raw,2)}%`;if(/^Hacim(_T\d+)?$/.test(key)||key==='Hacim_T0')return fmt(raw,0);if(['Kalite','Veri Tamlık'].includes(key))return fmt(raw,0);return fmt(raw,2);}
const V141225_PAGE_SIZE=200;let V141225_PAGE_INDEX=0,V141225_FILTER_QUERY='';
function v141225VisibleHeaders(){return V141225_ALL_HEADERS.slice()}
function v141225PageRows(rows){const total=Math.max(1,Math.ceil((rows?.length||0)/V141225_PAGE_SIZE));V141225_PAGE_INDEX=Math.max(0,Math.min(V141225_PAGE_INDEX,total-1));const start=V141225_PAGE_INDEX*V141225_PAGE_SIZE;return {pageRows:(rows||[]).slice(start,start+V141225_PAGE_SIZE),total,start};}
function v141225Pager(rows){const {total}=v141225PageRows(rows),page=V141225_PAGE_INDEX+1;return `<div class="aurum-data-pager aurum-data-pager-balanced"><div class="pager-left"><button type="button" class="ghost-btn compact-btn" onclick="V141225_PAGE_INDEX=0;changeV141225Page(0)" ${page<=1?'disabled':''}>İlk</button><button type="button" class="ghost-btn compact-btn" onclick="changeV141225Page(-1)" ${page<=1?'disabled':''}>Önceki</button></div><small>${page} / ${total} · ${(rows||[]).length} kayıt · 200/sayfa</small><div class="pager-right"><button type="button" class="ghost-btn compact-btn" onclick="changeV141225Page(1)" ${page>=total?'disabled':''}>Sonraki</button><button type="button" class="ghost-btn compact-btn" onclick="V141225_PAGE_INDEX=${total-1};changeV141225Page(0)" ${page>=total?'disabled':''}>Son</button></div></div>`;}
function v141225Table(rows){const headers=v141225VisibleHeaders(),paged=v141225PageRows(rows),pageRows=paged.pageRows;return `<div class="table-wrap aurum-drive-table aurum-v141225" ontouchstart="aurumDataSwipeStart(event)" ontouchend="aurumDataSwipeEnd(event)"><table><thead><tr>${headers.map(h=>`<th>${html(h)}</th>`).join('')}</tr></thead><tbody>${pageRows.map(r=>`<tr>${headers.map(h=>`<td>${v141225Cell(r,h)}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${headers.length}">Veri yok.</td></tr>`}</tbody></table></div>${v141225Pager(rows)}`}
function v141225Tools(){return `<div class="aurum-v141225-tools"><div class="aurum-search-row"><input class="search-input" placeholder="Hisse veya şirket ara…" value="${html(V141225_FILTER_QUERY)}" oninput="filterRecords(this.value)"></div><div class="aurum-data-info-row"><span id="recordCount">${state.records.length} hisse</span><span>200 satır/sayfa</span><span>${V141225_ALL_HEADERS.length} sütun</span></div></div>`}
function currentV141225Rows(){const q=String(V141225_FILTER_QUERY||'').toLocaleUpperCase('tr-TR').trim();return state.records.filter(x=>!q||String(x.sym).includes(q)||String(x.name||'').toLocaleUpperCase('tr-TR').includes(q)).sort((a,b)=>a.sym.localeCompare(b.sym));}
function changeV141225Page(delta){const rows=currentV141225Rows(),total=Math.max(1,Math.ceil(rows.length/V141225_PAGE_SIZE));V141225_PAGE_INDEX=Math.max(0,Math.min(V141225_PAGE_INDEX+Number(delta||0),total-1));const box=$('#recordsContent');if(box)box.innerHTML=v141225Table(rows);const wrap=box?.querySelector?.('.aurum-v141225');if(wrap)wrap.scrollLeft=0;}
let V141225_SWIPE_X=null;function aurumDataSwipeStart(e){V141225_SWIPE_X=e?.changedTouches?.[0]?.clientX??null}function aurumDataSwipeEnd(e){const x=e?.changedTouches?.[0]?.clientX;if(V141225_SWIPE_X==null||x==null)return;const d=x-V141225_SWIPE_X;V141225_SWIPE_X=null;if(Math.abs(d)>=70)changeV141225Page(d<0?1:-1)}
function v141225ValuePresent(rec,field){const v=field==='Veri Tamlık'?vRecordCompleteness(rec):v141225Raw(rec,field,true);return !(v===null||v===undefined||v===''||(typeof v==='number'&&!Number.isFinite(v))||v141225ZeroMeansMissing(field,v));}
function v141225NumericZero(rec,field){const v=field==='Veri Tamlık'?vRecordCompleteness(rec):v141225Raw(rec,field,true);if(v===null||v===undefined||v===''||typeof v==='boolean')return false;if(typeof v==='string'&&v.trim()&&!/^[-+]?\d+(?:[.,]\d+)?$/.test(v.trim()))return false;const n=Number(typeof v==='string'?v.replace(',','.'):v);return Number.isFinite(n)&&Object.is(n,0);}
function classifyDataCompleteness(records=state.records,universe=currentSymbols(),fields=V141225_ALL_HEADERS){
  const rows=records||[],columnBlankCounts={},columnZeroCounts={},columnNonZeroNumericCounts={};for(const f of fields){columnBlankCounts[f]=0;columnZeroCounts[f]=0;columnNonZeroNumericCounts[f]=0;}
  for(const r of rows)for(const f of fields){const present=v141225ValuePresent(r,f);if(!present)columnBlankCounts[f]++;const raw=f==='Veri Tamlık'?vRecordCompleteness(r):v141225Raw(r,f,true),n=(raw===null||raw===undefined||raw===''||typeof raw==='boolean')?null:Number(raw);if(Number.isFinite(n)){if(n===0)columnZeroCounts[f]++;else columnNonZeroNumericCounts[f]++;}}
  // A numeric column containing only zero placeholders in at least five rows is not accepted as populated data.
  // Once a real non-zero value is recovered the column falls back to the ordinary blank-cell rule.
  const zeroPlaceholderColumns=fields.filter(f=>f!=='Hisse'&&columnNonZeroNumericCounts[f]===0&&columnZeroCounts[f]>0);
  const zeroBad=new Set(zeroPlaceholderColumns),incompleteColumns=fields.filter(f=>f!=='Hisse'&&columnBlankCounts[f]>0),usableFields=fields.filter(f=>f!=='Hisse'),rowFields=fields.filter(f=>f!=='Hisse'),bySymbol=new Map();
  // Satır ve sütun kuralları bağımsızdır: bir sütunun global olarak eksik sayılması,
  // o satırdaki eksik/placeholder hücreyi hisse eksikliği hesabından düşürmez.
  for(const r of rows){let emptyCells=0;for(const f of rowFields){const missing=!v141225ValuePresent(r,f)||(zeroBad.has(f)&&v141225NumericZero(r,f));if(missing)emptyCells++;}const reasons=[];if(r?.marketWindowEligible===false)reasons.push(`MARKET_TIME_OUTSIDE_${Math.max(30,Math.min(180,Number(state.settings?.marketFreshMinutes||90)))}M`);if(r?.jobDataStatus!=='FRESH')reasons.push('CURRENT_JOB_NOT_FRESH');bySymbol.set(r.sym,{emptyCells,eligible:reasons.length===0,reasons});}
  return {incompleteColumns,zeroPlaceholderColumns,columnBlankCounts,columnZeroCounts,columnNonZeroNumericCounts,usableFields,bySymbol};
}
function dataSummary(records=state.records){
  const universe=currentSymbols(),rows=records||[],fields=V141225_ALL_HEADERS,classification=classifyDataCompleteness(rows,universe),zeroBad=new Set(classification.zeroPlaceholderColumns||[]);let filled=0;const sourceCounts={},present=new Set(),fresh=new Set();
  for(const r of rows){if(r?.sym)present.add(r.sym);if(r?.jobDataStatus==='FRESH'&&r?.sym)fresh.add(r.sym);for(const f of fields)if(v141225ValuePresent(r,f)&&!(zeroBad.has(f)&&v141225NumericZero(r,f)))filled++;for(const p of new Set(r?.providers||[]))sourceCounts[p]=(sourceCounts[p]||0)+1;}
  const total=universe.length*fields.length,missing=Math.max(0,total-filled),missingDetails=[];for(const sym of universe){const r=rows.find(x=>x.sym===sym);if(!r)missingDetails.push({sym,reason:'TABLOYA_ALINMADI'});else{const e=classification.bySymbol.get(sym);if(!e?.eligible)missingDetails.push({sym,reason:(e?.reasons||[]).join(' · ')||'EKSİK',emptyCells:e?.emptyCells??null,marketAt:r.marketDataAt||null,provider:r.marketTimeProvider||null});}}
  const lastExclusions=TABLE_META?.data?.excludedSymbols||[];for(const x of lastExclusions){const d=missingDetails.find(y=>y.sym===x.sym);if(d)Object.assign(d,{reason:x.reason||d.reason,marketAt:x.marketAt||d.marketAt,provider:x.provider||d.provider,deltaMinutes:x.deltaMinutes??d.deltaMinutes});}
  const exhaustedMissingCells=rows.reduce((n,r)=>n+(Number(r?.repairAttemptCount||0)>=3?bundleRecordMissingFields(r).length:0),0),activeBlockingMissingCells=Math.max(0,missing-exhaustedMissingCells),fillPct=total?100*filled/total:0,calculationEligibleRows=[...classification.bySymbol.values()].filter(x=>x.eligible).length;return {integrityRuleVersion:'R26_SINGLE_ENGINE_3_ATTEMPT',universeCount:universe.length,loadedSymbols:rows.length,usableRows:rows.length,eligibleSymbols:rows.length-missingDetails.filter(x=>present.has(x.sym)).length,calculationEligibleRows,freshSymbols:fresh.size,missingSymbolCount:missingDetails.length,missingSymbols:missingDetails.map(x=>x.sym),missingSymbolDetails:missingDetails,totalCells:total,filledCells:filled,emptyCells:missing,realMissingCells:missing,exhaustedMissingCells,activeBlockingMissingCells,fillPct,sourceCounts,missingColumns:classification.incompleteColumns,incompleteColumns:classification.incompleteColumns,zeroPlaceholderColumns:classification.zeroPlaceholderColumns,columnBlankCounts:classification.columnBlankCounts,columnZeroCounts:classification.columnZeroCounts,fields};
}

const DATA_INTEGRITY_MAX_MISSING=20;
const DATA_INTEGRITY_REPAIR_ROUNDS=2;
function publishableStagedRecords(records,job){return (records||[]).filter(rec=>rec?.jobDataStatus==='FRESH'&&marketWindowCheck(rec,job?.canonicalMarketAt).ok);}
function dataIntegrityGate(summary){const fill=Number(summary?.fillPct||0),ok=Number.isFinite(fill)&&fill>=70;return {ok,missingSymbols:Number(summary?.missingSymbolCount||0),missingColumns:(summary?.incompleteColumns||summary?.missingColumns||[]).length,rows:Number(summary?.loadedSymbols||0),cols:Number(summary?.fields?.length||0),fillPct:fill,reason:ok?null:'DATA_FILL_BELOW_70_KEEP_LAST_VALID_SNAPSHOT'};}
function integrityRepairTargets(records,summary,universe){const by=new Map((records||[]).map(r=>[r.sym,r])),targets=new Set(summary?.missingSymbols||[]),bad=summary?.incompleteColumns||[],zeroBad=new Set(summary?.zeroPlaceholderColumns||[]);if(bad.length){for(const sym of universe){const r=by.get(sym);if(!r){targets.add(sym);continue;}for(const f of bad){if(!v141225ValuePresent(r,f)||(zeroBad.has(f)&&v141225NumericZero(r,f))){targets.add(sym);break;}}}}return [...targets];}
async function repairStagedIntegrity(job,universe,start,end,indexBundle){let staged=(await stageRows(job.id)).map(x=>x.record),summary=dataSummary(publishableStagedRecords(staged,job)),gate=dataIntegrityGate(summary),roundLog=[];if(gate.ok)return {summary,gate,roundLog};for(let round=2;round<=3;round++){
  const targets=integrityRepairTargets(staged,summary,universe);let repaired=0,failed=0;job.currentIntegrityRepairRound=round;await saveJob(job);
  for(const sym of targets){await pauseCheckpoint(job,JOB_STATUS.FETCHING_DATA);const stagedRec=staged.find(x=>x.sym===sym)||null,prior=stagedRec?.series?.date?.length?stagedRec:(state.recordMap.get(sym)||null),base=prior?.series?.date?.length?bundleFromRecord(prior):null;const onSource=({provider})=>setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',done:job.processedSymbols||0,total:universe.length,message:`${sym} · bütün kaynaklar · tur ${round}/3 · ${sourceName(provider)}`,symbol:sym,provider});try{const extra=await fetchSymbolBundle(sym,start,end,{mode:'FORCE_ALL',baseBundle:base,onSource}),merged=mergeBundles(sym,[extra]),candidate=enrichBundle(merged,indexBundle),windowCheck=marketWindowCheck(candidate,job.canonicalMarketAt);candidate.providerAttempts=[...(extra.attempts||[]),{provider:'ALL_ALTERNATIVES',status:'INTEGRITY_REPAIR',round}];candidate.dataSnapshotId=job.dataSnapshotId;candidate.jobId=job.id;candidate.jobMode=job.mode;candidate.jobDataStatus='FRESH';candidate.marketWindowEligible=windowCheck.ok;candidate.marketWindowDeltaMinutes=windowCheck.deltaMinutes;candidate.provenance={sources:candidate.providers||[],marketAt:candidate.marketDataAt||null,marketTimeVerified:candidate.marketTimeVerified===true,marketTimeProvider:candidate.marketTimeProvider||null,receivedAt:merged.receivedAt||null,validatedAt:nowISO(),jobId:job.id,canonicalMarketAt:job.canonicalMarketAt,marketWindowDeltaMinutes:windowCheck.deltaMinutes,integrityRepairRound:round,repairAttemptCount:round};const vr=validateRecord(candidate,sym);if(!windowCheck.ok||!vr.ok)throw new Error(!windowCheck.ok?(windowCheck.reason||'MARKET_TIME_WINDOW_FAILED'):vr.issues.join(','));await stagePut(job.id,sym,candidate);repaired++;}catch(e){failed++;await issue(job,sym,'*','ALL',`INTEGRITY_REPAIR_ROUND_${round}_FAILED`,e?.message||String(e));}}
  staged=(await stageRows(job.id)).map(x=>x.record);summary=dataSummary(publishableStagedRecords(staged,job));gate=dataIntegrityGate(summary);roundLog.push({round,targetCount:targets.length,repaired,failed,missingSymbols:gate.missingSymbols,missingColumns:gate.missingColumns,at:nowISO()});job.integrityRepairRounds=roundLog;await saveJob(job);if(gate.ok)break;
 }
 return {summary,gate,roundLog};}

function liveTemporalAudit(records){const times=(records||[]).filter(r=>r?.marketTimeVerified===true||r?.provenance?.marketTimeVerified===true).map(r=>Date.parse(r.marketDataAt||r.liveAt||r.provenance?.marketAt||'')).filter(Number.isFinite),maxMinutes=Math.max(30,Math.min(180,Number(state.settings?.marketFreshMinutes||90)));if(!times.length)return {ok:true,count:0,spanMinutes:null,maxMinutes};const lo=Math.min(...times),hi=Math.max(...times),span=(hi-lo)/60000;return {ok:span<=maxMinutes,count:times.length,spanMinutes:span,maxMinutes,min:new Date(lo).toISOString(),max:new Date(hi).toISOString()};}
function cloneForCalculation(rec){try{return structuredClone(rec)}catch{return JSON.parse(JSON.stringify(rec));}}
function maskIncompleteColumn(rec,key){
  const s=rec.series||{},n=s.date?.length||0,ix=n-1,setSeries=(name,i)=>{if(Array.isArray(s[name])&&i>=0&&i<s[name].length)s[name][i]=null;};
  if(key==='Anlik')rec.livePrice=null;else if(key==='AnlikDegisim%'||key==='FiyatDegisim%_T0')rec.dayChange=null;else if(key==='Kapanis_T0')rec.price=null;else if(key==='Min_T0')rec.low=null;else if(key==='Max_T0')rec.high=null;else if(key==='Hacim_T0')rec.volume=null;else if(key==='HacimDegisim%_T0')rec.volumeChange=null;
  const hist=key.match(/^(FiyatDegisim%|Kapanis|Min|Max|Hacim|HacimDegisim%)_T(\d+)$/);if(hist){const i=ix-Number(hist[2]);if(hist[1]==='Kapanis'||hist[1]==='FiyatDegisim%')setSeries('close',i);if(hist[1]==='Min')setSeries('low',i);if(hist[1]==='Max')setSeries('high',i);if(hist[1]==='Hacim'||hist[1]==='HacimDegisim%')setSeries('volume',i);}
  const direct={EMA20_T0:'ema20',EMA50_T0:'ema50',EMA200_T0:'ema200',MACD_T0:'macd',MACDSignal_T0:'macdSignal',MACDHist_T0:'macdHist',RSI14_T0:'rsi14',Momentum10_T0:'momentum10',Volatilite5G_T0:'vol5',Volatilite21G_T0:'vol21',Volatilite63G_T0:'vol63',Boll_Orta_T0:'bollMid',Boll_Std_T0:'bollStd',Boll_Alt_T0:'bollLow',Boll_Ust_T0:'bollHigh',Beta_T0:'beta','Davranış Skoru':'behaviorScore','DNA Skoru':'genomeScore','ATR%':'atrPct','Hacim Kırılımı':'volumeBreakout','Tahmini Maliyet%':'estimatedCostPct','Kalite':'quality'};if(direct[key])rec[direct[key]]=null;
  const fund={PD_T0:'marketCap',SERMAYE_T0:'capital',FD_T0:'enterpriseValue',FAVOK_T0:'ebitda',FD_FAVOK_T0:'evEbitda',F_K_T0:'pe',PD_DD_T0:'pb',ROE_Yaklasik_T0:'roe'};if(fund[key]){rec.fundamentals={...(rec.fundamentals||{})};rec.fundamentals[fund[key]]=null;rec[fund[key]]=null;}
  const rets={Getiri_TL_1A_T0:['retTL1','retTL21'],Getiri_TL_3A_T0:['retTL3','retTL63'],Getiri_TL_6A_T0:['retTL6','retTL126'],Getiri_USD_1A_T0:['retUSD1','retUSD21'],Getiri_USD_3A_T0:['retUSD3','retUSD63'],Getiri_USD_6A_T0:['retUSD6','retUSD126'],Getiri_XU_1A_T0:['retXU1','retXU21'],Getiri_XU_3A_T0:['retXU3','retXU63'],Getiri_XU_6A_T0:['retXU6','retXU126']};for(const k of rets[key]||[])rec[k]=null;
  return rec;
}
function normalizeCalculationRecord(rec){
  rec.dayChange=safeRecordDayChange(rec);
  const s=rec.series||{};
  const tl1=safeSeriesReturn(s.calcClose,21)??safeSeriesReturn(s.close,21),tl3=safeSeriesReturn(s.calcClose,63)??safeSeriesReturn(s.close,63),tl6=safeSeriesReturn(s.calcClose,126)??safeSeriesReturn(s.close,126);
  rec.retTL1=tl1;rec.retTL3=tl3;rec.retTL6=tl6;
  rec.retUSD1=safeSeriesReturn(s.usd,21);rec.retUSD3=safeSeriesReturn(s.usd,63);rec.retUSD6=safeSeriesReturn(s.usd,126);
  rec.retXU1=safeSeriesReturn(s.index,21);rec.retXU3=safeSeriesReturn(s.index,63);rec.retXU6=safeSeriesReturn(s.index,126);
  rec.deg3Text=threeDayChangeText(rec);
  return rec;
}
function calculationGateStatus(){const summary=dataSummary(state.records),fillPct=Number(summary.fillPct||0),ok=fillPct>=70,gate={ok,missingSymbols:Number(summary.missingSymbolCount||0),missingColumns:(summary.incompleteColumns||summary.missingColumns||[]).length,rows:Number(summary.loadedSymbols||0),eligibleRows:Number(summary.calculationEligibleRows||0),fillPct,minFillPct:70,reason:ok?null:`Türev hesaplama kapısı: Veriler doluluğu %${fillPct.toFixed(2)} < %70; önceki Kn/K_Tarihsel/S/AL-SAT korunuyor`};return {summary,gate,reason:gate.reason};}
function calculationRecords(){const status=calculationGateStatus();if(!status.gate.ok)return [];const out=[];for(const source of state.records||[]){const rec=cloneForCalculation(source);normalizeCalculationRecord(rec);rec.calculationEligible=true;out.push(rec);}return out;}
globalThis.calculationRecords=calculationRecords;

const LOCAL_REPAIR_V117_KEY='aurum.runtime.localRepair.v117';
function recordNeedsLocalIntegrityRepair(rec){
  const raw=rec?.series?.close||[],calc=rec?.series?.calcClose||[],f=rec?.series?.adjustmentFactor||[];
  if(raw.some((x,i)=>validNumber(x)!=null&&Number(x)>0&&(!(validNumber(calc[i])!=null)||Number(calc[i])<=0)))return true;
  if(f.some(x=>validNumber(x)!=null&&Number(x)<=0))return true;
  if(validNumber(rec?.dayChange)!=null&&Number(rec.dayChange)<=-99.5)return true;
  return ['retTL1','retTL3','retTL6'].some(k=>validNumber(rec?.[k])!=null&&Number(rec[k])<=-99.5);
}
async function repairLegacyCorruptRecordsLocal(){
  const memo=readLocal(LOCAL_REPAIR_V117_KEY,null);if(memo?.complete)return memo;
  const candidates=(state.records||[]).filter(recordNeedsLocalIntegrityRepair);if(!candidates.length){const done={complete:true,at:nowISO(),repaired:0,failed:0};writeLocal(LOCAL_REPAIR_V117_KEY,done);return done;}
  const indexBundle=(await dbGet('meta','indexBundle'))?.value||{bars:[]},changedAt=nowISO();let repairedCount=0,failed=0;
  for(const old of candidates){try{
    const rebuilt=enrichBundle(bundleFromRecord(old),indexBundle),next={...old,...rebuilt};
    for(const k of ['marketDataAt','liveAt','marketTimeVerified','marketTimeProvider','apiAccessedAt','tableTransferredAt','datasetMarketAt','dataSnapshotId','jobId','jobMode','jobDataStatus','marketWindowEligible','marketWindowDeltaMinutes','providers','source','sourceAttempts','providerAttempts','provenance','companyCard','companyCardHistory','crossValidation','enrichmentMetrics','behaviorProfile','behaviorScore','behaviorType','genomeProfile','genomeScore','genomeProbability','genomeType'])if(k in old)next[k]=old[k];
    next.recordChangedAt=changedAt;next.provenance={...(old.provenance||{}),recordChangedAt:changedAt,localIntegrityRepair:'V117'};next.recordFingerprint=dataRecordFingerprint(next);
    await dbPut('records',{key:next.sym,value:next,updatedAt:changedAt});const ix=state.records.findIndex(x=>x.sym===next.sym);if(ix>=0)state.records[ix]=next;repairedCount++;
  }catch(e){failed++;try{await log('warn',`${old.sym}: yerel bütünlük onarımı başarısız`,{error:e?.message||String(e)})}catch{}}}
  state.recordMap=new Map(state.records.map(x=>[x.sym,x]));
  const classification=classifyDataCompleteness(state.records,currentSymbols());for(const rec of state.records){const e=classification.bySymbol.get(rec.sym);rec.emptyCellCount=e?.emptyCells??0;rec.calculationEligible=!!e?.eligible;rec.calculationExclusionReasons=e?.reasons||[];rec.incompleteColumns=classification.incompleteColumns;}
  if(repairedCount){const meta=(await dbGet('meta','activeDataSnapshot'))?.value||null;if(meta){meta.changedAt=changedAt;meta.fingerprint=dataTableFingerprint(state.records);meta.incompleteColumns=classification.incompleteColumns;await dbPut('meta',{key:'activeDataSnapshot',value:meta,updatedAt:changedAt});}for(const rec of state.records.filter(r=>candidates.some(c=>c.sym===r.sym)))await dbPut('records',{key:rec.sym,value:rec,updatedAt:changedAt});}
  const done={complete:failed===0,at:nowISO(),repaired:repairedCount,failed};if(done.complete)writeLocal(LOCAL_REPAIR_V117_KEY,done);return done;
}

const REPAIR_QUEUE_KEY='aurum.runtime.repairQueue.r73';
function r73RepairQueue(){const x=readLocal(REPAIR_QUEUE_KEY,[]);return Array.isArray(x)?x:[];}
function r73QueueAudit(result){const now=nowISO(),old=new Map(r73RepairQueue().map(x=>[x.id,x])),open=[];for(const i of (result?.issues||[])){const prev=old.get(i.id);open.push({id:i.id,detail:i.detail,severity:i.severity||'error',status:'OPEN',firstSeen:prev?.firstSeen||now,lastSeen:now});}writeLocal(REPAIR_QUEUE_KEY,open);return open;}
async function r73SchedulerDiagnostic(){const jobs=await dbAll('jobs'),times=schedulerConfiguredTimes(),auto=jobs.filter(j=>String(j.mode||'').toUpperCase()==='AUTO'||String(j.id||'').startsWith('AUTO|')),failed=auto.filter(j=>String(j.status||'')==='FAILED'),running=auto.filter(j=>operationBusyStatus(String(j.status||''))),completed=auto.filter(j=>String(j.status||'')==='COMPLETED'),badChain=completed.filter(j=>{const h=(j.history||[]).map(x=>x.status);return !['DATA_COMPLETED','KN_COMPLETED','K_TARIHSEL_COMPLETED','COMPLETED'].every(s=>h.includes(s));});return {ok:failed.length===0&&badChain.length===0,detail:`${times.length} slot · ${auto.length} AUTO job · ${running.length} aktif · ${failed.length} başarısız · ${badChain.length} eksik zincir`,failed:failed.map(x=>x.id),badChain:badChain.map(x=>x.id)};}
async function r73ExtendedAudit(){const r=tableCalculationAudit(),add=(id,ok,detail,severity='error')=>{const x={id,ok:!!ok,detail,severity};r.checks.push(x);if(!x.ok)r.issues.push({id,detail,severity});};
  add('BUTTON_COMMAND_DISPATCH',typeof operationCommand==='function'&&typeof cancelActiveOperation==='function','Çalıştır/İptal/Baştan Başlat/Temizle/Eksikleri Tamamla komut zinciri bağlı');
  add('TERMINAL_CANCEL',String(fetchWithTimeout).includes('OPERATION_CANCELLED')&&String(cancelActiveOperation).includes('HARD_CANCELLED_JOBS'),'Kullanıcı iptali retry edilmez; aktif fetch istekleri abort edilir ve eski job yeniden veri yayımlayamaz');
  const staged=await dbAll('stagingRecords'),jobs=await dbAll('jobs'),active=new Set(jobs.filter(j=>operationBusyStatus(String(j.status||''))).map(j=>j.id)),orph=staged.filter(x=>!active.has(x.jobId));add('STAGING_HEALTH',orph.length===0,`${staged.length} staging kaydı · ${orph.length} aktif işe bağlı olmayan kayıt`,'warn');
  add('FAST_PARALLEL_TRANSFER',state.settings?.adaptiveConcurrency!==false&&Number(state.settings?.providerWaveSize||0)>=12&&Number(state.settings?.maxGlobalConcurrency||0)>=24,`Adaptif ${state.settings?.adaptiveConcurrency!==false?'açık':'kapalı'} · global ${Number(state.settings?.maxGlobalConcurrency||0)} · provider dalga ${Number(state.settings?.providerWaveSize||0)}`,'warn');
  add('BACKGROUND_STAGING_QUEUE',typeof MessageChannel!=='undefined'&&String(stagePut).includes('scheduleStageFlush'),'Staging flush timer throttling yerine MessageChannel kuyruğunu kullanabilir','warn');
  const sched=await r73SchedulerDiagnostic();add('SCHEDULER_END_TO_END',sched.ok,sched.detail,'warn');r.scheduler=sched;r.summary.issues=r.issues.length;r.ok=r.issues.filter(x=>x.severity==='error').length===0;writeLocal(TABLE_AUDIT_KEY,r);r73QueueAudit(r);return r;}
function r73AuditRows(last){if(!last?.checks?.length)return '<small class="muted">Henüz denetim çalıştırılmadı.</small>';return `<div class="list">${last.checks.map(x=>`<div class="list-row"><div><b>${html(x.id)}</b><small>${html(x.detail||'')}</small></div><span class="badge ${x.ok?'ok':x.severity==='warn'?'warn':'bad'}">${x.ok?'OK':x.severity==='warn'?'UYARI':'HATA'}</span></div>`).join('')}</div>`;}
const TABLE_AUDIT_KEY='aurum.runtime.tableAudit.v117';
function countSuspiciousZeroColumns(records=state.records){const out=[];for(const field of V141225_ALL_HEADERS){if(field==='Hisse')continue;let zeros=0,nonzero=0,missing=0;for(const r of records||[]){const v=v141225Raw(r,field,true),n=vFinite(v);if(v===null||v===undefined||v===''||n==null){missing++;continue;}if(n===0)zeros++;else nonzero++;}if(zeros>=5&&(v141225ZeroMeansMissing(field,0)||nonzero===0))out.push({field,zeros,nonzero,missing});}return out;}
function tableCalculationAudit(){
  const summary=dataSummary(state.records),gate=dataIntegrityGate(summary),issues=[],checks=[];const add=(id,ok,detail,severity='error')=>{checks.push({id,ok,detail,severity});if(!ok)issues.push({id,detail,severity});};
  add('DATA_INTEGRITY_GATE',gate.ok,gate.ok?`Geçti · ${gate.missingSymbols} eksik hisse · ${gate.missingColumns} eksik sütun`:`Tablo oluşamaz · ${gate.missingSymbols} eksik hisse · ${gate.missingColumns} eksik sütun`);
  const zeroCols=countSuspiciousZeroColumns();add('SUSPICIOUS_ZERO_COLUMNS',zeroCols.length===0,zeroCols.length?`${zeroCols.length} sıfır/placeholder sütun: ${zeroCols.slice(0,12).map(x=>`${x.field}(${x.zeros})`).join(' · ')}`:'Sıfır placeholder sütun yok');
  const badAdj=(state.records||[]).filter(recordNeedsLocalIntegrityRepair).map(r=>r.sym);add('ADJUSTED_PRICE_INTEGRITY',badAdj.length===0,badAdj.length?`${badAdj.length} hisse bozuk düzeltilmiş fiyat/getiri: ${badAdj.slice(0,20).join(', ')}`:'Düzeltilmiş fiyat/getiri serileri tutarlı');
  const minus100=[];for(const r of state.records||[])for(const k of ['dayChange','retTL1','retTL3','retTL6','retUSD1','retUSD3','retUSD6','retXU1','retXU3','retXU6']){const n=vFinite(r?.[k]);if(n!=null&&n<=-99.5)minus100.push(`${r.sym}.${k}`);}add('IMPOSSIBLE_MINUS100',minus100.length===0,minus100.length?`${minus100.length} şüpheli ≤-99,5% değer: ${minus100.slice(0,20).join(' · ')}`:'Şüpheli -100% değeri yok');
  const bad3=[];for(const r of state.records||[]){if((r?.series?.close||[]).length<4)continue;const t=threeDayChangeText(r),parts=t?t.split(' | '):[];if(!t||parts.length!==3||parts.some(x=>!x.trim()))bad3.push(r.sym);}add('THREE_DAY_CELL',bad3.length===0,bad3.length?`${bad3.length} hissede 3 günlük hücre üç ayrı değer değil: ${bad3.slice(0,20).join(', ')}`:'3 günlük hücreler 3 ayrı gün ve " | " ayraçlı');
  const fmtTests=[[241.7,'241,70'],[1.596,'1,60'],[2.000015677,'2,00'],[0.004567,'0,0046']],fmtBad=fmtTests.filter(([v,e])=>globalThis.AurumNumberFormat(v,2)!==e);add('NUMBER_FORMAT',fmtBad.length===0,fmtBad.length?fmtBad.map(([v,e])=>`${v}=>${globalThis.AurumNumberFormat(v,2)} (beklenen ${e})`).join(' · '):'Ondalık gösterim kuralı geçti');
  const knBad=KN_V117_ORDER.filter(k=>(state.scores?.[k]||[]).length<20);add('KN_TOP20',knBad.length===0,knBad.length?`20 hisseden az Kn: ${knBad.map(k=>`${k}:${(state.scores?.[k]||[]).length}`).join(' · ')}`:'K1–K12 en az 20 hisse');
  const histRows=(()=>{try{return kh117Rows()}catch{return []}})(),histBad=[];for(const row of histRows)for(const k of KN_V117_ORDER)if((row.criteria?.[k]||[]).length<20)histBad.push(`${row._label||row.date}.${k}:${(row.criteria?.[k]||[]).length}`);add('K_HISTORICAL_TOP20',histBad.length===0,histBad.length?`Eksik K_Tarihsel hücreleri: ${histBad.slice(0,24).join(' · ')}`:'K_Tarihsel K1–K12 hücreleri 20 hisse');
  const obsolete=(state.runs||[]).filter(r=>r?.integrityRejected==='IMPOSSIBLE_MINUS100_RETURN');add('LEARNING_QUARANTINE',true,`${obsolete.length} bozuk eski dönem öğrenmeden karantinaya alındı`,'info');
  const result={schema:'aurum-table-audit/v1',at:nowISO(),ok:issues.filter(x=>x.severity==='error').length===0,summary:{universe:summary.universeCount,loaded:summary.loadedSymbols,eligible:summary.eligibleSymbols,missingStocks:gate.missingSymbols,missingColumns:gate.missingColumns,issues:issues.length},checks,zeroColumns:zeroCols,missingColumns:(summary.incompleteColumns||[]).slice(),missingSymbols:(summary.missingSymbols||[]).slice(),issues};writeLocal(TABLE_AUDIT_KEY,result);return result;
}
function auditResultMarkup(result){const badge=result.ok?'ok':'bad';return `<section class="aurum-audit-result"><div class="list-row"><b>Denetim sonucu</b><span class="badge ${badge}">${result.ok?'GEÇTİ':'HATA BULUNDU'}</span></div><small>${html(formatTableTime(result.at))} · ${result.summary.issues} bulgu</small><div class="list">${result.checks.map(x=>`<div class="list-row"><div><b>${html(x.id)}</b><small>${html(x.detail)}</small></div><span class="badge ${x.ok?'ok':x.severity==='info'?'warn':'bad'}">${x.ok?'OK':x.severity==='info'?'BİLGİ':'HATA'}</span></div>`).join('')}</div></section>`;}
async function runTableCalculationAudit(){const result=await r73ExtendedAudit(),body=document.querySelector('#dialogBody'),dialog=document.querySelector('#detailDialog');if(body&&dialog){body.innerHTML=auditResultMarkup(result)+`<div class="card notice"><small>${Number(result.issues?.length||0)} açık bulgu Sorunları Gider / Onarım bölümüne kaydedildi. Bu modül onarım yapmaz.</small></div>`;try{if(!dialog.open)dialog.showModal()}catch{}}renderCurrentPagePreservingView();return result;}
function tableAuditSettingsModule(){const last=readLocal(TABLE_AUDIT_KEY,null),q=r73RepairQueue();return `<details class="card gold-edge aurum-settings-details aurum-table-audit-settings"><summary class="aurum-settings-summary"><div><strong>Tablo ve Hesaplama Denetimi</strong><small>Hesaplama · tablo · komut · staging · hız · zamanlayıcı denetimi; yalnız raporlar</small></div><span class="aurum-details-chevron" aria-hidden="true">⌄</span></summary><div class="aurum-settings-details-body"><div class="list-row"><div><strong>Tam teşhis ve hesaplama denetimi</strong><small>Veri değiştirmez ve onarım yapmaz. Her kontrolün sonucu aşağıda ayrı satırda raporlanır.</small></div><span class="badge ${last?.ok?'ok':last?'bad':'warn'}">${last?.ok?'SON DENETİM OK':last?'BULGU VAR':'ÇALIŞTIRILMADI'}</span></div><div class="actions"><button type="button" class="gold-btn" onclick="runTableCalculationAudit()">Tam Denetimi Çalıştır</button></div><h3>Denetim Raporları</h3>${r73AuditRows(last)}<div class="list-row"><div><strong>Onarım için kayıt</strong><small>${q.length?`${q.length} açık bulgu Sorunları Gider / Onarım bölümüne kaydedildi.`:'Açık onarım kaydı yok.'}</small></div><span class="badge ${q.length?'bad':'ok'}">${q.length?q.length:'TEMİZ'}</span></div>${last?`<small class="muted">Son: ${html(formatTableTime(last.at))} · ${Number(last.summary?.issues||0)} bulgu</small>`:''}</div></details>`;}

async function createJob(mode,trigger,scheduledAt=null,stage='DATA',existingId=null){const id=existingId||(`${mode==='AUTO'?'AUTO':'MANUAL'}|${scheduledAt||makeId('RUN')}`),existing=await getJob(id);if(existing&&['COMPLETED','FETCHING_DATA','KN_RUNNING','K_TARIHSEL_RUNNING','S_RUNNING','WAITING_FOR_NETWORK','RETRY_PENDING','DATA_COMPLETED','KN_COMPLETED','K_TARIHSEL_COMPLETED'].includes(existing.status))return existing;const job={id,jobId:id,mode,trigger,scheduledAt,startedAt:nowISO(),completedAt:null,status:mode==='AUTO'?JOB_STATUS.SCHEDULED:JOB_STATUS.IDLE,currentStage:stage,retryCount:0,error:null,dataSnapshotId:`DATA|${Date.now().toString(36)}|${Math.random().toString(36).slice(2,8)}`,processedSymbols:0,totalSymbols:currentSymbols().length,sourceStats:{},history:[]};await saveJob(job);return job;}
async function transition(job,status,extra={}){job.status=status;Object.assign(job,extra);job.history=[...(job.history||[]),{status,at:nowISO(),stage:job.currentStage,error:extra.error||null}].slice(-80);await saveJob(job);const isData=job.currentStage==='Veriler';const done=extra.done??(isData?(job.processedSymbols||0):(/COMPLETED$/.test(status)||status==='COMPLETED'?1:0)),total=extra.total??(isData?(job.totalSymbols||0):1);setRuntime({status,jobId:job.id,mode:job.mode,stage:job.currentStage,done,total,message:extra.error?`${extra.message||status} · ${extra.error}`:(extra.message||''),error:extra.error||null});return job;}

async function prepareGeneralData(job,mode='GENERAL'){
  const universe=currentSymbols(),__resumeStage=['FETCHING_DATA','WAITING_FOR_NETWORK','RETRY_PENDING'].includes(String(job?.status||''));job.totalSymbols=universe.length;job.currentStage='Veriler';job.requestedDataMode=mode;
  const __resumeRows=__resumeStage?await stageRows(job.id):[];const __resumeFresh=new Set(__resumeRows.filter(x=>x?.record?.jobDataStatus==='FRESH').map(x=>x.sym));job.processedSymbols=__resumeFresh.size;
  await transition(job,JOB_STATUS.FETCHING_DATA,{message:__resumeFresh.size?`Geçici depodan devam · ${__resumeFresh.size}/${universe.length} hazır`:'Kaynaklar taranıyor · adaptif paralellik',done:__resumeFresh.size,total:universe.length});state.syncing=true;state.sourceStats={};if(!__resumeStage)await clearStage(job.id);
  try{
    await pauseCheckpoint(job,JOB_STATUS.FETCHING_DATA);
    if(!isOnline()){await transition(job,JOB_STATUS.WAITING_FOR_NETWORK,{error:'OFFLINE',message:'Ağ bağlantısı bekleniyor'});return false;}
    try{await refreshKapDirectoryIfDue()}catch(e){await log('warn','Şirket dizini güncellenemedi; veri job devam ediyor',{error:e?.message||String(e)})}
    const end=new Date(),start=addMonths(end,-Number(state.settings.monthsBack||14)),indicatorPromise=refreshMarketIndicators();let indexBundle=(await dbGet('meta','indexBundle'))?.value||{bars:[]};
    if(mode!=='LIVE'){try{const fresh=await fetchIndexBundle(start,end);indexBundle=mergeBundles(INDEX_SYMBOL,[indexBundle,fresh]);await dbPut('meta',{key:'indexBundle',value:indexBundle,updatedAt:nowISO()})}catch(e){await issue(job,INDEX_SYMBOL,'index','ALL','INDEX_FETCH_FAILED',e?.message||String(e));}}
    const canonicalPoint=await resolveCanonicalMarketPoint(start,end);if(canonicalPoint?.timestampVerified&&safeTime(canonicalPoint.at)!=null){job.canonicalMarketAt=canonicalPoint.at;job.canonicalMarketProvider=canonicalPoint.provider||'XU100';}else{job.canonicalMarketAt=null;job.canonicalMarketProvider=null;await issue(job,INDEX_SYMBOL,'VeriZamani','ALL','CANONICAL_MARKET_TIME_UNAVAILABLE_CONTINUE_HISTORY',canonicalPoint?.attempts||[]);}job.canonicalMarketAttempts=canonicalPoint?.attempts||[];await saveJob(job);
    let cursor=0,completed=__resumeFresh.size,critical=0;const concurrency=adaptiveWorkerCount(Math.max(1,universe.length-__resumeFresh.size));job.symbolScanPolicy={sequential:false,concurrency,skipUnavailable:true,automaticExhaustiveRepair:false,providerPool:await providerOrder(false)};await saveJob(job);
    const worker=async()=>{while(true){
      await pauseCheckpoint(job,JOB_STATUS.FETCHING_DATA);const idx=cursor++;if(idx>=universe.length)break;const sym=universe[idx];if(__resumeFresh.has(sym)){continue;}const prior=state.recordMap.get(sym)||null,base=prior?bundleFromRecord(prior):null;let rec=null,issues=[];
      try{
        const symbolStart=mode==='FULL'?start:(prior?.latestDate?dateBefore(prior.latestDate,14):start),onSource=({symbol,provider})=>setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',done:completed,total:universe.length,message:`${symbol} · ${sourceName(provider)}`,symbol,provider});
        const bundle=await fetchSymbolBundle(sym,symbolStart,end,{mode,baseBundle:base,onSource});
        const successfulAttempts=(bundle.attempts||[]).filter(a=>a?.status==='OK');
        if(!successfulAttempts.length)throw Object.assign(new Error('NO_PROVIDER_SUCCESS'),{code:'NO_PROVIDER_SUCCESS'});
        const merged=mergeBundles(sym,[bundle]);let candidate=enrichBundle(merged,indexBundle);try{candidate=globalThis.AurumIsYatirimCompanyCard?.attachCached?.(candidate,{allowStale:false})||candidate;}catch(_){}const windowCheck=job.canonicalMarketAt?marketWindowCheck(candidate,job.canonicalMarketAt):{ok:false,reason:'CANONICAL_MARKET_TIME_UNAVAILABLE',deltaMinutes:null};candidate.unresolvedFields=bundleRecordMissingFields(candidate);candidate.providerAttempts=[...(bundle.attempts||[])];candidate.dataSnapshotId=job.dataSnapshotId;candidate.jobId=job.id;candidate.jobMode=job.mode;candidate.jobDataStatus='FRESH';candidate.marketWindowEligible=windowCheck.ok;candidate.marketWindowDeltaMinutes=windowCheck.deltaMinutes;candidate.provenance={sources:candidate.providers||[],marketAt:candidate.marketDataAt||null,marketTimeVerified:candidate.marketTimeVerified===true,marketTimeProvider:candidate.marketTimeProvider||null,receivedAt:merged.receivedAt||null,validatedAt:nowISO(),jobId:job.id,canonicalMarketAt:job.canonicalMarketAt,marketWindowDeltaMinutes:windowCheck.deltaMinutes};
        if(!windowCheck.ok)await issue(job,sym,'VeriZamani','ALL',windowCheck.reason||'MARKET_TIME_WINDOW_UNAVAILABLE_BUT_DATA_KEPT',{marketAt:candidate.marketDataAt||null,canonicalMarketAt:job.canonicalMarketAt,deltaMinutes:windowCheck.deltaMinutes});
        const vr=validateRecord(candidate,sym);if(!vr.ok)throw Object.assign(new Error(vr.issues.join(',')),{code:'RECORD_VALIDATION'});rec=candidate;
      }catch(e){issues.push(e?.code||e?.message||String(e));await issue(job,sym,'*','ALL','FETCH_OR_VALIDATE_FAILED',e?.message||String(e));rec=makePlaceholder(sym,prior,issues);rec.unresolvedFields=prior?bundleRecordMissingFields(rec):['*'];if(!prior)critical++;}
      await stagePut(job.id,sym,rec);completed++;job.processedSymbols=completed;const completedSource=(rec?.providers||[]).find(x=>x&&x!=='LOCAL_PREVIOUS')||(rec?.providers||[])[0]||null;setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',done:completed,total:universe.length,message:rec?.jobDataStatus==='FRESH'?(completedSource?`${sym} · ${sourceName(completedSource)}`:sym):`${sym} · pas geçildi, önceki veri korundu`,symbol:sym,provider:completedSource});if(completed%48===0)await saveJob(job);await pauseCheckpoint(job,JOB_STATUS.FETCHING_DATA);
    }};
    await Promise.all(Array.from({length:concurrency},worker));await indicatorPromise.catch(()=>null);await flushStageBatch(job.id);await pauseCheckpoint(job,JOB_STATUS.FETCHING_DATA);
    /* R22 snapshot-coherence: do not publish a half-new/half-old market snapshot. Missing or stale
       symbols remain in durable staging and are retried from alternative providers. */
    const __repair=await repairStagedIntegrity(job,universe,start,end,indexBundle);await flushStageBatch(job.id);
    const staged=(await stageRows(job.id)).map(x=>x.record),freshStaged=staged.filter(x=>x?.jobDataStatus==='FRESH'),__notFresh=universe.filter(sym=>!staged.some(r=>r?.sym===sym&&r?.jobDataStatus==='FRESH')),marketFreshStaged=freshStaged.filter(x=>x?.marketWindowEligible===true),temporal=liveTemporalAudit(marketFreshStaged);
    if(__notFresh.length){job.retryCount=(job.retryCount||0)+1;job.pendingFreshSymbols=__notFresh.slice();job.integrityRepairRounds=__repair?.roundLog||job.integrityRepairRounds||[];await transition(job,JOB_STATUS.RETRY_PENDING,{error:'INCOMPLETE_FRESH_SNAPSHOT',message:`Tutarlı snapshot bekleniyor · ${freshStaged.length}/${universe.length} taze · ${__notFresh.length} hisse staging'de tamamlanacak`,done:freshStaged.length,total:universe.length});return false;}
    if(!__repair?.gate?.ok){job.retryCount=(job.retryCount||0)+1;await transition(job,JOB_STATUS.RETRY_PENDING,{error:'DATA_FILL_BELOW_70',message:`Veri doluluğu %${Number(__repair?.gate?.fillPct||0).toFixed(1)} · %70 eşiği aşılmadı; mevcut tablolar ve zaman damgaları korunuyor`,done:freshStaged.length,total:universe.length});return false;}\n    if(!freshStaged.length)throw Object.assign(new Error('NO_FRESH_DATA_TRANSFERRED'),{code:'NO_FRESH_DATA_TRANSFERRED'});
    if(marketFreshStaged.length&&!temporal.ok)throw new Error('MARKET_TIME_WINDOW_VIOLATION_BEFORE_PUBLISH');
    const published=await atomicPublish(job,universe),freshPublished=published.filter(x=>x?.jobDataStatus==='FRESH'),marketFreshPublished=freshPublished.filter(x=>x?.marketWindowEligible===true),summary=dataSummary(published),postTemporal=liveTemporalAudit(marketFreshPublished),repairPlan=await persistPendingRepairPlan(published,universe);
    if(!freshPublished.length)throw Object.assign(new Error('NO_FRESH_DATA_PUBLISHED'),{code:'NO_FRESH_DATA_PUBLISHED'});
    summary.transferredFreshSymbols=freshPublished.length;summary.integrityRepairRounds=[];summary.integrityGate=dataIntegrityGate(summary);summary.pendingRepair=repairPlan;summary.missingSymbolDetails=(summary.missingSymbolDetails||[]).map(d=>{const x=(job.excludedSymbols||[]).find(e=>e.sym===d.sym);return x?{...d,...x}:d;});if(marketFreshPublished.length&&!postTemporal.ok)throw new Error('MARKET_TIME_WINDOW_VIOLATION_AFTER_PUBLISH');
    job.sourceStats={...state.sourceStats};job.dataSummary=summary;job.liveTemporalAudit=postTemporal;job.criticalUnavailable=critical;job.pendingRepair=repairPlan;state.lastSuccessfulSync=nowISO();await dbPut('meta',{key:'lastSuccessfulSync',value:state.lastSuccessfulSync,updatedAt:state.lastSuccessfulSync});await dbPut('meta',{key:'lastDataSummary',value:summary,updatedAt:nowISO()});await persistLiveSnapshots(job.dataSnapshotId);await pruneSnapshots();await clearStage(job.id);await refreshTableMeta();await transition(job,JOB_STATUS.DATA_COMPLETED,{message:`${summary.transferredFreshSymbols}/${summary.universeCount} fresh hisse · ${repairPlan.symbolCount} onarım bekliyor`,done:universe.length,total:universe.length});return true;
  }catch(e){job.error=e?.message||String(e);if(e?.code==='OPERATION_CANCELLED'||cancelRequested(job)){await transition(job,JOB_STATUS.IDLE,{error:null,message:'İşlem iptal edildi · önceki tablo korundu'});return false;}if(!isOnline()||/network|offline|failed to fetch|ERR_/i.test(job.error)){job.retryCount=(job.retryCount||0)+1;await transition(job,job.retryCount<=Number(state.settings.maxJobRetries??MAX_JOB_RETRIES)?JOB_STATUS.WAITING_FOR_NETWORK:JOB_STATUS.FAILED,{error:job.error,message:job.retryCount<=Number(state.settings.maxJobRetries??MAX_JOB_RETRIES)?'Ağ bağlantısı bekleniyor':'Azami retry aşıldı'});}else await transition(job,JOB_STATUS.FAILED,{error:job.error,message:'Veri aktarımı başarısız · önceki tablo korundu'});return false;
  }finally{try{await flushStageBatch(job.id)}catch{}state.syncing=false;clearCancel(job.id);renderCurrentPagePreservingView();}
}

async function prepareMissingData(job){
  const initialPlan=currentPendingRepairPlan(),targets=initialPlan.items.map(x=>x.sym),__resumeStage=['FETCHING_DATA','WAITING_FOR_NETWORK','RETRY_PENDING'].includes(String(job?.status||''));const __resumeRows=__resumeStage?await stageRows(job.id):[],__resumeFresh=new Set(__resumeRows.filter(x=>x?.record?.jobDataStatus==='FRESH').map(x=>x.sym));job.totalSymbols=targets.length;job.currentStage='Veriler';job.processedSymbols=__resumeFresh.size;job.requestedDataMode='REPAIR';await transition(job,JOB_STATUS.FETCHING_DATA,{message:targets.length?(__resumeFresh.size?`Eksik onarımına staging'den devam · ${__resumeFresh.size}/${targets.length}`:'Yalnız eksikler onarılıyor · adaptif paralellik'):'Eksik veri yok',done:__resumeFresh.size,total:targets.length});state.syncing=true;state.sourceStats={};if(!__resumeStage)await clearStage(job.id);
  try{
    if(!targets.length){await transition(job,JOB_STATUS.DATA_COMPLETED,{message:'Eksik hisse/hücre yok',done:0,total:0});return true;}
    if(!isOnline()){await transition(job,JOB_STATUS.WAITING_FOR_NETWORK,{error:'OFFLINE',message:'Ağ bağlantısı bekleniyor'});return false;}
    const end=new Date(),start=addMonths(end,-Number(state.settings.monthsBack||14));let indexBundle=(await dbGet('meta','indexBundle'))?.value||{bars:[]};try{const fresh=await fetchIndexBundle(start,end);indexBundle=mergeBundles(INDEX_SYMBOL,[indexBundle,fresh]);await dbPut('meta',{key:'indexBundle',value:indexBundle,updatedAt:nowISO()})}catch(e){await issue(job,INDEX_SYMBOL,'index','ALL','INDEX_FETCH_FAILED',e?.message||String(e));}
    const canonicalPoint=await resolveCanonicalMarketPoint(start,end);if(canonicalPoint?.timestampVerified&&safeTime(canonicalPoint.at)!=null){job.canonicalMarketAt=canonicalPoint.at;job.canonicalMarketProvider=canonicalPoint.provider||'XU100';job.canonicalMarketAttempts=canonicalPoint.attempts||[];await saveJob(job);}else throw new Error('CANONICAL_MARKET_TIME_UNAVAILABLE');
    let cursor=0,completed=__resumeFresh.size;const concurrency=adaptiveWorkerCount(Math.max(1,targets.length-__resumeFresh.size));job.symbolScanPolicy={sequential:false,concurrency,repairOnly:true,targetCount:targets.length,fullSourceRounds:1,failedProviderRetry:true,companyCardRepair:true,financialStatementRepair:true};await saveJob(job);
    const worker=async()=>{while(true){await pauseCheckpoint(job,JOB_STATUS.FETCHING_DATA);const idx=cursor++;if(idx>=targets.length)break;const sym=targets[idx];if(__resumeFresh.has(sym))continue;const prior=state.recordMap.get(sym)||null,base=prior?.series?.date?.length?bundleFromRecord(prior):null,beforeMissing=prior?bundleRecordMissingFields(prior):['*'];let rec=prior?JSON.parse(JSON.stringify(prior)):makePlaceholder(sym,null,['REPAIR_TARGET_NO_PRIOR']);
      try{const deep=beforeMissing[0]==='*'||missingNeedsDeepHistory(beforeMissing),symbolStart=deep?start:(prior?.latestDate?dateBefore(prior.latestDate,14):start),onSource=({provider})=>setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',done:completed,total:targets.length,message:`${sym} · yalnız eksikler · ${sourceName(provider)}`,symbol:sym,provider});let bundle=await fetchSymbolBundle(sym,symbolStart,end,{mode:'FORCE_ALL',baseBundle:base,onSource});if(!(bundle.attempts||[]).some(a=>a?.status==='OK'))throw Object.assign(new Error('NO_PROVIDER_SUCCESS'),{code:'NO_PROVIDER_SUCCESS'});let candidate=enrichBundle(mergeBundles(sym,[bundle]),indexBundle);candidate=await enrichRepairFromCompanyCard(candidate,job,sym);let windowCheck=marketWindowCheck(candidate,job.canonicalMarketAt),afterMissing=bundleRecordMissingFields(candidate);
        const failedProviders=[...new Set((bundle.attempts||[]).filter(x=>x.status==='ERROR').map(x=>x.provider).filter(Boolean))];if(afterMissing.length&&failedProviders.length){try{const priorAttempts=[...(bundle.attempts||[])],retry=await fetchSymbolBundle(sym,symbolStart,end,{mode:'FORCE_ALL',baseBundle:bundle,providers:failedProviders,onSource});bundle=mergeBundles(sym,[bundle,retry]);bundle.attempts=[...priorAttempts,...(retry.attempts||[])];candidate=enrichBundle(bundle,indexBundle);candidate=await enrichRepairFromCompanyCard(candidate,job,sym);windowCheck=marketWindowCheck(candidate,job.canonicalMarketAt);afterMissing=bundleRecordMissingFields(candidate);}catch(e){await issue(job,sym,'*','ALL','FAILED_PROVIDER_RETRY_FAILED',e?.message||String(e));}}
        candidate.unresolvedFields=afterMissing;candidate.providerAttempts=[...(bundle.attempts||[])];candidate.dataSnapshotId=job.dataSnapshotId;candidate.jobId=job.id;candidate.jobMode=job.mode;candidate.jobDataStatus='FRESH';candidate.marketWindowEligible=windowCheck.ok;candidate.marketWindowDeltaMinutes=windowCheck.deltaMinutes;candidate.repairOnly=true;candidate.repairAttemptedAt=nowISO();candidate.provenance={...(candidate.provenance||{}),sources:candidate.providers||[],marketAt:candidate.marketDataAt||null,marketTimeVerified:candidate.marketTimeVerified===true,marketTimeProvider:candidate.marketTimeProvider||null,validatedAt:nowISO(),jobId:job.id,canonicalMarketAt:job.canonicalMarketAt,marketWindowDeltaMinutes:windowCheck.deltaMinutes,repairOnly:true};const vr=validateRecord(candidate,sym);if(!windowCheck.ok||!vr.ok)throw new Error(!windowCheck.ok?(windowCheck.reason||'MARKET_TIME_WINDOW_FAILED'):vr.issues.join(','));const improved=!prior||beforeMissing[0]==='*'||afterMissing.length<beforeMissing.length||prior?.jobDataStatus!=='FRESH';if(improved)rec=candidate;else{rec=JSON.parse(JSON.stringify(prior));rec.repairAttemptedAt=nowISO();rec.repairLastError='Yeni eksik hücre kazanımı olmadı';}}
      catch(e){await issue(job,sym,'*','ALL','TARGETED_REPAIR_FAILED',e?.message||String(e));rec=prior?JSON.parse(JSON.stringify(prior)):makePlaceholder(sym,null,[e?.message||String(e)]);rec.repairAttemptedAt=nowISO();rec.repairLastError=e?.message||String(e);}
      await stagePut(job.id,sym,rec);completed++;job.processedSymbols=completed;setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',done:completed,total:targets.length,message:`${sym} · onarım denendi`,symbol:sym,provider:null});if(completed%8===0){await saveJob(job);await new Promise(r=>setTimeout(r,0));}
    }};
    await Promise.all(Array.from({length:concurrency},worker));const result=await atomicRepairPublish(job,targets),summary=dataSummary(result.records);summary.pendingRepair=result.plan;summary.integrityGate=dataIntegrityGate(summary);job.dataSummary=summary;job.pendingRepair=result.plan;await dbPut('meta',{key:'lastDataSummary',value:summary,updatedAt:nowISO()});await clearStage(job.id);await refreshTableMeta();await transition(job,JOB_STATUS.DATA_COMPLETED,{message:`Onarım: ${targets.length} hedef · ${result.plan.symbolCount} hedef kaldı`,done:targets.length,total:targets.length});return true;
  }catch(e){job.error=e?.message||String(e);if(e?.code==='OPERATION_CANCELLED'||cancelRequested(job)){await transition(job,JOB_STATUS.IDLE,{error:null,message:'Onarım iptal edildi · mevcut tablo korundu'});return false;}if(!isOnline()||/network|offline|failed to fetch|ERR_/i.test(job.error)){job.retryCount=(job.retryCount||0)+1;await transition(job,job.retryCount<=Number(state.settings.maxJobRetries??MAX_JOB_RETRIES)?JOB_STATUS.WAITING_FOR_NETWORK:JOB_STATUS.FAILED,{error:job.error,message:job.retryCount<=Number(state.settings.maxJobRetries??MAX_JOB_RETRIES)?'Ağ bağlantısı bekleniyor':'Azami retry aşıldı'});}else await transition(job,JOB_STATUS.FAILED,{error:job.error,message:'Eksik veri onarımı başarısız · mevcut tablo korundu'});return false;
  }finally{try{await flushStageBatch(job.id)}catch{}state.syncing=false;clearCancel(job.id);renderCurrentPagePreservingView();}
}

async function prepareData(job,mode='GENERAL'){const normalized=normalizeMode(mode);return normalized==='REPAIR'?prepareMissingData(job):prepareGeneralData(job,normalized);}

function activeSnapshot(){return readLocal('aurum.runtime.active.snapshot.v1',null)||(state.db?null:null)}
async function currentSnapshotMeta(){return (await dbGet('meta','activeDataSnapshot'))?.value||null}
async function markDerivedUpdate(kind){state.lastDerivedUpdate=nowISO();await dbPut('meta',{key:'lastDerivedUpdate',value:state.lastDerivedUpdate,kind,updatedAt:state.lastDerivedUpdate});return state.lastDerivedUpdate}
function manualSequence(){return readLocal(MANUAL_SEQUENCE_KEY,{dataSnapshotId:null,dataJobId:null,kn:false,history:false,s:false,updatedAt:null})}
function saveManualSequence(x){x.updatedAt=nowISO();writeLocal(MANUAL_SEQUENCE_KEY,x);return x}
function prerequisiteMessage(stage){return stage==='KN'?'Önce tamamlanmış ve hesaplamaya uygun bir Veriler snapshotı gerekli.':stage==='HISTORY'?'Önce mevcut Veriler snapshotı için Kn tamamlanmalı.':'Önce mevcut Veriler snapshotı için K_Tarihsel tamamlanmalı.'}
function warnOrder(stage,detail=''){showAurumNotice(detail||prerequisiteMessage(stage),'info',3600);return false}
async function activeCalculableSnapshot(){const meta=await currentSnapshotMeta();if(!meta?.snapshotId)return null;const integrity=calculationGateStatus(),rows=integrity.gate.ok?calculationRecords():[];return {meta,rows,count:rows.length,integrity}}
function operationFailureNotice(label,job,fallback){const detail=job?.error||job?.message||fallback||`${label} işlemi tamamlanamadı`;showAurumNotice(`${label}: ${detail}`,'error',4400);return false}


/* ===== Kn + K_Tarihsel clean rebuild v117 =====
   Single implementation. Previous compact/summary renderers are intentionally not used.
   Formulas remain the canonical buildModels/rebuildModelViews pipeline from the preserved model layer. */
const KN_V117_MIN_ROWS=20;
const KN_V117_ORDER=Object.freeze(['K1','K2','K3','K4','K5','K6','K7','K8','K9','K10','K11','K12']);
const KN_V117_SEAT_ORDER=Object.freeze(['K1','K2','K3','K4','K5','K6','K7']);
const KN_V117_TREND=KN_V117_SEAT_ORDER;
const KN_V117_LEDGER_KEY='aurum.kn.ledger.v117';
const KN_V117_ACTIVE_KEY='aurum.kn.active.v117';

function kn117ReadLedger(){const x=readLocal(KN_V117_LEDGER_KEY,{schema:2,active:{},closed:[],changes:{},updatedAt:null});if(!x.active||typeof x.active!=='object')x.active={};if(!Array.isArray(x.closed))x.closed=[];if(!x.changes||typeof x.changes!=='object')x.changes={};for(const k of KN_V117_ORDER)if(!x.changes[k]||typeof x.changes[k]!=='object')x.changes[k]={gln:null,gdn:null};return x;}
function kn117WriteLedger(x){x.schema=2;x.updatedAt=nowISO();writeLocal(KN_V117_LEDGER_KEY,x);return x;}
function kn117LatestPrice(rec){const p=Number(rec?.livePrice);if(Number.isFinite(p)&&p>0)return p;const a=rec?.series?.calcClose||rec?.series?.close||[];for(let i=a.length-1;i>=0;i--){const x=Number(a[i]);if(Number.isFinite(x)&&x>0)return x}return null;}
function kn117MarketTime(rec){return rec?.marketDataAt||rec?.provenance?.marketAt||rec?.datasetMarketAt||rec?.apiAccessedAt||rec?.tableTransferredAt||rec?.storedAt||TABLE_META?.data?.market||TABLE_META?.data?.transfer||null;}
function kn117UpdateLedger(at=nowISO()){
  const ledger=kn117ReadLedger(),topN=Math.max(KN_V117_MIN_ROWS,Number(state?.settings?.topN||20));
  for(const k of KN_V117_ORDER){
    const tradeEligible=KN_V117_SEAT_ORDER.includes(k),old=ledger.active[k]&&typeof ledger.active[k]==='object'?ledger.active[k]:{},next={},rows=(state.scores?.[k]||[]).slice(0,topN),current=new Set(rows.map(x=>x.sym)),priorSyms=Object.keys(old),incoming=rows.map(x=>x.sym).filter(sym=>!old[sym]),outgoing=priorSyms.filter(sym=>!current.has(sym));
    for(const [sym,e] of Object.entries(old))if(!current.has(sym)){
      const closed={...e,sym,criterion:k,exitTime:at};
      if(tradeEligible)closed.exitPrice=kn117LatestPrice(state.recordMap.get(sym));
      else{delete closed.entryPrice;delete closed.currentReturn;delete closed.lastPrice;delete closed.exitPrice;}
      ledger.closed.unshift(closed);
    }
    for(const row of rows){
      const rec=row.record||state.recordMap.get(row.sym),prior=old[row.sym];
      if(tradeEligible){
        const price=kn117LatestPrice(rec),entry=prior||{criterion:k,sym:row.sym,entryPrice:price,entryTime:at,entryDate:rec?.latestDate||trParts().date},ep=Number(entry.entryPrice),ret=Number.isFinite(price)&&price>0&&Number.isFinite(ep)&&ep>0?100*(price/ep-1):null;
        next[row.sym]={...entry,lastPrice:price,lastSeen:at,currentReturn:Number.isFinite(ret)&&ret>-99.5?ret:null,score:Number(row.score)};
      }else{
        next[row.sym]={criterion:k,sym:row.sym,lastSeen:at,score:Number(row.score)};
      }
    }
    const c=ledger.changes[k]||{gln:null,gdn:null,baselineAt:null};if(!priorSyms.length){c.baselineAt=c.baselineAt||at;}else{if(incoming.length)c.gln={symbols:incoming.slice(0,topN),at};if(outgoing.length)c.gdn={symbols:outgoing.slice(0,topN),at};}ledger.changes[k]=c;ledger.active[k]=next;
  }
  ledger.closed=ledger.closed.slice(0,2400);return kn117WriteLedger(ledger);
}
function kn117Entry(k,sym){return kn117ReadLedger().active?.[k]?.[sym]||null;}
function kn117RequireTop20(){const bad=[];for(const k of KN_V117_ORDER){const n=(state.scores?.[k]||[]).length;if(n<KN_V117_MIN_ROWS)bad.push(`${k}:${n}`)}if(bad.length)throw new Error(`Kn Top20 eksik: ${bad.join(' · ')}`);return true;}
function kn117Fmt(v,d=2){if(v===null||v===undefined||(typeof v==='string'&&!v.trim()))return '—';const n=Number(v);if(Number.isFinite(n))return globalThis.AurumNumberFormat?globalThis.AurumNumberFormat(n,d):fmt(n,d);return '—';}
function kn117Pct(v){if(v===null||v===undefined||(typeof v==='string'&&!v.trim()))return '—';const n=Number(v);return Number.isFinite(n)?`${n>=0?'+':''}${kn117Fmt(n,2)}%`:'—';}
function kn117Time(v){return v?formatTableTime(v):'—';}
function kn117LastClose(rec){return kn117LatestPrice({...rec,livePrice:null});}
function kn117ThreeDayText(rec){return threeDayChangeText(rec)||'—';}
function kn117DayChange(rec){return safeRecordDayChange(rec);}
function kn117Levels(rec,kind){const direct=kind==='support'?(rec?.support||rec?.supports||rec?.supportLevels):(rec?.resistance||rec?.resistances||rec?.resistanceLevels);let vals=(Array.isArray(direct)?direct:[]).map(Number).filter(x=>Number.isFinite(x)&&x>0);if(vals.length<3){const a=kind==='support'?(rec?.series?.calcLow||rec?.series?.low||[]):(rec?.series?.calcHigh||rec?.series?.high||[]),tail=a.slice(-30).map(Number).filter(x=>Number.isFinite(x)&&x>0),px=kn117LatestPrice(rec);const candidates=kind==='support'?tail.filter(x=>!Number.isFinite(px)||x<=px).sort((a,b)=>b-a):tail.filter(x=>!Number.isFinite(px)||x>=px).sort((a,b)=>a-b);for(const x of candidates)if(!vals.some(v=>Math.abs(v-x)<=Math.max(.000001,Math.abs(x)*.0005)))vals.push(x);}
  vals=vals.slice(0,3);return vals.length?vals.map(x=>kn117Fmt(x,2)).join(' | '):'—';
}
function kn117Memberships(sym){return KN_V117_ORDER.filter(k=>(state.scores?.[k]||[]).slice(0,Math.max(KN_V117_MIN_ROWS,Number(state.settings?.topN||20))).some(x=>x.sym===sym)).join(' · ')||'—';}
function kn117Reason(x,k){const r=x.record||{},m=state.modelBySym.get(x.sym)||{},parts=[`${k} #${(state.scores?.[k]||[]).findIndex(z=>z.sym===x.sym)+1}`,`Skor ${kn117Fmt(x.score,2)}`,`Davranış ${kn117Fmt(r.behaviorScore,2)}`,`DNA ${kn117Fmt(r.genomeScore,2)}`,`Hedef ${Number.isFinite(m.targetProbability)?kn117Fmt(m.targetProbability*100,2)+'%':'—'}`,`ATR ${kn117Pct(r.atrPct)}`,`Hacim ${kn117Fmt(r.volumeBreakout,2)}x`,`Kalite ${Number.isFinite(r.quality)?kn117Fmt(r.quality,2):'—'}`];return parts.join(' · ');}
function kn117Symbol(sym){const code=String(sym||'').trim().toUpperCase();return `<button type="button" class="symbol aurum-symbol-link" onclick="event.stopPropagation();showCompanyName('${html(code)}')">${html(code)}</button>`;}
function kn117RenderCriterion(k){
  const key=KN_V117_ORDER.includes(k)?k:'K1';state.strictActiveKn=key;writeLocal(KN_V117_ACTIVE_KEY,key);
  const rows=(state.scores?.[key]||[]).slice(0,Math.max(KN_V117_MIN_ROWS,Number(state.settings?.topN||20))),cat=CRITERION_CATALOG[key]||{name:key,desc:''},perf=state.performance.raw?.[key]||{},seatEligible=KN_V117_SEAT_ORDER.includes(key),weight=seatEligible?(state.performance.weights?.[key]??BASE_WEIGHTS[key]??0):null;
  const role={K8:'Tanısal konsensüs · bağımsız koltuk yok',K9:'Risk filtresi · bağımsız koltuk yok',K10:'Ceza/ödül hafızası · bağımsız koltuk yok',K11:'Davranış meta analizi · bağımsız koltuk yok',K12:'DNA/rejim meta analizi · bağımsız koltuk yok'}[key]||`ADAY UZMAN · ağırlık ${kn117Fmt(weight*100,2)}%`;
  const headers=['Hisse','Veri Zamanı','Anlık Değişim (%)','Anlik','Getiri','İlk Giriş Zamanı','Maliyet','KnzTOP20','Gerekçe','Degisim3Gun(%)','Destekler(3)','Direncler(3)','Kapanış Tarihi','Kapanış','Skor'];
  const body=rows.map((x,i)=>{const r=x.record||state.recordMap.get(x.sym)||{},e=seatEligible?kn117Entry(key,x.sym):null,price=kn117LatestPrice(r),entry=seatEligible&&Number.isFinite(Number(e?.entryPrice))&&Number(e.entryPrice)>0?Number(e.entryPrice):null,ret=seatEligible&&(Number.isFinite(Number(e?.currentReturn))&&Number(e.currentReturn)>-99.5?Number(e.currentReturn):(Number.isFinite(price)&&price>0&&Number.isFinite(entry)&&entry>0?100*(price/entry-1):null)),entryTime=seatEligible?e?.entryTime||null:null,day=kn117DayChange(r);return `<tr data-kn-rank="${i+1}"><td>${kn117Symbol(x.sym)}</td><td>${html(kn117Time(kn117MarketTime(r)))}</td><td class="${Number(day)>=0?'green':'red'}">${html(kn117Pct(day))}</td><td>${html(kn117Fmt(price,2))}</td><td class="${seatEligible&&Number(ret)>=0?'green':seatEligible?'red':''}">${seatEligible?html(kn117Pct(ret)):'—'}</td><td>${seatEligible?html(kn117Time(entryTime)):'—'}</td><td>${seatEligible?html(kn117Fmt(entry,2)):'—'}</td><td>${html(kn117Memberships(x.sym))}</td><td>${html(kn117Reason(x,key))}</td><td>${html(kn117ThreeDayText(r))}</td><td>${html(kn117Levels(r,'support'))}</td><td>${html(kn117Levels(r,'resistance'))}</td><td>${html(r.latestDate||r.series?.date?.at(-1)||'—')}</td><td>${html(kn117Fmt(kn117LastClose(r),2))}</td><td>${html(kn117Fmt(x.score,2))}</td></tr>`}).join('');
  return `<div class="card notice aurum-criterion-brief"><b>${html(key)} · ${html(cat.name)}</b><small>${html(cat.desc||'')}</small><div>${html(role)} · ${seatEligible?'İşlem Top':'Analiz Top'} ${rows.length}</div></div><div class="table-wrap aurum-drive-table aurum-kn-v117" style="margin-top:10px"><table><thead><tr>${headers.map(h=>`<th>${html(h)}</th>`).join('')}</tr></thead><tbody>${body||`<tr><td colspan="${headers.length}">Kn henüz hesaplanmadı.</td></tr>`}</tbody></table></div>`;
}
function kn117Show(k,btn){const key=KN_V117_ORDER.includes(k)?k:'K1';state.strictActiveKn=key;writeLocal(KN_V117_ACTIVE_KEY,key);const tabs=document.querySelector('.aurum-kn-tabs');if(tabs)tabs.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x.dataset.kn===key));const host=document.getElementById('knContent');if(host)host.innerHTML=kn117RenderCriterion(key);const metrics=document.getElementById('knMetricBundle');if(metrics)metrics.innerHTML=glnGdnCard('kn');return true;}
function kn117CriteriaBody(){const active=KN_V117_ORDER.includes(state.strictActiveKn)?state.strictActiveKn:'K1';state.strictActiveKn=active;return `<div class="tabs aurum-kn-tabs">${KN_V117_ORDER.map(k=>`<button data-kn="${k}" class="ghost-btn ${k===active?'active':''}" onclick="AurumKnHistoryV117.showKn('${k}',this)">${k}</button>`).join('')}</div><div id="knContent">${kn117RenderCriterion(active)}</div>`;}
let KH117_MARKET_CAL_CACHE={fingerprint:null,dates:[],coverage:new Map(),datePos:new Map()};
let KH117_SERIES_INDEX_CACHE=new WeakMap();
let KH117_REEL_CACHE={fingerprint:null,byDate:new Map()};
function kh117DataFingerprint(){
  const rows=state.records||[],meta=TABLE_META?.data||{},first=rows[0],last=rows.at(-1);
  return `${meta.fingerprint||meta.changed||meta.transfer||''}|${rows.length}|${String(first?.latestDate||first?.series?.date?.at(-1)||'')}|${String(last?.latestDate||last?.series?.date?.at(-1)||'')}`;
}
function kh117OfficialSession2026(d){
  const x=String(d||'');if(!/^2026-\d{2}-\d{2}$/.test(x))return null;
  const closed=new Set(['2026-01-01','2026-03-20','2026-03-21','2026-03-22','2026-04-23','2026-05-01','2026-05-19','2026-05-27','2026-05-28','2026-05-29','2026-05-30','2026-07-15','2026-08-30','2026-10-29']);
  const wd=new Date(x+'T12:00:00+03:00').getDay();return wd!==0&&wd!==6&&!closed.has(x);
}
function kh117ExpectedAdjacentSession(date,dir=1){
  const x=String(date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(x))return null;
  if(x.startsWith('2026-')){let t=Date.parse(x+'T12:00:00+03:00');for(let n=0;n<10;n++){t+=dir*86400000;const d=new Date(t).toLocaleDateString('en-CA',{timeZone:'Europe/Istanbul'});if(kh117OfficialSession2026(d))return d;}return null;}
  const cal=kh117CanonicalMarketCalendar(),i=cal.datePos.get(x),j=Number.isInteger(i)?i+dir:-1;return j>=0&&j<cal.dates.length?cal.dates[j]:null;
}
function kh117CanonicalMarketCalendar(){
  const rows=(state.records||[]).filter(r=>r?.sym&&Array.isArray(r?.series?.date)),fp=kh117DataFingerprint();
  if(KH117_MARKET_CAL_CACHE.fingerprint===fp)return KH117_MARKET_CAL_CACHE;
  const counts=new Map();for(const r of rows){const seen=new Set();for(const raw of (r.series.date||[])){const d=String(raw||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||seen.has(d))continue;seen.add(d);counts.set(d,(counts.get(d)||0)+1);}}
  const expected=Math.max(1,rows.length),minCoverage=Math.max(20,Math.ceil(expected*.60));
  const dates=[...counts.entries()].filter(([d,n])=>n>=minCoverage&&(kh117OfficialSession2026(d)!==false)).map(([d])=>d).sort(),datePos=new Map(dates.map((d,i)=>[d,i]));
  KH117_MARKET_CAL_CACHE={fingerprint:fp,dates,coverage:counts,minCoverage,expected,datePos};KH117_SERIES_INDEX_CACHE=new WeakMap();KH117_REEL_CACHE={fingerprint:fp,byDate:new Map()};return KH117_MARKET_CAL_CACHE;
}
function kh117SeriesDateIndex(rec){
  if(!rec||typeof rec!=='object')return null;const dates=rec?.series?.date||[],last=String(dates.at(-1)||''),cached=KH117_SERIES_INDEX_CACHE.get(rec);
  if(cached&&cached.dates===dates&&cached.length===dates.length&&cached.last===last)return cached.index;
  const index=new Map();for(let i=0;i<dates.length;i++){const d=String(dates[i]||'');if(d)index.set(d,i);}KH117_SERIES_INDEX_CACHE.set(rec,{dates,length:dates.length,last,index});return index;
}
function kh117PriceForDailyReturn(rec,i,pi){const z=rec?.series||{},raw=z.close||[],adj=z.calcClose||[],fac=z.adjustmentFactor||[],f0=Number(fac[pi]),f1=Number(fac[i]),factorChanged=Number.isFinite(f0)&&Number.isFinite(f1)&&f0>0&&f1>0&&Math.abs(f1-f0)>1e-10;const src=factorChanged?adj:raw,a=Number(src[i]),b=Number(src[pi]);return Number.isFinite(a)&&Number.isFinite(b)&&a>0&&b>0?[a,b]:null;}
function kh117DayReturn(rec,date){const d=String(date||''),prev=kh117ExpectedAdjacentSession(d,-1);if(!prev)return null;const index=kh117SeriesDateIndex(rec);if(!index)return null;const i=index.get(d),pi=index.get(prev);if(!Number.isInteger(i)||!Number.isInteger(pi))return null;const px=kh117PriceForDailyReturn(rec,i,pi);if(!px)return null;const r=100*(px[0]/px[1]-1);return Number.isFinite(r)&&r>-99.5?r:null;}
function kh117CurrentReel(date){const d=String(date||''),cal=kh117CanonicalMarketCalendar(),fp=cal.fingerprint;if(KH117_REEL_CACHE.fingerprint!==fp)KH117_REEL_CACHE={fingerprint:fp,byDate:new Map()};if(KH117_REEL_CACHE.byDate.has(d))return KH117_REEL_CACHE.byDate.get(d);const out=(state.records||[]).map(r=>({sym:r.sym,ret:kh117DayReturn(r,d)})).filter(x=>x.sym&&Number.isFinite(x.ret)&&x.ret>-99.5).sort((a,b)=>b.ret-a.ret||String(a.sym).localeCompare(String(b.sym),'tr')).slice(0,20);KH117_REEL_CACHE.byDate.set(d,out);return out;}
function kh117T0(){const cal=kh117CanonicalMarketCalendar(),date=cal.dates.at(-1)||null,reel=date?kh117CurrentReel(date):[],realSet=new Set(reel.map(x=>x.sym)),criteria={},summaries={};for(const k of KN_V117_ORDER){const list=(state.scores?.[k]||[]).slice(0,20).map(x=>{const r=x.record||state.recordMap.get(x.sym),e=kn117Entry(k,x.sym),dayReturn=kh117DayReturn(r,date)??kn117DayChange(r),knReturn=KN_V117_SEAT_ORDER.includes(k)&&Number.isFinite(Number(e?.currentReturn))&&Number(e.currentReturn)>-99.5?Number(e.currentReturn):null;return {sym:x.sym,score:x.score,dayReturn:Number.isFinite(dayReturn)?dayReturn:null,knReturn,realHit:realSet.has(x.sym)}});criteria[k]=list;summaries[k]={hitCount:list.filter(x=>x.realHit).length,total:list.length,realAvg:mean(list.map(x=>x.dayReturn)),knAvg:KN_V117_SEAT_ORDER.includes(k)?mean(list.map(x=>x.knReturn)):null};}const trend=KN_V117_TREND.map(k=>({k,...summaries[k]})).sort((a,b)=>b.hitCount-a.hitCount||(b.realAvg??-999)-(a.realAvg??-999)||a.k.localeCompare(b.k));return {date,provisional:true,reelTop20:reel,criteria,summaries,trend,marketTime:TABLE_META?.data?.market||TABLE_META?.data?.transfer||nowISO()};}
function kh117RunRow(run){const date=String(run.signalTradingDate||run.backfillAnchor||run.createdAt||'').slice(0,10),reel=kh117CurrentReel(date),realSet=new Set(reel.map(x=>x.sym)),criteria={},summaries={};for(const k of KN_V117_ORDER){const list=(run.criteria?.[k]||[]).slice(0,20).map(x=>{const rec=state.recordMap.get(x.sym),dayReturn=kh117DayReturn(rec,date);const maxRet=vFinite(x.maxNetReturn),closeRet=vFinite(x.closeNetReturn),knReturn=KN_V117_SEAT_ORDER.includes(k)?(maxRet!=null&&maxRet>-99.5?maxRet:closeRet!=null&&closeRet>-99.5?closeRet:null):null;return {sym:x.sym,dayReturn:Number.isFinite(dayReturn)?dayReturn:null,knReturn,realHit:realSet.has(x.sym)}});criteria[k]=list;summaries[k]={hitCount:list.filter(x=>x.realHit).length,total:list.length,realAvg:mean(list.map(x=>x.dayReturn)),knAvg:KN_V117_SEAT_ORDER.includes(k)?mean(list.map(x=>x.knReturn)):null};}const trend=KN_V117_TREND.map(k=>({k,...summaries[k]})).sort((a,b)=>b.hitCount-a.hitCount||(b.realAvg??-999)-(a.realAvg??-999)||a.k.localeCompare(b.k));return {date,provisional:false,reelTop20:reel,criteria,summaries,trend,marketTime:run.marketDataAt||run.createdAt||null,createdAt:run.createdAt||null};}
function kh117CloneValue(x){return JSON.parse(JSON.stringify(x));}
function kh117LegacyRows(){const t0=kh117T0(),byDate=new Map();for(const run of (state.runs||[]).filter(r=>r?.signalTradingDate).sort((a,b)=>String(b.signalTradingDate).localeCompare(String(a.signalTradingDate)))){const d=String(run.signalTradingDate);if(d===t0.date||byDate.has(d))continue;const row=kh117RunRow(run);if(KN_V117_ORDER.every(k=>(row.criteria[k]||[]).length>=20)){byDate.set(d,kh117CloneValue(row));if(byDate.size>=30)break;}}return [...byDate.values()];}
function kh117ArchiveState(){const a=state.khArchive&&typeof state.khArchive==='object'?state.khArchive:{schema:2,live:null,rows:[],seed:null,lastShift:null};if(!Array.isArray(a.rows))a.rows=[];a.schema=Math.max(2,Number(a.schema||1));return a;}
async function kh117PersistArchive(){state.khArchive=kh117ArchiveState();await dbPut('meta',{key:'khImmutableArchiveV1',value:kh117CloneValue(state.khArchive),updatedAt:nowISO()});}
function kh117NormalizeArchiveRows(rows,currentDate=null){const seen=new Set(),out=[];for(const row of (rows||[]).slice().sort((a,b)=>String(b?.date||'').localeCompare(String(a?.date||'')))){const d=String(row?.date||'');if(!d||d===currentDate||seen.has(d))continue;if(!KN_V117_ORDER.every(k=>(row?.criteria?.[k]||[]).length>=20))continue;seen.add(d);out.push({...kh117CloneValue(row),provisional:false,frozen:true});if(out.length>=30)break;}return out;}
function kh117ValidateArchive(a,currentDate=null){const rows=kh117NormalizeArchiveRows(a?.rows,currentDate),dates=rows.map(x=>x.date);return {ok:rows.length===new Set(dates).size&&rows.every(x=>x.frozen===true&&KN_V117_ORDER.every(k=>(x.criteria?.[k]||[]).length>=20)),rows,count:rows.length};}
async function kh117AdvanceArchive(current){
  const a=kh117ArchiveState(),currentDate=String(current?.date||'');if(!currentDate)throw new Error('K_Tarihsel T0 tarihi yok');
  if(!a.rows.length){const legacy=kh117LegacyRows().filter(x=>x.date!==currentDate).slice(0,30);a.rows=legacy.map(x=>({...kh117CloneValue(x),source:x.source||'LEGACY_VALUE_MIGRATION',archiveOrigin:'AUTO_LEGACY',formulaVersion:x.formulaVersion||null,criteriaSchemaFingerprint:x.criteriaSchemaFingerprint||null,frozen:true,archivedAt:nowISO(),anchorId:x.anchorId||`legacy:${x.date}`}));}
  let shifted=false,shiftedDate=null;
  if(a.live&&a.live.date&&a.live.date!==currentDate){
    const anchor=String(a.live.anchorId||`live:${a.live.date}`),frozen={...kh117CloneValue(a.live),source:a.live.source||'LIVE_ARCHIVE',archiveOrigin:'AUTO',formulaVersion:a.live.formulaVersion||MODEL_VERSION,criteriaSchemaFingerprint:a.live.criteriaSchemaFingerprint||MODEL_SCHEMA_FINGERPRINT,provisional:false,frozen:true,archivedAt:nowISO(),anchorId:anchor};
    if(!a.rows.some(x=>String(x.anchorId||'')===anchor||x.date===a.live.date)){a.rows.unshift(frozen);shifted=true;shiftedDate=a.live.date;}
  }
  a.rows=kh117NormalizeArchiveRows(a.rows,currentDate);
  a.live={...kh117CloneValue(current),source:'LIVE_T0',archiveOrigin:'AUTO_LIVE',formulaVersion:MODEL_VERSION,criteriaSchemaFingerprint:MODEL_SCHEMA_FINGERPRINT,provisional:true,frozen:false,anchorId:`live:${currentDate}`,updatedAt:nowISO()};
  a.lastShift=shifted?{fromT0Date:shiftedDate,toT1Date:shiftedDate,at:nowISO(),rowCount:a.rows.length}:a.lastShift||null;a.schema=2;
  const check=kh117ValidateArchive(a,currentDate);if(!check.ok)throw new Error('K_Tarihsel arşiv bütünlüğü doğrulanamadı');a.rows=check.rows;state.khArchive=a;await kh117PersistArchive();return {archive:a,shifted,shiftedDate};
}
function kh117Rows(){const t0=kh117T0(),a=kh117ArchiveState(),arch=kh117NormalizeArchiveRows(a.rows?.length?a.rows:kh117LegacyRows(),t0.date).slice(0,30);return [{...t0,_label:'T0',_t0:true},...arch.map((r,i)=>({...kh117CloneValue(r),_label:`T${i+1}`,_t0:false,provisional:false,frozen:true}))];}
function kh117HistoricalHitAverage(k){const rows=kh117Rows().filter(x=>!x._t0).slice(0,30),hits=rows.map(r=>Number(r?.summaries?.[k]?.hitCount)).filter(Number.isFinite);return {avg:hits.length===30?mean(hits):null,n:hits.length,total:20};}
function kh117SSeatCount(k){return (state.selection||[]).filter(x=>(x.supportingCriteria||[]).includes(k)||(x.contributions||[]).some(c=>c?.k===k)).length;}
function kh117AnchorDates(calcRecords,currentDate){const counts=new Map();for(const rec of calcRecords||[])for(const d of rec?.series?.date||[])if(d&&d<currentDate)counts.set(d,(counts.get(d)||0)+1);return [...counts.entries()].filter(([,n])=>n>=20).map(([d])=>d).sort((a,b)=>b.localeCompare(a));}
function kh117TruncateRecordPIT(rec,endIndex){const anchor=rec?.series?.date?.[endIndex];if(!anchor)throw new Error('PIT anchor yok');const b={symbol:rec.sym,providers:['PIT_LOCAL_VERIFIED'],attempts:[],conflicts:[],fundamentals:{},live:null,actions:(rec.actions||[]).filter(x=>String(x.date||'')<=anchor),bars:rec.series.date.slice(0,endIndex+1).map((d,i)=>({date:d,open:rec.series.open?.[i],high:rec.series.high?.[i],low:rec.series.low?.[i],close:rec.series.close?.[i],adjustedClose:rec.series.calcClose?.[i],volume:rec.series.volume?.[i],usdAof:rec.series.usd?.[i],indexAof:rec.series.index?.[i],sources:{open:'PIT_LOCAL_VERIFIED',high:'PIT_LOCAL_VERIFIED',low:'PIT_LOCAL_VERIFIED',close:'PIT_LOCAL_VERIFIED',adjustedClose:'PIT_LOCAL_VERIFIED',volume:'PIT_LOCAL_VERIFIED'}}))};return enrichBundle(b,{bars:[]});}
function kh117PitRowForAnchor(anchor,calcRecords){
  const truncated=[];for(const rec of calcRecords||[]){const dates=rec?.series?.date||[];let ix=-1;const cache=rec.__khPitDateIndex||(Object.defineProperty(rec,'__khPitDateIndex',{value:new Map(dates.map((d,i)=>[d,i])),configurable:true}),rec.__khPitDateIndex);ix=cache.get(anchor)??-1;if(ix<2)continue;try{truncated.push(kh117TruncateRecordPIT(rec,ix))}catch{}}
  if(truncated.length<20)return {ok:false,reason:`${anchor}: yalnız ${truncated.length} kesilmiş kayıt`};
  const historicalBehavior=calculateBehaviorProfiles(truncated,{fingerprint:`KH_PIT|${anchor}|${MODEL_VERSION}`,includeArchive:false});truncated.forEach(r=>applyBehaviorProfile(r,historicalBehavior.map.get(r.sym)));
  const built=buildModels(truncated,{pool:truncated,weights:BASE_WEIGHTS,calibrate:false});for(const k of KN_V117_ORDER)if((built.scores?.[k]||[]).length<20)return {ok:false,reason:`${anchor}: ${k} Top20 üretilemedi`};
  const reel=(calcRecords||[]).map(r=>({sym:r.sym,ret:kh117DayReturn(r,anchor)})).filter(x=>Number.isFinite(x.ret)&&x.ret>-99.5).sort((a,b)=>b.ret-a.ret||a.sym.localeCompare(b.sym)).slice(0,20);if(reel.length<20)return {ok:false,reason:`${anchor}: ReelTop20 için ${reel.length} gerçek getiri`};
  const realSet=new Set(reel.map(x=>x.sym)),criteria={},summaries={};for(const k of KN_V117_ORDER){const list=(built.scores[k]||[]).slice(0,20).map(x=>{const full=state.recordMap.get(x.sym)||calcRecords.find(r=>r.sym===x.sym),dayReturn=kh117DayReturn(full,anchor);return {sym:x.sym,score:Number(x.score),dayReturn:Number.isFinite(dayReturn)?dayReturn:null,knReturn:null,realHit:realSet.has(x.sym)}});criteria[k]=list;summaries[k]={hitCount:list.filter(x=>x.realHit).length,total:20,realAvg:mean(list.map(x=>x.dayReturn)),knAvg:null};}
  const trend=KN_V117_TREND.map(k=>({k,...summaries[k]})).sort((a,b)=>b.hitCount-a.hitCount||(b.realAvg??-999)-(a.realAvg??-999)||a.k.localeCompare(b.k));
  return {ok:true,row:{date:anchor,source:'PIT_SEED_V1',formulaVersion:MODEL_VERSION,formulaBasis:'CANONICAL_FORMULA_BASE_WEIGHTS_NO_FUTURE_CALIBRATION',inputCutoff:anchor,futureDataUsed:false,provisional:false,frozen:true,anchorId:`pit:${anchor}`,archivedAt:nowISO(),reelTop20:reel,criteria,summaries,trend}};
}
async function kh117SeedPIT30(){
  if(state.syncing||state.calculating)throw new Error('Başka bir işlem sürüyor');
  const calcRecords=calculationRecords();
  
  const current=kh117T0(),a=kh117ArchiveState(),existing=kh117NormalizeArchiveRows(a.rows,current.date);
  if(a.seed?.completed===true&&existing.length>=30){
    showAurumNotice('T1–T30 başlangıç arşivi daha önce 30/30 oluşturulmuş ve salt değere kilitlenmiş. Yeniden hesaplama yapılmaz.','info',3600);
    return true;
  }
  if(existing.length>=30){
    a.seed={...(a.seed||{}),completed:true,windowCount:30,sealedAt:a.seed?.sealedAt||nowISO(),checkedAt:nowISO(),immutable:true};
    state.khArchive=a;await kh117PersistArchive();
    showAurumNotice('T1–T30 zaten 30/30 tam; salt değer arşivi olarak kilitlendi.','info',3400);
    return true;
  }
  if(!confirm(`Başlangıç T1–T30 arşivi bir kereye mahsus point-in-time olarak 30/30 hesaplansın mı?

Her anchor gün için yalnız o tarih ve öncesinde mevcut fiyat, hacim, aksiyon ve türetilebilir yerel veriler kullanılacaktır. O tarihten sonraki veri, haber, öğrenme, calibration veya model state'i kullanılmayacaktır.

30/30 tamamlanmadan hiçbir kısmi sonuç ana arşive yayınlanmayacaktır. Başarılı sonuçlar salt-değer snapshot'a dönüştürülüp formülasyonla bağı kesilecektir.`))return false;

  const existingDates=new Set(existing.map(x=>x.date)),
    anchors=kh117AnchorDates(calcRecords,current.date).filter(d=>!existingDates.has(d)),
    need=30-existing.length,staged=[],failures=[];
  const seedJob={id:makeId('KH_PIT'),stage:'K_Tarihsel'};
  state.calculating=true;
  state.progress={stage:'K_Tarihsel PIT başlangıç',current:'30/30 point-in-time staging hazırlanıyor',done:existing.length,total:30,errors:0};
  clearCancel();writeLocal(CANCEL_KEY,{requested:false,jobId:null,at:null});
  setRuntime({status:JOB_STATUS.K_TARIHSEL_RUNNING,jobId:seedJob.id,stage:'K_Tarihsel',done:existing.length,total:30,message:`T1–T30 yükleniyor · ${existing.length}/30`});
  renderCurrentPagePreservingView();
  try{
    for(const anchor of anchors){
      if(staged.length>=need)break;
      if(cancelRequested(seedJob))throw Object.assign(new Error('K_Tarihsel PIT işlemi iptal edildi'),{code:'OPERATION_CANCELLED'});
      const result=kh117PitRowForAnchor(anchor,calcRecords);
      if(cancelRequested(seedJob))throw Object.assign(new Error('K_Tarihsel PIT işlemi iptal edildi'),{code:'OPERATION_CANCELLED'});
      if(result.ok){
        const row={...kh117CloneValue(result.row),source:'PIT_SEED_R50_VALUE',provisional:false,frozen:true,immutable:true,formulaDetached:true,seededAt:nowISO()};
        staged.push(row);
        state.progress.done=existing.length+staged.length;
        state.progress.current=`${anchor} · ${state.progress.done}/30`;
      }else{
        failures.push(result.reason);
        state.progress.errors=failures.length;
      }
      if(staged.length%3===0||staged.length===need){setRuntime({status:JOB_STATUS.K_TARIHSEL_RUNNING,jobId:seedJob.id,stage:'K_Tarihsel',done:state.progress.done,total:30,message:`T1–T30 yükleniyor · ${state.progress.done}/30`});updateLiveStatus()}
      /* Yield in small batches: same calculations, substantially less render/status overhead. */
      if(staged.length%4===0)await new Promise(r=>setTimeout(r,0));
    }
    if(staged.length!==need){
      throw new Error(`T1–T30 başlangıç staging tamamlanamadı: ${existing.length+staged.length}/30. Kısmi arşiv yayınlanmadı.${failures[0]?` İlk neden: ${failures[0]}`:''}`);
    }
    const merged=kh117NormalizeArchiveRows([...existing,...staged],current.date).slice(0,30);
    const next={...a,schema:Math.max(5,Number(a.schema||0)),rows:merged,seed:{
      version:2,method:'POINT_IN_TIME_BASE_WEIGHTS_NO_FUTURE_CALIBRATION',
      requestedAt:a.seed?.requestedAt||nowISO(),updatedAt:nowISO(),sealedAt:nowISO(),
      seededCount:merged.filter(x=>String(x.source||'').startsWith('PIT_SEED')).length,
      windowCount:merged.length,completed:true,immutable:true,formulaDetached:true,
      inputRule:'ONLY_DATA_AT_OR_BEFORE_ANCHOR',futureDataUsed:false,failures:[]
    }};
    const check=kh117ValidateArchive(next,current.date);
    if(!check.ok||check.rows.length!==30)throw new Error('PIT staging 30/30 bütünlük kontrolü başarısız');
    next.rows=check.rows.map(x=>({...kh117CloneValue(x),frozen:true,immutable:true,formulaDetached:true}));
    state.khArchive=next;await kh117PersistArchive();
    state.progress={stage:'K_Tarihsel PIT başlangıç',current:'30/30 tamamlandı · salt değer arşivi kilitlendi',done:30,total:30,errors:0};
    setRuntime({status:JOB_STATUS.K_TARIHSEL_COMPLETED,jobId:seedJob.id,stage:'K_Tarihsel',done:30,total:30,message:'T1–T30 30/30 tamamlandı'});
    updateLiveStatus();renderCurrentPagePreservingView();
    showAurumNotice('T1–T30 point-in-time başlangıç arşivi 30/30 üretildi ve formülasyondan ayrılmış salt değerlere kilitlendi.','success',4800);
    return true;
  }catch(e){
    if(e?.code==='OPERATION_CANCELLED'||cancelRequested(seedJob)){setRuntime({status:JOB_STATUS.IDLE,jobId:null,stage:'K_Tarihsel',done:state.progress?.done||0,total:30,message:'K_Tarihsel T1–T30 iptal edildi'});showAurumNotice('K_Tarihsel T1–T30 yüklemesi iptal edildi','info',1800);return false;}
    setRuntime({status:JOB_STATUS.FAILED,jobId:seedJob.id,stage:'K_Tarihsel',done:state.progress?.done||0,total:30,message:e?.message||String(e)});throw e;
  }finally{
    state.calculating=false;state.progress=null;clearCancel(seedJob.id);updateLiveStatus();
    renderCurrentPagePreservingView();
  }
}
function kh117MarketStampForDate(date,row=null){
  const d=String(date||'');if(row?._t0){const t=TABLE_META?.data?.market||TABLE_META?.data?.transfer||null;return t?kn117Time(t):`${d} · kaynak zamanı doğrulanamadı`;}
  const stamps=(state.records||[]).map(r=>{const ds=r?.series?.date||[],i=ds.lastIndexOf(d);if(i<0)return null;const src=r?.series?.marketTime?.[i]||r?.series?.timestamp?.[i]||null;return src&&Number.isFinite(Date.parse(src))?Date.parse(src):null}).filter(Number.isFinite);
  if(stamps.length)return kn117Time(new Date(Math.max(...stamps)).toISOString());
  if(/^2026-\d{2}-\d{2}$/.test(d)&&kh117OfficialSession2026(d)!==false){const half=new Set(['2026-03-19','2026-05-26','2026-10-28']);return `${d} ${half.has(d)?'12:40':'18:10'} TSİ · BIST resmi seans sonu`;}
  return `${d} · kaynak zamanı doğrulanamadı`;
}
function kh117EvaluationRow(source){
  const r=kh117CloneValue(source),targetDate=r._t0?r.date:kh117ExpectedAdjacentSession(r.date,1);r._reelDate=targetDate;
  const reel=targetDate?kh117CurrentReel(targetDate):[],set=new Set(reel.map(x=>x.sym));r.reelTop20=reel;
  r._accuracyStatus=targetDate&&reel.length===20?'OK':'EKSİK';r.summaries=r.summaries||{};
  for(const k of KN_V117_ORDER){const src=(r.criteria?.[k]||[]).slice(0,20),list=src.map(x=>{const rec=state.recordMap.get(x.sym),rv=targetDate?kh117DayReturn(rec,targetDate):null;return {...x,dayReturn:Number.isFinite(rv)?rv:null,realHit:set.has(x.sym)}});r.criteria[k]=list;r.summaries[k]={...(r.summaries[k]||{}),hitCount:list.filter(x=>x.realHit).length,total:list.length,realAvg:mean(list.map(x=>x.dayReturn))};}
  r.trend=KN_V117_TREND.map(k=>({k,...r.summaries[k]})).sort((a,b)=>b.hitCount-a.hitCount||(b.realAvg??-999)-(a.realAvg??-999)||a.k.localeCompare(b.k));return r;
}
let KH117_DISPLAY_CACHE={key:null,rows:null};
function kh117DisplayRows(){
  const a=kh117ArchiveState(), fp=kh117DataFingerprint(), dates=(a.rows||[]).map(x=>x?.date||'').join(','), live=a.live?.date||'', key=`${fp}|${a.schema||0}|${a.lastFinalizedDate||''}|${a.lastShift?.at||''}|${live}|${dates}`;
  if(KH117_DISPLAY_CACHE.key===key&&Array.isArray(KH117_DISPLAY_CACHE.rows))return KH117_DISPLAY_CACHE.rows;
  const rows=kh117Rows().map(kh117EvaluationRow);KH117_DISPLAY_CACHE={key,rows};return rows;
}
function kh117TrendCell(row){const a=(row.trend||[]).filter(x=>KN_V117_TREND.includes(x.k)),hits=a.map(x=>Number(x.hitCount)).filter(Number.isFinite);return `<div class="kh-trend">${a.map(x=>`<span><b>${html(x.k)}:</b> ${Number(x.hitCount||0)}/${Number(x.total||20)}</span>`).join('')}<footer><small>İsabet ort: ${hits.length?kn117Fmt(mean(hits),2)+'/20':'—'}</small><small>Reel: ${html(row._reelDate||'—')} · ${html(kh117MarketStampForDate(row._reelDate,row))}</small></footer></div>`;}
function kh117ReelCell(row){const a=(row.reelTop20||[]).slice(0,20);return `<div class="kh-cell kh-real">${a.map(x=>`<span class="kh-line"><b>${html(x.sym)}</b><em>(${html(kn117Pct(x.ret))})</em></span>`).join('')||'<span class="kh-line"><b>VERİ EKSİK</b></span>'}<footer><span>Reel Ort: ${html(kn117Pct(mean(a.map(x=>x.ret))))} · ${html(row._accuracyStatus||'')}</span><span>${html(row._reelDate||'—')} · ${html(kh117MarketStampForDate(row._reelDate,row))}</span></footer></div>`;}
function kh117CriterionCell(row,k){const a=(row.criteria?.[k]||[]).slice(0,20),ss=row.summaries?.[k]||{};return `<div class="kh-cell kh-kn">${a.map(x=>`<span class="kh-line${x.realHit?' kh-real-hit':''}"><b>${html(x.sym)}</b><em>(${html(kn117Pct(x.dayReturn))} | ${html(kn117Pct(x.knReturn))})</em></span>`).join('')}<footer><span>İsabet: ${Number(ss.hitCount||0)}/${a.length||20} · Reel Ort: ${html(kn117Pct(ss.realAvg))}</span><span>Kn Ort: ${html(kn117Pct(ss.knAvg))} · Kn as-of ${html(row.date||'—')}</span></footer></div>`;}
function kh117Render(){const rows=kh117DisplayRows();return `<div class="section-head"><h2 class="aurum-khist-daily-title">K_Tarihsel günlük karşılaştırma</h2><small>T0 canlı · T1–T30: Kn(d) → Reel(d+1) · fail-closed doğrulama</small></div><div class="table-wrap aurum-drive-table strict-history r51-history"><table><thead><tr><th>Gün</th><th>Kn_Trend</th><th>Reel TopN<br><small>SYM(REEL%)</small></th>${KN_V117_ORDER.map(k=>`<th>${k} TopN<br><small>SYM(REEL% | KN%)</small></th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr><td class="kh-day"><b>${r._label}</b><small>${html(r.date)}<br>${r._t0?'CANLI':'KESİN'}</small></td><td>${kh117TrendCell(r)}</td><td>${kh117ReelCell(r)}</td>${KN_V117_ORDER.map(k=>`<td>${kh117CriterionCell(r,k)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;}
function kh117RenderDeferred(){const token=++KH117_RENDER_TOKEN,rows=kh117DisplayRows(),head=`<div class="section-head"><h2 class="aurum-khist-daily-title">K_Tarihsel günlük karşılaştırma</h2><small>T0 canlı · T1–T30: Kn(d) → Reel(d+1) · fail-closed doğrulama</small></div><div class="table-wrap aurum-drive-table strict-history r51-history"><table><thead><tr><th>Gün</th><th>Kn_Trend</th><th>Reel TopN<br><small>SYM(REEL%)</small></th>${KN_V117_ORDER.map(k=>`<th>${k} TopN<br><small>SYM(REEL% | KN%)</small></th>`).join('')}</tr></thead><tbody id="kh117Body"></tbody></table></div>`;requestAnimationFrame(()=>kh117PumpRows(token,rows,0));return head;}
function kh117PumpRows(token,rows,index){if(token!==KH117_RENDER_TOKEN||state.page!=='history')return;const body=document.getElementById('kh117Body');if(!body)return;const end=Math.min(rows.length,index+2),frag=document.createDocumentFragment();for(let i=index;i<end;i++){const r=rows[i],tr=document.createElement('tr');tr.innerHTML=`<td class="kh-day"><b>${r._label}</b><small>${html(r.date)}<br>${r._t0?'CANLI':'KESİN'}</small></td><td>${kh117TrendCell(r)}</td><td>${kh117ReelCell(r)}</td>${KN_V117_ORDER.map(k=>`<td>${kh117CriterionCell(r,k)}</td>`).join('')}`;frag.appendChild(tr);}body.appendChild(frag);if(end<rows.length)requestAnimationFrame(()=>kh117PumpRows(token,rows,end));}

globalThis.AurumKnHistoryV117=Object.freeze({version:'118.0.0-pit-immutable-learning',minRows:KN_V117_MIN_ROWS,renderCriterion:kn117RenderCriterion,renderCriteriaBody:kn117CriteriaBody,showKn:kn117Show,renderHistory:kh117Render,renderHistoryDeferred:kh117RenderDeferred,updateLedger:kn117UpdateLedger,entry:kn117Entry,rows:kh117Rows,verifyTop20:kn117RequireTop20,seedPIT30:kh117SeedPIT30,validateArchive:kh117ValidateArchive});

async function calculateKn(job){job.currentStage='Kn';await transition(job,JOB_STATUS.KN_RUNNING,{message:'K1–K7 aday uzmanları + K8–K12 analiz/meta tabloları hesaplanıyor',done:0,total:4});state.calculating=true;state.progress={stage:'Kn',current:'Tarihsel sonuçlar',done:0,total:4,errors:0};try{await pauseCheckpoint(job,JOB_STATUS.KN_RUNNING);const calcRecords=calculationRecords();await evaluatePendingRuns();state.progress.done=1;state.progress.current='Performans ağırlıkları';await pauseCheckpoint(job,JOB_STATUS.KN_RUNNING);await computePerformanceWeights();state.progress.done=2;state.progress.current='Davranış profilleri';await rebuildBehaviorProfiles(calcRecords,{force:false});state.progress.done=3;state.progress.current='K1–K7 aday + K8–K12 analiz sıralamaları';await pauseCheckpoint(job,JOB_STATUS.KN_RUNNING);state.recordMap=new Map(state.records.map(x=>[x.sym,x]));const built=buildModels(calcRecords,{pool:calcRecords,weights:state.performance.weights,calibrate:true,contextAt:globalThis.r34ModelContextAt(job,calcRecords)});state.scores=built.scores;state.modelBySym=built.bySym;state.__pendingSelection=built.selection;state.__pendingKnSnapshot={dataSnapshotId:job.dataSnapshotId,at:nowISO(),weights:built.weights,eligible:built.eligible.map(x=>x.sym)};state.__modelCache={dataSnapshotId:job.dataSnapshotId,weightsFingerprint:stableScalar(built.weights),built};kn117UpdateLedger();state.strictActiveKn='K1';writeLocal(KN_V117_ACTIVE_KEY,'K1');state.progress.done=4;
const knPersistedScores=Object.fromEntries(Object.entries(state.scores||{}).map(([k,rows])=>[k,(rows||[]).map(x=>({sym:x.sym,score:x.score}))]));
await dbPut('meta',{key:'knTableState',value:{dataSnapshotId:job.dataSnapshotId,rowsVersion:1,scores:knPersistedScores,updatedAt:nowISO()},updatedAt:nowISO()});
const knPrev=(await dbGet('meta','knSnapshot'))?.value||{},knTransferredAt=nowISO(),knFingerprint=knTableFingerprint(),knChangedAt=knPrev.fingerprint===knFingerprint&&knPrev.changedAt?knPrev.changedAt:knTransferredAt;await dbPut('meta',{key:'knSnapshot',value:{dataSnapshotId:job.dataSnapshotId,at:knTransferredAt,transferredAt:knTransferredAt,changedAt:knChangedAt,fingerprint:knFingerprint,scoreCounts:Object.fromEntries(CRITERIA.map(k=>[k,state.scores?.[k]?.length||0])),defaultCriterion:'K1',engine:'117.0.0-clean-kn-history'},updatedAt:knTransferredAt});await refreshTableMeta();await transition(job,JOB_STATUS.KN_COMPLETED,{message:'Kn tamamlandı · K1 varsayılan',done:4,total:4});return true;}catch(e){if(e?.code==='OPERATION_CANCELLED'||cancelRequested(job)){await transition(job,JOB_STATUS.IDLE,{error:null,message:'Kn iptal edildi · önceki tablo korundu'});return false;}await transition(job,JOB_STATUS.FAILED,{error:e?.message||String(e),message:'Kn başarısız'});return false}finally{state.calculating=false;clearCancel(job.id);renderCurrentPagePreservingView();}}

async function archiveHistorical(job){job.currentStage='K_Tarihsel';await transition(job,JOB_STATUS.K_TARIHSEL_RUNNING,{message:'Geçmiş sonuçlar doğrulanıyor',done:0,total:1});state.calculating=true;state.progress={stage:'K_Tarihsel',current:'Geçmiş sonuçlar',done:0,total:1,errors:0};try{await pauseCheckpoint(job,JOB_STATUS.K_TARIHSEL_RUNNING);const calcRecords=calculationRecords();const cached=state.__modelCache?.dataSnapshotId===job.dataSnapshotId?state.__modelCache.built:null,built=cached||buildModels(calcRecords,{pool:calcRecords,weights:state.performance.weights,calibrate:true,contextAt:globalThis.r34ModelContextAt(job,calcRecords)});const usedAt=nowISO(),latestDate=calcRecords.map(x=>x.latestDate).filter(Boolean).sort().at(-1)||trParts().date,ctx=marketContext(usedAt,latestDate),truth=calcRecords.filter(isTruthEligible),signalRanks=new Map(truth.filter(x=>Number.isFinite(x.dayChange)).slice().sort((a,b)=>b.dayChange-a.dayChange||a.sym.localeCompare(b.sym)).map((x,i)=>[x.sym,i+1])),signalMeta=x=>({sym:x.sym,signalPrice:x.livePrice,entryPrice:ctx.entryMode==='LIVE'?x.livePrice:null,signalDate:x.latestDate,signalDayReturn:x.dayChange,signalDayRank:signalRanks.get(x.sym)||null,estimatedCostPct:x.estimatedCostPct});const run={id:uid(),createdAt:usedAt,kind:job.mode==='AUTO'?'AUTO_K_TARIHSEL':'MANUAL_K_TARIHSEL',version:VERSION,modelVersion:MODEL_VERSION,modelSchemaFingerprint:MODEL_SCHEMA_FINGERPRINT,targetDefinition:TARGET_DEFINITION,targetReturnPct:state.settings.targetReturnPct,targetSessions:2,targetTopN:20,decisionWindow:ctx.window,entryMode:ctx.entryMode,signalTradingDate:latestDate,learningBucket:decisionBucket(usedAt,latestDate),learningEligible:true,marketRegime:built.selection[0]?.marketRegime||'NEUTRAL',snapshotBatchId:job.dataSnapshotId,settings:publicRunSettings(state.settings),weights:{...built.weights},universe:currentSymbols(),truthUniverse:truth.map(x=>x.sym),eligibleUniverse:built.eligible.map(x=>x.sym),entryUniverse:truth.map(x=>({...signalMeta(x),eligible:built.eligible.some(y=>y.sym===x.sym),totalScore:built.bySym.get(x.sym)?.totalScore??null,targetProbability:built.bySym.get(x.sym)?.targetProbability??null})),predictionUniverse:[...built.bySym.values()].map(x=>({...signalMeta(x),score:x.totalScore,totalScore:x.totalScore,targetProbability:x.targetProbability,confidence:x.confidence,latestDate:x.latestDate})),selection:built.selection.map(x=>({...signalMeta(x),score:x.totalScore,totalScore:x.totalScore,targetProbability:x.targetProbability,confidence:x.confidence,latestDate:x.latestDate,supportingCriteria:[...(x.supportingCriteria||[])],contributions:(x.contributions||[]).map(c=>({k:c.k,rank:c.rank,score:c.score,weight:c.weight}))})),criteria:Object.fromEntries(KN_V117_ORDER.map(k=>[k,(built.scores[k]||[]).slice(0,Math.max(20,Number(state.settings.topN||20))).map(x=>({...signalMeta(x.record),score:x.score}))])),evaluated:false,dataSnapshotId:job.dataSnapshotId};await dbPut('runs',run);state.runs.unshift(run);state.runs=state.runs.slice(0,state.settings.archiveMaxRuns);await pauseCheckpoint(job,JOB_STATUS.K_TARIHSEL_RUNNING);await pruneRuns();await evaluatePendingRuns();await computePerformanceWeights();await kh117AdvanceArchive(kh117T0());const locks=readLocal(HISTORY_LOCK_KEY,{rows:{}});locks.rows=locks.rows||{};locks.rows[latestDate]={lockedAt:nowISO(),runId:run.id,dataSnapshotId:job.dataSnapshotId};writeLocal(HISTORY_LOCK_KEY,locks);const histPrev=(await dbGet('meta','historicalSnapshot'))?.value||{},histTransferredAt=nowISO(),histFingerprint=historyTableFingerprint(),histChangedAt=histPrev.fingerprint===histFingerprint&&histPrev.changedAt?histPrev.changedAt:histTransferredAt;await dbPut('meta',{key:'historicalSnapshot',value:{dataSnapshotId:job.dataSnapshotId,runId:run.id,at:histTransferredAt,transferredAt:histTransferredAt,changedAt:histChangedAt,fingerprint:histFingerprint,date:latestDate},updatedAt:histTransferredAt});await refreshTableMeta();await transition(job,JOB_STATUS.K_TARIHSEL_COMPLETED,{message:'K_Tarihsel tamamlandı',done:1,total:1});return true;}catch(e){if(e?.code==='OPERATION_CANCELLED'||cancelRequested(job)){await transition(job,JOB_STATUS.IDLE,{error:null,message:'K_Tarihsel iptal edildi'});return false;}await transition(job,JOB_STATUS.FAILED,{error:e?.message||String(e),message:'K_Tarihsel başarısız'});return false}finally{state.calculating=false;clearCancel(job.id);renderCurrentPagePreservingView();}}

async function calculateS(job){job.currentStage='S';await transition(job,JOB_STATUS.S_RUNNING,{message:'Nihai seçim hesaplanıyor',done:0,total:1});state.calculating=true;state.progress={stage:'S',current:'Nihai seçim',done:0,total:1,errors:0};try{await pauseCheckpoint(job,JOB_STATUS.S_RUNNING);const calcRecords=calculationRecords();const cached=state.__modelCache?.dataSnapshotId===job.dataSnapshotId?state.__modelCache.built:null,built=cached||rebuildModelViews(calcRecords);state.scores=built.scores;state.selection=built.selection;state.modelBySym=built.bySym;await updateSelectionLifecycle();
const persistedSelection=state.selection.map(x=>{const y={...x};delete y.record;return y;});
await dbPut('meta',{key:'selectionTableState',value:{dataSnapshotId:job.dataSnapshotId,rowsVersion:1,rows:persistedSelection,updatedAt:nowISO()},updatedAt:nowISO()});
await pauseCheckpoint(job,JOB_STATUS.S_RUNNING);const sPrev=(await dbGet('meta','selectionSnapshot'))?.value||{},sTransferredAt=nowISO(),sFingerprint=selectionTableFingerprint(),sChangedAt=sPrev.fingerprint===sFingerprint&&sPrev.changedAt?sPrev.changedAt:sTransferredAt;await dbPut('meta',{key:'selectionSnapshot',value:{dataSnapshotId:job.dataSnapshotId,at:sTransferredAt,transferredAt:sTransferredAt,changedAt:sChangedAt,fingerprint:sFingerprint,symbols:state.selection.map(x=>x.sym)},updatedAt:sTransferredAt});await markDerivedUpdate('S');await refreshTableMeta();await transition(job,JOB_STATUS.COMPLETED,{completedAt:nowISO(),message:`S tamamlandı · ${state.selection.length} hisse`,done:1,total:1});job.completedAt=nowISO();await saveJob(job);try{await maybeRunAIDailyAudit()}catch(e){await log('error','Otomatik AI denetimi çalıştırılamadı',{error:e?.message||String(e)})}return true;}catch(e){if(e?.code==='OPERATION_CANCELLED'||cancelRequested(job)){await transition(job,JOB_STATUS.IDLE,{error:null,message:'S iptal edildi · önceki tablo korundu'});return false;}await transition(job,JOB_STATUS.FAILED,{error:e?.message||String(e),message:'S başarısız'});return false}finally{state.calculating=false;clearCancel(job.id);renderCurrentPagePreservingView();}}

function resolveDataRefreshMode(requested='GENERAL'){const m=normalizeMode(requested);if(m!=='GENERAL')return m;const t=Date.parse(state.lastSuccessfulSync||TABLE_META?.data?.transfer||'');return Number.isFinite(t)&&Date.now()-t<=MARKET_SYNC_WINDOW_MS?'REPAIR':'FULL'}
const R221_SMART_MAX_ROUNDS=4,R221_PIPELINE_TARGET_MS=6*60*1000,R221_REPAIR_RESERVE_MS=75*1000;
const R225_FILL_TARGETS=Object.freeze([95,90,80,70]);
function r225TargetForRound(round){return R225_FILL_TARGETS[Math.max(0,Math.min(R225_FILL_TARGETS.length-1,Number(round||1)-1))]||70;}
function r221CompletionMetrics(){
  const summary=dataSummary(state.records),plan=currentPendingRepairPlan(),u=Math.max(1,Number(summary.universeCount||currentSymbols().length||1)),missingPct=Math.max(0,100-Number(summary.fillPct||0)),stalePct=100*Number(plan.staleSymbolCount||0)/u,currentPct=100*Math.max(0,u-Number(plan.staleSymbolCount||0))/u;
  return {summary,plan,missingPct,stalePct,currentPct,needs:plan.symbolCount>0};
}
function r221StartBudget(job){if(!job.pipelineStartedAt)job.pipelineStartedAt=nowISO();job.pipelineTargetMs=R221_PIPELINE_TARGET_MS;job.pipelineDeadlineAt=new Date(Date.parse(job.pipelineStartedAt)+R221_PIPELINE_TARGET_MS).toISOString();return job}
function r221RepairBudgetAvailable(job){const d=Date.parse(job?.pipelineDeadlineAt||'');return !Number.isFinite(d)||Date.now()<d-R221_REPAIR_RESERVE_MS}
async function r221SmartCompletion(job,{alreadyRan=0,origin='AUTO'}={}){
  let rounds=Math.max(0,Number(alreadyRan||0)),m=r221CompletionMetrics();
  job.smartCompletion={...(job.smartCompletion||{}),origin,startedAt:job.smartCompletion?.startedAt||nowISO(),rounds,maxRounds:R221_SMART_MAX_ROUNDS,fillTargets:[...R225_FILL_TARGETS]};await saveJob(job);
  while(rounds<R221_SMART_MAX_ROUNDS&&!cancelRequested(job)){
    const nextRound=rounds+1,target=r225TargetForRound(nextRound),fill=Number(m.summary.fillPct||0);
    const firstRepair=((origin==='MANUAL_MAIN'||origin==='MANUAL_REPAIR_FULL')&&rounds===0&&m.plan.symbolCount>0);
    if(!firstRepair && (fill>=target || m.plan.symbolCount<=0))break;
    const before={fillPct:fill,missingPct:m.missingPct,stalePct:m.stalePct,symbolCount:m.plan.symbolCount,targetFillPct:target};
    rounds=nextRound;setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',done:0,total:m.plan.symbolCount,message:`Akıllı tamamlama ${rounds}/${R221_SMART_MAX_ROUNDS} · hedef ≥%${target} · mevcut %${fill.toFixed(2)}`});
    const ok=await prepareMissingData(job);m=r221CompletionMetrics();job.smartCompletion={...(job.smartCompletion||{}),rounds,lastAt:nowISO(),lastBefore:before,lastAfter:{fillPct:m.summary.fillPct,missingPct:m.missingPct,stalePct:m.stalePct,symbolCount:m.plan.symbolCount,targetFillPct:target},lastOk:ok};await saveJob(job);
    if(!ok){job.smartCompletion.stopped='REPAIR_FAILED_LAST_VALID_TABLE_PRESERVED';try{await transition(job,JOB_STATUS.DATA_COMPLETED,{error:null,message:`Veriler tablosu korundu · akıllı tamamlama ${rounds}. turda durdu`})}catch{}break}
  }
  const finalFill=Number(m.summary.fillPct||0),derivationEligible=finalFill>=70;
  job.smartCompletion={...(job.smartCompletion||{}),completedAt:nowISO(),rounds,finalFillPct:finalFill,finalMissingPct:m.missingPct,finalStalePct:m.stalePct,remainingSymbols:m.plan.symbolCount,completed:finalFill>=r225TargetForRound(Math.max(1,rounds)),derivationEligible,minDerivationFillPct:70};job.derivationEligible=derivationEligible;
  try{const summary={...m.summary,derivationEligible,minDerivationFillPct:70,smartCompletionRounds:rounds,smartCompletionTargets:[...R225_FILL_TARGETS]};await dbPut('meta',{key:'lastDataSummary',value:summary,updatedAt:nowISO()});TABLE_META.data.summary=summary;}catch{}
  await saveJob(job);return {...m,derivationEligible,finalFillPct:finalFill};
}
async function runAutoJob(job,mode='GENERAL'){
  r221StartBudget(job);job.requestedDataMode='FULL';await saveJob(job);
  if(!(await prepareData(job,'FULL')))return false;
  const m=await r221SmartCompletion(job,{origin:'AUTO_SCHEDULE'});
  const gate=calculationGateStatus();if(!gate.gate.ok){if(Number(gate.summary?.fillPct||0)<70){job.derivationSuppressed=true;job.derivationSuppressedReason=gate.reason;await saveJob(job);await transition(job,JOB_STATUS.COMPLETED,{error:null,message:`Veriler %${Number(gate.summary?.fillPct||0).toFixed(2)} dolulukla yayınlandı · %70 altı olduğu için Kn/K_Tarihsel/S/AL-SAT önceki geçerli durumunu korudu`});return true}await transition(job,JOB_STATUS.FAILED,{error:'POST_REPAIR_CALCULATION_GATE',message:`Veriler yayınlandı fakat türev tablolar için kalite kapısı geçilmedi · ${gate.reason||''}`});return false}
  if(!(await calculateKn(job)))return false;if(!(await archiveHistorical(job)))return false;const ok=await calculateS(job);job.pipelineElapsedMs=Date.now()-Date.parse(job.pipelineStartedAt||nowISO());job.pipelineOverTarget=job.pipelineElapsedMs>R221_PIPELINE_TARGET_MS;await saveJob(job);return ok
}
async function resumeAutoJob(job,mode='GENERAL'){
  const status=String(job?.status||''),meta=await currentSnapshotMeta(),sameSnapshot=!!job?.dataSnapshotId&&job.dataSnapshotId===meta?.snapshotId;
  if(['SCHEDULED','FETCHING_DATA','WAITING_FOR_NETWORK','RETRY_PENDING','PAUSED','IDLE'].includes(status))return runAutoJob(job,mode);
  if(['DATA_COMPLETED','KN_RUNNING'].includes(status)){if(!sameSnapshot)return runAutoJob(job,mode);r221StartBudget(job);if(!job?.smartCompletion?.completedAt)await r221SmartCompletion(job,{origin:'AUTO_RESUME'});const resumedGate=calculationGateStatus();if(Number(resumedGate.summary?.fillPct||0)<70){job.derivationSuppressed=true;job.derivationSuppressedReason=resumedGate.reason;await saveJob(job);await transition(job,JOB_STATUS.COMPLETED,{error:null,message:`Veriler %${Number(resumedGate.summary?.fillPct||0).toFixed(2)} · türev tablolar önceki geçerli snapshotı korudu`});return true}if(!(await calculateKn(job)))return false;if(!(await archiveHistorical(job)))return false;return calculateS(job)}
  if(['KN_COMPLETED','K_TARIHSEL_RUNNING'].includes(status)){if(!sameSnapshot){await transition(job,JOB_STATUS.FAILED,{error:'AUTO_SNAPSHOT_MISMATCH',message:'AUTO recovery veri snapshotı değişmiş'});return false}if(!(await archiveHistorical(job)))return false;return calculateS(job)}
  if(['K_TARIHSEL_COMPLETED','S_RUNNING'].includes(status)){if(!sameSnapshot){await transition(job,JOB_STATUS.FAILED,{error:'AUTO_SNAPSHOT_MISMATCH',message:'AUTO recovery veri snapshotı değişmiş'});return false}return calculateS(job)}return status==='COMPLETED'
}
async function resumeManualStage(job){const stage=String(job?.currentStage||'Veriler'),meta=await currentSnapshotMeta(),sameSnapshot=!!job?.dataSnapshotId&&job.dataSnapshotId===meta?.snapshotId;if(stage==='Veriler'||['FETCHING_DATA','WAITING_FOR_NETWORK','RETRY_PENDING'].includes(job.status)){const ok=await prepareData(job,job?.requestedDataMode||'GENERAL');if(ok)saveManualSequence({dataSnapshotId:job.dataSnapshotId,dataJobId:job.id,kn:false,history:false,s:false});return ok}if(!sameSnapshot){await transition(job,JOB_STATUS.FAILED,{error:'MANUAL_SNAPSHOT_MISMATCH',message:'Manuel recovery veri snapshotı değişmiş'});return false}const seq=manualSequence();if(stage==='Kn'||job.status==='KN_RUNNING'){const ok=await calculateKn(job);if(ok)saveManualSequence({...seq,dataSnapshotId:job.dataSnapshotId,kn:true,history:false,s:false});return ok}if(stage==='K_Tarihsel'||job.status==='K_TARIHSEL_RUNNING'){const ok=await archiveHistorical(job);if(ok)saveManualSequence({...seq,dataSnapshotId:job.dataSnapshotId,kn:true,history:true,s:false});return ok}if(stage==='S'||job.status==='S_RUNNING'){const ok=await calculateS(job);if(ok)saveManualSequence({...seq,dataSnapshotId:job.dataSnapshotId,kn:true,history:true,s:true});return ok}return false}
async function runManualData(mode='GENERAL'){
  if(state.syncing||state.calculating){showAurumNotice('Başka bir işlem sürüyor','info',2400);return false}
  try{window.prompt('aurum://native?cmd=transfer_keepalive&enabled=1','AURUM')}catch{}
  const requested=normalizeMode(mode),normalized=requested==='GENERAL'?'FULL':requested;
  if(normalized==='LIVE'){const gate=liveCollectionGate();if(gate.mayCollectLiveData===false){showAurumNotice(`Canlı veri kapısı kapalı: ${gate.reason||'resmî seans doğrulanmadı'}`,'info',3200);return false;}}
  const job=await createJob('MANUAL','USER',null,'DATA');r221StartBudget(job);job.requestedDataMode=normalized;await saveJob(job);
  const ok=await prepareData(job,normalized);if(!ok){try{window.prompt('aurum://native?cmd=transfer_keepalive&enabled=0','AURUM')}catch{}if(job.status!==JOB_STATUS.WAITING_FOR_NETWORK)operationFailureNotice(normalized==='REPAIR'?'Eksikleri Tamamla':'Verileri Güncelle',job,'Veri aktarımı tamamlanamadı');return false}
  const alreadyRan=normalized==='REPAIR'&&job.requestedDataMode!=='FULL'?1:0,completionOrigin=normalized==='REPAIR'?(job.requestedDataMode==='FULL'?'MANUAL_REPAIR_FULL':'MANUAL_REPAIR'):'MANUAL_MAIN',m=await r221SmartCompletion(job,{alreadyRan,origin:completionOrigin});
  saveManualSequence({dataSnapshotId:job.dataSnapshotId,dataJobId:job.id,kn:false,history:false,s:false});job.pipelineElapsedMs=Date.now()-Date.parse(job.pipelineStartedAt||nowISO());await saveJob(job);
  showAurumNotice(`Veriler yayınlandı · doluluk %${Number(m.summary.fillPct||0).toFixed(2)} · akıllı tamamlama ${Number(job.smartCompletion?.rounds||0)}/${R221_SMART_MAX_ROUNDS}${Number(m.summary.fillPct||0)<70?' · %70 altı: türev tablolar önceki geçerli veriyi koruyor':''}`,'success',5600);try{window.prompt('aurum://native?cmd=transfer_keepalive&enabled=0','AURUM')}catch{}return true
}
async function runManualKn(){if(state.syncing||state.calculating){showAurumNotice('Başka bir işlem sürüyor','info',2400);return false}const active=await activeCalculableSnapshot();if(!active)return warnOrder('KN');if(!active.integrity?.gate?.ok)return warnOrder('KN',active.integrity.reason);const seq=saveManualSequence({dataSnapshotId:active.meta.snapshotId,dataJobId:active.meta.jobId||null,kn:false,history:false,s:false});const job=await createJob('MANUAL','USER',null,'KN');job.dataSnapshotId=active.meta.snapshotId;const ok=await calculateKn(job);if(ok){seq.kn=true;seq.history=false;seq.s=false;saveManualSequence(seq);showAurumNotice('Kn tamamlandı. K_Tarihsel kullanıcı komutunu bekliyor.','success',2800);return true}return operationFailureNotice('Kn',job,'Kn hesaplaması tamamlanamadı')}
async function runManualHistorical(){if(state.syncing||state.calculating){showAurumNotice('Başka bir işlem sürüyor','info',2400);return false}const active=await activeCalculableSnapshot();if(!active)return warnOrder('HISTORY');if(!active.integrity?.gate?.ok)return warnOrder('HISTORY',active.integrity.reason);const kn=(await dbGet('meta','knSnapshot'))?.value||null;if(!kn||kn.dataSnapshotId!==active.meta.snapshotId)return warnOrder('HISTORY');const seq=saveManualSequence({dataSnapshotId:active.meta.snapshotId,dataJobId:active.meta.jobId||null,kn:true,history:false,s:false});const job=await createJob('MANUAL','USER',null,'HISTORY');job.dataSnapshotId=active.meta.snapshotId;const ok=await archiveHistorical(job);if(ok){seq.history=true;seq.s=false;saveManualSequence(seq);showAurumNotice('K_Tarihsel tamamlandı. S kullanıcı komutunu bekliyor.','success',2800);return true}return operationFailureNotice('K_Tarihsel',job,'K_Tarihsel hesaplaması tamamlanamadı')}
async function runManualS(){if(state.syncing||state.calculating){showAurumNotice('Başka bir işlem sürüyor','info',2400);return false}const active=await activeCalculableSnapshot();if(!active)return warnOrder('S');if(!active.integrity?.gate?.ok)return warnOrder('S',active.integrity.reason);const kn=(await dbGet('meta','knSnapshot'))?.value||null,hist=(await dbGet('meta','historicalSnapshot'))?.value||null;if(!kn||kn.dataSnapshotId!==active.meta.snapshotId)return warnOrder('HISTORY');if(!hist||hist.dataSnapshotId!==active.meta.snapshotId)return warnOrder('S');const seq=saveManualSequence({dataSnapshotId:active.meta.snapshotId,dataJobId:active.meta.jobId||null,kn:true,history:true,s:false});const job=await createJob('MANUAL','USER',null,'S');job.dataSnapshotId=active.meta.snapshotId;const ok=await calculateS(job);if(ok){seq.s=true;saveManualSequence(seq);showAurumNotice('S tamamlandı.','success',2400);return true}return operationFailureNotice('S',job,'S hesaplaması tamamlanamadı')}

async function freezeLegacyHistorical30Values(){
  const rows=(await dbAll('runs')).filter(r=>r?.kind===HISTORY_30_LEGACY_KIND&&r?.backfillWindow==='30D');
  if(!rows.length)return 0;
  for(const old of rows){
    const frozen={...old,kind:HISTORY_VALUE_KIND,seededValue:true,valueFrozenAt:old.valueFrozenAt||nowISO()};
    delete frozen.backfillWindow;
    delete frozen.backfillAnchor;
    await dbPut('runs',sanitizeStoredRun(frozen));
  }
  state.runs=(await dbAll('runs')).map(sanitizeStoredRun).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  await computePerformanceWeights();
  return rows.length;
}

function nativePending(){const qs=new URLSearchParams(location.search),epoch=Number(qs.get('epoch')||0);if(!Number.isFinite(epoch)||epoch<=0)return null;const d=new Date(epoch),parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d),o={};for(const x of parts)o[x.type]=x.value;return {slot:`${o.year}-${o.month}-${o.day}|${o.hour}:${o.minute}`,epoch};}
function normalizePendingSlot(p){if(!p)return null;const epoch=Number(p.epoch||0),slot=String(p.slot||'').trim();if(!slot)return null;return {key:slot,slot,epoch:Number.isFinite(epoch)&&epoch>0?epoch:null,ageMs:Number.isFinite(epoch)&&epoch>0?Math.max(0,Date.now()-epoch):0};}
function nativeComplete(slot,ok,detail){if(!BACKGROUND_SYNC)return;const q=new URLSearchParams({ok:ok?'1':'0',slot:String(slot||''),detail:String(detail||'')});setTimeout(()=>{location.href=`aurum://complete?${q.toString()}`},50);}
async function scheduledEntry(){if(!BACKGROUND_SYNC)return false;const p=nativePending(),pending=normalizePendingSlot(p),slot=pending?.key||String(p?.slot||'').trim();if(!slot){nativeComplete('',true,'NO_PENDING_SLOT');return false}const sm=slot.match(/^(\d{4}-\d{2}-\d{2})\|(\d{2}:\d{2})$/);if(sm&&!schedulerExpectedTimesForDate(sm[1]).includes(sm[2])){nativeComplete(slot,true,'PROFILE_SKIP');return false}const id=`AUTO|${slot}`,existing=await getJob(id);if(existing?.status==='COMPLETED'){nativeComplete(slot,true,'ALREADY_COMPLETED');return true}const job=existing||await createJob('AUTO','SCHEDULED_ALARM',slot,'DATA',id);if((existing&&Date.now()-Date.parse(existing.startedAt||0)>Number(state.settings.jobMaxAgeHours||48)*60*60*1000)||(pending&&pending.ageMs>Number(state.settings.jobMaxAgeHours||48)*60*60*1000)){await transition(job,JOB_STATUS.FAILED,{error:'STALE_SCHEDULED_JOB',message:'Geçersiz eski job'});nativeComplete(slot,false,'STALE_JOB');return false}const ok=await resumeAutoJob(job,'GENERAL');if(ok)nativeComplete(slot,true,job.sNotificationDetail||'COMPLETED');else if(job.status!==JOB_STATUS.WAITING_FOR_NETWORK)nativeComplete(slot,false,job.error||'FAILED');return ok}
async function recoverNativePendingOnStartup(){return false}
async function resumePendingJobs(){if(!isOnline()||state.syncing||state.calculating)return false;const recoverable=new Set(['SCHEDULED','FETCHING_DATA','WAITING_FOR_NETWORK','RETRY_PENDING','PAUSED','KN_RUNNING','K_TARIHSEL_RUNNING','S_RUNNING']),jobs=(await dbAll('jobs')).filter(j=>recoverable.has(String(j.status))&&Date.now()-Date.parse(j.startedAt||0)<=Number(state.settings.jobMaxAgeHours||48)*60*60*1000).sort((a,b)=>String(a.startedAt).localeCompare(String(b.startedAt)));for(const job of jobs){job.retryCount=(job.retryCount||0)+1;if(job.retryCount>Number(state.settings.maxJobRetries??MAX_JOB_RETRIES)){await transition(job,JOB_STATUS.FAILED,{error:'MAX_RETRY_EXCEEDED'});continue}const ok=job.mode==='AUTO'?await resumeAutoJob(job,'GENERAL'):await resumeManualStage(job);if(ok&&job.mode==='AUTO'&&job.scheduledAt)nativeComplete(job.scheduledAt,true,job.sNotificationDetail||'RECOVERED');return ok;}return recoverNativePendingOnStartup()}
const AURUM_SCHEDULER_NATIVE_HEALTH_KEY='aurum.scheduler.native.health.v14';
function schedulerNativeHealth(){return readLocal(AURUM_SCHEDULER_NATIVE_HEALTH_KEY,{ok:null,at:null,response:null,reason:null})||{ok:null,at:null,response:null,reason:null}}
function schedulerWriteNativeHealth(v){const x={...(v||{}),at:v?.at||nowISO()};writeLocal(AURUM_SCHEDULER_NATIVE_HEALTH_KEY,x);return x}
function schedulerNativeInstall(enabled,times,reason='USER'){
  try{
    const r=window.prompt(`aurum://native?${new URLSearchParams({cmd:'schedule',enabled:enabled?'1':'0',times:(times||[]).join(',')})}`,'AURUM')||'';
    const ok=r==='OK';schedulerWriteNativeHealth({ok,response:r||'NO_RESPONSE',reason,at:nowISO()});return {ok,response:r||'NO_RESPONSE'};
  }catch(e){const response=e?.message||String(e)||'PROMPT_FAILED';schedulerWriteNativeHealth({ok:false,response,reason,at:nowISO()});return {ok:false,response}}
}
function openExactAlarmSettings(){
  showAurumNotice('Android Ayarlar → Özel uygulama erişimi → Alarmlar ve hatırlatıcılar → Aurum BIST Rev 20 yolundan kesin alarm erişimini kontrol edin. WebView içinden intent:// açılması devre dışı bırakıldı; bu sayede ERR_UNKNOWN_URL_SCHEME oluşmaz.','info',8200);
  return true;
}
async function startScheduler(){
  if(state.settings?.nativeSchedulerEnabled===false)return schedulerNativeInstall(false,[],'STARTUP_DISABLED').ok;
  const times=schedulerConfiguredTimes();if(!times.length)return true;
  return schedulerNativeInstall(true,times,'STARTUP_REARM').ok;
}
let AURUM_SCHEDULER_REARM_AT=0;
async function schedulerForegroundHealthCheck(reason='FOREGROUND'){
  if(document.hidden||state.settings?.nativeSchedulerEnabled===false)return false;
  const now=Date.now();if(now-AURUM_SCHEDULER_REARM_AT<10*60*1000)return true;AURUM_SCHEDULER_REARM_AT=now;
  const times=schedulerConfiguredTimes();if(!times.length)return true;
  const out=schedulerNativeInstall(true,times,reason);
  if(!out.ok)showAurumNotice(`Android alarm katmanı yeniden kurulamadı (${out.response}). Kesin alarm iznini kontrol edin.`,'error',5600);
  try{await refreshSchedulerStatus()}catch{}
  return out.ok;
}
/* Scheduler health is checked only from its explicit settings/manual repair path; lifecycle/network events do not re-arm or start work. */
globalThis.openExactAlarmSettings=openExactAlarmSettings;



const AURUM_NATIVE_SCHEDULE_TZ='Europe/Istanbul';
const AURUM_SCHEDULER_KEY='aurum.b.scheduler.model.v13';
const AURUM_SCHEDULER_WEEKDAY_DEFAULT=Object.freeze(['00:30','04:30','08:20','09:20','10:20','11:20','12:20','13:20','14:20','15:20','16:20','17:20','18:20','19:20','20:30','21:30','22:30','23:30']);
const AURUM_SCHEDULER_HOLIDAY_DEFAULT=Object.freeze(['00:30','12:30']);
const AURUM_TR_FULL_HOLIDAYS=Object.freeze({
  2026:Object.freeze(['2026-03-20','2026-03-21','2026-03-22','2026-05-27','2026-05-28','2026-05-29','2026-05-30']),
  2027:Object.freeze(['2027-03-10','2027-03-11','2027-03-12','2027-05-16','2027-05-17','2027-05-18','2027-05-19']),
  2028:Object.freeze(['2028-02-27','2028-02-28','2028-02-29','2028-05-05','2028-05-06','2028-05-07','2028-05-08']),
  2029:Object.freeze(['2029-02-15','2029-02-16','2029-02-17','2029-04-24','2029-04-25','2029-04-26','2029-04-27']),
  2030:Object.freeze(['2030-02-04','2030-02-05','2030-02-06','2030-04-13','2030-04-14','2030-04-15','2030-04-16'])
});
function aurumSettingsCard(title,subtitle,body,id=''){return `<details class="card gold-edge aurum-settings-details" ${id?`id="${id}"`:''}><summary class="aurum-settings-summary"><div><strong>${html(title)}</strong><small>${html(subtitle)}</small></div><span class="aurum-details-chevron" aria-hidden="true">⌄</span></summary><div class="aurum-settings-details-body">${body}</div></details>`}
function schedulerValidTime(x){return /^([01]\d|2[0-3]):(?:20|30)$/.test(String(x||''))}
function schedulerSortTimes(a){return [...new Set((a||[]).filter(schedulerValidTime))].sort((x,y)=>x.localeCompare(y))}
function schedulerConfig(){let x=null;try{x=JSON.parse(localStorage.getItem(AURUM_SCHEDULER_KEY)||'null')}catch{};if(!x||x.schema!==13)x={schema:13,enabled:state.settings?.nativeSchedulerEnabled!==false,weekday:[...AURUM_SCHEDULER_WEEKDAY_DEFAULT],holiday:[...AURUM_SCHEDULER_HOLIDAY_DEFAULT],updatedAt:nowISO()};x.enabled=x.enabled!==false;x.weekday=schedulerSortTimes(x.weekday);x.holiday=schedulerSortTimes(x.holiday);return x}
function schedulerSaveConfig(x){const y={schema:13,enabled:x?.enabled!==false,weekday:schedulerSortTimes(x?.weekday),holiday:schedulerSortTimes(x?.holiday),updatedAt:nowISO()};localStorage.setItem(AURUM_SCHEDULER_KEY,JSON.stringify(y));state.settings.nativeSchedulerEnabled=y.enabled;state.settings.nativeSchedulerProfiles={weekday:y.weekday,holiday:y.holiday};return y}
function schedulerConfiguredSlots(){const x=schedulerConfig();return [{profile:'weekday',times:x.weekday},{profile:'holiday',times:x.holiday}]}
function schedulerConfiguredTimes(){const x=schedulerConfig();return x.enabled?schedulerSortTimes([...x.weekday,...x.holiday]):[]}
function schedulerIstanbulParts(date=new Date()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:AURUM_NATIVE_SCHEDULE_TZ,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date),o={};for(const p of parts)o[p.type]=p.value;return {year:Number(o.year),month:Number(o.month),day:Number(o.day),weekday:o.weekday,hour:Number(o.hour),minute:Number(o.minute),second:Number(o.second),date:`${o.year}-${o.month}-${o.day}`}}
function schedulerIsHolidayDate(date){const d=new Date(`${date}T12:00:00+03:00`),p=schedulerIstanbulParts(d);if(p.weekday==='Sat'||p.weekday==='Sun')return true;const md=String(date).slice(5),fixed=new Set(['01-01','04-23','05-01','05-19','07-15','08-30','10-29']);return fixed.has(md)||(AURUM_TR_FULL_HOLIDAYS[p.year]||[]).includes(date)}
function schedulerProfileForDate(date){return schedulerIsHolidayDate(date)?'holiday':'weekday'}
function schedulerExpectedTimesForDate(date){const x=schedulerConfig();return x[schedulerProfileForDate(date)]||[]}
function schedulerAddLocalDays(parts,days){const d=new Date(Date.UTC(parts.year,parts.month-1,parts.day)+days*86400000);return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()}}
function schedulerPad(n){return String(n).padStart(2,'0')}
function schedulerNextOccurrence(time,profile,now=new Date()){const p=schedulerIstanbulParts(now),target=Number(time.slice(0,2))*60+Number(time.slice(3)),nowMinutes=p.hour*60+p.minute+p.second/60;for(let plus=0;plus<14;plus++){const d=schedulerAddLocalDays(p,plus),date=`${d.year}-${schedulerPad(d.month)}-${schedulerPad(d.day)}`;if(schedulerProfileForDate(date)!==profile)continue;if(plus===0&&target<=nowMinutes)continue;return {label:`${plus===0?'Bugün':plus===1?'Yarın':date} · ${time}`,sortKey:plus*1440+target,date}}return {label:'—',sortKey:999999,date:null}}
function schedulerJobTime(job){const m=String(job?.scheduledAt||job?.id||'').match(/(?:\||T)(\d{2}:\d{2})(?:$|[^0-9])/);return m?m[1]:null}
function schedulerJobDate(job){const m=String(job?.scheduledAt||job?.id||'').match(/(\d{4}-\d{2}-\d{2})\|/);return m?m[1]:null}
function schedulerJobMoment(job){for(const v of [job?.completedAt,job?.startedAt]){const x=Date.parse(v||'');if(Number.isFinite(x))return x}return 0}
function schedulerStatusText(status){const s=String(status||'').toUpperCase();if(s==='COMPLETED')return'başarılı';if(s==='FAILED')return'başarısız';return'kayıt yok'}
async function schedulerSnapshot(){let jobs=[];try{jobs=(await dbAll('jobs')).filter(j=>String(j?.mode||'').toUpperCase()==='AUTO'||String(j?.id||'').startsWith('AUTO|'))}catch{}const now=new Date(),cfg=schedulerConfig(),rows=[];for(const profile of ['weekday','holiday'])for(const time of cfg[profile]){const next=schedulerNextOccurrence(time,profile,now),matches=jobs.filter(j=>schedulerJobTime(j)===time&&(!schedulerJobDate(j)||schedulerProfileForDate(schedulerJobDate(j))===profile)).sort((a,b)=>schedulerJobMoment(b)-schedulerJobMoment(a));rows.push({profile,time,next,last:matches[0]||null})}const nearest=rows.slice().sort((a,b)=>a.next.sortKey-b.next.sortKey)[0];return {rows,nearest,jobCount:jobs.length}}
function schedulerProfileEditor(profile,title,times){return `<div class="aurum-schedule-profile" data-profile="${profile}"><div class="aurum-schedule-profile-head"><b>${html(title)}</b><small>${times.length} slot</small></div><div class="aurum-schedule-chips">${times.map(t=>`<span class="aurum-schedule-chip"><b>${html(t)}</b><button class="aurum-schedule-remove" type="button" onclick="removeSchedulerSlot('${profile}','${t}')" aria-label="${t} saatini çıkar" title="Saati çıkar">−</button></span>`).join('')}</div><div class="aurum-schedule-add"><input type="time" step="600" id="schedulerAdd_${profile}" value="${profile==='weekday'?'09:20':'12:30'}" aria-label="${html(title)} için saat"><button class="ghost-btn aurum-schedule-add-btn" type="button" onclick="addSchedulerSlot('${profile}')">+ Ekle</button></div></div>`}
function schedulerSettingsModule(){const x=state.__schedulerDraft||schedulerConfig(),health=schedulerNativeHealth();queueMicrotask(()=>refreshSchedulerStatus().catch(()=>{}));return aurumSettingsCard('Otomatik Güncelleme Zamanlayıcısı',`${x.weekday.length} hafta içi + ${x.holiday.length} tatil slotu · Europe/Istanbul`,`<div class="field"><label>Ana zamanlayıcı</label><select id="nativeSchedulerEnabled"><option value="true" ${x.enabled?'selected':''}>Aktif</option><option value="false" ${!x.enabled?'selected':''}>Kapalı</option></select></div><div class="aurum-schedule-editor-v13">${schedulerProfileEditor('weekday','Hafta içi',x.weekday)}${schedulerProfileEditor('holiday','Hafta sonu / resmî tatil',x.holiday)}</div><div class="actions"><button class="gold-btn" type="button" onclick="saveSchedulerSettings()">Kaydet ve Kur</button><button class="ghost-btn" type="button" onclick="schedulerForegroundHealthCheck('MANUAL_REPAIR')">Alarmları Yeniden Kur</button><button class="ghost-btn" type="button" onclick="openExactAlarmSettings()">Kesin Alarm İznini Aç</button><button class="ghost-btn" type="button" onclick="resetSchedulerDefaults()">Varsayılana dön</button></div><div class="aurum-scheduler-health ${health.ok===false?'bad':''}" id="aurumSchedulerHealth">${health.ok===false?`Android alarm kurulumu başarısız · ${html(health.response||'bilinmeyen hata')}`:health.ok===true?'Android alarm katmanı son kontrolde kuruldu':'Android alarm katmanı henüz doğrulanmadı'}</div><div class="aurum-scheduler-report-head"><b>Çalışma raporu</b><small id="aurumSchedulerSummary">son durum</small></div><div id="aurumSchedulerRows" class="aurum-scheduler-report-grid"></div><small class="muted">Uygulama yeniden görünür olduğunda alarm seti en fazla 10 dakikada bir otomatik yeniden kurulur. Kurulum başarısızsa “Kesin Alarm İznini Aç” ile Android özel erişimini kontrol edin.</small>`,'aurumSchedulerModule')}
function schedulerDraft(){if(!state.__schedulerDraft){const x=schedulerConfig();state.__schedulerDraft={schema:13,enabled:x.enabled,weekday:[...x.weekday],holiday:[...x.holiday]}}return state.__schedulerDraft}
function addSchedulerSlot(profile){const x=schedulerDraft(),el=document.getElementById(`schedulerAdd_${profile}`),t=String(el?.value||'');if(!schedulerValidTime(t))return showAurumNotice('Saat yalnız HH:20 veya HH:30 olabilir','error',2600);x[profile]=schedulerSortTimes([...(x[profile]||[]),t]);state.settingsDirty=true;renderCurrentPagePreservingView();showAurumNotice('Saat taslağa eklendi · Kaydet ve Kur ile etkinleşir','info',2200)}
function removeSchedulerSlot(profile,time){if(!confirm(`${time} saati taslaktan çıkarılsın mı? Değişiklik Kaydet ve Kur'a kadar uygulanmaz.`))return false;const x=schedulerDraft();x[profile]=(x[profile]||[]).filter(t=>t!==time);state.settingsDirty=true;renderCurrentPagePreservingView();return true}
async function resetSchedulerDefaults(){if(!confirm('Zamanlayıcı mevcut varsayılan saatlerine taslak olarak dönsün mü? Etkinleşmesi için ayrıca Kaydet ve Kur gerekir.'))return false;state.__schedulerDraft={schema:13,enabled:true,weekday:[...AURUM_SCHEDULER_WEEKDAY_DEFAULT],holiday:[...AURUM_SCHEDULER_HOLIDAY_DEFAULT]};state.settingsDirty=true;renderCurrentPagePreservingView();showAurumNotice('Varsayılan saatler taslağa alındı · henüz uygulanmadı','info',2600);return true}
async function saveSchedulerSettings(){try{if(!confirm('Bu zamanlayıcı ayarları kaydedilip Android alarm katmanına kurulsun mu?'))return false;const base=state.__schedulerDraft||schedulerConfig(),x={schema:13,enabled:$('#nativeSchedulerEnabled')?.value!=='false',weekday:[...(base.weekday||[])],holiday:[...(base.holiday||[])]};if(x.enabled&&!(x.weekday.length||x.holiday.length))throw new Error('Zamanlayıcı aktifken en az bir slot gerekli');schedulerSaveConfig(x);await saveSettings();delete state.__schedulerDraft;const times=x.enabled?schedulerConfiguredTimes():[],out=schedulerNativeInstall(x.enabled,times,'USER_SAVE');if(!out.ok)throw new Error(`Android zamanlayıcı kurulamadı: ${out.response||'yanıt yok'}. Android → Özel uygulama erişimi → Alarmlar ve hatırlatıcılar iznini kontrol edin.`);state.settingsDirty=false;showAurumNotice(x.enabled?`${times.length} benzersiz alarm Android katmanına kuruldu`:'Otomatik zamanlayıcı kapatıldı','success',3000);await refreshSchedulerStatus();return true}catch(e){showAurumNotice(e?.message||String(e),'error',6200);try{await refreshSchedulerStatus()}catch{}return false}}
async function refreshSchedulerStatus(){const rowsEl=document.getElementById('aurumSchedulerRows'),summaryEl=document.getElementById('aurumSchedulerSummary');if(!rowsEl||!summaryEl)return false;const snap=await schedulerSnapshot(),health=schedulerNativeHealth(),healthEl=document.getElementById('aurumSchedulerHealth');summaryEl.textContent=health.ok===false?'alarm kurulumu başarısız':(snap.nearest?.next?.label?`sonraki ${snap.nearest.next.label}`:'son durum');if(healthEl){healthEl.classList.toggle('bad',health.ok===false);healthEl.textContent=health.ok===false?`Android alarm kurulumu başarısız · ${health.response||'bilinmeyen hata'}`:health.ok===true?`Android alarm katmanı kurulu · ${formatTableTime(health.at)}`:'Android alarm katmanı henüz doğrulanmadı'}rowsEl.innerHTML=snap.rows.map(({profile,time,last})=>{const st=schedulerStatusText(last?.status),cls=st==='başarılı'?'success':st==='başarısız'?'failure':'empty',when=last?formatTableTime(last.completedAt||last.startedAt||last.scheduledAt):'—';return `<div class="aurum-scheduler-report-row ${cls}"><b class="aurum-scheduler-report-time">${html(time)}</b><span>${html(st)}</span><small>${html(when)} · ${profile==='weekday'?'H.İçi':'Tatil'}</small></div>`}).join('');return true}
globalThis.addSchedulerSlot=addSchedulerSlot;globalThis.removeSchedulerSlot=removeSchedulerSlot;globalThis.resetSchedulerDefaults=resetSchedulerDefaults;globalThis.schedulerForegroundHealthCheck=schedulerForegroundHealthCheck;


function activeUpdateSlot(){return readLocal(AURUM_UPDATE_SLOT_KEY,null)}
function updateHistory(){const x=readLocal(AURUM_UPDATE_HISTORY_KEY,[]);return Array.isArray(x)?x.slice(0,AURUM_UPDATE_MAX_HISTORY):[]}
function writeUpdateHistory(rows){writeLocal(AURUM_UPDATE_HISTORY_KEY,(Array.isArray(rows)?rows:[]).slice(0,AURUM_UPDATE_MAX_HISTORY))}
async function updatePayloadHash(code){const data=new TextEncoder().encode(String(code||'')),hash=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function validateUpdatePackage(pkg){
  if(!pkg||typeof pkg!=='object'||Array.isArray(pkg))throw new Error('Güncelleme dosyası geçerli paket değil');
  if(pkg.schema!==AURUM_UPDATE_SCHEMA)throw new Error(`Şema ${AURUM_UPDATE_SCHEMA} olmalıdır`);
  if(!/^[A-Za-z0-9._+-]{1,48}$/.test(String(pkg.version||'')))throw new Error('Geçerli sürüm gerekli');
  const min=Number(pkg.minAppVersionCode||0),max=Number(pkg.maxAppVersionCode||0);
  if(min&&AURUM_APP_VERSION_CODE<min)throw new Error(`Bu güncelleme en az uygulama ${min} gerektiriyor`);
  if(max&&AURUM_APP_VERSION_CODE>max)throw new Error(`Bu güncelleme en fazla uygulama ${max} ile uyumlu`);
  if(typeof pkg.runtimeCode!=='string'||!pkg.runtimeCode.trim())throw new Error('runtimeCode gerekli');
  if(pkg.runtimeCode.length>600000)throw new Error('Güncelleme kodu 600 KB sınırını aşıyor');
  if(!/^[a-f0-9]{64}$/i.test(String(pkg.sha256||'')))throw new Error('SHA-256 alanı gerekli'); throw new Error('Executable runtime update devre dışı; yeni kod yalnız imzalı APK/AAB ile dağıtılır');
}
function updatePackageMeta(pkg){return {version:String(pkg?.version||''),title:String(pkg?.title||'Aurum güncellemesi'),sha256:String(pkg?.sha256||''),importedAt:pkg?.importedAt||null,activatedAt:pkg?.activatedAt||null}}
function aurumUpdateApi(pkg){return Object.freeze({appVersionCode:AURUM_APP_VERSION_CODE,appVersionName:AURUM_APP_VERSION_NAME,packageMeta:updatePackageMeta(pkg),state,dbGet,dbPut,bulkPut,nowISO})}
function rememberVerifiedUpdate(pkg,status='VERIFIED',message=''){const row={...pkg,status,message,historyAt:nowISO()};const rows=updateHistory().filter(x=>String(x?.sha256||'').toLowerCase()!==String(pkg?.sha256||'').toLowerCase());rows.unshift(row);writeUpdateHistory(rows);return row}
async function verifyUpdatePackage(pkg){validateUpdatePackage(pkg);const hash=await updatePayloadHash(pkg.runtimeCode);if(hash.toLowerCase()!==String(pkg.sha256).toLowerCase())throw new Error('SHA-256 doğrulaması başarısız');return true}
async function executeUpdatePackage(pkg){await verifyUpdatePackage(pkg);throw new Error('Executable runtime update devre dışı; imzalı uygulama güncellemesi gerekli')}
function cleanupSupersededRuntimeResidue(){
  try{
    const stale=/^(?:R42|R46|R47|R53|R54|R55|B36(?:\.[0-5])?)(?:[._-]|$)/i;
    const active=activeUpdateSlot();
    if(active&&stale.test(String(active.version||'')))localStorage.removeItem(AURUM_UPDATE_SLOT_KEY);
    const pending=readLocal(AURUM_UPDATE_PENDING_KEY,null);
    if(pending&&stale.test(String(pending.version||'')))localStorage.removeItem(AURUM_UPDATE_PENDING_KEY);
    const history=updateHistory().filter(x=>!stale.test(String(x?.version||'')));
    writeUpdateHistory(history);
    localStorage.removeItem(AURUM_UPDATE_LAST_ERROR_KEY);
  }catch{}
}
cleanupSupersededRuntimeResidue();
async function applyStoredAurumUpdates(){
  const active=activeUpdateSlot();if(!active)return true;
  if(/^(?:R42|R46|R47|R53|R54|R55|B36(?:\.[0-5])?)(?:[._-]|$)/i.test(String(active.version||''))){localStorage.removeItem(AURUM_UPDATE_SLOT_KEY);localStorage.removeItem(AURUM_UPDATE_PENDING_KEY);localStorage.removeItem(AURUM_UPDATE_LAST_ERROR_KEY);return true;}
  try{await executeUpdatePackage(active);localStorage.removeItem(AURUM_UPDATE_LAST_ERROR_KEY);rememberVerifiedUpdate(active,'ACTIVE');return true}
  catch(e){
    const history=updateHistory(),fallback=history.find(x=>String(x?.sha256||'').toLowerCase()!==String(active?.sha256||'').toLowerCase()&&x?.status!=='REJECTED');
    writeLocal(AURUM_UPDATE_LAST_ERROR_KEY,{at:nowISO(),version:active?.version||null,message:e?.message||String(e),fallback:fallback?.version||'EMBEDDED_CORE'});
    rememberVerifiedUpdate(active,'REJECTED',e?.message||String(e));
    if(fallback){try{await verifyUpdatePackage(fallback);writeLocal(AURUM_UPDATE_SLOT_KEY,{...fallback,activatedAt:nowISO()});console.error('Aurum update rejected; previous verified package restored',e);return false}catch{}}
    localStorage.removeItem(AURUM_UPDATE_SLOT_KEY);console.error('Aurum update rejected; embedded core restored',e);return false;
  }
}
async function importAurumUpdateFile(file){
  if(!file)throw new Error('Güncelleme dosyası seçilmedi');
  const raw=await file.text();let pkg;try{pkg=JSON.parse(raw)}catch{throw new Error('Güncelleme dosyası geçerli JSON kapsayıcı değil')}
  await verifyUpdatePackage(pkg);
  if(!confirm(`${pkg.title||pkg.version||'Güncelleme'} doğrulandı. Güncelleme etkinleştirilsin mi?\n\nBaşarılı etkinleştirme sonrasında otomatik geri yükleme noktası oluşturulacaktır.`))return false;
  pkg={...pkg,importedAt:nowISO()};
  writeLocal(AURUM_UPDATE_PENDING_KEY,pkg);const verify=readLocal(AURUM_UPDATE_PENDING_KEY,null);await verifyUpdatePackage(verify);
  const current=activeUpdateSlot();if(current)rememberVerifiedUpdate(current,'VERIFIED');
  rememberVerifiedUpdate(verify,'VERIFIED');
  writeLocal(AURUM_UPDATE_SLOT_KEY,{...verify,activatedAt:nowISO()});localStorage.removeItem(AURUM_UPDATE_PENDING_KEY);localStorage.removeItem(AURUM_UPDATE_LAST_ERROR_KEY);
  if(typeof createRestorePoint==='function')await createRestorePoint(`GÜNCELLEME SONRASI · ${pkg.version||'paket'}`,{skipConfirm:true});
  showAurumNotice(`Güncelleme doğrulandı ve etkinleştirildi: ${pkg.title||pkg.version}`,'success',1800);setTimeout(()=>location.reload(),240);return true;
}
async function rollbackAurumUpdate(sha256){
  if(!confirm('Bu güncelleme geri alınsın mı? Güncelleme geçmişinden kaldırılacak; kullanıcı verileri silinmeyecektir.'))return false;
  const key=String(sha256||'').toLowerCase(),history=updateHistory(),target=history.find(x=>String(x?.sha256||'').toLowerCase()===key);if(!target)throw new Error('Geri alınacak güncelleme bulunamadı');
  const active=activeUpdateSlot(),isActive=!!(active&&String(active?.sha256||'').toLowerCase()===key);
  const remaining=history.filter(x=>String(x?.sha256||'').toLowerCase()!==key&&x?.status!=='REJECTED');
  writeUpdateHistory(remaining);
  if(isActive){
    const fallback=remaining[0]||null;
    if(fallback){await verifyUpdatePackage(fallback);writeLocal(AURUM_UPDATE_SLOT_KEY,{...fallback,activatedAt:nowISO()});}
    else localStorage.removeItem(AURUM_UPDATE_SLOT_KEY);
  }
  localStorage.removeItem(AURUM_UPDATE_LAST_ERROR_KEY);
  showAurumNotice(`Güncelleme geri alındı ve geçmişten kaldırıldı: ${target.title||target.version||''}`,'success',1800);
  setTimeout(()=>location.reload(),220);return true;
}
function rollbackEmbeddedCore(){if(!confirm('Gömülü uygulama çekirdeğine dönülsün mü? Güncelleme paketi devre dışı kalacak; kullanıcı verileri korunacaktır.'))return false;const current=activeUpdateSlot();if(current)rememberVerifiedUpdate(current,'VERIFIED');localStorage.removeItem(AURUM_UPDATE_SLOT_KEY);localStorage.removeItem(AURUM_UPDATE_LAST_ERROR_KEY);setTimeout(()=>location.reload(),180);return true}
function aurumUpdateModule(){
  const active=activeUpdateSlot(),lastError=readLocal(AURUM_UPDATE_LAST_ERROR_KEY,null),history=updateHistory();
  const isActive=x=>!!(active&&String(active.sha256).toLowerCase()===String(x.sha256).toLowerCase());
  const rows=history.map(x=>`<div class="list-row"><div><strong>${html(x.title||x.version||'Güncelleme')}</strong><small>${html(x.version||'—')} · ${html(x.status||'VERIFIED')} · ${html(x.historyAt||x.importedAt||'')}</small></div><div class="actions"><span class="badge ${isActive(x)?'ok':'warn'}">${isActive(x)?'AKTİF':'SAKLI'}</span><button class="ghost-btn compact-btn" type="button" onclick="rollbackAurumUpdate('${html(String(x.sha256||''))}').catch(e=>showAurumNotice(e.message,'error',4200))">Geri Al</button></div></div>`).join('');
  return aurumSettingsCard('Uygulama Güncelleme','aurum-update/v2 · SHA-256 · son 10 doğrulanmış paket',`<div class="list-row"><div><strong>Yerel uygulama ${html(AURUM_APP_VERSION_NAME)}</strong><small>${active?`Aktif paket ${html(active.version)}`:'Gömülü sağlam çekirdek etkin'}</small></div><span class="badge ${active?'ok':'warn'}">v${AURUM_APP_VERSION_CODE}</span></div><p class="muted">Güncelleme dosyası şema, appVersionCode uyumluluğu, JavaScript sözdizimi ve SHA-256 bakımından doğrulanır; kullanıcı onayından sonra etkinleştirilir. Başarılı etkinleştirme sonrasında otomatik geri yükleme noktası oluşturulur. Başlatma hatasında yeni aktivasyon bırakılmaz ve mümkünse önceki doğrulanmış paket korunur. IndexedDB kullanıcı verileri silinmez.</p><div class="actions"><button class="gold-btn" type="button" onclick="document.querySelector('#updatePackageInput').click()">Güncelleme Dosyası Seç</button>${active?`<button class="ghost-btn" type="button" onclick="rollbackEmbeddedCore()">Gömülü Çekirdeğe Dön</button>`:''}</div>${lastError?`<div class="card notice"><b>Son aktivasyon reddedildi</b><small>${html(lastError.version||'')} · ${html(lastError.message||'')} · fallback: ${html(lastError.fallback||'')}</small></div>`:''}<details class="aurum-inner-details" ${history.length?'':'open'}><summary>Son doğrulanmış güncellemeler (${history.length}/${AURUM_UPDATE_MAX_HISTORY})</summary>${rows||'<p class="muted">Henüz doğrulanmış güncelleme paketi yok.</p>'}</details>`,'aurumUpdateModule')
}

function dataQualitySettingsModule(){return aurumSettingsCard('Tablo Oluşum Politikası','Sabit doluluk kademeleri',`<div class="aurum-source-policy"><b>Tek tablo politikası:</b> %95 → %90 → %80 → %70.<br><small>%70 ve üzeri: Kn, K_Tarihsel ve S yeni geçerli veriden hesaplanabilir. %70 altı: mevcut son geçerli türev tablolar ve zaman damgaları aynen korunur. Satır, sütun, eksik hücre, eksik sütun, kaynak güveni veya asgari hisse sayısı bağımsız tablo eşiği değildir.</small></div>`)}

function executionSettingsModule(){const s=state.settings;return aurumSettingsCard('İşlem ve Uygulanabilirlik Ayarları','Maliyet · likidite · pozisyon varsayımları',`<div class="form-grid"><div class="field"><label>Komisyon (bps)</label><input id="exCommission" type="number" min="0" max="100" step="1" value="${Number(s.commissionBps||8)}"></div><div class="field"><label>Slippage (bps)</label><input id="exSlippage" type="number" min="0" max="200" step="1" value="${Number(s.slippageBps||12)}"></div><div class="field"><label>Azami katılım %</label><input id="exParticipation" type="number" min="0.1" max="100" step="0.1" value="${Number(s.maxParticipationPct||2)}"></div><div class="field"><label>Varsayılan pozisyon (TRY)</label><input id="exPosition" type="number" min="1000" step="1000" value="${Number(s.assumedPositionTRY||100000)}"></div><div class="actions" style="grid-column:1/-1"><button class="gold-btn" onclick="saveExecutionSettings()">Kaydet</button></div></div>`) }
async function saveExecutionSettings(){state.settings.commissionBps=Math.max(0,Number($('#exCommission')?.value||8));state.settings.slippageBps=Math.max(0,Number($('#exSlippage')?.value||12));state.settings.maxParticipationPct=Math.max(.1,Number($('#exParticipation')?.value||2));state.settings.assumedPositionTRY=Math.max(1000,Number($('#exPosition')?.value||100000));await saveSettings();showAurumNotice('İşlem varsayımları kaydedildi','success',2200)}
function learningSettingsModule(){const s=state.settings;return aurumSettingsCard('Öğrenme, Ağırlık ve Backtest Ayarları','Hedef · arşiv · model yönetimi',`<div class="form-grid"><div class="field"><label>Hedef getiri %</label><input id="lrTargetReturn" type="number" min="5" max="100" step="0.5" value="${Number(s.targetReturnPct||5)}"></div><div class="field"><label>Arşiv azami run</label><input id="lrArchive" type="number" min="20" max="5000" value="${Number(s.archiveMaxRuns||500)}"></div><div class="field"><label>Backtest gün</label><input id="lrBacktestDays" type="number" min="30" max="1000" value="${Number(s.backtestDays||120)}"></div><div class="field"><label>Backtest adım</label><input id="lrBacktestStep" type="number" min="1" max="20" value="${Number(s.backtestStep||1)}"></div><div class="field"><label>Öğrenme yarı ömrü (gün)</label><input id="lrHalfLife" type="number" min="1" max="365" value="${Number(s.learningHalfLifeDays||20)}"></div><div class="field"><label>Günlük ağırlık değişim sınırı %</label><input id="lrDailyCap" type="number" min="0.1" max="10" step="0.1" value="${Number(s.weightDailyCapPct||1)}"></div><div class="field"><label>Min ağırlık</label><input id="lrWMin" type="number" min="0" max="1" step="0.01" value="${Number(s.weightMin||.02)}"></div><div class="field"><label>Max ağırlık</label><input id="lrWMax" type="number" min="0" max="1" step="0.01" value="${Number(s.weightMax||.24)}"></div><div class="field"><label>Min ağırlık gözlemi</label><input id="lrMinObs" type="number" min="1" max="1000" value="${Number(s.minWeightObservations||20)}"></div><div class="field"><label>Min kriter tahmini</label><input id="lrMinPred" type="number" min="1" max="100000" value="${Number(s.minCriterionPredictions||400)}"></div><div class="field"><label>Probation eşiği</label><input id="lrProbation" type="number" min="0" max="100" value="${Number(s.probationThreshold||42)}"></div><div class="field"><label>Shadow eşiği</label><input id="lrShadow" type="number" min="0" max="100" value="${Number(s.shadowThreshold||32)}"></div><div class="field"><label>Promotion marjı</label><input id="lrPromotion" type="number" min="0" max="20" step="0.05" value="${Number(s.promotionMargin||.35)}"></div><div class="field"><label>Varsayılan kriter modu</label><select id="lrCriterionMode"><option value="COMMON" ${s.criterionModeDefault!=='DISCOVERY'?'selected':''}>COMMON</option><option value="DISCOVERY" ${s.criterionModeDefault==='DISCOVERY'?'selected':''}>DISCOVERY</option></select></div><div class="field"><label>S / TopN</label><input value="20 · sabit model kuralı" disabled></div><div class="field"><label>Hedef seans</label><input value="2 · sabit model kuralı" disabled></div><div class="actions" style="grid-column:1/-1"><button class="gold-btn" onclick="saveLearningSettings()">Öğrenme Ayarlarını Kaydet</button></div></div>`) }
async function saveLearningSettings(){const n=(id,d)=>Number($(id)?.value??d);state.settings.targetReturnPct=Math.max(5,n('#lrTargetReturn',5));state.settings.archiveMaxRuns=Math.max(20,n('#lrArchive',500));state.settings.backtestDays=Math.max(30,n('#lrBacktestDays',120));state.settings.backtestStep=Math.max(1,n('#lrBacktestStep',1));state.settings.learningHalfLifeDays=Math.max(1,n('#lrHalfLife',20));state.settings.weightDailyCapPct=Math.max(.1,n('#lrDailyCap',1));state.settings.weightMin=Math.max(0,Math.min(1,n('#lrWMin',.02)));state.settings.weightMax=Math.max(state.settings.weightMin,Math.min(1,n('#lrWMax',.24)));state.settings.minWeightObservations=Math.max(1,n('#lrMinObs',20));state.settings.minCriterionPredictions=Math.max(1,n('#lrMinPred',400));state.settings.probationThreshold=Math.max(0,Math.min(100,n('#lrProbation',42)));state.settings.shadowThreshold=Math.max(0,Math.min(100,n('#lrShadow',32)));state.settings.promotionMargin=Math.max(0,n('#lrPromotion',.35));state.settings.criterionModeDefault=$('#lrCriterionMode')?.value==='DISCOVERY'?'DISCOVERY':'COMMON';await saveSettings();showAurumNotice('Öğrenme ve model ayarları kaydedildi','success',2400)}
function behaviorGenomeSettingsModule(){const s=state.settings;return aurumSettingsCard('Davranış ve Genome Ayarları','Karakter belleği · analoglar · geçmiş',`<div class="form-grid"><div class="field"><label>Davranış bakış süresi</label><input id="bgLookback" type="number" min="21" max="2000" value="${Number(s.behaviorLookbackDays||252)}"></div><div class="field"><label>Min davranış örneği</label><input id="bgMinSamples" type="number" min="1" max="1000" value="${Number(s.behaviorMinSamples||40)}"></div><div class="field"><label>Lifetime ağırlığı</label><input id="bgLifetime" type="number" min="0" max="0.6" step="0.01" value="${Number(s.behaviorLifetimeWeight??.3)}"></div><div class="field"><label>Genome bakış süresi</label><input id="bgGenomeLookback" type="number" min="63" max="2000" value="${Number(s.genomeLookbackDays||252)}"></div><div class="field"><label>Yakın komşu</label><input id="bgNeighbors" type="number" min="5" max="500" value="${Number(s.genomeNearestNeighbors||40)}"></div><div class="field"><label>Min analog</label><input id="bgMinAnalogs" type="number" min="1" max="500" value="${Number(s.genomeMinAnalogs||20)}"></div><div class="field"><label>Prior gücü</label><input id="bgPrior" type="number" min="0" max="500" value="${Number(s.genomePriorStrength||16)}"></div><div class="field"><label>Genome geçmiş gün</label><input id="bgHistory" type="number" min="30" max="5000" value="${Number(s.genomeHistoryDays||400)}"></div><div class="actions" style="grid-column:1/-1"><button class="gold-btn" onclick="saveBehaviorGenomeSettings()">Kaydet</button></div></div>`) }
async function saveBehaviorGenomeSettings(){const n=(id,d)=>Number($(id)?.value??d);state.settings.behaviorLookbackDays=Math.max(21,n('#bgLookback',252));state.settings.behaviorMinSamples=Math.max(1,n('#bgMinSamples',40));state.settings.behaviorLifetimeWeight=Math.max(0,Math.min(.6,n('#bgLifetime',.3)));state.settings.genomeLookbackDays=Math.max(63,n('#bgGenomeLookback',252));state.settings.genomeNearestNeighbors=Math.max(5,n('#bgNeighbors',40));state.settings.genomeMinAnalogs=Math.max(1,n('#bgMinAnalogs',20));state.settings.genomePriorStrength=Math.max(0,n('#bgPrior',16));state.settings.genomeHistoryDays=Math.max(30,n('#bgHistory',400));await saveSettings();showAurumNotice('Davranış ve Genome ayarları kaydedildi','success',2200)}
function calendarSettingsModule(){const s=state.settings;return aurumSettingsCard('Takvim ve Piyasa Zaman Ayarları','BIST takvimi · özel günler · AI veri kovaları',`<div class="form-grid"><div class="field" style="grid-column:1/-1"><label>Takvim istisnaları JSON</label><textarea id="calOverrides">${html(s.calendarOverridesJson||'[]')}</textarea><small>Mevcut takvim motoru bu listeyi doğrudan okur.</small></div><div class="actions" style="grid-column:1/-1"><button class="gold-btn" onclick="saveCalendarSettings()">Takvimi Kaydet</button></div></div>`) }
async function saveCalendarSettings(){try{const raw=String($('#calOverrides')?.value||'[]'),x=JSON.parse(raw);if(!Array.isArray(x))throw new Error('Takvim istisnaları JSON dizisi olmalıdır');state.settings.calendarOverridesJson=raw;await saveSettings();showAurumNotice('Takvim ayarları kaydedildi','success',2200)}catch(e){showAurumNotice(e?.message||String(e),'error',3600)}}
function dataTransferSettingsModule(){const s=state.settings||{},selected=new Set(s.exportTables||[]),checks=(globalThis.AURUM_EXPORT_TABLES||[]).map(([k,l])=>`<label class="aurum-export-check"><input type="checkbox" data-export-table value="${html(k)}" ${selected.has(k)?'checked':''}><span>${html(l)}</span></label>`).join('');queueMicrotask(()=>refreshExportFolderStatus?.());return aurumSettingsCard('Dışa Aktarma Merkezi','Klasör · tablolar · JSON / CSV / XLSX / PDF',`<div class="form-grid"><div class="field"><label>Kayıt yolu</label><select id="aurumExportTarget"><option value="downloads" ${s.exportTarget!=='custom'?'selected':''}>İndirilenler · varsayılan</option><option value="custom" ${s.exportTarget==='custom'?'selected':''}>Özel klasör</option></select></div><div class="field"><label>Dosya biçimi</label><select id="aurumExportFormat"><option value="json" ${s.exportFormat==='json'?'selected':''}>JSON</option><option value="csv" ${s.exportFormat==='csv'?'selected':''}>CSV</option><option value="xlsx" ${s.exportFormat==='xlsx'?'selected':''}>XLSX</option><option value="pdf" ${s.exportFormat==='pdf'?'selected':''}>PDF</option></select></div><div class="field"><label>Çoklu seçim kayıt şekli</label><select id="aurumExportMode"><option value="separate" ${s.exportMode!=='bundle'?'selected':''}>Her tablo ayrı dosya</option><option value="bundle" ${s.exportMode==='bundle'?'selected':''}>Seçilenleri tek dosyada birleştir</option></select></div><div class="field"><label>Özel klasör</label><button class="ghost-btn" type="button" onclick="aurumChooseExportFolder()">Klasör Seç / Değiştir</button><small id="aurumExportFolderStatus" class="muted">Durum okunuyor…</small></div></div><details class="aurum-inner-details"><summary>Hangi tablolar dışa aktarılacak?</summary><div class="aurum-export-grid">${checks}</div><div class="actions"><button class="ghost-btn compact-btn" type="button" onclick="document.querySelectorAll('[data-export-table]').forEach(x=>x.checked=true)">Tümünü Seç</button><button class="ghost-btn compact-btn" type="button" onclick="document.querySelectorAll('[data-export-table]').forEach(x=>x.checked=false)">Temizle</button></div></details><details class="aurum-inner-details"><summary>Aktarım ve kayıt işlemleri</summary><p class="muted">“Her tablo ayrı dosya” seçeneği işaretlenen tabloları tek tek kaydeder. “Tek dosya” JSON/PDF/XLSX içinde çoklu tabloyu birleştirir; CSV’de tablo bölümleri aynı dosyada art arda yazılır.</p><div class="actions"><button class="gold-btn" type="button" onclick="saveExportPreferences()">Tercihleri Kaydet</button><button class="gold-btn" type="button" onclick="exportData()">Şimdi Dışa Aktar</button><button class="ghost-btn" type="button" onclick="document.querySelector('#fileInput').click()">Dosya İçe Aktar</button></div></details>`) }
function aiApiSettingsModule(){const s=state.settings||{},configured=!!globalThis.AurumNativeAI?.configured?.();return aurumSettingsCard('API ve AI Ayarları','OpenAI · otomatik denetim · aday model · maliyet güvenliği',`<div class="list-row"><div><strong>OpenAI bağlantısı</strong><small>Haricî gateway yok · anahtar dışa aktarımlardan temizlenir</small></div><span class="badge ${configured?'ok':'warn'}">${configured?'ANAHTAR KAYITLI':'ANAHTAR YOK'}</span></div><div class="form-grid"><div class="field"><label>AI bağlantısı</label><select id="aiEnabled"><option value="true" ${s.aiEnabled?'selected':''}>Aktif</option><option value="false" ${!s.aiEnabled?'selected':''}>Kapalı</option></select></div><div class="field"><label>Model</label><input id="openaiModel" value="${html(s.openaiModel||'gpt-5.6-luna')}" autocomplete="off"></div><div class="field aurum-api-key-field" style="grid-column:1/-1"><label>OpenAI API anahtarı</label><div class="api-key-input-row"><input id="openaiApiKey" class="aurum-api-key-input" type="password" value="" placeholder="sk-proj-…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="text" enterkeyhint="done" onclick="this.focus()" onpointerdown="event.stopPropagation()" ontouchstart="event.stopPropagation()"><button class="ghost-btn compact-btn" type="button" onclick="const x=document.getElementById('openaiApiKey');x.type=x.type==='password'?'text':'password'">Göster / Gizle</button></div><div class="actions" style="margin-top:6px"><button class="ghost-btn compact-btn" type="button" onclick="if(!globalThis.AurumNativeAI?.openEditor?.())showAurumNotice('Android güvenli giriş penceresi açılamadı','error',3000)">Android güvenli giriş</button></div><small>Anahtar yazılabilir veya doğrudan Android Keystore giriş penceresinden kaydedilebilir.</small></div><div class="field"><label>Azami çıktı tokenı</label><input id="openaiMaxOutputTokens" type="number" min="512" max="16000" value="${Number(s.openaiMaxOutputTokens||8000)}"></div><div class="field"><label>Muhakeme düzeyi</label><select id="openaiReasoningEffort"><option value="low" ${s.openaiReasoningEffort==='low'?'selected':''}>Düşük</option><option value="medium" ${s.openaiReasoningEffort==='medium'?'selected':''}>Orta</option><option value="" ${!s.openaiReasoningEffort?'selected':''}>Gönderme</option></select></div><div class="field"><label>Günlük otomatik AI denetimi</label><select id="aiAutoDaily"><option value="true" ${s.aiAutoDaily?'selected':''}>Aktif</option><option value="false" ${!s.aiAutoDaily?'selected':''}>Kapalı</option></select></div><div class="field"><label>AI denetim saati</label><input id="aiDailyHour" type="number" min="0" max="23" value="${Number(s.aiDailyHour||19)}"></div><div class="field"><label>Aday model üretimi</label><select id="aiAllowCandidates"><option value="true" ${s.aiAllowCandidates?'selected':''}>Aktif</option><option value="false" ${!s.aiAllowCandidates?'selected':''}>Kapalı</option></select></div><div class="field"><label>Min doğrulama dönemi</label><input id="aiMinValidationPeriods" type="number" min="12" max="180" value="${Number(s.aiMinValidationPeriods||20)}"></div><div class="field"><label>AI snapshot recent run</label><input id="aiMaxRecentRuns" type="number" min="5" max="200" value="${Number(s.aiMaxRecentRuns||30)}"></div><div class="field"><label>Günlük azami ücretli çağrı</label><input id="aiDailyCallLimit" type="number" min="0" max="20" value="${Number(s.aiDailyCallLimit||2)}"></div><div class="field"><label>Manuel ücretli çağrıda onay</label><select id="aiRequireManualPaidCall"><option value="true" ${s.aiRequireManualPaidCall!==false?'selected':''}>Zorunlu</option><option value="false" ${s.aiRequireManualPaidCall===false?'selected':''}>Onaysız</option></select></div><div class="field"><label>Yeni piyasa kovası/veri şartı</label><select id="aiRequireNewMarketBucket"><option value="true" ${s.aiRequireNewMarketBucket!==false?'selected':''}>Zorunlu</option><option value="false" ${s.aiRequireNewMarketBucket===false?'selected':''}>Kapalı</option></select></div><div class="field"><label>AI piyasa zaman kovaları</label><input id="aiMarketTimeBuckets" value="${html(s.aiMarketTimeBuckets||'08:20,12:20,18:20,21:30')}"></div><div class="field"><label>Aday için min denetim güveni</label><input id="aiMinAuditConfidenceForCandidate" type="number" min="0" max="1" step="0.05" value="${Number(s.aiMinAuditConfidenceForCandidate||.45)}"></div><div class="field"><label>Otomatik model terfisi</label><input value="Kapalı · manuel onay zorunlu" disabled></div><div class="actions" style="grid-column:1/-1"><button class="gold-btn" onclick="saveAISettings()">API / AI Ayarlarını Kaydet</button><button class="ghost-btn" onclick="aiCheckHealthUI()" ${state.ai.busy?'disabled':''}>Bağlantıyı Test Et</button><button class="ghost-btn" onclick="aiRunDailyAuditUI()" ${state.ai.busy||!configured?'disabled':''}>AI Denetimini Şimdi Çalıştır</button><button class="ghost-btn" onclick="aiGenerateCandidateUI()" ${state.ai.busy||!configured?'disabled':''}>Aday Model Üret</button></div></div>`) }
function performanceControlSettingsModule(){const s=state.settings||{},pc=s.providerConcurrency||{},providers=['ISYATIRIM','ISYATIRIM_FINANCIALS','ISYATIRIM_LIVE','YAHOO','YAHOO_ALT','YAHOO_QUOTE','BIGPARA','BIGPARA_LIVE','FOREKS','STOOQ','KAP'];return aurumSettingsCard('Aktarım Hızı ve Sağlayıcı Kontrolü','Veri zenginliğini azaltmadan paralellik · retry · batching · sağlık',`<div class="form-grid"><div class="field"><label>Global worker</label><input id="pfConcurrency" type="number" min="1" max="32" value="${Number(s.concurrency||32)}"></div><div class="field"><label>Azami global worker</label><input id="pfMaxGlobal" type="number" min="1" max="32" value="${Number(s.maxGlobalConcurrency||32)}"></div><div class="field"><label>Adaptif paralellik</label><select id="pfAdaptive"><option value="true" ${s.adaptiveConcurrency!==false?'selected':''}>Açık</option><option value="false" ${s.adaptiveConcurrency===false?'selected':''}>Kapalı</option></select></div><div class="field"><label>Provider sağlık adaptasyonu</label><select id="pfHealthAdaptive"><option value="true" ${s.providerHealthAdaptive!==false?'selected':''}>Açık</option><option value="false" ${s.providerHealthAdaptive===false?'selected':''}>Kapalı</option></select></div><div class="field"><label>Retry backoff başlangıç ms</label><input id="pfBackoffBase" type="number" min="100" max="10000" value="${Number(s.retryBackoffBaseMs||600)}"></div><div class="field"><label>Retry backoff azami ms</label><input id="pfBackoffMax" type="number" min="500" max="60000" value="${Number(s.retryBackoffMaxMs||15000)}"></div><div class="field"><label>429 azami retry</label><input id="pf429" type="number" min="0" max="6" value="${Number(s.maxProvider429Retries??3)}"></div><div class="field"><label>Circuit açma hata sayısı</label><input id="pfCircuitFailures" type="number" min="1" max="20" value="${Number(s.circuitBreakerFailures||3)}"></div><div class="field"><label>Circuit cooldown ms</label><input id="pfCircuitCooldown" type="number" min="1000" max="900000" value="${Number(s.circuitBreakerCooldownMs||30000)}"></div><div class="field"><label>429 cooldown ms</label><input id="pfRateCooldown" type="number" min="1000" max="900000" value="${Number(s.rateLimitCooldownMs||60000)}"></div><div class="field"><label>Provider health persist adımı</label><input id="pfHealthFlush" type="number" min="1" max="100" value="${Number(s.sourceHealthFlushEvery||8)}"></div><div class="field"><label>Staging batch</label><input id="pfStageBatch" type="number" min="4" max="250" value="${Number(s.stageBatchSize||192)}"></div><div class="field"><label>Staging flush ms</label><input id="pfStageFlush" type="number" min="4" max="500" value="${Number(s.stageFlushMs||6)}"></div><div class="field"><label>Hesaplama zaman yakınlığı (dk)</label><input id="pfMarketFresh" type="number" min="30" max="180" value="${Number(s.marketFreshMinutes||90)}"><small>Önerilen 90 dk. Aynı işlem günündeki daha uzak veri Veriler'de korunur, fakat Kn/S yarışına alınmaz.</small></div>${providers.map(p=>`<div class="field"><label>${html(sourceName(p))} paralellik</label><input data-provider-limit="${p}" type="number" min="1" max="24" value="${Number(pc[p]||baseProviderLimit(p))}"></div>`).join('')}<div class="actions" style="grid-column:1/-1"><button class="gold-btn" onclick="savePerformanceControlSettings()">Kaydet</button></div><small style="grid-column:1/-1" class="muted">Bu ayarlar kaynak sayısını azaltmaz. Sağlayıcı fallback/repair zinciri korunur; yalnız eşzamanlılık, bekleme ve IndexedDB yazım paketleri yönetilir. Güvensiz değerler kayıtta güvenli aralığa sıkıştırılır.</small></div>`)}
async function savePerformanceControlSettings(){const n=(id,lo,hi,d)=>Math.max(lo,Math.min(hi,Number($(id)?.value??d))),s=state.settings;s.concurrency=n('#pfConcurrency',1,32,s.concurrency||32);s.maxGlobalConcurrency=n('#pfMaxGlobal',1,32,s.maxGlobalConcurrency||32);s.adaptiveConcurrency=$('#pfAdaptive')?.value!=='false';s.providerHealthAdaptive=$('#pfHealthAdaptive')?.value!=='false';s.retryBackoffBaseMs=n('#pfBackoffBase',100,10000,600);s.retryBackoffMaxMs=Math.max(s.retryBackoffBaseMs,n('#pfBackoffMax',500,60000,15000));s.maxProvider429Retries=n('#pf429',0,6,3);s.circuitBreakerFailures=n('#pfCircuitFailures',1,20,3);s.circuitBreakerCooldownMs=n('#pfCircuitCooldown',1000,900000,30000);s.rateLimitCooldownMs=n('#pfRateCooldown',1000,900000,60000);s.sourceHealthFlushEvery=n('#pfHealthFlush',1,100,8);s.stageBatchSize=n('#pfStageBatch',8,500,192);s.stageFlushMs=n('#pfStageFlush',2,500,6);s.marketFreshMinutes=n('#pfMarketFresh',30,180,90);s.providerConcurrency={...(s.providerConcurrency||{})};document.querySelectorAll('[data-provider-limit]').forEach(el=>{s.providerConcurrency[el.dataset.provider]=Math.max(1,Math.min(24,Number(el.value||1)))});await saveSettings();state.settingsDirty=false;showAurumNotice('Aktarım ve sağlayıcı ayarları kaydedildi','success',2400)}
function setupSettingsAccordion(){const host=document.getElementById('content');if(!host)return;const rows=[...host.querySelectorAll('.aurum-settings-details')],key='aurum.settings.open.v2',scrollKey='aurum.settings.scroll.v2',wanted=sessionStorage.getItem(key);for(const d of rows){if(wanted&&d.id===wanted)d.open=true;d.addEventListener('toggle',()=>{if(!d.open)return;if(d.id)sessionStorage.setItem(key,d.id);for(const other of rows)if(other!==d&&other.open)other.open=false;},{once:false});d.querySelectorAll('button').forEach(b=>b.addEventListener('pointerdown',()=>sessionStorage.setItem(scrollKey,String(window.scrollY||0)),{passive:true}))}requestAnimationFrame(()=>{const y=Number(sessionStorage.getItem(scrollKey)||0);if(Number.isFinite(y)&&y>0)window.scrollTo(0,y)})}

const R44_RESTORE_INDEX_KEY='restorePointsV1';
const R44_RESTORE_MAX=10;
const R44_RESTORE_STORES=['settings','records','runs','meta','bars','actions','criteria','backtests','snapshots','behaviorProfiles','genomeHistory','aiAudits','aiCandidates','aiEvents','sourceHealth','universeHistory'];
function r44RestoreIndex(){const x=readLocal(R44_RESTORE_INDEX_KEY,[]);return Array.isArray(x)?x.slice(0,R44_RESTORE_MAX):[]}
function r44WriteRestoreIndex(rows){writeLocal(R44_RESTORE_INDEX_KEY,(rows||[]).slice(0,R44_RESTORE_MAX))}
async function r44Yield(){return new Promise(r=>setTimeout(r,0))}
async function createRestorePoint(reason='MANUEL',options={}){
  if(!options?.skipConfirm&&String(reason).toUpperCase()==='MANUEL'&&!confirm('Mevcut veri/model durumu geri yükleme noktası olarak kaydedilsin mi?'))return false;
  if(!state.db)throw new Error('Veritabanı hazır değil');
  const id=`RP|${Date.now().toString(36)}|${Math.random().toString(36).slice(2,7)}`,createdAt=nowISO(),stored=[];
  for(const name of R44_RESTORE_STORES){let rows=[];try{rows=await dbAll(name)}catch{}if(name==='meta')rows=rows.filter(x=>!String(x?.key||'').startsWith('restorePoint:'));await dbPut('meta',{key:`restorePoint:${id}:${name}`,value:rows,updatedAt:createdAt});stored.push({name,count:rows.length});await r44Yield();}
  const manifest={id,createdAt,reason:String(reason||'MANUEL'),stored,version:AURUM_RUNTIME_VERSION};await dbPut('meta',{key:`restorePoint:${id}:manifest`,value:manifest,updatedAt:createdAt});
  const prior=r44RestoreIndex(),next=[manifest,...prior.filter(x=>x.id!==id)].slice(0,R44_RESTORE_MAX);r44WriteRestoreIndex(next);
  for(const old of prior.filter(x=>!next.some(n=>n.id===x.id))){for(const name of [...R44_RESTORE_STORES,'manifest'])try{await dbDelete('meta',`restorePoint:${old.id}:${name}`)}catch{}}
  return manifest;
}
async function restoreRestorePoint(id){
  const manifest=(await dbGet('meta',`restorePoint:${id}:manifest`))?.value;if(!manifest)throw new Error('Geri yükleme noktası bulunamadı');
  if(!confirm(`${new Date(manifest.createdAt).toLocaleString('tr-TR')} geri yükleme noktasına dönülsün mü? Mevcut durumun üzerine yazılacaktır.`))return false;
  await createRestorePoint('GERİ_YÜKLEME_ÖNCESİ_OTOMATİK',{skipConfirm:true});
  for(const name of R44_RESTORE_STORES){const snap=(await dbGet('meta',`restorePoint:${id}:${name}`))?.value;if(!Array.isArray(snap))continue;await dbClear(name);if(snap.length)await bulkPut(name,snap);await r44Yield();}
  showAurumNotice('Geri yükleme tamamlandı; uygulama yeniden açılıyor','success',2500);setTimeout(()=>location.reload(),350);return true;
}
async function clearFromSettings(scope){
  const labels={data:'Veriler',kn:'Kn',history:'K_Tarihsel',s:'S',all:'Tüm tablolar'};if(!confirm(`${labels[scope]||scope} temizlensin mi? Bu işlem öncesinde otomatik geri yükleme noktası oluşturulacaktır.`))return false;
  const historyMode=scope==='history'?khHistoryClearChoice():'all';if(historyMode===null)return false;
  if(!(await stopActiveBeforeSettingsClear())){showAurumNotice('Aktif işlem durmadığı için güvenlik amacıyla temizlik yapılmadı','error',3600);return false;}
  await createRestorePoint(`TEMİZLEME_ÖNCESİ_${String(scope).toUpperCase()}`,{skipConfirm:true});
  if(scope==='all'){for(const s of ['data','kn','history','s'])await clearTableScope(s,'all')}else await clearTableScope(scope,historyMode);showAurumNotice(`${labels[scope]||scope} gerçekten temizlendi`,'success',2200);return true;
}
async function resetApplicationR44(){
  if(!confirm('Uygulama yüklenebilir verilerden tamamen arındırılsın mı? Ayarlar dahil silinecektir. İşlem öncesinde geri yükleme noktası oluşturulur.'))return false;
  await createRestorePoint('UYGULAMA_SIFIRLAMA_ÖNCESİ',{skipConfirm:true});
  for(const s of ['settings','records','runs','logs','meta','bars','actions','criteria','backtests','snapshots','behaviorProfiles','genomeHistory','aiAudits','aiCandidates','aiEvents','universeHistory','jobs','stagingRecords','dataIssues','sourceHealth'])await dbClear(s);
  localStorage.removeItem(RUNTIME_META_KEY);showAurumNotice('Uygulama sıfırlandı','success',2200);setTimeout(()=>location.reload(),420);return true;
}
function restorePointsModule(){const rows=r44RestoreIndex();return aurumSettingsCard('Geri Yükleme Noktaları',`Son ${R44_RESTORE_MAX} veri/model durumu`,`<div class="actions"><button class="gold-btn" type="button" onclick="createRestorePoint('MANUEL').then(ok=>{if(ok)renderCurrentPagePreservingView()}).catch(e=>showAurumNotice(e.message,'error',4200))">Şimdi Nokta Oluştur</button></div><div class="card list" style="margin-top:8px">${rows.map((x,i)=>`<div class="list-row"><div><strong>${i+1}. ${html(new Date(x.createdAt).toLocaleString('tr-TR'))}</strong><small>${html(x.reason||'MANUEL')} · ${html(x.version||'')}</small></div><button class="ghost-btn compact-btn" type="button" onclick="restoreRestorePoint('${html(x.id)}').catch(e=>showAurumNotice(e.message,'error',4200))">Geri Yükle</button></div>`).join('')||'<p class="muted">Henüz geri yükleme noktası yok.</p>'}</div><small class="muted">Her uygulama güncellemesi etkinleştirilmeden önce otomatik nokta oluşturulur. En yeni toplam 10 nokta tutulur; manuel noktalar ve başarılı güncelleme sonrası otomatik noktalar aynı güvenli listede saklanır.</small>`,'r44RestorePoints')}
function dataManagementModule(){return aurumSettingsCard('Veri Yönetimi ve Sıfırlama','Tablo bazlı temizleme · tam sıfırlama',`<div class="actions"><button class="ghost-btn" onclick="clearFromSettings('data')">Veriler’i Temizle</button><button class="ghost-btn" onclick="clearFromSettings('kn')">Kn’yi Temizle</button><button class="ghost-btn" onclick="clearFromSettings('history')">K_Tarihsel’i Temizle</button><button class="ghost-btn" onclick="clearFromSettings('s')">S’yi Temizle</button><button class="danger-btn" onclick="clearFromSettings('all')">Tüm Tabloları Temizle</button><button class="danger-btn" onclick="resetApplicationR44()">Uygulamayı Sıfırla</button></div><small class="muted">Temizleme/sıfırlama öncesinde otomatik geri yükleme noktası oluşturulur. Çalışan iş varsa önce ilgili modülden iptal edilmelidir.</small>`,'r44DataManagement')}
async function r44RepairReport(){
  const report={at:nowISO(),online:isOnline(),records:state.records.length,staged:(await dbAll('stagingRecords')).length,jobs:(await dbAll('jobs')).filter(x=>!['COMPLETED','FAILED'].includes(String(x.status))).map(x=>({id:x.id,status:x.status,stage:x.currentStage,error:x.error||null})),integrity:dataIntegrityGate(dataSummary(state.records)),schedulerTimes:schedulerConfiguredTimes(),aiConfigured:!!(state.settings.aiEnabled&&globalThis.AurumNativeAI?.configured?.())};await dbPut('meta',{key:'r44LastRepairReport',value:report,updatedAt:report.at});return report;
}
async function r73FastTransferRepair(){state.settings.adaptiveConcurrency=true;state.settings.providerHealthAdaptive=true;state.settings.richParallelAllProviders=true;state.settings.fastFailoverEnabled=true;state.settings.concurrency=32;state.settings.maxGlobalConcurrency=32;state.settings.providerWaveSize=10;state.settings.interRequestDelayMs=0;state.settings.sourceRetryCount=Math.max(1,Number(state.settings.sourceRetryCount||0));state.settings.stageBatchSize=256;state.settings.stageFlushMs=4;await saveSettings();for(const id of [...STAGE_BATCHES.keys()])try{await flushStageBatch(id)}catch{};return true;}
async function r73StagingRepair(){const r=await recoverOrphanStagingRecords();return {recovered:r.recovered,retained:r.retained,removed:0};}
async function runRepairCenter(mode='DIAGNOSE'){
  try{const report=await r44RepairReport();if(mode==='DIAGNOSE'){const a=await r73ExtendedAudit();showAurumNotice(`Tanı: ${a.summary.issues} bulgu · ${report.staged} staging · ${report.jobs.length} bekleyen iş`,'info',3800);return a}
    if(mode==='AUTO_FIX'){await r73FastTransferRepair();const st=await r73StagingRepair();try{await repairLegacyCorruptRecordsLocal()}catch{};const sch=await startScheduler();const a=await r73ExtendedAudit();showAurumNotice(`Onarım tamamlandı · staging ${st.recovered||0} kurtarıldı · zamanlayıcı ${sch?'OK':'kontrol gerekli'} · ${a.summary.issues} bulgu kaldı`,a.ok?'success':'info',4800);return a}
    if(mode==='CONTROL'){for(const c of [...state.activeControllers])try{if(cancelState()?.requested)c.abort()}catch{};await r73FastTransferRepair();showAurumNotice('Buton/iptal ve hızlı aktarım motoru yeniden uygulandı','success',2400);return true}
    if(mode==='TRANSFER'){await r73FastTransferRepair();showAurumNotice('Hızlı aktarım profili uygulandı · 28 adaptif işçi · 12 provider dalgası','success',2600);return true}
    if(mode==='BACKGROUND'){await r73FastTransferRepair();showAurumNotice('Arka plan staging kuyruğu ve hızlı aktarım profili yeniden uygulandı','success',2600);return true}
    if(mode==='STAGING'){const x=await r73StagingRepair();showAurumNotice(`${x.recovered||0} staging kaydı ana depoya kurtarıldı · ${x.retained||0} doğrulanamayan kayıt korundu`,'success',3000);return x}
    if(mode==='SCHEDULER'){const ok=await startScheduler();const d=await r73SchedulerDiagnostic();showAurumNotice(ok&&d.ok?'Zamanlayıcı yeniden kuruldu ve geçmiş zinciri sağlıklı':d.detail,ok&&d.ok?'success':'error',4200);return {ok,d}}
    if(mode==='ONLINE'){if(!isOnline())throw new Error('Ağ bağlantısı yok');return runManualData('REPAIR')}
    if(mode==='RESUME')return resumePendingJobs();
    if(mode==='AI'){if(!(state.settings.aiEnabled&&globalThis.AurumNativeAI?.configured?.()))throw new Error('AI tanısı için Ayarlar’da geçerli OpenAI API anahtarı gerekli');if(typeof aiRunAudit!=='function')throw new Error('AI denetim motoru kullanılamıyor');return aiRunAudit()}
  }catch(e){showAurumNotice(e?.message||String(e),'error',4600);return false}
}
function repairCenterModule(){const q=r73RepairQueue();return aurumSettingsCard('Sorunları Gider / Onarım','Denetim bulgularının tek giderim merkezi · buton · hız · staging · arka plan · zamanlayıcı · online repair',`<div class="list-row"><div><strong>Denetimden gelen açık kayıtlar</strong><small>${q.length?q.slice(0,6).map(x=>html(x.id)).join(' · '):'Açık bulgu yok'}</small></div><span class="badge ${q.length?'bad':'ok'}">${q.length?q.length:'TEMİZ'}</span></div><div class="actions"><button class="gold-btn" onclick="runRepairCenter('AUTO_FIX')">Tüm Açık Bulguları Onar</button><button class="ghost-btn" onclick="runRepairCenter('DIAGNOSE')">Yeniden Tanıla</button><button class="ghost-btn" onclick="runRepairCenter('CONTROL')">Buton / İptal Motorunu Onar</button><button class="ghost-btn" onclick="runRepairCenter('TRANSFER')">Veri Aktarımını Hızlandır</button><button class="ghost-btn" onclick="runRepairCenter('BACKGROUND')">Arka Plan Aktarımını Onar</button><button class="ghost-btn" onclick="runRepairCenter('STAGING')">Geçici Depoyu Onar</button><button class="ghost-btn" onclick="runRepairCenter('RESUME')">Bekleyen İşi Sürdür</button><button class="ghost-btn" onclick="runRepairCenter('ONLINE')">Online Veri Onarımı</button><button class="ghost-btn" onclick="runRepairCenter('SCHEDULER')">Zamanlayıcıyı Denetle / Onar</button><button class="ghost-btn" onclick="runRepairCenter('AI')">AI ile Tanı</button></div><small class="muted">Onarım komutlarının tamamı yalnız bu modüldedir. Tablo ve Hesaplama Denetimi yalnız hesaplar, sınar, raporlar ve açık bulguları buraya kaydeder.</small>`,'r44RepairCenter')}
function transferArchitectureModule(){const s=state.settings;return aurumSettingsCard('Hızlı Çoklu-Kaynak ve Geçici Depo','Paralel provider dalgaları · kalıcı staging · kesinti sonrası devam',`<div class="form-grid"><div class="field"><label>Tüm uygun kaynakları aynı çalışmada tara</label><select id="r50AllProviders"><option value="true" ${s.richParallelAllProviders!==false?'selected':''}>Açık</option><option value="false" ${s.richParallelAllProviders===false?'selected':''}>Kapalı</option></select></div><div class="field"><label>Aynı sembolde provider dalga genişliği</label><input id="r44ProviderWave" type="number" min="1" max="12" value="${Number(s.providerWaveSize||12)}"></div><div class="field"><label>Staging batch</label><input id="r44StageBatch" type="number" min="4" max="250" value="${Number(s.stageBatchSize||192)}"></div><div class="field"><label>Staging flush ms</label><input id="r44StageFlush" type="number" min="4" max="500" value="${Number(s.stageFlushMs||6)}"></div><div class="actions" style="grid-column:1/-1"><button class="gold-btn" onclick="saveR44TransferSettings()">Kaydet</button></div><small style="grid-column:1/-1" class="muted">Kaynak zenginliği azaltılmaz. Aynı sembol için farklı metrik sağlayıcıları kontrollü paralel dalgalarda çağrılır; deterministic merge uygulanır. Doğrulanmış sonuç önce IndexedDB stagingRecords geçici deposuna yazılır ve yalnız bütünlük kontrolünden sonra ana Veriler tablosuna yayınlanır.</small></div>`,'r44TransferArchitecture')}
async function saveR44TransferSettings(){state.settings.richParallelAllProviders=$('#r50AllProviders')?.value!=='false';state.settings.providerWaveSize=Math.max(1,Math.min(12,Number($('#r44ProviderWave')?.value||12)));state.settings.stageBatchSize=Math.max(8,Math.min(500,Number($('#r44StageBatch')?.value||192)));state.settings.stageFlushMs=Math.max(2,Math.min(500,Number($('#r44StageFlush')?.value||6)));await saveSettings();showAurumNotice('Hızlı aktarım/staging ayarları kaydedildi','success',2200)}
const AURUM_ACCURACY_META_KEY='aurumAccuracyAuditV1';
function aurumAccuracyAuditRows(){const issues=[],checks=[];const add=(id,ok,detail)=>{checks.push({id,ok,detail});if(!ok)issues.push({id,detail})};
  const cal=kh117CanonicalMarketCalendar();add('BIST_2026_07_EYLUL',cal.datePos.has('2026-09-07'),cal.datePos.has('2026-09-07')?'07.09.2026 veri setinde mevcut':'07.09.2026 işlem günü verisi eksik; sonraki güne sıçrama engellendi');
  const hrs=kh117DisplayRows();for(const r of hrs.filter(x=>!x._t0)){const exp=kh117ExpectedAdjacentSession(r.date,1);add(`KH_${r._label}_DPLUS1`,r._reelDate===exp&&r.reelTop20.length===20,`${r.date} → beklenen ${exp||'—'} · Reel ${r.reelTop20.length}/20`);for(const k of KN_V117_TREND){const a=r.criteria?.[k]||[],set=new Set((r.reelTop20||[]).map(x=>x.sym));add(`KH_${r._label}_${k}_HIT`,a.filter(x=>x.realHit).length===a.filter(x=>set.has(x.sym)).length,`${a.filter(x=>x.realHit).length}/20`);}}
  const gate=calculationGateStatus();add('VERILER_INTEGRITY',!!gate.gate.ok,gate.reason||'Veriler bütünlük kapısı geçti');
  for(const k of KN_V117_ORDER){const a=(state.scores?.[k]||[]).slice(0,20),sy=a.map(x=>x.sym);add(`KN_${k}_TOP20`,a.length===20&&new Set(sy).size===20&&sy.every(x=>state.recordMap?.has?.(x)),`${a.length}/20 · benzersiz ${new Set(sy).size}`);}
  const sel=state.selection||[];add('S_SELECTION_REFERENTIAL',sel.every(x=>x?.sym&&state.recordMap?.has?.(x.sym)),`${sel.length} S satırı Veriler evrenine bağlı`);
  const timed=(state.records||[]).filter(r=>r?.marketDataAt||r?.provenance?.marketAt||r?.apiAccessedAt||r?.storedAt).length;add('DATA_MARKET_TIME',state.records.length===0||timed===state.records.length,`${timed}/${state.records.length} satırda kaynak zaman damgası`);
  const conflicts=(state.records||[]).reduce((n,r)=>n+(Array.isArray(r?.conflicts)?r.conflicts.length:0),0);add('SOURCE_CONFLICTS',conflicts===0,`${conflicts} açık kaynak uyuşmazlığı`);
  const histKnMissing=[];for(const r of hrs.filter(x=>!x._t0))for(const k of KN_V117_SEAT_ORDER)for(const x of (r.criteria?.[k]||[]))if(x.knReturn===0&&x.knReturnProvenance!=='VERIFIED_ZERO')histKnMissing.push(`${r._label}.${k}.${x.sym}`);add('NO_FAKE_KN_ZERO',histKnMissing.length===0,histKnMissing.length?`${histKnMissing.length} doğrulanmamış 0 Kn getirisi: ${histKnMissing.slice(0,16).join(' · ')}`:'Doğrulanmamış Kn getirisi 0 olarak sunulmuyor');
  return {at:nowISO(),ok:issues.length===0,checks,issues};}
async function aurumRunAccuracyAudit(repair=false){let before=aurumAccuracyAuditRows(),actions=[];if(repair){KH117_MARKET_CAL_CACHE={fingerprint:null,dates:[],coverage:new Map(),datePos:new Map()};KH117_SERIES_INDEX_CACHE=new WeakMap();KH117_REEL_CACHE={fingerprint:null,byDate:new Map()};actions.push('K_Tarihsel takvim/getiri cache yeniden kuruldu');try{await refreshTableMeta();actions.push('Tablo zaman/provenance metası yenilendi')}catch{}}
  const report=aurumAccuracyAuditRows();report.repair=repair;report.actions=actions;await dbPut('meta',{key:AURUM_ACCURACY_META_KEY,value:report,updatedAt:report.at});showAurumNotice(report.ok?`Doğruluk denetimi geçti · ${report.checks.length} kontrol`:`Doğruluk denetimi: ${report.issues.length} hata/eksik`,report.ok?'success':'error',4800);if(state.page==='settings')renderCurrentPagePreservingView();return report;}
function accuracySettingsModule(){const last=readLocal('aurumAccuracyUiLast',null);return aurumSettingsCard('Veri ve Hesaplama Doğruluk Denetimi','Fail-closed · gerçek piyasa zamanı · as-of Kn · d+1 Reel',`<div class="actions"><button class="gold-btn" onclick="aurumRunAccuracyAudit(false).then(r=>writeLocal('aurumAccuracyUiLast',r))">Şimdi Denetle</button><button class="ghost-btn" onclick="aurumRunAccuracyAudit(true).then(r=>writeLocal('aurumAccuracyUiLast',r))">Denetle ve Güvenli Düzelt</button></div><small class="muted">Denetim Veriler bütünlük kapısını, resmi 2026 BIST oturum günlerini, her K_Tarihsel satırının gerçek d+1 oturumunu, ReelTop20 tamlığını ve hit tutarlılığını kontrol eder. Eksik piyasa günü varsa bir sonraki güne atlamaz; sonucu EKSİK/HATALI bırakır. Güvenli düzeltme yalnız türetilebilir cache/meta katmanlarını yeniden kurar; eksik piyasa fiyatı uydurmaz.</small>${last?`<div class="list-row"><div><strong>Son sonuç: ${last.ok?'OK':'HATA/EKSİK'}</strong><small>${html(formatTableTime(last.at))} · ${last.issues?.length||0} bulgu</small></div></div>`:''}`,'accuracyAudit')}
globalThis.aurumRunAccuracyAudit=aurumRunAccuracyAudit;

 const AURUM_UI_SCALE_KEY='aurum.uiScale.v1',AURUM_UI_SCALE_DEFAULTS={ui:{on:true,v:.9},table:{on:true,v:.9},static:{on:true,v:.9},card:{on:true,v:.9},icon:{on:true,v:.9}};
 function aurumUiScaleRead(){try{return {...AURUM_UI_SCALE_DEFAULTS,...JSON.parse(localStorage.getItem(AURUM_UI_SCALE_KEY)||'{}')}}catch{return {...AURUM_UI_SCALE_DEFAULTS}}}
 function aurumApplyUiScale(){const x=aurumUiScaleRead(),b=document.body;if(!b)return;for(const [k,o] of Object.entries(x)){b.classList.toggle('aurum-scale-'+k,!!o.on);document.documentElement.style.setProperty(`--aurum-${k==='ui'?'ui-text':k}-scale`,String(Number(o.v)||1))}}
 const AURUM_UI_DEFAULT_PCT=90;
 function aurumUiPreviewGlyph(k){return k==='icon'?'<span class="aurum-scale-preview-icon">◆</span>':''}
 function aurumUiScaleSettingsModule(){const x=aurumUiScaleRead(),row=(k,t,d)=>{const pct=Math.round((Number(x[k]?.v)||.9)*100);return `<div class="aurum-ui-scale-row"><div class="aurum-scale-preview" id="aurumScalePreview_${k}" style="--preview-scale:${pct/AURUM_UI_DEFAULT_PCT}"><label><input id="aurumScaleOn_${k}" type="checkbox" ${x[k]?.on?'checked':''}> <span>${t}</span>${aurumUiPreviewGlyph(k)} <b id="aurumScaleOut_${k}" class="aurum-scale-value">%${pct}</b></label></div><div class="aurum-scale-track-wrap"><input class="aurum-scale-range" id="aurumScaleVal_${k}" type="range" min="75" max="200" step="5" value="${pct}" oninput="previewAurumUiScale('${k}',this.value)"><span class="aurum-default-mark" style="left:${(AURUM_UI_DEFAULT_PCT-75)/(200-75)*100}%"><i></i><em>Varsayılan %${AURUM_UI_DEFAULT_PCT}</em></span></div><small>${d}</small></div>`};return aurumSettingsCard('Arayüz Boyutlandırma','Her başlık kendi ayarının canlı önizlemesidir',`<div class="aurum-ui-scale-grid">${row('ui','Uygulama arayüzü yazıları','Menü, düğme ve genel arayüz metinleri')}${row('table','Tablo içerik yazıları','Tablo başlıkları ve veri hücreleri')}${row('static','Sabit yazılar','Başlık, açıklama, etiket ve sabit metinler')}${row('card','Kart içerikleri','Kartların içindeki yazı ve bilgi alanları')}${row('icon','Simgeler','Menü, kart ve arayüz simgeleri')}</div><div class="actions" style="margin-top:10px"><button class="gold-btn" onclick="saveAurumUiScale()">Uygula ve Kaydet</button><button class="ghost-btn" onclick="resetAurumUiScale()">Varsayılana Döndür</button></div><small>Çubuk hareketi yalnız kendi başlığını önizler. Gerçek arayüz Kaydet ile değişir.</small>`)}
 function previewAurumUiScale(k,v){const n=Math.max(75,Math.min(200,Number(v)||AURUM_UI_DEFAULT_PCT)),o=document.getElementById('aurumScaleOut_'+k),pr=document.getElementById('aurumScalePreview_'+k);if(o)o.textContent='%'+n;if(pr)pr.style.setProperty('--preview-scale',String(n/AURUM_UI_DEFAULT_PCT))}
 globalThis.previewAurumUiScale=previewAurumUiScale;
 function saveAurumUiScale(){const x={};for(const k of Object.keys(AURUM_UI_SCALE_DEFAULTS))x[k]={on:!!document.getElementById('aurumScaleOn_'+k)?.checked,v:Number(document.getElementById('aurumScaleVal_'+k)?.value||AURUM_UI_DEFAULT_PCT)/100};localStorage.setItem(AURUM_UI_SCALE_KEY,JSON.stringify(x));aurumApplyUiScale();showAurumNotice('Arayüz boyutları uygulandı','success',1800)}
 function resetAurumUiScale(){const x={};for(const k of Object.keys(AURUM_UI_SCALE_DEFAULTS))x[k]={on:true,v:AURUM_UI_DEFAULT_PCT/100};localStorage.setItem(AURUM_UI_SCALE_KEY,JSON.stringify(x));aurumApplyUiScale();renderCurrentPagePreservingView?.()}
 globalThis.saveAurumUiScale=saveAurumUiScale;globalThis.resetAurumUiScale=resetAurumUiScale;
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',aurumApplyUiScale,{once:true});else aurumApplyUiScale();
function settingsPage(){return `${globalThis.AurumPresentationSettings?.markup?.()||''}${generalSettingsModule()}${performanceControlSettingsModule()}${transferArchitectureModule()}${dataTransferSettingsModule()}${dataQualitySettingsModule()}${schedulerSettingsModule()}${executionSettingsModule()}${learningSettingsModule()}${behaviorGenomeSettingsModule()}${calendarSettingsModule()}${aiApiSettingsModule()}${accuracySettingsModule()}${tableAuditSettingsModule()}${repairCenterModule()}${globalThis.rev20UserRepairModule?.()||''}${dataManagementModule()}${restorePointsModule()}${aurumUpdateModule()}`}

function liveCollectionGate(){return {accepted:true,mayCollectLiveData:true,reason:null};}
function generalSettingsModule(){const s=state.settings||{};return aurumSettingsCard('Veri ve Çalışma Ayarları','Tek pipeline · ağ · sağlayıcılar',`<div class="form-grid"><div class="field"><label>Tarihsel ay</label><input id="generalMonthsBack" type="number" min="6" max="120" value="${Number(s.monthsBack||14)}"></div><div class="field"><label>İstek zaman aşımı (ms)</label><input id="generalRequestTimeoutMs" type="number" min="3000" max="60000" value="${Number(s.requestTimeoutMs||12000)}"></div><div class="field"><label>Genel retry</label><input id="generalRetryCount" type="number" min="0" max="6" value="${Number(s.retryCount||3)}"></div><div class="field"><label>Kaynak retry</label><input id="generalSourceRetryCount" type="number" min="0" max="3" value="${Number(s.sourceRetryCount||0)}"></div><div class="field"><label>Anlık veri</label><select id="generalLiveEnabled"><option value="true" ${s.liveEnabled!==false?'selected':''}>Aktif</option><option value="false" ${s.liveEnabled===false?'selected':''}>Kapalı</option></select></div><div class="field"><label>Asgari veri kalitesi</label><input id="generalQualityMin" type="number" min="0" max="100" value="${Number(s.qualityMin||55)}"></div><div class="field"><label>İş sırası</label><input value="Adaptif paralellik · sağlayıcı bazlı eşzamanlılık" disabled></div><div class="field" style="grid-column:1/-1"><label>Kaynak önceliği</label><input id="generalProviderOrder" value="${html((s.providerOrder||[]).join(','))}"><small>Başarı, gecikme, rate-limit, tazelik ve circuit-breaker puanı çalışma anında bu sırayı dinamikleştirir.</small></div><div class="field" style="grid-column:1/-1"><label>Özel sağlayıcılar JSON</label><textarea id="generalCustomProvidersJson">${html(s.customProvidersJson||'[]')}</textarea><small>API anahtarı veya tokenı kaynak koda gömmeyin; gerekiyorsa kullanıcı yapılandırmasında tutun.</small></div><div class="actions" style="grid-column:1/-1"><button class="gold-btn" onclick="saveRuntimeSettings()">Kaydet</button></div></div>`) }
async function saveRuntimeSettings(){try{const custom=String($('#generalCustomProvidersJson')?.value||'[]');const parsed=JSON.parse(custom);if(!Array.isArray(parsed))throw new Error('Özel sağlayıcılar JSON bir dizi olmalıdır');state.settings.monthsBack=Math.max(6,Math.min(120,Number($('#generalMonthsBack')?.value||state.settings.monthsBack||14)));state.settings.concurrency=Math.max(1,Math.min(32,Number(state.settings.concurrency||32)));state.settings.requestTimeoutMs=Math.max(3000,Math.min(60000,Number($('#generalRequestTimeoutMs')?.value||12000)));state.settings.retryCount=Math.max(0,Math.min(6,Number($('#generalRetryCount')?.value||state.settings.retryCount||3)));state.settings.sourceRetryCount=Math.max(0,Math.min(3,Number($('#generalSourceRetryCount')?.value||0)));state.settings.liveEnabled=$('#generalLiveEnabled')?.value!=='false';state.settings.qualityMin=Math.max(0,Math.min(100,Number($('#generalQualityMin')?.value||55)));state.settings.providerOrder=String($('#generalProviderOrder')?.value||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);state.settings.customProvidersJson=custom;await saveSettings();showAurumNotice('Ayarlar kaydedildi','success',2200)}catch(e){showAurumNotice(e?.message||'Ayarlar kaydedilemedi','error',3200)}}


function stockRunStats(sym){const code=String(sym||'').toUpperCase(),runs=state.runs||[],criteriaCounts={},periods=new Set(),sRuns=[];let knOccurrences=0;for(const run of runs){let touched=false;for(const [k,list] of Object.entries(run.criteria||{})){const hits=(list||[]).filter(x=>String(x?.sym||'').toUpperCase()===code).length;if(hits){criteriaCounts[k]=(criteriaCounts[k]||0)+hits;knOccurrences+=hits;touched=true;}}if(touched)periods.add(run.id||run.createdAt);if((run.selection||[]).some(x=>String(x?.sym||'').toUpperCase()===code))sRuns.push(run);}const currentCriteria=CRITERIA.filter(k=>(state.scores?.[k]||[]).some(x=>String(x?.sym||'').toUpperCase()===code));const currentS=(state.selection||[]).find(x=>String(x?.sym||'').toUpperCase()===code)||null;return {knOccurrences,knPeriods:periods.size,criteriaCounts,currentCriteria,sHistorical:sRuns.length,currentS,sRuns};}
function stockSReturn(sym,stats=stockRunStats(sym)){const code=String(sym||'').toUpperCase(),closed=[];for(const run of stats.sRuns)for(const x of run.selection||[])if(String(x?.sym||'').toUpperCase()===code&&Number.isFinite(x.closeNetReturn))closed.push(Number(x.closeNetReturn));/* closedEntries mirrors evaluated runs in many builds; only use it when run history has no realised return so the same S period is never counted twice. */if(!closed.length)for(const e of state.closedEntries||[])if(String(e?.sym||'').toUpperCase()===code&&Number.isFinite(e.netReturn))closed.push(Number(e.netReturn));const realised=closed.length?100*(closed.reduce((a,r)=>a*(1+r/100),1)-1):null,current=stats.currentS&&Number.isFinite(stats.currentS.currentReturn)?Number(stats.currentS.currentReturn):null,throughToday=realised==null?current:current==null?realised:100*((1+realised/100)*(1+current/100)-1);return {samples:closed.length+(current!=null?1:0),realised,current,compounded:throughToday,latest:current??closed.at(-1)??null};}
function stockAIInsights(sym){const code=String(sym||'').toUpperCase(),out=[];for(const a of (state.ai?.audits||[]).slice(0,30)){for(const m of a.missed_patterns||[])if((m.affected_symbols||[]).some(x=>String(x).toUpperCase()===code))out.push({at:a.created_at,type:'Kaçırılan örüntü',text:`${m.pattern}: ${m.evidence}`});for(const d of a.diagnosis||[]){const text=`${d.title||''} ${d.evidence||''}`;if(new RegExp(`(^|[^A-Z0-9])${code}([^A-Z0-9]|$)`,'i').test(text))out.push({at:a.created_at,type:`AI ${d.severity||''}`.trim(),text:`${d.title}: ${d.evidence}`});}for(const f of a.false_positive_patterns||[]){const text=`${f.pattern||''} ${f.evidence||''}`;if(new RegExp(`(^|[^A-Z0-9])${code}([^A-Z0-9]|$)`,'i').test(text))out.push({at:a.created_at,type:'Yanlış pozitif',text:`${f.pattern}: ${f.evidence}`});}}return out.sort((a,b)=>String(b.at||'').localeCompare(String(a.at||''))).slice(0,8);}
function stockLearningChanges(sym){const code=String(sym||'').toUpperCase(),rows=[];for(const snap of (state.genomeHistory||[]).slice().sort((a,b)=>String(a?.createdAt||a?.date||'').localeCompare(String(b?.createdAt||b?.date||'')))){const p=(snap.profiles||[]).find(x=>String(x?.sym||'').toUpperCase()===code);if(p)rows.push({date:snap.date,at:snap.createdAt||snap.date,temperament:p.temperament||null,traits:(p.topTraits||[]).map(x=>x.key).filter(Boolean)});}const changes=[];let prev=null;for(const x of rows){if(prev){if(x.temperament&&prev.temperament&&x.temperament!==prev.temperament)changes.push({at:x.at,text:`DNA karakteri: ${prev.temperament} → ${x.temperament}`});const a=prev.traits.slice(0,5).join('|'),b=x.traits.slice(0,5).join('|');if(a&&b&&a!==b)changes.push({at:x.at,text:'Öne çıkan karakter/özellik seti değişti'});}prev=x;}return changes.sort((a,b)=>String(b.at||'').localeCompare(String(a.at||''))).slice(0,8);}
function stockSourceName(rec){return sourceName(rec?.marketTimeProvider||rec?.provenance?.marketTimeProvider||(rec?.providers||[]).find(x=>x&&x!=='LOCAL_PREVIOUS')||rec?.source||'—');}
function stockCardMarkup(sym){const code=String(sym||'').trim().toUpperCase(),rec=state.recordMap.get(code)||state.records.find(x=>x.sym===code),sel=state.selection.find(x=>x.sym===code)||null;if(!rec&&!sel)return '<div class="card notice">Hisse kaydı bulunamadı.</div>';const x=sel||rec,p=rec?.behaviorProfile||state.behaviorProfiles.get(code),stats=stockRunStats(code),sr=stockSReturn(code,stats),ai=stockAIInsights(code),learn=stockLearningChanges(code),card=rec?.companyCard||{},marketAt=rec?.marketDataAt||rec?.provenance?.marketAt||TABLE_META.data?.market||null,transferAt=rec?.tableTransferredAt||TABLE_META.data?.transfer||null,changedAt=rec?.recordChangedAt||TABLE_META.data?.changed||null,traits=(p?.genome?.topTraits||[]).slice(0,6),patterns=(p?.activePatterns||[]).slice(0,6);const fmtTime=v=>formatTableTime(v),knTop=Object.entries(stats.criteriaCounts).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,n])=>`${k}×${n}`).join(' · ')||'—';return `<section class="aurum-stock-card"><div class="stock-card-head"><div><span class="eyebrow">HİSSE KARTI</span><h2>${html(code)}</h2><small>${html(rec?.name||card?.companyName||'')}</small></div><span class="badge ${sel?'ok':'warn'}">${sel?'S AKTİF':'İZLEME'}</span></div><div class="stock-time-grid"><div><small>Kaynak</small><b>${html(stockSourceName(rec))}</b></div><div><small>Gerçek veri zamanı</small><b>${html(fmtTime(marketAt))}</b></div><div><small>Güncelleme zamanı</small><b>${html(fmtTime(transferAt))}</b></div><div><small>Son değişiklik zamanı</small><b>${html(fmtTime(changedAt))}</b></div></div><div class="detail-grid stock-key-grid"><div class="detail-cell"><small>Anlık / günlük</small><strong>${fmt(rec?.livePrice??sel?.livePrice)} · ${pct(rec?.dayChange)}</strong></div><div class="detail-cell"><small>Rejim / kalite</small><strong>${html(rec?.marketRegime||'—')} · ${Number.isFinite(rec?.quality)?rec.quality+'/100':'—'}</strong></div><div class="detail-cell"><small>Kn geçmişi</small><strong>${stats.knOccurrences} kayıt · ${stats.knPeriods} dönem</strong><small>${html(knTop)}</small></div><div class="detail-cell"><small>Mevcut Kn</small><strong>${html(stats.currentCriteria.join(' · ')||'—')}</strong></div><div class="detail-cell"><small>S geçmişi</small><strong>${stats.sHistorical} seçim${stats.currentS?' · şu an S’de':''}</strong></div><div class="detail-cell"><small>S bugüne kadar getiri</small><strong class="${(sr.compounded??0)>=0?'green':'red'}">${pct(sr.compounded)}</strong><small>${sr.samples} gerçekleşmiş/aktif ölçüm</small></div><div class="detail-cell"><small>Hedef olasılığı</small><strong>${Number.isFinite(x?.targetProbability)?fmt(x.targetProbability*100,1)+'%':'—'}</strong></div><div class="detail-cell"><small>Risk / maliyet</small><strong>${html(x?.riskLevel||'—')} · ${pct(rec?.estimatedCostPct)}</strong></div></div><h3>Karakter analizi</h3><div class="card stock-compact"><div class="stock-character-line"><b>${html(p?.character?.type||rec?.behaviorType||'—')}</b><span>DNA: ${html(p?.genome?.temperament||rec?.genomeType||'—')}</span></div><div class="trait-row">${traits.map(t=>`<span class="trait-chip">${html(t.label||t.key)} · ${fmt(t.value,2)}</span>`).join('')||'<span class="muted">Belirgin karakter özelliği yok.</span>'}</div><div class="trait-row">${patterns.map(w=>`<span class="pattern-chip">${html(w.name)} · ${fmt((w.dualRate||0)*100,1)}%</span>`).join('')}</div></div><h3>Öğrenme kaynaklı karakter değişimleri</h3><div class="card stock-compact list">${learn.length?learn.map(c=>`<div class="list-row"><span>${html(c.text)}</span><small>${html(fmtTime(c.at))}</small></div>`).join(''):'<span class="muted">Kaydedilmiş karakter değişimi yok.</span>'}</div><h3>AI değerlendirmesi</h3><div class="card stock-compact list">${ai.length?ai.map(c=>`<div class="list-row"><div><b>${html(c.type)}</b><small>${html(c.text)}</small></div><span>${html(fmtTime(c.at))}</span></div>`).join(''):'<span class="muted">Bu hisseye özgü doğrulanmış AI değerlendirme kaydı yok.</span>'}</div>${card?.status==='OK'?`<h3>İş Yatırım görünümü</h3><div class="card stock-compact"><div class="detail-grid"><div class="detail-cell"><small>Öneri</small><strong>${html(card.recommendation?.recommendation||'—')}</strong></div><div class="detail-cell"><small>Hedef fiyat</small><strong>${fmt(card.recommendation?.targetPrice)} TL</strong></div><div class="detail-cell"><small>Potansiyel</small><strong>${Number.isFinite(card.recommendation?.upsidePotentialPct)?fmt(card.recommendation.upsidePotentialPct,1)+'%':'—'}</strong></div><div class="detail-cell"><small>Öneri tarihi</small><strong>${html(card.recommendation?.recommendationDate||'—')}</strong></div></div></div>`:''}<h3>Karar zinciri</h3><div class="card stock-compact"><div class="trait-row">${(x?.supportingCriteria||[]).map(k=>`<span class="badge ok">${html(k)}</span>`).join('')||'<span class="muted">Aktif kriter katkısı yok.</span>'}</div><p>${html((x?.targetReasons||targetReasons(rec||x)||[]).join(' · ')||'Yeterli hedef kanıtı oluşmadı.')}</p>${(rec?.warnings||[]).length?`<small>${html(rec.warnings.join(' · '))}</small>`:''}</div></section>`;}
function showStockCard(sym){const body=document.querySelector('#dialogBody'),dialog=document.querySelector('#detailDialog');if(!body||!dialog)return;body.innerHTML=stockCardMarkup(sym);try{if(!dialog.open)dialog.showModal()}catch{}}
globalThis.showStockCard=showStockCard;globalThis.showDetail=showStockCard;globalThis.showCompanyName=showStockCard;
function missingSymbolListMarkup(summary=TABLE_META.data?.summary||dataSummary()){const plan=currentPendingRepairPlan(),details=plan.items||[];return `<section class="aurum-missing-list"><div class="stock-card-head"><div><span class="eyebrow">VERİ BÜTÜNLÜĞÜ</span><h2>Onarım bekleyenler</h2><small>${details.length} hisse · ${plan.missingCellCount} eksik hücre</small></div></div>${details.length?`<div class="list">${details.map(x=>`<div class="list-row aurum-missing-row"><div><b>${html(x.sym)}</b><small>${html(x.fullSymbol?'Hisse güncellemesi eksik':`${x.fields.length} hücre eksik`)}</small></div><div><span>${x.fields?.length?html(x.fields.slice(0,4).join(' · ')):''}</span><small>${x.fields?.length>4?` +${x.fields.length-4} alan`:''}</small></div></div>`).join('')}</div>`:'<div class="card notice">Eksik hisse veya hücre yok.</div>'}</section>`;}
function showMissingSymbols(){const body=document.querySelector('#dialogBody'),dialog=document.querySelector('#detailDialog');if(!body||!dialog)return;body.innerHTML=missingSymbolListMarkup();try{if(!dialog.open)dialog.showModal()}catch{}}
globalThis.showMissingSymbols=showMissingSymbols;
const MARKET_INDICATOR_META_KEY='marketIndicatorsR41';
function cachedMarketIndicators(){return state.marketIndicators||readLocal(MARKET_INDICATOR_META_KEY,null)||readLocal('marketIndicatorsR40',null)||null;}
function marketIndicatorDerived(values={}){
  const out={...values},notes=[];
  const usd=validNumber(out.USDTRY),eur=validNumber(out.EURTRY),direct=validNumber(out.EURUSD);
  if(direct==null&&usd!=null&&usd!==0&&eur!=null){out.EURUSD=eur/usd;notes.push('EUR/USD doğrudan alınamadı; EUR/TRY ÷ USD/TRY ile hesaplandı.');}
  return {values:out,notes};
}
function marketIndicatorsMarkup(){
  const m=cachedMarketIndicators(),maxAge=Math.max(30,Math.min(180,Number(state.settings?.marketFreshMinutes||90)))*60000,at=Date.parse(m?.at||''),fresh=Number.isFinite(at)&&Date.now()-at<=maxAge,derived=marketIndicatorDerived(m?.values||{}),values=derived.values;
  const item=(label,key,suffix='')=>{const v=fresh?Number(values?.[key]):NaN,ch=fresh?Number(m?.changes?.[key]):NaN,note=m?.changeNotes?.[key]||'';return `<span title="${html(note)}"><b>${html(label)}</b> ${Number.isFinite(v)?html(fmt(v,key==='EURUSD'?4:2)+suffix):'—'} <small>${Number.isFinite(ch)?html((ch>0?'+':'')+fmt(ch,2)+'%'):(note?'!':'—')}</small></span>`};
  const notes=[...(m?.notes||[]),...derived.notes,...Object.values(m?.changeNotes||{}).filter(Boolean)];
  return `<div class="aurum-market-indicators" title="${fresh?`Kaynak zamanı ${html(m.at)}`:'Güncel ve doğrulanmış ortak piyasa göstergesi bulunmuyor'}">${item('BIST 100','XU100')}${item('USD/TRY','USDTRY')}${item('EUR/TRY','EURTRY')}${item('EUR/USD','EURUSD')}${item('Gram Altın','GRAMTRY')}${item('Altın Ons','GOLDUSD')}</div>${notes.length?`<small class="muted aurum-market-indicator-note">${html([...new Set(notes)].join(' · '))}</small>`:''}`;
}
async function refreshMarketIndicators(){
  try{
    const symbols=['XU100.IS','TRY=X','EURTRY=X','EURUSD=X','GC=F'],url=`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`,res=await withProviderSlot('YAHOO_QUOTE',()=>fetchWithTimeout(url,{headers:{Accept:'application/json'},__provider:'YAHOO_QUOTE'},'Yahoo quote')),obj=await responseJSON(res),rows=obj?.quoteResponse?.result||[],by=new Map(rows.map(x=>[x.symbol,x])),q=sym=>by.get(sym)||{},num=(sym,key='regularMarketPrice')=>validNumber(q(sym)?.[key]),times=rows.map(x=>Number(x.regularMarketTime)*1000).filter(Number.isFinite),at=times.length?new Date(Math.min(...times)).toISOString():null;
    const xu=num('XU100.IS'),usd=num('TRY=X'),eur=num('EURTRY=X'),par=num('EURUSD=X'),gold=num('GC=F'),gram=gold!=null&&usd!=null?gold*usd/31.1034768:null;
    if(!at)throw new Error('Piyasa gösterge zamanı doğrulanamadı');
    const rawValues={XU100:xu,USDTRY:usd,EURTRY:eur,EURUSD:par,GOLDUSD:gold,GRAMTRY:gram},derived=marketIndicatorDerived(rawValues),values=derived.values,changes={},changeNotes={},symByKey={XU100:'XU100.IS',USDTRY:'TRY=X',EURTRY:'EURTRY=X',EURUSD:'EURUSD=X',GOLDUSD:'GC=F'};
    for(const [key,sym] of Object.entries(symByKey)){
      const current=validNumber(values[key]),directChange=validNumber(q(sym)?.regularMarketChangePercent),prev=validNumber(q(sym)?.regularMarketPreviousClose);
      if(directChange!=null)changes[key]=directChange;
      else if(current!=null&&prev!=null&&prev!==0)changes[key]=(current/prev-1)*100;
      else changeNotes[key]=`${key}: önceki kapanış değeri bulunamadı; yüzdesel değişim hesaplanamadı.`;
    }
    if(!Number.isFinite(changes.EURUSD)&&Number.isFinite(changes.EURTRY)&&Number.isFinite(changes.USDTRY))changes.EURUSD=((1+changes.EURTRY/100)/(1+changes.USDTRY/100)-1)*100;
    const goldPrev=validNumber(q('GC=F')?.regularMarketPreviousClose),usdPrev=validNumber(q('TRY=X')?.regularMarketPreviousClose),gramPrev=goldPrev!=null&&usdPrev!=null?goldPrev*usdPrev/31.1034768:null;
    if(gram!=null&&gramPrev!=null&&gramPrev!==0)changes.GRAMTRY=(gram/gramPrev-1)*100;else changeNotes.GRAMTRY='GRAMTRY: önceki kapanış bileşenleri bulunamadı; yüzdesel değişim hesaplanamadı.';
    const payload={at,source:'YAHOO_QUOTE',values,changes,changeNotes,notes:derived.notes,previousClose:{XU100:num('XU100.IS','regularMarketPreviousClose'),USDTRY:num('TRY=X','regularMarketPreviousClose'),EURTRY:num('EURTRY=X','regularMarketPreviousClose'),EURUSD:num('EURUSD=X','regularMarketPreviousClose'),GOLDUSD:goldPrev,GRAMTRY:gramPrev},provenance:{EURUSD:par!=null?'EURUSD=X':'EURTRY ÷ USDTRY',GRAMTRY:'GC=F × USDTRY / 31.1034768',changes:'Yahoo regularMarketChangePercent; yoksa current / regularMarketPreviousClose - 1'}};
    state.marketIndicators=payload;writeLocal(MARKET_INDICATOR_META_KEY,payload);try{await dbPut('meta',{key:MARKET_INDICATOR_META_KEY,value:payload})}catch{}return payload;
  }catch(e){return cachedMarketIndicators();}
}
function dataMetaMarkup(){const summary=TABLE_META.data?.summary||dataSummary(),plan=currentPendingRepairPlan(),src=Object.entries(summary.sourceCounts||{}).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${sourceName(k)} ${v}`).join(' · ')||'Kaynak yok',mc=summary.incompleteColumns?.length??summary.missingColumns?.length??0,miss=mc?`Eksik sütun ${mc}/${summary.fields?.length||V141225_ALL_HEADERS.length}`:'Eksik sütun yok',custom=customProviders().length,builtin=9,rt=currentRuntime(),live=String(rt.stage||'')==='Veriler'&&operationBusyStatus(rt.status),stageLine=live?`<div class="aurum-staging-live"><b>Geçici doğrulama:</b> ${Number(rt.validated||0)} doğrulanmış · ${Number(rt.done||0)} denendi · ${Number(rt.failed||0)} başarısız <small>Veriler önce geçici depoda doğrulanır; ilk geçiş tamamlanınca tablo atomik yayınlanır ve eksikler ayrıca tamamlanır.</small></div>`:'';return `<div data-aurum-explicit-time>${marketIndicatorsMarkup()}${tableTimePanel('data')}<div class="aurum-data-status-card" aria-live="polite">${stageLine}<div>${summary.universeCount} hisse · <button type="button" class="aurum-inline-stat" onclick="showMissingSymbols()">${plan.symbolCount} onarım bekliyor</button> · ${Number(summary.realMissingCells??plan.missingCellCount)} gerçek eksik · ${Number(summary.exhaustedMissingCells||0)} tükenmiş · ${Number(summary.activeBlockingMissingCells||0)} aktif/bloke edici</div><div>${html(miss)} · doluluk %${Number(summary.fillPct||0).toFixed(2)} · kullanılabilir ${Number(summary.usableRows||summary.loadedSymbols||0)}</div><div>${html(src)}</div><div class="aurum-source-policy">Kalite öncelikli paralel işçiler · sağlayıcı bazlı hız sınırı · erişilemeyen hisse pas geçilir, önceki veri korunur · ${builtin} yerleşik uç nokta${custom?` + ${custom} özel`:''} · “Eksikleri Tamamla” = Akıllı Tamamlama; ≤30 dk yalnız eksikleri, >30 dk tüm tabloyu yeniden doğrular<small class="aurum-fill-policy">Doluluk hedefi önce %95; sağlanmazsa kademeli ek denemeler %90 → %80 → son güvenlik eşiği %70. %70 altı Veriler görünür kalır fakat Kn, K_Tarihsel, S ve AL/SAT önceki geçerli snapshot ve zaman damgasını korur.</small></div></div></div>`;}
function dataPage(){
  const rows=currentV141225Rows();
  const buttons=`<button class="gold-btn" onclick="AurumRuntime.manualData('GENERAL')" ${state.syncing||state.calculating?'disabled':''}>Verileri Güncelle</button>`;
  const integrity=calculationGateStatus(),blocked=!integrity.gate.ok&&state.records.length>0;
  const warning=blocked?`<div class="card notice aurum-integrity-block"><b>Yeni türev hesaplama kalite kapısında bekliyor</b><p>${html(integrity.reason)}</p><small>Veriler tablosu gizlenmez veya silinmez; mevcut doğrulanmış veri görünür kalır. “Eksikleri Tamamla” alternatif kaynaklarla seçici onarım yapar.</small></div>`:'';
  const content=`${warning}${v141225Tools()}<div id="recordsContent" class="aurum-stable-table" data-aurum-explicit-time>${v141225Table(rows)}</div>`;
  return `${operationBlock('data',buttons)}${dataMetaMarkup()}${content}`;
}
function glnGdnPerformance(kind){let rows=[];if(kind==='s')rows=(state.selection||[]).map(x=>({reel:safeRecordDayChange(state.recordMap?.get?.(x.sym)||state.records?.find?.(r=>r.sym===x.sym)),ret:Number(x.currentReturn)}));else{const k=state.strictActiveKn||'K1',list=(state.scores?.[k]||[]).slice(0,20),seatEligible=KN_V117_SEAT_ORDER.includes(k);rows=list.map(x=>({reel:safeRecordDayChange(state.recordMap?.get?.(x.sym)||state.records?.find?.(r=>r.sym===x.sym)),ret:seatEligible?Number(kn117Entry?.(k,x.sym)?.currentReturn):null}));}const rv=rows.map(x=>x.reel).filter(Number.isFinite),gv=rows.map(x=>x.ret).filter(Number.isFinite);return {reel:rv.length?mean(rv):null,getiri:gv.length?mean(gv):null};}
function glnGdnCard(kind){const bag=state?.tableMetrics?.[kind]||{},p=glnGdnPerformance(kind),show=v=>v==null?'—':(typeof v==='number'?fmt(v,2):html(String(v)));let gln=bag.GLN??bag.gln??state?.[`${kind}GLN`]??null,gdn=bag.GDN??bag.gdn??state?.[`${kind}GDN`]??null,extra='';if(kind==='s'&&Array.isArray(state.selection)&&state.selection.length>=20){if(gln==null||gln==='—'||gln==='')gln='Henüz değişiklik yok';if(gdn==null||gdn==='—'||gdn==='')gdn='Henüz değişiklik yok';}if(kind==='kn'){const k=KN_V117_ORDER.includes(state.strictActiveKn)?state.strictActiveKn:'K1',change=kn117ReadLedger().changes?.[k]||{},hit=kh117HistoricalHitAverage(k),seat=kh117SSeatCount(k);gln=change.gln?.symbols?.length?change.gln.symbols.join(' · '):(change.baselineAt?'Henüz değişiklik yok':'—');gdn=change.gdn?.symbols?.length?change.gdn.symbols.join(' · '):(change.baselineAt?'Henüz değişiklik yok':'—');bag.glnChangedAt=change.gln?.at||bag.glnChangedAt||change.baselineAt||null;bag.gdnChangedAt=change.gdn?.at||bag.gdnChangedAt||change.baselineAt||null;extra=KN_V117_SEAT_ORDER.includes(k)?`<span><b>İsabet ort:</b> ${hit.avg==null?'—':`${fmt(hit.avg,2)}/20`}</span><span><b>S:</b> ${seat}</span>`:`<span><b>Rol:</b> analiz/meta · S/işlem yok</span>`;}const glnTime=bag.glnChangedAt?formatTableTime(bag.glnChangedAt):'—',gdnTime=bag.gdnChangedAt?formatTableTime(bag.gdnChangedAt):'—';return `<div class="aurum-performance-lines" style="flex-wrap:wrap"><span><b>Reel ort:</b> ${p.reel==null?'—':pct(p.reel)}</span><span><b>Getiri ort:</b> ${p.getiri==null?'—':pct(p.getiri)}</span>${extra}</div><div class="aurum-gln-gdn-card" data-gln-gdn="${html(kind)}"><div><b>GLN</b><span>${show(gln)}</span><small>${html(glnTime)}</small></div><div><b>GDN</b><span>${show(gdn)}</span><small>${html(gdnTime)}</small></div></div>`;}
function integrityBlockedMarkup(label){const x=calculationGateStatus();return x.gate.ok?'':`<div class="card notice aurum-integrity-block"><b>${html(label)}: yeni hesaplama bekliyor</b><p>${html(x.reason)}</p><small>Mevcut tablo/snapshot görünür ve korunur; kalite kapısı yalnız yeni hesaplama ve yeni sonuç üretimini engeller.</small></div>`;}
function criteriaPage(){state.strictActiveKn=KN_V117_ORDER.includes(state.strictActiveKn)?state.strictActiveKn:'K1';const buttons=`<button class="gold-btn" onclick="AurumRuntime.manualKn()" ${state.syncing||state.calculating?'disabled':''}>Kn’yi Çalıştır</button>`,block=integrityBlockedMarkup('Kn');return `${operationBlock('kn',buttons)}<div data-aurum-explicit-time>${tableTimePanel('kn')}<div id="knMetricBundle">${glnGdnCard('kn')}</div><div class="section-head"><div class="section-title"><h2>Kn Kriter Tabloları</h2></div><small>K1–K7 aday/işlem uzmanıdır; K8–K12 yalnız tanısal, risk ve meta analiz tablolarıdır</small></div>${block}${AurumKnHistoryV117.renderCriteriaBody()}</div>`}
function kHistoricalSub(){return AurumKnHistoryV117.renderHistoryDeferred?AurumKnHistoryV117.renderHistoryDeferred():AurumKnHistoryV117.renderHistory()}
function historyPage(){const seedDone=kh117ArchiveState()?.seed?.completed===true&&kh117NormalizeArchiveRows(kh117ArchiveState()?.rows,kh117T0()?.date).length>=30,buttons=`<button class="gold-btn" onclick="AurumRuntime.manualHistorical()" ${state.syncing||state.calculating?'disabled':''}>K_Tarihsel’i Çalıştır</button><button class="ghost-btn" onclick="AurumKnHistoryV117.seedPIT30().catch(e=>showAurumNotice(e.message,'error',4600))" ${state.syncing||state.calculating||seedDone?'disabled':''}>${seedDone?'Başlangıç T1–T30 Kilitli':'Başlangıç T1–T30’u Doldur'}</button>`,block=integrityBlockedMarkup('K_Tarihsel');return `${operationBlock('history',buttons)}${block}${kHistoricalSub()}`}
function selectionPage(){const buttons=`<button class="gold-btn" onclick="AurumRuntime.manualS()" ${state.syncing||state.calculating?'disabled':''}>S’yi Çalıştır</button>`,block=integrityBlockedMarkup('S'),rt=currentRuntime(),summary=TABLE_META.data?.summary||dataSummary(),chain=`Veriler ${manualSequence().dataSnapshotId?'✓':'—'} → Kn ${manualSequence().kn?'✓':'—'} → K_Tarihsel ${manualSequence().history?'✓':'—'} → S ${manualSequence().s?'✓':'—'}`;return `${operationBlock('s',buttons)}<div data-aurum-explicit-time>${tableTimePanel('s')}${glnGdnCard('s')}<div class="aurum-data-status-card"><div>Tablo: ${state.selection?.length?state.selection.length+' satır':'boş'} · İşlem: ${html(rt.status||'IDLE')} · ${html(rt.message||'Hazır')}</div><div>${html(chain)} · gerçek eksik ${Number(summary.realMissingCells||0)} · hesaplamaya uygun ${Number(summary.calculationEligibleRows||0)}</div></div>${block}${renderSelectionBody()}</div>`}

function operationConfirm(scope,action){const stage=operationStage(scope);if(action==='cancel')return true;if(action==='repair'&&!(currentRuntime().jobId&&operationBusyStatus(currentRuntime().status)))return true;const text={restart:`${stage}: mevcut işlem varsa derhal iptal edilip baştan başlatılacak. Onaylıyor musunuz?`,repair:`${stage}: devam eden işlem derhal iptal edilip eksikler tamamlanacak. Onaylıyor musunuz?`,clear:`${stage}: çalışan işlem derhal iptal edilip bu tablo temizlenecek. Onaylıyor musunuz?`}[action]||`${stage} işlemini onaylıyor musunuz?`;return globalThis.confirm?confirm(text):false;}
async function cancelActiveOperation(scope,{silent=false}={}){const rt=currentRuntime(),expected=operationStage(scope);if(!rt.jobId||String(rt.stage||'')!==expected||!operationBusyStatus(rt.status)){if(!silent)showAurumNotice(`${expected}: iptal edilecek aktif işlem yok`,'info',1400);return false;}HARD_CANCELLED_JOBS.add(String(rt.jobId));writeLocal(CANCEL_KEY,{requested:true,jobId:rt.jobId,at:nowISO(),hard:true});for(const c of [...state.activeControllers])try{c.abort()}catch{};writeLocal(PAUSE_KEY,{requested:false,jobId:null,requestedAt:null});setRuntime({...rt,message:'İPTAL EDİLDİ · çalışan istekler kapatılıyor…'});if(!silent)showAurumNotice(`${expected}: iptal derhal uygulandı`,'success',1300);return true;}
async function waitOperationStop(ms=12000,jobId=null){const until=Date.now()+ms;while(Date.now()<until){const rt=currentRuntime();if(!state.syncing&&!state.calculating&&(!jobId||rt.jobId!==jobId||!operationBusyStatus(rt.status)))return true;await sleep(60);}return !state.syncing&&!state.calculating;}
function khHistoryClearChoice(){
  const raw=globalThis.prompt?prompt('K_Tarihsel temizleme seçimi:\n\n1 = yalnız T0\n2 = yalnız T1–T30\n3 = T0 + T1–T30\n\n1, 2 veya 3 yazın:','2'):'3';
  if(raw===null)return null;const v=String(raw).trim().toLowerCase();
  if(v==='1'||v==='t0')return 't0';if(v==='2'||v==='t1-t30'||v==='t1')return 'archive';if(v==='3'||v==='all'||v==='tümü'||v==='tum')return 'all';
  showAurumNotice('Geçersiz seçim · 1, 2 veya 3 kullanın','error',2400);return null;
}
async function clearKhHistoryScope(mode='all'){
  const a=kh117ArchiveState(),currentDate=kh117T0()?.date||null;
  if(mode==='t0'||mode==='all'){a.t0ClearedDate=currentDate||a.live?.date||null;a.live=null;}
  if(mode==='archive'||mode==='all'){a.rows=[];a.seed=null;a.lastShift=null;a.lastFinalizedDate=null;const all=await dbAll('runs');for(const r of all)if(/K_TARIHSEL/.test(String(r.kind||'')))await dbDelete('runs',r.id);state.runs=(await dbAll('runs')).map(sanitizeStoredRun).sort((x,y)=>String(y.createdAt||'').localeCompare(String(x.createdAt||'')));}
  state.khArchive=a;await kh117PersistArchive();await dbDelete('meta','historicalSnapshot');
  const saved=(await dbGet('meta','khImmutableArchiveV1'))?.value||{};
  if((mode==='archive'||mode==='all')&&Array.isArray(saved.rows)&&saved.rows.length)throw new Error('K_Tarihsel T1–T30 storage temizlenemedi');
  if((mode==='t0'||mode==='all')&&currentDate&&saved.t0ClearedDate!==currentDate)throw new Error('K_Tarihsel T0 temizleme durumu kaydedilemedi');
}
async function clearTableScope(scope,historyMode='all'){const s=String(scope);if(s==='data'){await dbClear('records');state.records=[];state.recordMap=new Map();state.scores={};state.selection=[];state.modelBySym=new Map();for(const k of ['activeDataSnapshot','lastDataSummary','knSnapshot','selectionSnapshot','knTableState','selectionTableState'])await dbDelete('meta',k);saveManualSequence({dataSnapshotId:null,dataJobId:null,kn:false,history:false,s:false});if((await dbAll('records')).length)throw new Error('Veriler storage temizlenemedi');}
  else if(s==='kn'){state.scores={};state.modelBySym=new Map();delete state.__pendingSelection;await dbDelete('meta','knSnapshot');await dbDelete('meta','knTableState');const seq=manualSequence();seq.kn=false;seq.history=false;seq.s=false;saveManualSequence(seq);if((await dbGet('meta','knSnapshot'))?.value)throw new Error('Kn storage temizlenemedi');}
  else if(s==='history'){await clearKhHistoryScope(historyMode);const seq=manualSequence();seq.history=false;seq.s=false;saveManualSequence(seq);}
  else if(s==='s'){state.selection=[];await dbDelete('meta','selectionSnapshot');await dbDelete('meta','selectionTableState');const seq=manualSequence();seq.s=false;saveManualSequence(seq);if((await dbGet('meta','selectionSnapshot'))?.value)throw new Error('S storage temizlenemedi');}await refreshTableMeta();renderCurrentPagePreservingView();}
async function stopActiveBeforeSettingsClear(){const rt=currentRuntime();if(!rt.jobId||!operationBusyStatus(rt.status))return true;const scope=Object.entries(OPERATION_SCOPE_STAGE).find(([,stage])=>stage===String(rt.stage||''))?.[0];if(!scope)return false;await cancelActiveOperation(scope,{silent:true});return waitOperationStop(12000,rt.jobId);}
async function repairDerivedScope(scope){if(scope==='kn')return runManualKn();if(scope==='history')return runManualHistorical();if(scope==='s')return runManualS();return runManualData('REPAIR');}
async function restartScope(scope){if(scope==='data')return runManualData('FULL');if(scope==='kn')return runManualKn();if(scope==='history')return runManualHistorical();if(scope==='s')return runManualS();return false;}
async function operationCommand(scope,action){scope=String(scope||'data');action=String(action||'');const stage=operationStage(scope),rt=currentRuntime(),busy=!!rt.jobId&&String(rt.stage||'')===stage&&operationBusyStatus(rt.status);if(!operationConfirm(scope,action))return false;if(action==='cancel')return cancelActiveOperation(scope);if(action==='clear'){const mode=scope==='history'?khHistoryClearChoice():'all';if(mode===null)return false;const id=busy?rt.jobId:null;if(busy)await cancelActiveOperation(scope,{silent:true});if(id&&!(await waitOperationStop(12000,id))){showAurumNotice(`${stage}: eski işlem kapanmadığı için güvenlik amacıyla veri silinmedi`,'error',3600);return false;}clearCancel(id);await clearTableScope(scope,mode);showAurumNotice(`${stage} ${mode==='t0'?'T0':mode==='archive'?'T1–T30':'T0 + T1–T30'} temizlendi`,'success',1700);return true;}if(action==='restart'){const id=busy?rt.jobId:null;if(busy)await cancelActiveOperation(scope,{silent:true});if(id&&!(await waitOperationStop(12000,id))){showAurumNotice(`${stage}: eski işlem kapanmadığı için yeniden başlatılmadı`,'error',3600);return false;}clearCancel(id);return restartScope(scope);}if(action==='repair'){const id=busy?rt.jobId:null;if(busy){await cancelActiveOperation(scope,{silent:true});if(!(await waitOperationStop(12000,id))){showAurumNotice(`${stage}: eski işlem kapanmadığı için eksik tamamlama başlatılmadı`,'error',3600);return false;}}clearCancel(id);return repairDerivedScope(scope);}return false;}

function captureView(){const t=document.querySelector('.table-wrap'),c=document.getElementById('content');return {windowY:window.scrollY,tableX:t?.scrollLeft||0,tableY:t?.scrollTop||0,contentScroll:c?.scrollTop||0,activeSym:document.activeElement?.closest?.('tr')?.querySelector?.('.symbol')?.textContent?.trim()||null}}
function restoreView(v){requestAnimationFrame(()=>{try{window.scrollTo(0,v.windowY||0);const t=document.querySelector('.table-wrap'),c=document.getElementById('content');if(t){t.scrollLeft=v.tableX||0;t.scrollTop=v.tableY||0}if(c)c.scrollTop=v.contentScroll||0}catch{}})}
function renderCurrentPagePreservingView(){const v=captureView();render();restoreView(v)}
function globalOperationLabel(){const rt=currentRuntime(),stage=String(rt.stage||''),status=String(rt.status||'IDLE');if(!operationBusyStatus(status))return 'Durum';const map={DATA:'Veriler aktarılıyor',KN:'Kn hesaplanıyor',HISTORY:'K_Tarihsel güncelleniyor',S:'S güncelleniyor',AI:'Öğrenme çalışıyor'};const k=Object.keys(map).find(x=>stage.toUpperCase().includes(x));return map[k]||html(rt.message||'İşlem sürüyor');}
function render(){const titles={overview:'Genel Bakış',market:'Piyasa Özeti',selection:'S · Nihai Seçim',data:'Veriler',criteria:'Kn Tabloları',history:'K_Tarihsel',learning:'Performans ve Öğrenme',ai:'Yapay Zekâ Merkezi',settings:'Ayarlar'},pages={overview,market:globalThis.marketPage||overview,selection:selectionPage,data:dataPage,criteria:criteriaPage,history:historyPage,learning:learningPage,ai:aiPage,settings:settingsPage};const content=$('#content');if(!content)return;const page=state.page||'overview';content.className=`page-${page}`;$('#pageTitle').textContent=titles[page]||'Aurum BIST Analiz';content.innerHTML=(pages[page]||overview)();$$('.bottom-nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===page));const btn=$('#refreshBtn');if(btn){btn.textContent=globalOperationLabel();btn.hidden=false;btn.setAttribute('aria-live','polite');}updateLiveStatus();const decorate=()=>{if((state.page||'overview')!==page)return;try{decorateTableTimePanels()}catch{};try{updateLiveStatus()}catch{}};if(typeof requestIdleCallback==='function')requestIdleCallback(decorate,{timeout:220});else requestAnimationFrame(()=>setTimeout(decorate,0));if(page==='settings')queueMicrotask(()=>{setupSettingsAccordion();content.querySelectorAll('input,select,textarea').forEach(el=>el.addEventListener('input',()=>{state.settingsDirty=true},{once:true}));});}
function goPage(page){if(state.page==='settings'&&page!=='settings'&&state.settingsDirty){if(!confirm('Kaydedilmemiş ayar değişiklikleri var. Kaydetmeden çıkarsanız uygulanmayacak. Çıkılsın mı?'))return false;delete state.__schedulerDraft;state.settingsDirty=false;}state.page=page;if(page==='criteria'){state.strictActiveKn='K1';writeLocal(KN_V117_ACTIVE_KEY,'K1')}render();return true;}
function filterRecords(q){V141225_FILTER_QUERY=String(q||'');V141225_PAGE_INDEX=0;const rows=currentV141225Rows();const box=$('#recordsContent');if(box)box.innerHTML=v141225Table(rows);const count=$('#recordCount');if(count)count.textContent=`${rows.length} hisse`;}

async function bootstrapClean(){
  const nextPaint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const content=document.querySelector('#content'),header=document.getElementById('refreshBtn');
  try{
    /* R26 shell is painted as the actual Overview before any data engine starts. */
    if(!state.settings)state.settings=defaultSettings();
    state.page='overview';
    render();
    if(header){header.textContent='Sistem hazır';}
    await nextPaint();

    await loadState();
    /* Foreground launch is read-only: no migrations, repairs, calculations or network work. */
    /* Background alarm/service launches keep the original strict sequencing; the
       progressive first-paint path is only for the foreground UI. */
    if(BACKGROUND_SYNC){
      /* AUTOFIX2: background alarm WebView must activate the same verified update slot as foreground before scheduled execution. */
      await applyStoredAurumUpdates();
      await repairLegacyCorruptRecordsLocal();
      if(!readLocal(INSTALL_EPOCH_KEY,null))writeLocal(INSTALL_EPOCH_KEY,{establishedAt:nowISO()});
      writeLocal(PAUSE_KEY,{requested:false,jobId:null,requestedAt:null});
      await refreshTableMeta();
      setRuntime({status:JOB_STATUS.IDLE,message:'Hazır',done:0,total:0});
      await scheduledEntry();
      return;
    }

    state.page=state.page||'overview';
    writeLocal(PAUSE_KEY,{requested:false,jobId:null,requestedAt:null});
    setRuntime({status:JOB_STATUS.IDLE,message:'Hazır',done:0,total:0});
    render();

    const nav=document.querySelector('.bottom-nav');
    nav?.addEventListener('click',e=>{const b=e.target.closest('button[data-page]');if(b)goPage(b.dataset.page)});
    const file=document.getElementById('fileInput');
    file?.addEventListener('change',async e=>{const f=e.target.files?.[0];if(f){setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:makeId('IMPORT'),mode:'MANUAL',stage:'İçe Aktarma',done:0,total:1,message:f.name});try{const ok=await importData(f,f.name);if(!ok)throw new Error('Dosya içe aktarılamadı');await refreshTableMeta();setRuntime({status:JOB_STATUS.DATA_COMPLETED,stage:'İçe Aktarma',done:1,total:1,message:'İçe aktarma tamamlandı'});}catch(err){setRuntime({status:JOB_STATUS.FAILED,stage:'İçe Aktarma',done:0,total:1,message:err?.message||String(err)});throw err;}finally{renderCurrentPagePreservingView();}}e.target.value=''});
    const updateInput=document.getElementById('updatePackageInput');
    updateInput?.addEventListener('change',async e=>{const f=e.target.files?.[0];try{if(f)await importAurumUpdateFile(f)}catch(err){showAurumNotice(err?.message||'Güncelleme uygulanamadı','error',4600)}finally{e.target.value=''}});
    if(header){header.disabled=true;header.textContent=globalOperationLabel();header.setAttribute('aria-live','polite');}
    /* Startup/network restoration must not start scheduler work or data jobs. Native scheduled alarms and explicit user actions remain authoritative. */

    /* No deferred startup maintenance. Maintenance runs only from explicit commands or defined scheduled jobs. */
  }catch(e){if(content)content.innerHTML=`<div class="card"><h2>Genel Bakış</h2><p class="muted">Motor başlatma hatası: ${html(e?.message||String(e))}</p></div>`;if(header){header.disabled=false;header.textContent='Şimdi Güncelle';}}
}

async function recoverOnlyExistingOnStartup(){return false}

Object.assign(globalThis,{recoverOrphanStagingRecords,importAurumUpdateFile,rollbackAurumUpdate,rollbackEmbeddedCore,applyStoredAurumUpdates,aurumUpdateModule,openDB,fetchWithTimeout,mergeBundles,fetchSymbolBundle,calculationRecords,calculationGateStatus,classifyDataCompleteness,dataIntegrityGate,buildPendingRepairPlan,currentPendingRepairPlan,tableCalculationAudit,runTableCalculationAudit,tableAuditSettingsModule,repairLegacyCorruptRecordsLocal,startScheduler,generalSettingsModule,saveRuntimeSettings,settingsPage,dataTransferSettingsModule,dataQualitySettingsModule,executionSettingsModule,saveExecutionSettings,learningSettingsModule,saveLearningSettings,behaviorGenomeSettingsModule,saveBehaviorGenomeSettings,calendarSettingsModule,saveCalendarSettings,aiApiSettingsModule,saveSchedulerSettings,dataPage,criteriaPage,historyPage,kHistoricalSub,selectionPage,render,goPage,filterRecords,setV141225Band,changeV141225Page,aurumDataSwipeStart,aurumDataSwipeEnd,schedulerSettingsModule,refreshSchedulerStatus,schedulerSnapshot,operationCommand,operationMiniControls,operationBlock,cancelActiveOperation,clearTableScope,createRestorePoint,restoreRestorePoint,clearFromSettings,resetApplicationR44,runRepairCenter,saveR44TransferSettings,startScheduler});
globalThis.settingsSub=settingsPage;try{settingsSub=settingsPage}catch{}
globalThis.syncProviderChain=opts=>runManualData(normalizeMode(opts?.mode||(opts?.full?'FULL':'GENERAL')));
globalThis.runDataRefresh=mode=>runManualData(mode);
globalThis.recalculateKnTables=runManualKn;
globalThis.recalculateHistoricalTables=runManualHistorical;
globalThis.recalculateSelectionTable=runManualS;
globalThis.recalculateAllTables=()=>{showAurumNotice('Manuel modda tablolar ayrı ayrı ve sırayla çalıştırılır.','info',3200);return false};
globalThis.AurumRuntime=Object.freeze({version:AURUM_RUNTIME_VERSION,status:currentRuntime,summary:dataSummary,manualSequence,manualData:runManualData,manualKn:runManualKn,manualHistorical:runManualHistorical,manualS:runManualS,resume:resumePendingJobs,scheduled:scheduledEntry,providerOrder,togglePause,command:operationCommand,tableTimePanel,operationStrip,jobStatus:JOB_STATUS});

bootstrapClean();


/* Embedded R47 compatibility layer */
/* AurumB R46 compatibility update for R45/R44-compatible appVersionCode 120.
   Scope: forward evaluation/learning, K10 audit contract, candidate gate reasons,
   warning provenance and number formatting. Does not alter provider/Kn/K_Tarihsel/S formulas. */
(function(){
  if(globalThis.AURUM_R46_LEARNING_PIPELINE==='R46.0-FORWARD-EVAL'){
    try{globalThis.AurumUpdateAPI.state.r46Revision={version:'R46.0-FORWARD-EVAL',activatedAt:new Date().toISOString(),alreadyNative:true};}catch{}
    return;
  }

  globalThis.AURUM_R46_LEARNING_PIPELINE='R46.0-FORWARD-EVAL';

  /* Display-only number formatter fix; storage/calculation precision is unchanged. */
  aurumNumberFormat = function aurumNumberFormatR46(value,requestedDigits=2){
    if(value===null||value===undefined)return '—';
    if(typeof value==='string'&&!value.trim())return '—';
    const n=Number(value);
    if(!Number.isFinite(n))return '—';
    const requested=Number.isFinite(Number(requestedDigits))?Math.max(0,Math.trunc(Number(requestedDigits))):2;
    if(requested===0)return n.toLocaleString('tr-TR',{minimumFractionDigits:0,maximumFractionDigits:0,useGrouping:true});
    let digits=2;
    const frac=Math.abs(n-Math.trunc(n));
    if(frac>0&&frac<0.01){
      const dec=frac.toFixed(16).slice(2),first=dec.search(/[1-9]/);
      if(first>=2)digits=Math.min(16,first+2);
    }
    return n.toLocaleString('tr-TR',{minimumFractionDigits:digits,maximumFractionDigits:digits,useGrouping:true});
  };
  globalThis.AurumNumberFormat=aurumNumberFormat;

  compactRunForAI = function compactRunForAIR46(r){
    return {
      id:r.id,created_at:r.createdAt,evaluated_at:r.evaluatedAt,signal_date:r.signalTradingDate,
      window:r.decisionWindow,regime:r.marketRegime,learning_bucket:r.learningBucket||null,
      forward_evaluation:r.evaluated===true&&r.targetDefinition===TARGET_DEFINITION,
      model_schema_fingerprint:r.modelSchemaFingerprint||null,
      metrics:r.metrics?{
        dual_precision:r.metrics.precisionDual20,top20_precision:r.metrics.precisionTop20,
        five_precision:r.metrics.precisionFivePct,dual_lift:r.metrics.dualLift,brier:r.metrics.brier,
        avg_max_net:r.metrics.avgMaxNetReturn,false_positive_rate:r.metrics.falsePositiveRate
      }:null,
      selected:(r.selection||[]).slice(0,20).map(x=>x.sym),
      actual_dual:(r.actualDual||[]).map(x=>x.sym),
      missed_dual:(r.actualDual||[]).map(x=>x.sym).filter(sym=>!(r.selection||[]).some(s=>s.sym===sym))
    };
  };

  buildAISnapshot = function buildAISnapshotR46(){
    const latest=latestTargetRun(),lm=learningMomentum(),criteria={};
    for(const k of CRITERIA){
      const p=state.performance.raw?.[k]||{},independentWeight=MODEL_CRITERIA.includes(k);
      criteria[k]={
        name:CRITERION_CATALOG[k]?.name,
        role:k==='K10'?'DERIVED_MEMORY_CONSENSUS':(k==='K12'?'META_CRITERION':'MODEL_CRITERION'),
        independent_weight:independentWeight,
        weight:independentWeight?(state.performance.weights?.[k]??BASE_WEIGHTS[k]??null):null,
        status:p.status||'ADAY',score:p.score??null,dual_precision:p.dualPrecision??null,
        dual_lift:p.dualLift??null,false_positive_rate:p.falsePositiveRate??null,
        predictions:p.predictions||0,independent_periods:p.independentPeriods||0
      };
    }
    return {
      generated_at:nowISO(),app_version:VERSION,model_version:MODEL_VERSION,target_definition:TARGET_DEFINITION,
      target_return_pct:state.settings.targetReturnPct,
      market_context:marketContext(new Date(),state.records.map(x=>x.latestDate).filter(Boolean).sort().at(-1)||null),
      data_quality:{
        records:state.records.length,mean_quality:mean(state.records.map(x=>x.quality)),
        behavior_coverage:state.behaviorMemory.coverage||0,genome_coverage:state.behaviorMemory.genomeCoverage||0,
        last_successful_sync:state.lastSuccessfulSync
      },
      learning:{
        score:lm.score,periods:lm.periods,last7:lm.last7,previous7:lm.previous7,delta:lm.delta,
        lift:lm.lift,brier:lm.brier,last_decision:state.performance.lastDecision,
        observations:state.performance.observations||0,
        minimum_forward_periods:Number(state.settings.aiMinValidationPeriods||20),forward_only:true
      },
      current_weights:{...(state.performance.championWeights||state.performance.weights||BASE_WEIGHTS)},
      criteria,
      selection:state.selection.slice(0,20).map((x,i)=>({
        rank:i+1,sym:x.sym,total_score:x.totalScore,target_probability:x.targetProbability,
        day_change:x.dayChange,quality:x.quality,risk:x.riskLevel,regime:x.marketRegime,
        behavior_score:x.behaviorScore,genome_score:x.genomeScore,estimated_cost_pct:x.estimatedCostPct,
        supporting_criteria:x.supportingCriteria,target_reasons:x.targetReasons,
        warning_rules_evaluated:Number(x.warningRulesEvaluated??7),
        warning_rules_triggered:Number(x.warningRulesTriggered??(x.warnings||[]).length),
        warnings:x.warnings||[]
      })),
      recent_runs:effectiveLearningRuns().slice(0,state.settings.aiMaxRecentRuns||30).map(compactRunForAI),
      latest_evaluated_run:latest?compactRunForAI(latest):null
    };
  };
  globalThis.buildAISnapshot=buildAISnapshot;

  aiGenerateCandidate = async function aiGenerateCandidateR46(){
    if(!state.settings.aiAllowCandidates)throw new Error('AI aday modeli ayarlardan kapalı');
    if(state.ai.busy)return;
    const audit=state.ai.lastAudit;
    if(!audit)throw new Error('Önce günlük AI denetimi çalıştırılmalı');

    const confidence=Number(audit.confidence||0),
      minConfidence=Number(state.settings.aiMinAuditConfidenceForCandidate||.45),
      criticalFindings=(audit.diagnosis||[]).filter(x=>['CRITICAL','HIGH'].includes(x.severity)),
      minPeriods=Math.max(Number(state.settings.aiMinValidationPeriods||20),Number(state.settings.minWeightObservations||20)),
      observations=effectiveLearningRuns().length,
      missingMetrics=MODEL_CRITERIA.filter(k=>{
        const p=state.performance.raw?.[k];
        return !p||!Number.isFinite(Number(p.dualPrecision))||!Number.isFinite(Number(p.dualLift))||Number(p.predictions||0)<=0;
      });

    const gateReasons=[];
    if(confidence<minConfidence)gateReasons.push(`denetim güveni ${fmt(confidence*100,0)}% < ${fmt(minConfidence*100,0)}%`);
    if(criticalFindings.length)gateReasons.push(`${criticalFindings.length} kritik/yüksek denetim bulgusu`);
    if(observations<minPeriods)gateReasons.push(`bağımsız ileri dönem ${observations}/${minPeriods}`);
    if(missingMetrics.length)gateReasons.push(`performans metriği eksik: ${missingMetrics.join(',')}`);
    if(gateReasons.length)throw new Error(`Aday üretimi engellendi: ${gateReasons.join(' · ')}. Denetim güveni ${fmt(confidence*100,0)}%.`);

    const aiEvidence=await reserveAICall('CANDIDATE_GENERATE',true);
    state.ai.busy=true;state.ai.lastError=null;render();
    try{
      const evidence=effectiveLearningRuns(),
        result=await openAIRequest({
          schemaName:'aurum_candidate_model',schema:AI_CANDIDATE_SCHEMA,
          instructions:'Verilen Aurum denetim ve performans kanıtından yalnız kontrollü bir aday ağırlık önerisi üret. K10 bağımsız ağırlık değildir. Ağırlıkları 0 ile 1 arasında ver. Canlı modeli etkinleştirme kararı verme.',
          input:{snapshot:buildAISnapshot(),audit:deepSecretSanitize(audit)}
        }),
        cutoff=nowISO(),
        stored={...result.parsed,id:uid(),created_at:cutoff,status:'PENDING_FORWARD',
          response_id:result.response?.id||null,request_id:result.requestId,usage:result.response?.usage||null,
          evidence_cutoff_created_at:cutoff,evidence_cutoff_run_id:evidence[0]?.id||null,
          evidence_run_ids:evidence.map(x=>x.id),model_schema_fingerprint:MODEL_SCHEMA_FINGERPRINT,
          parameter_proposals_status:'REQUIRES_SEPARATE_VALIDATION'};

      await dbPut('aiCandidates',stored);
      await recordAIImpact({type:'AI_ADAY',change:'Aday model önerildi',previous:'Şampiyon model',next:stored.id,
        criterion:Object.keys(stored.proposed_weights||{}).join(', ')||'Ağırlıklar',
        reason:stored.rationale||stored.hypothesis||'AI aday önerisi',evidence:stored.evidence_run_ids||[],
        outcome:'ÖNERİ · CANLIYA UYGULANMADI'});
      state.ai.candidates.unshift(stored);state.ai.candidates=state.ai.candidates.slice(0,100);state.ai.lastCandidate=stored;
      await markAIEvidenceResult('COMPLETED',{responseId:stored.response_id,requestId:stored.request_id});
      await log('ok','AI adayı yalnız ileri dönem doğrulamasına alındı',{candidate:stored.id,cutoff,requestId:stored.request_id,evidence:aiEvidence});
      showAurumNotice('Aday model oluşturuldu');
      return stored;
    }catch(e){
      await markAIEvidenceResult('FAILED',{errorClass:e?.name||'Error'});
      state.ai.lastError=e.message;
      await log('error','AI aday modeli oluşturulamadı',{error:e.message});
      throw e;
    }finally{state.ai.busy=false;render();}
  };
  globalThis.aiGenerateCandidate=aiGenerateCandidate;

  /* Run local forward evaluation after a successful DATA or REPAIR publish.
     This is independent of OpenAI quota and leaves failed evaluations retryable. */
  const __r46EvaluateAfterPublish=async function(source){
    try{
      await evaluatePendingRuns();
      await computePerformanceWeights();
      await dbPut('meta',{
        key:'learningEvaluationState',
        value:{evaluatedForwardPeriods:effectiveLearningRuns().length,lastEvaluatedAt:nowISO(),source},
        updatedAt:nowISO()
      });
    }catch(e){
      try{await log('warn',`${source==='DATA_PUBLISH'?'İleri dönem':'Onarım sonrası'} öğrenme değerlendirmesi ertelendi`,{error:e?.message||String(e)});}catch{}
    }
  };

  if(typeof prepareGeneralData==='function'){
    const __r46PrepareGeneralData=prepareGeneralData;
    prepareGeneralData=async function prepareGeneralDataR46(job,mode='GENERAL'){
      const ok=await __r46PrepareGeneralData(job,mode);
      if(ok)await __r46EvaluateAfterPublish('DATA_PUBLISH');
      return ok;
    };
    globalThis.prepareGeneralData=prepareGeneralData;
  }

  if(typeof prepareMissingData==='function'){
    const __r46PrepareMissingData=prepareMissingData;
    prepareMissingData=async function prepareMissingDataR46(job){
      const ok=await __r46PrepareMissingData(job);
      if(ok)await __r46EvaluateAfterPublish('REPAIR_PUBLISH');
      return ok;
    };
    globalThis.prepareMissingData=prepareMissingData;
  }

  try{
    globalThis.AurumUpdateAPI.state.r46Revision={
      version:'R46.0-FORWARD-EVAL',
      activatedAt:new Date().toISOString(),
      features:['FORWARD_EVALUATION','K10_AUDIT_CONTRACT','WARNING_PROVENANCE','CANDIDATE_GATE_REASONS','NUMBER_FORMAT']
    };
  }catch{}
})();

/* AurumB R47 operational correction: K_Tarihsel row hit-average, market labels,
   exact Kn->S seat count, T0 close finalization, S historical recency contribution,
   change notifications best-effort, richer timestamped market summary.
   AI/learning policy is intentionally not changed here. */
(function(){
  if(globalThis.AURUM_R47_OPERATIONAL==='R47.0') return;
  globalThis.AURUM_R47_OPERATIONAL='R47.0';

  const R47_MARKET_KEY='marketIndicatorsR47';
  const R47_NOTIFY_KEY='aurum.r47.membership.notifications.v1';

  function r47Mean(a){const v=(a||[]).map(Number).filter(Number.isFinite);return v.length?v.reduce((s,x)=>s+x,0)/v.length:null;}
  function r47IstanbulParts(value){
    const d=value instanceof Date?value:new Date(value); if(!Number.isFinite(d.getTime()))return null;
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);
    const o=Object.fromEntries(parts.map(x=>[x.type,x.value]));
    return {date:`${o.year}-${o.month}-${o.day}`,minutes:Number(o.hour)*60+Number(o.minute)};
  }

  /* 1) Per-row K_Tarihsel hit average = arithmetic mean of K1..K12 n/20 values. */
  kh117TrendCell=function kh117TrendCellR47(row){
    const a=row?.trend||[];
    const counts=a.map(x=>{const n=Number(x?.total||20),h=Number(x?.hitCount);return Number.isFinite(h)&&n>0?20*h/n:null}).filter(Number.isFinite);
    const returns=a.map(x=>Number(x?.knAvg??x?.returnAvg??x?.avgReturn)).filter(Number.isFinite);
    const avg=r47Mean(counts);
    return `<div class="kh-trend">${a.map(x=>`<span>${html(x.k)} ${Number(x.hitCount||0)}/${Number(x.total||20)}</span>`).join('')}<footer><small>İsabet ort: ${avg==null?'—':fmt(avg,2)+'/20'}</small><small>Getiri ort: ${returns.length?pct(r47Mean(returns)):'—'}</small></footer></div>`;
  };
  globalThis.kh117TrendCell=kh117TrendCell;

  /* 2) Exact K->S seat count: current K Top20 symbol intersection with current S symbols. */
  kh117SSeatCount=function kh117SSeatCountR47(k){
    const top=new Set((state.scores?.[k]||[]).slice(0,20).map(x=>String(x?.sym||'')).filter(Boolean));
    const s=new Set((state.selection||[]).map(x=>String(x?.sym||'')).filter(Boolean));
    let n=0; for(const sym of top)if(s.has(sym))n++; return n;
  };
  globalThis.kh117SSeatCount=kh117SSeatCount;

  /* 3) Market indicators: verified last values remain visible outside the 30-minute live window.
        Freshness controls the status marker, not whether the value is erased. */
  cachedMarketIndicators=function cachedMarketIndicatorsR47(){
    return state.marketIndicators||readLocal(R47_MARKET_KEY,null)||readLocal('marketIndicatorsR40',null)||null;
  };
  globalThis.cachedMarketIndicators=cachedMarketIndicators;

  async function r47YahooChart(symbol){
    let lastErr=null;
    for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
      for(const spec of [['1d','5m'],['5d','1d']]){
        try{
          const url=`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${spec[0]}&interval=${spec[1]}&includePrePost=false&events=div%2Csplits`;
          const res=await withProviderSlot('YAHOO_QUOTE',()=>fetchWithTimeout(url,{headers:{Accept:'application/json'},__provider:'YAHOO_QUOTE'},`Yahoo chart ${symbol}`));
          const obj=await responseJSON(res),x=obj?.chart?.result?.[0],meta=x?.meta||{},q=x?.indicators?.quote?.[0]||{};
          const closes=(q.close||[]),times=x?.timestamp||[];let ix=-1;for(let i=closes.length-1;i>=0;i--)if(Number.isFinite(Number(closes[i]))){ix=i;break;}
          const value=validNumber(meta.regularMarketPrice)??(ix>=0?validNumber(closes[ix]):null);
          const epoch=Number(meta.regularMarketTime)*1000||(ix>=0?Number(times[ix])*1000:NaN);
          if(value==null||!Number.isFinite(epoch))throw new Error('Yahoo chart veri/zaman yok');
          return {value,at:new Date(epoch).toISOString(),source:`YAHOO_CHART_${host.startsWith('query1')?'Q1':'Q2'}`};
        }catch(e){lastErr=e;}
      }
    }
    throw lastErr||new Error(`${symbol} alınamadı`);
  }

  refreshMarketIndicators=async function refreshMarketIndicatorsR47(){
    const symbols={XU100:'XU100.IS',USDTRY:'TRY=X',EURTRY:'EURTRY=X',EURUSD:'EURUSD=X',GOLDUSD:'GC=F'};
    const settled=await Promise.allSettled(Object.entries(symbols).map(async([k,s])=>[k,await r47YahooChart(s)]));
    const fields={},errors=[];
    for(const r of settled){if(r.status==='fulfilled'){const [k,v]=r.value;fields[k]=v}else errors.push(String(r.reason?.message||r.reason||'provider error'));}
    if(!fields.EURTRY&&fields.EURUSD&&fields.USDTRY){fields.EURTRY={value:fields.EURUSD.value*fields.USDTRY.value,at:new Date(Math.min(Date.parse(fields.EURUSD.at),Date.parse(fields.USDTRY.at))).toISOString(),source:'DERIVED_EURUSD_X_USDTRY'};}
    if(fields.GOLDUSD&&fields.USDTRY){fields.GRAMTRY={value:fields.GOLDUSD.value*fields.USDTRY.value/31.1034768,at:new Date(Math.min(Date.parse(fields.GOLDUSD.at),Date.parse(fields.USDTRY.at))).toISOString(),source:'DERIVED_GOLDUSD_X_USDTRY'};}
    const previous=cachedMarketIndicators()||{},prevFields=previous.fields||{};
    for(const k of ['XU100','USDTRY','EURTRY','EURUSD','GOLDUSD','GRAMTRY'])if(!fields[k]&&prevFields[k])fields[k]=prevFields[k];
    const values=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,Number(v.value)]));
    const times=Object.values(fields).map(x=>Date.parse(x.at)).filter(Number.isFinite),at=times.length?new Date(Math.max(...times)).toISOString():(previous.at||null);
    if(!Object.keys(values).length)return previous;
    const payload={at,source:'FIELD_LEVEL_VERIFIED',values,fields,errors:errors.slice(0,8),updatedAt:nowISO()};
    state.marketIndicators=payload;writeLocal(R47_MARKET_KEY,payload);writeLocal('marketIndicatorsR40',payload);
    try{await dbPut('meta',{key:R47_MARKET_KEY,value:payload,updatedAt:nowISO()})}catch{}
    try{await dbPut('meta',{key:'marketIndicatorsR40',value:payload,updatedAt:nowISO()})}catch{}
    return payload;
  };
  globalThis.refreshMarketIndicators=refreshMarketIndicators;

  marketIndicatorsMarkup=function marketIndicatorsMarkupR47(){
    const m=cachedMarketIndicators()||{},fields=m.fields||{},maxAge=Math.max(5,Math.min(1440,Number(state.settings?.marketFreshMinutes||30)))*60000;
    const legacyAt=m.at||null;
    const item=(label,key,digits=2)=>{
      const f=fields[key]||null,v=Number(f?.value??m?.values?.[key]),at=f?.at||legacyAt,age=Date.now()-Date.parse(at||''),fresh=Number.isFinite(age)&&age<=maxAge;
      const txt=Number.isFinite(v)?fmt(v,digits):'—',stamp=at?formatTableTime(at):'—';
      return `<span title="${html(`${f?.source||m.source||'doğrulanmış kayıt'} · ${stamp}${fresh?'':' · son doğrulanmış değer'}`)}"><b>${html(label)}</b> ${html(txt)}${Number.isFinite(v)&&!fresh?' <small>•</small>':''}</span>`;
    };
    return `<div class="aurum-market-indicators">${item('BIST 100','XU100')}${item('USD','USDTRY')}${item('EUR','EURTRY')}${item('Parite','EURUSD',4)}${item('Altın gr','GRAMTRY')}${item('Ons','GOLDUSD')}</div>`;
  };
  globalThis.marketIndicatorsMarkup=marketIndicatorsMarkup;

  /* 4) T0 finalizes only when every unique symbol in all Kn Top20 cells has a verified
        market timestamp for that trading date at/after BIST close. */
  function r47T0Symbols(t0){const s=new Set();for(const k of KN_V117_ORDER)for(const x of t0?.criteria?.[k]||[])if(x?.sym)s.add(String(x.sym));return [...s];}
  function r47RecordClosed(rec,date){
    if(!rec||String(rec.latestDate||'')!==date||rec.marketTimeVerified!==true||!rec.marketDataAt)return false;
    const p=r47IstanbulParts(rec.marketDataAt);return !!p&&p.date===date&&p.minutes>=1090;
  }
  function r47T0FinalStatus(){
    const current=kh117T0(),archive=kh117ArchiveState(),prior=archive.live;
    if(!current?.date||!prior?.date||String(current.date)<=String(prior.date))return {ready:false,t0:current,prior,syms:r47T0Symbols(prior),missing:[]};
    const evidence=(state.records||[]).filter(r=>r?.latestDate===current.date&&r?.jobDataStatus==='FRESH');
    return {ready:evidence.length>0,t0:current,prior,syms:r47T0Symbols(prior),missing:[],nextDayEvidence:evidence.slice(0,8).map(r=>({sym:r.sym,date:r.latestDate,at:r.marketDataAt||r.apiAccessedAt||null}))};
  }
  globalThis.r47T0FinalStatus=r47T0FinalStatus;

  async function r47FinalizeT0IfReady(source='CHECK'){
    const q=r47T0FinalStatus();if(!q.ready)return false;
    const shifted=await kh117AdvanceArchive(q.t0);
    if(!shifted?.shifted)return false;
    const date=shifted.shiftedDate;
    try{const locks=readLocal(HISTORY_LOCK_KEY,{rows:{}});locks.rows=locks.rows||{};locks.rows[date]={...(locks.rows[date]||{}),lockedAt:nowISO(),finalized:true,source,rule:'FIRST_VERIFIED_DATA_FROM_NEW_TRADING_DAY'};writeLocal(HISTORY_LOCK_KEY,locks);}catch{}
    const a=kh117ArchiveState();a.lastFinalizedDate=date;a.lastShift={...(a.lastShift||{}),source,rule:'FIRST_VERIFIED_DATA_FROM_NEW_TRADING_DAY',nextDayEvidence:q.nextDayEvidence||[]};state.khArchive=a;await kh117PersistArchive();
    if(state.page==='history')renderCurrentPagePreservingView();return true;
  }
  globalThis.r47FinalizeT0IfReady=r47FinalizeT0IfReady;

  const __r47RowsBase=kh117Rows;
  kh117Rows=function kh117RowsR47(){
    const t0=kh117T0(),a=kh117ArchiveState();
    if(a.lastFinalizedDate===t0.date&&a.rows?.some(x=>x.date===t0.date)){
      const arch=kh117NormalizeArchiveRows(a.rows,null).slice(0,30);
      const waiting={date:t0.date,provisional:true,reelTop20:[],criteria:{},summaries:{},trend:[],_label:'T0',_t0:true,_awaiting:true};
      return [waiting,...arch.map((r,i)=>({...kh117CloneValue(r),_label:`T${i+1}`,_t0:false,provisional:false,frozen:true}))];
    }
    return __r47RowsBase();
  };
  globalThis.kh117Rows=kh117Rows;

  /* 5) Modest recency evidence for S only. Other S factors remain dominant. */
  function r47HistoryRecencyScores(){
    const rows=(kh117ArchiveState().rows||[]).filter(x=>x?.frozen).slice(0,30),raw=new Map();let max=0;
    rows.forEach((row,age)=>{const ageW=Math.pow(.93,age);for(const k of KN_V117_ORDER){const list=(row.criteria?.[k]||[]).slice(0,20);list.forEach((x,rank)=>{if(!x?.sym)return;const rankW=(20-rank)/20,hitW=x.realHit?1.15:1;const add=ageW*rankW*hitW;raw.set(x.sym,(raw.get(x.sym)||0)+add);max=Math.max(max,raw.get(x.sym));});}});
    const out=new Map();for(const [sym,v] of raw)out.set(sym,max>0?v/max:0);return out;
  }
  function r47ApplyHistoryRecency(built){
    const hs=r47HistoryRecencyScores();if(!built?.bySym||!hs.size)return built;
    for(const [sym,x] of built.bySym){const h=hs.get(sym)||0;x.kHistoricalRecencyScore=h;x.totalScore=clamp(Number(x.totalScore||0)+3.0*h,0,100);x.targetReasons=[...(x.targetReasons||[])];if(h>=.55)x.targetReasons.push(`K_Tarihsel güncellik ${fmt(h*100,0)}/100`);}
    built.selection=[...built.bySym.values()].sort((a,b)=>b.totalScore-a.totalScore||b.targetProbability-a.targetProbability||a.sym.localeCompare(b.sym)).slice(0,state.settings.topN);return built;
  }
  globalThis.r47ApplyHistoryRecency=r47ApplyHistoryRecency;

  /* Best-effort notification on current APK. Native arbitrary notification bridge is not
     present in the inspected R45 DEX; Web Notification is attempted only when supported/granted. */
  function r47Notify(title,body){
    try{if('Notification' in globalThis&&Notification.permission==='granted'){new Notification(title,{body,tag:`aurum-${title}`});return true;}}catch{}
    try{showAurumNotice(`${title}: ${body}`,'info',4200)}catch{} return false;
  }
  function r47Diff(prev,next){const p=new Set(prev||[]),n=new Set(next||[]);return {in:[...n].filter(x=>!p.has(x)),out:[...p].filter(x=>!n.has(x))};}

  const __r47LedgerBase=kn117UpdateLedger;
  kn117UpdateLedger=function kn117UpdateLedgerR47(at=nowISO()){
    const before=kn117ReadLedger(),snapshot=Object.fromEntries(KN_V117_ORDER.map(k=>[k,Object.keys(before.active?.[k]||{})]));
    const out=__r47LedgerBase(at);
    for(const k of KN_V117_ORDER){const d=r47Diff(snapshot[k],Object.keys(out.active?.[k]||{}));if(d.in.length)r47Notify(`${k} · GLN`,d.in.join(', '));if(d.out.length)r47Notify(`${k} · GDN`,d.out.join(', '));}
    return out;
  };
  globalThis.kn117UpdateLedger=kn117UpdateLedger;

  /* Canonical S calculation with only one added step: capped historical recency bonus. */
  calculateS=async function calculateSR47(job){
    job.currentStage='S';await transition(job,JOB_STATUS.S_RUNNING,{message:'Nihai seçim hesaplanıyor',done:0,total:1});state.calculating=true;state.progress={stage:'S',current:'Nihai seçim',done:0,total:1,errors:0};
    try{
      await pauseCheckpoint(job,JOB_STATUS.S_RUNNING);const calcRecords=calculationRecords();
      const priorSymbols=(state.selection||[]).map(x=>x.sym),cached=state.__modelCache?.dataSnapshotId===job.dataSnapshotId?state.__modelCache.built:null,built=r47ApplyHistoryRecency(cached||rebuildModelViews(calcRecords));
      
      state.scores=built.scores;state.selection=built.selection;state.modelBySym=built.bySym;await updateSelectionLifecycle();
      const persistedSelection=state.selection.map(x=>{const y={...x};delete y.record;return y;});await dbPut('meta',{key:'selectionTableState',value:{dataSnapshotId:job.dataSnapshotId,rowsVersion:2,rows:persistedSelection,updatedAt:nowISO(),historyRecency:'EXP_0.93_CAP_3PT'},updatedAt:nowISO()});
      await pauseCheckpoint(job,JOB_STATUS.S_RUNNING);const sPrev=(await dbGet('meta','selectionSnapshot'))?.value||{},sTransferredAt=nowISO(),sFingerprint=selectionTableFingerprint(),sChangedAt=sPrev.fingerprint===sFingerprint&&sPrev.changedAt?sPrev.changedAt:sTransferredAt,currentSymbols=state.selection.map(x=>x.sym),previousSymbols=Array.isArray(sPrev.symbols)?sPrev.symbols:priorSymbols,d=r47Diff(previousSymbols,currentSymbols);const priorGln=Array.isArray(sPrev.gln)?sPrev.gln:[],priorGdn=Array.isArray(sPrev.gdn)?sPrev.gdn:[],validSet=currentSymbols.length>=20&&previousSymbols.length>=20,nextGln=validSet&&d.in.length?d.in:priorGln,nextGdn=validSet&&d.out.length?d.out:priorGdn,glnChangedAt=validSet&&d.in.length?sTransferredAt:(sPrev.glnChangedAt||null),gdnChangedAt=validSet&&d.out.length?sTransferredAt:(sPrev.gdnChangedAt||null);state.tableMetrics=state.tableMetrics||{};state.tableMetrics.s={...(state.tableMetrics.s||{}),gln:nextGln.length?nextGln.join(' · '):'—',gdn:nextGdn.length?nextGdn.join(' · '):'—',glnChangedAt,gdnChangedAt};await dbPut('meta',{key:'selectionSnapshot',value:{dataSnapshotId:job.dataSnapshotId,at:sTransferredAt,transferredAt:sTransferredAt,changedAt:sChangedAt,fingerprint:sFingerprint,symbols:currentSymbols,gln:nextGln,gdn:nextGdn,glnChangedAt,gdnChangedAt,glnGdnBasis:'LAST_REAL_CHANGE_PERSISTED'},updatedAt:sTransferredAt});if(validSet&&(d.in.length||d.out.length)){job.sMembershipChange={entered:d.in.slice(),exited:d.out.slice(),at:sTransferredAt};}
      await markDerivedUpdate('S');await refreshTableMeta();const qev=await globalThis.AurumQualifiedBuySell?.advance?.(job);if(qev){try{await globalThis.AurumPortfolio?.reconcile?.()}catch(e){console.warn('AL/SAT portfolio reconcile',e)}if(qev.buys?.length||qev.sells?.length)job.sNotificationDetail=`${qev.buys?.length?`AL ${qev.buys.join(', ')}`:''}${qev.buys?.length&&qev.sells?.length?' · ':''}${qev.sells?.length?`SAT ${qev.sells.join(', ')}`:''}`;}await transition(job,JOB_STATUS.COMPLETED,{completedAt:nowISO(),message:`S tamamlandı · ${state.selection.length} hisse`,done:1,total:1});job.completedAt=nowISO();await saveJob(job);try{await maybeRunAIDailyAudit()}catch(e){await log('error','Otomatik AI denetimi çalıştırılamadı',{error:e?.message||String(e)})}return true;
    }catch(e){if(e?.code==='OPERATION_CANCELLED'||cancelRequested(job)){await transition(job,JOB_STATUS.IDLE,{error:null,message:'S iptal edildi · önceki tablo korundu'});return false;}await transition(job,JOB_STATUS.FAILED,{error:e?.message||String(e),message:'S başarısız'});return false}
    finally{state.calculating=false;clearCancel(job.id);renderCurrentPagePreservingView();}
  };
  globalThis.calculateS=calculateS;

  /* Finalization checks are event-driven after data/repair and Kn completion. */
  if(typeof prepareGeneralData==='function'){
    const base=prepareGeneralData;prepareGeneralData=async function prepareGeneralDataR47(job,mode='GENERAL'){const ok=await base(job,mode);if(ok){try{await refreshMarketIndicators()}catch{}try{await r47FinalizeT0IfReady('DATA_PUBLISH')}catch{}}return ok};globalThis.prepareGeneralData=prepareGeneralData;
  }
  if(typeof prepareMissingData==='function'){
    const base=prepareMissingData;prepareMissingData=async function prepareMissingDataR47(job){const ok=await base(job);if(ok){try{await refreshMarketIndicators()}catch{}try{await r47FinalizeT0IfReady('REPAIR_PUBLISH')}catch{}}return ok};globalThis.prepareMissingData=prepareMissingData;
  }
  if(typeof calculateKn==='function'){
    const base=calculateKn;calculateKn=async function calculateKnR47(job){const ok=await base(job);if(ok)try{await r47FinalizeT0IfReady('KN_COMPLETED')}catch{}return ok};globalThis.calculateKn=calculateKn;
  }

  /* 6) Richer timestamped market summary. Publication timestamp is parsed when the source
        exposes it; otherwise retrieval time is shown explicitly, never invented as publish time. */
  (function installR47MarketSummary(){
    const CACHE='aurum.final.market.summary.r47',TTL=10*60*1000,ISY='https://www.isyatirim.com.tr';
    const URLS={news:ISY+'/tr-tr/analiz/Haberler/Sayfalar/default.aspx',recs:ISY+'/tr-tr/analiz/Sayfalar/is-yatirimin-onerileri.aspx',bigpara:'https://bigpara.hurriyet.com.tr/haberler/'};
    const clean=s=>String(s??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim(),esc=s=>clean(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),norm=s=>clean(s).toLocaleLowerCase('tr-TR');
    const load=()=>{try{return JSON.parse(localStorage.getItem(CACHE)||'null')}catch{return null}},save=x=>{try{localStorage.setItem(CACHE,JSON.stringify(x))}catch{}};
    async function text(url){const r=await fetch(url,{cache:'no-store',headers:{Accept:'text/html,application/xhtml+xml'}});if(!r.ok)throw new Error(`${new URL(url).hostname} HTTP ${r.status}`);return r.text()}
    function doc(t){return new DOMParser().parseFromString(String(t||''),'text/html')}
    function nearbyTime(el){const host=el.closest('article,li,tr,.item,.news,.haber,.card')||el.parentElement;const txt=clean(host?.textContent||'');const m=txt.match(/\b(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})(?:\s+(\d{1,2}:\d{2}))?\b/);return m?`${m[1]}${m[2]?' '+m[2]:''}`:null;}
    function headlines(d,source,retrievedAt){const out=[],seen=new Set();for(const el of d.querySelectorAll('h1,h2,h3,h4,a')){const title=clean(el.textContent);if(title.length<20||title.length>260)continue;const k=norm(title);if(seen.has(k)||/^(ana sayfa|haberler|borsa|analiz|detay|devamı?)$/.test(k))continue;seen.add(k);let sym='';for(const tok of title.toUpperCase().match(/[A-Z0-9]{2,8}/g)||[])if((state.recordMap?.has?.(tok)||currentSymbols().includes(tok))){sym=tok;break;}out.push({title,source,sym,publishedAt:nearbyTime(el),retrievedAt});if(out.length>=80)break;}return out;}
    function classify(a){const market=[],company=[];for(const x of a){if(x.sym)company.push(x);else market.push(x)}return {market:market.slice(0,18),company:company.slice(0,18)};}
    function renderNews(a,empty){return `<div class="card list">${a?.length?a.map(x=>`<div class="list-row"><div><strong>${esc(x.title)}</strong><small>${esc([x.sym,x.source].filter(Boolean).join(' · '))}</small><small>${x.publishedAt?`Yayın: ${esc(x.publishedAt)}`:`Yayın zamanı: kaynakta yok · Alınma: ${esc(new Date(x.retrievedAt).toLocaleString('tr-TR'))}`}</small></div></div>`).join(''):`<p class="muted">${esc(empty)}</p>`}</div>`;}
    function render(d){const m=d.indicators||cachedMarketIndicators();return `<div class="section-head"><div class="section-title"><h2>Döviz · Altın · Borsa</h2></div><small>Son doğrulanmış değerler</small></div>${marketIndicatorsMarkup()}<div class="grid two-col"><div><div class="section-head"><h2>Piyasa Haberleri</h2></div>${renderNews(d.marketNews,'Güncel piyasa haberi ayrıştırılamadı.')}</div><div><div class="section-head"><h2>Şirket Haberleri</h2></div>${renderNews(d.companyNews,'Güncel şirket haberi ayrıştırılamadı.')}</div></div><div class="card notice aurum-brief-notice"><b>Kaynaklar</b><small>Bigpara · Yahoo Finance · Foreks açık servis · yalnız doğrudan yayımlanan fiyat/yüzde</small><small>Son yenileme: ${esc(new Date(d.updatedAt).toLocaleString('tr-TR'))}</small>${d.errors?.length?`<small>${d.errors.length} kaynak yanıt vermedi.</small>`:''}</div>`;}
    globalThis.refreshAurumMarketSummary=async function refreshAurumMarketSummaryR47(force=false){const host=document.querySelector('#aurumMarketSummaryBody');if(!host)return;const cached=load();if(cached)host.innerHTML=render(cached);if(!force&&cached&&Date.now()-Date.parse(cached.updatedAt)<TTL)return;if(globalThis.__aurumMarketSummaryLoading)return;globalThis.__aurumMarketSummaryLoading=true;try{const retrievedAt=nowISO(),rs=await Promise.allSettled(Object.entries(URLS).map(async([k,u])=>[k,await text(u)])),all=[],errors=[];for(const r of rs){if(r.status==='fulfilled'){const [k,t]=r.value;all.push(...headlines(doc(t),k==='news'?'İş Yatırım':k==='bigpara'?'Bigpara':'İş Yatırım',retrievedAt))}else errors.push(String(r.reason?.message||r.reason))}const c=classify(all);const indicators=await refreshMarketIndicators();const d={updatedAt:nowISO(),marketNews:c.market,companyNews:c.company,indicators,errors};save(d);if(state.page==='market'&&document.querySelector('#aurumMarketSummaryBody'))document.querySelector('#aurumMarketSummaryBody').innerHTML=render(d);}catch(e){if(!cached)host.innerHTML=`<div class="card notice"><b>Piyasa özeti yüklenemedi</b><p>${esc(e?.message||e)}</p></div>`}finally{globalThis.__aurumMarketSummaryLoading=false}};
    globalThis.marketPage=function marketPageR47(){const cached=load();setTimeout(()=>globalThis.refreshAurumMarketSummary?.(false),0);return `<div class="actions" style="margin-bottom:12px"><button class="ghost-btn" type="button" onclick="goPage('overview')">← Genel Bakışa Dön</button><button class="gold-btn" type="button" onclick="refreshAurumMarketSummary(true)">Yenile</button></div><div class="section-head"><div class="section-title"><h2>Piyasa Özeti</h2></div><small>Haber · şirket · döviz · altın · borsa</small></div><div id="aurumMarketSummaryBody">${cached?render(cached):'<div class="card"><p class="muted">Piyasa özeti yükleniyor…</p></div>'}</div>`;};
  })();

  try{globalThis.AurumUpdateAPI.state.r47Revision={version:'R47.0',activatedAt:new Date().toISOString(),features:['KH_ROW_HIT_AVG_X20','MARKET_INDICATOR_VERIFIED_LAST','KN_S_EXACT_INTERSECTION','T0_CLOSE_FINALIZATION','S_HISTORY_RECENCY','MARKET_SUMMARY_TIMESTAMPS','MEMBERSHIP_NOTIFICATION_BEST_EFFORT']};}catch{}
})();


/* Embedded R49 finalization layer */
/* AurumB R49 — next-session T0 finalization contract.
   T0 is the live mirror of Kn. The moment at least one verified record reflects a
   later trading session than T0 (by trading date or verified market timestamp),
   the current T0 is frozen verbatim into T1. Existing T1..T29 shift to T2..T30.
   Frozen archive values are never recomputed by this finalizer. */
(function(){
  if(globalThis.AURUM_R49_T0_NEXT_SESSION==='R49.0') return;
  globalThis.AURUM_R49_T0_NEXT_SESSION='R49.0';

  function r49IstanbulDate(iso){
    if(!iso)return null;
    try{
      const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso));
      const o=Object.fromEntries(p.map(x=>[x.type,x.value]));
      return `${o.year}-${o.month}-${o.day}`;
    }catch{return null;}
  }
  function r49NextSessionEvidence(t0){
    const date=String(t0?.date||'');
    if(!date)return null;
    for(const rec of state.records||[]){
      const rd=String(rec?.latestDate||'');
      const td=r49IstanbulDate(rec?.marketDataAt||rec?.latestMarketTime||rec?.providerTimestamp||null);
      if((rd&&rd>date)||(td&&td>date)){
        return {sym:rec.sym||null,recordDate:rd||null,marketDate:td||null,marketDataAt:rec.marketDataAt||null};
      }
    }
    return null;
  }
  function r49ArchiveRowComplete(row){
    if(!row||!row.date)return false;
    const order=globalThis.KN_V117_ORDER||[];
    if(!order.length)return false;
    for(const k of order){
      const a=row.criteria?.[k];
      if(!Array.isArray(a)||a.length<20)return false;
      if(a.slice(0,20).some(x=>!x?.sym))return false;
    }
    return Array.isArray(row.reelTop20)&&row.reelTop20.length>=20;
  }
  function r49ArchiveWindowComplete(a){
    return Array.isArray(a?.rows)&&a.rows.length>=30&&a.rows.slice(0,30).every(r49ArchiveRowComplete);
  }

  async function r49EnsureFullArchiveBeforeShift(){
    /* Natural archive shifting never launches PIT/backfill by itself.
       The one-time manual seed button must establish the initial complete 30-row backing window. */
    return r49ArchiveWindowComplete(kh117ArchiveState());
  }

  async function r49FinalizeT0OnNextSession(source='NEXT_SESSION_CHECK'){
    const t0=kh117T0();
    if(!t0?.date)return false;
    const ev=r49NextSessionEvidence(t0);
    if(!ev)return false;
    const a=kh117ArchiveState();
    if(a.lastFinalizedDate===t0.date||a.rows?.some(x=>x?.date===t0.date&&x?.frozen===true))return false;

    /* Keep a 30-row complete backing window before replacement. If historical data truly
       cannot provide it, do not invent values; preserve the previous archive and report. */
    const full=await r49EnsureFullArchiveBeforeShift();
    if(!full){
      try{await log('warn','T0 arşiv geçişi ertelendi: T1–T30 tam değil',{t0Date:t0.date,source,evidence:ev});}catch{}
      return false;
    }

    const before=kh117NormalizeArchiveRows(a.rows,null).slice(0,30);
    const frozen={...kh117CloneValue(t0),source:'LIVE_NEXT_SESSION_FINAL',provisional:false,frozen:true,archivedAt:nowISO(),anchorId:`final:${t0.date}`,finalization:{source,rule:'FIRST_VERIFIED_NEXT_SESSION_RECORD',evidence:ev}};
    if(!r49ArchiveRowComplete(frozen)){
      try{await log('warn','T0 arşiv geçişi ertelendi: T0 hücreleri tam değil',{t0Date:t0.date,source});}catch{}
      return false;
    }
    const shifted=[frozen,...before].slice(0,30);
    if(shifted.length!==30||!shifted.every(r49ArchiveRowComplete))throw new Error('K_Tarihsel atomik shift bütünlük kontrolü başarısız');

    const next={...a,schema:Math.max(4,Number(a.schema||0)),rows:shifted,live:null,lastFinalizedDate:t0.date,lastShift:{fromT0Date:t0.date,toT1Date:t0.date,at:nowISO(),rowCount:30,source,rule:'FIRST_VERIFIED_NEXT_SESSION_RECORD',evidence:ev}};
    state.khArchive=next;
    await kh117PersistArchive();
    try{
      const locks=readLocal(HISTORY_LOCK_KEY,{rows:{}});locks.rows=locks.rows||{};
      locks.rows[t0.date]={...(locks.rows[t0.date]||{}),lockedAt:nowISO(),finalized:true,source,rule:'FIRST_VERIFIED_NEXT_SESSION_RECORD',evidence:ev};
      writeLocal(HISTORY_LOCK_KEY,locks);
    }catch{}
    try{await log('ok','T0 bir sonraki seans kanıtıyla T1’e arşivlendi',{date:t0.date,evidence:ev,rows:30});}catch{}
    if(state.page==='history')renderCurrentPagePreservingView();
    return true;
  }
  globalThis.r49FinalizeT0OnNextSession=r49FinalizeT0OnNextSession;

  /* R47's close-based finalizer is superseded by the next-session rule. */
  globalThis.r47FinalizeT0IfReady=r49FinalizeT0OnNextSession;

  if(typeof prepareGeneralData==='function'){
    const base=prepareGeneralData;
    prepareGeneralData=async function prepareGeneralDataR49(job,mode='GENERAL'){
      const ok=await base(job,mode);
      if(ok)await r49FinalizeT0OnNextSession('DATA_PUBLISH');
      return ok;
    };
    globalThis.prepareGeneralData=prepareGeneralData;
  }
  if(typeof prepareMissingData==='function'){
    const base=prepareMissingData;
    prepareMissingData=async function prepareMissingDataR49(job){
      const ok=await base(job);
      if(ok)await r49FinalizeT0OnNextSession('REPAIR_PUBLISH');
      return ok;
    };
    globalThis.prepareMissingData=prepareMissingData;
  }

  /* On an authorised automatic chain the next stage is already Kn; no second manual Kn
     job is spawned here. Manual Veriler remains isolated, and T0 becomes the new Kn mirror
     when the user later runs Kn on the new data snapshot. */
  try{globalThis.AurumUpdateAPI.state.r49Revision={version:'R49.0',activatedAt:new Date().toISOString(),features:['T0_FIRST_NEXT_SESSION_FINALIZE','ATOMIC_T1_T30_SHIFT','ARCHIVE_30_ROW_INVARIANT']};}catch{}
})();


/* R51 data-transfer correctness: stale/base-only bundles can never be marked FRESH or completed. */
try{globalThis.AurumUpdateAPI.state.r51DataTransfer={version:'R51.0-DATA-CORRECTNESS',activatedAt:new Date().toISOString(),features:['REQUIRE_PROVIDER_SUCCESS','REQUIRE_FRESH_BEFORE_PUBLISH','NO_ZERO_FRESH_COMPLETION']};}catch{}


/* R52: actual-data throughput and resilient fetch semantics. */
try{globalThis.AurumUpdateAPI.state.r52DataFetch={version:'R52.0-ACTUAL-FETCH',activatedAt:new Date().toISOString(),features:['HISTORY_FRESH_WITHOUT_LIVE_GATE','TARGETED_PROVIDER_WAVES','CANONICAL_TIME_BEST_EFFORT','SOURCE_RETRY_1','PROVIDER_HEALTH_THROUGHPUT']};}catch{}


/* R63 embedded runtime bridge.
   Embedded compatibility/revision layers use the same API contract as .aurum packages.
   Earlier clean APKs omitted this global bridge, so those layers were present in the file
   but execution stopped at the first direct AurumUpdateAPI reference. */
if(!globalThis.AurumUpdateAPI){
  globalThis.AurumUpdateAPI=aurumUpdateApi({version:'EMBEDDED-R63',title:'Aurum embedded runtime'});
}


/* ===== Embedded clean REV20 architecture ===== */
/* CLEAN REV20 — K_Tarihsel value-only archive isolation.
   Contract:
   - T0 remains the only live/calculable row.
   - Every T1..T30 row is a canonical value snapshot in IndexedDB meta storage.
   - Frozen rows are readable by S/learning/UI and any other consumer, but are never
     reconstructed from formulas, runs, PIT backfill, current records, or model state.
   - A newly completed T0 is snapshotted once and shifts the 30-row archive atomically;
     the oldest value row falls out of the window. */
(function(){
  if(globalThis.AURUM_R53_HISTORY_VALUE_ONLY==='R53.0')return;
  globalThis.AURUM_R53_HISTORY_VALUE_ONLY='R53.0';

  const VALUE_SCHEMA=5;

  function r53Num(v){if(v===null||v===undefined||(typeof v==='string'&&!v.trim()))return null;const n=Number(v);return Number.isFinite(n)?n:null;}
  function r53ArchiveValueRow(row){
    if(!row?.date)return null;
    const criteria={},summaries={};
    for(const k of KN_V117_ORDER){
      const src=(row.criteria?.[k]||[]).slice(0,20);
      if(src.length<20)return null;
      criteria[k]=src.map(x=>({
        sym:String(x?.sym||''),
        score:r53Num(x?.score),
        dayReturn:r53Num(x?.dayReturn),
        knReturn:r53Num(x?.knReturn),
        realHit:!!x?.realHit
      }));
      const s=row.summaries?.[k]||{};
      summaries[k]={
        hitCount:Number.isFinite(Number(s.hitCount))?Number(s.hitCount):criteria[k].filter(x=>x.realHit).length,
        total:Number.isFinite(Number(s.total))?Number(s.total):criteria[k].length,
        realAvg:r53Num(s.realAvg),
        knAvg:r53Num(s.knAvg)
      };
    }
    const reel=(row.reelTop20||[]).slice(0,20).map(x=>({sym:String(x?.sym||''),ret:r53Num(x?.ret)}));
    if(reel.length<20||reel.some(x=>!x.sym))return null;
    const trend=(row.trend||[]).map(x=>({
      k:String(x?.k||''),
      hitCount:Number.isFinite(Number(x?.hitCount))?Number(x.hitCount):0,
      total:Number.isFinite(Number(x?.total))?Number(x.total):20,
      realAvg:r53Num(x?.realAvg??x?.returnAvg??x?.avgReturn),
      knAvg:r53Num(x?.knAvg)
    })).filter(x=>x.k);
    return {
      date:String(row.date).slice(0,10),
      reelTop20:reel,
      criteria,
      summaries,
      trend,
      provisional:false,
      frozen:true,
      valueOnly:true,
      immutable:true,
      formulaDetached:true,
      archivedAt:row.archivedAt||nowISO(),
      anchorId:String(row.anchorId||`value:${String(row.date).slice(0,10)}`),
      source:'VALUE_SNAPSHOT',
      marketTime:row.marketTime||null,
      createdAt:row.createdAt||null,
      generatedAt:row.generatedAt||null,
      at:row.at||null
    };
  }

  function r53NormalizeValueRows(rows,currentDate=null){
    const seen=new Set(),out=[];
    for(const raw of (rows||[]).slice().sort((a,b)=>String(b?.date||'').localeCompare(String(a?.date||'')))){
      const row=r53ArchiveValueRow(raw),d=String(row?.date||'');
      if(!row||!d||d===currentDate||seen.has(d))continue;
      seen.add(d);out.push(row);
      if(out.length>=30)break;
    }
    return out;
  }

  /* Persistence is the hard boundary: whatever produced a new historical row, only
     canonical values cross into the frozen archive. No formula/model payload survives. */
  kh117PersistArchive=async function kh117PersistArchiveR53(){
    const a=kh117ArchiveState();
    a.rows=r53NormalizeValueRows(a.rows,null);
    a.schema=Math.max(VALUE_SCHEMA,Number(a.schema||0));
    a.valueOnly=true;a.formulaDetached=true;
    if(a.rows.length>=30)a.seed={...(a.seed||{}),completed:true,windowCount:30,immutable:true,valueOnly:true,sealedAt:a.seed?.sealedAt||nowISO()};
    state.khArchive=a;
    await dbPut('meta',{key:'khImmutableArchiveV1',value:kh117CloneValue(a),updatedAt:nowISO()});
  };

  /* UI/database reads use only the persisted value rows. There is deliberately no
     kh117LegacyRows()/PIT/formula fallback when the archive is absent or incomplete. */
  let R53_VIEW_CACHE={archiveRows:null,t0Date:null,t0ReelKey:null,rows:null};
  function r53NextDayEvaluationRows(t0,arch){
    const base=[{...t0,_label:'T0',_t0:true,reelDate:t0.date},...arch.map((r,i)=>({...r,_label:`T${i+1}`,_t0:false}))];
    for(let i=1;i<base.length;i++){
      const row=base[i],targetDate=kh117ExpectedAdjacentSession(String(row?.date||''),1),candidate=targetDate?kh117CurrentReel(targetDate).slice(0,20):[],targetReel=candidate.length===20?candidate:[],verified=targetReel.length===20,realSet=new Set(targetReel.map(x=>String(x?.sym||'').trim().toUpperCase()));
      /* The target is the actual next BIST session, never merely the next date present in
         the local data set. Missing target-session data stays missing; no forward skip. */
      const realReturnBySym=new Map();
      if(verified)for(const rec of (state.records||[])){const sym=String(rec?.sym||'').trim().toUpperCase(),v=kh117DayReturn(rec,targetDate);if(sym&&Number.isFinite(v))realReturnBySym.set(sym,v)}
      const criteria={},summaries={};
      for(const k of KN_V117_ORDER){
        const src=(row.criteria?.[k]||[]).slice(0,20),prev=row.summaries?.[k]||{};
        criteria[k]=src.map(x=>{const sym=String(x?.sym||'').trim().toUpperCase(),real=verified?realReturnBySym.get(sym):null;return {...x,sym,dayReturn:Number.isFinite(real)?real:null,realHit:verified?realSet.has(sym):null};});
        const realVals=criteria[k].map(x=>x.dayReturn).filter(Number.isFinite);
        summaries[k]={...prev,hitCount:verified?criteria[k].filter(x=>x.realHit===true).length:null,total:criteria[k].length||20,realAvg:verified&&realVals.length?mean(realVals):null};
      }
      const trend=verified?KN_V117_TREND.map(k=>({k,...summaries[k]})).sort((a,b)=>Number(b.hitCount||0)-Number(a.hitCount||0)||(Number(b.realAvg??-999)-Number(a.realAvg??-999))||String(a.k).localeCompare(String(b.k))):[];
      base[i]={...row,reelTop20:targetReel,reelDate:targetDate,criteria,summaries,trend,evaluationMode:'KN_D_TO_REEL_D_PLUS_1',reelVerified:verified};
    }
    return base;
  }
  kh117Rows=function kh117RowsR53(){
    const t0=kh117T0(),a=kh117ArchiveState(),t0ReelKey=(t0.reelTop20||[]).map(x=>`${x?.sym||''}:${Number(x?.ret??0).toFixed(8)}`).join('|');
    if(R53_VIEW_CACHE.archiveRows===a.rows&&R53_VIEW_CACHE.t0Date===t0.date&&R53_VIEW_CACHE.t0ReelKey===t0ReelKey&&R53_VIEW_CACHE.rows)return R53_VIEW_CACHE.rows;
    const arch=r53NormalizeValueRows(a.rows,t0.date).slice(0,30),rows=r53NextDayEvaluationRows(t0,arch);
    R53_VIEW_CACHE={archiveRows:a.rows,t0Date:t0.date,t0ReelKey,rows};return rows;
  };

  /* One-time migration of whatever T1..T30 values already exist on the device. */
  async function r53SealExistingArchive(){
    const a=kh117ArchiveState();
    if(!Array.isArray(a.rows)||!a.rows.length)return 0;
    const before=JSON.stringify(a.rows),oldSchema=Number(a.schema||0),sealed=r53NormalizeValueRows(a.rows,null);
    a.rows=sealed;a.schema=Math.max(VALUE_SCHEMA,oldSchema);a.valueOnly=true;a.formulaDetached=true;
    if(sealed.length>=30)a.seed={...(a.seed||{}),completed:true,windowCount:30,immutable:true,valueOnly:true,sealedAt:a.seed?.sealedAt||nowISO()};
    state.khArchive=a;
    if(before!==JSON.stringify(sealed)||oldSchema<VALUE_SCHEMA)await kh117PersistArchive();
    return sealed.length;
  }
  globalThis.r53SealExistingArchive=r53SealExistingArchive;

  /* Historical stage now snapshots the already-calculated Kn/T0 values only.
     It does not rebuild models, evaluate old days, calibrate, or recalculate T1..T30. */
  archiveHistorical=async function archiveHistoricalR53(job){
    job.currentStage='K_Tarihsel';
    await transition(job,JOB_STATUS.K_TARIHSEL_RUNNING,{message:'T0 değer snapshotı arşive hazırlanıyor',done:0,total:1});
    state.calculating=true;state.progress={stage:'K_Tarihsel',current:'T0 değer snapshotı',done:0,total:1,errors:0};
    try{
      await pauseCheckpoint(job,JOB_STATUS.K_TARIHSEL_RUNNING);
      const active=await activeCalculableSnapshot();
      if(!active)throw new Error('K_Tarihsel için güncel veri snapshotı yok');
      const kn=(await dbGet('meta','knSnapshot'))?.value||null;
      if(!kn||kn.dataSnapshotId!==job.dataSnapshotId)throw new Error('K_Tarihsel için aynı veri snapshotına ait Kn gerekli');
      kn117RequireTop20();

      const current=kh117T0();
      if(!current?.date)throw new Error('K_Tarihsel T0 tarihi yok');
      const a=kh117ArchiveState();
      delete a.t0ClearedDate;

      /* If a prior live T0 exists and a new Kn day has arrived, freeze that prior T0
         verbatim as a value row and shift T1..T30. */
      if(a.live?.date&&String(a.live.date)!==String(current.date)){
        const prior=r53ArchiveValueRow(a.live);
        if(prior)a.rows=r53NormalizeValueRows([prior,...(a.rows||[])],null).slice(0,30);
      }

      /* T0 itself remains live and replaceable until the next day. */
      a.live={...kh117CloneValue(current),source:'LIVE_T0',provisional:true,frozen:false,valueOnly:false,updatedAt:nowISO(),anchorId:`live:${current.date}`};
      a.schema=Math.max(VALUE_SCHEMA,Number(a.schema||0));a.valueOnly=true;a.formulaDetached=true;
      state.khArchive=a;await kh117PersistArchive();

      const histPrev=(await dbGet('meta','historicalSnapshot'))?.value||{},at=nowISO(),fp=historyTableFingerprint(),changedAt=histPrev.fingerprint===fp&&histPrev.changedAt?histPrev.changedAt:at;
      await dbPut('meta',{key:'historicalSnapshot',value:{dataSnapshotId:job.dataSnapshotId,runId:null,at,transferredAt:at,changedAt,fingerprint:fp,date:current.date,valueOnlyArchive:true,formulaDetached:true},updatedAt:at});
      const locks=readLocal(HISTORY_LOCK_KEY,{rows:{}});locks.rows=locks.rows||{};locks.rows[current.date]={lockedAt:at,dataSnapshotId:job.dataSnapshotId,valueOnlySnapshot:true};writeLocal(HISTORY_LOCK_KEY,locks);
      await refreshTableMeta();
      await transition(job,JOB_STATUS.K_TARIHSEL_COMPLETED,{message:'K_Tarihsel değer snapshotı tamamlandı',done:1,total:1});
      return true;
    }catch(e){
      if(e?.code==='OPERATION_CANCELLED'||cancelRequested(job)){await transition(job,JOB_STATUS.IDLE,{error:null,message:'K_Tarihsel iptal edildi'});return false;}
      await transition(job,JOB_STATUS.FAILED,{error:e?.message||String(e),message:'K_Tarihsel başarısız'});return false;
    }finally{state.calculating=false;clearCancel(job.id);renderCurrentPagePreservingView();}
  };

  /* Manual PIT seed is disabled after a complete archive has been sealed. It is retained
     only as a one-time migration path for installations that genuinely have no 30-row seed. */
  const r53SeedBase=kh117SeedPIT30;
  kh117SeedPIT30=async function kh117SeedPIT30R53(){
    const a=kh117ArchiveState(),rows=r53NormalizeValueRows(a.rows,kh117T0()?.date);
    if(rows.length>=30){a.rows=rows;state.khArchive=a;await kh117PersistArchive();showAurumNotice('T1–T30 salt-değer arşivi kilitli; yeniden hesaplama yapılmaz.','info',3200);return true;}
    const ok=await r53SeedBase();if(ok)await r53SealExistingArchive();return ok;
  };

  /* Expose the new reader/seed contract to UI and dependent modules. */
  globalThis.AurumKnHistoryR53=Object.freeze({version:'53.0.0-value-only',rows:kh117Rows,seal:r53SealExistingArchive,seedPIT30:kh117SeedPIT30});
  try{
    const old=globalThis.AurumKnHistoryV117;
    globalThis.AurumKnHistoryV117=Object.freeze({...old,version:'53.0.0-value-only',rows:kh117Rows,seedPIT30:kh117SeedPIT30});
  }catch{}

  /* Imported update executes after state load: seal current device archive immediately. */
  queueMicrotask(()=>r53SealExistingArchive().catch(()=>{}));

  try{AurumUpdateAPI.state.r53HistoryValueOnly={version:'R53.0',activatedAt:new Date().toISOString(),features:['T1_T30_VALUE_ONLY','FORMULA_DETACHED_ARCHIVE','NO_LEGACY_RECALC_FALLBACK','ATOMIC_VALUE_SHIFT','T0_ONLY_LIVE']};}catch{}
})();

/* CLEAN REV20 — canonical raw-store + incremental publication + render-cost isolation.
   No visual/layout/style contract is changed. */
(function(){
  if(globalThis.AURUM_R55_INCREMENTAL_RAW==='REV20.0')return;
  globalThis.AURUM_R55_INCREMENTAL_RAW='REV20.0';
  const S=AurumUpdateAPI.state;
  const RAW_DB='aurum-canonical-raw-r60';
  const RAW_VER=1;
  const RAW_SCHEMA=1;
  const rawState={db:null,queue:Promise.resolve(),migrating:false};
  let dataGeneration=0;

  function r55Clone(x){try{return structuredClone(x)}catch{return JSON.parse(JSON.stringify(x))}}
  function r55Hash(v){let h=2166136261>>>0,s=typeof v==='string'?v:JSON.stringify(v);for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,'0')}
  function r55Cutoff(){const m=Math.max(6,Math.min(120,Number(S.settings?.monthsBack||14))),d=new Date();d.setUTCMonth(d.getUTCMonth()-m);return d.toISOString().slice(0,10)}
  function r55OpenRaw(){if(rawState.db)return Promise.resolve(rawState.db);return new Promise((resolve,reject)=>{const q=indexedDB.open(RAW_DB,RAW_VER);q.onupgradeneeded=e=>{const db=e.target.result;if(!db.objectStoreNames.contains('bars')){const st=db.createObjectStore('bars',{keyPath:'id'});st.createIndex('sym','sym',{unique:false});st.createIndex('date','date',{unique:false});}if(!db.objectStoreNames.contains('heads'))db.createObjectStore('heads',{keyPath:'sym'});if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'key'});};q.onsuccess=()=>{rawState.db=q.result;resolve(q.result)};q.onerror=()=>reject(q.error)});}
  function r55Req(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
  async function r55RawGet(store,key){const db=await r55OpenRaw();return r55Req(db.transaction(store).objectStore(store).get(key))}
  function r55SeriesRow(rec,i){const z=rec?.series||{},date=String(z.date?.[i]||'').slice(0,10);if(!date)return null;const fields=['open','high','low','close','calcOpen','calcHigh','calcLow','calcClose','adjustmentFactor','volume','usd','index','deg','degVol'];const row={id:`${rec.sym}|${date}`,sym:rec.sym,date};for(const k of fields){const v=z[k]?.[i];row[k]=(v===undefined?null:v)}const close=Number(z.calcClose?.[i]??z.close?.[i]),prev=Number(z.calcClose?.[i-1]??z.close?.[i-1]),vol=Number(z.volume?.[i]),pvol=Number(z.volume?.[i-1]);row.dailyReturn=Number.isFinite(close)&&Number.isFinite(prev)&&prev>0?100*(close/prev-1):null;row.volumeChange=Number.isFinite(vol)&&Number.isFinite(pvol)&&pvol>0?100*(vol/pvol-1):null;row.hash=r55Hash(row);return row}
  function r55Head(rec){const x={...rec};delete x.series;return {sym:rec.sym,value:x,updatedAt:AurumUpdateAPI.nowISO(),fingerprint:String(rec.recordFingerprint||'')||r55Hash(x)}}
  async function r55PersistCanonical(rec,{force=false}={}){
    if(!rec?.sym)return {written:0,deleted:0};
    const db=await r55OpenRaw(),cut=r55Cutoff(),prior=await r55RawGet('meta',`sym:${rec.sym}`),known={...(prior?.hashes||{})},next={},writes=[],z=rec.series||{},dates=z.date||[];
    for(let i=0;i<dates.length;i++){const date=String(dates[i]||'').slice(0,10);if(!date||date<cut)continue;const row=r55SeriesRow(rec,i);if(!row)continue;next[date]=row.hash;if(force||known[date]!==row.hash)writes.push(row)}
    const deletes=Object.keys(known).filter(d=>d<cut||!(d in next)).map(d=>`${rec.sym}|${d}`);
    await new Promise((resolve,reject)=>{const tx=db.transaction(['bars','heads','meta'],'readwrite'),bars=tx.objectStore('bars'),heads=tx.objectStore('heads'),meta=tx.objectStore('meta');for(const row of writes)bars.put(row);for(const id of deletes)bars.delete(id);heads.put(r55Head(rec));meta.put({key:`sym:${rec.sym}`,schema:RAW_SCHEMA,sym:rec.sym,hashes:next,firstDate:Object.keys(next).sort()[0]||null,lastDate:Object.keys(next).sort().at(-1)||null,count:Object.keys(next).length,updatedAt:AurumUpdateAPI.nowISO()});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});
    return {written:writes.length,deleted:deletes.length};
  }
  function r55QueueCanonical(rec,opt){rawState.queue=rawState.queue.then(()=>r55PersistCanonical(rec,opt)).catch(()=>null);return rawState.queue}

  /* Import path: do not rewrite a compatibility record when its stable payload is identical. */
  const basePersistRecord=globalThis.r21PersistRecord;
  globalThis.r21PersistRecord=async function r55PersistRecord(rec){
    const prev=S.recordMap?.get?.(rec?.sym)||null,fp=String(rec?.recordFingerprint||'')||((typeof dataRecordFingerprint==='function')?dataRecordFingerprint(rec):r55Hash(rec));
    rec.recordFingerprint=fp;
    const pfp=prev?(String(prev.recordFingerprint||'')||((typeof dataRecordFingerprint==='function')?dataRecordFingerprint(prev):r55Hash(prev))):null;
    if(!prev||pfp!==fp)await AurumUpdateAPI.dbPut('records',{key:rec.sym,value:rec,updatedAt:AurumUpdateAPI.nowISO()});
    await r55QueueCanonical(rec,{force:!prev});dataGeneration++;r55InvalidateCaches();return rec;
  };

  /* Atomic Veriler publication: replace the old clear+rewrite-all transaction with a
     differential transaction. Unchanged symbols are not written again; removed symbols
     alone are deleted. The active snapshot metadata is still committed atomically. */
  const baseAtomicPublish=globalThis.atomicPublish;
  if(typeof baseAtomicPublish==='function'){
    globalThis.atomicPublish=atomicPublish=async function r55AtomicPublish(job,universe){
      const rows=await stageRows(job.id),by=new Map(rows.map(x=>[x.sym,x.record]));
      if(by.size!==universe.length)throw new Error(`STAGING_COUNT_MISMATCH:${by.size}/${universe.length}`);
      for(const sym of universe)if(!by.has(sym))throw new Error(`STAGING_SYMBOL_MISSING:${sym}`);
      const canonical=safeTime(job?.canonicalMarketAt),previous=(await AurumUpdateAPI.dbGet('meta','activeDataSnapshot'))?.value||{},previousRecords=new Map((S.records||[]).map(r=>[r.sym,r])),exclusions=[],records=[];
      for(const sym of universe){let rec=by.get(sym);const chk=canonical!=null?marketWindowCheck(rec,job.canonicalMarketAt):{ok:false,reason:'CANONICAL_MARKET_TIME_UNAVAILABLE',deltaMinutes:null},fresh=rec?.jobDataStatus==='FRESH';if(!fresh){exclusions.push({sym,reason:rec?.dataIssues?.[0]||'CURRENT_JOB_DATA_UNAVAILABLE',marketAt:rec?.marketDataAt||null,provider:rec?.marketTimeProvider||null,deltaMinutes:chk.deltaMinutes??null});rec.marketWindowEligible=false;rec.marketWindowDeltaMinutes=chk.deltaMinutes;rec.calculationEligible=false;rec.calculationExclusionReasons=[...new Set([...(rec.calculationExclusionReasons||[]),'CURRENT_JOB_NOT_FRESH'])];}else{rec.marketWindowEligible=chk.ok;rec.marketWindowDeltaMinutes=chk.deltaMinutes;if(!chk.ok){rec.calculationEligible=false;rec.calculationExclusionReasons=[...new Set([...(rec.calculationExclusionReasons||[]),chk.reason||'MARKET_WINDOW_UNAVAILABLE'])];}}rec.unresolvedFields=Array.isArray(rec.unresolvedFields)?rec.unresolvedFields:bundleRecordMissingFields(rec);records.push(rec)}
      job.excludedSymbols=exclusions;const eligibility=classifyDataCompleteness(records,universe);for(const rec of records){const e=eligibility.bySymbol.get(rec.sym);rec.emptyCellCount=e?.emptyCells??0;if(rec?.jobDataStatus==='FRESH'&&rec?.marketWindowEligible===true){rec.calculationEligible=!!e?.eligible;rec.calculationExclusionReasons=e?.reasons||[]}rec.incompleteColumns=eligibility.incompleteColumns}
      const transferredAt=AurumUpdateAPI.nowISO(),verifiedTimes=records.map(r=>externalMarketTime(r)).filter(Number.isFinite),marketAt=canonical!=null?new Date(canonical).toISOString():(verifiedTimes.length?new Date(Math.max(...verifiedTimes)).toISOString():(previous.marketAt||null));
      const changed=[],unchanged=[];for(let i=0;i<records.length;i++){const rec=records[i],prev=previousRecords.get(rec.sym),rf=dataRecordFingerprint(rec),prevRf=prev?.recordFingerprint||(prev?dataRecordFingerprint(prev):null);rec.recordFingerprint=rf;rec.tableTransferredAt=transferredAt;rec.recordChangedAt=prev&&prevRf===rf?(prev.recordChangedAt||prev.tableTransferredAt||previous.changedAt||transferredAt):transferredAt;rec.datasetMarketAt=rec?.jobDataStatus==='FRESH'?(marketAt||rec.marketDataAt||prev?.datasetMarketAt||null):(prev?.datasetMarketAt||previous.marketAt||rec.datasetMarketAt||null);rec.provenance={...(rec.provenance||{}),marketAt:rec.marketDataAt||null,marketTimeVerified:rec.marketTimeVerified===true,marketTimeProvider:rec.marketTimeProvider||null,datasetMarketAt:rec.datasetMarketAt,tableTransferredAt:transferredAt,recordChangedAt:rec.recordChangedAt,marketWindowDeltaMinutes:rec.marketWindowDeltaMinutes};if(!prev||prevRf!==rf)changed.push(rec);else unchanged.push(rec.sym)}
      const fingerprint=dataTableFingerprint(records),changedAt=previous.fingerprint===fingerprint&&previous.changedAt?previous.changedAt:transferredAt,universeSet=new Set(universe),removed=[...previousRecords.keys()].filter(sym=>!universeSet.has(sym));
      await new Promise((resolve,reject)=>{const tx=S.db.transaction(['records','meta'],'readwrite'),rs=tx.objectStore('records'),ms=tx.objectStore('meta');for(const value of changed)rs.put({key:value.sym,value,updatedAt:transferredAt});for(const sym of removed)rs.delete(sym);ms.put({key:'activeDataSnapshot',value:{snapshotId:job.dataSnapshotId,jobId:job.id,mode:job.mode,completedAt:transferredAt,transferredAt,changedAt,marketAt,fingerprint,marketTimeBasis:canonical!=null?'SOURCE_REPORTED_VERIFIED_90M_WINDOW_WITH_SAME_TRADING_DAY_PRESERVATION':'SOURCE_REPORTED_HISTORY_FRESH_MARKET_TIME_UNAVAILABLE',marketTimeProvider:job?.canonicalMarketProvider||null,universeCount:universe.length,publishedCount:records.length,excludedSymbols:exclusions,incompleteColumns:eligibility.incompleteColumns,incremental:true,changedSymbols:changed.map(x=>x.sym),unchangedSymbols:unchanged.length,removedSymbols:removed},updatedAt:transferredAt});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});
      S.records=records;S.recordMap=new Map(records.map(x=>[x.sym,x]));dataGeneration++;r55InvalidateCaches();for(const rec of changed)r55QueueCanonical(rec);return records;
    };
  }

  /* Repair publication already writes only target symbols; mirror only those changed
     symbols into the canonical raw store and invalidate analytical caches once. */
  const baseAtomicRepair=globalThis.atomicRepairPublish;
  if(typeof baseAtomicRepair==='function'){
    globalThis.atomicRepairPublish=atomicRepairPublish=async function r55AtomicRepair(job,targetSymbols){const out=await baseAtomicRepair(job,targetSymbols);for(const sym of out?.changed||[]){const rec=S.recordMap.get(sym);if(rec)r55QueueCanonical(rec)}dataGeneration++;r55InvalidateCaches();return out};
  }

  /* Cache expensive immutable summaries. They are a function of the current Veriler
     snapshot, not of the selected tab. */
  const baseDataSummary=globalThis.dataSummary;
  const baseBuildPlan=globalThis.buildPendingRepairPlan;
  const baseCurrentPlan=globalThis.currentPendingRepairPlan;
  const summaryCache={gen:-1,records:null,value:null},planCache={gen:-1,value:null};
  function r55InvalidateCaches(){summaryCache.gen=-1;summaryCache.records=null;summaryCache.value=null;planCache.gen=-1;planCache.value=null;r55CellMemo=new WeakMap()}
  if(typeof baseDataSummary==='function')globalThis.dataSummary=dataSummary=function r55DataSummary(records=S.records){if(records===S.records&&summaryCache.gen===dataGeneration&&summaryCache.records===records&&summaryCache.value)return summaryCache.value;const v=baseDataSummary(records);if(records===S.records){summaryCache.gen=dataGeneration;summaryCache.records=records;summaryCache.value=v}return v};
  if(typeof baseBuildPlan==='function')globalThis.buildPendingRepairPlan=buildPendingRepairPlan=function r55BuildPlan(records=S.records,universe=currentSymbols()){if(records===S.records&&summaryCache.gen===dataGeneration&&planCache.gen===dataGeneration&&planCache.value)return planCache.value;const v=baseBuildPlan(records,universe);if(records===S.records){planCache.gen=dataGeneration;planCache.value=v}return v};
  if(typeof baseCurrentPlan==='function')globalThis.currentPendingRepairPlan=currentPendingRepairPlan=function r55CurrentPlan(){if(planCache.gen===dataGeneration&&planCache.value)return planCache.value;const v=baseCurrentPlan();planCache.gen=dataGeneration;planCache.value=v;return v};

  /* Memoize Veriler cell extraction without changing a single displayed value. Historical
     cells are immutable until the record fingerprint changes, so repeated tab renders no
     longer recalculate hundreds of fields per symbol. */
  const baseVRaw=globalThis.v141225Raw;let r55CellMemo=new WeakMap();
  if(typeof baseVRaw==='function')globalThis.v141225Raw=v141225Raw=function r55VRaw(rec,key,skipCompleteness=false){if(!rec||skipCompleteness)return baseVRaw(rec,key,skipCompleteness);let m=r55CellMemo.get(rec);if(!m){m=new Map();r55CellMemo.set(rec,m)}if(m.has(key))return m.get(key);const v=baseVRaw(rec,key,skipCompleteness);m.set(key,v);return v};

  /* Keep the prior detached-DOM acceleration, but cache every heavy data/model page.
     It changes no markup, style, dimensions, labels or controls. */
  const baseRender=globalThis.render,baseGo=globalThis.goPage,cache=new Map();let navigating=false;
  function r55Content(){return document.getElementById('content')}
  function r55Stash(page){const c=r55Content();if(!c||!page||page==='settings')return;const f=document.createDocumentFragment();while(c.firstChild)f.appendChild(c.firstChild);cache.set(page,{f,className:c.className})}
  function r55Restore(page){const x=cache.get(page),c=r55Content();if(!x||!c)return false;c.replaceChildren();c.className=x.className;c.appendChild(x.f);cache.delete(page);const titles={overview:'Genel Bakış',market:'Piyasa Özeti',selection:'S · Nihai Seçim',data:'Veriler',criteria:'Kn Tabloları',history:'K_Tarihsel',learning:'Performans ve Öğrenme',ai:'Yapay Zekâ Merkezi',settings:'Ayarlar'};const t=document.getElementById('pageTitle');if(t)t.textContent=titles[page]||'Aurum BIST Analiz';document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));try{decorateTableTimePanels()}catch{}try{updateLiveStatus()}catch{}return true}
  if(typeof baseGo==='function')globalThis.goPage=goPage=function r55Go(page){page=String(page||'overview');if(page===S.page)return true;if(S.page==='settings'&&page!=='settings'&&S.settingsDirty){if(!confirm('Kaydedilmemiş ayar değişiklikleri var. Kaydetmeden çıkarsanız uygulanmayacak. Çıkılsın mı?'))return false;delete S.__schedulerDraft;S.settingsDirty=false}const prev=S.page||'overview';r55Stash(prev);S.page=page;if(page==='criteria'){S.strictActiveKn='K1';try{writeLocal(KN_V117_ACTIVE_KEY,'K1')}catch{}}navigating=true;try{if(!r55Restore(page))baseRender()}finally{navigating=false}return true};
  if(typeof baseRender==='function')globalThis.render=render=function r55Render(){if(!navigating)cache.clear();return baseRender.apply(this,arguments)};

  /* One-time, non-blocking migration. Existing records are copied as values into the raw
     store in small idle slices. It never changes state.records or any screen. */
  async function r55Migrate(){if(rawState.migrating)return;rawState.migrating=true;try{const done=await r55RawGet('meta','migration');if(done?.schema===RAW_SCHEMA&&done?.completed)return;const list=(S.records||[]).slice();for(let i=0;i<list.length;i++){await r55PersistCanonical(list[i],{force:true});if(i%8===7)await new Promise(r=>setTimeout(r,0))}const db=await r55OpenRaw();await new Promise((resolve,reject)=>{const tx=db.transaction('meta','readwrite');tx.objectStore('meta').put({key:'migration',schema:RAW_SCHEMA,completed:true,count:list.length,at:AurumUpdateAPI.nowISO(),cutoff:r55Cutoff()});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});}finally{rawState.migrating=false}}
  queueMicrotask(()=>r55Migrate().catch(()=>{}));
  globalThis.AurumRawStoreR55=Object.freeze({version:'60.0.0',open:r55OpenRaw,persist:r55PersistCanonical,migrate:r55Migrate,cutoff:r55Cutoff,invalidate:r55InvalidateCaches});
  try{S.r55IncrementalRaw={version:'REV20.0',activatedAt:new Date().toISOString(),features:['CANONICAL_DEVICE_RAW_DB','DATE_KEYED_IMMUTABLE_HISTORY','DIFFERENTIAL_RECORD_PUBLICATION','RETENTION_WINDOW_TRIM','SUMMARY_CACHE','REPAIR_PLAN_CACHE','CELL_VALUE_MEMO','DETACHED_DOM_FAST_NAV','NO_UI_STYLE_LAYOUT_CHANGE']}}catch{}
})();

try{AurumUpdateAPI.state.cleanREV20={version:'REV20.0-CLEAN',activatedAt:new Date().toISOString(),features:['EMBEDDED_NO_EXTERNAL_PATCH_REQUIRED','VALUE_ONLY_HISTORY','CANONICAL_RAW_DB','INCREMENTAL_WRITES','FAST_NAV_RENDER_CACHE','LEGACY_UPDATE_RESIDUE_SUPERSEDED']};}catch{}


/* CLEAN R61 — strict decimal display + persistent-page navigation.
   Visual contract is unchanged; this revision only changes display formatting and render scheduling. */
(function(){
  if(globalThis.AURUM_R61_FAST_UI==='R61.0')return;
  globalThis.AURUM_R61_FAST_UI='R61.0';
  const S=AurumUpdateAPI.state;

  /* Display-only rule:
     - any finite decimal whose integer part is non-zero => exactly 2 decimals;
     - values between -1 and 1 keep the tiny-number exception so leading zeroes are shown
       through the first significant digits;
     - requestedDigits===0 remains integer formatting for counts/volumes.
     Stored/calculation precision is never modified. */
  aurumNumberFormat=function aurumNumberFormatR61(value,requestedDigits=2){
    if(value===null||value===undefined)return '—';
    if(typeof value==='string'&&!value.trim())return '—';
    const n=Number(value);if(!Number.isFinite(n))return '—';
    const requested=Number.isFinite(Number(requestedDigits))?Math.max(0,Math.trunc(Number(requestedDigits))):2;
    if(requested===0)return n.toLocaleString('tr-TR',{minimumFractionDigits:0,maximumFractionDigits:0,useGrouping:true});
    let digits=2;
    if(Math.trunc(Math.abs(n))===0){
      const a=Math.abs(n);
      if(a>0&&a<0.01){
        const dec=a.toFixed(16).slice(2),first=dec.search(/[1-9]/);
        if(first>=2)digits=Math.min(16,first+2);
      }
    }
    return n.toLocaleString('tr-TR',{minimumFractionDigits:digits,maximumFractionDigits:digits,useGrouping:true});
  };
  globalThis.AurumNumberFormat=aurumNumberFormat;

  /* Degisim3Gun was intentionally emitted as a raw string in the old table path.
     Normalize each numeric component through the same display-only formatter. */
  const r61BaseCell=globalThis.v141225Cell;
  if(typeof r61BaseCell==='function')globalThis.v141225Cell=v141225Cell=function r61Cell(rec,key){
    if(key==='Degisim3Gun(%)_T0'){
      const raw=v141225Raw(rec,key);if(raw==null||raw==='')return '—';
      return html(String(raw).split('|').map(part=>{const t=part.trim().replace('%','').replace(',','.');const n=Number(t);return Number.isFinite(n)?`${n>=0?'+':''}${aurumNumberFormat(n,2)}%`:part.trim()}).join(' | '));
    }
    return r61BaseCell(rec,key);
  };

  /* Data table rows are built in small chunks. This leaves the UI thread available for
     navigation/touch handling while preserving exactly the same table, headers and cells. */
  let r61DataToken=0;
  function r61Idle(cb){if(typeof requestIdleCallback==='function')return requestIdleCallback(cb,{timeout:80});return setTimeout(()=>cb({timeRemaining:()=>8,didTimeout:true}),0)}
  function r61DataSkeleton(rows){
    const headers=v141225VisibleHeaders(),paged=v141225PageRows(rows),pageRows=paged.pageRows,token=++r61DataToken;
    r61Idle(()=>r61PumpData(token,pageRows,headers,0));
    return `<div class="table-wrap aurum-drive-table aurum-v141225" ontouchstart="aurumDataSwipeStart(event)" ontouchend="aurumDataSwipeEnd(event)"><table id="dataTable"><thead><tr>${headers.map(h=>`<th>${html(h)}</th>`).join('')}</tr></thead><tbody id="r61DataBody" data-r61-token="${token}">${pageRows.length?'':`<tr><td colspan="${headers.length}">Veri yok.</td></tr>`}</tbody></table></div>${v141225Pager(rows)}`;
  }
  function r61PumpData(token,rows,headers,index){
    const body=document.getElementById('r61DataBody');if(!body||Number(body.dataset.r61Token)!==token)return;
    const started=performance.now();let i=index,frag=document.createDocumentFragment();
    while(i<rows.length&&i<index+4&&(performance.now()-started)<12){const r=rows[i++],tr=document.createElement('tr');tr.innerHTML=headers.map(h=>`<td>${v141225Cell(r,h)}</td>`).join('');frag.appendChild(tr)}
    body.appendChild(frag);if(i<rows.length)r61Idle(()=>r61PumpData(token,rows,headers,i));
  }
  function r61ReplaceDataTable(){const rows=currentV141225Rows(),box=document.getElementById('recordsContent');if(box)box.innerHTML=r61DataSkeleton(rows);const count=document.getElementById('recordCount');if(count)count.textContent=`${rows.length} hisse`;}
  globalThis.filterRecords=filterRecords=function r61Filter(q){V141225_FILTER_QUERY=String(q||'');V141225_PAGE_INDEX=0;r61ReplaceDataTable()};
  globalThis.changeV141225Page=changeV141225Page=function r61ChangePage(delta){const rows=currentV141225Rows(),total=Math.max(1,Math.ceil(rows.length/V141225_PAGE_SIZE));V141225_PAGE_INDEX=Math.max(0,Math.min(V141225_PAGE_INDEX+Number(delta||0),total-1));r61ReplaceDataTable();const wrap=document.querySelector('#recordsContent .aurum-v141225');if(wrap)wrap.scrollLeft=0};

  /* Persistent page slots: once a tab is built it stays mounted and navigation only toggles
     visibility. This avoids repeatedly detaching/re-attaching or reparsing tens of thousands
     of table nodes. An explicit render (data/model change) invalidates the cached pages. */
  const titles={overview:'Genel Bakış',market:'Piyasa Özeti',selection:'S · Nihai Seçim',data:'Veriler',criteria:'Kn Tabloları',history:'K_Tarihsel',learning:'Performans ve Öğrenme',ai:'Yapay Zekâ Merkezi',settings:'Ayarlar'};
  const pageFns=()=>({overview,market:globalThis.marketPage||overview,selection:selectionPage,data:function r61DataPage(){
    const rows=currentV141225Rows(),buttons=`<button class="gold-btn" onclick="AurumRuntime.manualData('GENERAL')" ${S.syncing||S.calculating?'disabled':''}>Verileri Güncelle</button>`,integrity=calculationGateStatus(),blocked=!integrity.gate.ok&&S.records.length>0,warning=blocked?`<div class="card notice aurum-integrity-block"><b>Yeni türev hesaplama kalite kapısında bekliyor</b><p>${html(integrity.reason)}</p><small>Veriler tablosu gizlenmez veya silinmez; mevcut doğrulanmış veri görünür kalır. “Eksikleri Tamamla” alternatif kaynaklarla seçici onarım yapar.</small></div>`:'',body=`${warning}${v141225Tools()}<div id="recordsContent" class="aurum-stable-table" data-aurum-explicit-time>${r61DataSkeleton(rows)}</div>`;return `${operationBlock('data',buttons)}${dataMetaMarkup()}${body}`;
  },criteria:criteriaPage,history:historyPage,learning:learningPage,ai:aiPage,settings:settingsPage});
  const slots=new Map(),scrollY=new Map();let rootReady=false,internal=false;
  function content(){return document.getElementById('content')}
  function shell(page){const c=content();if(!c)return;c.className=`page-${page}`;const t=document.getElementById('pageTitle');if(t)t.textContent=titles[page]||'Aurum BIST Analiz';document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));const btn=document.getElementById('refreshBtn');if(btn){btn.textContent=globalOperationLabel();btn.hidden=false;btn.setAttribute('aria-live','polite')}}
  function setupSlot(slot,page){if(page==='settings')queueMicrotask(()=>{try{setupSettingsAccordion();slot.querySelectorAll('input,select,textarea').forEach(el=>el.addEventListener('input',()=>{S.settingsDirty=true},{once:true}))}catch{}});try{slot.querySelectorAll('.table-wrap').forEach(w=>{if(w.closest('[data-aurum-explicit-time]')||w.previousElementSibling?.classList?.contains('aurum-time-card'))return;const kind=page==='criteria'?'kn':page==='history'?'history':page==='selection'?'s':'data';w.insertAdjacentHTML('beforebegin',tableTimePanel(kind))})}catch{}}
  function makeSlot(page){const c=content();if(!c)return null;let slot=slots.get(page);if(slot)return slot;const fn=pageFns()[page]||overview;slot=document.createElement('div');slot.className=`aurum-r61-page-slot page-${page}`;slot.style.display='none';slot.innerHTML=fn();c.appendChild(slot);slots.set(page,slot);setupSlot(slot,page);return slot}
  function adopt(){if(rootReady)return;const c=content();if(!c)return;const page=S.page||'overview',slot=document.createElement('div');slot.className=`aurum-r61-page-slot page-${page}`;slot.style.display='contents';while(c.firstChild)slot.appendChild(c.firstChild);c.appendChild(slot);slots.set(page,slot);rootReady=true;shell(page)}
  function show(page){adopt();for(const [p,s] of slots)s.style.display=p===page?'contents':'none';const slot=makeSlot(page);if(slot)slot.style.display='contents';shell(page);try{updateLiveStatus()}catch{};requestAnimationFrame(()=>{try{window.scrollTo(0,scrollY.get(page)||0)}catch{}})}
  function invalidateAndRenderCurrent(){adopt();const c=content(),page=S.page||'overview';for(const s of slots.values())s.remove();slots.clear();const slot=document.createElement('div');slot.className=`aurum-r61-page-slot page-${page}`;slot.style.display='contents';const fn=pageFns()[page]||overview;slot.innerHTML=fn();c.appendChild(slot);slots.set(page,slot);setupSlot(slot,page);shell(page);try{updateLiveStatus()}catch{};return true}
  globalThis.render=render=function r61Render(){if(internal)return true;return invalidateAndRenderCurrent()};
  globalThis.goPage=goPage=function r61Go(page){page=String(page||'overview');if(page===S.page)return true;if(S.page==='settings'&&page!=='settings'&&S.settingsDirty){if(!confirm('Kaydedilmemiş ayar değişiklikleri var. Kaydetmeden çıkarsanız uygulanmayacak. Çıkılsın mı?'))return false;delete S.__schedulerDraft;S.settingsDirty=false}scrollY.set(S.page||'overview',window.scrollY||0);S.page=page;if(page==='criteria'){S.strictActiveKn='K1';try{writeLocal(KN_V117_ACTIVE_KEY,'K1')}catch{}}internal=true;try{show(page)}finally{internal=false}return true};

  /* Allow deferred K_Tarihsel population to finish even if the user leaves the tab.
     This fixes the old partial-table cache case and keeps later returns instant. */
  const oldPump=kh117PumpRows;
  kh117PumpRows=function r61HistoryPump(token,rows,index){if(token!==KH117_RENDER_TOKEN)return;const body=document.getElementById('kh117Body');if(!body)return;const end=Math.min(rows.length,index+1),frag=document.createDocumentFragment();for(let i=index;i<end;i++){const r=rows[i],tr=document.createElement('tr');tr.innerHTML=`<td class="kh-day"><b>${r._label}</b><small>${html(r.date)}<br>${r._t0?'CANLI':'KESİN'}</small></td><td>${kh117TrendCell(r)}</td><td>${kh117ReelCell(r)}</td>${KN_V117_ORDER.map(k=>`<td>${kh117CriterionCell(r,k)}</td>`).join('')}`;frag.appendChild(tr)}body.appendChild(frag);if(end<rows.length)r61Idle(()=>kh117PumpRows(token,rows,end))};

  try{S.r61FastUI={version:'R61.0',activatedAt:new Date().toISOString(),features:['STRICT_NONZERO_INTEGER_2DP','TINY_ZERO_INTEGER_EXCEPTION_ONLY','PERSISTENT_PAGE_SLOTS','CHUNKED_DATA_ROWS','BACKGROUND_HISTORY_COMPLETION','NO_VISUAL_LAYOUT_STYLE_CHANGE']}}catch{}
})();

/* AURUM R62 — Virtual Portfolio final module.
   Adds only the user-approved portfolio surface and persistence; existing app styling/layout
   remains untouched outside the new card/page and the requested S performance indicator. */
(function(){
  if(globalThis.AURUM_R62_VIRTUAL_PORTFOLIO)return;
  globalThis.AURUM_R62_VIRTUAL_PORTFOLIO='R66.0';
  const S=AurumUpdateAPI.state;
  const CACHE_KEY='aurum.virtualPortfolio.r62.cache';
  const DB_NAME='aurum-virtual-portfolio-r62';
  const DB_VER=1;
  const START_CAPITAL=100000;
  const DEFAULT_POSITION=5000;
  let vpDb=null,vpSaveQ=Promise.resolve(),vpBusy=false;
  let ui={tab:'summary',period:'7D',from:'',to:''};

  function iso(){return new Date().toISOString()}
  function clone(x){try{return structuredClone(x)}catch{return JSON.parse(JSON.stringify(x))}}
  function id(){return `vp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`}
  function dayOf(v){return String(v||iso()).slice(0,10)}
  function price(sym){const r=S.recordMap?.get?.(sym)||S.records?.find?.(x=>x.sym===sym)||S.selection?.find?.(x=>x.sym===sym);const n=Number(r?.livePrice??r?.close??r?.price);return Number.isFinite(n)&&n>0?n:null}
  function blank(){return {version:'R62.0',createdAt:iso(),resetAt:iso(),startingCapital:START_CAPITAL,defaultPosition:DEFAULT_POSITION,holdings:{},excluded:{},transactions:[],navHistory:[],realizedPnL:0,lastSelection:[],lastUpdatedAt:null}}
  function normalize(v){v=v&&typeof v==='object'?v:blank();return {...blank(),...v,holdings:v.holdings||{},excluded:v.excluded||{},transactions:Array.isArray(v.transactions)?v.transactions:[],navHistory:Array.isArray(v.navHistory)?v.navHistory:[],lastSelection:Array.isArray(v.lastSelection)?v.lastSelection:[]}}
  function readCache(){try{return normalize(JSON.parse(localStorage.getItem(CACHE_KEY)||'null'))}catch{return blank()}}
  let VP=readCache();S.virtualPortfolio=VP;

  function openDb(){if(vpDb)return Promise.resolve(vpDb);return new Promise((resolve,reject)=>{const q=indexedDB.open(DB_NAME,DB_VER);q.onupgradeneeded=e=>{const db=e.target.result;if(!db.objectStoreNames.contains('portfolio'))db.createObjectStore('portfolio',{keyPath:'key'});};q.onsuccess=()=>{vpDb=q.result;resolve(vpDb)};q.onerror=()=>reject(q.error)})}
  function req(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
  async function dbRead(){const db=await openDb();return req(db.transaction('portfolio').objectStore('portfolio').get('state'))}
  async function dbWrite(v){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction('portfolio','readwrite');tx.objectStore('portfolio').put({key:'state',value:clone(v),updatedAt:iso()});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}
  function save(){VP.lastUpdatedAt=iso();S.virtualPortfolio=VP;try{localStorage.setItem(CACHE_KEY,JSON.stringify(VP))}catch{};vpSaveQ=vpSaveQ.then(()=>dbWrite(VP)).catch(()=>{});return vpSaveQ}
  async function load(){try{const x=await dbRead();if(x?.value){VP=normalize(x.value);S.virtualPortfolio=VP;try{localStorage.setItem(CACHE_KEY,JSON.stringify(VP))}catch{}}else await save()}catch{}return VP}

  function holdingCost(h){return Number(h?.cost)||0}
  function holdingValue(h){const p=price(h.sym)??Number(h.lastPrice??h.entryPrice??0);return (Number(h.qty)||0)*p}
  function unrealized(){return Object.values(VP.holdings).reduce((a,h)=>a+holdingValue(h)-holdingCost(h),0)}
  function totalPnl(){return Number(VP.realizedPnL||0)+unrealized()}
  function equity(){return Number(VP.startingCapital||START_CAPITAL)+totalPnl()}
  function totalCost(){return Object.values(VP.holdings).reduce((a,h)=>a+holdingCost(h),0)}
  function portfolioDays(){const a=new Date(VP.resetAt||VP.createdAt||Date.now()),b=new Date();return Math.max(1,Math.floor((b-a)/86400000)+1)}
  function fmtTL(v,d=0){const n=Number(v);if(!Number.isFinite(n))return '—';return `${n.toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d})} TL`}
  function signedTL(v,d=0){const n=Number(v);if(!Number.isFinite(n))return '—';return `${n>0?'+':''}${n.toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d})} TL`}
  function signedPct(v){const n=Number(v);if(!Number.isFinite(n))return '—';const a=Math.abs(n).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:false});return `${n>0?'+':n<0?'-':''}${a}%`}
  function pIndicator(){const p=totalPnl(),r=100*p/Math.max(1,Number(VP.startingCapital||START_CAPITAL));return `P: ${signedTL(p,0)} (${signedPct(r)}, ${portfolioDays()} gün)`}
  function snapshot(reason){const value=equity(),pnl=totalPnl(),date=dayOf();const row={id:id(),at:iso(),date,value,pnl,reason};const last=VP.navHistory.at(-1);if(last&&last.date===date&&String(last.reason||'')===String(reason||''))VP.navHistory[VP.navHistory.length-1]=row;else VP.navHistory.push(row);if(VP.navHistory.length>1500)VP.navHistory=VP.navHistory.slice(-1500)}
  function tx(type,sym,qty,p,amount,extra={}){const at=extra?.at||iso();VP.transactions.push({id:id(),at,date:dayOf(at),type,sym,qty:Number(qty)||0,price:Number(p)||0,amount:Number(amount)||0,...extra,at,date:dayOf(at)});if(VP.transactions.length>10000)VP.transactions=VP.transactions.slice(-10000)}

  function buy(sym,targetCost,reason='AL_SAT_AL',entryPrice=null,entryAt=null){if(VP.holdings[sym]||VP.excluded[sym])return false;const qp=Number(entryPrice),p=Number.isFinite(qp)&&qp>0?qp:price(sym);if(!p)return false;const cost=Math.max(0,Number(targetCost||VP.defaultPosition||DEFAULT_POSITION));if(!cost)return false;const qty=cost/p,at=entryAt||iso();VP.holdings[sym]={sym,qty,cost,entryPrice:p,entryAt:at,lastPrice:price(sym)??p,lastMarkedAt:iso(),targetCost:cost,manual:false};tx('ALIM',sym,qty,p,cost,{at,cashDelta:-cost,reason});return true}
  function sell(sym,reason='AL_SAT_SAT',manual=false,exitPrice=null,exitAt=null){const h=VP.holdings[sym];if(!h)return false;const qp=Number(exitPrice),p=Number.isFinite(qp)&&qp>0?qp:(price(sym)??Number(h.lastPrice??h.entryPrice));const proceeds=(Number(h.qty)||0)*p,realized=proceeds-(Number(h.cost)||0),at=exitAt||iso();VP.realizedPnL=Number(VP.realizedPnL||0)+realized;tx('SATIS',sym,h.qty,p,proceeds,{at,cashDelta:proceeds,realizedPnL:realized,reason,entryAt:h.entryAt,entryPrice:h.entryPrice});delete VP.holdings[sym];if(manual)VP.excluded[sym]=true;return true}
  function mark(){for(const h of Object.values(VP.holdings)){const p=price(h.sym);if(p){h.lastPrice=p;h.lastMarkedAt=iso()}}}
  function recomputeRealizedPnL(){VP.realizedPnL=VP.transactions.filter(x=>x.type==='SATIS'&&Number.isFinite(Number(x.realizedPnL))).reduce((a,x)=>a+Number(x.realizedPnL),0);return VP.realizedPnL}
  async function purgeSymbol(raw){const sym=String(raw||'').trim().toUpperCase();if(!sym)return false;delete VP.holdings[sym];delete VP.excluded[sym];VP.transactions=VP.transactions.filter(x=>String(x.sym||'').trim().toUpperCase()!==sym);VP.lastSelection=(VP.lastSelection||[]).filter(x=>String(x).trim().toUpperCase()!==sym);recomputeRealizedPnL();await save();refreshVisible();return true}

  async function reconcile(reason='AL_SAT_UPDATE',{initial=false}={}){
    if(vpBusy)return false;vpBusy=true;
    try{
      const qs=globalThis.AurumQualifiedBuySell?.state?.()||{items:{}},items=qs.items||{},active=Object.values(items).filter(x=>x?.status==='BUY'),curr=active.map(x=>String(x.sym||'').toUpperCase()).filter(Boolean),set=new Set(curr),prev=new Set(VP.lastSelection||[]);
      /* Portfolio membership is now defined only by the qualified AL/SAT lifecycle. */
      for(const sym of Object.keys(VP.excluded))if(!set.has(sym))delete VP.excluded[sym];
      for(const sym of Object.keys(VP.holdings))if(!set.has(sym)){
        const q=items[sym]||null;
        sell(sym,q?.status==='SELL'?'AL_SAT_SAT':'AL_SAT_CIKIS',false,q?.sellPrice,q?.sellAt);
      }
      for(const q of active){const sym=String(q.sym||'').toUpperCase();if(!sym||VP.holdings[sym]||VP.excluded[sym])continue;buy(sym,VP.defaultPosition||DEFAULT_POSITION,initial&&!prev.size?'AL_SAT_BASLANGIC':'AL_SAT_AL',q?.buyPrice,q?.buyAt)}
      mark();VP.lastSelection=curr;snapshot(reason);await save();return true;
    }finally{vpBusy=false}
  }
  async function markAndSave(reason='VERI_GUNCELLEME'){mark();snapshot(reason);await save();refreshVisible();return true}

  function dailyPnl(){const h=VP.navHistory,now=equity(),today=dayOf();const prior=[...h].reverse().find(x=>x.date<today),first=h.find(x=>x.date===today);const base=prior?.value??first?.value??now;return now-base}
  function dailyPct(){const d=dailyPnl(),base=equity()-d;return base?100*d/base:0}
  function realizedCount(type){return VP.transactions.filter(x=>x.type===type).length}
  function winLoss(){const sells=VP.transactions.filter(x=>x.type==='SATIS'&&Number.isFinite(Number(x.realizedPnL)));return {w:sells.filter(x=>x.realizedPnL>0).length,l:sells.filter(x=>x.realizedPnL<0).length}}
  function filteredTx(){let rows=VP.transactions.slice().reverse(),now=Date.now();if(ui.period==='1D')rows=rows.filter(x=>Date.now()-new Date(x.at).getTime()<=86400000);else if(ui.period==='7D')rows=rows.filter(x=>Date.now()-new Date(x.at).getTime()<=7*86400000);else if(ui.period==='1M')rows=rows.filter(x=>Date.now()-new Date(x.at).getTime()<=31*86400000);else if(ui.period==='3M')rows=rows.filter(x=>Date.now()-new Date(x.at).getTime()<=93*86400000);else if(ui.period==='CUSTOM'){if(ui.from)rows=rows.filter(x=>x.date>=ui.from);if(ui.to)rows=rows.filter(x=>x.date<=ui.to)}return rows}
  function filteredNav(){let rows=VP.navHistory.slice(),now=Date.now();const days=ui.period==='1D'?1:ui.period==='7D'?7:ui.period==='1M'?31:ui.period==='3M'?93:null;if(days)rows=rows.filter(x=>now-new Date(x.at).getTime()<=days*86400000);if(ui.period==='CUSTOM'){if(ui.from)rows=rows.filter(x=>x.date>=ui.from);if(ui.to)rows=rows.filter(x=>x.date<=ui.to)}return rows}

  function injectStyle(){if(document.getElementById('aurum-r62-style'))return;const st=document.createElement('style');st.id='aurum-r62-style';st.textContent=`
  .aurum-vp-card{appearance:none;width:100%;text-align:left;color:inherit;font:inherit;cursor:pointer;min-height:78px}.aurum-vp-card .value{color:var(--green)}
  .aurum-vp-card-title{color:var(--muted);font-size:11px;line-height:1.15;margin-bottom:7px;font-weight:500;white-space:nowrap}
  .aurum-vp-card-lines{display:grid;grid-template-columns:max-content minmax(0,1fr);column-gap:5px;row-gap:5px;align-items:baseline;width:100%}
  .aurum-vp-card-key{color:var(--muted);font-size:8px;line-height:1.15;white-space:nowrap;font-weight:500}
  .aurum-vp-card-val{color:var(--green);font-size:clamp(6.6px,1.65vw,9.5px);line-height:1.15;white-space:nowrap;font-weight:800;letter-spacing:-.08px;min-width:0;max-width:100%;overflow:hidden;text-overflow:clip;font-variant-numeric:tabular-nums}
  @media(min-width:430px){.aurum-vp-card-key{font-size:9px}.aurum-vp-card-val{font-size:10px}}
  .aurum-vp-head{display:flex;align-items:center;justify-content:space-between;margin:0 0 10px}.aurum-vp-head button{width:38px;height:38px;border-radius:12px;border:1px solid var(--line2);background:var(--panel);color:var(--text)}.aurum-vp-head h2{margin:0;font-size:18px}
  .aurum-vp-tabs{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--line2);margin:0 -15px 10px}.aurum-vp-tabs button{border:0;border-bottom:2px solid transparent;background:transparent;color:var(--muted);padding:11px 2px;font-size:9px}.aurum-vp-tabs button.active{color:var(--gold2);border-bottom-color:var(--gold2)}
  .aurum-vp-summary{display:grid;gap:10px}.aurum-vp-kv{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.055);font-size:11px}.aurum-vp-kv:last-child{border-bottom:0}.aurum-vp-kv span{color:var(--muted)}
  .aurum-vp-chart{height:150px;width:100%;display:block}.aurum-vp-chart text{fill:var(--muted);font-size:8px}.aurum-vp-chart .grid{stroke:rgba(255,255,255,.06);stroke-width:1}.aurum-vp-chart .line{fill:none;stroke:var(--green);stroke-width:2}.aurum-vp-chart .area{fill:rgba(31,214,139,.08)}
  .aurum-vp-filter{display:flex;gap:5px;align-items:center;overflow-x:auto;padding:4px 0 8px}.aurum-vp-filter button{min-width:42px;border:1px solid var(--line2);background:var(--panel);color:var(--muted);padding:6px 8px;border-radius:8px;font-size:9px}.aurum-vp-filter button.active{border-color:var(--gold);color:var(--gold2)}.aurum-vp-dates{display:flex;gap:6px;margin-bottom:8px}.aurum-vp-dates input{min-width:0;width:50%;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--text);padding:7px;font-size:9px}
  .aurum-vp-table{overflow:auto;border:1px solid var(--line2);border-radius:14px}.aurum-vp-table table{min-width:690px}.aurum-vp-table th,.aurum-vp-table td{font-size:9.5px;padding:8px 7px;white-space:nowrap}.aurum-vp-actions{display:flex;gap:5px}.aurum-vp-actions button{padding:5px 7px;font-size:8px;border-radius:7px}
  .aurum-vp-bottom-actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:12px}.aurum-vp-bottom-actions button{padding:11px 6px;border-radius:10px;font-weight:800;font-size:10px}
  .aurum-vp-pindicator{font-weight:800;color:var(--green);white-space:nowrap}.aurum-vp-perfline{flex-wrap:nowrap!important;gap:8px!important;overflow:hidden}.aurum-vp-perfline>span{white-space:nowrap;font-size:9px}
  @media(max-width:390px){.aurum-vp-perfline{gap:5px!important}.aurum-vp-perfline>span{font-size:8px}.aurum-vp-tabs button{font-size:8px}}
  `;document.head.appendChild(st)}

  function portfolioPeriodPnl(days=null,months=null){
    const now=new Date(),cut=new Date(now);
    if(months)cut.setMonth(cut.getMonth()-months);else cut.setDate(cut.getDate()-Number(days||0));
    const hist=(Array.isArray(VP.navHistory)?VP.navHistory:[]).map(x=>({...x,_t:Date.parse(x?.at||`${x?.date||''}T23:59:59`),_v:Number(x?.value)})).filter(x=>Number.isFinite(x._t)&&Number.isFinite(x._v)).sort((a,b)=>a._t-b._t);
    const cur=equity();if(!hist.length)return {pnl:0,pct:0};let base=null;for(const x of hist){if(x._t<=cut.getTime())base=x;else break}if(!base)base=hist[0];
    const v=Number(base._v),pnl=cur-v;return {pnl,pct:v?100*pnl/v:0};
  }
  function portfolioCard(){const p=totalPnl(),r=100*p/Math.max(1,VP.startingCapital),m=portfolioPeriodPnl(null,1),w=portfolioPeriodPnl(7,null),d=dailyPnl(),dr=100*d/Math.max(1,equity()-d);return `<button type="button" class="card metric aurum-vp-card" onclick="AurumPortfolio.open()"><div class="aurum-vp-card-title">Sanal portföy (P):</div><div class="aurum-vp-card-lines"><span class="aurum-vp-card-key">Toplam:</span><span class="aurum-vp-card-val ${equity()>=0?'green':'red'}">${signedTL(equity(),0)}</span><span class="aurum-vp-card-key">T.KZ:</span><span class="aurum-vp-card-val ${p>=0?'green':'red'}">${signedTL(p,0)} (${signedPct(r)}, ${portfolioDays()}gün)</span><span class="aurum-vp-card-key">A.K/Z:</span><span class="aurum-vp-card-val ${m.pnl>=0?'green':'red'}">${signedTL(m.pnl,0)} (${signedPct(m.pct)})</span><span class="aurum-vp-card-key">H.K/Z:</span><span class="aurum-vp-card-val ${w.pnl>=0?'green':'red'}">${signedTL(w.pnl,0)} (${signedPct(w.pct)})</span><span class="aurum-vp-card-key">G.K/Z:</span><span class="aurum-vp-card-val ${d>=0?'green':'red'}">${signedTL(d,0)} (${signedPct(dr)})</span></div></button>`}

  const baseOverview=overview;
  overview=function r62Overview(){
    const s=S.selection,avg=mean(s.map(x=>x.dayChange)),med=median(s.map(x=>x.dayChange)),evaluated=latestTargetRun(),q=mean(S.records.map(x=>x.quality)),lm=learningMomentum(),profiles=[...S.behaviorProfiles.values()];
    return `${quickAccess()}<div class="section-head"><div class="section-title"><h2 class="aurum-overview-summary-title">Sonuç ve Öğrenme Özeti</h2></div><small>Canlı sistem görünümü</small></div><div class="grid metrics aurum-overview-metrics">${metric('Aktif seçim',s.length,'S · Nihai liste')}${metric('Hedef isabet',evaluated?fmt(evaluated.metrics.precisionDual20*100,1)+'%':'—','Reel Top20 + ≥%'+S.settings.targetReturnPct)}${metric('Öğrenme puanı',fmt(lm.score,1)+'/100',lm.delta==null?'Yeni kanıt bekleniyor':`7 dönem değişim ${lm.delta>=0?'+':''}${fmt(lm.delta*100,1)} puan`,lm.delta>=0?'green':'red')}${metric('Davranış kapsaması',fmt((S.behaviorMemory.coverage||0)*100,1)+'%',`${profiles.length} hisse · 252 seans`)}${metric('DNA kapsaması',fmt((S.behaviorMemory.genomeCoverage||0)*100,1)+'%',`${GENOME_TRAIT_COUNT} özellik · K12`)}${metric('Ortalama günlük',pct(avg),'Seçili hisseler',avg>=0?'green':'red')}${metric('Medyan günlük',pct(med),'Seçili hisseler',med>=0?'green':'red')}${metric('Veri kalite',q?fmt(q,0)+'/100':'—',`${S.records.length} kayıt`)}${metric('Model',MODEL_VERSION,'Şampiyon–aday + 89 özellikli DNA')}${portfolioCard()}</div><div class="section-head"><div class="section-title"><h2>Öğrenme disiplini</h2></div></div><div class="grid two-col aurum-overview-discipline"><div class="card gold-edge"><b class="gold aurum-decision-label">${html(String(S.performance.lastDecision||'Bekleme').replaceAll('_',' ').toLowerCase().replace(/(^|\s)\S/g,m=>m.toUpperCase()))}</b><p class="muted">Aday katkı yalnız ileri dönem doğrulamasında şampiyonu geçerse etkinleşir.</p><button class="ghost-btn" onclick="goPage('learning')">Öğrenme ve Davranış Modülünü Aç</button></div><div class="card gold-edge aurum-last-update-card"><span class="muted">Son veri güncellemesi:</span><div style="font-size:1.35rem;font-weight:700;line-height:1.35;margin-top:8px">${html(formatTableTime(TABLE_META.data?.transfer))}</div><p class="muted" style="margin-top:10px">Piyasa veri zamanı: ${html(formatTableTime(TABLE_META.data?.market))}<br>Kn: ${html(formatTableTime(TABLE_META.kn?.transfer))}<br>K_Tarihsel: ${html(formatTableTime(TABLE_META.history?.transfer))}<br>S: ${html(formatTableTime(TABLE_META.s?.transfer))}</p><small class="muted">AUTOFIX2 · otomatik zamanlayıcı çekirdeği</small></div></div>${globalThis.AurumQualifiedBuySell?.card?.()||''}`;
  };
  globalThis.overview=overview;

  const baseGln=glnGdnCard;
  glnGdnCard=function r62Gln(kind){let out=baseGln(kind);if(kind!=='s')return out;const p=pIndicator();out=out.replace('<div class="aurum-performance-lines" style="flex-wrap:wrap">','<div class="aurum-performance-lines aurum-vp-perfline" style="flex-wrap:nowrap">');return out.replace('</div><div class="aurum-gln-gdn-card"',`<span class="aurum-vp-pindicator">${html(p)}</span></div><div class="aurum-gln-gdn-card"`)};
  globalThis.glnGdnCard=glnGdnCard;

  function chart(){const rows=filteredNav();if(rows.length<2)return `<div class="card notice">Portföy grafiği için en az iki güncelleme gerekli.</div>`;const vals=rows.map(x=>Number(x.value)).filter(Number.isFinite),mn=Math.min(...vals),mx=Math.max(...vals),span=Math.max(1,mx-mn),W=600,H=150,pad=12;const pts=rows.map((x,i)=>{const xx=pad+(W-2*pad)*(rows.length===1?0:i/(rows.length-1)),yy=pad+(H-2*pad)*(1-(Number(x.value)-mn)/span);return [xx,yy]}),line=pts.map(p=>p.join(',')).join(' '),area=`${pts[0][0]},${H-pad} ${line} ${pts.at(-1)[0]},${H-pad}`;return `<div class="card"><div class="aurum-vp-kv"><b>PORTFÖY DEĞERİ</b><span>${ui.period}</span></div><svg class="aurum-vp-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line class="grid" x1="0" y1="${H/2}" x2="${W}" y2="${H/2}"/><polygon class="area" points="${area}"/><polyline class="line" points="${line}"/></svg><div class="aurum-vp-kv"><span>${fmtTL(mn,0)}</span><b>${fmtTL(mx,0)}</b></div></div>`}
  function filters(){return `<div class="aurum-vp-filter">${[['1D','1G'],['7D','7G'],['1M','1A'],['3M','3A'],['ALL','Tümü'],['CUSTOM','Tarih']].map(([k,l])=>`<button class="${ui.period===k?'active':''}" onclick="AurumPortfolio.period('${k}')">${l}</button>`).join('')}</div>${ui.period==='CUSTOM'?`<div class="aurum-vp-dates"><input type="date" value="${html(ui.from)}" onchange="AurumPortfolio.date('from',this.value)"><input type="date" value="${html(ui.to)}" onchange="AurumPortfolio.date('to',this.value)"></div>`:''}`}
  function summaryView(){const p=totalPnl(),r=100*p/Math.max(1,VP.startingCapital),d=dailyPnl(),dr=dailyPct(),wl=winLoss();return `${filters()}<div class="aurum-vp-summary"><div class="card"><div class="aurum-vp-kv"><span>Toplam Değer</span><b>${fmtTL(equity(),0)}</b></div><div class="aurum-vp-kv"><span>T.KZ</span><b class="${p>=0?'green':'red'}">${signedTL(p,0)} (${signedPct(r)})</b></div><div class="aurum-vp-kv"><span>G.K/Z</span><b class="${d>=0?'green':'red'}">${signedTL(d,0)} (${signedPct(dr)})</b></div><div class="aurum-vp-kv"><span>Başlangıç Sermayesi</span><b>${fmtTL(VP.startingCapital,0)}</b></div><div class="aurum-vp-kv"><span>Hisse Sayısı</span><b>${Object.keys(VP.holdings).length} / 20</b></div><div class="aurum-vp-kv"><span>Aktif Maliyet</span><b>${fmtTL(totalCost(),0)}</b></div><div class="aurum-vp-kv"><span>Son Güncelleme</span><b>${VP.lastUpdatedAt?new Date(VP.lastUpdatedAt).toLocaleString('tr-TR'):'—'}</b></div></div>${chart()}<div class="card"><div class="aurum-vp-kv"><span>Toplam Getiri</span><b class="${r>=0?'green':'red'}">${signedPct(r)}</b></div><div class="aurum-vp-kv"><span>Gerçekleşen K/Z</span><b class="${VP.realizedPnL>=0?'green':'red'}">${signedTL(VP.realizedPnL,0)}</b></div><div class="aurum-vp-kv"><span>Gerçekleşmemiş K/Z</span><b class="${unrealized()>=0?'green':'red'}">${signedTL(unrealized(),0)}</b></div><div class="aurum-vp-kv"><span>Kazanan / Kaybeden Satış</span><b>${wl.w} / ${wl.l}</b></div><div class="aurum-vp-kv"><span>Portföy Yaşı</span><b>${portfolioDays()} gün</b></div></div></div>`}
  function holdingsView(){const rows=Object.values(VP.holdings).sort((a,b)=>a.sym.localeCompare(b.sym));return `<div class="aurum-vp-table"><table><thead><tr><th>Hisse</th><th>AF</th><th>SON</th><th>Getiri</th><th>ZK</th><th>Aktif Kilit</th><th>Sonraki</th><th>İşlem</th></tr></thead><tbody>${rows.map(h=>{const p=price(h.sym)??h.lastPrice??h.entryPrice,rr=h.entryPrice?100*(p/h.entryPrice-1):0,q=globalThis.AurumQualifiedBuySell?.state?.().items?.[h.sym],qm=q?globalThis.AurumQualifiedBuySell.metrics(q):null;return `<tr><td class="symbol">${html(h.sym)}</td><td>${fmtTL(h.entryPrice,2)}</td><td>${fmtTL(p,2)}</td><td class="${rr>=0?'green':'red'}">${signedPct(rr)}</td><td>${qm?.stop?fmtTL(qm.stop,2):'—'}</td><td>${qm?.activeLockPct!=null?signedPct(qm.activeLockPct):'—'}</td><td>${qm?.nextLockPct!=null?signedPct(qm.nextLockPct):'—'}</td><td><div class="aurum-vp-actions"><button class="ghost-btn" onclick="AurumPortfolio.adjust('${h.sym}')">Ayarla</button><button class="danger-btn" onclick="AurumPortfolio.remove('${h.sym}')">Çıkar</button></div></td></tr>`}).join('')||'<tr><td colspan="8">Aktif pozisyon yok.</td></tr>'}</tbody></table></div>`}
  function txView(cash=false){const rows=filteredTx();let bal=VP.startingCapital;const chrono=VP.transactions.slice().sort((a,b)=>String(a.at).localeCompare(String(b.at))),balanceBy={};for(const x of chrono){bal+=Number(x.cashDelta||0);balanceBy[x.id]=bal}return `${filters()}<div class="aurum-vp-table"><table><thead><tr>${cash?'<th>Tarih</th><th>Açıklama</th><th>Para Hareketi</th><th>Bakiye</th>':'<th>Tarih</th><th>Hisse</th><th>İşlem</th><th>Miktar</th><th>Fiyat</th><th>Tutar</th><th>K/Z</th>'}</tr></thead><tbody>${rows.map(x=>cash?`<tr><td>${new Date(x.at).toLocaleString('tr-TR')}</td><td>${html(x.sym||'PORTFÖY')} · ${html(x.type)}</td><td class="${Number(x.cashDelta)>=0?'green':'red'}">${signedTL(x.cashDelta,2)}</td><td>${fmtTL(balanceBy[x.id],2)}</td></tr>`:`<tr><td>${new Date(x.at).toLocaleString('tr-TR')}</td><td class="symbol">${html(x.sym||'—')}</td><td class="${x.type==='ALIM'?'green':x.type==='SATIS'?'red':''}">${html(x.type)}</td><td>${AurumNumberFormat(x.qty,2)}</td><td>${fmtTL(x.price,2)}</td><td>${fmtTL(x.amount,2)}</td><td class="${Number(x.realizedPnL||0)>=0?'green':'red'}">${x.realizedPnL==null?'—':signedTL(x.realizedPnL,2)}</td></tr>`).join('')||`<tr><td colspan="${cash?4:7}">Bu aralıkta hareket yok.</td></tr>`}</tbody></table></div>`}
  function page(){injectStyle();const body=ui.tab==='summary'?summaryView():ui.tab==='holdings'?holdingsView():ui.tab==='transactions'?txView(false):txView(true);return `<div class="aurum-vp-head"><button onclick="AurumPortfolio.back()">←</button><div class="aurum-vp-title-tools"><h2>Sanal Portföy</h2><button class="aurum-r222-mini-refresh" type="button" title="Sanal portföyü AL/SAT listesiyle yenile" aria-label="Sanal portföyü yenile" onclick="refreshAurumTradePanels(event)">↻</button></div><button onclick="AurumPortfolio.settings()">⚙</button></div><div class="aurum-vp-tabs">${[['summary','ÖZET'],['holdings','HİSSELER'],['transactions','İŞLEMLER'],['cash','NAKİT HAREKETLERİ']].map(([k,l])=>`<button class="${ui.tab===k?'active':''}" onclick="AurumPortfolio.tab('${k}')">${l}</button>`).join('')}</div>${body}<div class="aurum-vp-bottom-actions"><button class="gold-btn" onclick="AurumPortfolio.reconcile()">GÜNCELLE</button><button class="ghost-btn" onclick="AurumPortfolio.reset()">SIFIRLA</button><button class="gold-btn" onclick="AurumPortfolio.settings()">AYARLAR</button><button class="danger-btn" onclick="AurumPortfolio.exportData()">DIŞARI AKTAR</button></div>`}

  const baseGo=goPage,baseRender=render;
  let vpSwipeStart=null;
  function ensurePortfolioBottomNav(){const nav=document.querySelector('.bottom-nav');if(!nav)return;nav.hidden=false;nav.style.display='grid';nav.style.visibility='visible';nav.style.opacity='1';nav.style.pointerEvents='auto';}
  function bindPortfolioSwipe(c){
    if(!c)return;
    c.ontouchstart=e=>{const t=e.touches?.[0];if(!t)return;const el=e.target;const blocked=el?.closest?.('button,input,select,textarea,a,.aurum-vp-table,.aurum-vp-tabs,.aurum-vp-filter,.aurum-vp-dates');vpSwipeStart=blocked?null:{x:t.clientX,y:t.clientY,at:Date.now()};};
    c.ontouchend=e=>{const a=vpSwipeStart,t=e.changedTouches?.[0];vpSwipeStart=null;if(!a||!t||S.page!=='portfolio')return;const dx=t.clientX-a.x,dy=t.clientY-a.y,dt=Date.now()-a.at;if(dx<=-72&&Math.abs(dy)<=64&&Math.abs(dx)>=Math.abs(dy)*1.35&&dt<=1200)leavePortfolio('overview');};
    c.ontouchcancel=()=>{vpSwipeStart=null};
  }
  function renderPortfolio(){injectStyle();S.page='portfolio';const c=document.getElementById('content');if(!c)return;c.className='page-portfolio';c.innerHTML=page();const t=document.getElementById('pageTitle');if(t)t.textContent='Sanal Portföy';document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.remove('active'));ensurePortfolioBottomNav();bindPortfolioSwipe(c);window.scrollTo(0,0)}
  function refreshVisible(){if(S.page==='portfolio')renderPortfolio();else if(S.page==='overview'||S.page==='selection'){try{render()}catch{}}}
  function leavePortfolio(pageName){
    const target=String(pageName||'overview');
    const c=document.getElementById('content');
    /* R61 keeps normal pages in persistent slots. Opening the portfolio intentionally
       replaces #content, which invalidates those mounted slot nodes. Before returning to
       any ordinary tab, clear the portfolio DOM and let the canonical R61 render path
       rebuild exactly one clean current slot. This prevents the portfolio surface from
       remaining underneath/above subsequent tabs. */
    if(c)c.replaceChildren();
    S.page=target;
    return baseRender();
  }
  goPage=function r66Go(pageName){if(pageName==='portfolio'){renderPortfolio();return true}if(S.page==='portfolio')return leavePortfolio(pageName);return baseGo(pageName)};globalThis.goPage=goPage;

  async function resetPortfolio(){if(!confirm('Sanal portföy geçmişi ve kar/zararı sıfırlansın mı? Mevcut aktif AL hisseleri AL/SAT kayıt fiyatlarıyla yeniden kurulacaktır.'))return;VP=blank();S.virtualPortfolio=VP;await reconcile('PORTFOY_SIFIRLAMA',{initial:true});refreshVisible();showAurumNotice('Sanal portföy sıfırlandı ve aktif AL listesi yeniden kuruldu.','success',2600)}
  async function remove(sym){if(!confirm(`${sym} sanal portföyden tamamen çıkarılsın mı?`))return;sell(sym,'MANUEL_CIKAR',true);snapshot('MANUEL_CIKAR');await save();refreshVisible()}
  async function adjust(sym){const h=VP.holdings[sym];if(!h)return;const raw=prompt(`${sym} için hedef aktif maliyet (TL). 0 = tamamen çıkar:`,String(Math.round(h.cost)));if(raw==null)return;const target=Number(String(raw).replace(',','.'));if(!Number.isFinite(target)||target<0)return showAurumNotice('Geçerli bir tutar girin.','error',2200);if(target===0)return remove(sym);const p=price(sym)??h.lastPrice??h.entryPrice,currentCost=Number(h.cost)||0;if(Math.abs(target-currentCost)<0.01)return; if(target>currentCost){const add=target-currentCost,q=add/p;h.qty+=q;h.cost+=add;h.lastPrice=p;h.manual=true;tx('ALIM',sym,q,p,add,{cashDelta:-add,reason:'MANUEL_ARTIR'});}else{const cut=currentCost-target,ratio=cut/currentCost,q=(Number(h.qty)||0)*ratio,proceeds=q*p,realized=proceeds-cut;h.qty-=q;h.cost-=cut;h.lastPrice=p;h.manual=true;VP.realizedPnL+=realized;tx('SATIS',sym,q,p,proceeds,{cashDelta:proceeds,realizedPnL:realized,reason:'MANUEL_AZALT'});}snapshot('MANUEL_AYAR');await save();refreshVisible()}
  async function settings(){const raw=prompt('Yeni AL girişlerinde hisse başına varsayılan alım tutarı (TL):',String(VP.defaultPosition||DEFAULT_POSITION));if(raw==null)return;const n=Number(String(raw).replace(',','.'));if(!Number.isFinite(n)||n<=0)return showAurumNotice('Geçerli bir tutar girin.','error',2200);VP.defaultPosition=n;await save();refreshVisible();showAurumNotice(`Varsayılan alım ${fmtTL(n,0)} olarak ayarlandı.`,'success',2200)}
  function exportData(){const data={exportedAt:iso(),summary:{startingCapital:VP.startingCapital,equity:equity(),totalPnl:totalPnl(),realizedPnL:VP.realizedPnL,unrealizedPnL:unrealized()},holdings:Object.values(VP.holdings),transactions:VP.transactions,navHistory:VP.navHistory};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=`aurum_sanal_portfoy_${dayOf()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}

  globalThis.AurumPortfolio=Object.freeze({open:()=>renderPortfolio(),back:()=>leavePortfolio('overview'),tab:k=>{ui.tab=k;renderPortfolio()},period:k=>{ui.period=k;renderPortfolio()},date:(k,v)=>{ui[k]=v;renderPortfolio()},reset:resetPortfolio,remove,adjust,settings,exportData,reconcile:async()=>{const ok=await reconcile('MANUEL_PORTFOY_ESLEME');if(ok)refreshVisible();return ok},purgeSymbol,state:()=>clone(VP),indicator:pIndicator});

  /* Load the persistent portfolio immediately after the application's canonical state. */
  const baseLoadState=loadState;
  loadState=async function r62LoadState(){const r=await baseLoadState();await load();await reconcile('UYGULAMA_ACILISI',{initial:!VP.transactions.length});return r};globalThis.loadState=loadState;

  /* Every successful data acquisition marks current holdings with the newly published prices. */
  const basePrepare=prepareData;
  prepareData=async function r62PrepareData(...args){const ok=await basePrepare(...args);if(ok)await markAndSave('VERI_GUNCELLEME');return ok};globalThis.prepareData=prepareData;

  /* Manual and scheduled S calculations share this single path, so entry/exit transactions
     are generated exactly once after the new S list is finalized. */
  const baseCalcS=calculateS;
  calculateS=async function r62CalculateS(...args){const ok=await baseCalcS(...args);if(ok){mark();await save();refreshVisible()}return ok};globalThis.calculateS=calculateS;

  injectStyle();
  try{AurumUpdateAPI.state.r62VirtualPortfolio={version:'R62.0',activatedAt:iso(),features:['S_DRIVEN_AUTO_BUY_SELL','5000_DEFAULT_POSITION','100000_BASE_CAPITAL','PERSISTENT_IDB_LEDGER','DAILY_TOTAL_PNL','DATE_WEEK_DAY_FILTERS','MANUAL_ADJUST_REMOVE_RESET','S_P_INDICATOR','DATA_TIMER_MANUAL_MARK_TO_MARKET']}}catch{}
  setTimeout(()=>{try{if((AurumUpdateAPI.state.page||'overview')==='overview')render()}catch(e){console.error('R63 portfolio overview render',e)}},0);
})();


/* ===== R67 — missing-cell eligibility tolerance + portfolio navigation ergonomics ===== */
(function(){
  try{
    const KEY='aurum.r67.missing-cell-thresholds.60';
    if(localStorage.getItem(KEY)!=='1'){
      const st=globalThis.AurumUpdateAPI?.state;
      if(st?.settings){
        try{globalThis.AurumRawStoreR55?.invalidate?.()}catch{}
        try{Promise.resolve(globalThis.saveSettings?.()).catch(()=>{})}catch{}
      }
      localStorage.setItem(KEY,'1');
    }
    if(globalThis.AurumUpdateAPI?.state)globalThis.AurumUpdateAPI.state.r67={version:'R67.0',activatedAt:new Date().toISOString(),features:['ROW_MISSING_THRESHOLD_60','COLUMN_MISSING_THRESHOLD_60','REAL_MISSING_COUNTS_UNCHANGED','PORTFOLIO_SWIPE_LEFT_BACK','PORTFOLIO_GLOBAL_BOTTOM_NAV_VISIBLE']};
  }catch{}
})();


/* ===== R21 — canonical S AL/SAT notifications + safe fast staging ===== */
(function(){
  const HISTORY_KEY='sNotificationHistoryR21';
  const SIG_KEY='aurum.r21.s-notification.signature.v1';
  const MAX_HISTORY=200;
  function arr(x){return [...new Set((Array.isArray(x)?x:[]).map(v=>String(v||'').trim().toUpperCase()).filter(Boolean))].sort()}
  function sig(ins,outs){return `AL:${arr(ins).join(',')}|SAT:${arr(outs).join(',')}`}
  async function saveHistory(ins,outs,at,delivery={}){
    try{const prev=(await dbGet('meta',HISTORY_KEY))?.value||{rows:[]};const row={id:`SCHANGE|${Date.now()}|${Math.random().toString(36).slice(2,7)}`,at:at||nowISO(),buy:arr(ins),sell:arr(outs),delivery};prev.rows=[row,...(prev.rows||[])].slice(0,MAX_HISTORY);prev.updatedAt=nowISO();await dbPut('meta',{key:HISTORY_KEY,value:prev,updatedAt:prev.updatedAt});return row}catch{return null}
  }
  function nativePromptNotify(title,body,tag){
    try{
      const qp=new URLSearchParams({cmd:'notification',title:String(title),body:String(body),tag:String(tag||'aurum-s-change'),channel:'aurum_pipeline'});
      const r=window.prompt(`aurum://native?${qp.toString()}`,'')||'';
      return r==='OK'||r==='SHOWN'||r==='1';
    }catch{return false}
  }
  function webNotify(title,body,tag){try{if('Notification' in globalThis&&Notification.permission==='granted'){new Notification(title,{body,tag});return true}}catch{}return false}
  async function dispatch(ins,outs,at,job){
    const buys=arr(ins),sells=arr(outs);if(!buys.length&&!sells.length)return false;
    const signature=sig(buys,sells),previous=readLocal(SIG_KEY,'');if(previous===signature)return false;
    const body=`${buys.length?`AL: ${buys.join(', ')}`:''}${buys.length&&sells.length?' · ':''}${sells.length?`SAT: ${sells.join(', ')}`:''}`;
    const title='Aurum B · S AL/SAT';
    let nativeShown=nativePromptNotify(title,body,`aurum-s-${signature}`),webShown=false;
    if(!nativeShown)webShown=webNotify(title,body,`aurum-s-${signature}`);
    try{showAurumNotice(`${title}: ${body}`,'info',5200)}catch{}
    writeLocal(SIG_KEY,signature);
    if(job)job.sNotificationDetail=body;
    await saveHistory(buys,sells,at,{native:nativeShown,web:webShown,background:!!BACKGROUND_SYNC});
    return true;
  }
  globalThis.r21DispatchSChange=dispatch;



  /* One-time migration to safe-fast defaults. It speeds IndexedDB staging by grouping
     concurrent writes into short foreground batches, while every stagePut promise still
     resolves only after the transaction commits. Atomic publish, integrity gates, retries,
     source fallback and orphan recovery are untouched. */
  queueMicrotask(async()=>{try{
    const key='aurum.r21.safe-fast.migrated.v1';if(readLocal(key,false)!==true){
      state.settings.adaptiveConcurrency=true;state.settings.providerHealthAdaptive=true;state.settings.richParallelAllProviders=true;state.settings.fastFailoverEnabled=true;
      state.settings.concurrency=Math.max(28,Math.min(32,Number(state.settings.concurrency||32)));state.settings.maxGlobalConcurrency=32;
      state.settings.providerWaveSize=Math.max(8,Math.min(10,Number(state.settings.providerWaveSize||10)));
      state.settings.sourceRetryCount=Math.max(1,Math.min(3,Number(state.settings.sourceRetryCount||1)));
      state.settings.stageBatchSize=Math.max(192,Math.min(320,Number(state.settings.stageBatchSize||256)));
      state.settings.stageFlushMs=Math.max(3,Math.min(8,Number(state.settings.stageFlushMs||4)));
      await saveSettings();writeLocal(key,true);
    }
    try{AurumUpdateAPI.state.r21={version:'R21.0',activatedAt:nowISO(),features:['S_AL_SAT_NOTIFICATION_HISTORY','S_CHANGE_DEDUP','NATIVE_NOTIFICATION_BRIDGE_ATTEMPT','BACKGROUND_COMPLETION_S_DETAIL','SAFE_FOREGROUND_STAGE_BATCHING','ATOMIC_PUBLISH_PRESERVED','SOURCE_RETRY_PRESERVED']}}catch{}
  }catch{}});
})();


/* ===== R22: native background continuation + durable staging continuation =====
   Goal: switching apps / screen-off must not discard partial data. Foreground work writes
   durable staging; when the WebView is background-throttled, the existing Android exact-alarm
   PipelineService resumes the SAME persisted job. Publication remains atomic and only occurs
   after every universe symbol has a FRESH record for the current snapshot. */
(()=>{
  const R22_KEY='aurum.r22.background.continuation.v1';
  const R22_OWNER='aurum.r22.native.owner.v1';
  function r22Read(){return readLocal(R22_KEY,{armed:false,jobId:null,guardTime:null,guardDate:null,regularTimes:[],armedAt:null});}
  function r22Write(x){writeLocal(R22_KEY,x);return x;}
  function r22Owner(){return readLocal(R22_OWNER,null);}
  function r22SetOwner(x){writeLocal(R22_OWNER,x);return x;}
  function r22NextMinute(){const d=new Date(Date.now()+65000),p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d),o={};for(const x of p)o[x.type]=x.value;return {time:`${o.hour}:${o.minute}`,date:`${o.year}-${o.month}-${o.day}`};}
  function r22RegularTimes(){try{return schedulerConfiguredTimes().slice()}catch{return []}}
  function r22NativeSchedule(times){try{return (window.prompt(`aurum://native?${new URLSearchParams({cmd:'schedule',enabled:'1',times:[...new Set(times)].sort().join(',')})}`,'')||'')==='OK'}catch{return false}}
  function r22ArmGuard(){
    if(BACKGROUND_SYNC)return false;const rt=globalThis.AurumRuntime?.state||globalThis.AurumUpdateAPI?.state||null;
    const busy=state.syncing||operationBusyStatus(String(rt?.status||''));if(!busy)return false;
    const n=r22NextMinute(),regular=r22RegularTimes(),ok=r22NativeSchedule([...regular,n.time]);
    const jobId=String(rt?.jobId||state?.operationControl?.jobId||'')||null;r22Write({armed:true,jobId,guardTime:n.time,guardDate:n.date,regularTimes:regular,armedAt:nowISO(),nativeScheduleOk:ok});
    try{for(const id of [...STAGE_BATCHES.keys()])flushStageBatch(id).catch(()=>{});}catch{}
    return ok;
  }
  function r22RestoreSchedule(){const x=r22Read();if(!x?.armed||BACKGROUND_SYNC)return false;const ok=r22NativeSchedule(x.regularTimes?.length?x.regularTimes:r22RegularTimes());r22Write({...x,armed:false,restoredAt:nowISO(),restoreOk:ok});return ok;}
  function r22PendingIsGuard(){const x=r22Read(),p=nativePending(),n=normalizePendingSlot(p);if(!x?.armed||!n)return false;const key=String(n.key||n.slot||'');return key.includes(`${x.guardDate}|${x.guardTime}`)||key.endsWith(`|${x.guardTime}`);}
  async function r22ManualCandidate(){const active=new Set(['FETCHING_DATA','WAITING_FOR_NETWORK','RETRY_PENDING']);return (await dbAll('jobs')).filter(j=>j?.mode==='MANUAL'&&String(j?.currentStage||'')==='Veriler'&&active.has(String(j?.status||''))).sort((a,b)=>String(b.updatedAt||b.startedAt||'').localeCompare(String(a.updatedAt||a.startedAt||'')))[0]||null;}

  const baseScheduled=scheduledEntry;
  scheduledEntry=async function r22ScheduledEntry(){
    if(!BACKGROUND_SYNC)return baseScheduled();
    if(!r22PendingIsGuard())return baseScheduled();
    const p=nativePending(),pending=normalizePendingSlot(p),slot=pending?.key||String(p?.slot||'');const job=await r22ManualCandidate();
    if(!job){nativeComplete(slot,true,'BACKGROUND_GUARD_NO_PENDING_DATA');return true;}
    const age=Date.now()-Date.parse(job.updatedAt||job.startedAt||0);
    /* If foreground is still genuinely progressing, do not create a competing fetch. */
    if(Number.isFinite(age)&&age<45000){nativeComplete(slot,true,'FOREGROUND_TRANSFER_STILL_ACTIVE');return true;}
    r22SetOwner({jobId:job.id,owner:'NATIVE_PIPELINE',startedAt:nowISO()});
    try{
      const ok=await resumeManualStage(job);
      r22SetOwner({jobId:job.id,owner:ok?'NATIVE_COMPLETED':String(job.status||'NATIVE_WAITING'),completedAt:nowISO(),status:job.status});
      if(ok)nativeComplete(slot,true,`BACKGROUND_DATA_COMPLETED:${job.processedSymbols||0}/${job.totalSymbols||0}`);
      else if(job.status!==JOB_STATUS.WAITING_FOR_NETWORK&&job.status!==JOB_STATUS.RETRY_PENDING)nativeComplete(slot,false,job.error||job.status||'BACKGROUND_DATA_INCOMPLETE');
      return ok;
    }catch(e){r22SetOwner({jobId:job.id,owner:'NATIVE_ERROR',completedAt:nowISO(),error:e?.message||String(e)});nativeComplete(slot,false,e?.message||'BACKGROUND_CONTINUATION_ERROR');return false;}
  };
  globalThis.scheduledEntry=scheduledEntry;

  /* Foreground context yields at symbol boundaries once native takeover starts. This avoids
     two WebViews writing the same staging job concurrently. When the user returns after a
     native completion, reload from IndexedDB instead of continuing the stale JS stack. */
  const basePause=pauseCheckpoint;
  pauseCheckpoint=async function r22PauseCheckpoint(job,status){
    await basePause(job,status);if(BACKGROUND_SYNC||!job)return;
    let o=r22Owner();if(o?.jobId!==job.id||!String(o.owner||'').startsWith('NATIVE_'))return;
    while(o?.jobId===job.id&&['NATIVE_PIPELINE','NATIVE_WAITING'].includes(o.owner)){await sleep(500);o=r22Owner();}
    if(o?.jobId===job.id&&['NATIVE_COMPLETED','NATIVE_ERROR'].includes(o.owner)){
      if(!document.hidden){setTimeout(()=>location.reload(),0);await new Promise(()=>{});}else{while(document.hidden)await sleep(750);setTimeout(()=>location.reload(),0);await new Promise(()=>{});}
    }
  };
  globalThis.pauseCheckpoint=pauseCheckpoint;

  /* Flush staging immediately before Android can throttle the UI WebView, then arm a one-minute
     exact-alarm handoff. No UI timer is relied upon for the continuation itself. */
  const r22Hide=()=>{try{if(document.hidden)r22ArmGuard()}catch{}};
  document.addEventListener('visibilitychange',r22Hide,{passive:true});
  window.addEventListener('pagehide',()=>{try{r22ArmGuard()}catch{}},{passive:true});
  window.addEventListener('blur',()=>{if(document.hidden)try{r22ArmGuard()}catch{}},{passive:true});
  /* Existing in-flight native handoff may be armed when a running job is backgrounded, but reopening/foreground/network restoration never restores or starts it automatically. */

  /* Keep the continuation state diagnosable and enable strict coherent publication by default. */
  queueMicrotask(async()=>{try{state.settings.backgroundStagingContinuation=true;state.settings.strictFreshSnapshot=true;state.settings.stageRetentionHours=Math.max(72,Number(state.settings.stageRetentionHours||72));await saveSettings();try{AurumUpdateAPI.state.r22={version:'R22.0',activatedAt:nowISO(),features:['NATIVE_PIPELINE_SCREEN_OFF_HANDOFF','DURABLE_STAGE_RESUME_NO_CLEAR','RESUME_SKIPS_ALREADY_FRESH_SYMBOLS','ATOMIC_ALL_FRESH_SNAPSHOT','STAGING_REPAIR_BEFORE_PUBLISH','ONLINE_FOCUS_PAGESHOW_RECOVERY','NATIVE_OWNER_RACE_GUARD']}}catch{}}catch{}});
})();


/* ===== R23: single-pass, field-parallel source matrix =====
   User contract:
   - No automatic round 2/3. A GENERAL/FULL data job performs one pass only.
   - The same symbol can be queried from different providers concurrently; merged output chooses
     each field/series value from the best valid provider, so different data fields of one stock
     may come from different sources in the same pass.
   - A symbol/provider pair is invoked at most once per pass. HTTP/provider retry is disabled for
     the pass; explicit "Eksikleri tamamla" is the only second acquisition attempt.
   - Data always flows provider -> in-memory merge -> durable staging -> atomic records publish.
   - Missing/failed rows are preserved as STALE_PRESERVED/UNAVAILABLE and are excluded from
     calculations; they remain repair targets instead of forcing an automatic whole-table retry.
*/
(()=>{
  const R23_VERSION='R23.0-SINGLE-PASS-FIELD-PARALLEL';
  const KNOWN_FULL=['ISYATIRIM','ISYATIRIM_FINANCIALS','ISYATIRIM_LIVE','YAHOO','YAHOO_ALT','YAHOO_QUOTE','BIGPARA','BIGPARA_LIVE','FOREKS','STOOQ'];
  const HIST=['ISYATIRIM','YAHOO','YAHOO_ALT','BIGPARA','FOREKS','STOOQ'];
  const LIVE=['ISYATIRIM_LIVE','YAHOO_QUOTE','YAHOO','YAHOO_ALT','BIGPARA_LIVE','BIGPARA'];
  const FUND=['ISYATIRIM_FINANCIALS','YAHOO_QUOTE','ISYATIRIM'];

  function uniq(xs){return [...new Set((xs||[]).filter(Boolean).map(x=>String(x).toUpperCase()))];}
  async function r23ProviderPool(kind='ALL',fields=[]){
    let base=[];
    if(kind==='LIVE')base=[...LIVE];
    else if(kind==='REPAIR'){
      const f=fields||[],needHist=f.length===0||f.some(x=>/_T\d+$|EMA|MACD|RSI|Momentum|Volatilite|Boll|Beta|Getiri_|Hacim|Degisim3Gun|Destek|Direnc|Kapanis|Min_|Max_/i.test(String(x))),
            needLive=f.some(x=>/Anlik|VeriZamani|FiyatDegisim%_T0/i.test(String(x))),
            needFund=f.some(x=>/PD_T0|SERMAYE|FD_|FAVOK|F_K|PD_DD|ROE|İş Yatırım|Cap|Fund/i.test(String(x)));
      if(needHist)base.push(...HIST);if(needLive)base.push(...LIVE);if(needFund)base.push(...FUND);if(!base.length)base.push(...KNOWN_FULL);
    }else base=[...KNOWN_FULL];
    try{base.push(...(await providerOrder(kind==='LIVE')))}catch{}
    try{for(const d of customProviders())base.push(String(d.name||'CUSTOM').toUpperCase())}catch{}
    return uniq(base);
  }
  function r23FieldSourceMap(rec){
    const out={};
    try{
      const bs=rec?.series?.sources||rec?.barSources||null;if(bs&&typeof bs==='object')Object.assign(out,bs);
      const fs=rec?.fundamentalSources||{};for(const [k,v] of Object.entries(fs))out[`fundamentals.${k}`]=v?.source||v||null;
      if(rec?.marketTimeProvider)out.marketTime=rec.marketTimeProvider;
      if(rec?.live?.provider||rec?.liveProvider)out.live=rec?.live?.provider||rec?.liveProvider;
    }catch{}
    return out;
  }
  function r23MarkCandidate(candidate,bundle,job,windowCheck,kind='GENERAL'){
    candidate.unresolvedFields=bundleRecordMissingFields(candidate);
    candidate.providerAttempts=[...(bundle?.attempts||[])];
    candidate.dataSnapshotId=job.dataSnapshotId;candidate.jobId=job.id;candidate.jobMode=job.mode;
    candidate.jobDataStatus='FRESH';candidate.marketWindowEligible=windowCheck.ok;candidate.marketWindowDeltaMinutes=windowCheck.deltaMinutes;
    candidate.singlePassAttemptComplete=true;candidate.singlePassMode=kind;candidate.singlePassAt=nowISO();
    candidate.fieldSourceMap=r23FieldSourceMap(candidate);
    candidate.provenance={...(candidate.provenance||{}),sources:candidate.providers||[],fieldSources:candidate.fieldSourceMap,marketAt:candidate.marketDataAt||null,marketTimeVerified:candidate.marketTimeVerified===true,marketTimeProvider:candidate.marketTimeProvider||null,receivedAt:bundle?.receivedAt||null,validatedAt:nowISO(),jobId:job.id,canonicalMarketAt:job.canonicalMarketAt,marketWindowDeltaMinutes:windowCheck.deltaMinutes,singlePass:true};
    return candidate;
  }
  async function r23FetchOnce(sym,start,end,base,providers,onSource,mode='FORCE_ALL'){
    /* Explicit provider list guarantees each provider is inserted into fetchSymbolBundle once.
       providerWaveSize is widened to the whole list; provider/global semaphores remain the
       protective rate-limit layer, so this increases useful parallelism without bypassing caps. */
    const oldWave=state.settings.providerWaveSize;
    state.settings.providerWaveSize=Math.max(1,Math.min(32,providers.length||1));
    try{return await fetchSymbolBundle(sym,start,end,{mode,baseBundle:base,providers,onSource});}
    finally{state.settings.providerWaveSize=oldWave;}
  }

  prepareGeneralData=async function prepareGeneralDataR23(job,mode='GENERAL'){
    const universe=currentSymbols(),resume=['FETCHING_DATA','WAITING_FOR_NETWORK','RETRY_PENDING'].includes(String(job?.status||''));
    job.totalSymbols=universe.length;job.currentStage='Veriler';job.requestedDataMode=mode;
    const oldRows=resume?await stageRows(job.id):[],doneSet=new Set(oldRows.filter(x=>x?.record?.singlePassAttemptComplete===true).map(x=>x.sym));job.processedSymbols=doneSet.size;
    await transition(job,JOB_STATUS.FETCHING_DATA,{message:doneSet.size?`Tek geçiş staging'den devam · ${doneSet.size}/${universe.length}`:'Tek geçiş · kaynaklar/veri alanları eşzamanlı',done:doneSet.size,total:universe.length});
    state.syncing=true;state.sourceStats={};if(!resume)await clearStage(job.id);
    const oldRetry=Number(state.settings.sourceRetryCount||0),old429=Number(state.settings.maxProvider429Retries||0),oldRepair=Number(state.settings.symbolRepairRounds||1),oldRecovery=Number(state.settings.marketRecoveryRounds||0);
    state.settings.sourceRetryCount=0;state.settings.maxProvider429Retries=0;state.settings.symbolRepairRounds=1;state.settings.marketRecoveryRounds=0;
    try{
      await pauseCheckpoint(job,JOB_STATUS.FETCHING_DATA);
      if(!isOnline()){await transition(job,JOB_STATUS.WAITING_FOR_NETWORK,{error:'OFFLINE',message:'Ağ bağlantısı bekleniyor'});return false;}
      const end=new Date(),start=addMonths(end,-Number(state.settings.monthsBack||14));let indexBundle=(await dbGet('meta','indexBundle'))?.value||{bars:[]};
      const startup=await Promise.allSettled([
        (async()=>{try{await refreshKapDirectoryIfDue()}catch(e){await log('warn','Şirket dizini güncellenemedi; tek geçiş devam ediyor',{error:e?.message||String(e)})}})(),
        refreshMarketIndicators(),
        mode!=='LIVE'?(async()=>{const fresh=await fetchIndexBundle(start,end);indexBundle=mergeBundles(INDEX_SYMBOL,[indexBundle,fresh]);await dbPut('meta',{key:'indexBundle',value:indexBundle,updatedAt:nowISO()})})():Promise.resolve(),
        resolveCanonicalMarketPoint(start,end)
      ]);
      const cp=startup[3]?.status==='fulfilled'?startup[3].value:null;
      if(cp?.timestampVerified&&safeTime(cp.at)!=null){job.canonicalMarketAt=cp.at;job.canonicalMarketProvider=cp.provider||'XU100';}else{job.canonicalMarketAt=null;job.canonicalMarketProvider=null;await issue(job,INDEX_SYMBOL,'VeriZamani','ALL','CANONICAL_MARKET_TIME_UNAVAILABLE_CONTINUE',cp?.attempts||[]);}job.canonicalMarketAttempts=cp?.attempts||[];await saveJob(job);
      const providers=await r23ProviderPool(mode==='LIVE'?'LIVE':'ALL');
      let cursor=0,completed=doneSet.size,critical=0;const concurrency=adaptiveWorkerCount(Math.max(1,universe.length-doneSet.size));
      job.symbolScanPolicy={sequential:false,concurrency,onePass:true,automaticSecondRound:false,providerOncePerSymbol:true,fieldParallelMerge:true,providerPool:providers};await saveJob(job);
      const worker=async()=>{while(true){
        await pauseCheckpoint(job,JOB_STATUS.FETCHING_DATA);const idx=cursor++;if(idx>=universe.length)break;const sym=universe[idx];if(doneSet.has(sym))continue;
        const prior=state.recordMap.get(sym)||null,base=prior?bundleFromRecord(prior):null;let rec=null,issues=[];
        try{
          const symbolStart=mode==='FULL'?start:(prior?.latestDate?dateBefore(prior.latestDate,14):start);
          const onSource=({symbol,provider,status})=>setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',done:completed,total:universe.length,message:`${symbol} · tek geçiş · ${sourceName(provider)}${status==='ERROR'?' başarısız':''}`,symbol,provider});
          const bundle=await r23FetchOnce(sym,symbolStart,end,base,providers,onSource,mode==='LIVE'?'LIVE':'FORCE_ALL');
          const successes=(bundle.attempts||[]).filter(a=>a?.status==='OK');if(!successes.length)throw Object.assign(new Error('NO_PROVIDER_SUCCESS_SINGLE_PASS'),{code:'NO_PROVIDER_SUCCESS_SINGLE_PASS'});
          let candidate=enrichBundle(mergeBundles(sym,[bundle]),indexBundle);try{candidate=globalThis.AurumIsYatirimCompanyCard?.attachCached?.(candidate,{allowStale:false})||candidate}catch{}
          const wc=job.canonicalMarketAt?marketWindowCheck(candidate,job.canonicalMarketAt):{ok:false,reason:'CANONICAL_MARKET_TIME_UNAVAILABLE',deltaMinutes:null};
          candidate=r23MarkCandidate(candidate,bundle,job,wc,'GENERAL');const vr=validateRecord(candidate,sym);if(!vr.ok)throw Object.assign(new Error(vr.issues.join(',')),{code:'RECORD_VALIDATION'});rec=candidate;
          if(!wc.ok)await issue(job,sym,'VeriZamani','ALL',wc.reason||'MARKET_TIME_WINDOW_UNAVAILABLE_DATA_KEPT',{marketAt:candidate.marketDataAt||null,canonicalMarketAt:job.canonicalMarketAt,deltaMinutes:wc.deltaMinutes});
        }catch(e){issues.push(e?.code||e?.message||String(e));await issue(job,sym,'*','ALL','SINGLE_PASS_FETCH_FAILED',e?.message||String(e));rec=makePlaceholder(sym,prior,issues);rec.unresolvedFields=prior?bundleRecordMissingFields(rec):['*'];rec.singlePassAttemptComplete=true;rec.singlePassMode='GENERAL';rec.singlePassAt=nowISO();if(!prior)critical++;}
        await stagePut(job.id,sym,rec);completed++;job.processedSymbols=completed;setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',done:completed,total:universe.length,message:`${sym} · tek geçiş tamam`,symbol:sym,provider:null});if(completed%48===0)await saveJob(job);
      }};
      await Promise.all(Array.from({length:concurrency},worker));await flushStageBatch(job.id);await pauseCheckpoint(job,JOB_STATUS.FETCHING_DATA);
      if(!isOnline()){await transition(job,JOB_STATUS.WAITING_FOR_NETWORK,{error:'OFFLINE_AFTER_SINGLE_PASS',message:'Ağ kesildi · staging korunuyor, bağlantı gelince devam'});return false;}
      const staged=(await stageRows(job.id)).map(x=>x.record),fresh=staged.filter(x=>x?.jobDataStatus==='FRESH'),temporal=liveTemporalAudit(fresh.filter(x=>x?.marketWindowEligible===true));
      if(!fresh.length){await transition(job,JOB_STATUS.FAILED,{error:'NO_FRESH_DATA_SINGLE_PASS',message:'Tek geçişte hiçbir kaynaktan güncel veri alınamadı · önceki tablo korundu'});return false;}
      const published=await atomicPublish(job,universe),freshPublished=published.filter(x=>x?.jobDataStatus==='FRESH'),summary=dataSummary(published),repairPlan=await persistPendingRepairPlan(published,universe);
      summary.transferredFreshSymbols=freshPublished.length;summary.singlePass=true;summary.automaticRepairRounds=0;summary.temporalAudit=temporal;summary.integrityGate=dataIntegrityGate(summary);summary.pendingRepair=repairPlan;
      job.sourceStats={...state.sourceStats};job.dataSummary=summary;job.liveTemporalAudit=temporal;job.criticalUnavailable=critical;job.pendingRepair=repairPlan;job.integrityRepairRounds=[];state.lastSuccessfulSync=nowISO();
      await dbPut('meta',{key:'lastSuccessfulSync',value:state.lastSuccessfulSync,updatedAt:state.lastSuccessfulSync});await dbPut('meta',{key:'lastDataSummary',value:summary,updatedAt:nowISO()});await persistLiveSnapshots(job.dataSnapshotId);await pruneSnapshots();await clearStage(job.id);await refreshTableMeta();
      await transition(job,JOB_STATUS.DATA_COMPLETED,{message:`Tek geçiş tamamlandı · ${freshPublished.length}/${universe.length} güncel · ${repairPlan.symbolCount} eksik için “Eksikleri tamamla”`,done:universe.length,total:universe.length});return true;
    }catch(e){job.error=e?.message||String(e);if(e?.code==='OPERATION_CANCELLED'||cancelRequested(job)){await transition(job,JOB_STATUS.IDLE,{error:null,message:'İşlem iptal edildi · önceki tablo korundu'});return false;}if(!isOnline()||/network|offline|failed to fetch|ERR_/i.test(job.error)){await transition(job,JOB_STATUS.WAITING_FOR_NETWORK,{error:job.error,message:'Ağ bağlantısı bekleniyor · staging korunuyor'});}else await transition(job,JOB_STATUS.FAILED,{error:job.error,message:'Tek geçiş başarısız · önceki tablo korundu'});return false;
    }finally{try{await flushStageBatch(job.id)}catch{}state.settings.sourceRetryCount=oldRetry;state.settings.maxProvider429Retries=old429;state.settings.symbolRepairRounds=oldRepair;state.settings.marketRecoveryRounds=oldRecovery;state.syncing=false;clearCancel(job.id);renderCurrentPagePreservingView();}
  };

  prepareMissingData=async function prepareMissingDataR23(job){
    const initialPlan=currentPendingRepairPlan(),targets=initialPlan.items.map(x=>x.sym),resume=['FETCHING_DATA','WAITING_FOR_NETWORK','RETRY_PENDING'].includes(String(job?.status||'')),rows=resume?await stageRows(job.id):[],doneSet=new Set(rows.filter(x=>x?.record?.singlePassAttemptComplete===true).map(x=>x.sym));
    job.totalSymbols=targets.length;job.currentStage='Veriler';job.processedSymbols=doneSet.size;job.requestedDataMode='REPAIR';
    await transition(job,JOB_STATUS.FETCHING_DATA,{message:targets.length?(doneSet.size?`Eksikler staging'den devam · ${doneSet.size}/${targets.length}`:'Eksikleri tamamla · yalnız eksik alanlar · tek geçiş'):'Eksik veri yok',done:doneSet.size,total:targets.length});state.syncing=true;state.sourceStats={};if(!resume)await clearStage(job.id);
    const oldRetry=Number(state.settings.sourceRetryCount||0),old429=Number(state.settings.maxProvider429Retries||0);state.settings.sourceRetryCount=0;state.settings.maxProvider429Retries=0;
    try{
      if(!targets.length){await transition(job,JOB_STATUS.DATA_COMPLETED,{message:'Eksik hisse/hücre yok',done:0,total:0});return true;}if(!isOnline()){await transition(job,JOB_STATUS.WAITING_FOR_NETWORK,{error:'OFFLINE',message:'Ağ bağlantısı bekleniyor'});return false;}
      const end=new Date(),start=addMonths(end,-Number(state.settings.monthsBack||14));let indexBundle=(await dbGet('meta','indexBundle'))?.value||{bars:[]};
      const cp=await resolveCanonicalMarketPoint(start,end);if(cp?.timestampVerified&&safeTime(cp.at)!=null){job.canonicalMarketAt=cp.at;job.canonicalMarketProvider=cp.provider||'XU100';job.canonicalMarketAttempts=cp.attempts||[];}await saveJob(job);
      let cursor=0,completed=doneSet.size;const concurrency=adaptiveWorkerCount(Math.max(1,targets.length-doneSet.size));job.symbolScanPolicy={sequential:false,concurrency,repairOnly:true,onePass:true,providerOncePerSymbol:true,fieldTargetedSources:true};await saveJob(job);
      const worker=async()=>{while(true){await pauseCheckpoint(job,JOB_STATUS.FETCHING_DATA);const idx=cursor++;if(idx>=targets.length)break;const sym=targets[idx];if(doneSet.has(sym))continue;
        const prior=state.recordMap.get(sym)||null,base=prior?.series?.date?.length?bundleFromRecord(prior):null,before=prior?bundleRecordMissingFields(prior):['*'];let rec=prior?JSON.parse(JSON.stringify(prior)):makePlaceholder(sym,null,['REPAIR_TARGET_NO_PRIOR']);
        try{
          const deep=before[0]==='*'||missingNeedsDeepHistory(before),symbolStart=deep?start:(prior?.latestDate?dateBefore(prior.latestDate,14):start),providers=await r23ProviderPool('REPAIR',before);
          const onSource=({provider,status})=>setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',done:completed,total:targets.length,message:`${sym} · eksik alanlar · ${sourceName(provider)}${status==='ERROR'?' başarısız':''}`,symbol:sym,provider});
          const bundle=await r23FetchOnce(sym,symbolStart,end,base,providers,onSource,'FORCE_ALL');if(!(bundle.attempts||[]).some(a=>a?.status==='OK'))throw Object.assign(new Error('NO_PROVIDER_SUCCESS_SINGLE_REPAIR'),{code:'NO_PROVIDER_SUCCESS_SINGLE_REPAIR'});
          let candidate=enrichBundle(mergeBundles(sym,[bundle]),indexBundle);candidate=await enrichRepairFromCompanyCard(candidate,job,sym);const wc=job.canonicalMarketAt?marketWindowCheck(candidate,job.canonicalMarketAt):{ok:false,reason:'CANONICAL_MARKET_TIME_UNAVAILABLE',deltaMinutes:null},after=bundleRecordMissingFields(candidate);
          candidate=r23MarkCandidate(candidate,bundle,job,wc,'REPAIR');candidate.repairOnly=true;candidate.repairAttemptedAt=nowISO();const vr=validateRecord(candidate,sym);if(!vr.ok)throw new Error(vr.issues.join(','));const improved=!prior||before[0]==='*'||after.length<before.length||prior?.jobDataStatus!=='FRESH';if(improved)rec=candidate;else{rec=JSON.parse(JSON.stringify(prior));rec.repairAttemptedAt=nowISO();rec.repairLastError='Tek geçişte yeni eksik hücre kazanımı olmadı';rec.singlePassAttemptComplete=true;rec.singlePassMode='REPAIR';rec.singlePassAt=nowISO();}
        }catch(e){await issue(job,sym,'*','ALL','TARGETED_SINGLE_PASS_REPAIR_FAILED',e?.message||String(e));rec=prior?JSON.parse(JSON.stringify(prior)):makePlaceholder(sym,null,[e?.message||String(e)]);rec.repairAttemptedAt=nowISO();rec.repairLastError=e?.message||String(e);rec.singlePassAttemptComplete=true;rec.singlePassMode='REPAIR';rec.singlePassAt=nowISO();}
        await stagePut(job.id,sym,rec);completed++;job.processedSymbols=completed;setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',done:completed,total:targets.length,message:`${sym} · eksik alan denemesi tamam`,symbol:sym,provider:null});if(completed%32===0)await saveJob(job);
      }};
      await Promise.all(Array.from({length:concurrency},worker));await flushStageBatch(job.id);if(!isOnline()){await transition(job,JOB_STATUS.WAITING_FOR_NETWORK,{error:'OFFLINE_AFTER_REPAIR',message:'Ağ kesildi · staging korunuyor'});return false;}
      const result=await atomicRepairPublish(job,targets),summary=dataSummary(result.records);summary.pendingRepair=result.plan;summary.singlePassRepair=true;summary.integrityGate=dataIntegrityGate(summary);job.dataSummary=summary;job.pendingRepair=result.plan;await dbPut('meta',{key:'lastDataSummary',value:summary,updatedAt:nowISO()});await clearStage(job.id);await refreshTableMeta();await transition(job,JOB_STATUS.DATA_COMPLETED,{message:`Eksik tamamlama tek geçişi bitti · ${targets.length} hedef · ${result.plan.symbolCount} eksik kaldı`,done:targets.length,total:targets.length});return true;
    }catch(e){job.error=e?.message||String(e);if(e?.code==='OPERATION_CANCELLED'||cancelRequested(job)){await transition(job,JOB_STATUS.IDLE,{error:null,message:'Onarım iptal edildi · mevcut tablo korundu'});return false;}if(!isOnline()||/network|offline|failed to fetch|ERR_/i.test(job.error))await transition(job,JOB_STATUS.WAITING_FOR_NETWORK,{error:job.error,message:'Ağ bağlantısı bekleniyor · staging korunuyor'});else await transition(job,JOB_STATUS.FAILED,{error:job.error,message:'Eksik tamamlama başarısız · mevcut tablo korundu'});return false;
    }finally{try{await flushStageBatch(job.id)}catch{}state.settings.sourceRetryCount=oldRetry;state.settings.maxProvider429Retries=old429;state.syncing=false;clearCancel(job.id);renderCurrentPagePreservingView();}
  };

  /* These settings describe the acquisition contract, not a speed hack: source/provider
     semaphores and staging integrity remain intact. */
  queueMicrotask(async()=>{try{
    state.settings.sourceRetryCount=0;state.settings.maxProvider429Retries=0;state.settings.symbolRepairRounds=1;state.settings.marketRecoveryRounds=0;state.settings.richParallelAllProviders=true;state.settings.providerWaveSize=Math.max(12,Number(state.settings.providerWaveSize||12));state.settings.strictFreshSnapshot=false;
    await saveSettings();try{AurumUpdateAPI.state.r23={version:R23_VERSION,activatedAt:nowISO(),features:['ONE_GENERAL_PASS_ONLY','NO_AUTO_ROUND_2_3','SYMBOL_PROVIDER_ONCE_PER_PASS','FIELD_LEVEL_MULTI_SOURCE_MERGE','PARALLEL_PROVIDER_MATRIX','EXPLICIT_REPAIR_ONLY_SECOND_ATTEMPT','TARGETED_REPAIR_PROVIDER_SET','STAGING_ATOMIC_PUBLISH_PRESERVED','CALC_EXCLUDES_STALE_UNAVAILABLE','BACKGROUND_STAGE_RESUME_PRESERVED']}}catch{}
  }catch{}});
  globalThis.prepareGeneralData=prepareGeneralData;globalThis.prepareMissingData=prepareMissingData;
})();

/* ===== R24: capability-routed fast acquisition scheduler =====
   Goal: materially reduce acquisition time without weakening staging, validation,
   provider rate limits, fallback, atomic publication or repair semantics.
   Strategy: one rich historical lane + one balanced live/time lane run in parallel.
   Fundamental supplements are requested only when the merged primary result actually
   needs them. A source is invoked at most once per symbol in one command.
*/
(()=>{
  const R24_VERSION='R25.1-ULTRA-FAST-COMPLETENESS-SHARDED';
  const HIST_PRIMARY=[];
  const HIST_FALLBACK=['ISYATIRIM','YAHOO','BIGPARA','FOREKS','STOOQ','YAHOO_ALT'];
  const LIVE_POOL=['BIGPARA_LIVE','YAHOO_QUOTE','ISYATIRIM_LIVE','YAHOO','YAHOO_ALT','BIGPARA'];
  const FUND_POOL=['ISYATIRIM','ISYATIRIM_FINANCIALS','YAHOO_QUOTE','BIGPARA_LIVE'];
  const FUND_KEYS=['marketCap','capital','enterpriseValue','ebitda','pe','pb','evEbitda','roe','freeFloat'];
  const hash=s=>{let h=2166136261;for(const c of String(s||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;};
  const uniq=xs=>[...new Set((xs||[]).filter(Boolean).map(x=>String(x).toUpperCase()))];
  const fundCount=b=>FUND_KEYS.filter(k=>validFundamentalCandidate(k,b?.fundamentals?.[k])!=null).length;
  const histEnough=b=>{const c=coverage(b||{bars:[],fundamentals:{}}),target=Math.max(80,Math.min(300,Math.round(Number(state.settings?.monthsBack||14)*21*.72)));return c.bars>=target&&c.open>=.70&&c.volume>=.70;};
  const liveEnough=b=>validNumber(b?.live?.price)!=null&&Number(b.live.price)>0&&b?.live?.timestampVerified===true&&safeTime(b.live.at)!=null;
  function laneContribution(bundle,lane){
    if(!bundle)return false;
    if(lane==='HIST'){
      const bars=(bundle.bars||[]).filter(x=>validateBar(x).ok);
      return bars.length>=20;
    }
    if(lane==='LIVE')return liveEnough(bundle);
    if(lane==='FUND')return fundCount(bundle)>0;
    return false;
  }
  function balanced(pool,sym){const p=uniq(pool);if(p.length<2)return p;const n=hash(sym)%p.length;return [...p.slice(n),...p.slice(0,n)];}
  const R25_HEALTH_SNAPSHOT=new Map();let R25_HEALTH_AT=0;
  async function healthSorted(pool,sym){const now=Date.now(),rotated=balanced(pool,sym);if(now-R25_HEALTH_AT>15000){R25_HEALTH_AT=now;await Promise.all(uniq([...HIST_FALLBACK,...LIVE_POOL,...FUND_POOL]).map(async code=>{try{R25_HEALTH_SNAPSHOT.set(code,await sourceHealth(code))}catch{}}));}const rows=[];for(let i=0;i<rotated.length;i++){const code=rotated[i],h=R25_HEALTH_SNAPSHOT.get(code)||await sourceHealth(code),total=(h.success||0)+(h.failed||0),err=total?(h.failed||0)/total:0,pen=((h.rateLimitedUntil||0)>now?10000:0)+((h.circuitUntil||0)>now?20000:0)+Math.min(3000,Number(h.avgLatencyMs||900))+err*1000;rows.push({code,score:i*75+pen});}return rows.sort((a,b)=>a.score-b.score).map(x=>x.code);}
  function fieldNeeds(fields=[]){const f=(fields||[]).map(String),all=!f.length||f.includes('*');return {
    hist:all||f.some(x=>/_T\d+$|EMA|MACD|RSI|Momentum|Volatilite|Boll|Beta|Getiri_|Hacim|Degisim3Gun|Destek|Direnc|Kapanis|Min_|Max_|ATR|Göreceli/i.test(x)),
    live:all||f.some(x=>/Anlik|VeriZamani|FiyatDegisim%_T0/i.test(x)),
    fund:all||f.some(x=>/PD_T0|SERMAYE|FD_|FAVOK|F_K|PD_DD|ROE|Hedef|Potansiyel|Çapraz/i.test(x))
  };}
  function r24FieldSourceMap(rec){const out={};try{const fs=rec?.fundamentalSources||{};for(const [k,v] of Object.entries(fs))out[`fundamentals.${k}`]=v?.source||v||null;if(rec?.marketTimeProvider)out.marketTime=rec.marketTimeProvider;const src=rec?.series?.sources||rec?.barSources;if(src&&typeof src==='object')Object.assign(out,src);}catch{}return out;}
  function markCandidate(candidate,bundle,job,wc,kind){candidate.unresolvedFields=bundleRecordMissingFields(candidate);candidate.providerAttempts=[...(bundle?.attempts||[])];candidate.dataSnapshotId=job.dataSnapshotId;candidate.jobId=job.id;candidate.jobMode=job.mode;candidate.jobDataStatus='FRESH';candidate.marketWindowEligible=wc.ok;candidate.marketWindowDeltaMinutes=wc.deltaMinutes;candidate.singlePassAttemptComplete=true;candidate.singlePassMode=kind;candidate.singlePassAt=nowISO();candidate.fieldSourceMap=r24FieldSourceMap(candidate);candidate.provenance={...(candidate.provenance||{}),sources:candidate.providers||[],fieldSources:candidate.fieldSourceMap,marketAt:candidate.marketDataAt||null,marketTimeVerified:candidate.marketTimeVerified===true,marketTimeProvider:candidate.marketTimeProvider||null,receivedAt:bundle?.receivedAt||null,validatedAt:nowISO(),jobId:job.id,canonicalMarketAt:job.canonicalMarketAt,marketWindowDeltaMinutes:wc.deltaMinutes,singlePass:true,planner:'R25_1_COMPLETENESS_ROUTED'};return candidate;}
  async function plannedBundle(sym,start,end,base,onSource,fields=null){
    const needs=fieldNeeds(fields||[]),attempted=new Set(),bundles=base?[base]:[],attempts=[];
    let merged=mergeBundles(sym,bundles);
    const run=async(code,lane)=>{code=String(code).toUpperCase();if(attempted.has(code))return false;attempted.add(code);const t=performance.now();try{onSource?.({symbol:sym,provider:code,status:'FETCHING',lane});const b=await withProviderSlot(code,()=>invokeProvider(code,sym,start,end));if(!laneContribution(b,lane)){const err=Object.assign(new Error(`EMPTY_OR_UNUSABLE_${lane}_PAYLOAD`),{code:'EMPTY_PROVIDER_PAYLOAD'});attempts.push({provider:code,lane,status:'EMPTY',error:err.message,latencyMs:Math.round(performance.now()-t),bars:b?.bars?.length||0});try{await updateSourceHealth(code,{ok:false,error:err.message})}catch{}onSource?.({symbol:sym,provider:code,status:'EMPTY',lane,error:err.message});return false;}bundles.push(b);attempts.push({provider:code,lane,status:'OK',latencyMs:Math.round(performance.now()-t),bars:b?.bars?.length||0,marketAt:b?.marketPoint?.at||b?.live?.at||null,receivedAt:b?.receivedAt||nowISO()});state.sourceStats[code]=(state.sourceStats[code]||0)+1;onSource?.({symbol:sym,provider:code,status:'OK',lane});merged=mergeBundles(sym,bundles);return true;}catch(e){attempts.push({provider:code,lane,status:'ERROR',error:e?.message||String(e),latencyMs:Math.round(performance.now()-t)});onSource?.({symbol:sym,provider:code,status:'ERROR',lane,error:e?.message||String(e)});return false;}};
    const hedge=async(codes,lane,enough)=>{const q=uniq(codes);if(!q.length)return;const first=q.slice(0,2),rest=q.slice(2);await Promise.all(first.map(code=>run(code,lane)));if(enough())return;for(const code of rest){await run(code,lane);if(enough())break;}};
    const historyLane=async()=>{if(!needs.hist)return;const order=await healthSorted([...HIST_PRIMARY,...HIST_FALLBACK],sym);await hedge(order,'HIST',()=>histEnough(merged));};
    const liveLane=async()=>{if(!needs.live||state.settings?.liveEnabled===false)return;const order=await healthSorted(LIVE_POOL,sym);await hedge(order,'LIVE',()=>liveEnough(merged));};
    await Promise.all([historyLane(),liveLane()]);
    /* Do not fan out fundamentals blindly. Only fill them when the already fetched rich/history
       and live providers did not supply enough fields. This removes thousands of redundant calls. */
    if(needs.fund&&fundCount(merged)<8){const fq=await healthSorted(FUND_POOL,sym);await Promise.all(fq.slice(0,2).map(code=>run(code,'FUND')));for(const code of fq.slice(2)){if(fundCount(merged)>=8)break;await run(code,'FUND');}}
    merged=mergeBundles(sym,bundles);merged.attempts=attempts;merged.r24Planner={attempted:[...attempted],historyOk:histEnough(merged),liveOk:liveEnough(merged),fundCount:fundCount(merged)};return merged;
  }
  function workerCount(total){const net=String(navigator?.connection?.effectiveType||''),hc=Math.max(4,Number(navigator?.hardwareConcurrency||8));let cap=Math.max(16,Math.min(36,Number(state.settings?.concurrency||28),Math.max(16,hc*3)));if(/2g/.test(net))cap=Math.min(cap,6);else if(/3g/.test(net))cap=Math.min(cap,16);return Math.max(1,Math.min(total,cap));}

  prepareGeneralData=async function prepareGeneralDataR24(job,mode='GENERAL'){
    const universe=currentSymbols(),resume=['FETCHING_DATA','WAITING_FOR_NETWORK','RETRY_PENDING'].includes(String(job?.status||''));job.totalSymbols=universe.length;job.currentStage='Veriler';job.requestedDataMode=mode;
    const oldRows=resume?await stageRows(job.id):[],doneSet=new Set(oldRows.filter(x=>x?.record?.singlePassAttemptComplete===true).map(x=>x.sym));job.processedSymbols=doneSet.size;
    const resumedValid=oldRows.filter(x=>x?.record?.jobDataStatus==='FRESH'&&Array.isArray(x?.record?.series?.date)&&x.record.series.date.length>=20).length,resumedFailed=Math.max(0,doneSet.size-resumedValid);
    await transition(job,JOB_STATUS.FETCHING_DATA,{message:doneSet.size?`Staging'den devam · ${doneSet.size}/${universe.length} denendi · ${resumedValid} doğrulandı`:'Veri çekimi · doğrulanmış veri bekleniyor',done:doneSet.size,total:universe.length,validated:resumedValid,failed:resumedFailed});state.syncing=true;state.sourceStats={};if(!resume)await clearStage(job.id);
    const restore={retry:state.settings.sourceRetryCount,r429:state.settings.maxProvider429Retries,timeout:state.settings.requestTimeoutMs,pc:{...(state.settings.providerConcurrency||{})}};
    state.settings.sourceRetryCount=Math.max(1,Math.min(2,Number(state.settings.sourceRetryCount??1)));state.settings.maxProvider429Retries=Math.max(1,Math.min(2,Number(state.settings.maxProvider429Retries??1)));state.settings.requestTimeoutMs=Math.max(8000,Math.min(12000,Number(state.settings.requestTimeoutMs||9000)));state.settings.providerConcurrency={...(state.settings.providerConcurrency||{}),ISYATIRIM:12,ISYATIRIM_FINANCIALS:6,ISYATIRIM_LIVE:8,YAHOO:16,YAHOO_ALT:14,YAHOO_QUOTE:10,BIGPARA:12,BIGPARA_LIVE:10,FOREKS:8,STOOQ:8};
    try{
      if(!isOnline()){await transition(job,JOB_STATUS.WAITING_FOR_NETWORK,{error:'OFFLINE',message:'Ağ bağlantısı bekleniyor · staging korunuyor'});return false;}
      const end=new Date(),start=addMonths(end,-Number(state.settings.monthsBack||14));let indexBundle=(await dbGet('meta','indexBundle'))?.value||{bars:[]};
      const startup=await Promise.allSettled([(async()=>{try{await refreshKapDirectoryIfDue()}catch{}})(),refreshMarketIndicators(),mode!=='LIVE'?(async()=>{try{const fresh=await fetchIndexBundle(start,end);indexBundle=mergeBundles(INDEX_SYMBOL,[indexBundle,fresh]);await dbPut('meta',{key:'indexBundle',value:indexBundle,updatedAt:nowISO()});}catch(e){await log('warn','Endeks geçmişi yenilenemedi; mevcut önbellek kullanılıyor',{error:e?.message||String(e)})}})():Promise.resolve(),resolveCanonicalMarketPoint(start,end)]);
      const cp=startup[3]?.status==='fulfilled'?startup[3].value:null;if(cp?.timestampVerified&&safeTime(cp.at)!=null){job.canonicalMarketAt=cp.at;job.canonicalMarketProvider=cp.provider||'XU100';job.canonicalMarketAttempts=cp.attempts||[];}else{job.canonicalMarketAt=null;job.canonicalMarketProvider=null;await issue(job,INDEX_SYMBOL,'VeriZamani','ALL','CANONICAL_MARKET_TIME_UNAVAILABLE_CONTINUE',cp?.attempts||[]);}await saveJob(job);
      let cursor=0,completed=doneSet.size,validated=resumedValid,failed=resumedFailed,critical=0;const concurrency=workerCount(Math.max(1,universe.length-doneSet.size));job.symbolScanPolicy={sequential:false,concurrency,onePass:true,automaticSecondRound:false,capabilityRouted:true,providerOncePerSymbol:true,lanes:['HIST_RICH','LIVE_TIME','FUND_ON_DEMAND'],stagingFirst:true};await saveJob(job);
      const worker=async()=>{while(true){await pauseCheckpoint(job,JOB_STATUS.FETCHING_DATA);const idx=cursor++;if(idx>=universe.length)break;const sym=universe[idx];if(doneSet.has(sym))continue;const prior=state.recordMap.get(sym)||null,base=prior?bundleFromRecord(prior):null;let rec,success=false;
        try{const symbolStart=mode==='FULL'?start:(prior?.latestDate?dateBefore(prior.latestDate,14):start),onSource=({provider,status,lane})=>setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',done:completed,total:universe.length,validated,failed,message:`${sym} · ${lane||'DATA'} · ${sourceName(provider)}${status==='ERROR'?' başarısız':status==='EMPTY'?' boş/uygunsuz veri':status==='OK'?' doğrulandı':''}`,symbol:sym,provider});const bundle=await plannedBundle(sym,symbolStart,end,base,onSource,mode==='LIVE'?['Anlik','VeriZamani']:null);const usableAttempt=mode==='LIVE'?(bundle.r24Planner?.liveOk&&(bundle.attempts||[]).some(a=>a.status==='OK'&&a.lane==='LIVE')):(bundle.r24Planner?.historyOk&&(bundle.attempts||[]).some(a=>a.status==='OK'&&a.lane==='HIST'&&Number(a.bars||0)>=20));if(!usableAttempt)throw Object.assign(new Error(mode==='LIVE'?'NO_USABLE_LIVE_DATA_R24':'NO_USABLE_HISTORICAL_DATA_R24'),{code:'NO_USABLE_PROVIDER_DATA_R24'});let candidate=enrichBundle(mergeBundles(sym,[bundle]),indexBundle);try{candidate=globalThis.AurumIsYatirimCompanyCard?.attachCached?.(candidate,{allowStale:false})||candidate}catch{}const wc=job.canonicalMarketAt?marketWindowCheck(candidate,job.canonicalMarketAt):{ok:false,reason:'CANONICAL_MARKET_TIME_UNAVAILABLE',deltaMinutes:null};candidate=markCandidate(candidate,bundle,job,wc,'GENERAL');const vr=validateRecord(candidate,sym);if(!vr.ok)throw Object.assign(new Error(vr.issues.join(',')),{code:'RECORD_VALIDATION'});rec=candidate;success=true;if(!wc.ok)await issue(job,sym,'VeriZamani','ALL',wc.reason||'MARKET_TIME_WINDOW_UNAVAILABLE_DATA_KEPT',{marketAt:candidate.marketDataAt||null,canonicalMarketAt:job.canonicalMarketAt,deltaMinutes:wc.deltaMinutes});}
        catch(e){await issue(job,sym,'*','ALL','R24_PLANNED_FETCH_FAILED',e?.message||String(e));rec=makePlaceholder(sym,prior,[e?.code||e?.message||String(e)]);rec.unresolvedFields=prior?bundleRecordMissingFields(rec):['*'];rec.singlePassAttemptComplete=true;rec.singlePassMode='GENERAL';rec.singlePassAt=nowISO();if(!prior)critical++;}
        await stagePut(job.id,sym,rec);completed++;if(success)validated++;else failed++;job.processedSymbols=completed;job.validatedSymbols=validated;job.failedSymbols=failed;setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',done:completed,total:universe.length,validated,failed,message:success?`${sym} · doğrulanmış veri staging'e alındı`:`${sym} · kullanılabilir veri alınamadı`,symbol:sym,provider:null});if(completed%32===0)await saveJob(job);
      }};
      await Promise.all(Array.from({length:concurrency},worker));await flushStageBatch(job.id);if(!isOnline()){await transition(job,JOB_STATUS.WAITING_FOR_NETWORK,{error:'OFFLINE_AFTER_FETCH',message:'Ağ kesildi · staging korunuyor'});return false;}
      const staged=(await stageRows(job.id)).map(x=>x.record);
      const published=await atomicPublish(job,universe),summary=dataSummary(published),repairPlan=await persistPendingRepairPlan(published,universe);summary.transferredFreshSymbols=published.filter(x=>x?.jobDataStatus==='FRESH').length;summary.singlePass=true;summary.scheduler='R24_CAPABILITY_ROUTED';summary.automaticRepairRounds=0;summary.pendingRepair=repairPlan;summary.integrityGate=dataIntegrityGate(summary);job.dataSummary=summary;job.pendingRepair=repairPlan;job.sourceStats={...state.sourceStats};state.lastSuccessfulSync=nowISO();await dbPut('meta',{key:'lastSuccessfulSync',value:state.lastSuccessfulSync,updatedAt:state.lastSuccessfulSync});await dbPut('meta',{key:'lastDataSummary',value:summary,updatedAt:nowISO()});await persistLiveSnapshots(job.dataSnapshotId);await pruneSnapshots();await clearStage(job.id);await refreshTableMeta();await transition(job,JOB_STATUS.DATA_COMPLETED,{message:`Veri çekimi tamamlandı · ${summary.transferredFreshSymbols}/${universe.length} doğrulanmış · ${repairPlan.symbolCount} onarım bekliyor`,done:universe.length,total:universe.length,validated:summary.transferredFreshSymbols,failed:Math.max(0,universe.length-summary.transferredFreshSymbols)});return true;
    }catch(e){job.error=e?.message||String(e);if(!isOnline()||/network|offline|failed to fetch|ERR_/i.test(job.error))await transition(job,JOB_STATUS.WAITING_FOR_NETWORK,{error:job.error,message:'Ağ bağlantısı bekleniyor · staging korunuyor'});else await transition(job,JOB_STATUS.FAILED,{error:job.error,message:'Hızlı veri çekimi başarısız · önceki tablo korundu'});return false;}
    finally{try{await flushStageBatch(job.id)}catch{}state.settings.sourceRetryCount=restore.retry;state.settings.maxProvider429Retries=restore.r429;state.settings.requestTimeoutMs=restore.timeout;state.settings.providerConcurrency=restore.pc;state.syncing=false;clearCancel(job.id);renderCurrentPagePreservingView();}
  };

  prepareMissingData=async function prepareMissingDataR24(job){
    const plan=currentPendingRepairPlan(),targets=plan.items.map(x=>x.sym),fieldMap=new Map(plan.items.map(x=>[x.sym,(x.fullSymbol||!x.fields?.length)?['*']:x.fields]));job.totalSymbols=targets.length;job.currentStage='Veriler';job.requestedDataMode='REPAIR';await transition(job,JOB_STATUS.FETCHING_DATA,{message:targets.length?'Eksikleri tamamla · yalnız eksik veri grupları':'Eksik veri yok',done:0,total:targets.length});state.syncing=true;state.sourceStats={};await clearStage(job.id);
    const restore={retry:state.settings.sourceRetryCount,r429:state.settings.maxProvider429Retries,timeout:state.settings.requestTimeoutMs,pc:{...(state.settings.providerConcurrency||{})}};state.settings.sourceRetryCount=Math.max(1,Math.min(2,Number(state.settings.sourceRetryCount??1)));state.settings.maxProvider429Retries=Math.max(1,Math.min(2,Number(state.settings.maxProvider429Retries??1)));state.settings.requestTimeoutMs=Math.max(8000,Math.min(12000,Number(state.settings.requestTimeoutMs||9000)));state.settings.providerConcurrency={...(state.settings.providerConcurrency||{}),ISYATIRIM:12,ISYATIRIM_FINANCIALS:6,ISYATIRIM_LIVE:8,YAHOO:16,YAHOO_ALT:14,YAHOO_QUOTE:10,BIGPARA:12,BIGPARA_LIVE:10,FOREKS:8,STOOQ:8};
    try{if(!targets.length){await transition(job,JOB_STATUS.DATA_COMPLETED,{message:'Eksik hisse/hücre yok',done:0,total:0});return true;}if(!isOnline()){await transition(job,JOB_STATUS.WAITING_FOR_NETWORK,{error:'OFFLINE',message:'Ağ bağlantısı bekleniyor'});return false;}const end=new Date(),start=addMonths(end,-Number(state.settings.monthsBack||14));let indexBundle=(await dbGet('meta','indexBundle'))?.value||{bars:[]};const cp=await resolveCanonicalMarketPoint(start,end);if(cp?.timestampVerified&&safeTime(cp.at)!=null){job.canonicalMarketAt=cp.at;job.canonicalMarketProvider=cp.provider||'XU100';}await saveJob(job);
      let cursor=0,completed=0;const concurrency=workerCount(targets.length),worker=async()=>{while(true){await pauseCheckpoint(job,JOB_STATUS.FETCHING_DATA);const idx=cursor++;if(idx>=targets.length)break;const sym=targets[idx],prior=state.recordMap.get(sym)||null,fields=fieldMap.get(sym)||['*'],base=prior?bundleFromRecord(prior):null;let rec=prior?JSON.parse(JSON.stringify(prior)):makePlaceholder(sym,null,['REPAIR_TARGET_NO_PRIOR']);try{const deep=fields[0]==='*'||missingNeedsDeepHistory(fields),symbolStart=deep?start:(prior?.latestDate?dateBefore(prior.latestDate,14):start),onSource=({provider,status,lane})=>setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',done:completed,total:targets.length,message:`${sym} · ${lane||'REPAIR'} · ${sourceName(provider)}${status==='ERROR'?' başarısız':status==='EMPTY'?' boş/uygunsuz veri':status==='OK'?' doğrulandı':''}`,symbol:sym,provider});const bundle=await plannedBundle(sym,symbolStart,end,base,onSource,fields);if(!(bundle.attempts||[]).some(a=>a.status==='OK'))throw new Error('NO_PROVIDER_SUCCESS_R24_REPAIR');let candidate=enrichBundle(mergeBundles(sym,[bundle]),indexBundle);candidate=await enrichRepairFromCompanyCard(candidate,job,sym);const wc=job.canonicalMarketAt?marketWindowCheck(candidate,job.canonicalMarketAt):{ok:false,reason:'CANONICAL_MARKET_TIME_UNAVAILABLE',deltaMinutes:null};candidate=markCandidate(candidate,bundle,job,wc,'REPAIR');candidate.repairOnly=true;candidate.repairAttemptedAt=nowISO();const vr=validateRecord(candidate,sym);if(!vr.ok)throw new Error(vr.issues.join(','));const before=prior?bundleRecordMissingFields(prior):['*'],after=bundleRecordMissingFields(candidate);if(!prior||before[0]==='*'||after.length<before.length||prior.jobDataStatus!=='FRESH')rec=candidate;else{rec=JSON.parse(JSON.stringify(prior));rec.repairAttemptedAt=nowISO();rec.repairLastError='Yeni eksik hücre kazanımı olmadı';rec.singlePassAttemptComplete=true;rec.singlePassMode='REPAIR';rec.singlePassAt=nowISO();}}catch(e){await issue(job,sym,'*','ALL','R24_TARGETED_REPAIR_FAILED',e?.message||String(e));if(prior){rec=JSON.parse(JSON.stringify(prior));rec.repairAttemptedAt=nowISO();rec.repairLastError=e?.message||String(e);}rec.singlePassAttemptComplete=true;rec.singlePassMode='REPAIR';rec.singlePassAt=nowISO();}await stagePut(job.id,sym,rec);completed++;job.processedSymbols=completed;if(completed%48===0)await saveJob(job);}};await Promise.all(Array.from({length:concurrency},worker));await flushStageBatch(job.id);if(!isOnline()){await transition(job,JOB_STATUS.WAITING_FOR_NETWORK,{error:'OFFLINE_AFTER_REPAIR',message:'Ağ kesildi · staging korunuyor'});return false;}const result=await atomicRepairPublish(job,targets),summary=dataSummary(result.records);summary.pendingRepair=result.plan;summary.scheduler='R24_CAPABILITY_ROUTED_REPAIR';summary.integrityGate=dataIntegrityGate(summary);job.dataSummary=summary;job.pendingRepair=result.plan;await dbPut('meta',{key:'lastDataSummary',value:summary,updatedAt:nowISO()});await clearStage(job.id);await refreshTableMeta();await transition(job,JOB_STATUS.DATA_COMPLETED,{message:`Eksik tamamlama bitti · ${targets.length} hedef · ${result.plan.symbolCount} eksik kaldı`,done:targets.length,total:targets.length});return true;
    }catch(e){job.error=e?.message||String(e);if(!isOnline()||/network|offline|failed to fetch|ERR_/i.test(job.error))await transition(job,JOB_STATUS.WAITING_FOR_NETWORK,{error:job.error,message:'Ağ bağlantısı bekleniyor · staging korunuyor'});else await transition(job,JOB_STATUS.FAILED,{error:job.error,message:'Eksik tamamlama başarısız · mevcut tablo korundu'});return false;}finally{try{await flushStageBatch(job.id)}catch{}state.settings.sourceRetryCount=restore.retry;state.settings.maxProvider429Retries=restore.r429;state.settings.requestTimeoutMs=restore.timeout;state.settings.providerConcurrency=restore.pc;state.syncing=false;clearCancel(job.id);renderCurrentPagePreservingView();}
  };
  globalThis.prepareGeneralData=prepareGeneralData;globalThis.prepareMissingData=prepareMissingData;
  queueMicrotask(async()=>{try{state.settings.sourceRetryCount=Math.max(1,Math.min(2,Number(state.settings.sourceRetryCount??1)));state.settings.maxProvider429Retries=Math.max(1,Math.min(2,Number(state.settings.maxProvider429Retries??1)));state.settings.symbolRepairRounds=Math.max(1,Number(state.settings.symbolRepairRounds||1));state.settings.providerWaveSize=8;state.settings.concurrency=Math.max(56,Number(state.settings.concurrency||56));state.settings.maxGlobalConcurrency=Math.max(56,Number(state.settings.maxGlobalConcurrency||56));state.settings.stageBatchSize=Math.max(384,Number(state.settings.stageBatchSize||384));state.settings.stageFlushMs=1;state.settings.adaptiveConcurrency=true;state.settings.providerHealthAdaptive=true;await saveSettings();try{AurumUpdateAPI.state.r24={version:'REV20.3-HYBRID-FAST-QUALITY',activatedAt:nowISO(),features:['AURUMB_FAST_SHARDED_WORKERS','48_PLUS_GLOBAL_WORKERS','LARGE_STAGING_BATCH','FAST_STAGE_FLUSH','HIGH_PROVIDER_PARALLELISM','SEMANTIC_PROVIDER_PAYLOAD_VALIDATION','HISTORICAL_DATA_REQUIRED_FOR_FRESH','HTTP_RETRY_PRESERVED','EMPTY_PAYLOAD_NOT_SUCCESS','STAGING_FIRST_PRESERVED','ATOMIC_PUBLISH_PRESERVED','TARGETED_REPAIR_ONLY','QUALITY_VALIDATION_PRESERVED','NATIVE_HTTP_PRESERVED']}}catch{}}catch{}});
})();

/* R26 — Kn/K_Tarihsel render isolation + persistent GLN/GDN semantics.
   - A history read failure must never blank Kn or K_Tarihsel pages.
   - First valid Top20 is visible as GLN baseline.
   - Thereafter GLN changes only on incoming, GDN only on outgoing; unchanged side persists. */
(function installR26HistoryAndChangePersistence(){
  if(globalThis.AURUM_R26_HISTORY_GLN_GDN==='R26.0')return;
  globalThis.AURUM_R26_HISTORY_GLN_GDN='R26.0';

  function r26EmptyCriterionMap(){const o={};for(const k of KN_V117_ORDER)o[k]=[];return o;}
  function r26EmptySummaryMap(){const o={};for(const k of KN_V117_ORDER)o[k]={hitCount:0,total:20,realAvg:null,knAvg:null};return o;}
  function r26FallbackT0(){
    const a=kh117ArchiveState();
    if(a?.live?.date)return {...kh117CloneValue(a.live),_label:'T0',_t0:true};
    return {date:(state.records||[]).map(r=>r?.latestDate).filter(Boolean).sort().slice(-1)[0]||trParts().date,provisional:true,reelTop20:[],criteria:r26EmptyCriterionMap(),summaries:r26EmptySummaryMap(),trend:[],marketTime:TABLE_META?.data?.market||TABLE_META?.data?.transfer||null,_label:'T0',_t0:true};
  }
  function r26SafeRows(){
    try{const rows=kh117Rows();if(Array.isArray(rows)&&rows.length)return rows;}catch(e){try{console.warn('R26 kh117Rows fallback',e)}catch{}}
    const a=kh117ArchiveState(),t0=r26FallbackT0(),arch=(a?.rows||[]).slice().sort((x,y)=>String(y?.date||'').localeCompare(String(x?.date||''))).filter(x=>x?.date&&x.date!==t0.date).slice(0,30);
    return [t0,...arch.map((r,i)=>({...kh117CloneValue(r),_label:`T${i+1}`,_t0:false}))];
  }
  kh117HistoricalHitAverage=function kh117HistoricalHitAverageR26(k){
    const rows=r26SafeRows().filter(x=>!x._t0).slice(0,30),hits=rows.map(r=>Number(r?.summaries?.[k]?.hitCount)).filter(Number.isFinite);
    return {avg:hits.length?mean(hits):null,n:hits.length,total:20};
  };
  globalThis.kh117HistoricalHitAverage=kh117HistoricalHitAverage;

  function r26SafeCell(fn,row,...rest){try{return fn(row,...rest)}catch(e){return `<div class="kh-cell"><span class="muted">Veri okunamadı</span></div>`}}
  function r26HistoryHtml(){
    const rows=r26SafeRows();
    return `<div class="section-head"><h2 class="aurum-khist-daily-title">K_Tarihsel günlük karşılaştırma</h2><small>T0 canlı · T1–T30 kilitli görünüm</small></div><div class="table-wrap aurum-drive-table strict-history r51-history"><table><thead><tr><th>Gün</th><th>Kn_Trend<br><small>1G | 10G | 21G</small></th><th>Reel TopN<br><small>SYM(1G | 10G | 21G)</small></th>${KN_V117_ORDER.map(k=>`<th>${k} TopN<br><small>SYM(1G | 10G | 21G)</small></th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr><td class="kh-day"><b>${html(r._label||'—')}</b><small>${html(r.date||'—')}<br>${r._t0?'CANLI':'KESİN'}</small></td><td>${r26SafeCell(kh117TrendCell,r)}</td><td>${r26SafeCell(kh117ReelCell,r)}</td>${KN_V117_ORDER.map(k=>`<td>${r26SafeCell(kh117CriterionCell,r,k)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  kh117Render=r26HistoryHtml;
  kh117RenderDeferred=r26HistoryHtml;
  try{const old=globalThis.AurumKnHistoryV117||{};globalThis.AurumKnHistoryV117=Object.freeze({...old,version:'R26.0-safe-history',rows:r26SafeRows,renderHistory:r26HistoryHtml,renderHistoryDeferred:r26HistoryHtml});}catch{}

  /* First valid full set becomes visible GLN baseline; later only the changed side moves. */
  const r26LedgerBase=kn117UpdateLedger;
  kn117UpdateLedger=function kn117UpdateLedgerR26(at=nowISO()){
    const out=r26LedgerBase(at),topN=Math.max(20,Number(state?.settings?.topN||20));
    for(const k of KN_V117_ORDER){
      const c=out.changes[k]||{gln:null,gdn:null,baselineAt:null},activeSyms=Object.keys(out.active?.[k]||{}).slice(0,topN);
      if(activeSyms.length>=20&&!c.gln?.symbols?.length){c.gln={symbols:activeSyms,at:c.baselineAt||at,baseline:true};c.baselineAt=c.baselineAt||at;}
      out.changes[k]=c;
    }
    return kn117WriteLedger(out);
  };
  globalThis.kn117UpdateLedger=kn117UpdateLedger;

  /* Migrate an already-installed baseline immediately, without inventing a GDN. */
  function r26MigrateLedger(){
    try{const l=kn117ReadLedger(),at=nowISO();let dirty=false;for(const k of KN_V117_ORDER){const c=l.changes[k]||{gln:null,gdn:null,baselineAt:null},syms=Object.keys(l.active?.[k]||{});if(syms.length>=20&&!c.gln?.symbols?.length){c.gln={symbols:syms.slice(0,Math.max(20,Number(state?.settings?.topN||20))),at:c.baselineAt||at,baseline:true};c.baselineAt=c.baselineAt||at;l.changes[k]=c;dirty=true;}}if(dirty)kn117WriteLedger(l);}catch{}
  }

  /* S follows the same independent-side persistence rule. */
  const r26CalculateSBase=calculateS;
  calculateS=async function calculateSR26(job){
    const ok=await r26CalculateSBase(job);if(!ok)return ok;
    try{
      const row=await dbGet('meta','selectionSnapshot'),snap=row?.value||{},symbols=Array.isArray(snap.symbols)?snap.symbols:[];
      if(symbols.length>=20&&(!Array.isArray(snap.gln)||!snap.gln.length)){
        const at=snap.glnChangedAt||snap.transferredAt||snap.at||nowISO();snap.gln=symbols.slice();snap.glnChangedAt=at;snap.glnBaseline=true;snap.glnGdnBasis='INDEPENDENT_LAST_REAL_CHANGE_PERSISTED';
        await dbPut('meta',{key:'selectionSnapshot',value:snap,updatedAt:nowISO()});
        state.tableMetrics=state.tableMetrics||{};state.tableMetrics.s={...(state.tableMetrics.s||{}),gln:snap.gln.join(' · '),gdn:Array.isArray(snap.gdn)&&snap.gdn.length?snap.gdn.join(' · '):(state.tableMetrics.s?.gdn||'—'),glnChangedAt:snap.glnChangedAt,gdnChangedAt:snap.gdnChangedAt||state.tableMetrics.s?.gdnChangedAt||null};
      }
    }catch{}
    return ok;
  };
  globalThis.calculateS=calculateS;

  /* Render guards: a history auxiliary failure cannot blank the page shell. */
  const r26CriteriaBase=criteriaPage;
  criteriaPage=function criteriaPageR26(){try{return r26CriteriaBase()}catch(e){try{console.error('R26 criteria render',e)}catch{} const buttons=`<button class="gold-btn" onclick="AurumRuntime.manualKn()" ${state.syncing||state.calculating?'disabled':''}>Kn’yi Çalıştır</button>`;return `${operationBlock('kn',buttons)}<div data-aurum-explicit-time>${tableTimePanel('kn')}<div id="knMetricBundle"></div><div class="section-head"><div class="section-title"><h2>Kn Kriter Tabloları</h2></div></div>${AurumKnHistoryV117.renderCriteriaBody()}</div>`;}};
  const r26HistoryBase=historyPage;
  historyPage=function historyPageR26(){try{return r26HistoryBase()}catch(e){try{console.error('R26 history render',e)}catch{} const buttons=`<button class="gold-btn" onclick="AurumRuntime.manualHistorical()" ${state.syncing||state.calculating?'disabled':''}>K_Tarihsel’i Çalıştır</button>`;return `${operationBlock('history',buttons)}${r26HistoryHtml()}`;}};

  queueMicrotask(()=>{r26MigrateLedger();try{renderCurrentPagePreservingView()}catch{}});
  try{AurumUpdateAPI.state.r26HistoryGlnGdn={version:'R26.0',activatedAt:new Date().toISOString(),features:['HISTORY_RENDER_ISOLATION','KN_PAGE_RENDER_GUARD','FIRST_TOP20_AS_GLN','INDEPENDENT_GLN_GDN_PERSIST','S_BASELINE_GLN']};}catch{}
})();

/* R27 — K_Tarihsel deterministic symmetric grid.
   One renderer for T0 and T1–T30. Each Reel/Kn cell has fixed HİSSE | 1G | 10G | 21G subcolumns.
   No cross-cell overflow; archived rows retain available triple returns when known. */
(function installR27HistoryGrid(){
  if(globalThis.AURUM_R27_HISTORY_GRID==='R27.0')return;
  globalThis.AURUM_R27_HISTORY_GRID='R27.0';

  function r27N(v){const n=Number(v);return Number.isFinite(n)&&n>-99.5?n:null;}
  function r27LatestDate(){return (state.records||[]).map(r=>r?.latestDate||r?.series?.date?.at?.(-1)).filter(Boolean).sort().slice(-1)[0]||null;}
  function r27Triple(row,item){
    const sym=String(item?.sym||'').trim(),rec=state.recordMap?.get(sym)||null;
    let t={r1:r27N(item?.r1),r10:r27N(item?.r10),r21:r27N(item?.r21)};
    try{if(rec){const x=kh117Triple(rec,row?.date);t={r1:t.r1??r27N(x?.r1),r10:t.r10??r27N(x?.r10),r21:t.r21??r27N(x?.r21)};}}catch{}
    t.r1=t.r1??r27N(item?.dayReturn)??r27N(item?.ret);
    /* Current T0 may safely use the already-computed current record traits as fallback.
       Historical rows never borrow today's 10G/21G values. */
    if(row?._t0||String(row?.date||'')===String(r27LatestDate()||'')){
      const f=rec?.genome?.features||rec?.genomeFeatures||rec?.features||{};
      t.r1=t.r1??r27N(rec?.ret1d)??r27N(f?.ret1d);
      t.r10=t.r10??r27N(rec?.ret10d)??r27N(f?.ret10d);
      t.r21=t.r21??r27N(rec?.ret21d)??r27N(f?.ret21d);
    }
    return t;
  }
  function r27Pct(v){return v==null?'—':kn117Pct(v);}
  function r27Rows20(items,row,{hit=false}={}){
    const arr=(items||[]).slice(0,20),out=[];
    for(let i=0;i<20;i++){
      const x=arr[i];
      if(!x){out.push(`<div class="khv27-data-row khv27-placeholder"><span>—</span><span>—</span><span>—</span><span>—</span></div>`);continue;}
      const t=r27Triple(row,x),cls=(hit&&x.realHit)?' khv27-hit':'';
      out.push(`<div class="khv27-data-row${cls}"><span class="khv27-symbol">${html(x.sym||'—')}</span><span>${html(r27Pct(t.r1))}</span><span>${html(r27Pct(t.r10))}</span><span>${html(r27Pct(t.r21))}</span></div>`);
    }
    return out.join('');
  }
  function r27DataHead(){return `<div class="khv27-subhead"><span>HİSSE</span><span>1G</span><span>10G</span><span>21G</span></div>`;}

  const r27BaseT0=kh117T0;
  kh117T0=function kh117T0R27(){
    const row=r27BaseT0();
    try{
      for(const k of KN_V117_ORDER)for(const x of (row.criteria?.[k]||[])){const t=r27Triple({...row,_t0:true},x);x.r1=t.r1;x.r10=t.r10;x.r21=t.r21;}
      for(const x of (row.reelTop20||[])){const t=r27Triple({...row,_t0:true},x);x.r1=t.r1;x.r10=t.r10;x.r21=t.r21;}
    }catch{}
    return row;
  };
  globalThis.kh117T0=kh117T0;

  kh117TrendCell=function kh117TrendCellR27(row){
    let sets={r1:[],r10:[],r21:[]};try{sets=kh117ReelSets(row.date)}catch{}
    const s1=new Set((sets.r1||[]).map(x=>x.sym)),s10=new Set((sets.r10||[]).map(x=>x.sym)),s21=new Set((sets.r21||[]).map(x=>x.sym));
    const body=KN_V117_ORDER.map(k=>{const syms=(row.criteria?.[k]||[]).slice(0,20).map(x=>x.sym);return `<div class="khv27-trend-row"><b>${html(k)}</b><span>${syms.filter(x=>s1.has(x)).length}/20</span><span>${syms.filter(x=>s10.has(x)).length}/20</span><span>${syms.filter(x=>s21.has(x)).length}/20</span></div>`}).join('');
    return `<div class="khv27-trend"><div class="khv27-trend-head"><span>Kn</span><span>1G</span><span>10G</span><span>21G</span></div>${body}<footer><span>Reel Top20 kesişimi</span><span>${html(kn117Time(kh117RowTime(row)))}</span></footer></div>`;
  };
  globalThis.kh117TrendCell=kh117TrendCell;

  kh117ReelCell=function kh117ReelCellR27(row){
    let a=[];try{a=(kh117ReelSets(row.date)?.r1||[]).slice(0,20)}catch{}
    if(!a.length&&Array.isArray(row?.reelTop20))a=row.reelTop20.slice(0,20);
    return `<div class="khv27-cell khv27-reel">${r27DataHead()}${r27Rows20(a,row)}<footer><span>1G · 10G · 21G Reel Top20</span><span>${html(kn117Time(kh117RowTime(row)))}</span></footer></div>`;
  };
  globalThis.kh117ReelCell=kh117ReelCell;

  kh117CriterionCell=function kh117CriterionCellR27(row,k){
    const a=(row.criteria?.[k]||[]).slice(0,20),s=row.summaries?.[k]||{};
    return `<div class="khv27-cell khv27-kn">${r27DataHead()}${r27Rows20(a,row,{hit:true})}<footer><span>İsabet: ${Number(s.hitCount||0)}/${a.length||20} · Reel Ort: ${html(kn117Pct(s.realAvg))}</span><span>Kn Ort: ${html(kn117Pct(s.knAvg))} · ${html(kn117Time(kh117RowTime(row)))}</span></footer></div>`;
  };
  globalThis.kh117CriterionCell=kh117CriterionCell;

  function r27SafeRows(){
    try{if(globalThis.AurumKnHistoryV117?.rows){const x=globalThis.AurumKnHistoryV117.rows();if(Array.isArray(x)&&x.length)return x;}}catch{}
    try{const x=kh117Rows();if(Array.isArray(x)&&x.length)return x;}catch{}
    return [];
  }
  function r27SafeCell(fn,row,...args){try{return fn(row,...args)}catch(e){return `<div class="khv27-cell khv27-error">Veri okunamadı</div>`;}}
  function r27HistoryHtml(){
    const rows=r27SafeRows(),cols=`<col class="khv27-day-col"><col class="khv27-trend-col"><col class="khv27-data-col">${KN_V117_ORDER.map(()=>'<col class="khv27-data-col">').join('')}`;
    const body=rows.map(r=>`<tr><td class="kh-day"><b>${html(r._label||'—')}</b><small>${html(r.date||'—')}<br>${r._t0?'CANLI':'KESİN'}</small></td><td>${r27SafeCell(kh117TrendCell,r)}</td><td>${r27SafeCell(kh117ReelCell,r)}</td>${KN_V117_ORDER.map(k=>`<td>${r27SafeCell(kh117CriterionCell,r,k)}</td>`).join('')}</tr>`).join('');
    return `<div class="section-head"><h2 class="aurum-khist-daily-title">K_Tarihsel günlük karşılaştırma</h2><small>T0 canlı · T1–T30 aynı sabit ızgara</small></div><div class="table-wrap aurum-drive-table strict-history r51-history khv27-history"><table><colgroup>${cols}</colgroup><thead><tr><th>Gün</th><th>Kn Trend<br><small>Kesişim / 20</small></th><th>REEL TOPN<br><small>HİSSE | 1G | 10G | 21G</small></th>${KN_V117_ORDER.map(k=>`<th>${k} TOPN<br><small>HİSSE | 1G | 10G | 21G</small></th>`).join('')}</tr></thead><tbody>${body||'<tr><td colspan="15">K_Tarihsel henüz oluşturulmadı.</td></tr>'}</tbody></table></div>`;
  }
  kh117Render=r27HistoryHtml;kh117RenderDeferred=r27HistoryHtml;
  globalThis.kh117Render=kh117Render;globalThis.kh117RenderDeferred=kh117RenderDeferred;

  /* Force the history page to use only this renderer, including T1–T30. */
  const r27HistoryBase=historyPage;
  historyPage=function historyPageR27(){
    try{
      const raw=r27HistoryBase();
      /* Existing page shell may contain the old table. Replace only the historical comparison block. */
      const marker='<div class="section-head"><h2 class="aurum-khist-daily-title">K_Tarihsel günlük karşılaştırma</h2>';
      const ix=String(raw||'').indexOf(marker);
      if(ix>=0){const prefix=String(raw).slice(0,ix);return prefix+r27HistoryHtml();}
    }catch{}
    const buttons=`<button class="gold-btn" onclick="AurumRuntime.manualHistorical()" ${state.syncing||state.calculating?'disabled':''}>K_Tarihsel’i Çalıştır</button>`;
    return `${operationBlock('history',buttons)}${tableTimePanel('history')||''}${r27HistoryHtml()}`;
  };
  globalThis.historyPage=historyPage;

  queueMicrotask(()=>{try{renderCurrentPagePreservingView()}catch{}});
  try{AurumUpdateAPI.state.r27HistoryGrid={version:'R27.0',activatedAt:new Date().toISOString(),features:['FIXED_OUTER_COLGROUP','FIXED_INNER_4_COL_GRID','NO_CROSS_CELL_OVERFLOW','UNIFORM_T0_T1_T30_RENDERER','TRIPLE_RETURN_SNAPSHOT_FALLBACK','20_ROW_SYMMETRY']};}catch{}
})();


/* R28 — K_Tarihsel non-blocking symmetric grid.
   Fixes R27 double-render and main-thread freeze without changing the visual/data contract.
   Rows are rendered incrementally and expensive date/symbol return lookups are cached per render. */
(function installR28HistoryNonBlocking(){
  if(globalThis.AURUM_R28_HISTORY_NONBLOCK==='R28.0')return;
  globalThis.AURUM_R28_HISTORY_NONBLOCK='R28.0';
  let token=0, tripleCache=new Map(), reelCache=new Map();
  const n=v=>{const x=Number(v);return Number.isFinite(x)&&x>-99.5?x:null};
  const pct=v=>v==null?'—':kn117Pct(v);
  const yieldWork=fn=>{try{if('requestIdleCallback'in globalThis)return requestIdleCallback(fn,{timeout:80})}catch{};return setTimeout(fn,0)};
  function rows(){
    try{const x=globalThis.AurumKnHistoryV117?.rows?.();if(Array.isArray(x))return x}catch{}
    try{const x=kh117Rows();if(Array.isArray(x))return x}catch{}
    return [];
  }
  function latestDate(){return (state.records||[]).map(r=>r?.latestDate||r?.series?.date?.at?.(-1)).filter(Boolean).sort().slice(-1)[0]||null}
  function triple(row,item){
    const sym=String(item?.sym||'').trim(),date=String(row?.date||''),key=date+'|'+sym;
    const direct={r1:n(item?.r1)??n(item?.dayReturn)??n(item?.ret),r10:n(item?.r10),r21:n(item?.r21)};
    let cached=tripleCache.get(key);
    if(!cached){
      const rec=state.recordMap?.get(sym)||null; let t={r1:null,r10:null,r21:null};
      try{if(rec){const x=kh117Triple(rec,date);t={r1:n(x?.r1),r10:n(x?.r10),r21:n(x?.r21)}}}catch{}
      if(row?._t0||date===String(latestDate()||'')){
        const f=rec?.genome?.features||rec?.genomeFeatures||rec?.features||{};
        t.r1=t.r1??n(rec?.ret1d)??n(f?.ret1d);t.r10=t.r10??n(rec?.ret10d)??n(f?.ret10d);t.r21=t.r21??n(rec?.ret21d)??n(f?.ret21d);
      }
      cached=t;tripleCache.set(key,t);
    }
    return {r1:direct.r1??cached.r1,r10:direct.r10??cached.r10,r21:direct.r21??cached.r21};
  }
  function reelSets(row){const d=String(row?.date||'');if(reelCache.has(d))return reelCache.get(d);let x={r1:[],r10:[],r21:[]};try{x=kh117ReelSets(d)||x}catch{}reelCache.set(d,x);return x}
  const head=()=>`<div class="khv27-subhead"><span>HİSSE</span><span>1G</span><span>10G</span><span>21G</span></div>`;
  function dataRows(items,row,hit){const a=(items||[]).slice(0,20),o=[];for(let i=0;i<20;i++){const x=a[i];if(!x){o.push('<div class="khv27-data-row khv27-placeholder"><span>—</span><span>—</span><span>—</span><span>—</span></div>');continue}const t=triple(row,x),c=hit&&x.realHit?' khv27-hit':'';o.push(`<div class="khv27-data-row${c}"><span class="khv27-symbol">${html(x.sym||'—')}</span><span>${html(pct(t.r1))}</span><span>${html(pct(t.r10))}</span><span>${html(pct(t.r21))}</span></div>`)}return o.join('')}
  function trend(row){const rs=reelSets(row),s1=new Set((rs.r1||[]).map(x=>x.sym)),s10=new Set((rs.r10||[]).map(x=>x.sym)),s21=new Set((rs.r21||[]).map(x=>x.sym));const b=KN_V117_ORDER.map(k=>{const syms=(row.criteria?.[k]||[]).slice(0,20).map(x=>x.sym);return `<div class="khv27-trend-row"><b>${html(k)}</b><span>${syms.filter(x=>s1.has(x)).length}/20</span><span>${syms.filter(x=>s10.has(x)).length}/20</span><span>${syms.filter(x=>s21.has(x)).length}/20</span></div>`}).join('');return `<div class="khv27-trend"><div class="khv27-trend-head"><span>Kn</span><span>1G</span><span>10G</span><span>21G</span></div>${b}<footer><span>Reel Top20 kesişimi</span><span>${html(kn117Time(kh117RowTime(row)))}</span></footer></div>`}
  function reel(row){let a=(reelSets(row).r1||[]).slice(0,20);if(!a.length&&Array.isArray(row?.reelTop20))a=row.reelTop20.slice(0,20);return `<div class="khv27-cell khv27-reel">${head()}${dataRows(a,row,false)}<footer><span>1G · 10G · 21G Reel Top20</span><span>${html(kn117Time(kh117RowTime(row)))}</span></footer></div>`}
  function crit(row,k){const a=(row.criteria?.[k]||[]).slice(0,20),s=row.summaries?.[k]||{};return `<div class="khv27-cell khv27-kn">${head()}${dataRows(a,row,true)}<footer><span>İsabet: ${Number(s.hitCount||0)}/${a.length||20} · Reel Ort: ${html(kn117Pct(s.realAvg))}</span><span>Kn Ort: ${html(kn117Pct(s.knAvg))} · ${html(kn117Time(kh117RowTime(row)))}</span></footer></div>`}
  function safe(fn,...a){try{return fn(...a)}catch(e){try{console.error('R28 history cell',e)}catch{}return '<div class="khv27-cell khv27-error">Veri okunamadı</div>'}}
  function rowHtml(r){return `<td class="kh-day"><b>${html(r._label||'—')}</b><small>${html(r.date||'—')}<br>${r._t0?'CANLI':'KESİN'}</small></td><td>${safe(trend,r)}</td><td>${safe(reel,r)}</td>${KN_V117_ORDER.map(k=>`<td>${safe(crit,r,k)}</td>`).join('')}`}
  function pump(myToken,rs,i){if(myToken!==token)return;const body=document.getElementById('khR28Body');if(!body)return;if(i===0)body.replaceChildren();if(i>=rs.length){body.dataset.ready='1';if(!rs.length)body.innerHTML='<tr><td colspan="15">K_Tarihsel henüz oluşturulmadı.</td></tr>';return}const tr=document.createElement('tr');tr.innerHTML=rowHtml(rs[i]);body.appendChild(tr);yieldWork(()=>pump(myToken,rs,i+1))}
  function shell(){
    const my=++token;tripleCache=new Map();reelCache=new Map();const rs=rows(),cols=`<col class="khv27-day-col"><col class="khv27-trend-col"><col class="khv27-data-col">${KN_V117_ORDER.map(()=>'<col class="khv27-data-col">').join('')}`;
    requestAnimationFrame(()=>pump(my,rs,0));
    return `<div class="section-head"><h2 class="aurum-khist-daily-title">K_Tarihsel günlük karşılaştırma</h2><small>T0 canlı · T1–T30 aynı sabit ızgara</small></div><div class="table-wrap aurum-drive-table strict-history r51-history khv27-history"><table><colgroup>${cols}</colgroup><thead><tr><th>Gün</th><th>Kn Trend<br><small>Kesişim / 20</small></th><th>REEL TOPN<br><small>HİSSE | 1G | 10G | 21G</small></th>${KN_V117_ORDER.map(k=>`<th>${k} TOPN<br><small>HİSSE | 1G | 10G | 21G</small></th>`).join('')}</tr></thead><tbody id="khR28Body"><tr class="kh-r28-loading"><td colspan="15">K_Tarihsel hazırlanıyor…</td></tr></tbody></table></div>`;
  }
  function historyPageR28(){
    const seedDone=(()=>{try{return kh117ArchiveState()?.seed?.completed===true&&kh117NormalizeArchiveRows(kh117ArchiveState()?.rows,kh117T0()?.date).length>=30}catch{return false}})();
    const buttons=`<button class="gold-btn" onclick="AurumRuntime.manualHistorical()" ${state.syncing||state.calculating?'disabled':''}>K_Tarihsel’i Çalıştır</button><button class="ghost-btn" onclick="AurumKnHistoryV117.seedPIT30().catch(e=>showAurumNotice(e.message,'error',4600))" ${state.syncing||state.calculating||seedDone?'disabled':''}>${seedDone?'Başlangıç T1–T30 Kilitli':'Başlangıç T1–T30’u Doldur'}</button>`;
    let block='';try{block=integrityBlockedMarkup('K_Tarihsel')||''}catch{}
    return `${operationBlock('history',buttons)}${block||`${tableTimePanel('history')||''}${shell()}`}`;
  }
  kh117Render=shell;kh117RenderDeferred=shell;globalThis.kh117Render=kh117Render;globalThis.kh117RenderDeferred=kh117RenderDeferred;
  historyPage=historyPageR28;globalThis.historyPage=historyPage;
  try{AurumUpdateAPI.state.r28HistoryNonBlocking={version:'R28.0',activatedAt:new Date().toISOString(),features:['NO_DOUBLE_RENDER','ONE_HISTORY_ROW_PER_IDLE_SLICE','DATE_SYMBOL_TRIPLE_CACHE','REEL_SET_CACHE','SAME_R27_GRID','T0_T1_T30_NONBLOCKING']}}catch{}
})();

/* R29 — K_Tarihsel classic return contract restored.
   Removes 10G/21G display from history. Kn cells show only HİSSE | REEL GETİRİ | KN GETİRİ.
   Keeps R28 non-blocking incremental rendering and fixed symmetric geometry for T0 + T1–T30. */
(function installR29HistoryClassicReturns(){
  if(globalThis.AURUM_R29_HISTORY_CLASSIC==='R29.0')return;
  globalThis.AURUM_R29_HISTORY_CLASSIC='R29.0';
  let token=0;
  const yieldWork=fn=>{try{if('requestIdleCallback'in globalThis)return requestIdleCallback(fn,{timeout:80})}catch{};return setTimeout(fn,0)};
  const rows=()=>{try{const x=globalThis.AurumKnHistoryV117?.rows?.();if(Array.isArray(x))return x}catch{};try{const x=kh117Rows();if(Array.isArray(x))return x}catch{}return []};
  const p=v=>{const n=Number(v);return Number.isFinite(n)&&n>-99.5?kn117Pct(n):'—'};
  const rowTime=r=>{try{return kn117Time(kh117RowTime(r))}catch{return '—'}};
  function trend(r){
    const a=Array.isArray(r?.trend)&&r.trend.length?r.trend:KN_V117_ORDER.map(k=>({k,hitCount:Number(r?.summaries?.[k]?.hitCount||0),total:20}));
    const body=KN_V117_ORDER.map(k=>{const x=a.find(y=>String(y?.k)===k)||{};return `<div class="khv29-trend-row"><b>${html(k)}</b><span>${Number(x.hitCount||0)}/${Number(x.total||20)}</span></div>`}).join('');
    const rates=a.map(x=>Number(x.total||20)>0?100*Number(x.hitCount||0)/Number(x.total||20):null).filter(Number.isFinite);
    return `<div class="khv29-trend"><div class="khv29-trend-head"><span>Kn</span><span>İsabet</span></div>${body}<footer><span>İsabet ort: ${rates.length?html(fmt(mean(rates),1)+'%'):'—'}</span><span>${html(rowTime(r))}</span></footer></div>`;
  }
  function reel(r){
    const a=(r?.reelTop20||[]).slice(0,20),out=[];
    for(let i=0;i<20;i++){const x=a[i];out.push(x?`<div class="khv29-reel-row"><span class="khv29-symbol">${html(x.sym||'—')}</span><span>${html(p(x.ret??x.dayReturn??x.realReturn))}</span></div>`:`<div class="khv29-reel-row khv29-placeholder"><span>—</span><span>—</span></div>`)}
    const avg=mean(a.map(x=>Number(x?.ret??x?.dayReturn??x?.realReturn)).filter(Number.isFinite));
    return `<div class="khv29-cell khv29-reel"><div class="khv29-reel-head"><span>HİSSE</span><span>REEL</span></div>${out.join('')}<footer><span>Reel Ort: ${html(p(avg))}</span><span>${html(rowTime(r))}</span></footer></div>`;
  }
  function crit(r,k){
    const a=(r?.criteria?.[k]||[]).slice(0,20),s=r?.summaries?.[k]||{},out=[];
    for(let i=0;i<20;i++){
      const x=a[i];
      if(!x){out.push('<div class="khv29-data-row khv29-placeholder"><span>—</span><span>—</span><span>—</span></div>');continue}
      const real=x.dayReturn??x.ret??x.realReturn??null,kn=x.knReturn??x.returnAvg??x.avgReturn??null,c=x.realHit?' khv29-hit':'';
      out.push(`<div class="khv29-data-row${c}"><span class="khv29-symbol">${html(x.sym||'—')}</span><span>${html(p(real))}</span><span>${html(p(kn))}</span></div>`);
    }
    return `<div class="khv29-cell khv29-kn"><div class="khv29-data-head"><span>HİSSE</span><span>REEL</span><span>KN</span></div>${out.join('')}<footer><span>İsabet: ${Number(s.hitCount||0)}/${a.length||20} · Reel Ort: ${html(p(s.realAvg))}</span><span>Kn Ort: ${html(p(s.knAvg))} · ${html(rowTime(r))}</span></footer></div>`;
  }
  function safe(fn,...a){try{return fn(...a)}catch(e){try{console.error('R29 history cell',e)}catch{}return '<div class="khv29-cell khv29-error">Veri okunamadı</div>'}}
  function rowHtml(r){return `<td class="kh-day"><b>${html(r?._label||'—')}</b><small>${html(r?.date||'—')}<br>${r?._t0?'CANLI':'KESİN'}</small></td><td>${safe(trend,r)}</td><td>${safe(reel,r)}</td>${KN_V117_ORDER.map(k=>`<td>${safe(crit,r,k)}</td>`).join('')}`}
  function pump(my,rs,i){if(my!==token)return;const body=document.getElementById('khR29Body');if(!body)return;if(i===0)body.replaceChildren();if(i>=rs.length){body.dataset.ready='1';if(!rs.length)body.innerHTML='<tr><td colspan="15">K_Tarihsel henüz oluşturulmadı.</td></tr>';return}const tr=document.createElement('tr');tr.innerHTML=rowHtml(rs[i]);body.appendChild(tr);yieldWork(()=>pump(my,rs,i+1))}
  function shell(){
    const my=++token,rs=rows(),cols=`<col class="khv29-day-col"><col class="khv29-trend-col"><col class="khv29-reel-col">${KN_V117_ORDER.map(()=>'<col class="khv29-kn-col">').join('')}`;
    requestAnimationFrame(()=>pump(my,rs,0));
    return `<div class="section-head"><h2 class="aurum-khist-daily-title">K_Tarihsel günlük karşılaştırma</h2><small>T0 canlı · T1–T30 kilitli görünüm</small></div><div class="table-wrap aurum-drive-table strict-history r51-history khv29-history"><table><colgroup>${cols}</colgroup><thead><tr><th>Gün</th><th>Kn Trend<br><small>İsabet / 20</small></th><th>REEL TOPN<br><small>HİSSE | REEL GETİRİ</small></th>${KN_V117_ORDER.map(k=>`<th>${k} TOPN<br><small>HİSSE | REEL GETİRİ | KN GETİRİ</small></th>`).join('')}</tr></thead><tbody id="khR29Body"><tr class="kh-r29-loading"><td colspan="15">K_Tarihsel hazırlanıyor…</td></tr></tbody></table></div>`;
  }
  function page(){
    const seedDone=(()=>{try{return kh117ArchiveState()?.seed?.completed===true&&kh117NormalizeArchiveRows(kh117ArchiveState()?.rows,kh117T0()?.date).length>=30}catch{return false}})();
    const buttons=`<button class="gold-btn" onclick="AurumRuntime.manualHistorical()" ${state.syncing||state.calculating?'disabled':''}>K_Tarihsel’i Çalıştır</button><button class="ghost-btn" onclick="AurumKnHistoryV117.seedPIT30().catch(e=>showAurumNotice(e.message,'error',4600))" ${state.syncing||state.calculating||seedDone?'disabled':''}>${seedDone?'Başlangıç T1–T30 Kilitli':'Başlangıç T1–T30’u Doldur'}</button>`;
    let block='';try{block=integrityBlockedMarkup('K_Tarihsel')||''}catch{}
    return `${operationBlock('history',buttons)}${block||`${tableTimePanel('history')||''}${shell()}`}`;
  }
  kh117Render=shell;kh117RenderDeferred=shell;globalThis.kh117Render=kh117Render;globalThis.kh117RenderDeferred=kh117RenderDeferred;
  historyPage=page;globalThis.historyPage=historyPage;
  try{AurumUpdateAPI.state.r29HistoryClassic={version:'R29.0',activatedAt:new Date().toISOString(),features:['REMOVE_10G_21G_HISTORY_DISPLAY','KN_CELL_REAL_VS_KN_RETURN','CLASSIC_SINGLE_REEL_TOPN','CLASSIC_SINGLE_TREND_HIT','R28_NONBLOCKING_PUMP','T0_T1_T30_UNIFORM']}}catch{}
})();

/* R30 — restore the user-approved R25 K_Tarihsel visual/data contract only.
   Later timestamps, archive, staging, GLN/GDN and non-blocking behavior stay active. */
(function installR30HistoryR25Layout(){
  if(globalThis.AURUM_R30_HISTORY_R25_LAYOUT==='R30.0')return;
  globalThis.AURUM_R30_HISTORY_R25_LAYOUT='R30.0';
  let token=0;
  const p=v=>Number.isFinite(Number(v))?`${Number(v)>=0?'+':''}${fmt(Number(v),2)}%`:'—';
  const tm=r=>kn117Time(kh117RowTime(r));
  function trend(r){
    return `<div class="kh30-trend">${(r?.trend||[]).map(x=>`<div class="kh30-trend-row"><b>${html(x.k||'—')}:</b><span>${Number(x.hitCount||0)}/${Number(x.total||20)}</span></div>`).join('')}</div>`;
  }
  function reel(r){
    return `<div class="kh30-cell">${(r?.reelTop20||[]).slice(0,20).map(x=>`<div class="kh30-line"><b>${html(x.sym||'—')}</b><span>(${html(p(x.dayReturn??x.ret??x.realReturn))})</span></div>`).join('')}<footer><span>Reel Top20</span><span>${html(tm(r))}</span></footer></div>`;
  }
  function criterion(r,k){
    const a=(r?.criteria?.[k]||[]).slice(0,20),s=r?.summaries?.[k]||{};
    return `<div class="kh30-cell kh30-kn">${a.map(x=>`<div class="kh30-line${x.realHit?' kh30-hit':''}"><b>${html(x.sym||'—')}</b><span>(${html(p(x.dayReturn??x.ret??x.realReturn))} | ${html(p(x.knReturn??x.returnAvg??x.avgReturn))})</span></div>`).join('')}<footer><span>İsabet: ${Number(s.hitCount||0)}/${a.length||20} · Reel Ort: ${html(p(s.realAvg))}</span><span>Kn Ort: ${html(p(s.knAvg))} · ${html(tm(r))}</span></footer></div>`;
  }
  function row(r){return `<td class="kh-day"><b>${html(r?._label||'—')}</b><small>${html(r?.date||'—')}<br>${r?._t0?'CANLI':'KESİN'}</small></td><td>${trend(r)}</td><td>${reel(r)}</td>${KN_V117_ORDER.map(k=>`<td>${criterion(r,k)}</td>`).join('')}`;}
  const later=fn=>typeof requestIdleCallback==='function'?requestIdleCallback(fn,{timeout:70}):setTimeout(fn,0);
  function pump(my,rows,i){
    if(my!==token||state.page!=='history')return;
    const body=document.getElementById('khR30Body');if(!body)return;
    if(i===0)body.replaceChildren();
    if(i>=rows.length){if(!rows.length)body.innerHTML='<tr><td colspan="15">K_Tarihsel henüz oluşturulmadı.</td></tr>';return;}
    const tr=document.createElement('tr');tr.innerHTML=row(rows[i]);body.appendChild(tr);later(()=>pump(my,rows,i+1));
  }
  function shell(){
    const my=++token,rows=(typeof r26SafeRows==='function'?r26SafeRows():kh117Rows());
    requestAnimationFrame(()=>pump(my,rows,0));
    return `<div class="section-head"><h2 class="aurum-khist-daily-title">K_Tarihsel günlük karşılaştırma</h2><small>T0 canlı · T1–T30 kilitli görünüm</small></div><div class="table-wrap aurum-drive-table strict-history kh30-history"><table><thead><tr><th>Gün</th><th>KN_TREND</th><th>REEL TOPN<br><small>SYM(Δ%)</small></th>${KN_V117_ORDER.map(k=>`<th>${k} TOPN<br><small>SYM(Δ% | GETİRİ%)</small></th>`).join('')}</tr></thead><tbody id="khR30Body"><tr><td colspan="15" class="kh30-loading">K_Tarihsel hazırlanıyor…</td></tr></tbody></table></div>`;
  }
  kh117TrendCell=trend;kh117ReelCell=reel;kh117CriterionCell=criterion;kh117Render=shell;kh117RenderDeferred=shell;
  globalThis.kh117TrendCell=trend;globalThis.kh117ReelCell=reel;globalThis.kh117CriterionCell=criterion;globalThis.kh117Render=shell;globalThis.kh117RenderDeferred=shell;
  try{
    const old=globalThis.AurumKnHistoryV117||{};
    globalThis.AurumKnHistoryV117=Object.freeze({...old,version:'R30.0-r25-visual-contract',renderHistory:shell,renderHistoryDeferred:shell});
    AurumUpdateAPI.state.r30History={version:'R30.0',activatedAt:new Date().toISOString(),features:['R25_VISUAL_LAYOUT','DAILY_REAL_RETURN','KN_RETURN','TIMESTAMPS_PRESERVED','T0_T1_T30_SAME_LAYOUT','NONBLOCKING_ROW_PUMP']};
  }catch{}
})();


/* R31 — ORIGINAL AurumB_2508 K_Tarihsel renderer restored.
   DO NOT change Kn calculation/model logic here.
   Preserved later systems: timestamps/meta, GLN/GDN, staging, fast fetch, notifications.
   Original non-blocking/deferred row rendering is kept. */
(function installR31OriginalHistoryRenderer(){
  if(globalThis.AURUM_R31_ORIGINAL_HISTORY==='R31.0')return;
  globalThis.AURUM_R31_ORIGINAL_HISTORY='R31.0';

  let R31_RENDER_TOKEN=0;

  /* Original AurumB_2508 trend renderer — unchanged. */
  function r31TrendCell(row){
    const a=row.trend||[],
      hitRates=a.map(x=>Number(x.total||20)>0?100*Number(x.hitCount||0)/Number(x.total||20):null).filter(Number.isFinite),
      returns=a.map(x=>Number(x.knAvg??x.returnAvg??x.avgReturn)).filter(Number.isFinite);
    return `<div class="kh-trend">${a.map(x=>`<span>${html(x.k)} ${Number(x.hitCount||0)}/${Number(x.total||20)}</span>`).join('')}<footer><small>İsabet ort: ${hitRates.length?fmt(mean(hitRates),1)+'%':'—'}</small><small>Getiri ort: ${returns.length?pct(mean(returns)):'—'}</small></footer></div>`;
  }

  /* Original AurumB_2508 Reel TopN renderer — unchanged. */
  function r31ReelCell(row){
    const a=(row.reelTop20||[]).slice(0,20);
    return `<div class="kh-cell kh-real">${a.map(x=>`<span class="kh-line"><b>${html(x.sym)}</b><em>(${html(kn117Pct(x.ret))})</em></span>`).join('')}<footer><span>Reel Ort: ${html(kn117Pct(mean(a.map(x=>x.ret))))}</span></footer></div>`;
  }

  /* Original AurumB_2508 K cell renderer.
     The ONLY later addition is the requested market timestamp immediately after Kn Ort. */
  function r31CriterionCell(row,k){
    const a=(row.criteria?.[k]||[]).slice(0,20),s=row.summaries?.[k]||{};
    const stamp=kn117Time(kh117RowTime(row));
    return `<div class="kh-cell kh-kn">${a.map(x=>`<span class="kh-line${x.realHit?' kh-real-hit':''}"><b>${html(x.sym)}</b><em>(${html(kn117Pct(x.dayReturn))} | ${html(kn117Pct(x.knReturn))})</em></span>`).join('')}<footer><span>İsabet: ${Number(s.hitCount||0)}/${a.length||20} · Reel Ort: ${html(kn117Pct(s.realAvg))}</span><span>Kn Ort: ${html(kn117Pct(s.knAvg))} · ${html(stamp)}</span></footer></div>`;
  }

  /* Same original table structure / headers. */
  function r31Head(bodyId){
    return `<div class="section-head"><h2 class="aurum-khist-daily-title">K_Tarihsel günlük karşılaştırma</h2><small>T0 canlı · T1–T30 kilitli görünüm</small></div><div class="table-wrap aurum-drive-table strict-history r51-history"><table><thead><tr><th>Gün</th><th>Kn_Trend</th><th>Reel TopN<br><small>SYM(Δ%)</small></th>${KN_V117_ORDER.map(k=>`<th>${k} TopN<br><small>SYM(Δ% | GETİRİ%)</small></th>`).join('')}</tr></thead><tbody id="${bodyId}"></tbody></table></div>`;
  }

  /* Original deferred renderer behavior retained: two rows per animation frame.
     Safe-row fallback is only a crash guard; it does not alter Kn calculations. */
  function r31Rows(){
    try{
      if(typeof r26SafeRows==='function')return r26SafeRows();
      return kh117Rows();
    }catch(e){
      console.error('R31 history rows',e);
      return [];
    }
  }

  function r31PumpRows(token,rows,index){
    if(token!==R31_RENDER_TOKEN||state.page!=='history')return;
    const body=document.getElementById('khR31Body');
    if(!body)return;
    const end=Math.min(rows.length,index+2),frag=document.createDocumentFragment();
    for(let i=index;i<end;i++){
      const r=rows[i],tr=document.createElement('tr');
      tr.innerHTML=`<td class="kh-day"><b>${r._label}</b><small>${html(r.date)}<br>${r._t0?'CANLI':'KESİN'}</small></td><td>${r31TrendCell(r)}</td><td>${r31ReelCell(r)}</td>${KN_V117_ORDER.map(k=>`<td>${r31CriterionCell(r,k)}</td>`).join('')}`;
      frag.appendChild(tr);
    }
    body.appendChild(frag);
    if(end<rows.length)requestAnimationFrame(()=>r31PumpRows(token,rows,end));
  }

  function r31RenderDeferred(){
    const token=++R31_RENDER_TOKEN,rows=r31Rows(),head=r31Head('khR31Body');
    requestAnimationFrame(()=>{
      const body=document.getElementById('khR31Body');
      if(body&&!rows.length)body.innerHTML='<tr><td colspan="15">K_Tarihsel henüz oluşturulmadı.</td></tr>';
      else r31PumpRows(token,rows,0);
    });
    return head;
  }

  function r31Render(){
    return r31RenderDeferred();
  }

  /* Override ONLY K_Tarihsel presentation functions. */
  kh117TrendCell=r31TrendCell;
  kh117ReelCell=r31ReelCell;
  kh117CriterionCell=r31CriterionCell;
  kh117Render=r31Render;
  kh117RenderDeferred=r31RenderDeferred;

  globalThis.kh117TrendCell=r31TrendCell;
  globalThis.kh117ReelCell=r31ReelCell;
  globalThis.kh117CriterionCell=r31CriterionCell;
  globalThis.kh117Render=r31Render;
  globalThis.kh117RenderDeferred=r31RenderDeferred;

  try{
    const old=globalThis.AurumKnHistoryV117||{};
    globalThis.AurumKnHistoryV117=Object.freeze({
      ...old,
      version:'R31.0-original-AurumB2508-history-renderer',
      renderHistory:r31Render,
      renderHistoryDeferred:r31RenderDeferred
    });
    AurumUpdateAPI.state.r31History={
      version:'R31.0',
      activatedAt:new Date().toISOString(),
      source:'ORIGINAL_AURUMB_2508_RENDERER',
      protectedSystems:[
        'KN_CALCULATION_UNCHANGED',
        'MARKET_UPDATE_CHANGE_TIMESTAMPS',
        'GLN_GDN',
        'STAGING',
        'FAST_FETCH',
        'NOTIFICATIONS',
        'DEFERRED_RENDER'
      ]
    };
  }catch{}
})();



/* R32 — exact compact K_Tarihsel page contract requested by the user.
   Fixes the remaining R29 historyPage override. Kn/model calculations and all later systems stay untouched. */
(function installR32ExactClassicHistory(){
  if(globalThis.AURUM_R32_EXACT_CLASSIC_HISTORY==='R32.0')return;
  globalThis.AURUM_R32_EXACT_CLASSIC_HISTORY='R32.0';
  let renderToken=0;
  const pct=v=>kn117Pct(v);
  const stamp=r=>{try{return kn117Time(kh117RowTime(r))}catch{return '—'}};
  function trend(r){
    const a=(r?.trend||[]).filter(x=>KN_V117_SEAT_ORDER.includes(String(x?.k||'')));
    const hitCounts=a.map(x=>x?.hitCount===null||x?.hitCount===undefined?null:Number(x.hitCount)).filter(Number.isFinite);
    const returns=a.map(x=>{const v=x?.knAvg??x?.returnAvg??x?.avgReturn;return v===null||v===undefined?null:Number(v)}).filter(Number.isFinite);
    return `<div class="kh-trend">${a.map(x=>`<span>${html(x.k)}: ${x.hitCount===null||x.hitCount===undefined?'—':Number(x.hitCount)}/${Number(x.total||20)}</span>`).join('')}<footer><small>İsabet ort: ${hitCounts.length?fmt(mean(hitCounts),2)+'/20':'—'}</small><small>Getiri ort: ${returns.length?pct(mean(returns)):'—'}</small><small>${html(stamp(r))}</small></footer></div>`;
  }
  function reel(r){
    const a=(r?.reelTop20||[]).slice(0,20),reelDate=String(r?.reelDate||r?.date||'—');
    return `<div class="kh-cell kh-real">${a.map(x=>`<span class="kh-line"><b>${html(x.sym)}</b><em>(${html(pct(x.ret??x.dayReturn??x.realReturn))})</em></span>`).join('')}<footer><span>Reel Ort: ${html(pct(mean(a.map(x=>x.ret??x.dayReturn??x.realReturn))))}</span><span>Reel tarihi: ${html(reelDate)}</span></footer></div>`;
  }
  function crit(r,k){
    const a=(r?.criteria?.[k]||[]).slice(0,20),s=r?.summaries?.[k]||{},seatEligible=KN_V117_SEAT_ORDER.includes(k);
    return `<div class="kh-cell kh-kn">${a.map(x=>`<span class="kh-line${x.realHit?' kh-real-hit':''}"><b>${html(x.sym)}</b><em>(${html(pct(x.dayReturn??x.ret??x.realReturn))} | ${seatEligible?html(pct(x.knReturn??x.returnAvg??x.avgReturn)):'—'})</em></span>`).join('')}<footer><span>${seatEligible?`İsabet: ${s.hitCount===null||s.hitCount===undefined?'—':Number(s.hitCount)}/${a.length||20} · Reel Ort: ${html(pct(s.realAvg))}`:'Analiz/meta tablo · işlem getirisi yok'}</span><span>Kn Ort: ${seatEligible?html(pct(s.knAvg)):'—'} · Kn as-of ${html(r?.date||'—')} · ${html(stamp(r))}</span></footer></div>`;
  }
  function rows(){try{return kh117DisplayRows()}catch(e){console.error('R32 history rows',e);try{return typeof r26SafeRows==='function'?r26SafeRows():kh117Rows()}catch{return []}}}
  function pump(tok,rs,i){
    if(tok!==renderToken||state.page!=='history')return;
    const body=document.getElementById('khR32Body');if(!body)return;
    const end=Math.min(rs.length,i+1),frag=document.createDocumentFragment();
    for(let n=i;n<end;n++){
      const r=rs[n],tr=document.createElement('tr');tr.style.contentVisibility='auto';tr.style.containIntrinsicSize='420px';
      tr.innerHTML=`<td class="kh-day"><b>${html(r?._label||'—')}</b><small>${html(r?.date||'—')}<br>${r?._t0?'CANLI':'KESİN'}</small></td><td>${trend(r)}</td><td>${reel(r)}</td>${KN_V117_ORDER.map(k=>`<td>${crit(r,k)}</td>`).join('')}`;
      frag.appendChild(tr);
    }
    body.appendChild(frag);
    if(end<rs.length){if(typeof requestIdleCallback==='function')requestIdleCallback(()=>pump(tok,rs,end),{timeout:80});else requestAnimationFrame(()=>pump(tok,rs,end));}
  }
  function renderer(){
    const tok=++renderToken,rs=rows();
    const start=()=>{const b=document.getElementById('khR32Body');if(!b)return;if(!rs.length)b.innerHTML='<tr><td colspan="15">K_Tarihsel henüz oluşturulmadı.</td></tr>';else pump(tok,rs,0)};if(typeof requestIdleCallback==='function')requestIdleCallback(start,{timeout:120});else setTimeout(start,0);
    return `<div class="section-head"><h2 class="aurum-khist-daily-title">K_Tarihsel günlük karşılaştırma</h2><small>T0: güncel Kn ↔ güncel Reel · T1–T30: Kn(d) ↔ Reel(d+1)</small></div><div class="table-wrap aurum-drive-table strict-history r51-history r32-classic-history"><table><thead><tr><th>Gün</th><th>KN_TREND<br><small>K1–K7 ertesi-gün isabeti</small></th><th>REEL TOPN<br><small>hedef gün · SYM(Δ%)</small></th>${KN_V117_ORDER.map(k=>`<th>${k} TOPN<br><small>${KN_V117_SEAT_ORDER.includes(k)?'SYM(REEL% | KN%)':'SYM(REEL% | ANALİZ)'}</small></th>`).join('')}</tr></thead><tbody id="khR32Body"></tbody></table></div>`;
  }
  function page(){
    const seedDone=(()=>{try{return kh117ArchiveState()?.seed?.completed===true&&kh117NormalizeArchiveRows(kh117ArchiveState()?.rows,kh117T0()?.date).length>=30}catch{return false}})();
    const buttons=`<button class="gold-btn" onclick="AurumRuntime.manualHistorical()" ${state.syncing||state.calculating?'disabled':''}>K_Tarihsel’i Çalıştır</button><button class="ghost-btn" onclick="AurumKnHistoryV117.seedPIT30().catch(e=>showAurumNotice(e.message,'error',4600))" ${state.syncing||state.calculating||seedDone?'disabled':''}>${seedDone?'Başlangıç T1–T30 Kilitli':'Başlangıç T1–T30’u Doldur'}</button>`;
    let blocked='';try{blocked=integrityBlockedMarkup('K_Tarihsel')||''}catch{}
    return `${operationBlock('history',buttons)}<div data-aurum-explicit-time>${tableTimePanel('history')||''}${blocked||renderer()}</div>`;
  }
  kh117TrendCell=trend;kh117ReelCell=reel;kh117CriterionCell=crit;kh117Render=renderer;kh117RenderDeferred=renderer;
  globalThis.kh117TrendCell=trend;globalThis.kh117ReelCell=reel;globalThis.kh117CriterionCell=crit;globalThis.kh117Render=renderer;globalThis.kh117RenderDeferred=renderer;
  historyPage=page;globalThis.historyPage=page;
  try{const old=globalThis.AurumKnHistoryV117||{};globalThis.AurumKnHistoryV117=Object.freeze({...old,version:'R32.0-exact-classic-history-perf',rows:kh117DisplayRows,renderHistory:renderer,renderHistoryDeferred:renderer});}catch{}
  try{AurumUpdateAPI.state.r32ExactClassic={version:'R32.0',activatedAt:new Date().toISOString(),protected:['KN_MODEL','GLN_GDN','STAGING','FAST_FETCH','NOTIFICATIONS','TIMESTAMPS'],features:['EXACT_COMPACT_LINE_LAYOUT','HISTORY_PAGE_OVERRIDE_FIXED','NONBLOCKING_PUMP']}}catch{}
})();



/* R33 — S deterministic snapshot guard.
   Root cause fixed: R47 history-recency previously mutated cached model scores in-place,
   so the same data snapshot could produce a different S Top20 on every run. */
(function installR33DeterministicS(){
  if(globalThis.AURUM_R33_S_DETERMINISTIC==='R33.0')return;
  globalThis.AURUM_R33_S_DETERMINISTIC='R33.0';

  const canonSyms=a=>[...new Set((a||[]).map(x=>String(x?.sym??x??'').trim().toUpperCase()).filter(Boolean))];
  const setDiff=(prev,next)=>{
    const p=new Set(canonSyms(prev)),n=new Set(canonSyms(next));
    return {in:[...n].filter(x=>!p.has(x)),out:[...p].filter(x=>!n.has(x))};
  };

  /* Non-mutating historical recency. Always starts from a fresh model build. */
  function r33ApplyHistoryRecencyFresh(built){
    const hs=typeof r47HistoryRecencyScores==='function'?r47HistoryRecencyScores():new Map();
    if(!built?.bySym)return built;
    const bySym=new Map();
    for(const [sym,orig] of built.bySym){
      const x={...orig};
      const h=hs.get(sym)||0;
      x.kHistoricalRecencyScore=h;
      const base=Number(orig.totalScore||0);
      x.totalScore=clamp(base+3.0*h,0,100);
      x.targetReasons=[...(orig.targetReasons||[])];
      if(h>=.55&&!x.targetReasons.some(t=>String(t).startsWith('K_Tarihsel güncellik ')))
        x.targetReasons.push(`K_Tarihsel güncellik ${fmt(h*100,0)}/100`);
      bySym.set(sym,x);
    }
    const scores={};
    for(const k of KN_V117_ORDER) scores[k]=(built.scores?.[k]||[]).map(x=>({...x}));
    const selection=[...bySym.values()]
      .sort((a,b)=>Number(b.totalScore||0)-Number(a.totalScore||0)
        ||Number(b.targetProbability||0)-Number(a.targetProbability||0)
        ||String(a.sym).localeCompare(String(b.sym)))
      .slice(0,state.settings.topN);
    return {...built,bySym,scores,selection};
  }
  globalThis.r33ApplyHistoryRecencyFresh=r33ApplyHistoryRecencyFresh;
  globalThis.r33SelectionDiff=setDiff;

  function inputFingerprint(job,calcRecords){
    const parts=[
      String(job?.dataSnapshotId||''),
      stableScalar(state.performance?.weights||{}),
      stableScalar(publicRunSettings(state.settings)),
      typeof historyTableFingerprint==='function'?historyTableFingerprint():'',
      ...calcRecords.map(r=>[
        r.sym,r.latestDate,r.marketDataAt,r.livePrice,r.dayChange,r.quality,
        r.marketCap,r.volume,r.turnover,r.ret10d,r.ret21d,r.vol20,r.rsi14
      ].map(stableScalar).join('|'))
    ];
    return rollingFingerprint(parts);
  }

  calculateS=async function calculateSR33(job){
    job.currentStage='S';
    await transition(job,JOB_STATUS.S_RUNNING,{message:'Nihai seçim hesaplanıyor',done:0,total:1});
    state.calculating=true;
    state.progress={stage:'S',current:'Nihai seçim',done:0,total:1,errors:0};

    try{
      await pauseCheckpoint(job,JOB_STATUS.S_RUNNING);

      /* Snapshot-lock: capture the eligible records once for this S run. */
      const calcRecords=calculationRecords().map(r=>({...r}));
      

      const sPrev=(await dbGet('meta','selectionSnapshot'))?.value||{};
      const tablePrev=(await dbGet('meta','selectionTableState'))?.value||{};
      const fp=inputFingerprint(job,calcRecords);

      /* Exact same inputs => exact same S. Do not recalculate and never emit GLN/GDN. */
      if(sPrev.inputFingerprint===fp && Array.isArray(tablePrev.rows) && tablePrev.rows.length>=20){
        state.selection=tablePrev.rows.map(x=>({...x}));
        state.tableMetrics=state.tableMetrics||{};
        state.tableMetrics.s={
          ...(state.tableMetrics.s||{}),
          gln:Array.isArray(sPrev.gln)&&sPrev.gln.length?sPrev.gln.join(' · '):'—',
          gdn:Array.isArray(sPrev.gdn)&&sPrev.gdn.length?sPrev.gdn.join(' · '):'—',
          glnChangedAt:sPrev.glnChangedAt||null,
          gdnChangedAt:sPrev.gdnChangedAt||null
        };
        await refreshTableMeta();
        await transition(job,JOB_STATUS.COMPLETED,{completedAt:nowISO(),message:`S tamamlandı · ${state.selection.length} hisse · aynı snapshot`,done:1,total:1});
        job.completedAt=nowISO(); await saveJob(job);
        return true;
      }

      /* Never reuse the mutable Kn model cache here. Fresh build => no cumulative bonus. */
      const base=rebuildModelViews(calcRecords);
      const built=r33ApplyHistoryRecencyFresh(base);
      

      state.scores=built.scores;
      state.selection=built.selection;
      state.modelBySym=built.bySym;
      await updateSelectionLifecycle();

      const persistedSelection=state.selection.map(x=>{const y={...x};delete y.record;return y;});
      const savedAt=nowISO();
      await dbPut('meta',{key:'selectionTableState',value:{
        dataSnapshotId:job.dataSnapshotId,rowsVersion:3,rows:persistedSelection,
        inputFingerprint:fp,updatedAt:savedAt,historyRecency:'EXP_0.93_CAP_3PT_NON_MUTATING'
      },updatedAt:savedAt});

      await pauseCheckpoint(job,JOB_STATUS.S_RUNNING);

      const sTransferredAt=nowISO();
      const currentSymbols=canonSyms(state.selection).slice(0,20);
      const previousSymbols=canonSyms(Array.isArray(sPrev.symbols)?sPrev.symbols:[]).slice(0,20);
      const d=setDiff(previousSymbols,currentSymbols);
      const validSet=currentSymbols.length===20 && (previousSymbols.length===0 || previousSymbols.length===20);

      const priorGln=Array.isArray(sPrev.gln)?sPrev.gln:[];
      const priorGdn=Array.isArray(sPrev.gdn)?sPrev.gdn:[];
      let nextGln=priorGln,nextGdn=priorGdn;
      let glnChangedAt=sPrev.glnChangedAt||null,gdnChangedAt=sPrev.gdnChangedAt||null;

      if(previousSymbols.length===0){
        /* First valid S table: baseline shown as GLN, no fake GDN. */
        nextGln=currentSymbols.slice(); glnChangedAt=sTransferredAt;
      }else if(validSet){
        if(d.in.length){nextGln=d.in;glnChangedAt=sTransferredAt}
        if(d.out.length){nextGdn=d.out;gdnChangedAt=sTransferredAt}
      }

      const sFingerprint=selectionTableFingerprint();
      const sChangedAt=sPrev.fingerprint===sFingerprint&&sPrev.changedAt?sPrev.changedAt:sTransferredAt;

      state.tableMetrics=state.tableMetrics||{};
      state.tableMetrics.s={
        ...(state.tableMetrics.s||{}),
        gln:nextGln.length?nextGln.join(' · '):'—',
        gdn:nextGdn.length?nextGdn.join(' · '):'—',
        glnChangedAt,gdnChangedAt
      };

      await dbPut('meta',{key:'selectionSnapshot',value:{
        dataSnapshotId:job.dataSnapshotId,at:sTransferredAt,transferredAt:sTransferredAt,
        changedAt:sChangedAt,fingerprint:sFingerprint,inputFingerprint:fp,
        symbols:currentSymbols,gln:nextGln,gdn:nextGdn,glnChangedAt,gdnChangedAt,
        glnGdnBasis:'CANONICAL_MEMBERSHIP_ONLY_R33'
      },updatedAt:sTransferredAt});

      if(previousSymbols.length===20 && validSet && (d.in.length||d.out.length)){
        const notice=`${d.in.length?'AL '+d.in.join(', '):''}${d.in.length&&d.out.length?' · ':''}${d.out.length?'SAT '+d.out.join(', '):''}`;
        job.sNotificationDetail=notice;
        try{await globalThis.r21DispatchSChange?.(d.in,d.out,sTransferredAt,job)}catch{}
      }

      try{
        await dbPut('meta',{key:'r33SelectionAudit',value:{
          at:sTransferredAt,dataSnapshotId:job.dataSnapshotId,inputFingerprint:fp,
          previous:previousSymbols,current:currentSymbols,incoming:d.in,outgoing:d.out
        },updatedAt:sTransferredAt});
      }catch{}

      await markDerivedUpdate('S');
      await refreshTableMeta();
      await transition(job,JOB_STATUS.COMPLETED,{completedAt:nowISO(),message:`S tamamlandı · ${state.selection.length} hisse`,done:1,total:1});
      job.completedAt=nowISO(); await saveJob(job);
      try{await maybeRunAIDailyAudit()}catch{}
      return true;
    }catch(e){
      if(e?.code==='OPERATION_CANCELLED'||cancelRequested(job)){
        await transition(job,JOB_STATUS.IDLE,{error:null,message:'S iptal edildi · önceki tablo korundu'});return false;
      }
      await transition(job,JOB_STATUS.FAILED,{error:e?.message||String(e),message:'S başarısız'});return false;
    }finally{
      state.calculating=false;clearCancel(job.id);renderCurrentPagePreservingView();
    }
  };
  globalThis.calculateS=calculateS;

  try{
    AurumUpdateAPI.state.r33S={
      version:'R33.0',activatedAt:new Date().toISOString(),
      fixes:['NO_CUMULATIVE_HISTORY_BONUS','SNAPSHOT_LOCK','SAME_INPUT_SAME_OUTPUT','CANONICAL_MEMBERSHIP_GLN_GDN']
    };
  }catch{}
})();



/* R34 — SOURCE FIX for S instability.
   Invariant: unchanged Veriler + unchanged Kn + unchanged K_Tarihsel => identical S membership AND order.
   This does NOT suppress changes; it removes hidden mutable/time-dependent inputs from the S formula. */
(function installR34SRootDeterminism(){
  if(globalThis.AURUM_R34_S_ROOT==='R34.0')return;
  globalThis.AURUM_R34_S_ROOT='R34.0';

  const BASE_KEY='sDeterministicBaseFromKnR34';
  const AUDIT_KEY='sDeterminismAuditR34';

  function canon(a){return [...new Set((a||[]).map(x=>String(x?.sym??x??'').trim().toUpperCase()).filter(Boolean))]}
  function diff(prev,next){
    const p=new Set(canon(prev)),n=new Set(canon(next));
    return {in:[...n].filter(x=>!p.has(x)),out:[...p].filter(x=>!n.has(x))};
  }
  function clonePlain(v){return v==null?v:JSON.parse(JSON.stringify(v))}
  function maxIso(values){
    return (values||[]).map(x=>String(x||'')).filter(x=>/^\d{4}-\d{2}-\d{2}T/.test(x)).sort().at(-1)||null;
  }

  /* Stable context belongs to the DATA SNAPSHOT, not the moment the user presses S/Kn. */
  globalThis.r34ModelContextAt=function r34ModelContextAt(job,records){
    const meta=TABLE_META?.data||{};
    const source=maxIso((records||[]).flatMap(x=>[
      x?.marketDataAt,x?.provenance?.marketAt,x?.datasetMarketAt,x?.tableTransferredAt
    ]));
    const chosen=meta.market||source||meta.changed||meta.transfer||null;
    if(chosen)return chosen;
    const d=(records||[]).map(x=>x?.latestDate).filter(Boolean).sort().at(-1);
    /* No current clock fallback: a deterministic after-close anchor is used for legacy data. */
    return d?`${d}T18:10:00+03:00`:'2000-01-01T18:10:00+03:00';
  };

  function serialiseKnBase(built){
    const rows=[];
    for(const [sym,x] of built?.bySym||[]){
      rows.push({
        sym,
        baseTotalScore:Number(x.totalScore),
        targetProbability:Number(x.targetProbability),
        confidence:Number(x.confidence),
        confidenceObservations:Number(x.confidenceObservations),
        provisionalDayRank:Number.isFinite(x.provisionalDayRank)?Number(x.provisionalDayRank):null,
        chaseRisk:Number.isFinite(x.chaseRisk)?Number(x.chaseRisk):null,
        riskLevel:x.riskLevel||null,
        executionRisk:Number.isFinite(x.executionRisk)?Number(x.executionRisk):null,
        warnings:clonePlain(x.warnings||[]),
        contributions:clonePlain(x.contributions||[]),
        supportingCriteria:clonePlain(x.supportingCriteria||[]),
        targetReasons:clonePlain(x.targetReasons||[])
      });
    }
    rows.sort((a,b)=>a.sym.localeCompare(b.sym));
    return rows;
  }

  async function persistKnBase(job){
    const cache=state.__modelCache;
    if(!cache?.built||cache.dataSnapshotId!==job?.dataSnapshotId)return false;
    const [kn,hist]=await Promise.all([dbGet('meta','knSnapshot'),dbGet('meta','historicalSnapshot')]);
    const rows=serialiseKnBase(cache.built);
    if(rows.length<20)return false;
    const contextAt=globalThis.r34ModelContextAt(job,cache.built.eligible||[]);
    const fingerprint=rollingFingerprint([
      String(job.dataSnapshotId||''),String(kn?.value?.fingerprint||''),
      stableScalar(cache.built.weights||{}),contextAt,
      ...rows.map(x=>[x.sym,stableScalar(x.baseTotalScore),stableScalar(x.targetProbability),
        stableScalar(x.confidence),stableScalar(x.executionRisk),stableScalar(x.contributions)].join('|'))
    ]);
    await dbPut('meta',{key:BASE_KEY,value:{
      schema:1,dataSnapshotId:job.dataSnapshotId,knFingerprint:kn?.value?.fingerprint||null,
      modelContextAt:contextAt,weights:clonePlain(cache.built.weights||{}),
      rows,fingerprint,createdAt:nowISO()
    },updatedAt:nowISO()});
    return true;
  }

  /* Persist the exact S base produced by Kn. No later S recalculation can silently choose
     another seance window, decay time, calibration time or mutable model state. */
  const knBeforeR34=calculateKn;
  calculateKn=async function calculateKnR34(job){
    const ok=await knBeforeR34(job);
    if(ok){
      try{await persistKnBase(job)}
      catch(e){console.error('R34 Kn deterministic base persist',e)}
    }
    return ok;
  };
  globalThis.calculateKn=calculateKn;

  function applyHistoryToFrozenBase(baseRows){
    const hs=typeof r47HistoryRecencyScores==='function'?r47HistoryRecencyScores():new Map();
    return (baseRows||[]).map(b=>{
      const rec=state.recordMap.get(b.sym);
      if(!rec)return null;
      const h=Number(hs.get(b.sym)||0);
      const totalScore=clamp(Number(b.baseTotalScore||0)+3*h,0,100);
      const reasons=[...(b.targetReasons||[])];
      if(h>=.55&&!reasons.some(t=>String(t).startsWith('K_Tarihsel güncellik ')))
        reasons.push(`K_Tarihsel güncellik ${fmt(h*100,0)}/100`);
      return {
        ...rec,
        warnings:[...(b.warnings||[])],
        provisionalDayRank:b.provisionalDayRank,
        chaseRisk:b.chaseRisk,
        totalScore,
        targetProbability:b.targetProbability,
        confidence:b.confidence,
        confidenceObservations:b.confidenceObservations,
        contributions:clonePlain(b.contributions||[]),
        supportingCriteria:[...(b.supportingCriteria||[])],
        riskLevel:b.riskLevel,
        executionRisk:b.executionRisk,
        targetReasons:reasons,
        kHistoricalRecencyScore:h
      };
    }).filter(Boolean).sort((a,b)=>
      Number(b.totalScore||0)-Number(a.totalScore||0) ||
      Number(b.targetProbability||0)-Number(a.targetProbability||0) ||
      String(a.sym).localeCompare(String(b.sym))
    );
  }

  function outputFingerprint(rows){
    return rollingFingerprint((rows||[]).map((x,i)=>[
      i,x.sym,stableScalar(x.totalScore),stableScalar(x.targetProbability),
      stableScalar(x.kHistoricalRecencyScore)
    ].join('|')));
  }

  /* Replaces R33 shortcut completely. This always computes S from its true frozen inputs;
     there is no "same fingerprint, reuse old result" masking. */
  calculateS=async function calculateSR34(job){
    job.currentStage='S';
    await transition(job,JOB_STATUS.S_RUNNING,{message:'Nihai seçim · deterministik kaynak formülü',done:0,total:1});
    state.calculating=true;
    state.progress={stage:'S',current:'Kn tabanı + K_Tarihsel kanıtı',done:0,total:1,errors:0};
    try{
      await pauseCheckpoint(job,JOB_STATUS.S_RUNNING);

      const [activeRow,knRow,histRow,baseRow,prevRow]=await Promise.all([
        dbGet('meta','activeDataSnapshot'),dbGet('meta','knSnapshot'),
        dbGet('meta','historicalSnapshot'),dbGet('meta',BASE_KEY),dbGet('meta','selectionSnapshot')
      ]);
      const active=activeRow?.value||{},kn=knRow?.value||{},hist=histRow?.value||{},base=baseRow?.value||{},prev=prevRow?.value||{};

      const snapshotId=job?.dataSnapshotId||active.snapshotId||null;
      if(!snapshotId||active.snapshotId!==snapshotId||kn.dataSnapshotId!==snapshotId||hist.dataSnapshotId!==snapshotId)
        throw new Error('S deterministik zinciri: Veriler / Kn / K_Tarihsel aynı snapshot değil');
      if(base.dataSnapshotId!==snapshotId||base.knFingerprint!==kn.fingerprint||!Array.isArray(base.rows)||base.rows.length<20)
        throw new Error('S deterministik tabanı eksik. Bu sürümde Kn’yi bir kez yeniden çalıştırın; ardından K_Tarihsel ve S çalıştırın.');

      /* K_Tarihsel is a declared S input. Its persisted fingerprint is part of formula identity. */
      const histFingerprint=hist.fingerprint||historyTableFingerprint();
      const formulaInputFingerprint=rollingFingerprint([
        String(snapshotId),String(kn.fingerprint||''),String(histFingerprint||''),
        String(base.fingerprint||''),stableScalar(state.settings.topN||20)
      ]);

      const ranked=applyHistoryToFrozenBase(base.rows);
      const topN=Math.max(20,Number(state.settings.topN||20));
      if(ranked.length<20)throw new Error(`S için 20 hisse üretilemedi; deterministik tabanda ${ranked.length} uygun hisse var`);
      state.selection=ranked.slice(0,topN);
      /* Keep Kn tables untouched. Only S model lookup is updated for selected/known candidates. */
      state.modelBySym=new Map(ranked.map(x=>[x.sym,x]));

      await updateSelectionLifecycle();

      const persisted=state.selection.map(x=>{
        const y={...x};delete y.record;return y;
      });
      const outFp=outputFingerprint(state.selection);
      const at=nowISO();

      await dbPut('meta',{key:'selectionTableState',value:{
        dataSnapshotId:snapshotId,rowsVersion:4,rows:persisted,updatedAt:at,
        formula:'R34_FROZEN_KN_BASE_PLUS_FROZEN_K_HISTORY',
        formulaInputFingerprint,outputFingerprint:outFp
      },updatedAt:at});

      const currentSymbols=canon(state.selection).slice(0,20);
      const previousSymbols=canon(prev.symbols||[]).slice(0,20);
      const d=diff(previousSymbols,currentSymbols);
      const valid=currentSymbols.length===20&&(previousSymbols.length===0||previousSymbols.length===20);

      let gln=Array.isArray(prev.gln)?prev.gln:[],gdn=Array.isArray(prev.gdn)?prev.gdn:[];
      let glnChangedAt=prev.glnChangedAt||null,gdnChangedAt=prev.gdnChangedAt||null;
      if(previousSymbols.length===0){
        gln=currentSymbols.slice();glnChangedAt=at;
      }else if(valid){
        if(d.in.length){gln=d.in;glnChangedAt=at}
        if(d.out.length){gdn=d.out;gdnChangedAt=at}
      }

      /* changedAt only moves when the real ordered S output changes. */
      const sameOutput=prev.outputFingerprint===outFp;
      const changedAt=sameOutput&&prev.changedAt?prev.changedAt:at;

      state.tableMetrics=state.tableMetrics||{};
      state.tableMetrics.s={...(state.tableMetrics.s||{}),
        gln:gln.length?gln.join(' · '):'—',gdn:gdn.length?gdn.join(' · '):'—',
        glnChangedAt,gdnChangedAt};

      await dbPut('meta',{key:'selectionSnapshot',value:{
        dataSnapshotId:snapshotId,at,transferredAt:at,changedAt,
        fingerprint:selectionTableFingerprint(),outputFingerprint:outFp,
        formulaInputFingerprint,symbols:currentSymbols,gln,gdn,glnChangedAt,gdnChangedAt,
        glnGdnBasis:'REAL_MEMBERSHIP_CHANGE_ONLY_R34',
        formula:'FROZEN_KN_MODEL_BASE + K_TARIHSEL_RECENCY',
        modelContextAt:base.modelContextAt
      },updatedAt:at});

      await dbPut('meta',{key:AUDIT_KEY,value:{
        at,dataSnapshotId:snapshotId,knFingerprint:kn.fingerprint||null,
        historicalFingerprint:histFingerprint,baseFingerprint:base.fingerprint||null,
        formulaInputFingerprint,outputFingerprint:outFp,
        previousOutputFingerprint:prev.outputFingerprint||null,
        incoming:d.in,outgoing:d.out,orderedSymbols:currentSymbols,
        proof:'NO_WALL_CLOCK_NO_REBUILD_NO_LIVE_CALIBRATION_NO_MUTABLE_BONUS'
      },updatedAt:at});

      if(previousSymbols.length===20&&valid&&(d.in.length||d.out.length)){
        const notice=`${d.in.length?'AL '+d.in.join(', '):''}${d.in.length&&d.out.length?' · ':''}${d.out.length?'SAT '+d.out.join(', '):''}`;
        job.sNotificationDetail=notice;
        try{await globalThis.r21DispatchSChange?.(d.in,d.out,at,job)}catch{}
      }

      await markDerivedUpdate('S');
      await refreshTableMeta();
      await transition(job,JOB_STATUS.COMPLETED,{completedAt:nowISO(),message:`S tamamlandı · ${state.selection.length} hisse · deterministik`,done:1,total:1});
      job.completedAt=nowISO();await saveJob(job);
      return true;
    }catch(e){
      if(e?.code==='OPERATION_CANCELLED'||cancelRequested(job)){
        await transition(job,JOB_STATUS.IDLE,{error:null,message:'S iptal edildi · önceki tablo korundu'});return false;
      }
      await transition(job,JOB_STATUS.FAILED,{error:e?.message||String(e),message:'S başarısız'});return false;
    }finally{
      state.calculating=false;clearCancel(job.id);renderCurrentPagePreservingView();
    }
  };
  globalThis.calculateS=calculateS;

  try{
    AurumUpdateAPI.state.r34SRoot={
      version:'R34.0',activatedAt:nowISO(),
      rootCausesFixed:[
        'WALL_CLOCK_DECAY_IN_CALIBRATION',
        'WALL_CLOCK_MARKET_WINDOW_IN_MODEL_CONTEXT',
        'WALL_CLOCK_CHASE_RISK_CONTEXT',
        'MUTATING_HISTORY_RECENCY_BONUS',
        'S_REBUILDING_MODEL_INDEPENDENTLY_FROM_KN'
      ],
      invariant:'UNCHANGED_DATA_KN_HISTORY_EQUALS_IDENTICAL_S_ORDER_AND_MEMBERSHIP'
    };
  }catch{}
})();



/* AURUM B36 EMBEDDED UNIVERSE FILTER - 2026-08-29 */
(function(A){
  "use strict";
  if(!A||!A.state)throw new Error("AurumUpdateAPI/state bulunamadı");
  const S=A.state;
  const VERSION="B36.0-BLOCKED-UNIVERSE-CARD-LONGPRESS";
  const SETTING_KEY="blockedSymbols";

  if(globalThis.AURUM_BLOCKED_UNIVERSE_V1){
    try{globalThis.AURUM_BLOCKED_UNIVERSE_V1.refresh?.()}catch{}
    return;
  }

  const norm=x=>String(x??"").trim().toLocaleUpperCase("tr-TR").replace(/[^A-Z0-9ÇĞİÖŞÜ._-]/g,"");
  const uniq=a=>[...new Set((Array.isArray(a)?a:[]).map(norm).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"tr"));
  const blocked=()=>new Set(uniq(S.settings?.[SETTING_KEY]||[]));
  const isBlocked=x=>blocked().has(norm(x?.sym??x?.symbol??x));

  S.settings=S.settings||{};
  S.settings[SETTING_KEY]=uniq(S.settings[SETTING_KEY]||[]);

  const apiNow=()=>A.nowISO?A.nowISO():new Date().toISOString();
  async function saveSetting(){
    S.settings[SETTING_KEY]=uniq(S.settings[SETTING_KEY]||[]);
    await A.dbPut("settings",{key:"main",value:S.settings,updatedAt:apiNow()});
    S.settingsDirty=false;
  }

  function esc(s){
    return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  /* The original BIST universe remains the source; the blacklist is a hard universe subtraction. */
  const baseCurrentSymbols=globalThis.currentSymbols;
  if(typeof baseCurrentSymbols!=="function")throw new Error("currentSymbols bulunamadı");
  globalThis.__AURUM_BASE_CURRENT_SYMBOLS=globalThis.__AURUM_BASE_CURRENT_SYMBOLS||baseCurrentSymbols;
  globalThis.currentSymbols=function blockedUniverseCurrentSymbols(){
    const b=blocked();
    return globalThis.__AURUM_BASE_CURRENT_SYMBOLS().filter(sym=>!b.has(norm(sym)));
  };

  /* Block before staging as a second hard gate. currentSymbols already prevents scheduling,
     this also protects resume/import/legacy code paths from accidental writes. */
  const baseStagePut=globalThis.stagePut;
  if(typeof baseStagePut==="function"){
    globalThis.__AURUM_BASE_STAGE_PUT=globalThis.__AURUM_BASE_STAGE_PUT||baseStagePut;
    globalThis.stagePut=async function blockedUniverseStagePut(jobId,sym,record){
      if(isBlocked(sym)||isBlocked(record))return true;
      return globalThis.__AURUM_BASE_STAGE_PUT(jobId,sym,record);
    };
  }

  /* Imported files must obey the same universe rule. */
  const baseImport=globalThis.importData;
  if(typeof baseImport==="function"){
    globalThis.__AURUM_BASE_IMPORT_DATA=globalThis.__AURUM_BASE_IMPORT_DATA||baseImport;
    globalThis.importData=async function blockedUniverseImportData(payload,name){
      const ok=await globalThis.__AURUM_BASE_IMPORT_DATA(payload,name);
      await purgeBlockedUniverse({reason:"IMPORT"});
      return ok;
    };
  }

  function objectSymbol(v){
    if(!v||typeof v!=="object")return "";
    return norm(v.sym??v.symbol??v.code??v.hisse??"");
  }
  function deepSanitize(v,b){
    if(Array.isArray(v)){
      const out=[];
      for(const item of v){
        if(typeof item==="string"&&b.has(norm(item)))continue;
        if(item&&typeof item==="object"&&b.has(objectSymbol(item)))continue;
        out.push(deepSanitize(item,b));
      }
      return out;
    }
    if(v&&typeof v==="object"){
      const out={};
      for(const [k,val] of Object.entries(v))out[k]=deepSanitize(val,b);
      return out;
    }
    return v;
  }

  function scrubMetricText(v,b){
    if(Array.isArray(v))return v.filter(x=>!b.has(norm(x)));
    if(typeof v!=="string")return v;
    const parts=v.split(/\s*[·,]\s*/).map(x=>x.trim()).filter(Boolean).filter(x=>!b.has(norm(x)));
    return parts.length?parts.join(" · "):"—";
  }

  function sanitizeMemory(){
    const b=blocked();
    if(!b.size)return;

    S.records=(S.records||[]).filter(x=>!b.has(norm(x?.sym)));
    S.recordMap=new Map((S.records||[]).map(x=>[x.sym,x]));

    for(const key of ["scores","discoveryScores"]){
      if(S[key]&&typeof S[key]==="object"){
        for(const k of Object.keys(S[key]))if(Array.isArray(S[key][k]))
          S[key][k]=S[key][k].filter(x=>!b.has(norm(x?.sym??x?.record?.sym)));
      }
    }
    if(Array.isArray(S.selection))S.selection=S.selection.filter(x=>!b.has(norm(x?.sym)));
    if(Array.isArray(S.__pendingSelection))S.__pendingSelection=S.__pendingSelection.filter(x=>!b.has(norm(x?.sym)));
    if(S.modelBySym instanceof Map)for(const sym of b)S.modelBySym.delete(sym);
    if(S.behaviorProfiles instanceof Map)for(const sym of b)S.behaviorProfiles.delete(sym);
    if(S.__modelCache)S.__modelCache=null;
    if(S.__pendingKnSnapshot)S.__pendingKnSnapshot=null;

    if(Array.isArray(S.runs))S.runs=S.runs.map(r=>deepSanitize(r,b));
    if(Array.isArray(S.ai?.candidates))S.ai.candidates=S.ai.candidates.filter(x=>!b.has(norm(x?.sym??x?.symbol)));

    if(S.tableMetrics?.s){
      S.tableMetrics.s.gln=scrubMetricText(S.tableMetrics.s.gln,b);
      S.tableMetrics.s.gdn=scrubMetricText(S.tableMetrics.s.gdn,b);
    }
    if(S.tableMetrics?.kn){
      S.tableMetrics.kn.gln=scrubMetricText(S.tableMetrics.kn.gln,b);
      S.tableMetrics.kn.gdn=scrubMetricText(S.tableMetrics.kn.gdn,b);
    }
  }

  function txDeleteWhere(store,predicate){
    const db=S.db;
    if(!db||!db.objectStoreNames.contains(store))return Promise.resolve(0);
    return new Promise((resolve,reject)=>{
      let n=0;
      const tx=db.transaction(store,"readwrite"),os=tx.objectStore(store),q=os.openCursor();
      q.onsuccess=e=>{
        const c=e.target.result;
        if(!c)return;
        try{if(predicate(c.value,c.key)){c.delete();n++;}}catch{}
        c.continue();
      };
      q.onerror=()=>reject(q.error);
      tx.oncomplete=()=>resolve(n);
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error);
    });
  }

  function txRewriteRuns(b){
    const db=S.db;
    if(!db||!db.objectStoreNames.contains("runs"))return Promise.resolve(0);
    return new Promise((resolve,reject)=>{
      let n=0;
      const tx=db.transaction("runs","readwrite"),os=tx.objectStore("runs"),q=os.openCursor();
      q.onsuccess=e=>{
        const c=e.target.result;
        if(!c)return;
        try{
          const clean=deepSanitize(c.value,b);
          if(JSON.stringify(clean)!==JSON.stringify(c.value)){c.update(clean);n++;}
        }catch{}
        c.continue();
      };
      q.onerror=()=>reject(q.error);
      tx.oncomplete=()=>resolve(n);
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error);
    });
  }

  async function purgeMeta(b){
    const keys=[
      "selectionSnapshot","selectionTableState","knSnapshot","pendingDataRepair",
      "sDeterministicBaseFromKnR34","r33SelectionAudit","sDeterminismAuditR34"
    ];
    for(const key of keys){
      try{
        const row=await A.dbGet("meta",key);
        if(row?.value!=null){
          const clean=deepSanitize(row.value,b);
          await A.dbPut("meta",{key,value:clean,updatedAt:apiNow()});
        }
      }catch{}
    }
  }

  async function purgeRawDB(b){
    if(!b.size||typeof indexedDB==="undefined")return;
    await new Promise(resolve=>{
      const q=indexedDB.open("aurum-canonical-raw-r60");
      q.onerror=()=>resolve();
      q.onsuccess=()=>{
        const db=q.result;
        try{
          const names=[...db.objectStoreNames];
          const tx=db.transaction(names.filter(x=>["bars","heads","meta"].includes(x)),"readwrite");
          if(names.includes("bars")){
            const os=tx.objectStore("bars");
            if(os.indexNames.contains("sym")){
              const ix=os.index("sym");
              for(const sym of b){
                const r=ix.openCursor(IDBKeyRange.only(sym));
                r.onsuccess=e=>{const c=e.target.result;if(c){c.delete();c.continue();}};
              }
            }
          }
          if(names.includes("heads"))for(const sym of b)tx.objectStore("heads").delete(sym);
          if(names.includes("meta"))for(const sym of b)tx.objectStore("meta").delete(`sym:${sym}`);
          tx.oncomplete=()=>{db.close();resolve();};
          tx.onerror=()=>{db.close();resolve();};
          tx.onabort=()=>{db.close();resolve();};
        }catch{try{db.close()}catch{}resolve();}
      };
    });
  }

  function purgeKnLocalLedger(b){
    try{
      const key="aurum.kn.ledger.v117",raw=localStorage.getItem(key);
      if(raw){
        const obj=JSON.parse(raw),clean=deepSanitize(obj,b);
        localStorage.setItem(key,JSON.stringify(clean));
      }
    }catch{}
  }

  async function purgeBlockedUniverse({reason="USER"}={}){
    const b=blocked();
    sanitizeMemory();
    if(!b.size){
      try{globalThis.renderCurrentPagePreservingView?.()}catch{}
      return {blocked:0,deleted:0};
    }

    let deleted=0;
    const directStores=["records","behaviorProfiles","stagingRecords","dataIssues","bars","actions","criteria","genomeHistory","aiCandidates","aiEvents","universeHistory","snapshots"];
    for(const store of directStores){
      try{
        deleted+=await txDeleteWhere(store,(v,k)=>{
          const sym=norm(v?.sym??v?.symbol??v?.code??v?.record?.sym??"");
          if(sym&&b.has(sym))return true;
          if(store==="records"||store==="behaviorProfiles")return b.has(norm(k));
          return false;
        });
      }catch{}
    }
    try{await txRewriteRuns(b)}catch{}
    try{await purgeMeta(b)}catch{}
    try{await purgeRawDB(b)}catch{}
    purgeKnLocalLedger(b);
    for(const sym of b){try{await globalThis.AurumQualifiedBuySell?.purgeSymbol?.(sym)}catch{}try{await globalThis.AurumPortfolio?.purgeSymbol?.(sym)}catch{}}

    /* Re-apply memory sanitation after persistent purge. */
    sanitizeMemory();

    try{
      await A.dbPut("meta",{key:"blockedUniverseState",value:{
        version:VERSION,blocked:[...b],reason,updatedAt:apiNow(),
        rule:"HARD_UNIVERSE_EXCLUSION_BEFORE_FETCH_STAGE_DB_MODEL_LEARNING_AI"
      },updatedAt:apiNow()});
    }catch{}

    try{globalThis.renderCurrentPagePreservingView?.()}catch{
      try{globalThis.render?.()}catch{}
    }
    return {blocked:b.size,deleted};
  }

  async function addBlocked(raw){
    const list=uniq(String(raw??"").split(/[\s,;]+/));
    if(!list.length)throw new Error("En az bir hisse kodu girin");
    if(!confirm(`${list.join(", ")} yasaklansın, hisse evreninden ve mevcut analitik kayıtlardan kaldırılsın mı?`))return false;
    const cur=new Set(uniq(S.settings[SETTING_KEY]||[]));
    for(const s of list)cur.add(s);
    S.settings[SETTING_KEY]=[...cur].sort((a,b)=>a.localeCompare(b,"tr"));
    await saveSetting();
    const r=await purgeBlockedUniverse({reason:"BLOCK"});
    refreshSettingsView();
    try{globalThis.showAurumNotice?.(`${list.join(", ")} yasaklandı · evrenden çıkarıldı`,"success",3200)}catch{}
    return r;
  }

  async function removeBlocked(sym){
    const s=norm(sym),cur=new Set(uniq(S.settings[SETTING_KEY]||[]));
    if(!s)return false;if(!confirm(`${s} yasaklı listeden çıkarılsın mı?`))return false;
    cur.delete(s);
    S.settings[SETTING_KEY]=[...cur].sort((a,b)=>a.localeCompare(b,"tr"));
    await saveSetting();
    refreshSettingsView();
    try{globalThis.showAurumNotice?.(`${s} yasaktan çıkarıldı · sonraki Veriler çekiminde yeniden alınabilir`,"success",3600)}catch{}
    return true;
  }

  async function clearBlocked(){
    if(!confirm('Tüm yasaklı hisseler listeden çıkarılsın mı?'))return false;
    S.settings[SETTING_KEY]=[];
    await saveSetting();
    refreshSettingsView();
    try{globalThis.showAurumNotice?.("Yasaklı hisse listesi temizlendi. Veriler sonraki çekimde yeniden alınabilir.","success",3600)}catch{}
    return true;
  }

  function blockedListPageMarkup(){
    const list=uniq(S.settings[SETTING_KEY]||[]);
    return `<section class="aurum-blocked-page" role="dialog" aria-modal="true" aria-label="Yasaklı Hisseler">
      <header class="aurum-blocked-page-head">
        <div><strong>Yasaklı Hisseler</strong><small>${list.length} hisse</small></div>
        <button class="ghost-btn compact-btn" type="button" onclick="AurumBlockedUniverse.closeList()">Kapat</button>
      </header>
      <div class="aurum-blocked-mini-list">
        ${list.length
          ? list.map(sym=>`<div class="aurum-blocked-mini-row"><span>${esc(sym)}</span><button type="button" onclick="AurumBlockedUniverse.remove('${esc(sym)}').catch(e=>AurumBlockedUniverse.error(e))">çıkar</button></div>`).join("")
          : `<small class="muted">Yasaklı hisse yok.</small>`}
      </div>
    </section>`;
  }

  function openBlockedList(){
    let host=document.getElementById("aurumBlockedUniverseOverlay");
    if(!host){
      host=document.createElement("div");
      host.id="aurumBlockedUniverseOverlay";
      host.className="aurum-blocked-overlay";
      host.addEventListener("click",e=>{if(e.target===host)closeBlockedList()});
      document.body.appendChild(host);
    }
    host.innerHTML=blockedListPageMarkup();
    host.style.display="flex";
  }

  function closeBlockedList(){
    const host=document.getElementById("aurumBlockedUniverseOverlay");
    if(host)host.style.display="none";
  }

  function moduleMarkup(){
    const n=uniq(S.settings[SETTING_KEY]||[]).length;
    return `<details class="card gold-edge aurum-settings-details" id="aurumBlockedUniverseModule">
      <summary class="aurum-settings-summary">
        <div><strong>Yasaklı Hisseler · Hisse Evreni Filtresi</strong><small>${n} yasaklı · çekimden önce kesin dışlama</small></div>
        <span class="aurum-details-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div class="aurum-settings-details-body">
        <p class="muted">Buraya eklenen hisseler Aurum B açısından hisse evreninde yok kabul edilir. Veri çekim kuyruğuna alınmaz; staging ve ana veri deposuna yazılmaz; Veriler, Kn, K_Tarihsel, S, öğrenme ve AI hesaplarında kullanılmaz. Yasaklama anında mevcut analitik kayıtları da temizlenir.</p>
        <div class="form-grid">
          <div class="field" style="grid-column:1/-1">
            <label>Yasaklanacak hisse kodu / kodları</label>
            <input id="aurumBlockedSymbolInput" autocomplete="off" spellcheck="false" placeholder="Örn. THYAO, ASELS, TUPRS">
            <small>Birden çok kod için boşluk, virgül veya noktalı virgül kullanabilirsiniz.</small>
          </div>
          <div class="actions" style="grid-column:1/-1">
            <button class="gold-btn" type="button" onclick="AurumBlockedUniverse.addFromInput()">Yasakla ve Evrenden Çıkar</button>
            ${n?`<button class="ghost-btn" type="button" onclick="AurumBlockedUniverse.clear().catch(e=>AurumBlockedUniverse.error(e))">Tüm Yasakları Kaldır</button>`:""}
          </div>
        </div>
        <div class="aurum-blocked-status">
          <div><b>Yasaklı liste</b><span class="badge ${n?"warn":"ok"}">${n}</span></div>
          <button class="ghost-btn compact-btn" type="button" onclick="AurumBlockedUniverse.openList()">Listeyi Aç</button>
        </div>
        <small class="muted">Yasaktan çıkarılan hissenin daha önce silinen verisi geri canlandırılmaz; bir sonraki Veriler çekiminde kaynaktan yeniden alınır. Bu, eski/stale verinin yanlışlıkla tekrar kullanılmasını önler.</small>
      </div>
    </details>`;
  }

  const baseSettingsPage=globalThis.settingsPage;
  if(typeof baseSettingsPage==="function"){
    globalThis.__AURUM_BASE_SETTINGS_PAGE=globalThis.__AURUM_BASE_SETTINGS_PAGE||baseSettingsPage;
    globalThis.settingsPage=function blockedUniverseSettingsPage(){
      return moduleMarkup()+globalThis.__AURUM_BASE_SETTINGS_PAGE();
    };
    globalThis.settingsSub=globalThis.settingsPage;
  }

  function refreshSettingsView(){
    if(S.page==="settings"){
      try{globalThis.render?.()}catch{}
    }
  }

  function error(e){
    try{globalThis.showAurumNotice?.(e?.message||String(e),"error",4200)}
    catch{console.error(e)}
  }

  try{
    if(!document.getElementById("aurumBlockedUniverseCompactCss")){
      const st=document.createElement("style");
      st.id="aurumBlockedUniverseCompactCss";
      st.textContent=`
        .aurum-blocked-status{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px}
        .aurum-blocked-status>div{display:flex;align-items:center;gap:6px}
        .aurum-blocked-overlay{position:fixed;inset:0;z-index:99999;background:rgba(2,8,20,.84);display:none;align-items:center;justify-content:center;padding:12px}
        .aurum-blocked-page{width:min(560px,96vw);max-height:84vh;overflow:hidden;background:#071327;border:1px solid rgba(214,173,96,.42);border-radius:11px;padding:9px;box-shadow:0 18px 60px rgba(0,0,0,.45)}
        .aurum-blocked-page-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,.08)}
        .aurum-blocked-page-head>div{display:flex;flex-direction:column;gap:1px}
        .aurum-blocked-page-head strong{font-size:11px;line-height:1.1}
        .aurum-blocked-page-head small{font-size:7px;line-height:1;opacity:.68}
        .aurum-blocked-mini-list{max-height:72vh;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:1px 4px;padding-top:6px}
        .aurum-blocked-mini-row{display:flex;align-items:center;justify-content:space-between;gap:2px;min-width:0;padding:2px 2px;border-bottom:1px solid rgba(255,255,255,.04);font-size:7px;line-height:1}
        .aurum-blocked-mini-row span{font-size:7px;line-height:1;font-weight:650;letter-spacing:0;overflow:hidden;text-overflow:ellipsis}
        .aurum-blocked-mini-row button{font-size:6px;line-height:1;padding:2px;border:0;border-radius:3px;background:rgba(255,255,255,.07);color:inherit;white-space:nowrap}
      `;
      document.head.appendChild(st);
    }
  }catch{}

  globalThis.AurumBlockedUniverse=Object.freeze({
    version:VERSION,
    list:()=>uniq(S.settings[SETTING_KEY]||[]),
    has:s=>isBlocked(s),
    add:raw=>addBlocked(raw),
    addFromInput:async()=>{
      const el=document.getElementById("aurumBlockedSymbolInput");
      const v=el?.value||"";
      const r=await addBlocked(v);
      if(el)el.value="";
      return r;
    },
    remove:s=>removeBlocked(s),
    clear:()=>clearBlocked(),
    purge:()=>purgeBlockedUniverse({reason:"MANUAL_PURGE"}),
    openList:openBlockedList,
    closeList:closeBlockedList,
    error
  });

  globalThis.AURUM_BLOCKED_UNIVERSE_V1={
    version:VERSION,
    refresh:()=>{sanitizeMemory();refreshSettingsView();}
  };


  /* B36 — one-time default exclusions requested by the user.
     Applied only once. If the user later removes one, it is NOT silently re-added. */
  const B36_DEFAULT_BLOCKS=Object.freeze([
    /* alcohol / directly related corporate group */
    "AEFES","AGHOL",
    /* listed sports clubs */
    "BJKAS","FENER","GSRAY","TSPOR",
    /* İş Bankası A/B/C + founder share */
    "ISATR","ISBTR","ISKUR",
    /* QNB listed group */
    "QNBTR","QNBFF","QNBFK","QNBVK",
    /* verified historical/current concordatum or bankruptcy cases */
    "MEGAP","YGYO","ATEKS","TRILC","BARMA"
  ]);
  const B36_DEFAULT_REASON=Object.freeze({
    AEFES:"ALKOL",AGHOL:"ALKOL_İLİŞKİLİ",
    BJKAS:"SPOR",FENER:"SPOR",GSRAY:"SPOR",TSPOR:"SPOR",
    ISATR:"İŞBANK_A",ISBTR:"İŞBANK_B",ISKUR:"İŞBANK_KURUCU",
    QNBTR:"QNB",QNBFF:"QNB",QNBFK:"QNB",QNBVK:"QNB",
    MEGAP:"KONKORDATO_GEÇMİŞİ",YGYO:"KONKORDATO_IFLAS_GEÇMİŞİ",
    ATEKS:"KONKORDATO_GEÇMİŞİ",TRILC:"KONKORDATO",BARMA:"KONKORDATO"
  });

  async function b363ForceUnblockIsctrCcola(){
    S.settings=S.settings||{};
    const cur=uniq(S.settings[SETTING_KEY]||[]).filter(x=>x!=="ISCTR"&&x!=="CCOLA");
    S.settings[SETTING_KEY]=cur;
    if(S.settings.blockedDefaultReasonsB36&&typeof S.settings.blockedDefaultReasonsB36==="object"){
      delete S.settings.blockedDefaultReasonsB36.ISCTR;
      delete S.settings.blockedDefaultReasonsB36.CCOLA;
    }
    await saveSetting();
    return true;
  }

  async function b36SeedDefaultsOnce(){
    if(S.settings?.blockedDefaultsB36Applied)return false;
    const cur=new Set(uniq(S.settings[SETTING_KEY]||[]));
    B36_DEFAULT_BLOCKS.forEach(s=>cur.add(s));
    S.settings[SETTING_KEY]=[...cur].sort((a,b)=>a.localeCompare(b,"tr"));
    S.settings.blockedDefaultsB36Applied=true;
    S.settings.blockedDefaultReasonsB36={...B36_DEFAULT_REASON};
    await saveSetting();
    return true;
  }

  function b36StripMemoryFor(sym){
    const code=norm(sym),b=new Set([code]);
    S.records=(S.records||[]).filter(x=>norm(x?.sym)!==code);
    S.recordMap=new Map((S.records||[]).map(x=>[x.sym,x]));
    for(const key of ["scores","discoveryScores"]){
      if(S[key]&&typeof S[key]==="object"){
        for(const k of Object.keys(S[key]))if(Array.isArray(S[key][k]))
          S[key][k]=S[key][k].filter(x=>norm(x?.sym??x?.record?.sym)!==code);
      }
    }
    if(Array.isArray(S.selection))S.selection=S.selection.filter(x=>norm(x?.sym)!==code);
    if(Array.isArray(S.__pendingSelection))S.__pendingSelection=S.__pendingSelection.filter(x=>norm(x?.sym)!==code);
    if(S.modelBySym instanceof Map)S.modelBySym.delete(code);
    if(S.behaviorProfiles instanceof Map)S.behaviorProfiles.delete(code);
    if(Array.isArray(S.runs))S.runs=S.runs.map(r=>deepSanitize(r,b));
    if(Array.isArray(S.ai?.candidates))S.ai.candidates=S.ai.candidates.filter(x=>norm(x?.sym??x?.symbol)!==code);
    S.__modelCache=null;
    S.__pendingKnSnapshot=null;
  }

  async function b36DeleteOnly(sym){
    const code=norm(sym);
    if(!code)throw new Error("Hisse kodu bulunamadı");
    if(!confirm(`${code} yerel verilerden ve türetilmiş tablolardan silinsin mi?\n\nBu işlem hisseyi yasaklamaz; sonraki Veriler aktarımında tekrar gelebilir.`))return false;
    const b=new Set([code]);
    let deleted=0;
    const stores=["records","behaviorProfiles","stagingRecords","dataIssues","bars","actions","criteria","genomeHistory","aiCandidates","aiEvents","universeHistory","snapshots"];
    for(const store of stores){
      try{
        deleted+=await txDeleteWhere(store,(v,k)=>{
          const s=norm(v?.sym??v?.symbol??v?.code??v?.record?.sym??"");
          if(s===code)return true;
          if((store==="records"||store==="behaviorProfiles")&&norm(k)===code)return true;
          return false;
        });
      }catch{}
    }
    try{await txRewriteRuns(b)}catch{}
    try{await purgeMeta(b)}catch{}
    try{await purgeRawDB(b)}catch{}
    purgeKnLocalLedger(b);
    try{await globalThis.AurumQualifiedBuySell?.purgeSymbol?.(code)}catch{}try{await globalThis.AurumPortfolio?.purgeSymbol?.(code)}catch{}
    b36StripMemoryFor(code);
    try{globalThis.renderCurrentPagePreservingView?.()}catch{try{globalThis.render?.()}catch{}}
    try{globalThis.showAurumNotice?.(`${code} silindi · yasaklanmadı · sonraki veri çekiminde geri gelebilir`,"success",3800)}catch{}
    return {deleted,code};
  }

  function b36CardActionMarkup(sym){
    const code=norm(sym),blockedNow=isBlocked(code);
    return `<div class="card aurum-block-card-actions">
      <div><strong>Hisse evreni</strong><small>${blockedNow?"YASAKLI · hiçbir hesapta kullanılmaz":"AKTİF · hisse evreninde"}</small></div>
      <div class="actions">
        ${blockedNow
          ? `<button class="gold-btn" type="button" onclick="AurumBlockedUniverse.remove('${esc(code)}').then(()=>{try{document.getElementById('detailDialog')?.close()}catch{}}).catch(AurumBlockedUniverse.error)">Yasağı Kaldır</button>`
          : `<button class="danger-btn" type="button" onclick="AurumBlockedUniverse.add('${esc(code)}').then(()=>{try{document.getElementById('detailDialog')?.close()}catch{}}).catch(AurumBlockedUniverse.error)">Yasakla</button>`}
        <button class="ghost-btn" type="button" onclick="AurumBlockedUniverse.deleteOnly('${esc(code)}').then(()=>{try{document.getElementById('detailDialog')?.close()}catch{}}).catch(AurumBlockedUniverse.error)">Sil</button>
      </div>
    </div>`;
  }

  function b36DecorateStockCard(sym){
    const body=document.querySelector("#dialogBody");
    if(!body)return;
    body.querySelector(".aurum-block-card-actions")?.remove();
    const card=body.querySelector(".aurum-stock-card");
    if(card)card.insertAdjacentHTML("beforeend",b36CardActionMarkup(sym));
  }

  const b36BaseShowStock=globalThis.showStockCard||globalThis.showDetail;
  if(typeof b36BaseShowStock==="function"){
    const wrapped=function b36ShowStockCard(sym){
      const r=b36BaseShowStock.call(this,sym);
      queueMicrotask(()=>b36DecorateStockCard(sym));
      return r;
    };
    globalThis.showStockCard=wrapped;
    globalThis.showDetail=wrapped;
    globalThis.showCompanyName=wrapped;
  }

  function b36ClosePressMenu(){
    const h=document.getElementById("aurumStockPressMenu");
    if(h)h.remove();
  }
  function b36OpenPressMenu(sym,x,y){
    const code=norm(sym);if(!code)return;
    b36ClosePressMenu();
    const blockedNow=isBlocked(code),host=document.createElement("div");
    host.id="aurumStockPressMenu";host.className="aurum-press-menu-backdrop";
    host.innerHTML=`<div class="aurum-press-menu" style="left:${Math.max(8,Math.min(window.innerWidth-210,Number(x)||20))}px;top:${Math.max(8,Math.min(window.innerHeight-190,Number(y)||80))}px">
      <b>${esc(code)}</b>
      <button type="button" ${blockedNow?"disabled":""} data-act="block">Yasakla</button>
      <button type="button" ${blockedNow?"":"disabled"} data-act="unblock">Yasağı kaldır</button>
      <button type="button" data-act="delete">Sil</button>
      <button type="button" data-act="cancel">Vazgeç</button>
    </div>`;
    host.addEventListener("click",async e=>{
      if(e.target===host){b36ClosePressMenu();return}
      const act=e.target?.dataset?.act;if(!act)return;
      try{
        if(act==="block")await addBlocked(code);
        else if(act==="unblock")await removeBlocked(code);
        else if(act==="delete")await b36DeleteOnly(code);
      }catch(err){error(err)}
      b36ClosePressMenu();
    });
    document.body.appendChild(host);
  }

  if(!globalThis.__AURUM_B36_LONGPRESS){
    globalThis.__AURUM_B36_LONGPRESS=true;
    let press=null,suppressUntil=0;
    document.addEventListener("pointerdown",e=>{
      const t=e.target?.closest?.(".aurum-symbol-link");if(!t)return;
      press={t,code:norm(t.textContent),x:e.clientX,y:e.clientY,at:Date.now(),id:e.pointerId};
    },true);
    document.addEventListener("pointerup",e=>{
      if(!press||press.id!==e.pointerId)return;
      const p=press;press=null;
      if(Date.now()-p.at>=520){
        suppressUntil=Date.now()+700;
        e.preventDefault();e.stopPropagation();
        b36OpenPressMenu(p.code,p.x,p.y);
      }
    },true);
    document.addEventListener("pointercancel",()=>{press=null},true);
    document.addEventListener("click",e=>{
      if(Date.now()<suppressUntil&&e.target?.closest?.(".aurum-symbol-link")){
        e.preventDefault();e.stopImmediatePropagation();
      }
    },true);
    document.addEventListener("contextmenu",e=>{
      const t=e.target?.closest?.(".aurum-symbol-link");if(!t)return;
      e.preventDefault();b36OpenPressMenu(norm(t.textContent),e.clientX,e.clientY);
    },true);
  }

  try{
    if(!document.getElementById("aurumB36PressCss")){
      const st=document.createElement("style");st.id="aurumB36PressCss";st.textContent=`
      .aurum-block-card-actions{margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:8px}
      .aurum-block-card-actions>div:first-child{display:flex;flex-direction:column;gap:2px}
      .aurum-press-menu-backdrop{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.18)}
      .aurum-press-menu{position:fixed;width:196px;padding:7px;background:#071327;border:1px solid rgba(214,173,96,.55);border-radius:9px;box-shadow:0 14px 45px rgba(0,0,0,.52);display:flex;flex-direction:column;gap:4px}
      .aurum-press-menu b{font-size:10px;padding:2px 3px 5px}
      .aurum-press-menu button{font-size:10px;text-align:left;padding:7px;border-radius:6px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.055);color:inherit}
      .aurum-press-menu button:disabled{opacity:.34}
      `;document.head.appendChild(st);
    }
  }catch{}

  /* Make the new operations public for inline card/menu buttons. */
  try{
    const old=globalThis.AurumBlockedUniverse;
    globalThis.AurumBlockedUniverse=Object.freeze({
      ...old,
      deleteOnly:b36DeleteOnly,
      openPressMenu:b36OpenPressMenu,
      defaults:()=>B36_DEFAULT_BLOCKS.map(sym=>({sym,reason:B36_DEFAULT_REASON[sym]||"VARSAYILAN"}))
    });
  }catch{}


  /* Apply existing persisted list immediately after update activation/startup. */
  queueMicrotask(async()=>{try{for(let i=0;i<120&&!S.db;i++)await new Promise(r=>setTimeout(r,100));if(!S.db)return;await b363ForceUnblockIsctrCcola();await b36SeedDefaultsOnce();await b363ForceUnblockIsctrCcola();await purgeBlockedUniverse({reason:"EMBEDDED_B36_STARTUP"});}catch(e){console.warn("B36 universe startup",e)}});

  try{
    S.blockedUniverse={version:VERSION,active:true,count:uniq(S.settings[SETTING_KEY]||[]).length};
  }catch{}
})(AurumUpdateAPI);

/* ===== AURUM AL/SAT qualified lifecycle — isolated additive patch =====
   Rule: a symbol must remain in the final table into a later trading date before BUY.
   Only a previously qualified BUY may become SELL after leaving the table.
   No model, Kn, K_Tarihsel, ranking or data formula is modified here. */
(function installQualifiedBuySellCard(){
  'use strict';
  const KEY='aurum.qualified-buy-sell.v2',LEGACY_KEY='aurum.qualified-buy-sell.v1',VERSION=2,EPS=1e-9;
  const norm=x=>String(x||'').trim().toUpperCase();
  const uniq=a=>[...new Set((Array.isArray(a)?a:[]).map(norm).filter(Boolean))];
  function baseState(){return {version:VERSION,items:{},pre16ByDate:{},updatedAt:null}}
  function load(){try{let x=JSON.parse(localStorage.getItem(KEY)||'null');if(x?.version===VERSION&&x.items){x.pre16ByDate=x.pre16ByDate||{};return x;}const old=JSON.parse(localStorage.getItem(LEGACY_KEY)||'null');if(old?.items){x=baseState();for(const [sym,e] of Object.entries(old.items)){const k=norm(sym);if(!k)continue;x.items[k]={...e,sym:k,qualificationVersion:2,updateTokens:[],maxPrice:Number(e.maxPrice||e.buyPrice)||null,aboveEntrySeen:Number(e.maxPrice||0)>Number(e.buyPrice||0),sExited:false,activeProfitLockPct:null};}save(x);return x}}catch{}return baseState()}
  function save(x){x.version=VERSION;x.updatedAt=new Date().toISOString();try{localStorage.setItem(KEY,JSON.stringify(x));localStorage.removeItem(LEGACY_KEY)}catch{}try{dbPut('meta',{key:'qualifiedBuySellV2',value:x,updatedAt:x.updatedAt})}catch{}return x}
  function rec(sym){const k=norm(sym);try{return state.recordMap?.get?.(k)||state.records?.find?.(x=>x.sym===k)||state.selection?.find?.(x=>x.sym===k)||null}catch{return null}}
  function price(sym){const r=rec(sym),n=Number(r?.livePrice??r?.close??r?.price??r?.series?.close?.at(-1));return Number.isFinite(n)&&n>0?n:null}
  function marketAt(sym){const r=rec(sym),v=r?.marketDataAt||r?.provenance?.marketAt||null;return v&&Number.isFinite(Date.parse(v))?v:null}
  function jobToken(job){const x=job?.dataSnapshotId||job?.id||null;return x?String(x):null}
  function trp(v){if(!v)return null;const ps=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(v)),o={};for(const p of ps)o[p.type]=p.value;return {date:`${o.year}-${o.month}-${o.day}`,weekday:o.weekday,h:Number(o.hour),m:Number(o.minute),mins:Number(o.hour)*60+Number(o.minute)}}
  function fullHoliday(date){try{return schedulerIsHolidayDate(date)}catch{const d=new Date(`${date}T12:00:00+03:00`),p=trp(d);return p?.weekday==='Sat'||p?.weekday==='Sun'}}
  function nextSessionDate(date){let d=new Date(`${date}T12:00:00+03:00`);for(let i=0;i<14;i++){d=new Date(d.getTime()+86400000);const p=trp(d);if(p&&!fullHoliday(p.date))return p.date}return null}
  function sessionMinutesBetween(startIso,endIso,entryMode){const a=trp(startIso),b=trp(endIso);if(!a||!b||b.date<a.date)return 0;let total=0,d=new Date(`${a.date}T12:00:00+03:00`);for(let guard=0;guard<40;guard++){const p=trp(d);if(!p||p.date>b.date)break;if(!fullHoliday(p.date)){let from=600,to=1080;if(p.date===a.date){if(entryMode==='OUT_AFTER')from=1080;else if(entryMode==='OUT_BEFORE')from=600;else from=Math.max(600,a.mins)}if(p.date===b.date)to=Math.min(1080,b.mins);if(to>from)total+=to-from}d=new Date(d.getTime()+86400000)}return total}
  function technicalStop(sym,entry){const r=rec(sym),z=r?.series||{},h=(z.calcHigh||z.high||[]).map(Number),l=(z.calcLow||z.low||[]).map(Number),c=(z.calcClose||z.close||[]).map(Number),n=Math.min(h.length,l.length,c.length);let atr=null,support=null;if(n>=3){const trs=[];for(let i=Math.max(1,n-14);i<n;i++){const hi=h[i],lo=l[i],pc=c[i-1];if(Number.isFinite(hi)&&Number.isFinite(lo)&&Number.isFinite(pc))trs.push(Math.max(hi-lo,Math.abs(hi-pc),Math.abs(lo-pc)))}if(trs.length)atr=trs.reduce((a,b)=>a+b,0)/trs.length;const lows=l.slice(Math.max(0,n-10),n).filter(x=>Number.isFinite(x)&&x>0&&x<entry);if(lows.length)support=Math.min(...lows)}let stop=Number.isFinite(atr)?entry-1.5*atr:entry*.95;if(Number.isFinite(support))stop=Math.max(stop,support*.995);stop=Math.min(stop,entry*.99);stop=Math.max(stop,entry*.88);return {price:stop,method:Number.isFinite(atr)&&Number.isFinite(support)?'10G destek + 1,5 ATR':'1,5 ATR / %5 yedek'}}
  function profitLockBufferPct(lockPct){const x=Number(lockPct);if(x<=5)return 1;if(x<=20)return 2;if(x<=30)return 3;if(x<=40)return 4;if(x<=50)return 5;if(x<=60)return 6;if(x<=70)return 7;if(x<=80)return 8;if(x<=100)return 9;return 10}
  function highestArmedLock(maxReturn){let armed=null;for(let l=5;l<=500;l+=5){if(maxReturn+EPS>=l+profitLockBufferPct(l))armed=l;else break}return armed}
  function nextLockPct(e){const a=Number(e?.activeProfitLockPct);return Number.isFinite(a)&&a>=5?a+5:5}
  function buyEntry(e,sym,td,now,p){const st=technicalStop(sym,p);Object.assign(e,{status:'BUY',buyTradeDate:td,buyAt:now,buyPrice:p,stopLossPrice:st.price,stopMethod:st.method,maxPrice:p,aboveEntrySeen:false,sExited:false,sExitedAt:null,activeProfitLockPct:null,maxReturnPct:0,lastProcessedToken:null});return e}
  function tradeFmt(v){const n=Number(v);return Number.isFinite(n)&&n>0?n.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—'}
  function pctFmt(v){const n=Number(v);return Number.isFinite(n)?`${n>0?'+':n<0?'−':''}${Math.abs(n).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}%`:'—'}
  function currentTradingDate(){const cal=kh117CanonicalMarketCalendar();return cal?.dates?.at(-1)||null}
  function metrics(e){const last=price(e.sym),entry=Number(e.buyPrice),ret=last>0&&entry>0?100*(last/entry-1):null,active=Number(e.activeProfitLockPct),next=nextLockPct(e),hfPct=Number.isFinite(active)&&active>=5?active:next;return {last,ret,stop:Number(e.stopLossPrice)||null,activeLockPct:Number.isFinite(active)?active:null,nextLockPct:next,hfPrice:entry>0?entry*(1+hfPct/100):null}}
  async function advance(job){const td=currentTradingDate(),token=jobToken(job);if(!td||!token)return {buys:[],sells:[],state:load(),skipped:'NO_REAL_JOB_TOKEN_OR_SESSION'};const q=load(),now=new Date().toISOString(),current=uniq((state.selection||[]).map(x=>x.sym)),set=new Set(current),buys=[],sells=[];
    q.pre16ByDate=q.pre16ByDate||{};
    const snapshot=current.map(sym=>trp(marketAt(sym))).filter(Boolean).sort((a,b)=>a.date===b.date?a.mins-b.mins:a.date.localeCompare(b.date)).at(-1)||null;
    if(snapshot&&!fullHoliday(snapshot.date)&&snapshot.mins<960){const d=q.pre16ByDate[snapshot.date]||(q.pre16ByDate[snapshot.date]={observed:true,members:[]});d.observed=true;d.members=uniq([...(d.members||[]),...current]);for(const k of Object.keys(q.pre16ByDate).sort().slice(0,-4))delete q.pre16ByDate[k]}
    const lateEligible=(sym,mp)=>!!(mp&&mp.mins>=960&&mp.mins<=1080&&q.pre16ByDate?.[mp.date]?.observed&&!new Set(q.pre16ByDate[mp.date].members||[]).has(sym));
    const noteLate=(e,sym,mp)=>{if(!lateEligible(sym,mp))return false;if(e.lateTradeDate!==mp.date){e.lateTradeDate=mp.date;e.lateUpdateTokens=[]}e.lateUpdateTokens=Array.isArray(e.lateUpdateTokens)?e.lateUpdateTokens:[];if(!e.lateUpdateTokens.includes(token))e.lateUpdateTokens.push(token);e.lateUpdateTokens=e.lateUpdateTokens.slice(-8);return e.lateUpdateTokens.length>=2};
    for(const sym of current){let e=q.items[sym],mkt=marketAt(sym),mp=trp(mkt);if(!e||e.status==='SELL'){e=q.items[sym]={sym,status:'WATCHING',firstTradeDate:td,firstSeenAt:now,firstMarketAt:mkt,entryJobToken:token,updateTokens:[],entryMode:mp&&!fullHoliday(mp.date)&&mp.mins>=600&&mp.mins<1080?'IN_SESSION':mp&&mp.mins<600?'OUT_BEFORE':'OUT_AFTER',qualificationVersion:2,lastProcessedToken:token,lateTradeDate:null,lateUpdateTokens:[]};noteLate(e,sym,mp);continue}
      if(e.status==='WATCHING'){
        if(e.lastProcessedToken===token)continue;e.lastProcessedToken=token;if(token!==e.entryJobToken&&!e.updateTokens.includes(token))e.updateTokens.push(token);e.updateTokens=e.updateTokens.slice(-16);e.lastSeenAt=now;e.lastMarketAt=mkt;
        const lateReady=noteLate(e,sym,mp);if(lateReady){const p=price(sym);if(p)buyEntry(e,sym,td,now,p),buys.push(sym);continue}
        if(!mkt||!e.firstMarketAt)continue;
        const need=e.entryMode==='IN_SESSION'?4:2,minutes=sessionMinutesBetween(e.firstMarketAt,mkt,e.entryMode),needMinutes=e.entryMode==='IN_SESSION'?240:120;if(e.updateTokens.length>=need&&minutes>=needMinutes){const p=price(sym);if(p)buyEntry(e,sym,td,now,p),buys.push(sym)}continue
      }
      if(e.status==='BUY'){
        if(e.lastProcessedToken===token)continue;e.lastProcessedToken=token;const p=price(sym);if(!p)continue;e.maxPrice=Math.max(Number(e.maxPrice)||p,p);e.aboveEntrySeen=e.aboveEntrySeen||p>Number(e.buyPrice)+EPS;e.maxReturnPct=100*(e.maxPrice/Number(e.buyPrice)-1);const armed=highestArmedLock(e.maxReturnPct);if(Number.isFinite(armed)&&(e.activeProfitLockPct==null||armed>e.activeProfitLockPct))e.activeProfitLockPct=armed;const ret=100*(p/Number(e.buyPrice)-1),stop=Number(e.stopLossPrice);
        if(stop>0&&p<=stop+EPS){Object.assign(e,{status:'SELL',sellTradeDate:td,sellAt:now,sellPrice:p,exitReason:'ZARAR_KES'});sells.push(sym);continue}
        if(Number.isFinite(e.activeProfitLockPct)&&ret+EPS<e.activeProfitLockPct){Object.assign(e,{status:'SELL',sellTradeDate:td,sellAt:now,sellPrice:p,exitReason:'KAR_KILIDI'});sells.push(sym);continue}
      }
    }
    for(const [sym,e] of Object.entries(q.items||{})){if(set.has(sym))continue;if(e?.status==='WATCHING'){delete q.items[sym];continue}if(e?.status!=='BUY')continue;if(e.lastProcessedToken===token)continue;e.lastProcessedToken=token;e.sExited=true;e.sExitedAt=e.sExitedAt||now;const p=price(sym);if(p){e.maxPrice=Math.max(Number(e.maxPrice)||p,p);e.aboveEntrySeen=e.aboveEntrySeen||p>Number(e.buyPrice)+EPS;e.maxReturnPct=100*(e.maxPrice/Number(e.buyPrice)-1);const armed=highestArmedLock(e.maxReturnPct);if(Number.isFinite(armed)&&(e.activeProfitLockPct==null||armed>e.activeProfitLockPct))e.activeProfitLockPct=armed;const stop=Number(e.stopLossPrice),ret=100*(p/Number(e.buyPrice)-1);if(stop>0&&p<=stop+EPS){Object.assign(e,{status:'SELL',sellTradeDate:td,sellAt:now,sellPrice:p,exitReason:'ZARAR_KES'});sells.push(sym)}else if(Number.isFinite(e.activeProfitLockPct)&&ret+EPS<e.activeProfitLockPct){Object.assign(e,{status:'SELL',sellTradeDate:td,sellAt:now,sellPrice:p,exitReason:'KAR_KILIDI'});sells.push(sym)}else if(e.aboveEntrySeen&&p<=Number(e.buyPrice)+EPS){Object.assign(e,{status:'SELL',sellTradeDate:td,sellAt:now,sellPrice:p,exitReason:'S_CIKIS_AL_FIYAT_DONUS'});sells.push(sym)}}}
    save(q);if(buys.length||sells.length){const body=`${buys.length?`AL: ${buys.join(', ')}`:''}${buys.length&&sells.length?' · ':''}${sells.length?`SAT: ${sells.join(', ')}`:''}`;try{const qp=new URLSearchParams({cmd:'notification',title:'Aurum B · AL/SAT',body,tag:`aurum-qbs-v2-${td}-${token}`,channel:'aurum_pipeline'});window.prompt(`aurum://native?${qp.toString()}`,'')}catch{}try{showAurumNotice(`Aurum B · AL/SAT: ${body}`,'info',5200)}catch{}try{await dbPut('meta',{key:'qualifiedBuySellLastEventV2',value:{at:now,tradeDate:td,jobToken:token,buy:buys,sell:sells},updatedAt:now})}catch{}}return {buys,sells,state:q}
  }
  async function purgeSymbol(raw){const sym=norm(raw),q=load();if(!sym)return false;delete q.items[sym];save(q);return true}
  function card(){const q=load(),items=Object.values(q.items||{}),buys=items.filter(x=>x.status==='BUY').sort((a,b)=>a.sym.localeCompare(b.sym)),sells=items.filter(x=>x.status==='SELL').sort((a,b)=>String(b.sellAt||'').localeCompare(String(a.sellAt||''))).slice(0,20);const row=x=>{const m=metrics(x);return `<div class="qbs-row"><strong class="symbol">${html(x.sym)}</strong><div class="qbs-metrics"><span><small>AF</small><b>${html(tradeFmt(x.buyPrice))}</b></span><span><small>ZK</small><b>${html(tradeFmt(m.stop))}</b></span><span><small>HF</small><b>${html(tradeFmt(m.hfPrice))}</b></span><span><small>SON</small><b>${html(tradeFmt(m.last))} ${Number.isFinite(Number(m.ret))&&Number(m.ret)!==0?`<i class="aurum-trade-dir ${Number(m.ret)>0?'up':'down'}" aria-hidden="true">${Number(m.ret)>0?'↑':'↓'}</i>`:""}${html(pctFmt(m.ret))}</b></span></div>${x.status==='SELL'?`<small class="qbs-exit">${html(x.exitReason||'SAT')}</small>`:''}</div>`};return `<div class="section-head aurum-qbs-head"><div class="section-title"><h2>Al / Sat Listesi</h2></div><div class="aurum-r222-head-tools"><small>S yeterlilik · bağımsız stop · dinamik kâr kilidi</small><button type="button" class="aurum-r222-mini-refresh" title="AL/SAT ve sanal portföy görünümünü yenile" aria-label="AL/SAT ve sanal portföy görünümünü yenile" onclick="refreshAurumTradePanels(event)">↻</button></div></div><div class="grid two-col aurum-qbs-grid"><div class="card list gold-edge"><b class="green">Al</b>${buys.length?buys.map(row).join(''):'<p class="muted">Aktif al sinyali yok.</p>'}</div><div class="card list"><b class="red">Sat</b>${sells.length?sells.map(row).join(''):'<p class="muted">Yeni sat sinyali yok.</p>'}</div></div>`}
  globalThis.AurumQualifiedBuySell=Object.freeze({version:'2.0.0',state:load,advance,card,purgeSymbol,metrics,profitLockBufferPct});
})();


/* ===== AURUM AL/SAT execution binding — S display + table ergonomics ===== */
(function installTradeExecutionBinding(){
  'use strict';
  function qState(){try{return globalThis.AurumQualifiedBuySell?.state?.()||{items:{}}}catch{return {items:{}}}}
  function qItem(sym){return qState().items?.[String(sym||'').toUpperCase()]||null}
  function qReturn(sym,live){const q=qItem(sym),b=Number(q?.buyPrice),p=Number(live);return q?.status==='BUY'&&b>0&&p>0?100*(p/b-1):null}
  function qStamp(q){const v=q?.buyAt||q?.buyTradeDate;try{return v?new Date(v).toLocaleString('tr-TR'):'—'}catch{return '—'}}

  /* S table uses the qualified AL/SAT entry price/time and live return. Kn tables remain untouched. */
  globalThis.selectionTable=selectionTable=function tradeBoundSelectionTable(rows){
    if(!rows.length)return `<div class="card notice">Gerçek veri henüz yok. “Verileri Güncelle” ile kaynak zincirini çalıştırın.</div>`;
    return `<div class="table-wrap"><table><thead><tr><th>#</th><th>Hisse</th><th>Veri Zamanı</th><th>Anlık %</th><th>Anlık</th><th>Maliyet</th><th>Giriş zamanı</th><th>Getiri %</th><th>KnzTOP20</th><th>S gerekçesi</th><th>Puan</th><th>Hedef Olasılığı</th><th>Maks.</th><th>Risk</th><th>Kalite</th></tr></thead><tbody>${rows.map((x,i)=>{const rec=state.recordMap?.get?.(x.sym)||state.records?.find?.(r=>r.sym===x.sym),instant=safeRecordDayChange(rec),q=qItem(x.sym),active=q?.status==='BUY'&&Number(q?.buyPrice)>0,entry=active?Number(q.buyPrice):null,ret=active?qReturn(x.sym,rec?.livePrice??x.livePrice):null,reasons=(x.targetReasons||[]).slice(0,3).join(' · '),criteria=(x.supportingCriteria||[]).join(' · ');return `<tr onclick="showDetail('${x.sym}')"><td><span class="rank">${i+1}</span></td><td><span class="symbol">${x.sym}</span></td><td>${typeof formatTableTime==='function'?html(formatTableTime(rec?.marketDataAt||rec?.provenance?.marketAt||rec?.apiAccessedAt||rec?.storedAt||null)):'—'}</td><td class="${(instant??0)>=0?'green':'red'}">${pct(instant)}</td><td>${fmt(x.livePrice)}</td><td>${active?fmt(entry):'<span class="badge warn">AL bekliyor</span>'}<small>${active?'AL aktif':'Henüz giriş oluşmadı'}</small></td><td>${active?html(qStamp(q)):html(q?.buyAt||q?.buyTradeDate||'AL sinyali bekleniyor')}</td><td class="${Number(ret)>=0?'green':'red'}">${active&&Number.isFinite(ret)?pct(ret):'<span class="badge warn">Giriş bekleniyor</span>'}</td><td>${html(criteria||'—')}</td><td>${html(reasons||'—')}</td><td><span class="scorebar"><i style="width:${x.totalScore}%"></i></span>${fmt(x.totalScore,1)}</td><td><b class="target-prob">${fmt(x.targetProbability*100,1)}%</b></td><td class="green">${pct(x.maxPotential)}</td><td><span class="pill ${x.riskLevel==='Yüksek'?'risk-high':x.riskLevel==='Orta'?'risk-mid':'risk-low'}">${x.riskLevel}</span></td><td>${x.quality}/100<small>${html(x.source)}</small></td></tr>`}).join('')}</tbody></table></div>`;
  };

  /* Horizontal drag in Veriler is only table navigation; it no longer flips/rebuilds pages. */
  globalThis.aurumDataSwipeStart=aurumDataSwipeStart=function(){V141225_SWIPE_X=null};
  globalThis.aurumDataSwipeEnd=aurumDataSwipeEnd=function(){V141225_SWIPE_X=null};

  try{AurumUpdateAPI.state.tradeExecutionBinding={version:'1.0.0',source:'QUALIFIED_AL_SAT',knUnchanged:true}}catch{}
})();


/* R36 — K1-K7 seat/trade boundary.
   K8-K12 remain visible analysis tables only. */
(function installR36SeatBoundary(){
  if(globalThis.AURUM_R36_SEAT_BOUNDARY==='R36.0')return;
  globalThis.AURUM_R36_SEAT_BOUNDARY='R36.0';
  const active=new Set(['K1','K2','K3','K4','K5','K6','K7']);
  const oldHist=globalThis.kh117HistoricalHitAverage||kh117HistoricalHitAverage;
  kh117HistoricalHitAverage=function(k){return active.has(String(k))?oldHist(k):{avg:null,n:0,total:20};};
  globalThis.kh117HistoricalHitAverage=kh117HistoricalHitAverage;
  const oldSeat=globalThis.kh117SSeatCount||kh117SSeatCount;
  kh117SSeatCount=function(k){return active.has(String(k))?oldSeat(k):0;};
  globalThis.kh117SSeatCount=kh117SSeatCount;
})();


/* FIX-CLEAR — K_Tarihsel scoped clear semantics only. */
(function installKhScopedClearView(){
  const baseRows=kh117Rows;
  kh117Rows=function kh117RowsScopedClear(){
    const rs=baseRows(),a=kh117ArchiveState(),d=a?.t0ClearedDate;
    if(!d||!rs?.length||String(rs[0]?.date||'')!==String(d))return rs;
    const t0=rs[0],criteria={},summaries={};for(const k of KN_V117_ORDER){criteria[k]=[];summaries[k]={hitCount:0,total:20,realAvg:null,knAvg:null};}
    return [{date:t0.date,provisional:true,reelTop20:[],criteria,summaries,trend:[],marketTime:null,reelDate:t0.date,_label:'T0',_t0:true,_cleared:true},...rs.slice(1)];
  };
  try{const old=globalThis.AurumKnHistoryV117||{};globalThis.AurumKnHistoryV117=Object.freeze({...old,rows:kh117Rows});}catch{}
  globalThis.clearTableScope=clearTableScope;globalThis.clearFromSettings=clearFromSettings;globalThis.operationCommand=operationCommand;
  try{const oldRt=globalThis.AurumRuntime||{};globalThis.AurumRuntime=Object.freeze({...oldRt,command:operationCommand});}catch{}
})();

/* AurumR Market Intelligence v2 — source-attributed open-source market/company brief. */
(function installAurumRMarketIntelV2(){
 if(globalThis.__AURUM_R_MARKET_INTEL_V2)return;globalThis.__AURUM_R_MARKET_INTEL_V2=true;
 const CACHE='aurum.r.marketIntel.v2',TTL=8*60e3,esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),norm=s=>String(s||'').toLocaleLowerCase('tr-TR').replace(/[^a-z0-9çğıöşü ]/g,' ').replace(/\s+/g,' ').trim();
 const load=()=>{try{return JSON.parse(localStorage.getItem(CACHE)||'null')}catch{return null}},save=x=>{try{localStorage.setItem(CACHE,JSON.stringify(x))}catch{}};
 const feeds=[['Piyasa','Türkiye ekonomi piyasa Borsa İstanbul faiz enflasyon döviz'],['Şirket','KAP Borsa İstanbul şirket bilanço yatırım temettü geri alım'],['Makro','TCMB faiz enflasyon rezerv Türkiye ekonomi']].map(([c,q])=>[c,'https://news.google.com/rss/search?q='+encodeURIComponent(q)+'&hl=tr&gl=TR&ceid=TR:tr']);
 async function rss(cat,url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error('Google News '+r.status);const d=new DOMParser().parseFromString(await r.text(),'text/xml');return [...d.querySelectorAll('item')].slice(0,32).map(it=>({cat,title:it.querySelector('title')?.textContent?.trim()||'',link:it.querySelector('link')?.textContent?.trim()||'',source:it.querySelector('source')?.textContent?.trim()||'Google News',publishedAt:it.querySelector('pubDate')?.textContent||null}))}
 function symOf(t){const u=String(t||'').toUpperCase();for(const s of currentSymbols())if(new RegExp('(^|[^A-Z0-9])'+s+'([^A-Z0-9]|$)').test(u))return s;return ''}
 function sentiment(t){t=norm(t);let v=0;for(const w of ['artış','yüksel','rekor','güçlü','kâr','temettü','ihale','yatırım','geri alım','indirim'])if(t.includes(w))v++;for(const w of ['düşüş','gerile','zarar','ceza','soruştur','iptal','iflas','risk','gerilim'])if(t.includes(w))v--;return Math.max(-3,Math.min(3,v))}
 function dedup(a){const seen=new Set();return a.map(x=>({...x,sym:symOf(x.title),sent:sentiment(x.title)})).filter(x=>{const k=norm(x.title).slice(0,110);if(!k||seen.has(k))return false;seen.add(k);return true}).sort((a,b)=>Date.parse(b.publishedAt||0)-Date.parse(a.publishedAt||0))}
 function marketRegime(){const recs=calculationRecords?.()||[];const day=recs.map(x=>x.dayChange).filter(Number.isFinite),breadth=day.length?day.filter(x=>x>0).length/day.length:null,avg=day.length?day.reduce((a,b)=>a+b,0)/day.length:null;let bias=(Number.isFinite(breadth)?(breadth-.5)*2:0)+(Number.isFinite(avg)?Math.max(-1,Math.min(1,avg/.015)):0);return {breadth,avg,bias,label:bias>.45?'Pozitif genişlik':bias<-.45?'Negatif genişlik':'Karışık piyasa'}}
 function advice(r,news){const out=[],tone=news.length?news.slice(0,25).reduce((a,x)=>a+x.sent,0)/Math.min(25,news.length):0;if(r.bias>.45)out.push('Piyasa genişliği olumlu; güçlü K kriterleriyle teyit edilen hisselerde seçici risk alma zemini mevcut.');else if(r.bias<-.45)out.push('Piyasa genişliği zayıf; yeni girişlerde daha yüksek teyit ve daha sıkı risk filtresi uygun.');else out.push('Piyasa karışık; endeks yönünden çok şirket/kriter bazlı ayrışma izlenmeli.');if(tone>.35)out.push('Haber akışının net tonu pozitif; ancak haber etkisi fiyat/momentum teyidi olmadan tek başına sinyal sayılmamalı.');if(tone<-.35)out.push('Haber akışının net tonu negatif; olay riski yüksek hisselerde pozisyon boyutu ve likidite kontrolü önem kazanıyor.');return out}
 function render(d){const n=d.news||[],company=n.filter(x=>x.sym).slice(0,24),market=n.filter(x=>!x.sym).slice(0,24),row=x=>`<div class="list-row"><div><strong>${x.link?`<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.title)}</a>`:esc(x.title)}</strong><small>${esc([x.sym,x.source,x.sent>0?'Olumlu':x.sent<0?'Olumsuz':'Nötr'].filter(Boolean).join(' · '))}</small><small>${x.publishedAt?'Yayın: '+esc(new Date(x.publishedAt).toLocaleString('tr-TR')):'Yayın zamanı kaynakta yok'}</small></div></div>`;return `<div class="card notice"><b>Piyasa Rejimi: ${esc(d.regime?.label||'—')}</b><small>Yükselen hisse oranı: ${Number.isFinite(d.regime?.breadth)?(100*d.regime.breadth).toFixed(0)+'%':'—'} · Ortalama günlük değişim: ${Number.isFinite(d.regime?.avg)?(100*d.regime.avg).toFixed(2)+'%':'—'}</small></div><div class="section-head"><h2>Yorum ve Karar Desteği</h2><small>yatırım tavsiyesi değildir</small></div><div class="card list">${(d.advice||[]).map(x=>`<div class="list-row"><strong>${esc(x)}</strong></div>`).join('')}</div><div class="grid two-col"><div><div class="section-head"><h2>Şirket Haberleri</h2><small>${company.length} eşleşen</small></div><div class="card list">${company.map(row).join('')||'<p class="muted">Şirket koduyla eşleşen yeni haber yok.</p>'}</div></div><div><div class="section-head"><h2>Piyasa / Makro Haberleri</h2><small>${market.length} kayıt</small></div><div class="card list">${market.map(row).join('')||'<p class="muted">Yeni piyasa haberi yok.</p>'}</div></div></div><div class="card notice"><b>Kaynak politikası</b><small>Google News RSS açık yayıncı akışı + uygulamanın doğrulanmış piyasa/hisse verileri. Haberler tekilleştirilir, yayıncı ve yayın zamanı korunur. KAP açıklamaları haber akışında şirket koduyla eşleştirilir; uydurma veri üretilmez.</small><small>Son yenileme: ${esc(new Date(d.updatedAt).toLocaleString('tr-TR'))}</small></div>`}
 globalThis.refreshAurumRMarketIntel=async function(force=false){const host=document.querySelector('#aurumRMarketIntel'),cached=load();if(host&&cached)host.innerHTML=render(cached);if(!force&&cached&&Date.now()-Date.parse(cached.updatedAt)<TTL)return;if(globalThis.__armi)return;globalThis.__armi=true;try{const rs=await Promise.allSettled(feeds.map(([c,u])=>rss(c,u))),news=dedup(rs.flatMap(x=>x.status==='fulfilled'?x.value:[])),regime=marketRegime(),d={updatedAt:new Date().toISOString(),news,regime,advice:advice(regime,news)};save(d);if(host)host.innerHTML=render(d)}finally{globalThis.__armi=false}};
 const base=globalThis.marketPage||marketPage;globalThis.marketPage=marketPage=function marketPageIntelV2(){const old=base(),c=load();setTimeout(()=>globalThis.refreshAurumRMarketIntel(false),0);return old+`<div class="section-head"><div class="section-title"><h2>Genişletilmiş Piyasa İstihbaratı</h2></div><button class="ghost-btn" onclick="refreshAurumRMarketIntel(true)">Haberleri Yenile</button></div><div id="aurumRMarketIntel">${c?render(c):'<div class="card">Açık kaynaklar taranıyor…</div>'}</div>`};
})();

/* === Selective Base UI transfer: size controls only === */
(function installBaseScaleSemantics(){
  const BASE=.9, scaleKey='aurum.uiScale.v1',keys=['ui','table','static','card','icon'];
  function sr(){try{return JSON.parse(localStorage.getItem(scaleKey)||'{}')}catch{return {}}}
  function apply(){const x=sr(),b=document.body;if(!b)return;for(const k of keys){const o=x[k]||{on:true,v:BASE};b.classList.toggle('aurum-scale-'+k,o.on!==false);document.documentElement.style.setProperty(`--aurum-${k==='ui'?'ui-text':k}-scale`,String(Number(o.v)||BASE))}}
  globalThis.saveAurumUiScale=function(){const x={};for(const k of keys)x[k]={on:!!document.getElementById('aurumScaleOn_'+k)?.checked,v:BASE*Number(document.getElementById('aurumScaleVal_'+k)?.value||100)/100};localStorage.setItem(scaleKey,JSON.stringify(x));apply();showAurumNotice('Arayüz boyutları uygulandı','success',1800)};
  globalThis.resetAurumUiScale=function(){const x={};for(const k of keys)x[k]={on:true,v:BASE};localStorage.setItem(scaleKey,JSON.stringify(x));apply();try{renderCurrentPagePreservingView?.()}catch{}};
})();
/* R2 settings usability: modules collapsed by default; scale controls get an exact
   100% default point and their own heading acts as live preview. No global scale is
   committed until the existing Save action is used. */
(function installAurumR2SettingsUX(){
  if(globalThis.__AURUM_R2_SETTINGS_UX)return; globalThis.__AURUM_R2_SETTINGS_UX=true;
  const old=globalThis.settingsPage;
  if(typeof old==='function') globalThis.settingsPage=function(){
    let h=old();
    h=h.replace(/<details(\s+)open(\s|>)/gi,'<details$1$2');
    queueMicrotask(enhance);
    return h;
  };
  function enhance(){
    document.querySelectorAll('details[open]').forEach(d=>d.removeAttribute('open'));
    document.querySelectorAll('input[type="range"][id^="aurumScaleVal_"]').forEach(r=>{
      if(r.dataset.r2enhanced)return; r.dataset.r2enhanced='1';
      const host=r.closest('.setting-row,.setting-item,.field,.card,div')||r.parentElement;
      let title=host?.querySelector('label,b,strong,h3,h4,.setting-title');
      if(title){ title.dataset.r2BaseSize=getComputedStyle(title).fontSize; title.style.transition='font-size .12s ease'; }
      const preview=()=>{ if(title){const v=Number(r.value)||100; const base=parseFloat(title.dataset.r2BaseSize)||14; title.style.fontSize=(base*v/100)+'px';} };
      r.addEventListener('input',preview); preview();
      const b=document.createElement('button'); b.type='button'; b.className='ghost-btn compact-btn aurum-r2-default-point';
      b.textContent='100%'; b.title='Varsayılan boyuta getir';
      b.onclick=()=>{r.value='100';r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}));};
      r.insertAdjacentElement('afterend',b);
    });
  }
  const mo=new MutationObserver(()=>{if(document.querySelector('input[type="range"][id^="aurumScaleVal_"]'))enhance()});
  if(document.documentElement)mo.observe(document.documentElement,{subtree:true,childList:true});
  document.addEventListener('click',e=>{
    const d=e.target.closest('details');
    if(d) setTimeout(()=>document.querySelectorAll('details[open]').forEach(x=>{if(x!==d)x.removeAttribute('open')}),0);
  },true);
})();



/* === Aurum R3: compact market change display + VeriZamani width guard === */
(function installAurumR3MarketAndTable(){
  if(globalThis.__AURUM_R3_MARKET_UI)return; globalThis.__AURUM_R3_MARKET_UI=true;
  const KEY='marketIndicatorsR3';
  const oldCached=globalThis.cachedMarketIndicators;
  globalThis.cachedMarketIndicators=function(){return state.marketIndicators||readLocal(KEY,null)||(typeof oldCached==='function'?oldCached():null)||null};

  async function chart(symbol){
    let last;
    for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
      try{
        const u=`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`;
        const r=await withProviderSlot('YAHOO_QUOTE',()=>fetchWithTimeout(u,{headers:{Accept:'application/json'},__provider:'YAHOO_QUOTE'},`Yahoo R3 ${symbol}`));
        const o=await responseJSON(r),x=o?.chart?.result?.[0],m=x?.meta||{},q=x?.indicators?.quote?.[0]||{},cs=q.close||[],ts=x?.timestamp||[];
        let i=cs.length-1;while(i>=0&&!Number.isFinite(Number(cs[i])))i--;
        const value=validNumber(m.regularMarketPrice)??(i>=0?validNumber(cs[i]):null);
        let prev=validNumber(m.chartPreviousClose)??validNumber(m.previousClose);
        if(prev==null&&i>0){let j=i-1;while(j>=0&&!Number.isFinite(Number(cs[j])))j--;if(j>=0)prev=validNumber(cs[j]);}
        const epoch=Number(m.regularMarketTime)*1000||(i>=0?Number(ts[i])*1000:NaN);
        if(value==null||!Number.isFinite(epoch))throw new Error('market value/time unavailable');
        return {value,previousClose:prev,changePct:prev&&prev!==0?(value/prev-1)*100:null,at:new Date(epoch).toISOString(),source:host.startsWith('query1')?'YAHOO_Q1':'YAHOO_Q2'};
      }catch(e){last=e}
    }
    throw last||new Error('market source unavailable');
  }

  globalThis.refreshMarketIndicators=async function refreshMarketIndicatorsR3(){
    const map={XU100:'XU100.IS',USDTRY:'TRY=X',EURTRY:'EURTRY=X',EURUSD:'EURUSD=X',GOLDUSD:'GC=F'};
    const rs=await Promise.allSettled(Object.entries(map).map(async([k,s])=>[k,await chart(s)]));
    const prev=globalThis.cachedMarketIndicators()||{},fields={...(prev.fields||{})},errors=[];
    for(const r of rs){if(r.status==='fulfilled'){const [k,v]=r.value;fields[k]=v}else errors.push(String(r.reason?.message||r.reason))}
    function derived(key,a,b,op){
      if(!fields[a]||!fields[b])return;
      const va=Number(fields[a].value),vb=Number(fields[b].value),pa=Number(fields[a].previousClose),pb=Number(fields[b].previousClose);
      const value=op(va,vb),previousClose=Number.isFinite(pa)&&Number.isFinite(pb)?op(pa,pb):null;
      fields[key]={value,previousClose,changePct:previousClose&&previousClose!==0?(value/previousClose-1)*100:null,
        at:new Date(Math.min(Date.parse(fields[a].at),Date.parse(fields[b].at))).toISOString(),source:`DERIVED_${a}_${b}`};
    }
    if(!fields.EURTRY&&fields.EURUSD&&fields.USDTRY)derived('EURTRY','EURUSD','USDTRY',(a,b)=>a*b);
    if(fields.GOLDUSD&&fields.USDTRY)derived('GRAMTRY','GOLDUSD','USDTRY',(a,b)=>a*b/31.1034768);
    const values=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,Number(v.value)]));
    const times=Object.values(fields).map(x=>Date.parse(x.at)).filter(Number.isFinite);
    const payload={at:times.length?new Date(Math.max(...times)).toISOString():(prev.at||null),source:'R3_FIELD_VERIFIED',values,fields,errors:errors.slice(0,8),updatedAt:nowISO()};
    state.marketIndicators=payload;writeLocal(KEY,payload);writeLocal('marketIndicatorsR47',payload);writeLocal('marketIndicatorsR40',payload);
    try{await dbPut('meta',{key:KEY,value:payload,updatedAt:nowISO()})}catch{}
    return payload;
  };

  globalThis.marketIndicatorsMarkup=function marketIndicatorsMarkupR3(){
    const m=globalThis.cachedMarketIndicators()||{},f=m.fields||{},legacy=m.values||{};
    const item=(label,key,d=2)=>{
      const x=f[key]||{},v=Number(x.value??legacy[key]),c=Number(x.changePct);
      const val=Number.isFinite(v)?fmt(v,d):'—';
      const delta=Number.isFinite(c)?`<small class="aurum-r4-change ${c>0?'up':c<0?'down':'flat'}"><span class="aurum-r4-arrow">${c>0?'↑':c<0?'↓':'·'}</span><span class="aurum-r4-pct">${Math.abs(c).toFixed(1).replace('.',',')}%</span></small>`:'';
      return `<span class="aurum-r3-market-item"><b>${html(label)}</b> ${html(val)}${delta}</span>`;
    };
    return `<div class="aurum-market-indicators aurum-r3-market">${item('BIST 100','XU100')}${item('USD','USDTRY')}${item('EUR','EURTRY')}${item('Parite','EURUSD',4)}${item('Altın gr','GRAMTRY')}${item('Ons','GOLDUSD')}</div>`;
  };

  function widen(){
    document.querySelectorAll('.aurum-v141225 table').forEach(t=>{
      const hs=[...t.querySelectorAll('thead th')],i=hs.findIndex(x=>/VER[Iİ]ZAMANI/i.test((x.textContent||'').replace(/\s/g,'')));
      if(i<0)return;hs[i].classList.add('aurum-r3-verizamani');
      t.querySelectorAll('tbody tr').forEach(tr=>tr.children[i]?.classList.add('aurum-r3-verizamani'));
    });
  }
  const mo=new MutationObserver(()=>widen());if(document.documentElement)mo.observe(document.documentElement,{subtree:true,childList:true});queueMicrotask(widen);
})();




/* === Aurum R4: single-headed micro arrows === */
(function installAurumR4MarketMicroArrows(){
  if(globalThis.__AURUM_R4_MARKET_UI)return;globalThis.__AURUM_R4_MARKET_UI=true;
  globalThis.marketIndicatorsMarkup=function(){
    const m=(globalThis.cachedMarketIndicators?.()||{}),f=m.fields||{},legacy=m.values||{};
    const item=(label,key,d=2)=>{
      const x=f[key]||{},v=Number(x.value??legacy[key]),c=Number(x.changePct);
      const val=Number.isFinite(v)?fmt(v,d):'—';
      let delta='';
      if(Number.isFinite(c)){
        const dir=c>0?'up':c<0?'down':'flat';
        const arrow=c>0?'↑':c<0?'↓':'·';
        const pct=Math.abs(c).toFixed(1).replace('.',',')+'%';
        delta=`<small class="aurum-r4-change ${dir}"><span class="aurum-r4-arrow">${arrow}</span><span class="aurum-r4-pct">${pct}</span></small>`;
      }
      return `<span class="aurum-r3-market-item"><b>${html(label)}</b> ${html(val)}${delta}</span>`;
    };
    return `<div class="aurum-market-indicators aurum-r3-market">${item('BIST 100','XU100')}${item('USD','USDTRY')}${item('EUR','EURTRY')}${item('Parite','EURUSD',4)}${item('Altın gr','GRAMTRY')}${item('Ons','GOLDUSD')}</div>`;
  };
})();

/* === UX hotfix 2026-09-17: immediate cancel/clear feedback + full BIST 100 === */
(function installImmediateOperationControlsAndFullBist(){
  if(globalThis.__AURUM_IMMEDIATE_OPS_BIST_FIX)return;globalThis.__AURUM_IMMEDIATE_OPS_BIST_FIX=true;
  const priorCommand=globalThis.AurumRuntime?.command||globalThis.operationCommand;
  function optimisticClear(scope,mode='all'){
    const s=String(scope||'data');
    if(s==='data'){state.records=[];state.recordMap=new Map();state.scores={};state.selection=[];state.modelBySym=new Map();}
    else if(s==='kn'){state.scores={};state.modelBySym=new Map();delete state.__pendingSelection;}
    else if(s==='s'){state.selection=[];}
    else if(s==='history'){
      const a=state.khArchive||{};
      if(mode==='t0'||mode==='all')a.live=null;
      if(mode==='archive'||mode==='all'){a.rows=[];a.seed=null;a.lastShift=null;a.lastFinalizedDate=null;}
      state.khArchive=a;
    }
    try{renderCurrentPagePreservingView()}catch{try{render()}catch{}}
  }
  async function immediateCommand(scope,action){
    scope=String(scope||'data');action=String(action||'');
    if(action==='cancel'){
      const rt=currentRuntime(),expected=operationStage(scope);
      if(!rt.jobId||String(rt.stage||'')!==expected||!operationBusyStatus(rt.status))return priorCommand(scope,action);
      const id=String(rt.jobId);HARD_CANCELLED_JOBS.add(id);writeLocal(CANCEL_KEY,{requested:true,jobId:id,at:nowISO(),hard:true});
      for(const c of [...state.activeControllers])try{c.abort()}catch{}
      writeLocal(PAUSE_KEY,{requested:false,jobId:null,requestedAt:null});
      setRuntime({status:JOB_STATUS.IDLE,jobId:null,mode:null,stage:expected,done:0,total:0,error:null,message:'İşlem iptal edildi'});
      try{renderCurrentPagePreservingView()}catch{updateLiveStatus()}
      showAurumNotice(`${expected}: işlem iptal edildi`,'success',1300);
      return true;
    }
    if(action==='clear'){
      const stage=operationStage(scope);if(!operationConfirm(scope,action))return false;
      const mode=scope==='history'?khHistoryClearChoice():'all';if(mode===null)return false;
      const rt=currentRuntime(),busy=!!rt.jobId&&String(rt.stage||'')===stage&&operationBusyStatus(rt.status),id=busy?String(rt.jobId):null;
      if(busy){
        HARD_CANCELLED_JOBS.add(id);writeLocal(CANCEL_KEY,{requested:true,jobId:id,at:nowISO(),hard:true});
        for(const c of [...state.activeControllers])try{c.abort()}catch{}
        writeLocal(PAUSE_KEY,{requested:false,jobId:null,requestedAt:null});
        setRuntime({status:JOB_STATUS.IDLE,jobId:null,mode:null,stage,done:0,total:0,error:null,message:'Temizleniyor'});
      }
      /* UI state is cleared before IndexedDB work, so the table reacts in the same click/frame. */
      optimisticClear(scope,mode);
      try{
        if(id)await waitOperationStop(12000,id);
        await clearTableScope(scope,mode);clearCancel(id);
        showAurumNotice(`${stage} ${mode==='t0'?'T0':mode==='archive'?'T1–T30':'T0 + T1–T30'} temizlendi`,'success',1500);return true;
      }catch(e){showAurumNotice(`${stage}: temizleme tamamlanamadı · ${e?.message||e}`,'error',3600);return false;}
    }
    return priorCommand(scope,action);
  }
  globalThis.operationCommand=immediateCommand;
  try{const old=globalThis.AurumRuntime||{};globalThis.AurumRuntime=Object.freeze({...old,command:immediateCommand});}catch{}

  /* BIST 100 gets the full grouped integer. Decimals are intentionally omitted to protect width. */
  const oldMarkup=globalThis.marketIndicatorsMarkup;
  globalThis.marketIndicatorsMarkup=function marketIndicatorsMarkupFullBist(){
    const m=(globalThis.cachedMarketIndicators?.()||{}),f=m.fields||{},legacy=m.values||{};
    const item=(label,key,d=2)=>{
      const x=f[key]||{},v=Number(x.value??legacy[key]),c=Number(x.changePct);
      const val=Number.isFinite(v)?(key==='XU100'?v.toLocaleString('tr-TR',{minimumFractionDigits:0,maximumFractionDigits:0,useGrouping:true}):fmt(v,d)):'—';
      let delta='';if(Number.isFinite(c)){const dir=c>0?'up':c<0?'down':'flat',arrow=c>0?'↑':c<0?'↓':'·',pct=Math.abs(c).toFixed(1).replace('.',',')+'%';delta=`<small class="aurum-r4-change ${dir}"><span class="aurum-r4-arrow">${arrow}</span><span class="aurum-r4-pct">${pct}</span></small>`;}
      return `<span class="aurum-r3-market-item${key==='XU100'?' aurum-bist100-full':''}"><b>${html(label)}</b> ${html(val)}${delta}</span>`;
    };
    return `<div class="aurum-market-indicators aurum-r3-market">${item('BIST 100','XU100',0)}${item('USD','USDTRY')}${item('EUR','EURTRY')}${item('Parite','EURUSD',4)}${item('Altın gr','GRAMTRY')}${item('Ons','GOLDUSD')}</div>`;
  };
})();

/* REV20 settings safety, stock context actions and self-repair UX */
(()=>{
  if(globalThis.__AURUM_REV20_UX_GUARD)return;globalThis.__AURUM_REV20_UX_GUARD=true;
  const S=globalThis.AurumUpdateAPI?.state||globalThis.state;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  document.addEventListener('input',e=>{if(S?.page==='settings'&&e.target?.matches?.('input,select,textarea'))S.settingsDirty=true},true);
  document.addEventListener('change',e=>{if(S?.page==='settings'&&e.target?.matches?.('input,select,textarea'))S.settingsDirty=true},true);

  const saveNames=['saveRuntimeSettings','saveExecutionSettings','saveLearningSettings','saveBehaviorGenomeSettings','saveCalendarSettings','savePerformanceControlSettings','saveR44TransferSettings','saveExportPreferences'];
  for(const name of saveNames){
    const fn=globalThis[name];if(typeof fn!=='function'||fn.__rev20Confirm)continue;
    const wrapped=async function(...args){
      if(!confirm('Bu ayarlar kaydedilip etkinleştirilsin mi?'))return false;
      const y=window.scrollY||0,open=document.querySelector('#content .aurum-settings-details[open]')?.id||'';
      if(open)sessionStorage.setItem('aurum.settings.open.v2',open);sessionStorage.setItem('aurum.settings.scroll.v2',String(y));
      const out=await fn.apply(this,args);if(out!==false&&S)S.settingsDirty=false;
      requestAnimationFrame(()=>window.scrollTo(0,Number(sessionStorage.getItem('aurum.settings.scroll.v2')||y)||0));return out;
    };wrapped.__rev20Confirm=true;globalThis[name]=wrapped;
  }

  function knownSymbol(sym){
    if(!sym)return false;
    if(S?.recordMap instanceof Map&&S.recordMap.has(sym))return true;
    if((S?.records||[]).some(x=>String(x?.sym||'').toLocaleUpperCase('tr-TR')===sym))return true;
    if((S?.selection||[]).some(x=>String(x?.sym||'').toLocaleUpperCase('tr-TR')===sym))return true;
    try{if((globalThis.__AURUM_BASE_CURRENT_SYMBOLS?.()||[]).includes(sym))return true}catch{}
    return !!globalThis.AurumBlockedUniverse?.has?.(sym);
  }
  function symbolFrom(el){
    for(let n=el;n&&n!==document.body;n=n.parentElement){
      const d=n.dataset||{},raw=d.sym||d.symbol||d.code;
      if(raw){const s=String(raw).trim().toLocaleUpperCase('tr-TR');if(/^[A-ZÇĞİÖŞÜ0-9._-]{2,12}$/.test(s)&&knownSymbol(s))return s}
      if(n.matches?.('.symbol,[data-sym],[data-symbol]')){const s=String(n.dataset?.sym||n.dataset?.symbol||n.textContent||'').trim().toLocaleUpperCase('tr-TR');if(knownSymbol(s))return s}
      if(n.matches?.('td,tr,.list-row,.aurum-missing-row,.aurum-stock-card')){const txt=(n.querySelector?.('.symbol,[data-sym],[data-symbol],b,strong,h2,td')?.textContent||'').trim().toLocaleUpperCase('tr-TR');if(/^[A-ZÇĞİÖŞÜ0-9._-]{2,12}$/.test(txt)&&knownSymbol(txt))return txt}
    }return '';
  }
  function closeMenu(){document.getElementById('aurumStockContextMenu')?.remove()}
  function openMenu(sym,x,y){
    closeMenu();if(!sym)return;
    const blocked=!!globalThis.AurumBlockedUniverse?.has?.(sym),m=document.createElement('div');
    m.id='aurumStockContextMenu';m.className='aurum-stock-context';
    m.innerHTML=`<b>${esc(sym)}</b><button data-a="open">Hisse kartını aç</button>${blocked?`<button data-a="unblock">Yasaktan kaldır</button>`:`<button data-a="block">Yasakla ve sistemden kaldır</button>`}<button data-a="close">Kapat</button>`;
    document.body.appendChild(m);m.style.left=Math.max(8,Math.min(x,innerWidth-220))+'px';m.style.top=Math.max(8,Math.min(y,innerHeight-180))+'px';
    m.onclick=async e=>{const a=e.target?.dataset?.a;if(!a)return;if(a==='open')globalThis.showStockCard?.(sym);if(a==='block')await globalThis.AurumBlockedUniverse?.add?.(sym);if(a==='unblock')await globalThis.AurumBlockedUniverse?.remove?.(sym);closeMenu()};
  }
  document.addEventListener('click',e=>{
    if(e.target.closest('#aurumStockContextMenu'))return;
    if(e.target.closest('button,input,select,textarea,a,summary')){closeMenu();return}
    const sym=symbolFrom(e.target);if(!sym){closeMenu();return}
    e.preventDefault();e.stopImmediatePropagation();openMenu(sym,e.clientX||innerWidth/2,e.clientY||innerHeight/2);
  },true);

  const st=document.createElement('style');st.textContent=`.aurum-stock-context{position:fixed;z-index:100000;width:205px;padding:8px;display:grid;gap:5px;background:#071327;border:1px solid rgba(214,173,96,.45);border-radius:10px;box-shadow:0 12px 38px rgba(0,0,0,.5)}.aurum-stock-context b{padding:3px 5px;color:var(--gold2,#d6ad60)}.aurum-stock-context button{min-height:34px;text-align:left;border:1px solid rgba(255,255,255,.08);border-radius:7px;background:rgba(255,255,255,.05);color:inherit;padding:6px 8px}`;document.head.appendChild(st);

  const oldRepair=globalThis.runRepairCenter;
  if(typeof oldRepair==='function')globalThis.runRepairCenter=async function(mode='DIAGNOSE'){
    mode=String(mode||'DIAGNOSE');
    if(mode==='UI'){if(!confirm('Görünüm kişiselleştirmeleri mevcut varsayılana onarılsın mı?'))return false;try{localStorage.removeItem('aurum.rev20.presentation.v1');localStorage.removeItem('aurum.uiScale.v1');globalThis.AurumPresentationSettings?.reset?.();showAurumNotice('Görünüm mevcut varsayılana döndürüldü','success',2600);renderCurrentPagePreservingView?.();return true}catch(e){showAurumNotice(e.message,'error',3600);return false}}
    if(mode==='FOLDER'){if(!confirm('Dışa aktarma klasör izni sıfırlansın mı?'))return false;try{const r=globalThis.aurumNativePrompt?.({cmd:'folder_clear'},'');showAurumNotice(r==='OK'?'Klasör izni sıfırlandı':'Klasör köprüsü yanıt vermedi',r==='OK'?'success':'error',3000);return r==='OK'}catch(e){showAurumNotice(e.message,'error',3600);return false}}
    if(mode==='SETTINGS'){if(!confirm('Kaydedilmemiş ayar taslakları temizlenip Ayarlar ekranı yeniden kurulsun mu?'))return false;delete S?.__schedulerDraft;if(S)S.settingsDirty=false;renderCurrentPagePreservingView?.();showAurumNotice('Ayar ekranı durumu onarıldı','success',2200);return true}
    if(mode==='NATIVE'){const ok=globalThis.__AURUM_NATIVE_BRIDGE_V2__==='REV20.2'&&typeof globalThis.AurumNativeCall==='function';showAurumNotice(ok?'Native köprü v2 hazır':'Native köprü hazır değil',ok?'success':'error',3000);return ok}
    if(mode!=='DIAGNOSE'&&!confirm('Bu onarım işlemi şimdi çalıştırılsın mı?'))return false;
    return oldRepair(mode);
  };
  globalThis.rev20UserRepairModule=()=>aurumSettingsCard('Kullanıcı Onarımları','Kurulum kaldırmadan güvenli onarım araçları',`<div class="actions"><button class="ghost-btn" onclick="runRepairCenter('NATIVE')">Native Köprüyü Denetle</button><button class="ghost-btn" onclick="runRepairCenter('UI')">Görünümü Varsayılana Onar</button><button class="ghost-btn" onclick="runRepairCenter('SETTINGS')">Ayar Ekranını Onar</button><button class="ghost-btn" onclick="runRepairCenter('FOLDER')">Klasör İznini Sıfırla</button><button class="ghost-btn" onclick="runRepairCenter('CONTROL')">Buton / İptal Motorunu Onar</button><button class="ghost-btn" onclick="runRepairCenter('TRANSFER')">Veri Aktarımını Onar</button><button class="ghost-btn" onclick="runRepairCenter('BACKGROUND')">Arka Planı Onar</button><button class="ghost-btn" onclick="runRepairCenter('STAGING')">Geçici Depoyu Onar</button><button class="ghost-btn" onclick="runRepairCenter('RESUME')">Bekleyen İşi Sürdür</button><button class="ghost-btn" onclick="runRepairCenter('ONLINE')">Online Veri Onarımı</button><button class="ghost-btn" onclick="runRepairCenter('SCHEDULER')">Zamanlayıcıyı Onar</button></div><small class="muted">Bu bölüm finansal geçmişi otomatik silmez; ilgili çalışma katmanını yeniden kurar veya tanılar.</small>`,'rev20UserRepairs');
})();

/* REV20.4 DIRECT MARKET SOURCES: market cards use provider-published price and provider-published percentage only.
   No FX/gold cross multiplication and no previous-close percentage calculation is allowed in this layer. */
(()=>{
  if(globalThis.__AURUM_REV204_DIRECT_MARKET)return;globalThis.__AURUM_REV204_DIRECT_MARKET=true;
  const KEY='marketIndicatorsREV204Direct';
  const KEYS=['XU100','USDTRY','EURTRY','EURUSD','GRAMTRY','GOLDUSD'];
  const LIMITS={XU100:[1000,100000],USDTRY:[1,1000],EURTRY:[1,1200],EURUSD:[0.1,5],GRAMTRY:[10,100000],GOLDUSD:[100,50000]};
  const SOURCE_LABEL={BIGPARA:'Bigpara',BIGPARA_BAND:'Bigpara Piyasa Bandı',YAHOO_Q1:'Yahoo Q1 API',YAHOO_Q2:'Yahoo Q2 API',FOREKS:'Foreks açık servis'};
  const escHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function trNumber(v){
    if(v==null)return null;if(typeof v==='number')return Number.isFinite(v)?v:null;
    let s=String(v).replace(/\u00a0/g,' ').trim().replace(/\s+/g,'').replace(/%/g,'').replace(/^\+/,'');
    if(!s)return null;s=s.replace(/[^0-9,\.\-+]/g,'');if(!s)return null;
    if(s.includes(',')){s=s.replace(/\./g,'').replace(',','.');}
    else if(/^[-+]?\d{1,3}(?:\.\d{3})+$/.test(s)){s=s.replace(/\./g,'');}
    const x=Number(s);return Number.isFinite(x)?x:null;
  }
  function inRange(key,v){const x=Number(v),r=LIMITS[key];return Number.isFinite(x)&&(!r||(x>=r[0]&&x<=r[1]));}
  function directQuote(key,value,changePct,source,url,providerAt=null,extra={}){
    const v=trNumber(value),c=trNumber(changePct);if(!inRange(key,v)||(c!=null&&Math.abs(c)>35))return null;
    return {value:v,changePct:c,at:nowISO(),providerAt:providerAt||null,source,direct:true,url,...extra};
  }
  async function getText(url,provider,label){
    const r=await fetchWithTimeout(url,{headers:{Accept:'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.7'},cache:'no-store',__provider:provider},label||provider);
    if(!r.ok)throw new Error(`${provider} HTTP ${r.status}`);return await r.text();
  }
  function parseDoc(text){try{return new DOMParser().parseFromString(String(text||''),'text/html')}catch{return null}}
  function cleanText(v){return String(v??'').replace(/\u00a0/g,' ').replace(/[\t\r]+/g,' ').replace(/ +/g,' ').replace(/\n+/g,'\n').trim()}
  function parseTable(doc,rowMatcher,priceHeaders,pctHeaders,key,source,url){
    if(!doc)return null;
    for(const table of doc.querySelectorAll('table')){
      const rows=[...table.querySelectorAll('tr')];if(rows.length<2)continue;
      let hi=-1,headers=[];
      for(let i=0;i<Math.min(5,rows.length);i++){
        const c=[...rows[i].querySelectorAll('th,td')].map(x=>cleanText(x.textContent));
        if(c.some(x=>priceHeaders.some(r=>r.test(x)))&&c.some(x=>pctHeaders.some(r=>r.test(x)))){hi=i;headers=c;break}
      }
      if(hi<0)continue;
      const pi=headers.findIndex(x=>priceHeaders.some(r=>r.test(x))),ci=headers.findIndex(x=>pctHeaders.some(r=>r.test(x)));
      if(pi<0||ci<0)continue;
      for(let i=hi+1;i<rows.length;i++){
        const cells=[...rows[i].querySelectorAll('th,td')].map(x=>cleanText(x.textContent));if(!cells.length)continue;
        const joined=cells.join(' | ');if(!rowMatcher.test(joined))continue;
        const q=directQuote(key,cells[pi],cells[ci],source,url);if(q)return q;
      }
    }
    return null;
  }
  function pageUpdateText(doc){
    const t=cleanText(doc?.body?.innerText||doc?.body?.textContent||'');
    const m=t.match(/(?:Son\s+Güncelleme|Son\s+güncelleme\s+tarihi|SG:)\s*:?\s*([^\n]{4,45})/i);return m?cleanText(m[1]):null;
  }
  function regexDirect(doc,re,key,source,url,valueGroup=1,pctGroup=2){
    const t=cleanText(doc?.body?.innerText||doc?.body?.textContent||'');const m=t.match(re);if(!m)return null;
    return directQuote(key,m[valueGroup],m[pctGroup],source,url,pageUpdateText(doc));
  }
  async function bigparaBundle(){
    const out={},errors=[];
    const jobs=[
      ['doviz','https://bigpara.hurriyet.com.tr/doviz/'],
      ['altin','https://bigpara.hurriyet.com.tr/altin/'],
      ['bist','https://bigpara.hurriyet.com.tr/borsa/endeksler/bist100/']
    ];
    const rs=await Promise.allSettled(jobs.map(async([id,url])=>[id,url,parseDoc(await getText(url,'BIGPARA',`Bigpara ${id} doğrudan`))]));
    const docs={};for(const r of rs){if(r.status==='fulfilled'){const [id,url,doc]=r.value;docs[id]={url,doc}}else errors.push(String(r.reason?.message||r.reason))}
    if(docs.doviz){const {doc,url}=docs.doviz;
      out.USDTRY=parseTable(doc,/\bDolar\b.*(?:Türk\s*Lirası|USD)/i,[/^Fiyat$/i,/^Kapanış$/i],[/Fark.*%/i,/Değişim.*%/i],'USDTRY','BIGPARA',url)
        ||regexDirect(doc,/Dolar\s+Kuru[\s\S]{0,900}?([0-9][0-9.,]*)\s*%\s*([+\-]?[0-9.,]+)/i,'USDTRY','BIGPARA',url);
      out.EURTRY=parseTable(doc,/\bEuro\b.*(?:Türk\s*Lirası|EUR)/i,[/^Fiyat$/i,/^Kapanış$/i],[/Fark.*%/i,/Değişim.*%/i],'EURTRY','BIGPARA',url);
      out.EURUSD=parseTable(doc,/EUR\s*[\/-]\s*USD|EURUSD/i,[/^Parite$/i,/^Kapanış$/i],[/Değişim.*%/i,/Fark.*%/i],'EURUSD','BIGPARA',url);
    }
    if(docs.altin){const {doc,url}=docs.altin;
      out.GRAMTRY=parseTable(doc,/ALTIN\s*\(TL\s*\/\s*GR\)|Gram\s+Altın\s+Spot/i,[/^Fiyat$/i,/^Satış$/i],[/Fark.*%/i,/Değişim.*%/i],'GRAMTRY','BIGPARA',url)
        ||regexDirect(doc,/Gram\s+Altın(?:\s+Spot)?[\s\S]{0,700}?([0-9][0-9.,]*)\s*%\s*([+\-]?[0-9.,]+)/i,'GRAMTRY','BIGPARA',url);
      out.GOLDUSD=parseTable(doc,/Altın\s*\(\$\s*\/\s*ONS\)|Altın\s*\/\s*Dolar|ONS/i,[/^Fiyat$/i,/^Satış$/i],[/Fark.*%/i,/Değişim.*%/i],'GOLDUSD','BIGPARA',url)
        ||regexDirect(doc,/Altın\s*\(ONS\)[\s\S]{0,1500}?Satış\s*([0-9][0-9.,]*)[\s\S]{0,350}?Fark\s*%+\s*([+\-]?[0-9.,]+)/i,'GOLDUSD','BIGPARA',url);
    }
    if(docs.bist){const {doc,url}=docs.bist;
      out.XU100=regexDirect(doc,/BIST\s*100[\s\S]{0,700}?([0-9][0-9.,]*)\s+Değişim\s*:?\s*([+\-]?[0-9.,]+)\s*%/i,'XU100','BIGPARA',url);
    }
    return {out,errors};
  }
  async function bigparaBand(){
    const url='https://bigpara.hurriyet.com.tr/Partial/GetPiyasaBandContent/';
    const doc=parseDoc(await getText(url,'BIGPARA','Bigpara piyasa bandı doğrudan')),out={};if(!doc)return out;
    // Prefer semantic containers containing both label, direct value and direct percent.
    const candidates=[...doc.querySelectorAll('li,div,a')].filter(el=>el.children?.length&&el.textContent);
    const specs=[['XU100',/BIST\s*100|BIST100/i],['USDTRY',/\bDOLAR\b|USD\s*TRY/i],['EURTRY',/\bEURO\b|EUR\s*TRY/i],['GRAMTRY',/\bALTIN\b(?!.*ONS)|GRAM/i]];
    for(const [key,re] of specs){
      let best=null;for(const el of candidates){const t=cleanText(el.textContent);if(t.length>220||!re.test(t))continue;const nums=t.match(/[+\-]?[0-9][0-9.,]*/g)||[];const pct=(t.match(/([+\-]?[0-9][0-9.,]*)\s*%/)||t.match(/%\s*([+\-]?[0-9][0-9.,]*)/))?.[1];if(!pct)continue;for(const raw of nums){const v=trNumber(raw);if(inRange(key,v)){best=directQuote(key,raw,pct,'BIGPARA_BAND',url);if(best)break}}if(best)break}if(best)out[key]=best;
    }
    return out;
  }
  function deepCandidates(obj){const rows=[];(function walk(x,depth){if(depth>8||x==null)return;if(Array.isArray(x)){for(const v of x)walk(v,depth+1);return}if(typeof x==='object'){rows.push(x);for(const v of Object.values(x))walk(v,depth+1)}})(obj,0);return rows}
  function normKey(k){return String(k||'').toLocaleLowerCase('tr-TR').replace(/[ç]/g,'c').replace(/[ğ]/g,'g').replace(/[ı]/g,'i').replace(/[ö]/g,'o').replace(/[ş]/g,'s').replace(/[ü]/g,'u').replace(/[^a-z0-9]+/g,'')}
  function pickDirectField(row,names){const wanted=new Set(names.map(normKey));for(const [k,v] of Object.entries(row||{}))if(wanted.has(normKey(k))){const n=trNumber(v);if(n!=null)return n}return null}
  function parseForeksObject(obj,key,source,url){
    const priceKeys=['last','lastprice','price','fiyat','son','sonfiyat','kapanis','close','value','satis','sell','ask'];
    const pctKeys=['changepercent','changepercentage','percentchange','percentagechange','dailychangepercent','daychangepercent','yuzdedegisim','yuzdedeğisim','degisimyuzde','değisimyuzde','farkyuzde','farkpercent'];
    for(const row of deepCandidates(obj)){
      const value=pickDirectField(row,priceKeys),changePct=pickDirectField(row,pctKeys);const q=directQuote(key,value,changePct,source,url,null,{providerAt:row.DateTime||row.dateTime||row.time||row.timestamp||null});if(q)return q;
    }
    return null;
  }
  async function foreksOne(key,candidates){let last=null;for(const c of candidates){
    const url=`https://web-paragaranti-pubsub.foreks.com/web-services/securities/definition?name=${encodeURIComponent(c.name)}&group=${encodeURIComponent(c.group)}&exchange=${encodeURIComponent(c.exchange)}`;
    try{const r=await fetchWithTimeout(url,{headers:{Accept:'application/json'},cache:'no-store',__provider:'FOREKS'},`Foreks ${key} doğrudan`);if(!r.ok)throw new Error(`HTTP ${r.status}`);const q=parseForeksObject(await responseJSON(r),key,'FOREKS',url);if(q)return q;}catch(e){last=e}
    }if(last)throw last;throw new Error(`${key} Foreks doğrudan alanları yok`)
  }
  async function foreksBundle(){
    const spec={XU100:[{name:'XU100',group:'E',exchange:'BIST'}],USDTRY:[{name:'SUSD',group:'F',exchange:'FREE'}],EURTRY:[{name:'SEUR',group:'F',exchange:'FREE'}],EURUSD:[{name:'EURUSD',group:'F',exchange:'FOREX'},{name:'EURUSD',group:'F',exchange:'FREE'}],GRAMTRY:[{name:'ALTIN',group:'F',exchange:'FREE'},{name:'GLDGR',group:'F',exchange:'FREE'}],GOLDUSD:[{name:'XAUUSD',group:'F',exchange:'FOREX'},{name:'XAUUSD',group:'F',exchange:'FREE'}]};
    const out={},errors=[];const rs=await Promise.allSettled(Object.entries(spec).map(async([k,c])=>[k,await foreksOne(k,c)]));for(const r of rs){if(r.status==='fulfilled')out[r.value[0]]=r.value[1];else errors.push(String(r.reason?.message||r.reason))}return {out,errors};
  }
  async function yahooBundle(host){
    const source=host.startsWith('query1')?'YAHOO_Q1':'YAHOO_Q2',symbols={'XU100.IS':'XU100','TRY=X':'USDTRY','EURTRY=X':'EURTRY','EURUSD=X':'EURUSD','XAUUSD=X':'GOLDUSD','GC=F':'GOLDUSD'};
    const url=`https://${host}/v7/finance/quote?symbols=${encodeURIComponent(Object.keys(symbols).join(','))}`;
    const r=await fetchWithTimeout(url,{headers:{Accept:'application/json','User-Agent':'Mozilla/5.0'},cache:'no-store',__provider:'YAHOO_QUOTE'},`${source} doğrudan quote`);if(!r.ok)throw new Error(`${source} HTTP ${r.status}`);
    const obj=await responseJSON(r),rows=obj?.quoteResponse?.result;if(!Array.isArray(rows)||!rows.length)throw new Error(`${source} quote boş`);const out={};
    for(const row of rows){const key=symbols[String(row?.symbol||'')];if(!key||out[key])continue;const q=directQuote(key,row.regularMarketPrice,row.regularMarketChangePercent,source,url,row.regularMarketTime?new Date(Number(row.regularMarketTime)*1000).toISOString():null,{symbol:row.symbol,bid:trNumber(row.bid),ask:trNumber(row.ask)});if(q)out[key]=q}
    return out;
  }
  function choose(key,sources){for(const src of sources){const q=src?.[key];if(q?.direct&&inRange(key,q.value)&&Number.isFinite(Number(q.changePct)))return q}for(const src of sources){const q=src?.[key];if(q?.direct&&inRange(key,q.value))return {...q,changePct:null,percentOrigin:'PROVIDER_OMITTED'}}return null}
  function directCached(){const s=state.marketIndicators;if(s?.source==='REV20.4_DIRECT_PROVIDER_VALUES')return s;return readLocal(KEY,null)}
  globalThis.cachedMarketIndicators=directCached;
  async function refresh(){
    const settled=await Promise.allSettled([bigparaBundle(),bigparaBand(),yahooBundle('query1.finance.yahoo.com'),yahooBundle('query2.finance.yahoo.com'),foreksBundle()]);
    let bp={},band={},y1={},y2={},fk={},errors=[];
    if(settled[0].status==='fulfilled'){bp=settled[0].value.out||{};errors.push(...(settled[0].value.errors||[]))}else errors.push('Bigpara: '+String(settled[0].reason?.message||settled[0].reason));
    if(settled[1].status==='fulfilled')band=settled[1].value||{};else errors.push('BigparaBand: '+String(settled[1].reason?.message||settled[1].reason));
    if(settled[2].status==='fulfilled')y1=settled[2].value||{};else errors.push('YahooQ1: '+String(settled[2].reason?.message||settled[2].reason));
    if(settled[3].status==='fulfilled')y2=settled[3].value||{};else errors.push('YahooQ2: '+String(settled[3].reason?.message||settled[3].reason));
    if(settled[4].status==='fulfilled'){fk=settled[4].value.out||{};errors.push(...(settled[4].value.errors||[]))}else errors.push('Foreks: '+String(settled[4].reason?.message||settled[4].reason));
    const previous=directCached()||{},old=previous.fields||{},fields={};
    const order={XU100:[bp,fk,band,y1,y2],USDTRY:[bp,band,fk,y1,y2],EURTRY:[bp,band,fk,y1,y2],EURUSD:[bp,y1,y2,fk],GRAMTRY:[bp,band,fk],GOLDUSD:[bp,y1,y2,fk]};
    for(const key of KEYS){fields[key]=choose(key,order[key]);if(!fields[key]&&old[key]?.direct)fields[key]={...old[key],stale:true,changePct:null,staleSince:nowISO()};if(!fields[key])delete fields[key]}
    const values=Object.fromEntries(KEYS.map(k=>[k,Number.isFinite(Number(fields[k]?.value))?Number(fields[k].value):null]));
    const payload={at:nowISO(),updatedAt:nowISO(),source:'REV20.4_DIRECT_PROVIDER_VALUES',calculated:false,values,fields,errors:errors.filter(Boolean).slice(0,12)};
    state.marketIndicators=payload;writeLocal(KEY,payload);for(const k of ['marketIndicatorsR3','marketIndicatorsR40','marketIndicatorsR47'])writeLocal(k,payload);
    try{await dbPut('meta',{key:KEY,value:payload,updatedAt:nowISO()});await dbPut('meta',{key:'marketIndicatorsR40',value:payload,updatedAt:nowISO()})}catch{}
    return payload;
  }
  globalThis.refreshMarketIndicators=refresh;try{refreshMarketIndicators=refresh}catch{}
  function markup(){
    const m=directCached()||{},f=m.fields||{},legacy=m.values||{};
    const item=(label,key,d=2)=>{const x=f[key]||{},v=trNumber(x.value??legacy[key]),c=x.stale?null:trNumber(x.changePct);
      const val=v!=null?(key==='XU100'?v.toLocaleString('tr-TR',{minimumFractionDigits:0,maximumFractionDigits:2,useGrouping:true}):v.toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d})):'—';
      let delta='';if(c!=null){const dir=c>0?'up':c<0?'down':'flat',arrow=c>0?'↑':c<0?'↓':'·',pct=Math.abs(c).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%';delta=`<small class="aurum-r4-change ${dir}"><span class="aurum-r4-arrow">${arrow}</span><span class="aurum-r4-pct">${pct}</span></small>`}else if(x.stale)delta='<small class="aurum-r4-change flat"><span class="aurum-r4-pct">eski</span></small>';
      const title=[SOURCE_LABEL[x.source]||x.source,x.providerAt?`Kaynak zamanı ${x.providerAt}`:'',x.direct?'Kaynağın doğrudan yayımladığı fiyat ve yüzde':'',x.stale?'Son doğrudan veri; güncel kaynak alınamadı':''].filter(Boolean).join(' · ');
      return `<span class="aurum-r3-market-item" title="${escHtml(title)}"><b>${escHtml(label)}</b> ${escHtml(val)}${delta}</span>`};
    return `<div class="aurum-market-indicators aurum-r3-market">${item('BIST 100','XU100',0)}${item('USD','USDTRY',4)}${item('EUR','EURTRY',4)}${item('Parite','EURUSD',4)}${item('Altın gr','GRAMTRY',2)}${item('Ons','GOLDUSD',2)}</div>`;
  }
  globalThis.marketIndicatorsMarkup=markup;try{marketIndicatorsMarkup=markup}catch{}
  // Prevent old computed market cache from flashing before first direct refresh.
  try{if(state.marketIndicators?.source!=='REV20.4_DIRECT_PROVIDER_VALUES')state.marketIndicators=null}catch{}
  /* Startup refresh intentionally disabled: market refresh is manual, scheduled/data-command driven, or the independent 30-minute timer. */
})();


/* REV20.39 strict acquisition policy: lifecycle/connectivity/navigation never trigger data or market work.
   Main tables: defined Android scheduler or explicit user command only.
   Market indicators + finance portal: independent 30-minute cadence or explicit user refresh only.
   Market cards prefer a provider record containing both value and provider-published percentage; when the
   same provider publishes a value without a percentage, the value may be shown and the percentage stays blank.
   No local percentage synthesis is permitted by the final direct-market layer. Periodic work is asynchronous. */
try{AurumUpdateAPI.state.r239={version:'REV20.39-STRICT-CADENCE-SAME-SOURCE-MARKET',activatedAt:nowISO(),features:[
 'NO_APP_START_FETCH','NO_FOREGROUND_FETCH','NO_CONNECTIVITY_RESTORE_FETCH','NO_TAB_NAVIGATION_FETCH',
 'TABLES_ONLY_DEFINED_SCHEDULER_OR_EXPLICIT_MANUAL','MARKET_INDICATORS_30M_OR_MANUAL',
 'FINANCE_PORTAL_30M_OR_MANUAL','VALUE_PERCENT_SAME_PROVIDER_RECORD','PROVIDER_PERCENT_ONLY',
 'VALUE_ALLOWED_PERCENT_BLANK_IF_PROVIDER_OMITS','NONBLOCKING_IDLE_PERIODIC_WORK'
]}}catch{}

/* ===== REV20.5 COMPLETENESS GUARD + DIRECT MARKET V2 =====
   Goals:
   - Keep AurumB-style sharded acquisition speed while driving real-data completeness >=95%.
   - Never accept a timestamp-only live payload as an "Anlik" success.
   - Preserve previously learned/local metadata when a network refresh does not replace it.
   - Fill stock USD return series from ONE directly downloaded USD/TRY daily series (not market-card data).
   - Market header cards never synthesize price or percentage: only source-published values are displayed.
*/
(()=>{
  if(globalThis.__AURUM_REV205_COMPLETENESS)return;globalThis.__AURUM_REV205_COMPLETENESS=true;
  const TARGET_FILL=95;
  const USD_TTL=30*60*1000;
  let usdMap=new Map(),usdAt=0,usdPromise=null;
  const carryKeys=['companyCard','companyCardHistory','crossValidation','enrichmentMetrics','behaviorProfile','behaviorScore','behaviorType','genomeProfile','genomeScore','genomeProbability','genomeType'];
  function hasValue(v){return !(v===null||v===undefined||v===''||(typeof v==='number'&&!Number.isFinite(v)));}
  function carryPrior(next,prior){
    if(!next||!prior)return next;
    for(const k of carryKeys)if(!hasValue(next[k])&&hasValue(prior[k]))next[k]=prior[k];
    return next;
  }
  async function enrichStagedWithPrior(jobId){
    try{
      const rows=await stageRows(jobId),prior=new Map((state.records||[]).map(r=>[r.sym,r]));let changed=false;
      for(const row of rows){const p=prior.get(row.sym);if(!p||!row?.record)continue;const before=JSON.stringify(carryKeys.map(k=>row.record[k]));carryPrior(row.record,p);const after=JSON.stringify(carryKeys.map(k=>row.record[k]));if(before!==after){row.updatedAt=nowISO();changed=true;}}
      if(changed)await bulkPut('stagingRecords',rows);
    }catch(e){try{await log('warn','REV20.5 önceki türetilmiş alan koruması uygulanamadı',{error:e?.message||String(e)})}catch{}}
  }
  const ap=globalThis.atomicPublish;
  if(typeof ap==='function')globalThis.atomicPublish=atomicPublish=async function r205Atomic(job,universe){await enrichStagedWithPrior(job?.id);return ap(job,universe)};
  const arp=globalThis.atomicRepairPublish;
  if(typeof arp==='function')globalThis.atomicRepairPublish=atomicRepairPublish=async function r205AtomicRepair(job,targets){await enrichStagedWithPrior(job?.id);return arp(job,targets)};

  async function yahooUsdMap(){
    let last=null;
    for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
      try{
        const u=`https://${host}/v8/finance/chart/TRY=X?range=2y&interval=1d&includePrePost=false&events=div%2Csplits`;
        const r=await fetchWithTimeout(u,{headers:{Accept:'application/json'},cache:'no-store',__provider:'YAHOO'},'USDTRY tarihsel seri');
        if(!r.ok)throw new Error(`HTTP ${r.status}`);const o=await responseJSON(r),x=o?.chart?.result?.[0],ts=x?.timestamp||[],cs=x?.indicators?.quote?.[0]?.close||[];const m=new Map();
        for(let i=0;i<Math.min(ts.length,cs.length);i++){const v=Number(cs[i]);if(!(v>0))continue;const d=new Date(Number(ts[i])*1000);if(!Number.isFinite(d.getTime()))continue;m.set(d.toISOString().slice(0,10),v)}
        if(m.size<120)throw new Error(`USDTRY history too short ${m.size}`);return m;
      }catch(e){last=e}
    }
    throw last||new Error('USDTRY historical series unavailable');
  }
  async function ensureUsdMap(force=false){
    if(!force&&usdMap.size>120&&Date.now()-usdAt<USD_TTL)return usdMap;
    if(usdPromise)return usdPromise;
    usdPromise=(async()=>{try{const m=await yahooUsdMap();usdMap=m;usdAt=Date.now();return m}catch(e){try{await log('warn','USD getiri yardımcı serisi alınamadı',{error:e?.message||String(e)})}catch{}return usdMap}finally{usdPromise=null}})();
    return usdPromise;
  }
  const eb=globalThis.enrichBundle;
  if(typeof eb==='function')globalThis.enrichBundle=enrichBundle=function r205EnrichBundle(bundle,indexBundle){
    try{if(bundle?.bars?.length&&usdMap.size){for(const b of bundle.bars){if(validNumber(b?.usdAof)!=null&&Number(b.usdAof)>0)continue;const fx=usdMap.get(String(b?.date||'').slice(0,10)),px=validNumber(b?.close);if(fx>0&&px>0){b.usdAof=px/fx;b.sources={...(b.sources||{}),usdAof:'YAHOO_USDTRY_DAILY_DIRECT'}}}}}catch{}
    return eb(bundle,indexBundle);
  };

  // Mathematically undefined volume-change after a zero previous volume is N/A, not missing data.
  const baseRaw=globalThis.v141225Raw;
  if(typeof baseRaw==='function')globalThis.v141225Raw=v141225Raw=function r205Raw(rec,key,skipCompleteness=false){
    let v=baseRaw(rec,key,skipCompleteness);if(v!=null)return v;
    try{
      const s=rec?.series||{},n=s.date?.length||0,ix=n-1;
      if(key==='HacimDegisim%_T0'){const a=Number(s.volume?.[ix]),b=Number(s.volume?.[ix-1]);if(Number.isFinite(a)&&a>=0&&b===0)return 'N/A';}
      const m=String(key).match(/^HacimDegisim%_T(\d+)$/);if(m){const i=ix-Number(m[1]),a=Number(s.volume?.[i]),b=Number(s.volume?.[i-1]);if(i>0&&Number.isFinite(a)&&a>=0&&b===0)return 'N/A';}
      if(key==='FD_FAVOK_T0'){const fd=Number(rec?.fundamentals?.enterpriseValue??rec?.enterpriseValue),favok=Number(rec?.fundamentals?.ebitda??rec?.ebitda);if(Number.isFinite(fd)&&Number.isFinite(favok)&&favok!==0){const q=fd/favok;if(Number.isFinite(q)&&Math.abs(q)<10000)return q;}}
    }catch{}
    return v;
  };
  const baseCell=globalThis.v141225Cell;
  if(typeof baseCell==='function')globalThis.v141225Cell=v141225Cell=function r205Cell(rec,key){const v=v141225Raw(rec,key);if(v==='N/A')return '<span class="muted" title="Matematiksel olarak uygulanamaz">N/A</span>';return baseCell(rec,key)};

  const baseGeneral=globalThis.prepareGeneralData,baseRepair=globalThis.prepareMissingData;
  async function refreshDerivedProfiles(){try{if(typeof rebuildBehaviorProfiles==='function'&&state.records?.length)await rebuildBehaviorProfiles(state.records,{force:false})}catch(e){try{await log('warn','REV20.5 davranış/DNA alanları yenilenemedi',{error:e?.message||String(e)})}catch{}}}
  async function applyCompletenessDefaults(){
    state.settings.symbolRepairRounds=Math.max(3,Number(state.settings.symbolRepairRounds||1));
    state.settings.providerWaveSize=Math.max(8,Number(state.settings.providerWaveSize||8));
  }
  if(typeof baseRepair==='function')globalThis.prepareMissingData=prepareMissingData=async function r205Repair(job){await applyCompletenessDefaults();await ensureUsdMap();const ok=await baseRepair(job);if(ok)await refreshDerivedProfiles();return ok};
  if(typeof baseGeneral==='function')globalThis.prepareGeneralData=prepareGeneralData=async function r205General(job,mode='GENERAL'){
    await applyCompletenessDefaults();await ensureUsdMap();const ok=await baseGeneral(job,mode);if(!ok||mode==='LIVE')return ok;await refreshDerivedProfiles();
    let prev=Number(dataSummary(state.records)?.fillPct||0),round=0;
    while(prev<TARGET_FILL&&round<3&&!cancelRequested(job)){
      const plan=currentPendingRepairPlan();if(!plan?.symbolCount)break;round++;
      setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',done:0,total:plan.symbolCount,message:`Doluluk %${prev.toFixed(2)} · otomatik tamamlama ${round}/3 · hedef ≥%${TARGET_FILL}`});
      const rok=await baseRepair(job);if(!rok)break;await refreshDerivedProfiles();
      const now=Number(dataSummary(state.records)?.fillPct||0);try{job.dataSummary.automaticRepairRounds=round;job.dataSummary.completenessTarget=TARGET_FILL;await saveJob(job)}catch{}
      if(now<=prev+0.03)break;prev=now;
    }
    try{const sum=dataSummary(state.records);sum.completenessTarget=TARGET_FILL;sum.maxAllowedMissingPct=5;sum.rev205RealDataOnly=true;job.dataSummary=sum;await dbPut('meta',{key:'lastDataSummary',value:sum,updatedAt:nowISO()});await refreshTableMeta();}catch{}
    return true;
  };
  queueMicrotask(async()=>{try{await applyCompletenessDefaults();await saveSettings()}catch{}});
})();

/* REV20.5 MARKET DIRECT V2 — strict identity parsers and source-published changes only. */
(()=>{
  if(globalThis.__AURUM_REV205_MARKET_DIRECT)return;globalThis.__AURUM_REV205_MARKET_DIRECT=true;
  const KEY='marketIndicatorsREV205DirectV2',KEYS=['XU100','USDTRY','EURTRY','EURUSD','GRAMTRY','GOLDUSD'];
  const LIMITS={XU100:[1000,100000],USDTRY:[5,500],EURTRY:[5,700],EURUSD:[.5,2],GRAMTRY:[100,50000],GOLDUSD:[500,10000]};
  const LABEL={BIGPARA_BAND:'Bigpara Piyasa Bandı',BIGPARA:'Bigpara',YAHOO_Q1:'Yahoo API',YAHOO_Q2:'Yahoo API',TCMB:'TCMB XML',FOREKS:'Foreks API'};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function n(v){if(v==null||v==='')return null;if(typeof v==='number')return Number.isFinite(v)?v:null;let x=String(v).replace(/\u00a0/g,' ').trim().replace(/\s+/g,'').replace(/%/g,'').replace(/^\+/,'').replace(/[^0-9,.\-+]/g,'');if(!x)return null;if(x.includes(',')&&x.includes('.'))x=x.lastIndexOf(',')>x.lastIndexOf('.')?x.replace(/\./g,'').replace(',','.'):x.replace(/,/g,'');else if(x.includes(','))x=x.replace(',','.');else if(/^[-+]?\d{1,3}(?:\.\d{3})+$/.test(x))x=x.replace(/\./g,'');const z=Number(x);return Number.isFinite(z)?z:null}
  function ok(k,v){const r=LIMITS[k],x=Number(v);return Number.isFinite(x)&&x>=r[0]&&x<=r[1]}
  function q(k,value,pct,source,providerAt=null,url=null){const v=n(value),c=n(pct);if(!ok(k,v))return null;if(c!=null&&Math.abs(c)>20)return null;return {value:v,changePct:c,source,providerAt,at:nowISO(),url,direct:true,identityVerified:true}}
  async function txt(url,provider,label){const r=await fetchWithTimeout(url,{headers:{Accept:'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'},cache:'no-store',__provider:provider},label);if(!r.ok)throw new Error(`${label} HTTP ${r.status}`);return await r.text()}
  function plain(htmlText){try{const stripped=String(htmlText).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ');return (new DOMParser().parseFromString(`<body>${stripped}</body>`,'text/html').body?.textContent||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim()}catch{return String(htmlText).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}}
  async function bigparaBand(){const url='https://bigpara.hurriyet.com.tr/Partial/GetPiyasaBandContent/?rev=205';const t=plain(await txt(url,'BIGPARA','Bigpara piyasa bandı'));const out={};const specs=[['XU100',/BIST\s*100\s+([0-9][0-9.]*(?:,[0-9]+)?)\s+([+\-]?[0-9]+(?:,[0-9]+)?)\s*%/i],['USDTRY',/DOLAR\s+([0-9][0-9.]*(?:,[0-9]+)?)\s+([+\-]?[0-9]+(?:,[0-9]+)?)\s*%/i],['EURTRY',/EURO\s+([0-9][0-9.]*(?:,[0-9]+)?)\s+([+\-]?[0-9]+(?:,[0-9]+)?)\s*%/i],['GRAMTRY',/ALTIN\s+([0-9][0-9.]*(?:,[0-9]+)?)\s+([+\-]?[0-9]+(?:,[0-9]+)?)\s*%/i]];for(const [k,re] of specs){const m=t.match(re);if(m){const z=q(k,m[1],m[2],'BIGPARA_BAND',null,url);if(z)out[k]=z}}if(!out.XU100&&!out.USDTRY&&!out.EURTRY&&!out.GRAMTRY)throw new Error('Bigpara band identity fields not parsed');return out}
  async function bigparaParity(){const url='https://bigpara.hurriyet.com.tr/doviz/pariteler/?rev=205';const t=plain(await txt(url,'BIGPARA','Bigpara parite'));let m=t.match(/EUR\s*[-\/]\s*USD[\s\S]{0,160}?([0-9]+,[0-9]+)\s+([0-9]+,[0-9]+)\s+([+\-]?[0-9]+(?:,[0-9]+)?)\s*%/i);if(!m)m=t.match(/EUR\s*\/\s*USD[\s\S]{0,120}?([0-9]+,[0-9]+)[\s\S]{0,40}?([+\-]?[0-9]+(?:,[0-9]+)?)\s*%/i);if(!m)throw new Error('EUR/USD direct row not parsed');return q('EURUSD',m.length>=4?m[2]:m[1],m.length>=4?m[3]:m[2],'BIGPARA',null,url)}
  async function bigparaGold(){const url='https://bigpara.hurriyet.com.tr/altin/?rev=205';const t=plain(await txt(url,'BIGPARA','Bigpara altın'));const out={};let m=t.match(/ALTIN\s*\(TL\/GR\)[\s\S]{0,100}?([+\-]?[0-9]+(?:,[0-9]+)?)\s*%[\s\S]{0,120}?ALIŞ(?:\(TL\))?\s*([0-9.]+,[0-9]+)[\s\S]{0,80}?SATIŞ(?:\(TL\))?\s*([0-9.]+,[0-9]+)/i);if(m)out.GRAMTRY=q('GRAMTRY',m[3],m[1],'BIGPARA',null,url);m=t.match(/Altın\s*\((?:\$\/)?ONS\)[\s\S]{0,100}?([+\-]?[0-9]+(?:,[0-9]+)?)\s*%[\s\S]{0,120}?ALIŞ(?:\(\$\))?\s*([0-9.]+,[0-9]+)[\s\S]{0,80}?SATIŞ(?:\(\$\))?\s*([0-9.]+,[0-9]+)/i);if(m)out.GOLDUSD=q('GOLDUSD',m[3],m[1],'BIGPARA',null,url);if(!out.GOLDUSD){m=t.match(/Altın\s*\(ONS\)[\s\S]{0,160}?([0-9.]+,[0-9]+)\s+([0-9.]+,[0-9]+)\s+([+\-]?[0-9]+(?:,[0-9]+)?)\s*%/i);if(m)out.GOLDUSD=q('GOLDUSD',m[2],m[3],'BIGPARA',null,url)}if(!out.GRAMTRY&&!out.GOLDUSD)throw new Error('Bigpara gold direct rows not parsed');return out}
  async function tcmb(){const url='https://www.tcmb.gov.tr/kurlar/today.xml';const x=await txt(url,'TCMB','TCMB bugün XML'),doc=new DOMParser().parseFromString(x,'application/xml'),out={};for(const [code,key] of [['USD','USDTRY'],['EUR','EURTRY']]){const el=[...doc.querySelectorAll('Currency')].find(e=>e.getAttribute('CurrencyCode')===code);if(!el)continue;const val=n(el.querySelector('ForexSelling')?.textContent||el.querySelector('BanknoteSelling')?.textContent);if(ok(key,val))out[key]=q(key,val,null,'TCMB',doc.documentElement?.getAttribute('Tarih')||null,url)}return out}
  async function yahoo(host){const src=host.startsWith('query1')?'YAHOO_Q1':'YAHOO_Q2',map={'XU100.IS':'XU100','TRY=X':'USDTRY','EURTRY=X':'EURTRY','EURUSD=X':'EURUSD'},url=`https://${host}/v7/finance/quote?symbols=${encodeURIComponent(Object.keys(map).join(','))}`;const r=await fetchWithTimeout(url,{headers:{Accept:'application/json'},cache:'no-store',__provider:'YAHOO_QUOTE'},`${src} market API`);if(!r.ok)throw new Error(`${src} HTTP ${r.status}`);const o=await responseJSON(r),rows=o?.quoteResponse?.result||[],out={};for(const row of rows){const key=map[row?.symbol];if(!key)continue;const z=q(key,row.regularMarketPrice,row.regularMarketChangePercent,src,row.regularMarketTime?new Date(Number(row.regularMarketTime)*1000).toISOString():null,url);if(z)out[key]=z}return out}
  function median(a){const x=a.filter(Number.isFinite).sort((a,b)=>a-b);if(!x.length)return null;return x[Math.floor(x.length/2)]}
  function choose(key,cands){const arr=cands.filter(x=>x&&ok(key,x.value));if(!arr.length)return null;if(arr.length===1)return arr[0];const med=median(arr.map(x=>Number(x.value))),tol={XU100:.05,USDTRY:.025,EURTRY:.025,EURUSD:.015,GRAMTRY:.06,GOLDUSD:.06}[key]||.05;const sane=arr.filter(x=>Math.abs(Number(x.value)/med-1)<=tol);const withPct=sane.filter(x=>Number.isFinite(Number(x.changePct)));return (withPct[0]||sane[0]||null)}
  function cached(){const x=state.marketIndicators;if(x?.source==='REV20.5_DIRECT_PROVIDER_VALUES')return x;return readLocal(KEY,null)}
  globalThis.cachedMarketIndicators=cached;
  async function refresh(){
    const rs=await Promise.allSettled([bigparaBand(),bigparaParity(),bigparaGold(),yahoo('query1.finance.yahoo.com'),yahoo('query2.finance.yahoo.com'),tcmb()]);const srcs=rs.map(x=>x.status==='fulfilled'?x.value:{}),errors=rs.filter(x=>x.status==='rejected').map(x=>String(x.reason?.message||x.reason));const old=cached()?.fields||{},fields={};
    for(const key of KEYS){const picked=choose(key,srcs.map(x=>x?.[key]));if(picked)fields[key]=picked;else if(old[key]?.identityVerified&&Date.now()-Date.parse(old[key].at||0)<6*60*60*1000)fields[key]={...old[key],stale:true,changePct:null};}
    const payload={at:nowISO(),updatedAt:nowISO(),source:'REV20.5_DIRECT_PROVIDER_VALUES',calculated:false,strictIdentity:true,fields,values:Object.fromEntries(KEYS.map(k=>[k,fields[k]?.value??null])),errors:errors.slice(0,8)};state.marketIndicators=payload;writeLocal(KEY,payload);try{await dbPut('meta',{key:KEY,value:payload,updatedAt:nowISO()})}catch{}return payload;
  }
  globalThis.refreshMarketIndicators=refresh;try{refreshMarketIndicators=refresh}catch{}
  function fnum(v,key){if(!Number.isFinite(Number(v)))return '—';const d=key==='XU100'?0:key==='GRAMTRY'||key==='GOLDUSD'?2:4;return Number(v).toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d,useGrouping:true})}
  function markup(){const m=cached()||{},f=m.fields||{};const labs={XU100:'BIST 100',USDTRY:'USD/TRY',EURTRY:'EUR/TRY',EURUSD:'EUR/USD',GRAMTRY:'Gram Altın',GOLDUSD:'Altın Ons'};return `<div class="aurum-r209-market-wrap" id="aurumDataMarketStrip"><button type="button" class="aurum-r209-market-refresh" title="Piyasa bilgilerini yenile" aria-label="Piyasa bilgilerini yenile" onclick="refreshAurumDataMarketStrip(event)"><span aria-hidden="true">↻</span></button><div class="aurum-r205-market">${KEYS.map(key=>{const x=f[key]||{},c=x.stale?null:Number(x.changePct),cls=Number.isFinite(c)?(c>0?'up':c<0?'down':'flat'):'flat',pct=Number.isFinite(c)?`${c>0?'+':''}${c.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})}%`:(x.stale?'eski':'—'),arrow=Number.isFinite(c)?(c>0?'↑':c<0?'↓':''):'',title=[LABEL[x.source]||x.source,x.providerAt?`Kaynak zamanı: ${x.providerAt}`:'','Fiyat ve yüzde kaynakta doğrudan yayımlanan alanlardır.',x.stale?'Güncel kaynak alınamadı; son doğrulanmış fiyat gösteriliyor.':''].filter(Boolean).join(' · ');return `<div class="aurum-r205-market-card" title="${esc(title)}"><span class="aurum-r205-market-label">${labs[key]}</span><strong class="aurum-r205-market-value">${fnum(x.value,key)}</strong><span class="aurum-r205-market-pct ${cls}">${arrow?`<i class="aurum-market-dir" aria-hidden="true">${arrow}</i>`:""}${pct}</span></div>`}).join('')}</div></div>`}
  globalThis.marketIndicatorsMarkup=markup;try{marketIndicatorsMarkup=markup}catch{}
  globalThis.refreshAurumDataMarketStrip=async function refreshAurumDataMarketStripR209(ev){const btn=ev?.currentTarget||document.querySelector('.aurum-r209-market-refresh');if(btn?.dataset.busy==='1')return false;try{if(btn){btn.dataset.busy='1';btn.disabled=true;}await refresh();const host=document.getElementById('aurumDataMarketStrip');if(host)host.outerHTML=markup();globalThis.showAurumNotice?.('Piyasa bilgileri yenilendi','success',1400);return true}catch(e){globalThis.showAurumNotice?.('Piyasa bilgileri yenilenemedi: '+(e?.message||e),'error',2600);return false}finally{const b=document.querySelector('.aurum-r209-market-refresh');if(b){delete b.dataset.busy;b.disabled=false;}}};
  try{if(state.marketIndicators?.source!=='REV20.5_DIRECT_PROVIDER_VALUES')state.marketIndicators=null}catch{}
  /* Startup refresh intentionally disabled: market refresh is manual, scheduled/data-command driven, or the independent 30-minute timer. */
})();


/* ===== REV20.7 BULK QUOTE ACCELERATOR =====
   Fetches current quote/fundamental fields in small multi-symbol batches. This reduces request
   count dramatically while keeping the historical lane distributed across independent sources. */
(function installR207BulkQuoteAccelerator(){
  if(globalThis.__AURUM_REV207_BULK_QUOTES)return;globalThis.__AURUM_REV207_BULK_QUOTES=true;
  const TTL=4*60*1000,cache=new Map();let warmPromise=null,warmKey='';
  const oldYahooQuote=globalThis.fetchYahooQuote||fetchYahooQuote;
  const tickerOf=s=>s===INDEX_SYMBOL?'XU100.IS':`${s}.IS`;
  const symOf=t=>String(t||'').replace(/\.IS$/i,'').toUpperCase();
  const bundle=(sym,q,url)=>{const requestedAt=nowISO(),mt=Number(q?.regularMarketTime),at=Number.isFinite(mt)&&mt>0?new Date(mt*1000).toISOString():null,shares=finite(q?.sharesOutstanding),floats=finite(q?.floatShares);return {provider:'YAHOO_QUOTE',symbol:sym,bars:[],fundamentals:{marketCap:finite(q?.marketCap),capital:shares,enterpriseValue:finite(q?.enterpriseValue),ebitda:finite(q?.ebitda),pe:finite(q?.trailingPE??q?.forwardPE),pb:finite(q?.priceToBook),freeFloat:floats!=null&&shares>0?100*floats/shares:null,roe:finite(q?.returnOnEquity),evEbitda:finite(q?.enterpriseToEbitda)},live:finite(q?.regularMarketPrice)>0?{price:finite(q.regularMarketPrice),at,timestampVerified:!!at,provider:'YAHOO_QUOTE_BULK'}:null,marketPoint:at?{at,provider:'YAHOO_QUOTE_BULK',timestampVerified:true}:null,actions:[],requestedAt,receivedAt:nowISO(),url,bulk:true};};
  function getBundle(sym){const x=cache.get(String(sym||'').toUpperCase());return x&&Date.now()-x.at<TTL?x.bundle:null}
  async function fetchChunk(syms,host){
    const tickers=syms.map(tickerOf),url=`https://${host}/v7/finance/quote?symbols=${encodeURIComponent(tickers.join(','))}`;
    const res=await withProviderSlot('YAHOO_QUOTE',()=>fetchWithTimeout(url,{headers:{Accept:'application/json'},cache:'no-store',credentials:'omit',__provider:'YAHOO_QUOTE'},'Yahoo toplu quote'));
    if(!res.ok)throw new Error(`Yahoo toplu quote HTTP ${res.status}`);const obj=await responseJSON(res),rows=obj?.quoteResponse?.result||[];
    for(const q of rows){const sym=symOf(q?.symbol);if(!sym||!syms.includes(sym))continue;const b=bundle(sym,q,url);if(b.live?.price||Object.values(b.fundamentals||{}).some(Number.isFinite))cache.set(sym,{at:Date.now(),bundle:b});}
    return rows.length;
  }
  async function prewarm(symbols=[]){
    const all=[...new Set((symbols||[]).map(x=>String(x||'').toUpperCase()).filter(Boolean))],need=all.filter(x=>!getBundle(x));if(!need.length)return {requested:0,cached:all.length};
    const key=need.slice().sort().join(',');if(warmPromise&&warmKey===key)return warmPromise;warmKey=key;
    warmPromise=(async()=>{const chunks=[];for(let i=0;i<need.length;i+=40)chunks.push(need.slice(i,i+40));let cursor=0,ok=0,failed=0;const wc=Math.min(3,chunks.length||1),worker=async id=>{while(true){const i=cursor++;if(i>=chunks.length)return;const host=(i+id)%2?'query2.finance.yahoo.com':'query1.finance.yahoo.com';try{ok+=await fetchChunk(chunks[i],host)}catch(e){failed++;try{const alt=host.startsWith('query1')?'query2.finance.yahoo.com':'query1.finance.yahoo.com';ok+=await fetchChunk(chunks[i],alt)}catch{}}}};await Promise.all(Array.from({length:wc},(_,i)=>worker(i)));return {requested:need.length,cached:all.filter(x=>!!getBundle(x)).length,rows:ok,failedChunks:failed}})().finally(()=>{warmPromise=null;warmKey=''});return warmPromise;
  }
  fetchYahooQuote=async function fetchYahooQuoteR207(sym){let b=getBundle(sym);if(b)return b;if(warmPromise){try{await Promise.race([warmPromise,new Promise(r=>setTimeout(r,4500))])}catch{}b=getBundle(sym);if(b)return b}return oldYahooQuote(sym)};
  globalThis.fetchYahooQuote=fetchYahooQuote;
  globalThis.AurumBulkQuoteCache=Object.freeze({version:'REV20.7',prewarm,getBundle,size:()=>cache.size,clear:()=>cache.clear()});
})();

/* ===== REV20.6 SMART MULTI-SOURCE COHORT SCHEDULER =====
   Objective: high throughput + >=95% real-data fill + a strict <=30 minute market-time cohort.
   The scheduler spreads symbols across capability-specialized providers, paces each provider
   independently, uses alternatives instead of hammering one endpoint, and only rescues fields
   that remain missing. No synthetic market prices/percentages are introduced here. */
(()=>{
  if(globalThis.__AURUM_REV206_SMART_COHORT)return;globalThis.__AURUM_REV206_SMART_COHORT=true;
  const VERSION='REV20.6-SMART-MULTISOURCE-30M';
  const COHORT_MS=30*60*1000, TARGET_FILL=95, MIN_FILL=95, MIN_COHORT_PCT=95;
  const LANE_POOLS={
    HIST:['YAHOO','YAHOO_ALT','ISYATIRIM','BIGPARA','FOREKS','STOOQ'],
    LIVE:['YAHOO_QUOTE','BIGPARA_LIVE','ISYATIRIM_LIVE','YAHOO','YAHOO_ALT','BIGPARA'],
    FUND:['ISYATIRIM_FINANCIALS','ISYATIRIM','YAHOO_QUOTE','BIGPARA_LIVE']
  };
  const LANE_WHEELS={
    HIST:['YAHOO','YAHOO','YAHOO_ALT','ISYATIRIM','ISYATIRIM','BIGPARA','BIGPARA','FOREKS','STOOQ'],
    LIVE:['YAHOO_QUOTE','YAHOO_QUOTE','BIGPARA_LIVE','BIGPARA_LIVE','ISYATIRIM_LIVE','YAHOO','YAHOO_ALT','BIGPARA'],
    FUND:['ISYATIRIM_FINANCIALS','ISYATIRIM_FINANCIALS','ISYATIRIM','YAHOO_QUOTE','BIGPARA_LIVE']
  };
  const PROVIDER_GAP_MS={YAHOO:130,YAHOO_ALT:155,YAHOO_QUOTE:125,ISYATIRIM:180,ISYATIRIM_FINANCIALS:220,ISYATIRIM_LIVE:170,BIGPARA:165,BIGPARA_LIVE:150,FOREKS:220,STOOQ:260};
  const PROVIDER_CAP={YAHOO:8,YAHOO_ALT:7,YAHOO_QUOTE:6,ISYATIRIM:6,ISYATIRIM_FINANCIALS:4,ISYATIRIM_LIVE:5,BIGPARA:6,BIGPARA_LIVE:5,FOREKS:4,STOOQ:3};
  const PACE=new Map(),HEALTH=new Map();let HEALTH_AT=0;
  const hash=s=>{let h=2166136261;for(const c of String(s||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0};
  const uniq=xs=>[...new Set((xs||[]).filter(Boolean).map(x=>String(x).toUpperCase()))];
  const num=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
  const sleepMs=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms||0)));

  /* One provider is allowed to start requests at a controlled cadence. Providers still run
     in parallel with each other, so aggregate throughput remains high without burst-loading
     one API. Existing circuit-breaker / health accounting remains underneath this wrapper. */
  const oldBaseLimit=globalThis.baseProviderLimit||baseProviderLimit;
  globalThis.baseProviderLimit=baseProviderLimit=function r206BaseProviderLimit(code){const k=String(code||'').toUpperCase();if(PROVIDER_CAP[k])return PROVIDER_CAP[k];return Math.min(4,Number(oldBaseLimit?.(k)||4))};
  const oldSlot=globalThis.withProviderSlot||withProviderSlot;
  globalThis.withProviderSlot=withProviderSlot=async function r206ProviderSlot(code,fn){
    const k=String(code||'HTTP').toUpperCase(),gap=PROVIDER_GAP_MS[k]||180;
    const p=PACE.get(k)||{next:0};const now=Date.now(),start=Math.max(now,p.next||0);p.next=start+gap;PACE.set(k,p);
    if(start>now)await sleepMs(start-now);
    return oldSlot(k,fn);
  };

  /* Strict endpoint-time check. Canonical time is treated as the END of the accepted 30m
     cohort; data more than 30m older is rejected. A tiny +2m clock-skew allowance is allowed. */
  globalThis.marketWindowCheck=marketWindowCheck=function r206MarketWindowCheck(rec,canonicalAt){
    const c=safeTime(canonicalAt),t=externalMarketTime(rec);if(c==null)return {ok:false,reason:'CANONICAL_MARKET_TIME_UNAVAILABLE',deltaMinutes:null,sameTradingDay:false};if(t==null)return {ok:false,reason:'SOURCE_MARKET_TIME_UNVERIFIED',deltaMinutes:null,sameTradingDay:false};
    const lag=(c-t)/60000,lead=(t-c)/60000,day=x=>{try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x))}catch{return new Date(x).toISOString().slice(0,10)}},sameTradingDay=day(c)===day(t),ok=sameTradingDay&&lag<=30&&lead<=2;
    return {ok,reason:ok?null:(!sameTradingDay?'MARKET_TRADING_DAY_MISMATCH':lead>2?'MARKET_TIME_AFTER_COHORT_END':`MARKET_TIME_OLDER_THAN_30M`),deltaMinutes:Math.abs(c-t)/60000,sameTradingDay,marketAt:new Date(t).toISOString(),canonicalAt:new Date(c).toISOString()};
  };

  async function healthSnapshot(force=false){const now=Date.now();if(!force&&now-HEALTH_AT<12000&&HEALTH.size)return HEALTH;HEALTH_AT=now;await Promise.all(uniq(Object.values(LANE_POOLS).flat()).map(async c=>{try{HEALTH.set(c,await sourceHealth(c))}catch{}}));return HEALTH}
  async function providerAvailable(code){await healthSnapshot();const h=HEALTH.get(code)||{};return !((h.rateLimitedUntil||0)>Date.now()||(h.circuitUntil||0)>Date.now())}
  async function laneOrder(lane,sym,skip=new Set()){
    await healthSnapshot();const wheel=LANE_WHEELS[lane]||LANE_POOLS[lane]||[],pool=LANE_POOLS[lane]||[],seed=hash(`${lane}|${sym}`),primary=wheel.length?wheel[seed%wheel.length]:pool[0],rot=primary?[primary,...pool.filter(x=>x!==primary)]:pool.slice(),rows=[];
    for(let i=0;i<rot.length;i++){const code=rot[i];if(skip.has(code))continue;const h=HEALTH.get(code)||{},total=(h.success||0)+(h.failed||0),err=total?(h.failed||0)/total:0,lat=Math.min(5000,Number(h.avgLatencyMs||900)),blocked=((h.rateLimitedUntil||0)>Date.now()||(h.circuitUntil||0)>Date.now())?1:0;rows.push({code,score:(i===0?-900:i*70)+blocked*50000+err*1200+lat*.08})}
    return rows.sort((a,b)=>a.score-b.score).map(x=>x.code);
  }
  function fieldNeeds(fields=[]){const f=(fields||[]).map(String),all=!f.length||f.includes('*');return {hist:all||f.some(x=>/_T\d+$|EMA|MACD|RSI|Momentum|Volatilite|Boll|Beta|Getiri_|Hacim|Degisim3Gun|Destek|Direnc|Kapanis|Min_|Max_|ATR|Göreceli|AOF/i.test(x)),live:all||f.some(x=>/Anlik|VeriZamani|FiyatDegisim%_T0/i.test(x)),fund:all||f.some(x=>/PD_T0|SERMAYE|FD_|FAVOK|F_K|PD_DD|ROE|Hedef|Potansiyel|Çapraz|PiyasaDegeri|Ozsermaye/i.test(x))};}
  function histEnough(b){const c=coverage(b||{}),target=Math.max(120,Math.min(260,Math.round(Number(state.settings?.monthsBack||14)*21*.62)));return c.bars>=target&&c.open>=.75&&c.volume>=.72}
  function liveEnough(b){return num(b?.live?.price)>0&&b?.live?.timestampVerified===true&&safeTime(b.live.at)!=null}
  function fundCount(b){const f=b?.fundamentals||{};return ['marketCap','capital','enterpriseValue','ebitda','pe','pb','evEbitda','roe','freeFloat'].filter(k=>validFundamentalCandidate(k,f[k])!=null).length}
  function laneEnough(b,lane){return lane==='HIST'?histEnough(b):lane==='LIVE'?liveEnough(b):fundCount(b)>=4}
  function contribution(b,lane){if(!b)return false;if(lane==='HIST')return (b.bars||[]).filter(x=>validateBar(x).ok).length>=20;if(lane==='LIVE')return liveEnough(b);if(lane==='FUND')return fundCount(b)>0;return false}

  async function acquire(sym,start,end,{base=null,fields=['*'],skipProviders=[],onSource=null,maxFallback=1}={}){
    const needs=fieldNeeds(fields),seed=globalThis.AurumBulkQuoteCache?.getBundle?.(sym)||null,bundles=[...(base?[base]:[]),...(seed?[seed]:[])],attempts=[],attempted=new Set((skipProviders||[]).map(x=>String(x).toUpperCase())),promises=new Map();let merged=mergeBundles(sym,bundles);
    const run=(code,lane)=>{code=String(code||'').toUpperCase();if(!code||attempted.has(code))return Promise.resolve(false);if(promises.has(code))return promises.get(code);attempted.add(code);const p=(async()=>{const started=performance.now();try{if(!(await providerAvailable(code))){attempts.push({provider:code,lane,status:'SKIPPED_HEALTH'});return false}onSource?.({symbol:sym,provider:code,lane,status:'FETCHING'});const b=await withProviderSlot(code,()=>invokeProvider(code,sym,start,end));if(!contribution(b,lane)){attempts.push({provider:code,lane,status:'EMPTY',latencyMs:Math.round(performance.now()-started),bars:b?.bars?.length||0});onSource?.({symbol:sym,provider:code,lane,status:'EMPTY'});return false}bundles.push(b);attempts.push({provider:code,lane,status:'OK',latencyMs:Math.round(performance.now()-started),bars:b?.bars?.length||0,marketAt:b?.marketPoint?.at||b?.live?.at||null});state.sourceStats[code]=(state.sourceStats[code]||0)+1;onSource?.({symbol:sym,provider:code,lane,status:'OK'});return true}catch(e){attempts.push({provider:code,lane,status:'ERROR',error:e?.message||String(e),latencyMs:Math.round(performance.now()-started)});onSource?.({symbol:sym,provider:code,lane,status:'ERROR',error:e?.message||String(e)});return false}})();promises.set(code,p);return p};
    const laneNames=[];if(needs.hist)laneNames.push('HIST');if(needs.live&&state.settings?.liveEnabled!==false&&!liveEnough(merged))laneNames.push('LIVE');if(needs.fund&&fundCount(merged)<4)laneNames.push('FUND');
    const orders={};await Promise.all(laneNames.map(async l=>orders[l]=await laneOrder(l,sym,attempted)));
    /* First wave: exactly one capability-specialized provider per lane, all lanes concurrent. */
    await Promise.all(laneNames.map(l=>run(orders[l]?.[0],l)));merged=mergeBundles(sym,bundles);
    /* Fallbacks are selective: only an incomplete lane receives its next alternative. */
    for(let round=1;round<=Math.max(0,maxFallback);round++){
      const todo=laneNames.filter(l=>!laneEnough(merged,l));if(!todo.length)break;
      await Promise.all(todo.map(l=>run((orders[l]||[]).find(c=>!attempted.has(c)),l)));merged=mergeBundles(sym,bundles);
    }
    merged=mergeBundles(sym,bundles);merged.attempts=attempts;merged.r206Planner={attempted:[...attempted],historyOk:histEnough(merged),liveOk:liveEnough(merged),fundCount:fundCount(merged),fields:[...(fields||[])]};return merged;
  }

  /* One shared USD/TRY daily series fills USD-normalized stock-history columns without a per-stock
     FX request. This is direct source data; it is not the market-card value and no price is invented. */
  let FX=new Map(),FX_AT=0,FX_PROMISE=null;
  async function ensureFx(){if(FX.size>120&&Date.now()-FX_AT<COHORT_MS)return FX;if(FX_PROMISE)return FX_PROMISE;FX_PROMISE=(async()=>{for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){try{const url=`https://${host}/v8/finance/chart/TRY=X?range=2y&interval=1d&includePrePost=false`;const r=await withProviderSlot(host.startsWith('query1')?'YAHOO':'YAHOO_ALT',()=>fetchWithTimeout(url,{headers:{Accept:'application/json'},cache:'no-store',__provider:host.startsWith('query1')?'YAHOO':'YAHOO_ALT'},'USDTRY ortak seri'));if(!r.ok)continue;const o=await responseJSON(r),x=o?.chart?.result?.[0],ts=x?.timestamp||[],cs=x?.indicators?.quote?.[0]?.close||[],m=new Map();for(let i=0;i<Math.min(ts.length,cs.length);i++){const v=num(cs[i]),d=new Date(Number(ts[i])*1000);if(v>0&&Number.isFinite(d.getTime()))m.set(d.toISOString().slice(0,10),v)}if(m.size>120){FX=m;FX_AT=Date.now();return FX}}catch{}}return FX})().finally(()=>FX_PROMISE=null);return FX_PROMISE}
  const priorEnrich=globalThis.enrichBundle||enrichBundle;
  globalThis.enrichBundle=enrichBundle=function r206Enrich(bundle,indexBundle){try{if(bundle?.bars?.length&&FX.size){for(const b of bundle.bars){if(num(b?.usdAof)>0)continue;const fx=FX.get(String(b?.date||'').slice(0,10)),px=num(b?.close);if(fx>0&&px>0){b.usdAof=px/fx;b.sources={...(b.sources||{}),usdAof:'YAHOO_USDTRY_DAILY_DIRECT_SHARED'}}}}}catch{}return priorEnrich(bundle,indexBundle)};

  function stageStats(records,universe=currentSymbols()){
    const fields=V141225_ALL_HEADERS.filter(x=>x!=='Hisse'),by=new Map((records||[]).map(r=>[r.sym,r])),items=[];let missing=0;
    for(const sym of universe){const rec=by.get(sym);const mf=rec?bundleRecordMissingFields(rec):fields.slice();missing+=mf.length;items.push({sym,rec,fields:mf,time:rec?.jobDataStatus==='FRESH'?externalMarketTime(rec):null})}
    const valid=items.filter(x=>Number.isFinite(x.time)).sort((a,b)=>a.time-b.time);let bestL=0,bestR=-1,l=0;for(let r=0;r<valid.length;r++){while(valid[r].time-valid[l].time>COHORT_MS)l++;if(r-l>bestR-bestL||(r-l===bestR-bestL&&valid[r].time>(valid[bestR]?.time||0))){bestL=l;bestR=r}}
    const cohort=bestR>=bestL?valid.slice(bestL,bestR+1):[],set=new Set(cohort.map(x=>x.sym)),start=cohort.length?cohort[0].time:null,end=cohort.length?cohort.at(-1).time:null,totalCells=Math.max(1,universe.length*fields.length),fill=100*(1-missing/totalCells),cohortPct=100*cohort.length/Math.max(1,universe.length);
    return {fillPct:fill,missingCells:missing,items,cohortSet:set,cohortStart:start,cohortEnd:end,cohortCount:cohort.length,cohortPct,outside:items.filter(x=>!set.has(x.sym)).map(x=>x.sym)};
  }
  function markCandidate(candidate,bundle,job,wc,mode){candidate.unresolvedFields=bundleRecordMissingFields(candidate);candidate.providerAttempts=[...(bundle?.attempts||[])];candidate.dataSnapshotId=job.dataSnapshotId;candidate.jobId=job.id;candidate.jobMode=job.mode;candidate.jobDataStatus='FRESH';candidate.marketWindowEligible=wc.ok;candidate.marketWindowDeltaMinutes=wc.deltaMinutes;candidate.singlePassAttemptComplete=true;candidate.r206AttemptComplete=true;candidate.r206Mode=mode;candidate.r206At=nowISO();candidate.provenance={...(candidate.provenance||{}),sources:candidate.providers||[],marketAt:candidate.marketDataAt||null,marketTimeVerified:candidate.marketTimeVerified===true,marketTimeProvider:candidate.marketTimeProvider||null,validatedAt:nowISO(),jobId:job.id,canonicalMarketAt:job.canonicalMarketAt,marketWindowDeltaMinutes:wc.deltaMinutes,planner:VERSION};return candidate}
  function workerCount(total,rescue=false){const net=String(navigator?.connection?.effectiveType||''),hc=Math.max(2,Number(navigator?.hardwareConcurrency||4));let n=rescue?Math.min(4,Math.max(2,Math.floor(hc/2))):Math.min(7,Math.max(3,Math.floor(hc*.85)));if(/2g/.test(net))n=Math.min(n,2);else if(/3g/.test(net))n=Math.min(n,3);return Math.max(1,Math.min(total,n))}
  function priorBundleForMode(prior,mode,fields=['*']){
    const base=prior?.series?.date?.length?bundleFromRecord(prior):null;if(!base)return null;
    const wantsLive=fieldNeeds(fields).live,m=String(mode||'').toUpperCase();
    /* Eski tarihsel/temel veri kayıp yaşamamak için referans olabilir; ancak FULL veya canlı-alan
       onarımında eski anlık fiyat/zaman yeni kohortu hiçbir zaman tatmin edemez. */
    if(m==='FULL'||wantsLive){base.live=null;base.marketPoint=null;base.provider='LOCAL_PREVIOUS_REFERENCE_ONLY';base.currentReferenceSuppressed=true;}
    return base;
  }
  async function makeCandidate(sym,start,end,indexBundle,job,{prior=null,fields=['*'],skipProviders=[],maxFallback=1,onSource=null,mode='FULL',companyCard=false}={}){
    const base=priorBundleForMode(prior,mode,fields),b=await acquire(sym,start,end,{base,fields,skipProviders,onSource,maxFallback});if(!(b.attempts||[]).some(x=>x.status==='OK'))throw new Error('NO_PROVIDER_SUCCESS_R206');let c=enrichBundle(mergeBundles(sym,[b]),indexBundle);if(companyCard&&fieldNeeds(fields).fund)c=await enrichRepairFromCompanyCard(c,job,sym);const wc=job.canonicalMarketAt?marketWindowCheck(c,job.canonicalMarketAt):{ok:false,reason:'CANONICAL_MARKET_TIME_UNAVAILABLE',deltaMinutes:null};c=markCandidate(c,b,job,wc,mode);const vr=validateRecord(c,sym);if(!vr.ok)throw new Error(vr.issues.join(','));return c}

  async function qualityRescue(job,start,end,indexBundle,universe,round=1){
    const rows=(await stageRows(job.id)).map(x=>x.record),stats=stageStats(rows,universe),targets=[];
    for(const x of stats.items){if(!x.rec)targets.push({sym:x.sym,fields:['*'],reason:'MISSING_ROW'});else if(x.fields.length)targets.push({sym:x.sym,fields:x.fields,reason:'MISSING_FIELDS'});else if(!stats.cohortSet.has(x.sym))targets.push({sym:x.sym,fields:['Anlik','VeriZamani'],reason:'OUTSIDE_COHORT'})}
    if(!targets.length)return stats;
    const staged=new Map(rows.map(r=>[r.sym,r])),cursor={v:0},wc=workerCount(targets.length,true);
    const worker=async()=>{while(true){const i=cursor.v++;if(i>=targets.length)return;await pauseCheckpoint(job,JOB_STATUS.FETCHING_DATA);const t=targets[i],prior=staged.get(t.sym)||state.recordMap.get(t.sym)||null,skip=(prior?.providerAttempts||[]).map(x=>x.provider).filter(Boolean);try{const onSource=({provider,lane,status})=>setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',done:i,total:targets.length,validated:stats.cohortCount,message:`Akıllı tamamlama ${round} · ${t.sym} · ${lane||'ALT'} · ${sourceName(provider)}${status==='OK'?' ✓':''}`,symbol:t.sym,provider});const c=await makeCandidate(t.sym,start,end,indexBundle,job,{prior,fields:t.fields,skipProviders:skip,maxFallback:round>1?2:1,onSource,mode:'RESCUE',companyCard:round>1});await stagePut(job.id,t.sym,c);staged.set(t.sym,c)}catch(e){await issue(job,t.sym,'*','MULTI_SOURCE',`R206_RESCUE_${round}_FAILED`,e?.message||String(e))}}};
    await Promise.all(Array.from({length:wc},worker));await flushStageBatch(job.id);return stageStats((await stageRows(job.id)).map(x=>x.record),universe)
  }

  function r221SafeCarryForward(sym,prior,job,issues=[]){
    if(!prior){const p=makePlaceholder(sym,null,issues);p.jobId=job.id;p.dataSnapshotId=job.dataSnapshotId;p.jobMode=job.mode;p.r206AttemptComplete=true;p.marketWindowEligible=false;return p}
    const r=JSON.parse(JSON.stringify(prior));
    r.sym=sym;r.jobId=job.id;r.dataSnapshotId=job.dataSnapshotId;r.jobMode=job.mode;r.jobDataStatus='FRESH';r.r206AttemptComplete=true;r.r206SafePriorReference=true;r.marketWindowEligible=false;r.marketWindowDeltaMinutes=null;
    r.livePrice=null;r.dayChange=null;r.liveAt=null;r.marketDataAt=null;r.marketTimeVerified=false;r.marketTimeProvider=null;r.calculationEligible=false;
    r.calculationExclusionReasons=[...new Set([...(r.calculationExclusionReasons||[]),'CURRENT_LIVE_REQUIRES_REPAIR'])];
    r.dataIssues=[...new Set([...(r.dataIssues||[]),...issues,'OLD_LIVE_NOT_REUSED'])];
    r.provenance={...(r.provenance||{}),marketAt:null,marketTimeVerified:false,marketTimeProvider:null,canonicalMarketAt:job.canonicalMarketAt||null,planner:VERSION,safePriorReference:true};
    r.unresolvedFields=[...new Set([...(bundleRecordMissingFields(r)||[]),'Anlik','VeriZamani','FiyatDegisim%_T0'])];return r
  }
  function r221SuppressOutOfCohortLive(r,job){
    if(!r)return r;const x=JSON.parse(JSON.stringify(r));x.livePrice=null;x.dayChange=null;x.liveAt=null;x.marketDataAt=null;x.marketTimeVerified=false;x.marketTimeProvider=null;x.marketWindowEligible=false;x.marketWindowDeltaMinutes=null;x.calculationEligible=false;x.r221CohortLiveSuppressed=true;x.dataIssues=[...new Set([...(x.dataIssues||[]),'OUTSIDE_30M_COHORT_LIVE_SUPPRESSED'])];x.calculationExclusionReasons=[...new Set([...(x.calculationExclusionReasons||[]),'OUTSIDE_30M_COHORT'])];x.provenance={...(x.provenance||{}),marketAt:null,marketTimeVerified:false,marketTimeProvider:null,canonicalMarketAt:job.canonicalMarketAt||null};x.unresolvedFields=[...new Set([...(bundleRecordMissingFields(x)||[]),'Anlik','VeriZamani','FiyatDegisim%_T0'])];return x
  }

  async function enforceCohortAndGate(job,universe){
    let rows=(await stageRows(job.id)).map(x=>x.record),stats=stageStats(rows,universe);
    /* Kohort bulunamazsa yayın yine atomik olarak yapılabilir; canlı alanlar güvenli biçimde boş
       kalır ve akıllı tamamlama planına girer. Tarihsel/temel veri kaybedilmez. */
    if(stats.cohortEnd){job.canonicalMarketAt=new Date(stats.cohortEnd).toISOString();job.canonicalMarketProvider='R221_DENSEST_30M_COHORT';await saveJob(job)}
    if(stats.outside.length){const map=new Map(rows.map(r=>[r.sym,r]));for(const sym of stats.outside){const r=map.get(sym);if(r?.jobDataStatus==='FRESH')await stagePut(job.id,sym,r221SuppressOutOfCohortLive(r,job))}await flushStageBatch(job.id);rows=(await stageRows(job.id)).map(x=>x.record);stats=stageStats(rows,universe)}
    stats.fillTargetMet=stats.fillPct>=MIN_FILL;stats.fillTarget=TARGET_FILL;stats.cohortTargetMet=stats.cohortPct>=MIN_COHORT_PCT;
    return stats;
  }

  async function loadIndexAndCanonical(start,end){let indexBundle=(await dbGet('meta','indexBundle'))?.value||{bars:[]};const rs=await Promise.allSettled([
    (async()=>{try{await refreshKapDirectoryIfDue()}catch{}})(),
    globalThis.refreshMarketIndicators?.(),
    (async()=>{try{const fresh=await fetchIndexBundle(start,end);indexBundle=mergeBundles(INDEX_SYMBOL,[indexBundle,fresh]);await dbPut('meta',{key:'indexBundle',value:indexBundle,updatedAt:nowISO()})}catch{}})(),
    resolveCanonicalMarketPoint(start,end),ensureFx()
  ]);const cp=rs[3]?.status==='fulfilled'?rs[3].value:null;return {indexBundle,canonical:cp}}

  globalThis.prepareGeneralData=prepareGeneralData=async function prepareGeneralDataR206(job,mode='GENERAL'){
    const universe=currentSymbols(),resume=['FETCHING_DATA','WAITING_FOR_NETWORK','RETRY_PENDING'].includes(String(job?.status||''));job.totalSymbols=universe.length;job.currentStage='Veriler';job.requestedDataMode=mode==='GENERAL'?'FULL':mode;state.syncing=true;state.sourceStats={};
    const existing=resume?await stageRows(job.id):[],doneSet=new Set(existing.filter(x=>x?.record?.r206AttemptComplete===true).map(x=>x.sym));job.processedSymbols=doneSet.size;if(!resume)await clearStage(job.id);
    const restore={retry:state.settings.sourceRetryCount,r429:state.settings.maxProvider429Retries,timeout:state.settings.requestTimeoutMs};state.settings.sourceRetryCount=0;state.settings.maxProvider429Retries=0;state.settings.requestTimeoutMs=Math.max(4500,Math.min(10000,Number(state.settings.requestTimeoutMs||7000)));
    try{
      await transition(job,JOB_STATUS.FETCHING_DATA,{message:doneSet.size?`Akıllı çoklu kaynak staging devam · ${doneSet.size}/${universe.length}`:'Akıllı çoklu kaynak · uzman kaynak şeritleri eşzamanlı',done:doneSet.size,total:universe.length,validated:doneSet.size,failed:0});
      if(!isOnline()){await transition(job,JOB_STATUS.WAITING_FOR_NETWORK,{error:'OFFLINE',message:'Ağ bağlantısı bekleniyor'});return false}
      const end=new Date(),start=addMonths(end,-Number(state.settings.monthsBack||14)),[startup]=await Promise.all([loadIndexAndCanonical(start,end),globalThis.AurumBulkQuoteCache?.prewarm?.(universe)||Promise.resolve()]),indexBundle=startup.indexBundle,cp=startup.canonical;if(cp?.timestampVerified&&safeTime(cp.at)!=null){job.canonicalMarketAt=cp.at;job.canonicalMarketProvider=cp.provider||'INDEX'}else job.canonicalMarketAt=nowISO();await saveJob(job);
      let cursor=0,completed=doneSet.size,validated=doneSet.size,failed=0;const concurrency=workerCount(universe.length,false),worker=async()=>{while(true){await pauseCheckpoint(job,JOB_STATUS.FETCHING_DATA);const i=cursor++;if(i>=universe.length)return;const sym=universe[i];if(doneSet.has(sym))continue;const prior=state.recordMap.get(sym)||null;let rec;try{const onSource=({provider,lane,status})=>setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',done:completed,total:universe.length,validated,failed,message:`${sym} · ${lane||'KAYNAK'} · ${sourceName(provider)}${status==='OK'?' ✓':status==='ERROR'?' ×':''}`,symbol:sym,provider});rec=await makeCandidate(sym,start,end,indexBundle,job,{prior,fields:['*'],maxFallback:1,onSource,mode:'FULL'});validated++}catch(e){failed++;await issue(job,sym,'*','MULTI_SOURCE','R206_PRIMARY_FAILED',e?.message||String(e));rec=r221SafeCarryForward(sym,prior,job,[e?.message||'CURRENT_JOB_DATA_UNAVAILABLE'])}await stagePut(job.id,sym,rec);completed++;job.processedSymbols=completed;if(completed%40===0){await saveJob(job);setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',done:completed,total:universe.length,validated,failed,message:`Çoklu kaynak · ${completed}/${universe.length} · ${validated} doğrulandı`,symbol:sym})}await new Promise(r=>setTimeout(r,0))}};
      await Promise.all(Array.from({length:concurrency},worker));await flushStageBatch(job.id);
      let stats=await enforceCohortAndGate(job,universe);const published=await atomicPublish(job,universe),summary=dataSummary(published);summary.scheduler='REV20.21_INITIAL_PUBLISH';summary.completenessTarget=TARGET_FILL;summary.completenessTargetAdvisory=true;summary.maxAllowedMissingPct=5;summary.cohortWindowMinutes=30;summary.cohortPct=stats.cohortPct;summary.cohortStart=stats.cohortStart?new Date(stats.cohortStart).toISOString():null;summary.cohortEnd=stats.cohortEnd?new Date(stats.cohortEnd).toISOString():null;summary.realDataOnly=true;summary.initialPublishBeforeSmartCompletion=true;job.dataSummary=summary;const plan=await persistPendingRepairPlan(published,universe);await dbPut('meta',{key:'lastDataSummary',value:summary,updatedAt:nowISO()});await clearStage(job.id);try{if(typeof rebuildBehaviorProfiles==='function')await rebuildBehaviorProfiles(state.records,{force:false})}catch{}await refreshTableMeta();await transition(job,JOB_STATUS.DATA_COMPLETED,{message:`İlk tablo atomik yayınlandı · doluluk %${Number(summary.fillPct||0).toFixed(2)} · onarım ${plan.symbolCount} hisse`,done:universe.length,total:universe.length,validated:stats.cohortCount,failed:universe.length-stats.cohortCount});state.lastSuccessfulSync=nowISO();return true;
    }catch(e){job.error=e?.message||String(e);if(e?.code==='OPERATION_CANCELLED'||cancelRequested(job)){await transition(job,JOB_STATUS.IDLE,{error:null,message:'Veri işlemi iptal edildi · önceki tablo korundu'});return false}if(!isOnline()||/network|offline|failed to fetch|ERR_/i.test(job.error))await transition(job,JOB_STATUS.WAITING_FOR_NETWORK,{error:job.error,message:'Ağ bağlantısı bekleniyor · staging korunuyor'});else await transition(job,JOB_STATUS.FAILED,{error:job.error,message:`Kalite/kohort kapısı geçilmedi · önceki tablo korundu · ${job.error}`});return false
    }finally{try{await flushStageBatch(job.id)}catch{}state.settings.sourceRetryCount=restore.retry;state.settings.maxProvider429Retries=restore.r429;state.settings.requestTimeoutMs=restore.timeout;state.syncing=false;clearCancel(job.id);renderCurrentPagePreservingView()}
  };

  globalThis.prepareMissingData=prepareMissingData=async function prepareMissingDataR206(job){
    const snap=await currentSnapshotMeta(),finished=Date.parse(snap?.transferredAt||snap?.completedAt||''),age=Number.isFinite(finished)?Date.now()-finished:Infinity;
    if(age>COHORT_MS){job.requestedDataMode='FULL';await saveJob(job);setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',message:'Son tam çalışma 30 dakikadan eski · tüm tablo yeniden doğrulanıyor'});return prepareGeneralData(job,'FULL')}
    const universe=currentSymbols(),baseStats=stageStats(state.records,universe);
    const plan=currentPendingRepairPlan(),targets=plan.items.map(x=>x.sym),fieldMap=new Map(plan.items.map(x=>[x.sym,(x.fields?.length?x.fields:(x.fullSymbol?['Anlik','VeriZamani','FiyatDegisim%_T0']:['*']))]));if(!targets.length){await transition(job,JOB_STATUS.DATA_COMPLETED,{message:'Son çalışma 30dk içinde · eksik veri yok',done:0,total:0});return true}
    state.syncing=true;state.sourceStats={};await clearStage(job.id);const restore={retry:state.settings.sourceRetryCount,r429:state.settings.maxProvider429Retries};state.settings.sourceRetryCount=0;state.settings.maxProvider429Retries=0;
    try{
      await transition(job,JOB_STATUS.FETCHING_DATA,{message:`Son çalışma ${Math.max(0,age/60000).toFixed(1)} dk önce · yalnız eksikler çoklu kaynakla tamamlanıyor`,done:0,total:targets.length});if(!isOnline()){await transition(job,JOB_STATUS.WAITING_FOR_NETWORK,{error:'OFFLINE',message:'Ağ bağlantısı bekleniyor'});return false}
      const end=new Date(),start=addMonths(end,-Number(state.settings.monthsBack||14)),[startup]=await Promise.all([loadIndexAndCanonical(start,end),globalThis.AurumBulkQuoteCache?.prewarm?.(targets)||Promise.resolve()]),indexBundle=startup.indexBundle;job.canonicalMarketAt=baseStats.cohortEnd?new Date(baseStats.cohortEnd).toISOString():(snap?.marketAt||nowISO());job.canonicalMarketProvider='R206_EXISTING_30M_COHORT';await saveJob(job);
      let cursor=0,done=0;const replacements=new Map(),concurrency=workerCount(targets.length,true),worker=async()=>{while(true){await pauseCheckpoint(job,JOB_STATUS.FETCHING_DATA);const i=cursor++;if(i>=targets.length)return;const sym=targets[i],prior=state.recordMap.get(sym)||null,fields=fieldMap.get(sym)||['*'];let candidate=null;try{const skip=(prior?.providerAttempts||[]).map(x=>x.provider).filter(Boolean),onSource=({provider,lane,status})=>setRuntime({status:JOB_STATUS.FETCHING_DATA,jobId:job.id,mode:job.mode,stage:'Veriler',done,total:targets.length,message:`${sym} · eksik ${lane||'alan'} · ${sourceName(provider)}${status==='OK'?' ✓':''}`,symbol:sym,provider});candidate=await makeCandidate(sym,start,end,indexBundle,job,{prior,fields,skipProviders:skip,maxFallback:2,onSource,mode:'REPAIR',companyCard:true});const t=externalMarketTime(candidate),anchor=Number.isFinite(baseStats.cohortStart)?baseStats.cohortStart:safeTime(job.canonicalMarketAt);if(!Number.isFinite(t)||(Number.isFinite(anchor)&&(t<anchor-2*60*1000||t-anchor>COHORT_MS)))candidate=null}catch(e){await issue(job,sym,'*','MULTI_SOURCE','R206_TARGETED_REPAIR_FAILED',e?.message||String(e))}if(candidate)replacements.set(sym,candidate);done++;await new Promise(r=>setTimeout(r,0))}};
      await Promise.all(Array.from({length:concurrency},worker));
      /* Re-stage the entire table locally (no extra network for non-target rows). This lets the
         atomic publisher enforce one coherent cohort even though only missing symbols were fetched. */
      const current=new Map(state.records.map(r=>[r.sym,r]));for(const [sym,c] of replacements)current.set(sym,c);for(const sym of universe)await stagePut(job.id,sym,current.get(sym)||makePlaceholder(sym,null,['MISSING_ROW']));await flushStageBatch(job.id);
      const stats=await enforceCohortAndGate(job,universe),published=await atomicPublish(job,universe),summary=dataSummary(published);summary.scheduler=VERSION+'_REPAIR';summary.repairAgeMinutes=age/60000;summary.cohortWindowMinutes=30;summary.cohortPct=stats.cohortPct;summary.completenessTarget=TARGET_FILL;job.dataSummary=summary;await persistPendingRepairPlan(published,universe);await dbPut('meta',{key:'lastDataSummary',value:summary,updatedAt:nowISO()});await clearStage(job.id);try{if(typeof rebuildBehaviorProfiles==='function')await rebuildBehaviorProfiles(state.records,{force:false})}catch{}await refreshTableMeta();await transition(job,JOB_STATUS.DATA_COMPLETED,{message:`Eksikler tamamlandı · doluluk %${Number(summary.fillPct||0).toFixed(2)} · 30dk kohort %${stats.cohortPct.toFixed(1)}`,done:targets.length,total:targets.length});state.lastSuccessfulSync=nowISO();return true
    }catch(e){job.error=e?.message||String(e);if(!isOnline()||/network|offline|failed to fetch|ERR_/i.test(job.error))await transition(job,JOB_STATUS.WAITING_FOR_NETWORK,{error:job.error,message:'Ağ bağlantısı bekleniyor'});else await transition(job,JOB_STATUS.FAILED,{error:job.error,message:`Eksik tamamlama kalite kapısında durdu · önceki tablo korundu · ${job.error}`});return false
    }finally{try{await flushStageBatch(job.id)}catch{}state.settings.sourceRetryCount=restore.retry;state.settings.maxProvider429Retries=restore.r429;state.syncing=false;clearCancel(job.id);renderCurrentPagePreservingView()}
  };

  globalThis.resolveDataRefreshMode=resolveDataRefreshMode=function resolveDataRefreshModeR221(requested='GENERAL'){const m=normalizeMode(requested);return m==='GENERAL'?'FULL':m};

  const oldMeta=globalThis.dataMetaMarkup||dataMetaMarkup;
  globalThis.dataMetaMarkup=dataMetaMarkup=function r206DataMetaMarkup(){let h=oldMeta();try{h=h.replace(/Kalite öncelikli paralel işçiler[^<]*/,'Akıllı çoklu kaynak · kaynak-uzman alan dağıtımı · bağımsız API hız aralıkları · seçici alternatif tamamlama · tek 30 dk veri kohortu · atomik yayın')}catch{}return h};

  queueMicrotask(async()=>{try{state.settings.marketFreshMinutes=30;state.settings.concurrency=56;state.settings.maxGlobalConcurrency=56;state.settings.providerHealthAdaptive=true;state.settings.sourceRetryCount=0;state.settings.maxProvider429Retries=0;state.settings.stageBatchSize=Math.max(384,Number(state.settings.stageBatchSize||384));state.settings.stageFlushMs=1;state.settings.providerConcurrency={...(state.settings.providerConcurrency||{}),...PROVIDER_CAP};await saveSettings();try{AurumUpdateAPI.state.r206={version:VERSION,activatedAt:nowISO(),features:['BULK_YAHOO_QUOTE_SEED','CAPABILITY_SPECIALIZED_PROVIDER_LANES','HASH_DISTRIBUTED_PRIMARY_SOURCES','PER_PROVIDER_START_PACING','PARALLEL_DIFFERENT_PROVIDERS','HEALTH_AND_429_FAILOVER','SELECTIVE_FIELD_RESCUE','SHARED_USDTRY_HISTORY','TARGET_FILL_95_ADVISORY_NO_PUBLISH_BLOCK','STRICT_DENSEST_30M_COHORT','ATOMIC_NO_MIXED_STALE_PUBLISH','REPAIR_IF_LAST_RUN_LE_30M','FULL_REFRESH_IF_LAST_RUN_GT_30M','FULL_REFRESH_FORCES_NEW_LIVE_MARKET_POINT']};AurumUpdateAPI.state.r208={version:'REV20.8-STRICT-FRESH-LIVE',activatedAt:nowISO(),features:['PRIOR_HISTORY_FUNDAMENTALS_MAY_ACCELERATE','PRIOR_LIVE_QUOTE_NEVER_REUSED_ON_FULL_REFRESH','30M_CURRENT_MARKET_COHORT_HARD_GATE']}}catch{}}catch{}});
})();

/* ===== REV20.7 DYNAMIC FINANCE PORTAL =====
   Multi-source, source-attributed finance/economy stream for Overview. No article body is invented:
   summaries come from source descriptions/meta descriptions; if unavailable the card says so. */
(function installR207FinancePortal(){
  if(globalThis.__AURUM_REV207_FINANCE_PORTAL)return;globalThis.__AURUM_REV207_FINANCE_PORTAL=true;
  const KEY='aurum.rev224.financePortal.v2',TTL=5*60*1000,MAX_AGE=5*24*60*60*1000;
  let active='ALL',busy=false,timer=null;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=s=>String(s||'').toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/[^a-z0-9çğıöşü ]/g,' ').replace(/\s+/g,' ').trim();
  const clean=s=>String(s||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim();
  const clip=(s,n=300)=>{s=clean(s);return s.length>n?s.slice(0,n-1).replace(/\s+\S*$/,'')+'…':s};
  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch{return null}};
  const save=x=>{try{localStorage.setItem(KEY,JSON.stringify(x))}catch{}};
  function parseDateLoose(v){const t=Date.parse(v||'');if(Number.isFinite(t))return new Date(t).toISOString();const m=String(v||'').match(/(\d{1,2})\s+(Oca|Şub|Mar|Nis|May|Haz|Tem|Ağu|Eyl|Eki|Kas|Ara)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/i);if(!m)return null;const mon={oca:0,'şub':1,mar:2,nis:3,may:4,haz:5,tem:6,'ağu':7,eyl:8,eki:9,kas:10,ara:11}[m[2].toLocaleLowerCase('tr-TR')];if(mon==null)return null;return new Date(Date.UTC(+m[3],mon,+m[1],+(m[4]||0)-3,+(m[5]||0))).toISOString()}
  function absolute(base,href){try{return new URL(href,base).href}catch{return href||''}}
  async function text(url,provider,label){const r=await fetchWithTimeout(url,{headers:{Accept:'text/html,application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.7'},cache:'no-store',__provider:provider},label);if(!r.ok)throw new Error(`${label} HTTP ${r.status}`);return r.text()}
  function sourceSummary(raw,title,source){let x=clean(raw);for(const y of [title,source])if(y){const n=clean(y);if(n&&x.toLocaleLowerCase('tr-TR').startsWith(n.toLocaleLowerCase('tr-TR')))x=x.slice(n.length).trim()}x=x.replace(/^[-–—|:·\s]+/,'');return x.length>=45?clip(x,320):''}
  function story(x){const t=parseDateLoose(x.publishedAt)||null,body=Array.isArray(x.bodyParagraphs)?x.bodyParagraphs.map(v=>clip(v,560)).filter(v=>clean(v).length>=45).slice(0,3):[];return {...x,title:clip(x.title,220),summary:clip(x.summary,420),bodyParagraphs:body,publishedAt:t,retrievedAt:x.retrievedAt||nowISO(),source:clip(x.source||'Kaynak belirtilmedi',80),cat:String(x.cat||'Piyasa'),link:String(x.link||'')};}
  async function google(cat,query){const url='https://news.google.com/rss/search?q='+encodeURIComponent(query)+'&hl=tr&gl=TR&ceid=TR:tr',xml=await text(url,'NEWS_GOOGLE','Google News '+cat),d=new DOMParser().parseFromString(xml,'text/xml');return [...d.querySelectorAll('item')].slice(0,28).map(it=>{const title=it.querySelector('title')?.textContent?.trim()||'',source=it.querySelector('source')?.textContent?.trim()||'Google News',desc=it.querySelector('description')?.textContent||'';return story({cat,title,summary:sourceSummary(desc,title,source),link:it.querySelector('link')?.textContent?.trim()||'',source,publishedAt:it.querySelector('pubDate')?.textContent||null,origin:'GOOGLE_NEWS'})}).filter(x=>x.title)}
  async function bigpara(){const base='https://bigpara.hurriyet.com.tr',url=base+'/haberler/',htmlText=await text(url,'BIGPARA','Bigpara haber akışı'),d=new DOMParser().parseFromString(htmlText,'text/html'),out=[],seen=new Set();for(const a of d.querySelectorAll('a[href]')){const title=clean(a.textContent);const href=absolute(base,a.getAttribute('href'));if(title.length<24||title.length>220||!href.includes('bigpara.hurriyet.com.tr')||!(/haber/i.test(href)))continue;const k=norm(title);if(seen.has(k))continue;seen.add(k);const box=a.closest('article,li,.news,.haber,.content,div')||a.parentElement,all=clean(box?.textContent||''),summary=sourceSummary(all,title,'Bigpara'),tm=(all.match(/\b\d{1,2}:\d{2}\b/)||[])[0]||null;out.push(story({cat:/yazar|yorum|analiz/i.test(all+' '+href)?'Yorum / Öneri':/kap|şirket|bilanço|temettü|hisse/i.test(title)?'Şirket / KAP':'Piyasa',title,summary,link:href,source:'Bigpara',publishedAt:tm?new Date().toISOString().slice(0,10)+'T'+tm+':00+03:00':null,origin:'BIGPARA'}));if(out.length>=28)break}return out}
  async function isyatirim(){const base='https://www.isyatirim.com.tr',url=base+'/tr-tr/analiz/Haberler/Sayfalar/default.aspx',htmlText=await text(url,'ISYATIRIM','İş Yatırım haber akışı'),d=new DOMParser().parseFromString(htmlText,'text/html'),out=[],seen=new Set();for(const a of d.querySelectorAll('a[href]')){const title=clean(a.textContent),href=absolute(base,a.getAttribute('href'));if(title.length<24||title.length>220||!href.includes('isyatirim.com.tr'))continue;if(!/haber|analiz/i.test(href))continue;const k=norm(title);if(seen.has(k))continue;seen.add(k);const box=a.closest('article,li,.item,.news,div')||a.parentElement,all=clean(box?.textContent||''),dm=all.match(/\d{1,2}\s+(?:Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık|Oca|Şub|Mar|Nis|May|Haz|Tem|Ağu|Eyl|Eki|Kas|Ara)\s+\d{4}\s*[-–]?\s*\d{1,2}:\d{2}/i);out.push(story({cat:/şirket|bilanço|temettü|hisse|kap/i.test(title)?'Şirket / KAP':/fed|ecb|abd|avrupa|çin|petrol/i.test(title)?'Küresel':'Ekonomi / Makro',title,summary:sourceSummary(all,title,'İş Yatırım'),link:href,source:'İş Yatırım',publishedAt:dm?.[0]||null,origin:'ISYATIRIM'}));if(out.length>=24)break}return out}
  async function tcmb(){const base='https://www.tcmb.gov.tr',url=base+'/wps/wcm/connect/TR/TCMB%2BTR/Bottom%2BMenu/Diger/RSS/Basin%2BDuyurulari',raw=await text(url,'TCMB','TCMB basın duyuruları'),d=new DOMParser().parseFromString(raw,'text/xml'),items=[...d.querySelectorAll('item')],out=[];if(items.length){for(const it of items.slice(0,18)){const title=clean(it.querySelector('title')?.textContent||''),link=absolute(base,it.querySelector('link')?.textContent||''),desc=it.querySelector('description')?.textContent||'';out.push(story({cat:'Ekonomi / Makro',title,summary:sourceSummary(desc,title,'TCMB'),link,source:'TCMB',publishedAt:it.querySelector('pubDate')?.textContent||null,origin:'TCMB'}))}}else{const rx=/<!\[CDATA\[([^\]]{12,240})\]\]>\s*([^\s<]+)\s+(\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]+\s+\d{4}\s+\d{1,2}:\d{2}:\d{2})/g;let m;while((m=rx.exec(raw))&&out.length<18)out.push(story({cat:'Ekonomi / Makro',title:m[1],summary:'TCMB tarafından yayımlanan resmi basın duyurusu.',link:absolute(base,m[2]),source:'TCMB',publishedAt:m[3],origin:'TCMB'}))}return out.filter(x=>x.title)}
  async function borsa(){const base='https://www.borsaistanbul.com',url=base+'/duyurular',htmlText=await text(url,'BORSAISTANBUL','Borsa İstanbul duyuruları'),d=new DOMParser().parseFromString(htmlText,'text/html'),out=[],seen=new Set();for(const a of d.querySelectorAll('a[href]')){const title=clean(a.textContent),href=absolute(base,a.getAttribute('href'));if(title.length<20||title.length>220||!href.includes('borsaistanbul.com'))continue;if(!/duyuru|gong|endeks|piyasa|bist/i.test(title+' '+href))continue;if(/^(kaldıraçlı ve kısa endeksler|bist .*endeksleri|endeksler|piyasalar|ürünler)$/i.test(title))continue;const k=norm(title);if(seen.has(k))continue;seen.add(k);const all=clean((a.closest('li,tr,article,div')||a.parentElement)?.textContent||''),dm=all.match(/\d{1,2}\s+(?:Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık|Oca|Şub|Mar|Nis|May|Haz|Tem|Ağu|Eyl|Eki|Kas|Ara)\s+\d{4}/i),sm=sourceSummary(all,title,'Borsa İstanbul');out.push(story({cat:'Şirket / KAP',title,summary:sm,link:href,source:'Borsa İstanbul',publishedAt:dm?.[0]||null,origin:'BIST'}));if(out.length>=20)break}return out}
  function articleParagraphs(d,item){
    const bad=/çerez|cookie|gizlilik|kişisel ver|üyelik|abone ol|bildirimleri aç|reklam|tüm hakları saklı|copyright|javascript|tarayıcınız|menü|anasayfa|ana sayfa|son dakika haberleri/i,seen=new Set(),out=[];
    const nodes=[...d.querySelectorAll('article p,.article-content p,.news-content p,.haber-detay p,.detail p,.content-detail p,main p,.content p')];
    for(const n of nodes){let t=clean(n.textContent||'');if(t.length<70||t.length>1800||bad.test(t))continue;if(item?.title&&norm(t)===norm(item.title))continue;const k=norm(t).slice(0,180);if(!k||seen.has(k))continue;seen.add(k);out.push(clip(t,560));if(out.length>=3)break}
    return out;
  }
  async function metaSummary(item){if(!item.link)return item;let h='';try{h=new URL(item.link).hostname.toLowerCase()}catch{return item}if(!['bigpara.hurriyet.com.tr','www.isyatirim.com.tr','isyatirim.com.tr','www.tcmb.gov.tr','tcmb.gov.tr','www.borsaistanbul.com','borsaistanbul.com'].includes(h))return item;try{const raw=await text(item.link,item.origin||'NEWS','Haber ayrıntısı'),d=new DOMParser().parseFromString(raw,'text/html'),m=d.querySelector('meta[property="og:description"]')?.content||d.querySelector('meta[name="description"]')?.content||'',sm=sourceSummary(m,item.title,item.source),paras=articleParagraphs(d,item);if(sm.length>=45)item.summary=sm;if(paras.length)item.bodyParagraphs=paras;else if(sm.length>=90)item.bodyParagraphs=[clip(sm,560)];const pub=d.querySelector('meta[property="article:published_time"]')?.content||d.querySelector('meta[name="date"]')?.content||d.querySelector('time[datetime]')?.getAttribute('datetime')||null;if(!item.publishedAt&&pub)item.publishedAt=parseDateLoose(pub)||pub;const can=d.querySelector('link[rel="canonical"]')?.href;if(can&&/^https?:/i.test(can))item.link=can}catch{}return item}
  function genericNavTitle(v){const k=norm(v);return /^(bankacılık haberleri|kripto para piyasaları|kripto para haberleri|en çok tıklanan hisseler|varant viop videoları|piyasa haberleri|borsa haberleri|finans haberleri|son dakika|haberler|kaldıraçlı ve kısa endeksler|endeksler|piyasalar|ürünler)$/.test(k)||(/^(bankacılık|kripto para|varant|viop).{0,22}(haberleri|videoları|piyasaları)$/.test(k))||(/^bist .{0,42}endeksleri$/.test(k))}
  function dedup(rows){const out=[],seen=[];for(const x0 of rows){const x=story(x0);if(!x.title||!x.link||genericNavTitle(x.title))continue;const k=norm(x.title);if(!k)continue;let dup=false;for(const y of seen){if(k===y||k.includes(y)||y.includes(k)){dup=true;break}const a=new Set(k.split(' ').filter(z=>z.length>3)),b=y.split(' ').filter(z=>z.length>3),same=b.filter(z=>a.has(z)).length;if(same>=Math.min(6,Math.ceil(Math.min(a.size,b.length)*.72))){dup=true;break}}if(dup)continue;seen.push(k);out.push(x)}return out}
  function ageLabel(t){const ms=Date.now()-Date.parse(t||'');if(!Number.isFinite(ms)||ms<0)return 'zaman belirtilmedi';const m=Math.floor(ms/60000);if(m<1)return 'şimdi';if(m<60)return m+' dk önce';const h=Math.floor(m/60);if(h<24)return h+' sa önce';return Math.floor(h/24)+' gün önce'}
  const r224Priority={'Piyasa':0,'Yorum / Öneri':1,'Ekonomi / Makro':2,'Siyaset':3,'Asayiş / Adalet':4,'Dış Politika':5,'Dünya':6,'Küresel':6,'Şirket / KAP':9};
  function r224TemplateText(v){const k=norm(v);return !k||/borsa istanbul tarafından yayımlanan resmi piyasa şirket duyurusu|tcmb tarafından yayımlanan resmi basın duyurusu|bu içerik .{0,60} tarafından .{0,80} karttaki bağlantıdan|haberin tam metnine ve kaynağın güncel ayrıntılarına erişebilirsiniz|kaynakta zamanı belirtilmeden yayımlanmıştır/.test(k)}
  function r224ContentScore(x){const paras=(x.bodyParagraphs||[]).map(clean).filter(p=>p.length>=60&&!r224TemplateText(p)),sm=clean(x.summary||''),goodSummary=!r224TemplateText(sm)?sm:'';if(x.cat==='Şirket / KAP'&&paras.length===0&&goodSummary.length<90)return 0;return (paras.length>=2?5:paras.length?4:goodSummary.length>=180?3:goodSummary.length>=110?2:goodSummary.length>=70?1:0)}
  function r224StoryTime(x){const p=Date.parse(x.publishedAt||'');if(Number.isFinite(p))return p;const r=Date.parse(x.retrievedAt||'');return Number.isFinite(r)?r-6*60*60*1000:0}
  function r224Sort(a,b){const pa=r224Priority[a.cat]??7,pb=r224Priority[b.cat]??7;if(pa!==pb)return pa-pb;const ta=r224StoryTime(a),tb=r224StoryTime(b);if(ta!==tb)return tb-ta;const qa=r224ContentScore(a),qb=r224ContentScore(b);return qb-qa}
  function render(data){
    const all=(data?.items||[]).filter(x=>x?.link&&(!x.publishedAt||Date.now()-Date.parse(x.publishedAt)<MAX_AGE)).filter(x=>r224ContentScore(x)>0),cats=['ALL','Piyasa','Yorum / Öneri','Ekonomi / Makro','Siyaset','Asayiş / Adalet','Dış Politika','Dünya','Şirket / KAP'];
    const rows=(active==='ALL'?all:all.filter(x=>x.cat===active)).slice().sort(active==='ALL'?r224Sort:(a,b)=>r224StoryTime(b)-r224StoryTime(a)||r224ContentScore(b)-r224ContentScore(a)).slice(0,30),lead=rows[0],rest=rows.slice(1);
    const btn=c=>`<button class="r207-news-chip ${active===c?'active':''}" onclick="AurumNewsPortal.filter('${esc(c)}')">${c==='ALL'?'Öncelikli Akış':esc(c)}</button>`;
    const timeLine=x=>x.publishedAt?`Yayın: ${esc(new Date(x.publishedAt).toLocaleString('tr-TR',{dateStyle:'short',timeStyle:'short'}))}`:'Yayın: kaynakta belirtilmedi';
    const received=x=>`Alınma: ${esc(new Date(x.retrievedAt||data?.updatedAt||Date.now()).toLocaleString('tr-TR',{dateStyle:'short',timeStyle:'short'}))}`;
    const host=x=>{try{return new URL(x.link).hostname.replace(/^www\./,'')}catch{return 'Kaynak bağlantısı'}};
    const summary=x=>clean(x.summary||'');
    const detailParagraphs=x=>{const src=[];for(const v of (x.bodyParagraphs||[])){const t=clean(v);if(t.length>=60&&!r224TemplateText(t)&&!src.some(q=>norm(q)===norm(t)))src.push(t)}const sm=summary(x);if(sm.length>=70&&!r224TemplateText(sm)&&!src.some(q=>norm(q)===norm(sm)))src.unshift(sm);const split=v=>(v.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g)||[]).map(z=>z.trim()).filter(Boolean);const out=[];for(const raw of src){const sentences=split(raw);if(sentences.length<2){if(raw.length>=70)out.push(clip(raw,680));continue}let buf='';for(const sen of sentences){const next=(buf+' '+sen).trim();if(next.length<=330)buf=next;else{if(buf.length>=55)out.push(clip(buf,680));buf=sen}if(out.length>=3)break}if(buf.length>=55&&out.length<3)out.push(clip(buf,680));if(out.length>=3)break}if(out.length===1&&out[0].length>=250){const sentences=split(out[0]),half=Math.ceil(sentences.length/2),a=sentences.slice(0,half).join(' ').trim(),b=sentences.slice(half).join(' ').trim();if(a.length>=55&&b.length>=55)return[clip(a,680),clip(b,680)]}return out.slice(0,3)};
    const preview=x=>{const sm=summary(x);if(sm&&!r224TemplateText(sm))return clip(sm,220);const p=(x.bodyParagraphs||[]).map(clean).find(v=>v.length>=60&&!r224TemplateText(v));return clip(p||'',220)};
    globalThis.toggleAurumNewsCard=function toggleAurumNewsCard(btn,ev){try{ev?.preventDefault?.();ev?.stopPropagation?.();const card=btn?.closest?.('.r207-news-card'),detail=card?.querySelector?.('.r223-news-detail');if(!detail)return false;const open=btn.getAttribute('aria-expanded')==='true';btn.setAttribute('aria-expanded',open?'false':'true');detail.hidden=open;card.classList.toggle('r223-expanded',!open);return !open}catch{return false}};
    const card=(x,hero=false)=>{const paras=detailParagraphs(x),detail=paras.length?paras.map(p=>`<p>${esc(p)}</p>`).join(''):`<p>${esc(preview(x))}</p>`;return `<article class="r207-news-card ${hero?'hero':''}"><div class="r207-news-card-top"><span class="r207-news-cat">${esc(x.cat)}</span><span class="r207-news-source">${esc(x.source)}</span></div><div class="r223-news-title-row"><h3><a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a></h3><button class="r223-news-toggle" type="button" aria-label="Haber ayrıntısını aç veya kapat" aria-expanded="false" onclick="toggleAurumNewsCard(this,event)">⌄</button></div><p class="r223-news-preview">${esc(preview(x))}</p><div class="r223-news-detail" hidden>${detail}</div><div class="r207-news-meta"><span>${timeLine(x)}</span><span>${received(x)}</span></div><div class="r207-news-link"><span class="r225-news-url" title="${esc(x.link)}">${esc(x.link)}</span><a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">Kaynağa git ↗</a></div></article>`};
    const sourceOk=(data?.sourceStatus||[]).filter(x=>x.ok).length,sourceTotal=(data?.sourceStatus||[]).length;
    return `<div class="r207-portal-head"><div><small>BİRLEŞTİRİLMİŞ CANLI FİNANS VE GÜNDEM PORTALI</small><h2>Piyasa · Finans · Yorum · Ekonomi · Gündem · Dünya</h2><p>Öncelik: güncel ve son dakika piyasa/finans → yorum ve öneriler → ekonomi → siyaset → asayiş/adalet → dış politika → dünya → içerikli şirket/KAP. Şablon ve içeriksiz kartlar gösterilmez.</p></div><button class="ghost-btn" onclick="refreshAurumFinancePortal(true)">Akışı Yenile</button></div><div class="r207-news-chips">${cats.map(btn).join('')}</div>${lead?`<div class="r207-featured">${card(lead,true)}</div>`:'<div class="card notice">Kaynaklı ve yeterli içerik taşıyan güncel haber bulunamadı. İçeriksiz şablon kartlar gösterilmiyor.</div>'}<div class="r207-news-grid">${rest.map(x=>card(x,false)).join('')}</div><div class="r207-news-foot"><span>Kaynaklar: Google News açık RSS · Bigpara · İş Yatırım · TCMB · Borsa İstanbul</span><span>${sourceTotal?`Kaynak yanıtı ${sourceOk}/${sourceTotal} · `:''}${data?.updatedAt?'Akış yenileme: '+esc(new Date(data.updatedAt).toLocaleString('tr-TR')):''}</span></div>`
  }
  function paint(data){const h=document.getElementById('aurumFinancePortal');if(h)h.innerHTML=render(data||load()||{items:[]})}
  async function collect(){const retrievedAt=nowISO(),jobs=[
    google('Piyasa','Türkiye Borsa İstanbul finans piyasaları döviz altın faiz son dakika when:1d'),
    google('Yorum / Öneri','piyasa yorum öneri analiz borsa döviz altın yatırım strateji when:1d'),
    google('Ekonomi / Makro','Türkiye ekonomi TCMB enflasyon faiz büyüme işsizlik bütçe vergi son dakika when:1d'),
    google('Siyaset','Türkiye siyaset meclis hükümet yasa düzenleme son dakika when:1d'),
    google('Asayiş / Adalet','Türkiye adalet yargı mahkeme savcılık asayiş son dakika when:1d'),
    google('Dış Politika','Türkiye dış politika diplomasi AB NATO bölge son dakika when:1d'),
    google('Dünya','dünya önemli son dakika ABD Avrupa Çin Orta Doğu küresel gelişmeler when:1d'),
    google('Şirket / KAP','BIST şirket KAP bilanço temettü yatırım şirket açıklama when:2d'),
    bigpara(),isyatirim(),tcmb(),borsa()
  ],rs=await Promise.allSettled(jobs),raw=rs.flatMap(x=>x.status==='fulfilled'?x.value:[]).map(x=>({...x,retrievedAt:x.retrievedAt||retrievedAt})),unique=dedup(raw),direct=unique.filter(x=>['BIGPARA','ISYATIRIM','TCMB','BIST'].includes(x.origin)).slice(0,34);let cursor=0;const worker=async()=>{while(true){const i=cursor++;if(i>=direct.length)return;await metaSummary(direct[i])}};await Promise.all([worker(),worker(),worker(),worker()]);const enriched=dedup(unique).filter(x=>r224ContentScore(x)>0);return {updatedAt:nowISO(),items:enriched,sourceStatus:rs.map((x,i)=>({i,ok:x.status==='fulfilled',error:x.status==='rejected'?String(x.reason?.message||x.reason):null}))}}
  globalThis.refreshAurumFinancePortal=async function(force=false){const cached=load();if(cached)paint(cached);if(!force&&cached&&Date.now()-Date.parse(cached.updatedAt||0)<TTL)return cached;if(busy)return cached;busy=true;try{const data=await collect();if(data.items.length){save(data);paint(data);return data}return cached}finally{busy=false}}
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>{if((globalThis.AurumUpdateAPI?.state?.page||globalThis.state?.page)==='market')refreshAurumFinancePortal(false).finally(schedule);else schedule()},4*60*1000)}
  globalThis.AurumNewsPortal=Object.freeze({filter:c=>{active=String(c||'ALL');paint(load())},refresh:globalThis.refreshAurumFinancePortal});
  const style=document.createElement('style');style.id='aurumR207PortalStyle';style.textContent=`
.r207-portal-wrap{margin-top:18px}.r207-portal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}.r207-portal-head small{color:var(--gold2);font-weight:800;letter-spacing:.11em}.r207-portal-head h2{margin:3px 0 5px}.r207-portal-head p{margin:0;color:var(--muted);font-size:.84rem}.r207-news-chips{display:flex;gap:7px;overflow-x:auto;padding:3px 0 10px;scrollbar-width:none}.r207-news-chip{white-space:nowrap;border:1px solid rgba(212,175,55,.18);border-radius:999px;padding:7px 10px;background:rgba(255,255,255,.018);color:var(--muted)}.r207-news-chip.active{background:rgba(212,175,55,.14);border-color:rgba(212,175,55,.48);color:var(--gold2)}.r207-news-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:10px}.r207-news-card{border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:12px;background:linear-gradient(145deg,rgba(8,19,43,.92),rgba(2,7,24,.96));min-width:0}.r207-news-card.hero{border-color:rgba(212,175,55,.26);padding:15px;background:linear-gradient(135deg,rgba(21,30,56,.96),rgba(4,10,31,.98));box-shadow:0 10px 28px rgba(0,0,0,.16)}.r207-news-cat{display:inline-flex;border:1px solid rgba(212,175,55,.22);border-radius:999px;padding:3px 7px;color:var(--gold2);font-size:.68rem;font-weight:800;letter-spacing:.04em}.r207-news-card h3{font-size:.95rem;line-height:1.28;margin:8px 0 6px}.r207-news-card.hero h3{font-size:1.18rem}.r207-news-card h3 a{color:var(--text);text-decoration:none}.r207-news-card p{margin:0;color:var(--muted);font-size:.79rem;line-height:1.45}.r207-news-meta{display:flex;justify-content:space-between;gap:8px;margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.06);font-size:.68rem;color:var(--muted)}.r207-news-meta b{color:var(--gold2);font-weight:700}.r207-news-meta span{text-align:right}.r207-news-foot{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:9px;color:var(--muted);font-size:.68rem}.r207-news-foot span:first-child{max-width:70%}
@media(max-width:680px){.r207-news-grid{grid-template-columns:1fr}.r207-portal-head{align-items:flex-end}.r207-portal-head h2{font-size:1rem}.r207-portal-head p{font-size:.75rem}.r207-news-card{padding:11px}.r207-news-card.hero h3{font-size:1.05rem}.r207-news-foot span:first-child{max-width:100%}}
`;document.head.appendChild(style);
  const baseOverview=globalThis.overview||overview;
  /* REV20.14: Finans portalı artık Genel Bakış'ta doğrudan gösterilmez. */
  overview=function overviewR214NoPortal(){return baseOverview()};globalThis.overview=overview;
  const baseMarketPage=globalThis.marketPage;
  if(typeof baseMarketPage==='function')globalThis.marketPage=function marketPageR214WithPortal(){
    const c=load();
    setTimeout(()=>{refreshAurumFinancePortal(false);schedule()},0);
    return baseMarketPage()+`<section class="r207-portal-wrap"><div id="aurumFinancePortal">${c?render(c):'<div class="card"><b>Finans portalı hazırlanıyor…</b><p class="muted">Açık kaynak akışları eşzamanlı taranıyor.</p></div>'}</div></section>`;
  };
})();


/* ===== REV20.9 MARKET STRIP AUTO-REFRESH + ADVISORY FILL TARGET ===== */
(()=>{
  if(globalThis.__AURUM_REV209_MARKET_AUTOREFRESH)return;globalThis.__AURUM_REV209_MARKET_AUTOREFRESH=true;
  const refreshAfter=async ok=>{if(ok){try{await globalThis.refreshMarketIndicators?.();const host=document.getElementById('aurumDataMarketStrip');if(host&&typeof globalThis.marketIndicatorsMarkup==='function')host.outerHTML=globalThis.marketIndicatorsMarkup()}catch{}}return ok};
  if(typeof prepareGeneralData==='function'){const base=prepareGeneralData;prepareGeneralData=async function prepareGeneralDataR209(){return refreshAfter(await base.apply(this,arguments))};globalThis.prepareGeneralData=prepareGeneralData;}
  if(typeof prepareMissingData==='function'){const base=prepareMissingData;prepareMissingData=async function prepareMissingDataR209(){return refreshAfter(await base.apply(this,arguments))};globalThis.prepareMissingData=prepareMissingData;}
  queueMicrotask(()=>{try{saveSettings?.()}catch{}try{AurumUpdateAPI.state.r209={version:'REV20.9-MARKET-UX-ADVISORY-FILL',activatedAt:nowISO(),features:['MARKET_STRIP_MANUAL_REFRESH','MARKET_STRIP_AUTO_REFRESH_AFTER_DATA_UPDATE','FILL_95_IS_TARGET_NOT_PUBLISH_GATE','30M_COHORT_GATE_PRESERVED']}}catch{}});
})();


/* ===== REV20.10 — compact two-row market strip + trade integrity/outbox ===== */
(function installR210TradeSafetyAndDelivery(){
  'use strict';
  if(globalThis.__AURUM_REV210_TRADE_SAFETY)return;globalThis.__AURUM_REV210_TRADE_SAFETY=true;
  const OUTBOX_KEY='aurum.trade.alert.outbox.r210';
  const AUDIT_KEY='aurum.trade.integrity.r210';
  const DEFAULT_RECIPIENT='netfnsm@gmail.com';
  const maxRows=300;
  const clone=x=>{try{return structuredClone(x)}catch{try{return JSON.parse(JSON.stringify(x))}catch{return x}}};
  const now=()=>new Date().toISOString();
  function readOutbox(){try{const x=JSON.parse(localStorage.getItem(OUTBOX_KEY)||'null');return Array.isArray(x)?x:[]}catch{return []}}
  async function persistOutbox(rows){const v=(rows||[]).slice(-maxRows);try{localStorage.setItem(OUTBOX_KEY,JSON.stringify(v))}catch{};try{await dbPut('meta',{key:'tradeAlertOutboxR210',value:{rows:v,updatedAt:now()},updatedAt:now()})}catch{}return v}
  function eventId(r,job){const b=(r?.buys||[]).slice().sort().join(','),s=(r?.sells||[]).slice().sort().join(','),t=String(job?.dataSnapshotId||job?.id||Date.now());return `QBS|${t}|AL:${b}|SAT:${s}`}
  function portfolioBrief(){try{const p=globalThis.AurumPortfolio?.state?.();if(!p)return null;const hs=Object.values(p.holdings||{});const cash=Number(p.startingCapital||0)+(p.transactions||[]).reduce((a,x)=>a+Number(x?.cashDelta||0),0);return {startingCapital:Number(p.startingCapital||0),activeHoldings:hs.map(x=>x.sym).sort(),holdingCount:hs.length,realizedPnL:Number(p.realizedPnL||0),cash:Number.isFinite(cash)?cash:null,lastUpdatedAt:p.lastUpdatedAt||null}}catch{return null}}
  function r216FormPost(url,payload){
    try{
      const u=new URL(String(url||''));
      if(u.protocol!=='https:'||u.hostname.toLowerCase()!=='script.google.com'||!/^\/macros\/s\/[^/]+\/exec$/.test(u.pathname))return false;
      const frameName='aurumTradeRelayFrameR216';
      let frame=document.querySelector('iframe[data-aurum-trade-relay="r216"]');
      if(!frame){
        frame=document.createElement('iframe');
        frame.name=frameName;
        frame.setAttribute('data-aurum-trade-relay','r216');
        frame.setAttribute('aria-hidden','true');
        frame.tabIndex=-1;
        frame.style.cssText='position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;opacity:0;border:0;pointer-events:none';
        document.body.appendChild(frame);
      }
      const form=document.createElement('form');
      form.method='POST';
      form.action=u.href;
      form.target=frameName;
      form.enctype='application/x-www-form-urlencoded';
      form.acceptCharset='UTF-8';
      form.style.display='none';
      const input=document.createElement('input');
      input.type='hidden';input.name='payload';input.value=JSON.stringify(payload);
      form.appendChild(input);
      const transport=document.createElement('input');
      transport.type='hidden';transport.name='transport';transport.value='AURUM_FORM_R216';
      form.appendChild(transport);
      document.body.appendChild(form);
      form.submit();
      setTimeout(()=>{try{form.remove()}catch{}},2500);
      return true;
    }catch{return false}
  }
  async function relay(row){
    const url=String(state?.settings?.tradeAlertWebhookUrl||'').trim();
    if(!url)return {ok:false,status:'NO_RELAY'};
    let endpoint;
    try{endpoint=new URL(url)}catch{return {ok:false,status:'INVALID_RELAY_URL'}}
    if(endpoint.protocol!=='https:'||endpoint.hostname.toLowerCase()!=='script.google.com'||!/^\/macros\/s\/[^/]+\/exec$/.test(endpoint.pathname))return {ok:false,status:'INVALID_APPS_SCRIPT_URL'};
    const token=String(endpoint.searchParams.get('token')||'').trim();
    if(!token)return {ok:false,status:'TOKEN_EKSIK'};

    const pf=portfolioBrief()||{};
    const compactPortfolio={
      startingCapital:pf.startingCapital,cash:pf.cash,holdingCount:pf.holdingCount,
      realizedPnL:pf.realizedPnL,totalValue:pf.totalValue,unrealizedPnL:pf.unrealizedPnL,
      activeHoldings:Array.isArray(pf.activeHoldings)?pf.activeHoldings.slice(0,20):[],
      lastUpdatedAt:pf.lastUpdatedAt
    };
    const compactEvent={
      id:String(row?.id||''),at:row?.at||now(),tradeDate:String(row?.tradeDate||''),
      jobId:String(row?.jobId||''),snapshotId:String(row?.snapshotId||''),
      buys:Array.isArray(row?.buys)?row.buys.slice(0,12):[],
      sells:Array.isArray(row?.sells)?row.sells.slice(0,12):[],test:row?.test===true
    };
    const payload={type:'AURUM_AL_SAT',recipient:String(state?.settings?.tradeAlertEmail||DEFAULT_RECIPIENT),event:compactEvent,portfolio:compactPortfolio};
    endpoint.searchParams.set('mode','send');
    endpoint.searchParams.set('transport','AURUM_NATIVE_GET_R220');
    endpoint.searchParams.set('payload',JSON.stringify(payload));
    if(endpoint.href.length>7200)return {ok:false,status:'RELAY_URL_TOO_LONG',detail:String(endpoint.href.length)};

    try{
      const native=globalThis.AurumNativeHTTP;
      if(!native||typeof native.request!=='function'||!native.canHandle?.(endpoint.href))return {ok:false,status:'NATIVE_RELAY_UNAVAILABLE'};
      const res=await native.request(endpoint.href,{method:'GET',headers:{Accept:'application/json','X-Aurum-Relay':'REV20.20'}},20000);
      let txt='',obj=null;
      try{txt=await res.text()}catch{}
      try{obj=txt?JSON.parse(txt):null}catch{}
      if(obj&&obj.ok===true){
        const st=String(obj.status||'SENT');
        return {ok:/^(SENT|ALREADY_SENT)$/i.test(st),status:st,detail:txt.slice(0,260),transport:'native-get'};
      }
      if(obj&&obj.ok===false)return {ok:false,status:String(obj.error||obj.status||'RELAY_REJECTED'),detail:txt.slice(0,260),transport:'native-get'};
      if(!res.ok)return {ok:false,status:`HTTP_${res.status}`,detail:txt.slice(0,260),transport:'native-get'};
      return {ok:false,status:'HTTP_OK_BUT_UNCONFIRMED',detail:txt.slice(0,260),transport:'native-get'};
    }catch(e){
      return {ok:false,status:'NATIVE_GET_FAILED',detail:String(e?.message||e||'').slice(0,260),transport:'native-get'};
    }
  }
  async function enqueue(r,job){
    const buys=[...new Set((r?.buys||[]).map(x=>String(x||'').toUpperCase()).filter(Boolean))],sells=[...new Set((r?.sells||[]).map(x=>String(x||'').toUpperCase()).filter(Boolean))];
    if(!buys.length&&!sells.length)return null;
    const id=eventId({buys,sells},job),rows=readOutbox();if(rows.some(x=>x.id===id))return rows.find(x=>x.id===id);
    const row={id,at:now(),tradeDate:String(r?.state?.updatedAt||'').slice(0,10)||String(job?.completedAt||job?.createdAt||now()).slice(0,10),jobId:String(job?.id||''),snapshotId:String(job?.dataSnapshotId||''),buys,sells,recipient:String(state?.settings?.tradeAlertEmail||DEFAULT_RECIPIENT),delivery:{device:true,email:'PENDING'}};
    rows.push(row);await persistOutbox(rows);
    const sent=await relay(row);row.delivery.email=sent.status;row.delivery.emailAt=sent.ok?now():null;await persistOutbox(rows);
    try{await dbPut('meta',{key:'tradeAlertLastR210',value:row,updatedAt:now()})}catch{}
    return row;
  }
  function audit(){
    const issues=[],warnings=[];let q={items:{}},p=null;
    try{q=globalThis.AurumQualifiedBuySell?.state?.()||q}catch{}
    try{p=globalThis.AurumPortfolio?.state?.()||null}catch{}
    const qItems=Object.values(q.items||{}),active=qItems.filter(x=>x?.status==='BUY');
    for(const e of active){const bp=Number(e.buyPrice),sp=Number(e.stopLossPrice);if(!(bp>0))issues.push(`${e.sym}: AL fiyatı geçersiz`);if(Number.isFinite(sp)&&bp>0&&!(sp>0&&sp<bp))issues.push(`${e.sym}: zarar-kes AL fiyatının altında değil`);if(e.activeProfitLockPct!=null&&!Number.isFinite(Number(e.activeProfitLockPct)))issues.push(`${e.sym}: kâr kilidi geçersiz`);}
    if(p){
      const txs=Array.isArray(p.transactions)?p.transactions:[],hold=p.holdings||{},excluded=p.excluded||{};
      const realized=txs.filter(x=>x?.type==='SATIS'&&Number.isFinite(Number(x.realizedPnL))).reduce((a,x)=>a+Number(x.realizedPnL),0);
      if(Math.abs(realized-Number(p.realizedPnL||0))>0.05)issues.push(`Portföy gerçekleşen K/Z defterle uyuşmuyor (${realized.toFixed(2)} / ${Number(p.realizedPnL||0).toFixed(2)})`);
      const cash=Number(p.startingCapital||0)+txs.reduce((a,x)=>a+Number(x?.cashDelta||0),0);if(cash<-.05)warnings.push(`Sanal nakit bakiye negatif (${cash.toFixed(2)} TL)`);
      for(const h of Object.values(hold)){const qv=Number(h.qty),ep=Number(h.entryPrice),c=Number(h.cost);if(!(qv>0&&ep>0&&c>0))issues.push(`${h.sym}: portföy pozisyonu geçersiz`);else if(Math.abs(qv*ep-c)/Math.max(1,c)>.005)issues.push(`${h.sym}: miktar × giriş fiyatı maliyetle uyuşmuyor`);}
      const qset=new Set(active.map(x=>String(x.sym||'').toUpperCase()));
      for(const sym of Object.keys(hold)){if(!qset.has(sym))warnings.push(`${sym}: portföyde aktif, AL/SAT BUY değil`)}
      for(const sym of qset){if(!hold[sym]&&!excluded[sym])warnings.push(`${sym}: AL/SAT BUY fakat sanal portföyde pozisyon yok`)}
    }
    const report={at:now(),ok:issues.length===0,issues,warnings,activeBuyCount:active.length,portfolioHoldingCount:p?Object.keys(p.holdings||{}).length:null};
    try{localStorage.setItem(AUDIT_KEY,JSON.stringify(report))}catch{};try{dbPut('meta',{key:'tradeIntegrityR210',value:report,updatedAt:report.at})}catch{}
    if(issues.length){try{showAurumNotice(`AL/SAT–portföy bütünlük uyarısı: ${issues[0]}`,'error',5200)}catch{}}
    return report;
  }
  globalThis.AurumTradeIntegrity=Object.freeze({run:audit,last:()=>{try{return JSON.parse(localStorage.getItem(AUDIT_KEY)||'null')}catch{return null}}});
  globalThis.AurumTradeAlerts=Object.freeze({enqueue,outbox:()=>clone(readOutbox()),recipient:()=>String(state?.settings?.tradeAlertEmail||DEFAULT_RECIPIENT),relayUrl:()=>String(state?.settings?.tradeAlertWebhookUrl||'').trim(),relayConfigured:()=>/^https:\/\//i.test(String(state?.settings?.tradeAlertWebhookUrl||''))});
  try{globalThis.__AURUM_TRADE_RELAY_URL__=String(state?.settings?.tradeAlertWebhookUrl||'').trim()}catch{}

  /* Wrap qualified AL/SAT without touching the strategy/ranking rules. */
  try{
    const oldQ=globalThis.AurumQualifiedBuySell;
    if(oldQ?.advance){globalThis.AurumQualifiedBuySell=Object.freeze({...oldQ,advance:async job=>{const r=await oldQ.advance(job);try{await enqueue(r,job)}catch{};try{audit()}catch{};return r}})}
  }catch{}
  /* Re-audit after every portfolio reconciliation. */
  try{
    const oldP=globalThis.AurumPortfolio;
    if(oldP?.reconcile){globalThis.AurumPortfolio=Object.freeze({...oldP,reconcile:async(...a)=>{const r=await oldP.reconcile(...a);try{audit()}catch{};return r}})}
  }catch{}

  /* Optional authenticated HTTPS relay. The APK never embeds mail credentials. */
  const baseSettings=globalThis.settingsPage||settingsPage;
  function r214RelayUrlCheck(raw){try{const u=new URL(String(raw||'').trim());if(u.protocol!=='https:'||u.hostname.toLowerCase()!=='script.google.com'||!/^\/macros\/s\/[^/]+\/exec$/.test(u.pathname))return {ok:false,status:'Geçerli Google Apps Script /exec URL gerekli'};if(!String(u.searchParams.get('token')||'').trim())return {ok:false,status:'URL sonunda ?token=... eksik'};return {ok:true,status:'Google Apps Script relay etkin · token algılandı'}}catch{return {ok:false,status:'Relay URL geçersiz'}}}
  if(typeof baseSettings==='function')globalThis.settingsPage=settingsPage=function r210SettingsPage(){
    const mail=html(String(state?.settings?.tradeAlertEmail||DEFAULT_RECIPIENT));
    const hookRaw=String(state?.settings?.tradeAlertWebhookUrl||''),hook=html(hookRaw);
    const ck=hookRaw?r214RelayUrlCheck(hookRaw):{ok:false,status:'Cihaz bildirimi + yerel outbox etkin · e-posta relay yapılandırılmadı'};
    return baseSettings()+`<div class="section-head"><div class="section-title"><h2>AL/SAT Bildirim Teslimi</h2></div><small>Her değişiklik kalıcı outbox'a yazılır</small></div><div class="card"><div class="field"><label>Alıcı e-posta</label><input id="r210TradeMail" type="email" value="${mail}" autocomplete="off"></div><div class="field"><label>Google Apps Script webhook URL</label><input id="r210TradeHook" type="url" value="${hook}" placeholder="https://script.google.com/macros/s/.../exec?token=..."></div><p id="r210TradeNotifyStatus" class="muted" style="margin:8px 0">${html(ck.status)}. Relay testi Android native HTTPS üzerinden çalışır ve yalnız SENT/ALREADY_SENT yanıtında başarılı sayılır.</p><div class="actions"><button class="gold-btn" onclick="saveR210TradeNotifySettings()">Bildirim Ayarını Kaydet</button><button class="ghost-btn" onclick="testR210TradeNotify()">Relay Testi</button></div></div>`;
  };
  globalThis.saveR210TradeNotifySettings=async function(){const mail=String(document.getElementById('r210TradeMail')?.value||DEFAULT_RECIPIENT).trim(),hook=String(document.getElementById('r210TradeHook')?.value||'').trim();if(hook){const ck=r214RelayUrlCheck(hook);if(!ck.ok){showAurumNotice(ck.status,'error',3400);return false}}state.settings.tradeAlertEmail=mail||DEFAULT_RECIPIENT;state.settings.tradeAlertWebhookUrl=hook;globalThis.__AURUM_TRADE_RELAY_URL__=hook;await saveSettings();state.settingsDirty=false;showAurumNotice('AL/SAT bildirim ayarı kaydedildi','success',2200);const st=document.querySelector('#r210TradeNotifyStatus');if(st)st.textContent=hook?r214RelayUrlCheck(hook).status:'Cihaz bildirimi + yerel outbox etkin · e-posta relay yapılandırılmadı';return true};
  globalThis.testR210TradeNotify=async function(){
    const hook=String(document.getElementById('r210TradeHook')?.value||state.settings?.tradeAlertWebhookUrl||'').trim(),ck=r214RelayUrlCheck(hook);
    if(!ck.ok){showAurumNotice(ck.status,'error',3600);return false}
    state.settings.tradeAlertWebhookUrl=hook;state.settings.tradeAlertEmail=String(document.getElementById('r210TradeMail')?.value||DEFAULT_RECIPIENT).trim()||DEFAULT_RECIPIENT;globalThis.__AURUM_TRADE_RELAY_URL__=hook;await saveSettings();
    const row={id:`TEST|${Date.now()}`,at:now(),tradeDate:now().slice(0,10),buys:['TEST'],sells:[],test:true,recipient:state.settings.tradeAlertEmail,delivery:{device:false,email:'TEST'}};
    const r=await relay(row);
    const map={TOKEN_EKSIK:'URL token eksik',UNAUTHORIZED:'Apps Script token uyuşmuyor',INVALID_EVENT_TYPE:'Apps Script olay tipini reddetti',EMPTY_BODY:'Apps Script payload alamadı',NATIVE_RELAY_UNAVAILABLE:'Android native relay köprüsü kullanılamıyor',NATIVE_GET_FAILED:'Android native HTTPS isteği gönderilemedi',RELAY_URL_TOO_LONG:'Relay içeriği URL sınırını aşıyor',HTTP_OK_BUT_UNCONFIRMED:'Apps Script yanıt verdi fakat SENT teyidi okunamadı'};
    const msg=r.ok?`Relay testi doğrulandı: ${r.status}`:`Relay testi başarısız: ${map[r.status]||r.status}${r.detail?` · ${r.detail}`:''}`;
    showAurumNotice(msg,r.ok?'success':'error',7600);return r.ok;
  };

  queueMicrotask(()=>{try{if(!state.settings.tradeAlertEmail)state.settings.tradeAlertEmail=DEFAULT_RECIPIENT;saveSettings?.()}catch{};try{audit()}catch{};try{AurumUpdateAPI.state.r210={version:'REV20.14-RELAY-VERIFIED-MARKET-PORTAL',activatedAt:now(),features:['MARKET_3X2_COMPACT_STRIP','THIN_MARKET_TYPOGRAPHY','QBS_PERCENT_FORMAT_FIX','PORTFOLIO_TRANSACTION_DATE_FIX','TRADE_INTEGRITY_AUDIT','PERSISTENT_TRADE_ALERT_OUTBOX','OPTIONAL_HTTPS_EMAIL_RELAY_NO_EMBEDDED_CREDENTIALS','GOOGLE_APPS_SCRIPT_RELAY_ALLOWED_BY_EXACT_SAVED_URL','APPS_SCRIPT_CORS_SAFE_POST','DEDICATED_NATIVE_RELAY_TRANSPORT','OFFLINE_GUARD_RELAY_FALSE_POSITIVE_FIX','LEXICAL_STATE_RELAY_BRIDGE_FIX','EXACT_SAVED_URL_RUNTIME_GETTER','RELAY_JSON_SENT_VERIFICATION','RELAY_TOKEN_URL_VALIDATION','NO_FALSE_OPAQUE_SUCCESS','FINANCE_PORTAL_INSIDE_MARKET_SUMMARY_ONLY']}}catch{}});
})();

/* REV20.15 — Apps Script Android WebView sendBeacon POST fallback. */

/* REV20.20 — DEX string table untouched; branch-only native HTTPS relay patch. */


/* ===== REV20.21 — OPTIMAL DATA PIPELINE + PIT SAFE MANUAL REBUILD ===== */
(function installR221PipelineAndPIT(){
  if(globalThis.__AURUM_REV221_PIPELINE_PIT)return;globalThis.__AURUM_REV221_PIPELINE_PIT=true;
  async function rebuildPIT30R221(){
    if(state.syncing||state.calculating)throw new Error('Başka bir işlem sürüyor');
    const calcRecords=calculationRecords();
    const current=kh117T0(),anchors=kh117AnchorDates(calcRecords,current.date).slice(0,30);if(anchors.length<30)throw new Error(`T1–T30 için yalnız ${anchors.length} uygun point-in-time tarih bulundu`);
    if(!confirm(`T1–T30 geçmişi mevcut kriter/formüllerle yeniden hesaplanıp atomik olarak yenilensin mi?\n\nHer tarih için tahmin girdileri yalnız o tarih ve öncesindeki verilerden oluşturulur. Daha sonraki haber, öğrenme, AI/model state veya piyasa verisi tahmin girdisi olarak kullanılmaz. Reel d+1 yalnız sonuç/başarı ölçümü içindir.\n\n30/30 tamamlanmadan mevcut arşiv değiştirilmez.`))return false;
    const a=kh117ArchiveState(),oldLive=a.live?kh117CloneValue(a.live):null,oldShift=a.lastShift?kh117CloneValue(a.lastShift):null,staged=[],failures=[],job={id:makeId('KH_PIT_REBUILD'),stage:'K_Tarihsel'};
    state.calculating=true;state.progress={stage:'K_Tarihsel PIT yeniden hesaplama',current:'Point-in-time staging',done:0,total:30,errors:0};clearCancel();writeLocal(CANCEL_KEY,{requested:false,jobId:null,at:null});setRuntime({status:JOB_STATUS.K_TARIHSEL_RUNNING,jobId:job.id,stage:'K_Tarihsel',done:0,total:30,message:'T1–T30 point-in-time yeniden hesaplanıyor'});renderCurrentPagePreservingView();
    try{
      for(const anchor of anchors){
        if(cancelRequested(job))throw Object.assign(new Error('K_Tarihsel PIT yeniden hesaplama iptal edildi'),{code:'OPERATION_CANCELLED'});
        const result=kh117PitRowForAnchor(anchor,calcRecords);if(!result.ok){failures.push(result.reason);state.progress.errors=failures.length;continue}
        staged.push({...kh117CloneValue(result.row),source:'PIT_MANUAL_REBUILD_R221',provisional:false,frozen:true,immutable:true,formulaDetached:true,rebuiltAt:nowISO(),formulaVersion:MODEL_VERSION,inputRule:'ONLY_DATA_AT_OR_BEFORE_ANCHOR',futureDataUsed:false,noFutureNews:true,noFutureLearning:true,noFutureAI:true,predictionInputCutoff:anchor});state.progress.done=staged.length;state.progress.current=`${anchor} · ${staged.length}/30`;
        if(staged.length%3===0){setRuntime({status:JOB_STATUS.K_TARIHSEL_RUNNING,jobId:job.id,stage:'K_Tarihsel',done:staged.length,total:30,message:`T1–T30 yeniden hesaplanıyor · ${staged.length}/30`});updateLiveStatus()}
        if(staged.length%2===0)await new Promise(r=>setTimeout(r,0));
      }
      if(staged.length!==30)throw new Error(`T1–T30 staging tamamlanamadı: ${staged.length}/30. Mevcut arşiv korunuyor.${failures[0]?` İlk neden: ${failures[0]}`:''}`);
      const check=kh117ValidateArchive({rows:staged},current.date);if(!check.ok||check.rows.length!==30)throw new Error('T1–T30 point-in-time bütünlük kontrolü başarısız');
      const next={...a,rows:check.rows.map(x=>({...kh117CloneValue(x),frozen:true,immutable:true,formulaDetached:true})),live:oldLive,lastShift:oldShift,schema:Math.max(6,Number(a.schema||0)),seed:{...(a.seed||{}),completed:true,windowCount:30,immutable:true,valueOnly:true,formulaDetached:true,rebuildAllowed:true,rebuildCount:Number(a.seed?.rebuildCount||0)+1,lastManualRebuildAt:nowISO(),method:'POINT_IN_TIME_CURRENT_FORMULA_NO_FUTURE_INPUT',inputRule:'ONLY_DATA_AT_OR_BEFORE_ANCHOR',futureDataUsedForPrediction:false,noFutureNews:true,noFutureLearning:true,noFutureAI:true,formulaVersion:MODEL_VERSION}};
      state.khArchive=next;await kh117PersistArchive();
      const snap=await currentSnapshotMeta(),at=nowISO(),fp=historyTableFingerprint();await dbPut('meta',{key:'historicalSnapshot',value:{dataSnapshotId:snap?.snapshotId||null,at,transferredAt:at,changedAt:at,fingerprint:fp,date:current.date,valueOnlyArchive:true,formulaDetached:true,manualPITRebuild:true,inputRule:'ONLY_DATA_AT_OR_BEFORE_ANCHOR',futureDataUsedForPrediction:false,formulaVersion:MODEL_VERSION},updatedAt:at});await refreshTableMeta();
      setRuntime({status:JOB_STATUS.K_TARIHSEL_COMPLETED,jobId:job.id,stage:'K_Tarihsel',done:30,total:30,message:'T1–T30 point-in-time 30/30 yeniden hesaplandı'});showAurumNotice('T1–T30 30/30 yeniden hesaplandı. Otomatik T0→T1 arşivleme korunuyor; tahmin girdilerinde gelecek veri kullanılmadı.','success',5200);return true
    }catch(e){if(e?.code==='OPERATION_CANCELLED'||cancelRequested(job)){showAurumNotice('T1–T30 yeniden hesaplama iptal edildi; mevcut arşiv korunuyor.','info',2600);return false}throw e}
    finally{state.calculating=false;state.progress=null;clearCancel(job.id);updateLiveStatus();renderCurrentPagePreservingView()}
  }
  kh117SeedPIT30=rebuildPIT30R221;
  try{const old=globalThis.AurumKnHistoryV117||{};globalThis.AurumKnHistoryV117=Object.freeze({...old,version:'R221-PIT-REBUILD-SAFE',seedPIT30:rebuildPIT30R221,rebuildPIT30:rebuildPIT30R221})}catch{}
  try{globalThis.AurumKnHistoryR53=Object.freeze({...globalThis.AurumKnHistoryR53,rebuildPIT30:rebuildPIT30R221,seedPIT30:rebuildPIT30R221})}catch{}
  const histRender=()=>{try{return globalThis.AurumKnHistoryV117?.renderHistoryDeferred?.()||globalThis.AurumKnHistoryV117?.renderHistory?.()||kh117RenderDeferred()}catch{return kh117RenderDeferred()}};
  historyPage=function historyPageR221(){const busy=state.syncing||state.calculating,buttons=`<button class="gold-btn" onclick="AurumRuntime.manualHistorical()" ${busy?'disabled':''}>K_Tarihsel’i Çalıştır</button><button class="ghost-btn" onclick="AurumKnHistoryV117.rebuildPIT30().catch(e=>showAurumNotice(e.message,'error',5200))" ${busy?'disabled':''}>T1–T30’u Hesapla / Yenile</button>`;let blocked='';try{blocked=integrityBlockedMarkup('K_Tarihsel')||''}catch{}return `${operationBlock('history',buttons)}<div data-aurum-explicit-time>${tableTimePanel('history')||''}${blocked||histRender()}</div>`};globalThis.historyPage=historyPage;
  try{AurumUpdateAPI.state.r221={version:'REV20.21-OPTIMAL-PIPELINE-PIT-SAFE',activatedAt:nowISO(),features:['MANUAL_OR_SCHEDULER_ONLY_DATA_START','INITIAL_ATOMIC_PUBLISH_BEFORE_REPAIR','SMART_COMPLETION_MAX_3_WHILE_MISSING_GE_5','REPAIR_LE_30M_FULL_GT_30M','AUTO_DATA_KN_KHIST_S_CHAIN','6_MIN_PIPELINE_TARGET','SAFE_PRIOR_HISTORY_NO_STALE_LIVE','30M_COHORT_LIVE_SUPPRESSION','MARKET_DIRECTION_ARROWS','PIT_MANUAL_REBUILD_NO_FUTURE_INPUT','AUTO_ARCHIVE_PRESERVED']}}catch{}
})();


/* ===== REV20.22 — PIPELINE CONTRACT + UNIFIED FINANCE PORTAL + ARCHIVE-SAFE PIT ===== */
(function installR222Contract(){
  if(globalThis.__AURUM_REV222_CONTRACT)return;globalThis.__AURUM_REV222_CONTRACT=true;

  globalThis.refreshAurumTradePanels=async function refreshAurumTradePanelsR222(ev){
    try{ev?.preventDefault?.();ev?.stopPropagation?.()}catch{}
    if(state.syncing||state.calculating){showAurumNotice('Devam eden hesaplama tamamlandıktan sonra yenileyin.','info',2200);return false}
    try{const ok=await globalThis.AurumPortfolio?.reconcile?.();try{renderCurrentPagePreservingView()}catch{}showAurumNotice(ok===false?'Sanal portföy eşleştirmesi zaten sürüyor.':'AL/SAT ve sanal portföy görünümü yenilendi.','success',1800);return ok!==false}catch(e){showAurumNotice(`Yenileme tamamlanamadı: ${e?.message||e}`,'error',3200);return false}
  };

  /* Piyasa Özeti artık tek, tam-genişlikli portal yüzeyidir. Eski başlık-only ve
     yinelenen haber blokları burada ayrıca render edilmez; aynı açık/kurumsal kaynaklar
     birleşik portalın toplama zincirinde yer alır. */
  globalThis.marketPage=function marketPageR222Unified(){
    /* Opening/navigating to the market tab is presentation-only. It must not start network work.
       Refresh occurs only via the explicit Piyasayı Yenile command, scheduled jobs, or the independent 30-minute indicator timer. */
    return `<div class="actions r222-market-actions"><button class="ghost-btn" type="button" onclick="goPage('overview')">← Genel Bakışa Dön</button><button class="gold-btn" type="button" onclick="Promise.allSettled([refreshMarketIndicators(),refreshAurumFinancePortal(true)]).then(()=>{try{renderCurrentPagePreservingView()}catch{}})">Piyasayı Yenile</button></div><div class="section-head r222-market-head"><div class="section-title"><h2>Piyasa Özeti</h2></div><small>Doğrudan piyasa verisi · kaynaklı haber akışı</small></div>${typeof globalThis.marketIndicatorsMarkup==='function'?globalThis.marketIndicatorsMarkup():''}<section class="r207-portal-wrap r222-unified-portal"><div id="aurumFinancePortal"><div class="card notice"><b>Birleştirilmiş finans portalı hazırlanıyor…</b><p class="muted">Piyasa, ekonomi, şirket ve küresel kaynaklar eşzamanlı taranıyor.</p></div></div></section>`;
  };

  function r222IsAutomaticArchive(row){const o=String(row?.archiveOrigin||''),s=String(row?.source||'');return /^AUTO/.test(o)||/^(LIVE_ARCHIVE|LIVE_FINAL_CLOSE|LIVE_T0|LEGACY_VALUE_MIGRATION)/.test(s)}
  function r222FormulaChanged(row){const v=String(row?.formulaVersion||'').trim();return !!v&&v!==String(MODEL_VERSION)}
  async function rebuildPIT30R222(){
    if(state.syncing||state.calculating)throw new Error('Başka bir işlem sürüyor');
    const calcRecords=calculationRecords();
    const current=kh117T0(),a=kh117ArchiveState(),existing=kh117NormalizeArchiveRows(a.rows,current.date),byDate=new Map(existing.map(x=>[String(x.date),x]));
    const anchors=[...new Set([...existing.map(x=>String(x.date)),...kh117AnchorDates(calcRecords,current.date)])].filter(Boolean).sort((x,y)=>y.localeCompare(x)).slice(0,30);
    if(anchors.length<30)throw new Error(`T1–T30 için yalnız ${anchors.length} uygun point-in-time tarih bulundu`);
    const autoPreserve=anchors.filter(d=>{const r=byDate.get(d);return r&&r222IsAutomaticArchive(r)&&!r222FormulaChanged(r)}).length;
    if(!confirm(`T1–T30 geçmişi güvenli biçimde yenilensin mi?\n\nOtomatik arşivlenmiş ve formül sürümü değişmemiş ${autoPreserve} satır aynen korunacaktır. Manuel satırlar yeniden hesaplanabilir. Formül sürümü değiştiği doğrulanan otomatik satırlar yeni formülle, yine yalnız ilgili tarih ve öncesindeki veriler kullanılarak yeniden hesaplanır.\n\nGelecek tarihli veri, haber, öğrenme veya AI etkisi tahmin girdisine alınmaz. 30/30 tamamlanmadan mevcut arşiv değiştirilmez.`))return false;
    const oldLive=a.live?kh117CloneValue(a.live):null,oldShift=a.lastShift?kh117CloneValue(a.lastShift):null,oldFinal=a.lastFinalizedDate||null,staged=[],failures=[],job={id:makeId('KH_PIT_REBUILD_R222'),stage:'K_Tarihsel'},stats={preservedAuto:0,recomputedManual:0,recomputedFormulaChanged:0};
    state.calculating=true;state.progress={stage:'K_Tarihsel PIT güvenli yenileme',current:'Point-in-time staging',done:0,total:30,errors:0};clearCancel();writeLocal(CANCEL_KEY,{requested:false,jobId:null,at:null});setRuntime({status:JOB_STATUS.K_TARIHSEL_RUNNING,jobId:job.id,stage:'K_Tarihsel',done:0,total:30,message:'T1–T30 güvenli yenileme hazırlanıyor'});renderCurrentPagePreservingView();
    try{
      for(const anchor of anchors){
        if(cancelRequested(job))throw Object.assign(new Error('K_Tarihsel PIT yenileme iptal edildi'),{code:'OPERATION_CANCELLED'});
        const old=byDate.get(anchor),isAuto=!!old&&r222IsAutomaticArchive(old),changed=isAuto&&r222FormulaChanged(old);
        if(old&&isAuto&&!changed){staged.push({...kh117CloneValue(old),frozen:true,immutable:true,manualRefreshPreservedAt:nowISO()});stats.preservedAuto++}
        else{
          const result=kh117PitRowForAnchor(anchor,calcRecords);if(!result.ok){failures.push(result.reason);state.progress.errors=failures.length;continue}
          const row={...kh117CloneValue(result.row),source:changed?'PIT_FORMULA_REBUILD_R222':'PIT_MANUAL_REBUILD_R222',archiveOrigin:changed?'AUTO_RECOMPUTED_FORMULA':'MANUAL',provisional:false,frozen:true,immutable:true,formulaDetached:true,rebuiltAt:nowISO(),formulaVersion:MODEL_VERSION,criteriaSchemaFingerprint:MODEL_SCHEMA_FINGERPRINT,inputRule:'ONLY_DATA_AT_OR_BEFORE_ANCHOR',futureDataUsed:false,noFutureNews:true,noFutureLearning:true,noFutureAI:true,predictionInputCutoff:anchor};
          if(changed){row.originalAutoArchive=true;row.originalFormulaVersion=old?.formulaVersion||null;stats.recomputedFormulaChanged++}else stats.recomputedManual++;
          staged.push(row)
        }
        state.progress.done=staged.length;state.progress.current=`${anchor} · ${staged.length}/30`;
        if(staged.length%3===0){setRuntime({status:JOB_STATUS.K_TARIHSEL_RUNNING,jobId:job.id,stage:'K_Tarihsel',done:staged.length,total:30,message:`T1–T30 güvenli yenileme · ${staged.length}/30`});updateLiveStatus()}
        if(staged.length%2===0)await new Promise(r=>setTimeout(r,0));
      }
      if(staged.length!==30)throw new Error(`T1–T30 staging tamamlanamadı: ${staged.length}/30. Mevcut arşiv korunuyor.${failures[0]?` İlk neden: ${failures[0]}`:''}`);
      const check=kh117ValidateArchive({rows:staged},current.date);if(!check.ok||check.rows.length!==30)throw new Error('T1–T30 point-in-time bütünlük kontrolü başarısız');
      const next={...a,rows:check.rows.map(x=>({...kh117CloneValue(x),frozen:true,immutable:true})),live:oldLive,lastShift:oldShift,lastFinalizedDate:oldFinal,schema:Math.max(7,Number(a.schema||0)),seed:{...(a.seed||{}),completed:true,windowCount:30,immutable:true,valueOnly:true,rebuildAllowed:true,rebuildCount:Number(a.seed?.rebuildCount||0)+1,lastManualRebuildAt:nowISO(),method:'PIT_ARCHIVE_PRESERVE_UNCHANGED_AUTO_REBUILD_MANUAL_OR_CHANGED_FORMULA',inputRule:'ONLY_DATA_AT_OR_BEFORE_ANCHOR',futureDataUsedForPrediction:false,noFutureNews:true,noFutureLearning:true,noFutureAI:true,formulaVersion:MODEL_VERSION,stats}};
      state.khArchive=next;await kh117PersistArchive();const snap=await currentSnapshotMeta(),at=nowISO(),fp=historyTableFingerprint();await dbPut('meta',{key:'historicalSnapshot',value:{dataSnapshotId:snap?.snapshotId||null,at,transferredAt:at,changedAt:at,fingerprint:fp,date:current.date,valueOnlyArchive:true,manualPITRefresh:true,autoArchivesPreserved:stats.preservedAuto,recomputedManual:stats.recomputedManual,recomputedFormulaChanged:stats.recomputedFormulaChanged,inputRule:'ONLY_DATA_AT_OR_BEFORE_ANCHOR',futureDataUsedForPrediction:false,formulaVersion:MODEL_VERSION},updatedAt:at});await refreshTableMeta();
      setRuntime({status:JOB_STATUS.K_TARIHSEL_COMPLETED,jobId:job.id,stage:'K_Tarihsel',done:30,total:30,message:`T1–T30 yenilendi · otomatik korunan ${stats.preservedAuto}`});showAurumNotice(`T1–T30 30/30 hazır · otomatik arşiv korundu ${stats.preservedAuto} · yeniden hesaplanan ${stats.recomputedManual+stats.recomputedFormulaChanged}. Gelecek veri kullanılmadı.`,'success',5600);return true
    }catch(e){if(e?.code==='OPERATION_CANCELLED'||cancelRequested(job)){showAurumNotice('T1–T30 yenileme iptal edildi; mevcut arşiv aynen korundu.','info',2800);return false}throw e}
    finally{state.calculating=false;state.progress=null;clearCancel(job.id);updateLiveStatus();renderCurrentPagePreservingView()}
  }
  kh117SeedPIT30=rebuildPIT30R222;
  try{const old=globalThis.AurumKnHistoryV117||{};globalThis.AurumKnHistoryV117=Object.freeze({...old,version:'R222-PIT-AUTO-ARCHIVE-SAFE',seedPIT30:rebuildPIT30R222,rebuildPIT30:rebuildPIT30R222})}catch{}
  try{globalThis.AurumKnHistoryR53=Object.freeze({...globalThis.AurumKnHistoryR53,rebuildPIT30:rebuildPIT30R222,seedPIT30:rebuildPIT30R222})}catch{}
  const histRender=()=>{try{return globalThis.AurumKnHistoryV117?.renderHistoryDeferred?.()||globalThis.AurumKnHistoryV117?.renderHistory?.()||kh117RenderDeferred()}catch{return kh117RenderDeferred()}};
  historyPage=function historyPageR222(){const busy=state.syncing||state.calculating,buttons=`<button class="gold-btn" onclick="AurumRuntime.manualHistorical()" ${busy?'disabled':''}>K_Tarihsel’i Çalıştır</button><button class="ghost-btn" onclick="AurumKnHistoryV117.rebuildPIT30().catch(e=>showAurumNotice(e.message,'error',5600))" ${busy?'disabled':''}>T1–T30’u Yenile / Hesapla</button>`;let blocked='';try{blocked=integrityBlockedMarkup('K_Tarihsel')||''}catch{}return `${operationBlock('history',buttons)}<div data-aurum-explicit-time>${tableTimePanel('history')||''}${blocked||histRender()}</div>`};globalThis.historyPage=historyPage;

  try{AurumUpdateAPI.state.r222={version:'REV20.22-OPTIMAL-PIPELINE-UNIFIED-PORTAL',activatedAt:nowISO(),features:['MANUAL_MAIN_STAGED_PUBLISH_THEN_SMART_COMPLETION','AUTO_SMART_COMPLETION_GE5_MAX3','MANUAL_REPAIR_LE30M_FULL_GT30M','NO_SPONTANEOUS_DATA_FETCH','AUTO_CHAIN_DATA_KN_KHIST_S_TRADE','PIPELINE_6MIN_TARGET_NO_QUALITY_TRUNCATION','MARKET_AND_TRADE_DIRECTION_ARROWS','TRADE_PORTFOLIO_MINI_REFRESH','KH_AUTO_ARCHIVE_IMMUTABLE_IF_FORMULA_UNCHANGED','KH_RECOMPUTE_ONLY_KNOWN_FORMULA_CHANGE','KH_NO_FUTURE_DATA_NEWS_LEARNING_AI','UNIFIED_FULL_WIDTH_FINANCE_PORTAL','NEWS_SOURCE_TIME_URL_REQUIRED']}}catch{}
})();

/* ===== REV20.23 — EXPANDABLE FINANCE NEWS CARDS ===== */
try{AurumUpdateAPI.state.r223={version:'REV20.23-EXPANDABLE-FINANCE-NEWS',activatedAt:nowISO(),features:['NEWS_CARD_DOWN_ARROW','EXPANDABLE_ONE_TO_TWO_PARAGRAPH_SOURCE_SAFE_BRIEF','SOURCE_LINK_PRESERVED','SOURCE_AND_TIMESTAMPS_PRESERVED']}}catch{}

/* ===== REV20.24 — PRIORITIZED NEWS + SUBSTANTIVE EXPANSION ===== */
try{AurumUpdateAPI.state.r224={version:'REV20.24-PRIORITIZED-SUBSTANTIVE-NEWS',activatedAt:nowISO(),features:['PRIORITY_MARKET_FINANCE_FIRST','COMMENTARY_SECOND','ECONOMY_THIRD','POLITICS_JUSTICE_FOREIGN_WORLD_ORDER','COMPANY_KAP_LAST','DIRECT_SOURCE_ARTICLE_PARAGRAPH_ENRICHMENT','NO_EMPTY_TEMPLATE_NEWS_CARDS','SOURCE_TIME_URL_PRESERVED']}}catch{}

/* REV20.25 user-requested reliability refinements */
try{AurumUpdateAPI.state.r225={version:'REV20.25-RELIABILITY-FILL-NEWS',activatedAt:nowISO(),features:['FILL_LADDER_95_90_80_70','DERIVED_SNAPSHOT_MIN_70','PRESERVE_PREVIOUS_DERIVED_TIMESTAMPS','DATA_WORKERS_56_PROVIDER_LIMITS_PRESERVED','NEWS_VISIBLE_URL','EXTERNAL_SOURCE_SAFE_BACK_NAVIGATION']}}catch{}

/* ===== REV20.26 — USER RELIABILITY CONTRACT ===== */
(function installR226ReliabilityContract(){
 if(globalThis.__AURUM_REV226_RELIABILITY)return;globalThis.__AURUM_REV226_RELIABILITY=true;
 const MARKET_REFRESH_MS=30*60*1000,MARKET_LAST_KEY='aurum.r226.market.refresh.at',targets=[95,90,80,70];
 function fillStatus(){const sum=typeof dataSummary==='function'?dataSummary(state.records):{};const fill=Number(sum?.fillPct||0);return {fill,derived:fill>=70}}
 const oldMeta=globalThis.dataMetaMarkup||dataMetaMarkup;
 globalThis.dataMetaMarkup=dataMetaMarkup=function r226DataMetaMarkup(){
   return oldMeta();
 };
 async function refreshMarket(reason){
   if(document.hidden&&reason==='TIMER')return false;if(globalThis.__aurumR226MarketRefreshing)return false;globalThis.__aurumR226MarketRefreshing=true;
   try{const d=await globalThis.refreshMarketIndicators?.();localStorage.setItem(MARKET_LAST_KEY,String(Date.now()));const host=document.getElementById('aurumDataMarketStrip');if(host&&typeof globalThis.marketIndicatorsMarkup==='function')host.outerHTML=globalThis.marketIndicatorsMarkup();return !!d}catch{return false}finally{globalThis.__aurumR226MarketRefreshing=false}
 }
 /* The independent 30-minute market-indicator cadence remains active while the app process is alive. Lifecycle/network events must not initiate or reset a data fetch. */
 /* REV20.32 owns the single 30-minute market/portal cadence. */
 globalThis.openAurumSourceUrl=function(raw,ev){try{ev?.preventDefault?.();ev?.stopPropagation?.();const u=new URL(String(raw||''));if(u.protocol!=='https:')return false;const qp=new URLSearchParams({cmd:'open_url',url:u.href}),ans=window.prompt('aurum://native?'+qp.toString(),'')||'';if(ans==='OPENED')return false;location.href=u.href;return false}catch{return false}};
 document.addEventListener('click',ev=>{const a=ev.target?.closest?.('.r207-news-link a,.r207-news-card h3 a');if(a?.href)openAurumSourceUrl(a.href,ev)},true);
 async function persistSafety(){try{const st=fillStatus(),kn=(await dbGet('meta','knSnapshot'))?.value||null,hist=(await dbGet('meta','historicalSnapshot'))?.value||null,sel=(await dbGet('meta','selectionSnapshot'))?.value||null,at=nowISO();await dbPut('meta',{key:'r226DerivedSafety',value:{at,fillPct:st.fill,minFillPct:70,derivedUpdateAllowed:st.derived,preservedWhenBelow70:!st.derived,knAt:kn?.at||kn?.transferredAt||null,historicalAt:hist?.at||hist?.transferredAt||null,selectionAt:sel?.at||sel?.transferredAt||null,targets},updatedAt:at})}catch{}}
 const baseManualData=runManualData;runManualData=async function r226ManualData(){const ok=await baseManualData.apply(this,arguments);await persistSafety();try{await refreshMarket('DATA_COMMAND')}catch{}return ok};globalThis.runDataRefresh=mode=>runManualData(mode);
 try{globalThis.AurumRuntime=Object.freeze({...globalThis.AurumRuntime,manualData:runManualData})}catch{}
 try{AurumUpdateAPI.state.r226={version:'REV20.29-STRICT-IDLE-STARTUP',activatedAt:nowISO(),features:['FILL_LADDER_95_90_80_70','DERIVED_FREEZE_BELOW_70','PRESERVE_DERIVED_TIMESTAMPS','MARKET_AUTO_30_MIN','STRICT_IDLE_FOREGROUND_START','NO_STARTUP_DB_WRITES','NO_STARTUP_REPAIR_OR_MIGRATION','MULTI_SOURCE_DIRECT_PERCENT_ARROWS','NEWS_VISIBLE_URL_NATIVE_OPEN_BACK']}}catch{};
})();

/* ===== REV20.27 — NAVIGATION/LIFECYCLE SAFETY ===== */
(function installR227NavigationSafety(){
 if(globalThis.__AURUM_REV227_NAV_SAFETY)return;globalThis.__AURUM_REV227_NAV_SAFETY=true;
 /* Navigation is UI-only. It must never synchronously launch network/data work. */
 const baseGo=globalThis.goPage||goPage;
 if(typeof baseGo==='function'){
   globalThis.goPage=goPage=function r227GoPage(page){return baseGo.call(this,page)};
 }
 try{AurumUpdateAPI.state.r227={version:'REV20.27-NAV-LIFECYCLE-SAFETY',activatedAt:nowISO(),features:['NO_MARKET_FETCH_ON_APP_START','NO_DATA_FETCH_ON_BOOT','NO_DATA_FETCH_ON_NETWORK_RESTORE','NO_DATA_FETCH_ON_FOREGROUND','MARKET_TIMER_30_MIN_PRESERVED','MANUAL_AND_DEFINED_SCHEDULES_PRESERVED','TAB_NAVIGATION_UI_ONLY']}}catch{}
})();


/* ===== REV20.27.1 — RESPONSIVE TRANSFER POLICY ===== */
(function installR2271ResponsiveTransferPolicy(){
 if(globalThis.__AURUM_REV2271_RESPONSIVE_TRANSFER)return;globalThis.__AURUM_REV2271_RESPONSIVE_TRANSFER=true;
 /* Data acquisition remains asynchronous and provider-paced. No lifecycle/network listener is
    installed here. Worker pressure is bounded so WebView rendering/navigation keeps CPU time. */
 try{
   AurumUpdateAPI.state.r2271={version:'REV20.27.1-RESPONSIVE-TRANSFER',activatedAt:nowISO(),features:[
     'NO_LIFECYCLE_OR_CONNECTIVITY_AUTOSTART','DEFINED_SCHEDULER_ONLY','MANUAL_COMMANDS_ONLY',
     'MARKET_30_MIN_TIMER_PRESERVED','BOUNDED_FOREGROUND_WORKERS','COOPERATIVE_EVENT_LOOP_YIELD',
     'PROVIDER_PACING_AND_DATA_COMPLETENESS_PRESERVED'
   ]};
 }catch{}
})();

/* ===== REV20.28 — UI RESPONSIVENESS HARDENING ===== */
(function installR228UiResponsiveness(){
 if(globalThis.__AURUM_REV228_UI_RESPONSIVE)return;globalThis.__AURUM_REV228_UI_RESPONSIVE=true;
 /* Network work may only originate from explicit commands or the existing scheduler.
    Worker fan-out is intentionally capped; every completed symbol yields to WebView so
    navigation, scrolling and controls remain responsive during transfers. */
 try{AurumUpdateAPI.state.r228={version:'REV20.28-UI-RESPONSIVENESS',activatedAt:nowISO(),features:[
  'NO_STARTUP_AUTOSTART','NO_NETWORK_RESTORE_AUTOSTART','NO_FOREGROUND_AUTOSTART',
  'MARKET_30_MIN_TIMER_UNCHANGED','DEFINED_DATA_SCHEDULER_UNCHANGED',
  'FOREGROUND_WORKERS_MAX_6','RESCUE_WORKERS_MAX_4','EVENT_LOOP_YIELD_EACH_SYMBOL'
 ]}}catch{}
})();


/* ===== REV20.30 — COMPLETE MARKET STRIP / PREVIOUS-CLOSE PERCENT ===== */
(function installR230CompleteMarketStrip(){
 if(globalThis.__AURUM_R230_MARKET)return;globalThis.__AURUM_R230_MARKET=true;
 const KEY='marketIndicatorsR230', KEYS=['XU100','USDTRY','EURTRY','EURUSD','GRAMTRY','GOLDUSD'];
 const MAP={XU100:'XU100.IS',USDTRY:'TRY=X',EURTRY:'EURTRY=X',EURUSD:'EURUSD=X',GOLDUSD:'GC=F'};
 const priorRefresh=globalThis.refreshMarketIndicators;
 const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null};
 function previousTradingClose(meta,ts,closes,lastIndex){
   let p=num(meta?.chartPreviousClose??meta?.previousClose);
   if(p!=null&&p!==0)return p;
   for(let i=lastIndex-1;i>=0;i--){const c=num(closes?.[i]);if(c!=null&&c!==0&&Number(ts?.[i])<Number(ts?.[lastIndex]))return c}
   return null;
 }
 async function chart(key,symbol,host){
   const url='https://'+host+'/v8/finance/chart/'+encodeURIComponent(symbol)+'?interval=1d&range=10d&includePrePost=false&events=div%2Csplits';
   const r=await fetchWithTimeout(url,{headers:{Accept:'application/json'},cache:'no-store',__provider:'YAHOO'},'Piyasa '+key);
   if(!r.ok)throw new Error(key+' '+host+' HTTP '+r.status);
   const o=await responseJSON(r),z=o?.chart?.result?.[0],m=z?.meta||{},ts=z?.timestamp||[],cs=z?.indicators?.quote?.[0]?.close||[];
   let i=cs.length-1;while(i>=0&&num(cs[i])==null)i--;
   const value=num(m.regularMarketPrice)??(i>=0?num(cs[i]):null), atMs=num(m.regularMarketTime)!=null?Number(m.regularMarketTime)*1000:(i>=0?Number(ts[i])*1000:NaN);
   const prev=previousTradingClose(m,ts,cs,i);
   if(value==null||!Number.isFinite(atMs))throw new Error(key+' veri yok');
   return {value,previousClose:prev,changePct:prev!=null&&prev!==0?(value/prev-1)*100:null,source:host.startsWith('query1')?'YAHOO_Q1_CHART':'YAHOO_Q2_CHART',providerAt:new Date(atMs).toISOString(),at:new Date(atMs).toISOString(),direct:true,identityVerified:true,url};
 }
 async function one(key,symbol){
   let last;for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){try{return await chart(key,symbol,host)}catch(e){last=e}}
   throw last||new Error(key+' kaynak yok');
 }
 function cached(){return state.marketIndicators?.source==='REV20.30_PREVIOUS_CLOSE'?state.marketIndicators:readLocal(KEY,null)}
 async function refresh(){
   const base=await Promise.allSettled(Object.entries(MAP).map(async([k,s])=>[k,await one(k,s)]));
   const fields={},errors=[];
   for(const r of base){if(r.status==='fulfilled')fields[r.value[0]]=r.value[1];else errors.push(String(r.reason?.message||r.reason))}
   /* Keep the established direct/open-source providers as independent fallbacks. */
   if(typeof priorRefresh==='function'){
     try{const p=await priorRefresh(),pf=p?.fields||{};for(const k of KEYS)if(!fields[k]&&pf[k]&&!pf[k].stale)fields[k]=pf[k]}catch(e){errors.push(String(e?.message||e))}
   }
   if(!fields.EURTRY&&fields.EURUSD&&fields.USDTRY){
     const a=fields.EURUSD,b=fields.USDTRY,v=num(a.value)*num(b.value),pc=num(a.previousClose)*num(b.previousClose);
     if(Number.isFinite(v))fields.EURTRY={value:v,previousClose:Number.isFinite(pc)?pc:null,changePct:Number.isFinite(pc)&&pc!==0?(v/pc-1)*100:null,source:'API_CROSS_EURUSD_USDTRY',providerAt:a.providerAt||b.providerAt,at:a.at||b.at,direct:false,identityVerified:true};
   }
   /* Prefer a directly published gram quote from the existing open sources; otherwise use API ounce + FX closes consistently. */
   if(!fields.GRAMTRY&&fields.GOLDUSD&&fields.USDTRY){
     const a=fields.GOLDUSD,b=fields.USDTRY,v=num(a.value)*num(b.value)/31.1034768,pc=num(a.previousClose)*num(b.previousClose)/31.1034768;
     if(Number.isFinite(v))fields.GRAMTRY={value:v,previousClose:Number.isFinite(pc)?pc:null,changePct:Number.isFinite(pc)&&pc!==0?(v/pc-1)*100:null,source:'API_GOLDUSD_X_USDTRY',providerAt:a.providerAt||b.providerAt,at:a.at||b.at,direct:false,identityVerified:true};
   }
   const old=cached()?.fields||{};
   for(const k of KEYS)if(!fields[k]&&old[k])fields[k]={...old[k],stale:true};
   const payload={at:nowISO(),updatedAt:nowISO(),source:'REV20.30_PREVIOUS_CLOSE',previousCloseRule:'LAST_MARKET_TRADING_CLOSE',fields,values:Object.fromEntries(KEYS.map(k=>[k,num(fields[k]?.value)])),errors:errors.slice(0,12)};
   state.marketIndicators=payload;writeLocal(KEY,payload);writeLocal('marketIndicatorsR40',payload);
   try{await dbPut('meta',{key:KEY,value:payload,updatedAt:nowISO()})}catch{}
   return payload;
 }
 function fnum(v,key){if(num(v)==null)return '—';const d=key==='XU100'?0:key==='GRAMTRY'||key==='GOLDUSD'?2:4;return Number(v).toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d,useGrouping:true})}
 function markup(){
   const m=cached()||{},f=m.fields||{},labs={XU100:'BIST 100',USDTRY:'USD/TRY',EURTRY:'EUR/TRY',EURUSD:'EUR/USD',GRAMTRY:'Gram Altın',GOLDUSD:'Altın Ons'};
   return '<div class="aurum-r209-market-wrap" id="aurumDataMarketStrip"><button type="button" class="aurum-r209-market-refresh" title="Piyasa bilgilerini yenile" aria-label="Piyasa bilgilerini yenile" onclick="refreshAurumDataMarketStrip(event)"><span aria-hidden="true">↻</span></button><div class="aurum-r205-market">'+KEYS.map(k=>{const x=f[k]||{},c=x.stale?null:num(x.changePct),cls=c==null?'flat':c>0?'up':c<0?'down':'flat',arrow=c==null?'':c>0?'↑':c<0?'↓':'·',pct=c==null?(x.stale?'eski':'—'):(c>0?'+':'')+c.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%';return '<div class="aurum-r205-market-card" title="'+html((x.source||'')+(x.previousClose!=null?' · Önceki kapanış: '+fnum(x.previousClose,k):''))+'"><span class="aurum-r205-market-label">'+labs[k]+'</span><strong class="aurum-r205-market-value">'+fnum(x.value,k)+'</strong><span class="aurum-r205-market-pct '+cls+'">'+(arrow?'<i class="aurum-market-dir" aria-hidden="true">'+arrow+'</i>':'')+pct+'</span></div>'}).join('')+'</div></div>';
 }
 globalThis.cachedMarketIndicators=cached;globalThis.refreshMarketIndicators=refresh;globalThis.marketIndicatorsMarkup=markup;
 try{refreshMarketIndicators=refresh;marketIndicatorsMarkup=markup}catch{}
 globalThis.refreshAurumDataMarketStrip=async function(ev){const btn=ev?.currentTarget||document.querySelector('.aurum-r209-market-refresh');if(btn?.dataset.busy==='1')return false;try{if(btn){btn.dataset.busy='1';btn.disabled=true}await refresh();const h=document.getElementById('aurumDataMarketStrip');if(h)h.outerHTML=markup();return true}catch(e){globalThis.showAurumNotice?.('Piyasa bilgileri yenilenemedi: '+(e?.message||e),'error',2600);return false}finally{const b=document.querySelector('.aurum-r209-market-refresh');if(b){delete b.dataset.busy;b.disabled=false}}};
 try{AurumUpdateAPI.state.r230={version:'REV20.30-COMPLETE-MARKET-PREV-CLOSE',activatedAt:nowISO(),features:['ALL_SIX_MARKET_FIELDS','PREVIOUS_TRADING_CLOSE_PERCENT','DUAL_API_HOST_FALLBACK','OPEN_SOURCE_FALLBACK','MANUAL_AND_30_MIN_REFRESH_ONLY','NO_LIFECYCLE_AUTOSTART']}}catch{}
})();


/* ===== REV20.31 — PROVIDER-PUBLISHED MARKET PERCENTAGES ONLY ===== */
(function installR231ProviderPublishedMarketPercent(){
 if(globalThis.__AURUM_R231_PROVIDER_PCT)return;globalThis.__AURUM_R231_PROVIDER_PCT=true;
 const KEY='marketIndicatorsR231', KEYS=['XU100','USDTRY','EURTRY','EURUSD','GRAMTRY','GOLDUSD'];
 const LABELS={XU100:'BIST 100',USDTRY:'USD/TRY',EURTRY:'EUR/TRY',EURUSD:'EUR/USD',GRAMTRY:'Gram Altın',GOLDUSD:'Altın Ons'};
 const numTR=s=>{s=String(s??'').trim().replace(/\s/g,'').replace(/%/g,'');if(!s)return null;const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');if(comma>dot)s=s.replace(/\./g,'').replace(',','.');else if(dot>comma&&comma>=0)s=s.replace(/,/g,'');const n=Number(s.replace(/^\+/,'').replace('−','-'));return Number.isFinite(n)?n:null};
 const escRe=s=>s.replace(/[.*+?^$()|[\]\\{}]/g,'\\$&');
 function pairFromText(text,label){
   const clean=String(text||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
   const re=new RegExp(escRe(label)+'\\s*[:\\-]?\\s*([-+−]?\\d[\\d.]*,?\\d*)\\s*(?:%?\\s*)?([-+−]?\\d[\\d.]*,\\d+)\\s*%?','i'),m=clean.match(re);
   if(!m)return null;const value=numTR(m[1]),pct=numTR(m[2]);return value!=null&&pct!=null?{value,changePct:pct}:null;
 }
 async function bigpara(){
   const url='https://sm.bigpara.com/piyasalar/';
   const r=await fetchWithTimeout(url,{headers:{Accept:'text/html,application/xhtml+xml'},cache:'no-store',__provider:'BIGPARA'},'Piyasa doğrudan yüzde');
   if(!r.ok)throw new Error('Bigpara HTTP '+r.status);
   const body=await r.text(),doc=new DOMParser().parseFromString(body,'text/html');
   const candidates=[...doc.querySelectorAll('tr,li,.row,[class*="market"],[class*="piyasa"],[class*="table"]')].map(n=>n.textContent||'');candidates.push(doc.body?.innerText||doc.body?.textContent||'');
   const defs={XU100:['BIST 100'],USDTRY:['DOLAR','USD / TRY','USD/TRY'],EURTRY:['EURO','EUR / TRY','EUR/TRY'],EURUSD:['EUR / USD','EUR/USD'],GRAMTRY:['ALTIN'],GOLDUSD:['ALTIN (ONS/$)','ALTIN ONS','ONS ALTIN']},fields={};
   for(const [k,labels] of Object.entries(defs)){outer:for(const t of candidates){if(k==='GRAMTRY'&&/ONS/.test(t.toLocaleUpperCase('tr-TR')))continue;for(const label of labels){const p=pairFromText(t,label);if(p){fields[k]={...p,source:'BIGPARA_DIRECT_PUBLISHED',providerAt:nowISO(),at:nowISO(),direct:true,identityVerified:true,percentOrigin:'PROVIDER_PUBLISHED',url};break outer}}}}
   return fields;
 }
 async function yahooQuote(){
   const symbols={XU100:'XU100.IS',USDTRY:'TRY=X',EURTRY:'EURTRY=X',EURUSD:'EURUSD=X',GOLDUSD:'GC=F'},out={};
   for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){try{const url='https://'+host+'/v7/finance/quote?symbols='+encodeURIComponent(Object.values(symbols).join(','));const r=await fetchWithTimeout(url,{headers:{Accept:'application/json'},cache:'no-store',__provider:'YAHOO'},'Piyasa doğrudan quote');if(!r.ok)continue;const o=await responseJSON(r),rows=o?.quoteResponse?.result||[];for(const [k,sym] of Object.entries(symbols)){const q=rows.find(x=>x?.symbol===sym),v=Number(q?.regularMarketPrice),p=Number(q?.regularMarketChangePercent);if(Number.isFinite(v)&&Number.isFinite(p))out[k]={value:v,changePct:p,previousClose:Number.isFinite(Number(q?.regularMarketPreviousClose))?Number(q.regularMarketPreviousClose):null,source:host.startsWith('query1')?'YAHOO_Q1_DIRECT_QUOTE':'YAHOO_Q2_DIRECT_QUOTE',providerAt:q?.regularMarketTime?new Date(Number(q.regularMarketTime)*1000).toISOString():nowISO(),at:q?.regularMarketTime?new Date(Number(q.regularMarketTime)*1000).toISOString():nowISO(),direct:true,identityVerified:true,percentOrigin:'PROVIDER_PUBLISHED',url}}if(Object.keys(out).length)return out}catch{}}
   return out;
 }
 function cached(){return state.marketIndicators?.source==='REV20.31_PROVIDER_PUBLISHED_PERCENT'?state.marketIndicators:readLocal(KEY,null)}
 async function refresh(){
   const errors=[];let fields={};try{fields=await bigpara()}catch(e){errors.push(String(e?.message||e))}
   if(KEYS.some(k=>!fields[k])){try{const y=await yahooQuote();for(const k of KEYS)if(!fields[k]&&y[k])fields[k]=y[k]}catch(e){errors.push(String(e?.message||e))}}
   const old=cached()?.fields||{};for(const k of KEYS)if(!fields[k]&&old[k])fields[k]={...old[k],stale:true};
   const values={};for(const k of KEYS){const n=Number(fields[k]?.value);values[k]=Number.isFinite(n)?n:null}
   const payload={at:nowISO(),updatedAt:nowISO(),source:'REV20.31_PROVIDER_PUBLISHED_PERCENT',percentRule:'PROVIDER_PUBLISHED_ONLY_NO_APP_CALCULATION',fields,values,errors:errors.slice(0,12)};
   state.marketIndicators=payload;writeLocal(KEY,payload);writeLocal('marketIndicatorsR40',payload);try{await dbPut('meta',{key:KEY,value:payload,updatedAt:nowISO()})}catch{}return payload;
 }
 function fnum(v,key){const n=Number(v);if(!Number.isFinite(n))return '—';const d=key==='XU100'?2:key==='GRAMTRY'||key==='GOLDUSD'?2:4;return n.toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d,useGrouping:true})}
 function markup(){const m=cached()||{},f=m.fields||{};return '<div class="aurum-r209-market-wrap" id="aurumDataMarketStrip"><button type="button" class="aurum-r209-market-refresh" title="Piyasa bilgilerini yenile" aria-label="Piyasa bilgilerini yenile" onclick="refreshAurumDataMarketStrip(event)"><span aria-hidden="true">↻</span></button><div class="aurum-r205-market">'+KEYS.map(k=>{const x=f[k]||{},c=x.stale?null:Number(x.changePct),valid=Number.isFinite(c),cls=!valid?'flat':c>0?'up':c<0?'down':'flat',arrow=!valid?'':c>0?'↑':c<0?'↓':'·',pct=!valid?(x.stale?'eski':'—'):(c>0?'+':'')+c.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%';return '<div class="aurum-r205-market-card" title="'+html((x.source||'')+' · Yüzde: kaynaktan doğrudan')+'"><span class="aurum-r205-market-label">'+LABELS[k]+'</span><strong class="aurum-r205-market-value">'+fnum(x.value,k)+'</strong><span class="aurum-r205-market-pct '+cls+'">'+(arrow?'<i class="aurum-market-dir" aria-hidden="true">'+arrow+'</i>':'')+pct+'</span></div>'}).join('')+'</div></div>'}
 globalThis.cachedMarketIndicators=cached;globalThis.refreshMarketIndicators=refresh;globalThis.marketIndicatorsMarkup=markup;try{refreshMarketIndicators=refresh;marketIndicatorsMarkup=markup}catch{}
 globalThis.refreshAurumDataMarketStrip=async function(ev){const btn=ev?.currentTarget||document.querySelector('.aurum-r209-market-refresh');if(btn?.dataset.busy==='1')return false;try{if(btn){btn.dataset.busy='1';btn.disabled=true}await refresh();const h=document.getElementById('aurumDataMarketStrip');if(h)h.outerHTML=markup();return true}catch(e){globalThis.showAurumNotice?.('Piyasa bilgileri yenilenemedi: '+(e?.message||e),'error',2600);return false}finally{const b=document.querySelector('.aurum-r209-market-refresh');if(b){delete b.dataset.busy;b.disabled=false}}};
 try{AurumUpdateAPI.state.r231={version:'REV20.31-PROVIDER-PUBLISHED-PERCENT',activatedAt:nowISO(),features:['NO_PERCENT_CALCULATION_IN_APP','PRICE_AND_PERCENT_FROM_PROVIDER','BIGPARA_DIRECT_PRIMARY','YAHOO_DIRECT_QUOTE_FALLBACK','ALL_SIX_REQUIRED_WHEN_SOURCE_AVAILABLE','DIRECTION_ARROW_FROM_PUBLISHED_PERCENT','MANUAL_AND_30_MIN_REFRESH_ONLY','NO_LIFECYCLE_AUTOSTART']}}catch{}
})();


/* ===== REV20.32 — STRICT TRIGGER POLICY + NON-BLOCKING 30M MARKET/PORTAL CADENCE ===== */
(function installR232StrictCadence(){
 if(globalThis.__AURUM_R232_STRICT_CADENCE)return;globalThis.__AURUM_R232_STRICT_CADENCE=true;
 const PERIOD=30*60*1000;
 let marketBusy=false,portalBusy=false;
 const idle=fn=>new Promise(resolve=>{
   const run=()=>Promise.resolve().then(fn).then(resolve,()=>resolve(false));
   if(typeof requestIdleCallback==='function')requestIdleCallback(run,{timeout:2500});else setTimeout(run,0);
 });
 async function marketTick(){
   if(marketBusy)return false;marketBusy=true;
   try{
     const data=await idle(()=>globalThis.refreshMarketIndicators?.());
     const host=document.getElementById('aurumDataMarketStrip');
     if(host&&typeof globalThis.marketIndicatorsMarkup==='function')requestAnimationFrame(()=>{try{const h=document.getElementById('aurumDataMarketStrip');if(h)h.outerHTML=globalThis.marketIndicatorsMarkup()}catch{}});
     return !!data;
   }finally{marketBusy=false}
 }
 async function portalTick(){
   if(portalBusy)return false;portalBusy=true;
   try{return !!(await idle(()=>globalThis.refreshAurumFinancePortal?.(true)))}finally{portalBusy=false}
 }
 /* Deliberately no immediate call. Loading, foregrounding, reconnecting, opening a tab or
    regaining access never starts network work. The first autonomous market/news request is
    exactly one cadence after this runtime starts; subsequent requests are cadence-only. */
 setInterval(()=>{void marketTick()},PERIOD);
 setInterval(()=>{void portalTick()},PERIOD);
 globalThis.AurumPeriodicMarket=Object.freeze({periodMs:PERIOD,marketTick,portalTick,policy:'30M_TIMER_OR_EXPLICIT_MANUAL_ONLY'});
 try{AurumUpdateAPI.state.r232={version:'REV20.32-STRICT-TRIGGERS-NONBLOCKING-30M',activatedAt:nowISO(),features:[
   'NO_STARTUP_FETCH','NO_FOREGROUND_FETCH','NO_NETWORK_RESTORE_FETCH','NO_TAB_NAVIGATION_FETCH',
   'DATA_ONLY_DEFINED_SCHEDULER_OR_MANUAL','MARKET_INDICATORS_30M','FINANCE_PORTAL_30M',
   'PROVIDER_PUBLISHED_PERCENT_ONLY','VALUE_AND_PERCENT_SAME_PROVIDER_RECORD',
   'NO_APP_PERCENT_CALCULATION','PERCENT_HIDDEN_WHEN_PROVIDER_OMITS',
   'IDLE_SCHEDULED_NETWORK_START','ASYNC_DOM_PAINT','NO_UI_THREAD_WAIT_FOR_NETWORK'
 ]}}catch{}
})();


/* ===== REV20.33 — UNIFIED DIRECT MARKET FEED CARD ===== */
(function installR233UnifiedDirectMarketFeed(){
 if(globalThis.__AURUM_R233_UNIFIED_MARKET)return;globalThis.__AURUM_R233_UNIFIED_MARKET=true;
 const KEY='marketIndicatorsR233', KEYS=['XU100','USDTRY','EURTRY','EURUSD','GRAMTRY','GOLDUSD'];
 const LABELS={XU100:'BIST 100',USDTRY:'USD/TRY',EURTRY:'EUR/TRY',EURUSD:'EUR/USD',GRAMTRY:'Gram Altın',GOLDUSD:'Altın Ons'};
 const num=s=>{s=String(s??'').trim().replace(/\s/g,'').replace(/%/g,'').replace(/[₺$€]/g,'');if(!s)return null;const c=s.lastIndexOf(','),d=s.lastIndexOf('.');if(c>d)s=s.replace(/\./g,'').replace(',','.');else if(d>c&&c>=0)s=s.replace(/,/g,'');const n=Number(s.replace('−','-').replace(/^\+/,''));return Number.isFinite(n)?n:null};
 const clean=s=>String(s||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
 const direct=(value,pct,source,url,at=nowISO())=>({value:num(value),changePct:num(pct),source,url,providerAt:at,at,direct:true,identityVerified:true,percentOrigin:'PROVIDER_PUBLISHED',stale:false});
 function match(text,re){const m=clean(text).match(re);return m?direct(m[1],m[2],null,null):null}
 async function getText(url,provider,label){
   const r=await fetchWithTimeout(url,{headers:{Accept:'text/html,application/xhtml+xml'},cache:'no-store',__provider:provider},label);
   if(!r.ok)throw new Error(label+' HTTP '+r.status);return await r.text();
 }
 async function unat(){
   const url='https://theunat.com/markets',body=clean((new DOMParser().parseFromString(await getText(url,'THEUNAT','The Unat piyasa'),'text/html')).body?.innerText||'');
   const defs={
    XU100:/BIST\s*100\s*([0-9.,]+)\s*([+\-−][0-9.,]+)%/i,
    USDTRY:/USD\/TRY\s*[₺]?\s*([0-9.,]+)\s*([+\-−][0-9.,]+)%/i,
    EURTRY:/EUR\/TRY\s*[₺]?\s*([0-9.,]+)\s*([+\-−][0-9.,]+)%/i,
    GOLDUSD:/ALTIN\s*\(ONS\)\s*[$]?\s*([0-9.,]+)\s*([+\-−][0-9.,]+)%/i
   },out={};
   for(const [k,re] of Object.entries(defs)){const x=match(body,re);if(x)out[k]={...x,source:'THEUNAT_DIRECT',url}}
   return out;
 }
 async function bistCanli(){
   const url='https://borsaistanbulcanli.com/markets.php?tab=commodities',body=clean((new DOMParser().parseFromString(await getText(url,'BISTCANLI','Açık piyasa akışı'),'text/html')).body?.innerText||'');
   const defs={
    USDTRY:/([0-9.,]+)\s*USD\/TRY\s*([+\-−][0-9.,]+)%/i,
    EURTRY:/([0-9.,]+)\s*EUR\/TRY\s*([+\-−][0-9.,]+)%/i,
    GRAMTRY:/Gram\s*Altın\s*[₺]?\s*([0-9.,]+)\s*([+\-−][0-9.,]+)%/i,
    GOLDUSD:/Ons\s*Altın\s*[$]?\s*([0-9.,]+)\s*([+\-−][0-9.,]+)%/i
   },out={};
   for(const [k,re] of Object.entries(defs)){const x=match(body,re);if(x)out[k]={...x,source:'BISTCANLI_DIRECT',url}}
   return out;
 }
 async function bigpara(){
   const url='https://bigpara.hurriyet.com.tr/',body=clean((new DOMParser().parseFromString(await getText(url,'BIGPARA','Bigpara piyasa'),'text/html')).body?.innerText||'');
   const defs={
    XU100:/BIST\s*100[^0-9]*([0-9.,]+)\s*([+\-−][0-9.,]+)\s*%/i,
    USDTRY:/(?:Dolar|USD\/TRY)[^0-9]*([0-9.,]+)\s*([+\-−][0-9.,]+)\s*%/i,
    EURTRY:/(?:Euro|EUR\/TRY)[^0-9]*([0-9.,]+)\s*([+\-−][0-9.,]+)\s*%/i,
    EURUSD:/EUR\/USD[^0-9]*([0-9.,]+)\s*([+\-−][0-9.,]+)\s*%/i,
    GRAMTRY:/Gram\s*Altın[^0-9]*([0-9.,]+)\s*([+\-−][0-9.,]+)\s*%/i,
    GOLDUSD:/(?:Altın\s*Ons|Ons\s*Altın)[^0-9]*([0-9.,]+)\s*([+\-−][0-9.,]+)\s*%/i
   },out={};
   for(const [k,re] of Object.entries(defs)){const x=match(body,re);if(x)out[k]={...x,source:'BIGPARA_DIRECT',url}}
   return out;
 }
 async function yahoo(){
   const syms={XU100:'XU100.IS',USDTRY:'TRY=X',EURTRY:'EURTRY=X',EURUSD:'EURUSD=X',GOLDUSD:'GC=F'},out={};
   for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
    try{
     const url='https://'+host+'/v7/finance/quote?symbols='+encodeURIComponent(Object.values(syms).join(',')),r=await fetchWithTimeout(url,{headers:{Accept:'application/json'},cache:'no-store',__provider:'YAHOO'},'Yahoo direct quote');
     if(!r.ok)continue;const rows=(await responseJSON(r))?.quoteResponse?.result||[];
     for(const [k,s] of Object.entries(syms)){const q=rows.find(z=>z?.symbol===s),v=Number(q?.regularMarketPrice),p=Number(q?.regularMarketChangePercent);if(Number.isFinite(v)&&Number.isFinite(p))out[k]=direct(v,p,host.startsWith('query1')?'YAHOO_Q1_DIRECT':'YAHOO_Q2_DIRECT',url,q?.regularMarketTime?new Date(Number(q.regularMarketTime)*1000).toISOString():nowISO())}
     if(Object.keys(out).length)return out;
    }catch{}
   } return out;
 }
 function cached(){return state.marketIndicators?.source==='REV20.33_UNIFIED_DIRECT_FEED'?state.marketIndicators:readLocal(KEY,null)}
 async function refresh(){
   const settled=await Promise.allSettled([bigpara(),unat(),bistCanli(),yahoo()]),fields={},errors=[];
   for(const r of settled){if(r.status==='fulfilled'){for(const [k,x] of Object.entries(r.value||{}))if(!fields[k]&&x?.value!=null&&x?.changePct!=null)fields[k]=x}else errors.push(String(r.reason?.message||r.reason))}
   const old=cached()?.fields||{};for(const k of KEYS)if(!fields[k]&&old[k])fields[k]={...old[k],stale:true};
   const payload={at:nowISO(),updatedAt:nowISO(),source:'REV20.33_UNIFIED_DIRECT_FEED',percentRule:'PROVIDER_PUBLISHED_ONLY_NO_APP_CALCULATION',fields,values:Object.fromEntries(KEYS.map(k=>[k,fields[k]?.value??null])),errors:errors.slice(0,8)};
   state.marketIndicators=payload;writeLocal(KEY,payload);writeLocal('marketIndicatorsR40',payload);try{await dbPut('meta',{key:KEY,value:payload,updatedAt:nowISO()})}catch{}return payload;
 }
 function fmt(v,k){const n=Number(v);if(!Number.isFinite(n))return '—';return n.toLocaleString('tr-TR',{minimumFractionDigits:k==='XU100'?2:(k==='USDTRY'||k==='EURTRY'||k==='EURUSD'?4:2),maximumFractionDigits:k==='XU100'?2:(k==='USDTRY'||k==='EURTRY'||k==='EURUSD'?4:2)})}
 function markup(){
   const m=cached()||{},f=m.fields||{},rows=KEYS.map(k=>{const x=f[k]||{},p=x.stale?null:Number(x.changePct),ok=Number.isFinite(p),cls=!ok?'flat':p>0?'up':p<0?'down':'flat',arrow=!ok?'':p>0?'↑':p<0?'↓':'·',pct=!ok?(x.stale?'önceki veri':'—'):(p>0?'+':'')+p.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%',src=String(x.source||'kaynak bekleniyor').replace('_DIRECT','').replaceAll('_',' ');
     return '<div class="r233-market-line"><span class="r233-market-name">'+LABELS[k]+'</span><strong>'+fmt(x.value,k)+'</strong><span class="aurum-r205-market-pct '+cls+'">'+(arrow?'<i class="aurum-market-dir" aria-hidden="true">'+arrow+'</i>':'')+pct+'</span><small>'+html(src)+'</small></div>'}).join('');
   return '<div class="aurum-r209-market-wrap r233-market-wrap" id="aurumDataMarketStrip"><button type="button" class="aurum-r209-market-refresh" title="Piyasa akışını yenile" aria-label="Piyasa akışını yenile" onclick="refreshAurumDataMarketStrip(event)"><span aria-hidden="true">↻</span></button><div class="r233-market-card"><div class="r233-market-head"><b>Piyasa Akışı</b><small>Fiyat ve % değişim doğrudan kaynaktan · 30 dk</small></div><div class="r233-market-grid">'+rows+'</div></div></div>';
 }
 globalThis.cachedMarketIndicators=cached;globalThis.refreshMarketIndicators=refresh;globalThis.marketIndicatorsMarkup=markup;try{refreshMarketIndicators=refresh;marketIndicatorsMarkup=markup}catch{}
 globalThis.refreshAurumDataMarketStrip=async function(ev){const btn=ev?.currentTarget||document.querySelector('.aurum-r209-market-refresh');if(btn?.dataset.busy==='1')return false;try{if(btn){btn.dataset.busy='1';btn.disabled=true}await refresh();const h=document.getElementById('aurumDataMarketStrip');if(h)h.outerHTML=markup();return true}catch(e){globalThis.showAurumNotice?.('Piyasa akışı yenilenemedi: '+(e?.message||e),'error',2600);return false}finally{const b=document.querySelector('.aurum-r209-market-refresh');if(b){delete b.dataset.busy;b.disabled=false}}};
 try{AurumUpdateAPI.state.r233={version:'REV20.33-UNIFIED-DIRECT-MARKET-FEED',activatedAt:nowISO(),features:['ONE_TWO_ROW_MARKET_CARD','MULTI_OPEN_SOURCE_DIRECT_FEEDS','PROVIDER_PUBLISHED_PERCENT_ONLY','NO_PERCENT_CALCULATION','PRICE_PERCENT_SAME_SOURCE_RECORD','30_MIN_TIMER_UNCHANGED','MANUAL_REFRESH','NO_STARTUP_FOREGROUND_NETWORK_AUTOSTART']}}catch{}
})();


/* ===== REV20.34 — CLEAN COMPLETE DIRECT MARKET FEED ===== */
(function installR234CleanDirectMarketFeed(){
 if(globalThis.__AURUM_R234_MARKET)return;globalThis.__AURUM_R234_MARKET=true;
 const KEY='marketIndicatorsR234', KEYS=['XU100','USDTRY','EURTRY','EURUSD','GRAMTRY','GOLDUSD'];
 const LABELS={XU100:'BIST 100',USDTRY:'USD/TRY',EURTRY:'EUR/TRY',EURUSD:'EUR/USD',GRAMTRY:'Gram Altın',GOLDUSD:'Altın Ons'};
 const n=v=>{const x=Number(String(v??'').replace('%','').replace(',','.').replace('+',''));return Number.isFinite(x)?x:null};
 const direct=(v,p,src,url,at)=>({value:n(v),changePct:n(p),source:src,url,providerAt:at||nowISO(),at:at||nowISO(),direct:true,identityVerified:true,percentOrigin:'PROVIDER_PUBLISHED',stale:false});
 async function genelpara(list,symbols){
   const url='https://api.genelpara.com/json/?list='+encodeURIComponent(list)+'&sembol='+encodeURIComponent(symbols.join(','));
   const r=await fetchWithTimeout(url,{headers:{Accept:'application/json'},cache:'no-store',__provider:'GENELPARA'},'GenelPara doğrudan piyasa');
   if(!r.ok)throw new Error('GenelPara HTTP '+r.status);const o=await responseJSON(r),d=o?.data||{},out={};
   const take=(key,sym)=>{const q=d?.[sym];if(!q)return;const v=n(q.satis??q.alis??q.fiyat),p=n(q.oran??q.degisim);if(v!=null&&p!=null)out[key]=direct(v,p,'GENELPARA_DIRECT',url,o?.timestamp||nowISO())};
   if(list==='doviz'){take('USDTRY','USD');take('EURTRY','EUR')}
   if(list==='altin'){take('GRAMTRY','GA');take('GOLDUSD','XAUUSD')}
   return out;
 }
 async function yahoo(){
   const syms={XU100:'XU100.IS',USDTRY:'TRY=X',EURTRY:'EURTRY=X',EURUSD:'EURUSD=X',GOLDUSD:'GC=F'},out={};
   for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
    try{const url='https://'+host+'/v7/finance/quote?symbols='+encodeURIComponent(Object.values(syms).join(',')),r=await fetchWithTimeout(url,{headers:{Accept:'application/json'},cache:'no-store',__provider:'YAHOO'},'Yahoo doğrudan piyasa');if(!r.ok)continue;
     const rows=(await responseJSON(r))?.quoteResponse?.result||[];for(const [k,s] of Object.entries(syms)){const q=rows.find(x=>x?.symbol===s),v=Number(q?.regularMarketPrice),p=Number(q?.regularMarketChangePercent);if(Number.isFinite(v)&&Number.isFinite(p))out[k]=direct(v,p,host.startsWith('query1')?'YAHOO_Q1_DIRECT':'YAHOO_Q2_DIRECT',url,q?.regularMarketTime?new Date(Number(q.regularMarketTime)*1000).toISOString():nowISO())}
     if(Object.keys(out).length)return out;
    }catch{}
   }return out;
 }
 const previous=globalThis.refreshMarketIndicators;
 function cached(){return state.marketIndicators?.source==='REV20.34_CLEAN_DIRECT'?state.marketIndicators:readLocal(KEY,null)}
 async function refresh(){
   const fields={},errors=[];
   const settled=await Promise.allSettled([genelpara('doviz',['USD','EUR']),genelpara('altin',['GA','XAUUSD']),yahoo()]);
   for(const r of settled){if(r.status==='fulfilled')for(const [k,x] of Object.entries(r.value||{}))if(!fields[k]&&x?.value!=null&&x?.changePct!=null)fields[k]=x;else if(r.status==='rejected')errors.push(String(r.reason?.message||r.reason))}
   if(KEYS.some(k=>!fields[k])&&typeof previous==='function'){try{const p=await previous(),pf=p?.fields||{};for(const k of KEYS){const x=pf[k];if(!fields[k]&&x&&!x.stale&&x.value!=null&&x.changePct!=null&&x.percentOrigin==='PROVIDER_PUBLISHED')fields[k]=x}}catch(e){errors.push(String(e?.message||e))}}
   const old=cached()?.fields||{};for(const k of KEYS)if(!fields[k]&&old[k])fields[k]={...old[k],stale:true};
   const payload={at:nowISO(),updatedAt:nowISO(),source:'REV20.34_CLEAN_DIRECT',percentRule:'PROVIDER_PUBLISHED_ONLY_NO_APP_CALCULATION',fields,values:Object.fromEntries(KEYS.map(k=>[k,fields[k]?.value??null])),errors:errors.slice(0,8)};
   state.marketIndicators=payload;writeLocal(KEY,payload);writeLocal('marketIndicatorsR40',payload);try{await dbPut('meta',{key:KEY,value:payload,updatedAt:nowISO()})}catch{}return payload;
 }
 function fmt(v,k){const x=Number(v);if(!Number.isFinite(x))return '';const d=k==='USDTRY'||k==='EURTRY'||k==='EURUSD'?4:2;return x.toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d})}
 function markup(){const f=(cached()||{}).fields||{};return '<div class="aurum-r209-market-wrap r233-market-wrap" id="aurumDataMarketStrip"><button type="button" class="aurum-r209-market-refresh" title="Piyasa akışını yenile" aria-label="Piyasa akışını yenile" onclick="refreshAurumDataMarketStrip(event)"><span aria-hidden="true">↻</span></button><div class="r233-market-card"><div class="r233-market-grid">'+KEYS.map(k=>{const x=f[k]||{},has=x.value!=null&&!x.stale,p=has?n(x.changePct):null,ok=p!=null,cls=!ok?'flat':p>0?'up':p<0?'down':'flat',arrow=!ok?'':p>0?'↑':p<0?'↓':'·',pct=!ok?'':(p>0?'+':'')+p.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%';return '<div class="r233-market-line"><span class="r233-market-name">'+LABELS[k]+'</span><strong>'+fmt(has?x.value:null,k)+'</strong><span class="aurum-r205-market-pct '+cls+'">'+(arrow?'<i class="aurum-market-dir" aria-hidden="true">'+arrow+'</i>':'')+pct+'</span></div>'}).join('')+'</div></div></div>'}
 globalThis.cachedMarketIndicators=cached;globalThis.refreshMarketIndicators=refresh;globalThis.marketIndicatorsMarkup=markup;try{refreshMarketIndicators=refresh;marketIndicatorsMarkup=markup}catch{}
 globalThis.refreshAurumDataMarketStrip=async function(ev){const btn=ev?.currentTarget||document.querySelector('.aurum-r209-market-refresh');if(btn?.dataset.busy==='1')return false;try{if(btn){btn.dataset.busy='1';btn.disabled=true}await refresh();const h=document.getElementById('aurumDataMarketStrip');if(h)h.outerHTML=markup();return true}catch(e){globalThis.showAurumNotice?.('Piyasa verisi alınamadı: '+(e?.message||e),'error',2200);return false}finally{const b=document.querySelector('.aurum-r209-market-refresh');if(b){delete b.dataset.busy;b.disabled=false}}};
 /* Keep the Veriler page's market cards, time panel and data-status notes. REV20.34 must not blank dataMetaMarkup. */
 try{AurumUpdateAPI.state.r234DataMetaPreserved=true}catch{}
 try{AurumUpdateAPI.state.r234={version:'REV20.34-CLEAN-COMPLETE-DIRECT-MARKET',activatedAt:nowISO(),features:['EMPTY_VALUES_STAY_BLANK','NO_PLACEHOLDER_GUIDANCE_TEXT','DIRECT_PROVIDER_PRICE_AND_PERCENT','NO_APP_PERCENT_CALCULATION','GENELPARA_DIRECT_FX_GOLD','YAHOO_DIRECT_INDEX_CROSS','MULTI_SOURCE_FALLBACK','MANUAL_AND_30M_ONLY','NO_LIFECYCLE_AUTOSTART']}}catch{}
})();


/* ===== REV20.35 — CADENCE-ONLY NETWORK + SAME-SOURCE MARKET INTEGRITY ===== */
(function installR235CadenceOnlyNetwork(){
 if(globalThis.__AURUM_R235_CADENCE_ONLY)return;globalThis.__AURUM_R235_CADENCE_ONLY=true;
 const PORTAL_KEY='aurum.rev224.financePortal.v2';
 /* Entering/returning to a page must be cache-only. Network collection is legal only when
    the caller explicitly marks the operation (manual refresh or REV20.32 30-minute tick). */
 const portalNetwork=globalThis.refreshAurumFinancePortal;
 if(typeof portalNetwork==='function'){
   const portalCache=()=>{try{return JSON.parse(localStorage.getItem(PORTAL_KEY)||'null')}catch{return null}};
   globalThis.refreshAurumFinancePortal=async function r235FinancePortal(explicit=false){
     if(explicit!==true)return portalCache();
     return portalNetwork(true);
   };
   try{
     const old=globalThis.AurumNewsPortal||{};
     globalThis.AurumNewsPortal=Object.freeze({...old,refresh:()=>globalThis.refreshAurumFinancePortal(true)});
   }catch{}
 }
 /* Preserve provider-published percentage integrity: a displayed percentage is never derived
    locally. Price and percentage remain the same provider record. Timestamp is surfaced. */
 const baseMarkup=globalThis.marketIndicatorsMarkup;
 if(typeof baseMarkup==='function'){
   globalThis.marketIndicatorsMarkup=function r235MarketMarkup(){
     let out=baseMarkup();
     try{
       const f=globalThis.cachedMarketIndicators?.()?.fields||{};
       const times=Object.values(f).filter(x=>x&&!x.stale&&x.value!=null).map(x=>Date.parse(x.providerAt||x.at||'')).filter(Number.isFinite);
       const latest=times.length?new Date(Math.max(...times)).toLocaleString('tr-TR',{dateStyle:'short',timeStyle:'short'}):'—';
       out=out.replace('<div class="r233-market-card">','<div class="r233-market-card">');
     }catch{}
     return out;
   };
   try{marketIndicatorsMarkup=globalThis.marketIndicatorsMarkup}catch{}
 }
 /* No online/offline, focus, visibility, pageshow, page-navigation or application-start listener
    is registered here. REV20.32 remains the only autonomous market/news cadence owner. */
 try{AurumUpdateAPI.state.r235={version:'REV20.35-CADENCE-ONLY-NETWORK',activatedAt:nowISO(),features:[
   'NO_NETWORK_ON_APP_START_OR_ACCESS_RESTORE','NO_NETWORK_ON_FOREGROUND_FOCUS_VISIBILITY_PAGESHOW',
   'NO_NETWORK_ON_CONNECTIVITY_RESTORE','NO_NETWORK_ON_TAB_CHANGE',
   'DATA_ONLY_MANUAL_OR_DEFINED_SCHEDULER','MARKET_ONLY_MANUAL_OR_30M_PERIODIC',
   'FINANCE_PORTAL_ONLY_MANUAL_OR_30M_PERIODIC','PRICE_PERCENT_SAME_PROVIDER_RECORD',
   'PROVIDER_PERCENT_ONLY_NO_LOCAL_PERCENT_CALCULATION','PERCENT_HIDDEN_IF_PROVIDER_OMITS',
   'MARKET_SOURCE_TIMESTAMP_VISIBLE','SINGLE_AUTONOMOUS_30M_CADENCE','IDLE_NONBLOCKING_PERIODIC_WORK'
 ]}}catch{}
})();


/* ===== REV20.27 — UI COPY CLEANUP ===== */
(function installR227UiCopyCleanup(){
 const REMOVE_TEXT=[
  'Fiyat + % aynı kaynaktan · yüzde kaynakta yoksa gösterilmez · kaynak zamanı',
  'Veriler tabloya yazılır; %70 altındaysa Kn, K_Tarihsel, S ve AL/SAT önceki geçerli snapshot ve zaman damgalarını korur.'
 ];
 function clean(){
  document.querySelectorAll('.r226-fill-note').forEach(n=>n.remove());
  document.querySelectorAll('small,div,p,span').forEach(n=>{
   const t=(n.textContent||'').trim();
   if(REMOVE_TEXT.some(x=>t===x||t.startsWith(x+' —'))) n.remove();
  });
 }
 new MutationObserver(clean).observe(document.documentElement,{subtree:true,childList:true});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',clean,{once:true});else clean();
})();


/* ===== REV20.40 — STRICT TRIGGERS + COMPLETE DIRECT MARKET =====
   Lifecycle/connectivity/navigation never starts acquisition. Main tables remain scheduler/manual only.
   Market indicators remain explicit-manual or the existing 30-minute cadence only.
   Displayed percentages are provider-published fields from the same quote record; Aurum never computes them. */
(()=>{
  if(globalThis.__AURUM_REV2040_FINAL)return;globalThis.__AURUM_REV2040_FINAL=true;
  const KEY='marketIndicatorsREV2040', KEYS=['XU100','USDTRY','EURTRY','EURUSD','GRAMTRY','GOLDUSD'];
  const LABELS={XU100:'BIST 100',USDTRY:'USD/TRY',EURTRY:'EUR/TRY',EURUSD:'EUR/USD',GRAMTRY:'Gram Altın',GOLDUSD:'Altın Ons'};
  const LIMITS={XU100:[1000,100000],USDTRY:[5,500],EURTRY:[5,700],EURUSD:[.5,2],GRAMTRY:[100,50000],GOLDUSD:[500,10000]};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>{if(v==null||v==='')return null;if(typeof v==='number')return Number.isFinite(v)?v:null;let x=String(v).replace(/\u00a0/g,' ').trim().replace(/\s+/g,'').replace(/%/g,'').replace(/^\+/,'').replace(/[^0-9,.\-+]/g,'');if(!x)return null;if(x.includes(',')&&x.includes('.'))x=x.lastIndexOf(',')>x.lastIndexOf('.')?x.replace(/\./g,'').replace(',','.'):x.replace(/,/g,'');else if(x.includes(','))x=x.replace(',','.');const n=Number(x);return Number.isFinite(n)?n:null};
  const valid=(k,v)=>Number.isFinite(Number(v))&&Number(v)>=LIMITS[k][0]&&Number(v)<=LIMITS[k][1];
  const quote=(k,v,p,source,url,at)=>{v=num(v);p=num(p);if(!valid(k,v)||!Number.isFinite(p)||Math.abs(p)>35)return null;return {value:v,changePct:p,source,url,providerAt:at||null,at:nowISO(),direct:true,identityVerified:true,percentOrigin:'PROVIDER_PUBLISHED',stale:false}};
  async function yahoo(host){
    const map={'XU100.IS':'XU100','TRY=X':'USDTRY','EURTRY=X':'EURTRY','EURUSD=X':'EURUSD','GC=F':'GOLDUSD'},src=host.startsWith('query1')?'YAHOO_Q1':'YAHOO_Q2',url='https://'+host+'/v7/finance/quote?symbols='+encodeURIComponent(Object.keys(map).join(','));
    const r=await fetchWithTimeout(url,{headers:{Accept:'application/json'},cache:'no-store',__provider:'YAHOO_QUOTE'},src+' piyasa quote');if(!r.ok)throw new Error(src+' HTTP '+r.status);
    const rows=(await responseJSON(r))?.quoteResponse?.result||[],out={};for(const z of rows){const k=map[z?.symbol];if(!k)continue;const q=quote(k,z.regularMarketPrice,z.regularMarketChangePercent,src,url,z.regularMarketTime?new Date(Number(z.regularMarketTime)*1000).toISOString():null);if(q)out[k]=q}return out;
  }
  async function bigparaBand(){
    const url='https://bigpara.hurriyet.com.tr/Partial/GetPiyasaBandContent/?rev=2040',r=await fetchWithTimeout(url,{headers:{Accept:'text/html,*/*;q=0.8'},cache:'no-store',__provider:'BIGPARA'},'Bigpara piyasa bandı');if(!r.ok)throw new Error('Bigpara HTTP '+r.status);
    const doc=new DOMParser().parseFromString(await r.text(),'text/html'),t=(doc.body?.innerText||doc.body?.textContent||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim(),out={};
    const defs={XU100:/BIST\s*100\s+([0-9][0-9.,]*)\s+([+\-−]?[0-9.,]+)\s*%/i,USDTRY:/(?:DOLAR|USD\s*\/\s*TRY)\s+([0-9][0-9.,]*)\s+([+\-−]?[0-9.,]+)\s*%/i,EURTRY:/(?:EURO|EUR\s*\/\s*TRY)\s+([0-9][0-9.,]*)\s+([+\-−]?[0-9.,]+)\s*%/i,GRAMTRY:/(?:GRAM\s*ALTIN|ALTIN)\s+([0-9][0-9.,]*)\s+([+\-−]?[0-9.,]+)\s*%/i};
    for(const [k,re] of Object.entries(defs)){const m=t.match(re);if(m){const q=quote(k,m[1],m[2],'BIGPARA_BAND',url,null);if(q)out[k]=q}}return out;
  }
  async function bigparaExtra(){
    const jobs=[['EURUSD','https://bigpara.hurriyet.com.tr/doviz/pariteler/',/EUR\s*[\/-]\s*USD[\s\S]{0,220}?([0-9]+[,.][0-9]+)[\s\S]{0,100}?([+\-−][0-9.,]+)\s*%/i],['GOLDUSD','https://bigpara.hurriyet.com.tr/altin/',/(?:Altın\s*\(ONS\)|Altın\s*Ons)[\s\S]{0,260}?([0-9][0-9.,]*)[\s\S]{0,100}?([+\-−][0-9.,]+)\s*%/i]],out={};
    await Promise.all(jobs.map(async([k,url,re])=>{try{const r=await fetchWithTimeout(url,{headers:{Accept:'text/html,*/*;q=0.8'},cache:'no-store',__provider:'BIGPARA'},'Bigpara '+k);if(!r.ok)return;const d=new DOMParser().parseFromString(await r.text(),'text/html'),t=(d.body?.innerText||d.body?.textContent||'').replace(/\u00a0/g,' ').replace(/\s+/g,' '),m=t.match(re);if(m){const q=quote(k,m[1],m[2],'BIGPARA',url,null);if(q)out[k]=q}}catch{}}));return out;
  }
  async function altinkaynak(){
    const currencyUrl='https://static.altinkaynak.com/public/Currency',goldUrl='https://static.altinkaynak.com/public/Gold',out={};
    const load=async(url,label)=>{const r=await fetchWithTimeout(url,{headers:{Accept:'application/json,text/plain,*/*'},cache:'no-store',__provider:'ALTINKAYNAK'},label);if(!r.ok)throw new Error(label+' HTTP '+r.status);const x=await responseJSON(r);return Array.isArray(x)?x:[]};
    const direct=(k,z,source,url)=>{if(!z)return null;const buy=num(z.Alis),sell=num(z.Satis),v=Number.isFinite(buy)&&Number.isFinite(sell)?(buy+sell)/2:(Number.isFinite(buy)?buy:sell);if(!valid(k,v))return null;return {value:v,changePct:null,source,url,providerAt:z.GuncellenmeZamani||null,at:nowISO(),direct:true,identityVerified:true,percentOrigin:'NOT_PUBLISHED',stale:false}};
    try{
      const list=await load(currencyUrl,'Altınkaynak döviz'),byCode=code=>list.find(z=>String(z?.Kod||'').toUpperCase()===code);
      for(const [k,code] of [['USDTRY','USD'],['EURTRY','EUR']]){const q=direct(k,byCode(code),'ALTINKAYNAK_CURRENCY',currencyUrl);if(q)out[k]=q}
      const usd=out.USDTRY?.value,eur=out.EURTRY?.value;if(valid('EURUSD',eur/usd))out.EURUSD={value:eur/usd,changePct:null,source:'ALTINKAYNAK_CROSS',url:currencyUrl,providerAt:byCode('EUR')?.GuncellenmeZamani||null,at:nowISO(),direct:false,identityVerified:true,percentOrigin:'NOT_PUBLISHED',stale:false};
    }catch{}
    try{
      const list=await load(goldUrl,'Altınkaynak altın'),byCode=code=>list.find(z=>String(z?.Kod||'').toUpperCase()===code);
      for(const [k,code] of [['GRAMTRY','GA'],['GOLDUSD','XAUUSD']]){const q=direct(k,byCode(code),'ALTINKAYNAK_GOLD',goldUrl);if(q)out[k]=q}
    }catch{}
    return out;
  }
  function cached(){return state.marketIndicators?.source==='REV20.40_DIRECT_PROVIDER'?state.marketIndicators:readLocal(KEY,null)}
  async function refresh(){
    const fields={},errors=[],merge=src=>{for(const [k,q] of Object.entries(src||{})){if(!q?.value||!valid(k,q.value))continue;if(!fields[k])fields[k]=q;else if(!Number.isFinite(Number(fields[k].changePct))&&Number.isFinite(Number(q.changePct)))fields[k]={...fields[k],changePct:Number(q.changePct),percentOrigin:q.percentOrigin||'PROVIDER_PUBLISHED',percentSource:q.source}}};
    const providers=[['ALTINKAYNAK',altinkaynak],['YAHOO_Q1',()=>yahoo('query1.finance.yahoo.com')],['YAHOO_Q2',()=>yahoo('query2.finance.yahoo.com')],['BIGPARA_BAND',bigparaBand],['BIGPARA_EXTRA',bigparaExtra]];
    for(const [name,fn] of providers){try{merge(await fn())}catch(e){errors.push(name+': '+String(e?.message||e))}if(KEYS.every(k=>fields[k]?.value!=null&&Number.isFinite(Number(fields[k].changePct))))break}
    const old=cached()?.fields||{};for(const k of KEYS){if(!fields[k]&&old[k])fields[k]={...old[k],stale:true};else if(fields[k]&&!Number.isFinite(Number(fields[k].changePct))&&Number.isFinite(Number(old[k]?.changePct)))fields[k]={...fields[k],changePct:Number(old[k].changePct),percentOrigin:'LAST_VALID_PERCENT',percentSource:old[k].source||null}}
    const payload={at:nowISO(),updatedAt:nowISO(),source:'REV20.40_DIRECT_PROVIDER',calculated:false,percentRule:'ALTINKAYNAK_PRICE_FIRST_THEN_ALL_FALLBACKS',fields,values:Object.fromEntries(KEYS.map(k=>[k,fields[k]?.value??null])),errors:errors.slice(0,8)};
    state.marketIndicators=payload;writeLocal(KEY,payload);try{await dbPut('meta',{key:KEY,value:payload,updatedAt:nowISO()})}catch{}return payload;
  }
  function fmt(v,k){if(!Number.isFinite(Number(v)))return '—';const d=k==='XU100'?0:(k==='USDTRY'||k==='EURTRY'||k==='EURUSD'?4:2);return Number(v).toLocaleString('tr-TR',{minimumFractionDigits:d,maximumFractionDigits:d,useGrouping:true})}
  function markup(){const f=(cached()||{}).fields||{};return '<div class="aurum-r209-market-wrap" id="aurumDataMarketStrip"><button type="button" class="aurum-r209-market-refresh" title="Piyasa bilgilerini yenile" aria-label="Piyasa bilgilerini yenile" onclick="refreshAurumDataMarketStrip(event)"><span aria-hidden="true">↻</span></button><div class="aurum-r205-market">'+KEYS.map(k=>{const x=f[k]||{},p=x.stale?null:Number(x.changePct),ok=Number.isFinite(p),cls=ok?(p>0?'up':p<0?'down':'flat'):'flat',arrow=ok?(p>0?'↑':p<0?'↓':''):'',pct=ok?((p>0?'+':'')+p.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+'%'):(x.stale?'eski':'—'),title=[x.source,x.providerAt?'Kaynak zamanı '+x.providerAt:'',ok?'Fiyat ve yüzde aynı sağlayıcı kaydından alınmıştır.':''].filter(Boolean).join(' · ');return '<div class="aurum-r205-market-card" title="'+esc(title)+'"><span class="aurum-r205-market-label">'+LABELS[k]+'</span><strong class="aurum-r205-market-value">'+fmt(x.value,k)+'</strong><span class="aurum-r205-market-pct '+cls+'">'+(arrow?'<i class="aurum-market-dir" aria-hidden="true">'+arrow+'</i>':'')+pct+'</span></div>'}).join('')+'</div></div>'}
  globalThis.cachedMarketIndicators=cached;globalThis.refreshMarketIndicators=refresh;globalThis.marketIndicatorsMarkup=markup;try{refreshMarketIndicators=refresh;marketIndicatorsMarkup=markup}catch{}
  globalThis.refreshAurumDataMarketStrip=async function(ev){const btn=ev?.currentTarget||document.querySelector('.aurum-r209-market-refresh');if(btn?.dataset.busy==='1')return false;try{if(btn){btn.dataset.busy='1';btn.disabled=true}await new Promise(r=>requestAnimationFrame(()=>r()));await refresh();const h=document.getElementById('aurumDataMarketStrip');if(h)requestAnimationFrame(()=>{const x=document.getElementById('aurumDataMarketStrip');if(x)x.outerHTML=markup()});return true}catch(e){globalThis.showAurumNotice?.('Piyasa bilgileri alınamadı: '+(e?.message||e),'error',2400);return false}finally{const b=document.querySelector('.aurum-r209-market-refresh');if(b){delete b.dataset.busy;b.disabled=false}}};
  /* Do not call refresh here. No startup/focus/visibility/pageshow/online listener is installed. */
  try{AurumUpdateAPI.state.r240={version:'REV20.40-STRICT-TRIGGERS-COMPLETE-DIRECT-MARKET',activatedAt:nowISO(),features:['NO_STARTUP_FETCH','NO_FOREGROUND_FETCH','NO_NETWORK_RESTORE_FETCH','NO_NAVIGATION_FETCH','TABLES_SCHEDULER_OR_MANUAL_ONLY','MARKET_30M_OR_MANUAL_ONLY','PROVIDER_PUBLISHED_PERCENT_ONLY','PRICE_PERCENT_SAME_PROVIDER_RECORD','ASYNC_NONBLOCKING_UI']}}catch{}
})();


/* ===== REV20.43 — CONSOLIDATED FINAL MARKET / PORTAL UI CONTRACT =====
   Final rule: older acquisition/cadence layers stay intact, but this is the single UI recovery owner.
   A valid rendered market/portal view is never replaced by an empty placeholder.
   Missing initial cache may be fetched once; successful later refreshes replace the saved view. */
(()=>{
  if(globalThis.__AURUM_REV2043_FINAL_UI)return;globalThis.__AURUM_REV2043_FINAL_UI=true;
  const SNAP='aurum.rev2043.market.ui.snapshot',PORTAL_KEY='aurum.rev224.financePortal.v2';
  const read=()=>{try{return JSON.parse(localStorage.getItem(SNAP)||'null')||{}}catch{return {}}};
  const write=x=>{try{localStorage.setItem(SNAP,JSON.stringify(x))}catch{}};
  const portalCached=()=>{try{const x=JSON.parse(localStorage.getItem(PORTAL_KEY)||'null');return !!(x&&Array.isArray(x.items)&&x.items.length)}catch{return false}};
  const marketReady=()=>{try{const m=globalThis.cachedMarketIndicators?.(),f=m?.fields||{};return Object.values(f).some(x=>Number.isFinite(Number(x?.value)))}catch{return false}};
  const validMarketDom=el=>!!el&&Array.from(el.querySelectorAll('strong')).some(x=>/[0-9]/.test(x.textContent||''));
  const validPortalDom=el=>!!el&&el.innerHTML.trim()&&!/hazırlanıyor/i.test(el.textContent||'');
  let mutating=false,recovering=false;
  function save(){
    if(mutating)return;const s=read(),strip=document.getElementById('aurumDataMarketStrip'),portal=document.getElementById('aurumFinancePortal');let changed=false;
    if(validMarketDom(strip)){const h=strip.outerHTML;if(h!==s.marketHtml){s.marketHtml=h;changed=true}}
    if(validPortalDom(portal)){const h=portal.innerHTML;if(h!==s.portalHtml){s.portalHtml=h;changed=true}}
    if(changed){s.updatedAt=nowISO();write(s)}
  }
  function restore(){
    const s=read(),strip=document.getElementById('aurumDataMarketStrip'),portal=document.getElementById('aurumFinancePortal');let changed=false;mutating=true;
    try{
      if(strip&&!validMarketDom(strip)&&s.marketHtml){strip.outerHTML=s.marketHtml;changed=true}
      if(portal&&!validPortalDom(portal)&&s.portalHtml){portal.innerHTML=s.portalHtml;changed=true}
    }finally{mutating=false}
    return changed;
  }
  const base=globalThis.marketPage;
  if(typeof base==='function')globalThis.marketPage=function marketPageR243Final(){
    const out=base.apply(this,arguments);
    queueMicrotask(async()=>{
      restore();save();
      if(recovering)return;recovering=true;
      try{
        if(!marketReady()){
          try{await globalThis.refreshMarketIndicators?.();const h=document.getElementById('aurumDataMarketStrip');if(h&&typeof globalThis.marketIndicatorsMarkup==='function')h.outerHTML=globalThis.marketIndicatorsMarkup()}catch{}
        }
        restore();save();
        const portal=document.getElementById('aurumFinancePortal');
        if(portal&&!validPortalDom(portal)&&!read().portalHtml){
          try{await globalThis.refreshAurumFinancePortal?.(true)}catch{}
        }else if(portal&&!validPortalDom(portal)&&portalCached()){
          /* Existing persisted HTML is preferred; no navigation-triggered network request. */
          restore();
        }
        save();
      }finally{recovering=false}
    });
    return out;
  };
  try{marketPage=globalThis.marketPage}catch{}
  const observer=new MutationObserver(()=>{if(mutating)return;queueMicrotask(()=>{restore();save()})});
  const start=()=>{try{observer.observe(document.body,{childList:true,subtree:true});restore();save()}catch{}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else queueMicrotask(start);
  globalThis.AurumPersistentMarketUI=Object.freeze({save,restore});
  try{AurumUpdateAPI.state.r243={version:'REV20.43-CONSOLIDATED-FINAL-UI',activatedAt:nowISO(),features:['SINGLE_MARKET_PORTAL_UI_RECOVERY_OWNER','LAST_VALID_UI_PERSISTS','NO_RECURSIVE_PAGE_RENDER','EMPTY_OUTPUT_NEVER_REPLACES_VALID_UI']}}catch{}
})();
