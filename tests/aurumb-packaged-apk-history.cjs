'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const cp=require('node:child_process');
const path='app/build/outputs/apk/debug/app-debug.apk';
assert.ok(fs.existsSync(path),'debug APK must exist before checking bundled assets');
const packed=cp.execFileSync('unzip',['-p',path,'assets/runtime.js'],{encoding:'utf8',maxBuffer:4*1024*1024});
const source=fs.readFileSync('app/src/main/assets/runtime.js','utf8');
assert.equal(packed,source,'APK must package the latest approved runtime, not a stale asset');
const start=packed.indexOf('(function installAurumHistoryGapFill(){');
const end=packed.indexOf('\n})();',start);
assert.ok(start>=0&&end>start,'packaged manual T1-T30 module is required');
const state={syncing:false,calculating:false,khArchive:{rows:[{date:'2026-10-08',archiveOrigin:'AUTO',marker:'immutable'}]}};
const ctx={state,setTimeout,Promise,
  historyPage:()=>'<button>K_Tarihsel’i Çalıştır</button>',
  calculationRecords:()=>[{sym:'TEST'}],
  kh117ArchiveState:()=>state.khArchive,
  kh117T0:()=>({date:'2026-10-09'}),
  kh117CanonicalMarketCalendar:()=>({dates:['2026-10-06','2026-10-07','2026-10-08','2026-10-09']}),
  kh117CloneValue:x=>structuredClone(x),
  kh117PitRowForAnchor:date=>({ok:true,row:{date}}),
  kh117ValidateArchive:a=>({ok:true,rows:a.rows}),
  kh117PersistArchive:async()=>{},
  renderCurrentPagePreservingView:()=>{},
  showAurumNotice:()=>{},
  nowISO:()=>new Date('2026-10-10T12:00:00Z').toISOString()
};
vm.runInNewContext(packed.slice(start,end+5),ctx);
for(const n of [1,5,10]){
  assert.ok(ctx.historyPage().includes(n+' Gün Yükle'),'packaged '+n+'-day button missing');
  assert.ok(ctx.historyPage().includes('AurumHistoryGapFill.fill('+n+')'),'button '+n+' not connected');
}
(async()=>{
  assert.equal(await ctx.AurumHistoryGapFill.fill(1),1);
  assert.equal(state.khArchive.rows.find(r=>r.archiveOrigin==='AUTO').marker,'immutable');
  assert.ok(state.khArchive.rows.some(r=>r.date==='2026-10-07'&&r.archiveOrigin==='MANUAL'));
  const count=state.khArchive.rows.length;
  ctx.calculationRecords=()=>[];
  await assert.rejects(ctx.AurumHistoryGapFill.fill(5),/Veriler bölümündeki doğrulanmış veri doluluğu %70 üstüne/);
  assert.equal(state.khArchive.rows.length,count,'no-data request may not mutate archive');
  console.log('PASS bundled APK source parity, visible 1/5/10 controls, immutable auto PIT, fail-closed empty data');
})().catch(e=>{console.error(e);process.exitCode=1});
