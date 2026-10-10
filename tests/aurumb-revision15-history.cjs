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
assert.ok(ctx.historyPage().includes('AurumHistoryGapFill.fill(10)'), '1/5/10 UI present');
for(const days of [1,5,10])assert.ok(ctx.historyPage().includes(days+' Gün Yükle'),
  'Manual history load button '+days+' must be visible by name');
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
  await assert.rejects(ctx.AurumHistoryGapFill.fill(4),/Yalnız 1, 5 veya 10/);
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
