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
