'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root='app/src/main/assets/';
const r=fs.readFileSync(root+'runtime.js','utf8'),core=fs.readFileSync(root+'core.js','utf8');
const sch=fs.readFileSync(root+'scheduler-settings.js','utf8'),nl=fs.readFileSync(root+'netherlands-news-portal.js','utf8');
const a=r.indexOf('  async function purgeBlockedUniverse({reason="USER"}={}){');
const b=r.indexOf('  async function addBlocked(raw){',a),ban=r.slice(a,b);
assert.ok(a>0&&b>a,'Reversible ban implementation');
for(const name of ['txDeleteWhere(','txRewriteRuns(','purgeMeta(','purgeRawDB(','purgeKnLocalLedger(','purgeSymbol?.('])
  assert.ok(!ban.includes(name),'Ban must not erase user records: '+name);
assert.ok(r.includes("if(!globalThis.AurumBlockedUniverse?.has?.(sym)&&!set.has(sym))"),
  'Blocked stock must not be sold merely because it leaves the active universe');
assert.ok(core.includes('function aurumImportantLog(')&&core.includes('state.logs=importantLogs.slice(0,20)'),
  'Retain at most 20 important logs on startup');
assert.ok(core.includes('table.delete(row.id)'),'Remove excess persisted IndexedDB log entries');
assert.ok(sch.includes('Date.parse(x.at)>=cutoff).slice(-20)'),'Persisted settings history max 20');
assert.ok(sch.includes("st[kind+'Enabled']===enabled(kind)"),'Check saved native Android schedule');
assert.ok(sch.includes('aurum-scheduler-group'),'Compact work report');
assert.ok(sch.includes('r44RepairCenter'),'Unified maintenance entry');
const ctx={console,Date,Promise,URL,localStorage:{getItem:()=>null,setItem:()=>{}},
 document:{querySelectorAll:()=>[],querySelector:()=>({style:{}}),
 getElementById:()=>({style:{},innerHTML:''})},
 marketPage:()=>'<section class="r207-portal-wrap r222-unified-portal">Türkiye</section>'};
