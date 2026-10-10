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
