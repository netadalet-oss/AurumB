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