ctx.globalThis=ctx;
vm.runInNewContext(nl,ctx,{timeout:1500});ctx.AurumNLPortal.show('NL');
assert.match(ctx.marketPage(),/aurum-country-tab active" data-country="NL"/);
console.log('PASS AurumB 15-revision preservation, logs, scheduler, Nederland and blocked universe guards');

// Native PendingIntent reality check supplements saved schedule state.
{const fs=require('node:fs'),assert=require('node:assert/strict');
 const k=fs.readFileSync('app/src/main/java/com/aurum/bistterminal8/AurumScheduler.kt','utf8');
 const s=fs.readFileSync('app/src/main/assets/scheduler-settings.js','utf8');
 assert.ok(k.includes('json.put(kind + "Registered", registered(context, kind))'));
 assert.ok(k.includes('PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE'));
 assert.ok(s.includes("(st[kind+'Enabled']!==true || st[kind+'Registered']===true)"));
}


// Isolated execution of the actual Joker decision function.  A saved
// maximum is NOT proof of the timestamp at which that tier was reached.
{
 const start=r.indexOf('function jokerExitReason(e,sym,lastPrice){');
 const end=r.indexOf('  function tradeFmt(',start);
 assert.ok(start>=0&&end>start,'Joker decision must remain discoverable');
 const scope={
   Date,EPS:1e-9,observed:'2026-10-09T08:00:00Z',
   marketAt(){return this.observed;},
   trp(){return {date:'2026-10-09',mins:660};},
   fullHoliday(){return false;},
   bistSessionCloseMinutes(){return 1080;},
   completedSessionBoundaries(){return {opens:0,closes:0}}
 };
 // A normal function avoids dependence on the this-binding of marketAt.
 scope.marketAt=()=>scope.observed;scope.globalThis=scope;
 vm.runInNewContext(r.slice(start,end),scope,{timeout:1000});
 const position={buyPrice:100,buyAt:'2026-10-05T07:30:00Z',
   buyMarketAt:'2026-10-05T07:30:00Z',
   maxReturnPct:10.5,profitStagePct:0,profitStageReachedAt:null};
 assert.equal(scope.jokerExitReason(position,'TEST',101),null);
 assert.equal(position.profitStageReachedAt,null,
   'An inherited 10% high must not fabricate a crossing at a 1% market quote');
 scope.observed='2026-10-09T08:01:00Z';
 assert.equal(scope.jokerExitReason(position,'TEST',110.5),null);
 assert.equal(position.profitStagePct,10);
 assert.equal(position.profitStageReachedAt,scope.observed,
   'Actual quote must establish the 10% crossing timestamp');
 scope.observed='2026-10-14T08:01:00Z';
 scope.completedSessionBoundaries=()=>({opens:3,closes:2});
 assert.equal(scope.jokerExitReason(position,'TEST',110),'JOKER_KAR_KADEMESI');
 console.log('PASS standalone B Joker: no invented historical crossing, actual quote clock');
}


/* 15/09: distinct securities/prices must not collapse into one 20-log record. */
{
 const settingsSource=fs.readFileSync('app/src/main/assets/scheduler-settings.js','utf8');
 const fp=settingsSource.match(/function historyFingerprint\(type,message\)\{[\s\S]*?\n \}/)?.[0];
 assert.ok(fp,'history fingerprint implementation required');
 const context={historyType:t=>String(t).toLowerCase()};
 vm.runInNewContext(fp,context,{timeout:1200});
 const a=context.historyFingerprint('error','AL/SAT ASELS 12.34');
 const b=context.historyFingerprint('error','AL/SAT TUPRS 12.34');
 const c=context.historyFingerprint('error','AL/SAT ASELS 12.35');
 assert.notEqual(a,b,'distinct ticker alerts must remain separate');
 assert.notEqual(a,c,'distinct trade prices must remain separate');
 assert.equal(context.historyFingerprint('error','  AL/SAT  ASELS 12.34 '),a,
   'whitespace-only duplicates may still be grouped');
}


/* 12/15: standalone B must exclude a 70%-filled row and low-fill columns
 * from calculations without mutating the original Veriler source records. */
{
 const start=r.indexOf('function classifyDataCompleteness(');
 const end=r.indexOf('function dataSummary(',start);
 const calcStart=r.indexOf('function calculationRecords()');
 const calcEnd=r.indexOf('globalThis.calculationRecords=calculationRecords;',calcStart);
 assert.ok(start>=0&&end>start&&calcStart>=0&&calcEnd>calcStart,
   'standalone completeness gate and derived clone function must exist');
 const fields=Array.from({length:10},(_,i)=>'X'+i);
 const records=[7,8].map((n,i)=>{
   const row={sym:i?'R80':'R70',jobDataStatus:'FRESH',marketWindowEligible:true};
   fields.forEach((k,j)=>{row[k]=j<n?j+100:null;});
   return row;
 });
 const scope={
   state:{records,settings:{}},V141225_ALL_HEADERS:['Hisse',...fields],
   currentSymbols:()=>records.map(x=>x.sym),
   v141225ValuePresent:(rec,field)=>field==='Hisse'?true:rec[field]!==null&&rec[field]!==undefined,
   v141225Raw:(rec,field)=>rec[field],
   vRecordCompleteness:()=>100,
   v141225NumericZero:()=>false,
   calculationGateStatus:()=>({gate:{ok:true}}),
   cloneForCalculation:rec=>JSON.parse(JSON.stringify(rec)),
   normalizeCalculationRecord:rec=>rec,
   maskIncompleteColumn:(rec,key)=>{rec[key]=null}
 };
 scope.globalThis=scope;
 vm.runInNewContext(r.slice(start,end)+'\n'+r.slice(calcStart,calcEnd),scope,{timeout:2000});
 const classified=scope.classifyDataCompleteness();
 assert.equal(classified.bySymbol.get('R70').eligible,false,'70% row must remain Veriler-only');
 assert.equal(classified.bySymbol.get('R80').eligible,true,'80% row can enter calculations');
 assert.ok(classified.below70Columns.includes('X7'),'half-filled column excluded globally');
 const result=scope.calculationRecords();
 assert.equal(result.length,1);
 assert.equal(result[0].sym,'R80');
 assert.equal(result[0].X7,null,'half-filled source column masked only on derived clone');
 assert.equal(records[1].X7,107,'original persisted source record must not be modified');
 assert.ok(result[0].calculationExcludedFields.includes('X7'));
 console.log('PASS standalone B quality: 70% row excluded, 80% row eligible, immutable Veriler');
}


/* Verified 12/15 calculation isolation: historical/adjusted bars are removed
 * only from the cloned calculation input, both before and after normalization. */
{
 const src=fs.readFileSync('app/src/main/assets/runtime.js','utf8');
 const maskStart=src.indexOf('function maskIncompleteColumn(');
 const maskEnd=src.indexOf('function repairCriticalFundamentals(',maskStart);
 const calcStart=src.indexOf('function calculationRecords()');
 const calcEnd=src.indexOf('globalThis.calculationRecords=calculationRecords;',calcStart);
 assert.ok(maskStart>=0&&maskEnd>maskStart&&calcStart>=0&&calcEnd>calcStart);
 const scope={};
 vm.runInNewContext(src.slice(maskStart,maskEnd),scope,{timeout:1000});
 const source={price:30,series:{date:['D1','D2','D3'],
   close:[10,20,30],calcClose:[11,21,31]}};
 const row=JSON.parse(JSON.stringify(source));
 scope.maskIncompleteColumn(row,'Kapanis_T1');
 assert.equal(row.series.close[1],null);
 assert.equal(row.series.calcClose[1],null,
   'disqualified old close may not survive as adjusted series');
 scope.maskIncompleteColumn(row,'Kapanis_T0');
 assert.equal(row.series.close[2],null);
 assert.equal(row.series.calcClose[2],null);
 assert.equal(row.price,null);
 assert.equal(source.series.calcClose[1],21,
   'original Veriler adjusted-price bar must remain untouched');
 const calc=src.slice(calcStart,calcEnd);
 const first=calc.indexOf('maskIncompleteColumn(rec,field)');
 const normalize=calc.indexOf('normalizeCalculationRecord(rec)');
 const second=calc.lastIndexOf('maskIncompleteColumn(rec,field)');
 assert.ok(first>=0&&first<normalize&&normalize<second,
   'no forbidden value may enter normalization or survive reconstruction');
 console.log('PASS B price-mask regression: old/T0 prices, adjusted close, no source mutation');
}

/* Regression: audit summaries must expose both the masked fields and their
 * pre-normalization coverage percentages to preserve 70% gate observability. */
{
 const source=fs.readFileSync('app/src/main/assets/runtime.js','utf8');
 assert.ok(source.includes('below70Columns:classification.below70Columns'),
   'audit must identify columns excluded from derived calculations');
 assert.ok(source.includes('columnCompletionPct:classification.columnCompletionPct'),
   'audit must retain original column coverage for user-visible diagnostics');
 console.log('PASS B completeness audit reports excluded fields and coverage');
}


/* Regression: cached R61 page slots must show all manual gap controls. */
{
 const source=r;
 const start=source.indexOf('  function gapToolbar(){',source.indexOf('(function installAurumHistoryGapFill(){'));
 const end=source.indexOf('  const prev=globalThis.historyPage||historyPage;',start);
 assert.ok(start>=0&&end>start,'standalone gap toolbar renderer must exist');
 const script=source.slice(start,end);
 for(const busy of [false,true]){
   const html=vm.runInNewContext(script+'\ngapToolbar()', {state:{syncing:busy,calculating:false}}, {timeout:1000});
   assert.equal((html.match(/<button\b/g)||[]).length,4,'must expose exactly four gap buttons');
   for(const n of [1,5,10,30]){
     assert.ok(html.includes('>'+n+' Gün</button>'),'missing manual '+n+' day control');
     assert.ok(html.includes('AurumHistoryGapFill.fill('+n+')'),'gap action must be wired');
   }
   assert.equal((html.match(/\bdisabled\b/g)||[]).length,busy?4:0,'busy state must disable every action');
 }
 assert.ok(source.includes('new MutationObserver(ensureHistoryGapControls)'), 'cached WebView page slots need a live DOM repair hook');
 assert.ok(source.includes("mini.insertAdjacentHTML('beforebegin',gapToolbar())"), 'cached history slot must gain controls without destroying other page DOM');
 const mock='K_Tarihsel’i Çalıştır<div class="aurum-mini-ops" data-mini-scope="history">Baştan başlat · Eksikleri tamamla</div>';
 const sandbox={
   state:{syncing:false,calculating:false,page:'history'},
   historyPage:()=>mock, globalThis:{}
 };
 const wrapped=source.slice(source.indexOf('  function gapToolbar(){',source.indexOf('(function installAurumHistoryGapFill(){')),source.indexOf('  if(typeof document!==',start));
 vm.runInNewContext(wrapped,sandbox,{timeout:1000});
 const rendered=sandbox.historyPage();
 assert.ok(rendered.indexOf('K_Tarihsel’i Çalıştır')>=0);
 assert.ok(rendered.indexOf('K_Tarihsel’i Çalıştır')<rendered.indexOf('aurum-khist-gap-actions'));
 assert.ok(rendered.indexOf('aurum-khist-gap-actions')<rendered.indexOf('Baştan başlat'),
   'four day controls must be between Run and Restart');
 assert.ok(rendered.includes('grid-template-columns:repeat(4,minmax(0,1fr))!important'),
   'four buttons must fit on one row even with older WebView CSS');
 assert.ok(!rendered.includes('Gün Yükle'),'button labels must not contain Yükle');
 console.log('PASS AurumB K_Tarihsel 1/5/10/30 controls visible on cached page slots');
}

assert.ok(r.includes('const remaining=last30.filter(d=>!keptAfter.has(d)).length;')&&
  r.includes("'Doldurulan: '")&&r.includes("' gün · Kalan: '"),
  'manual T1–T30 history must report filled and remaining session counts');


/* Responsive 30-day action and actual backup UI, without false Native claims. */
{
 const source=r;
 assert.ok(source.includes('const counts=new Set([1,5,10,30]);'));
 const start=source.indexOf('function aurumBackupSettingsModule(){');
 const end=source.indexOf('\nfunction restorePointsModule(){',start);
 assert.ok(start>=0&&end>start,'settings must declare backup section');
 const markup=vm.runInNewContext(source.slice(start,end)+
   '\naurumBackupSettingsModule()',{
     aurumSettingsCard:(title,subtitle,body,id)=>JSON.stringify({title,subtitle,body,id})
   },{timeout:1000});
 const card=JSON.parse(markup);
 assert.equal(card.title,'Yedekleme ve Geri Yükleme');
 assert.equal(card.id,'aurumEncryptedLegacyBackup');
 for(const action of ['AurumLegacyTransfer.inspect()','AurumLegacyTransfer.exportEncrypted()',
                       'AurumLegacyTransfer.restoreEncrypted()'])
   assert.ok(card.body.includes(action),'missing backup action: '+action);
 assert.ok(card.subtitle.includes('Native/Room')&&card.body.includes('TAM UYGULAMA YEDEĞİ'),
   'Legacy export must not be represented as a complete device backup');
 assert.ok(source.includes('aurumBackupSettingsModule()}'),'backup must be inserted into settings page');
 for(const required of ["FORMAT='AURUMB_ENCRYPTED_LEGACY_V1'","ITERATIONS=210000",
     "crypto.subtle.encrypt({name:'AES-GCM',iv}","crypto.subtle.decrypt(",
     "snapshotDatabase()","snapshotStorage()","validateDatabase(payload.indexedDb)",
     "createRestorePoint('LEGACY_YEDEK_GERİ_YÜKLEME_ÖNCESİ'"])
   assert.ok(source.includes(required),'encrypted Legacy transfer missing '+required);
 console.log('PASS AurumB encrypted Legacy backup UI, safety disclosure and 30-day option');
}



// Verified NEXT-session signal/return contract: list means include every
// observed Kn symbol, not just symbols that intersect the Reel Top20.
{
 const runtimeText=r;
 assert.ok(runtimeText.includes("r._accuracyStatus=verified?'OK':'ERTESİ_SEANS_VERİSİ_BEKLENİYOR'"),
   'T0 and missing d+1 must not be treated as realized returns');
 assert.ok(runtimeText.includes('realObservedCount:verified?measured.length:0'),
   'Kn Reel mean must count all observed symbols, including non-hits');
 assert.ok(runtimeText.includes('realAvg:verified&&measured.length?mean(measured):null'),
   'Kn Reel mean must use the full verified list, not just Top20 intersection');
 assert.ok(runtimeText.includes("Number.isFinite(v.hitCount)&&v.total>0?v.hitCount/v.total:-Infinity"),
   'Kn Trend sorting must use verified hit ratios');
}
