'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app/src/main/assets/runtime.js','utf8');
const start=source.indexOf('(function installAurumHistoryGapFill(){');
const end=source.indexOf('\n})();',start);
assert.ok(start>=0&&end>start,'AurumB requirement 05 module exists');
assert.equal(source.indexOf('(function installAurumHistoryGapFill(){',start+1),-1,'Only one module');
const code=source.slice(start,end+5);
const originalAuto={date:'2026-10-08',archiveOrigin:'AUTO',marker:'immutable'};
const state={syncing:false,calculating:false,khArchive:{rows:[structuredClone(originalAuto)]}};
const ctx={
  state,console,setTimeout,Promise,
  historyPage:()=>'<button>K_Tarihsel’i Çalıştır</button>',
  calculationRecords:()=>[{symbol:'TEST'}],
  kh117ArchiveState:()=>state.khArchive,
  kh117T0:()=>({date:'2026-10-09'}),
  kh117CanonicalMarketCalendar:()=>({dates:['2026-10-06','2026-10-07','2026-10-08','2026-10-09']}),
  kh117CloneValue:x=>structuredClone(x),
  kh117PitRowForAnchor:date=>({ok:true,row:{date,marker:'calculated'}}),
  kh117ValidateArchive:archive=>({ok:true,rows:archive.rows}),
  kh117PersistArchive:async()=>{},
  renderCurrentPagePreservingView:()=>{},
  showAurumNotice:()=>{},
  nowISO:()=>new Date('2026-10-10T10:00:00Z').toISOString()
};
vm.runInNewContext(code,ctx,{timeout:5000});
assert.equal(ctx.AurumHistoryGapFill.available(1),1,'first missing verified date planned');
assert.ok(ctx.historyPage().includes('AurumHistoryGapFill.fill(30)'), '1/5/10/30 UI present');
for(const days of [1,5,10,30])assert.ok(ctx.historyPage().includes(days+' Gün'),
  'Manual history day button '+days+' must be visible by name');
(async()=>{
  assert.equal(await ctx.AurumHistoryGapFill.fill(1),1);
  assert.deepEqual(state.khArchive.rows.find(r=>r.date==='2026-10-08'),originalAuto,
    'existing automatic archive remains byte-for-byte equal');
  assert.equal(state.khArchive.rows.find(r=>r.date==='2026-10-07').archiveOrigin,'MANUAL');
  assert.equal(state.khArchive.rows.length,2);
  const saved=structuredClone(state.khArchive);
  ctx.kh117PitRowForAnchor=()=>({ok:false,reason:'NO_SOURCE'});
  await assert.rejects(ctx.AurumHistoryGapFill.fill(10),/doldurulamadı/);
  assert.deepEqual(state.khArchive,saved,'failed fill rolls back without changing archive');
  await assert.rejects(ctx.AurumHistoryGapFill.fill(4),/Yalnız 1, 5, 10 veya 30/);
  // A full 30-record archive can include stale T31 data while recent T1-T30
  // sessions are missing. Never claim there are zero gaps or delete originals.
  const fullArchive=Array.from({length:30},(_,i)=>({
    date:'2026-08-'+String(i+1).padStart(2,'0'),archiveOrigin:'AUTO',marker:i
  }));
  state.khArchive={rows:structuredClone(fullArchive)};
  assert.equal(ctx.AurumHistoryGapFill.available(1),0,'immutable full archive has no insertion capacity');
  await assert.rejects(ctx.AurumHistoryGapFill.fill(1),/arşiv 30 kayıtla dolu/);
  assert.deepEqual(state.khArchive.rows,fullArchive,
    'capacity denial preserves every existing automatic record');
  state.khArchive={rows:structuredClone([originalAuto])};
  ctx.calculationRecords=()=>[];
  await assert.rejects(ctx.AurumHistoryGapFill.fill(1),/Veriler bölümündeki doğrulanmış veri doluluğu %70 üstüne/,
    'zero-source data must explain why PIT cannot run');
  assert.deepEqual(state.khArchive.rows,[originalAuto],
    'no-data PIT cannot mutate existing verified historical records');
  console.log('PASS manual T1-T30 plan; automatic archive precedence; rollback; UI; valid options');
})().catch(e=>{console.error(e);process.exitCode=1});

/* Requirement 13 + archive parity: ranking must use actual Reel intersection
 * arithmetic mean rather than hit count; manual history origin must survive
 * value-only sealing until an official automatic T0 record supersedes it. */
{
 const t0=source.match(/^function kh117T0\(\)\{.*$/m)?.[0]||'';
 const run=source.match(/^function kh117RunRow\(run\)\{.*$/m)?.[0]||'';
 assert.ok(t0.includes('(b.hitCount/Math.max(1,b.total))-(a.hitCount/Math.max(1,a.total))'),
   'T0 K historical trend must sort first by hit average');
 assert.ok(run.includes('(b.hitCount/Math.max(1,b.total))-(a.hitCount/Math.max(1,a.total))'),
   'frozen session trend must sort first by hit average');
 assert.ok(source.includes('realAvg:mean(list.map(x=>x.dayReturn))'),
   'all observed next-session returns in each K list count toward Reel mean');
 assert.ok(source.includes('const realVals=criteria[k].filter(x=>x.realHit===true)'),
   'next-session evaluation must ignore non-Reel values');
 assert.ok(source.includes('manualFill:row?.manualFill===true'),
   'manual archive provenance must survive value-only serialization');
 assert.ok(source.includes('if(sameDateIndex>=0&&a.rows[sameDateIndex]?.manualFill===true)'),
   'official automatic T0 must supersede only a manual placeholder');
 assert.ok(source.includes('!changes.some(concern)'),
   'unrelated DOM mutations should not cause market portal redraws');
 console.log('PASS B PIT source provenance, verified arithmetic mean and scroll observer');
}


/* Android locale and T0 truthfulness regressions from 2026-10-11 device evidence. */
{
 const start=source.indexOf('function kh117ExpectedAdjacentSession(date,dir=1){');
 const end=source.indexOf('\n}',start);
 assert.ok(start>=0&&end>start,'next-session calendar helper must exist');
 const dateApi=source.slice(start,end+2);
 const badIntlDate=class extends Date {
   toLocaleDateString(){return '10/12/2026';}
 };
 const calendar={
   Date:badIntlDate,Map,
   kh117OfficialSession2026:d=>!['2026-10-10','2026-10-11','2026-10-29'].includes(d)
 };
 vm.runInNewContext(dateApi,calendar,{timeout:1000});
 assert.equal(calendar.kh117ExpectedAdjacentSession('2026-10-09',1),'2026-10-12',
   'Friday close must match Monday even when WebView returns US-formatted dates');
 assert.equal(calendar.kh117ExpectedAdjacentSession('2026-10-12',-1),'2026-10-09',
   'Monday previous real trading session must be Friday');
 assert.ok(source.includes('e?.currentReturn!=null'),
   'missing Kn ledger return must never become a fabricated +0.00%');
 assert.ok(source.includes('const reelTotal=reelMeans.every(v=>v!==null)?mean(reelMeans):null'),
   'Trend Reel footer must average all verified individual Kn cell means');
 assert.ok(source.includes('a.length===20?mean(a.map(x=>x.ret??x.dayReturn??x.realReturn)):null'),
   'unavailable Reel Top20 must never be rendered as +0.00%');
 console.log('PASS Android deterministic next-session date, T0 missing-value and Trend footer parity');
}
