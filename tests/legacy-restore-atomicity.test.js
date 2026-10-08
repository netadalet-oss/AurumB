'use strict';
// Execute the real rollback functions with an in-memory IndexedDB transaction model.
const fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {TextEncoder}=require('node:util');
const assert=require('node:assert/strict');
const source=fs.readFileSync('app/src/main/assets/runtime.js','utf8');
const start=source.indexOf("const R44_RESTORE_INDEX_KEY=");
const end=source.indexOf("async function clearFromSettings(",start);
assert(start>0&&end>start,'restore engine extraction');
const restoreCode=source.slice(start,end);
const resetStart=source.indexOf('async function resetApplicationR44(){',end);
const resetEnd=source.indexOf('function restorePointsModule()',resetStart);
assert(resetStart>end&&resetEnd>resetStart,'reset engine extraction');
const resetCode=source.slice(resetStart,resetEnd);
assert.match(resetCode,/state\.db\.transaction\(names,'readwrite'\)/);
assert.match(resetCode,/startsWith\('restorePoint:'\)/);
assert.match(restoreCode,/crypto\.subtle\.digest\('SHA-256'/);
assert.match(restoreCode,/state\.db\.transaction\(names,'readwrite'\)/);
assert.match(restoreCode,/tx\.abort\(\)/);
assert.match(restoreCode,/const snapshots=new Map\(\)/);
const clone=v=>JSON.parse(JSON.stringify(v));
const names=['settings','records','runs','meta','bars','actions','criteria','backtests','snapshots','behaviorProfiles','genomeHistory','aiAudits','aiCandidates','aiEvents','sourceHealth','universeHistory'];
const values=new Map(names.map(name=>[name,[]]));
values.set('settings',[{key:'strategy',value:'original'}]);
values.set('records',[{key:'AAA',value:{price:10}}]);
values.set('meta',[{key:'status',value:'original'}]);
const local=new Map();
let failPutStore=null;
const state={db:{
  objectStoreNames:{contains:name=>values.has(name)},
  transaction(storeNames,mode){
    assert.equal(mode,'readwrite');
    const staged=new Map(storeNames.map(n=>[n,clone(values.get(n))]));
    let aborted=false;
    const tx={
      oncomplete:null,onabort:null,onerror:null,error:null,
      objectStore(name){
        assert(staged.has(name));
        return {
          clear(){staged.set(name,[])},
          put(row){
            if(name===failPutStore)throw Error('SIMULATED_WRITE_FAILURE');
            const rows=staged.get(name),ix=rows.findIndex(x=>x.key===row.key);
            if(ix>=0)rows[ix]=clone(row);else rows.push(clone(row));
          }
        };
      },
      abort(){aborted=true;queueMicrotask(()=>tx.onabort?.())}
    };
    queueMicrotask(()=>{
      if(aborted)return;
      for(const [n,rows] of staged)values.set(n,rows);
      tx.oncomplete?.();
    });
    return tx;
  }
}};
const ctx={
  state,TextEncoder,crypto:webcrypto,console,Promise,Date,Math,
  setTimeout:(fn,delay)=>{},location:{reload:()=>{}},
  localStorage:{removeItem:key=>local.delete(key)},RUNTIME_META_KEY:'legacy-runtime-key',
  nowISO:()=>new Date().toISOString(),
  confirm:()=>true,showAurumNotice:()=>{},
  readLocal:(key,fallback)=>local.has(key)?clone(local.get(key)):fallback,
  writeLocal:(key,value)=>{local.set(key,clone(value));return true},
  dbAll:async name=>clone(values.get(name)),
  dbGet:async(name,key)=>clone(values.get(name).find(r=>r.key===key)||null),
  dbPut:async(name,row)=>{const arr=values.get(name),ix=arr.findIndex(x=>x.key===row.key);if(ix>=0)arr[ix]=clone(row);else arr.push(clone(row))},
  dbDelete:async(name,key)=>values.set(name,values.get(name).filter(r=>r.key!==key)),
  AURUM_RUNTIME_VERSION:'LEGACY-TEST'
};
vm.runInNewContext(restoreCode+resetCode+'\n;globalThis.testEngine={createRestorePoint,restoreRestorePoint,r44RestoreIndex,resetApplicationR44}',ctx);
const {createRestorePoint,restoreRestorePoint,resetApplicationR44,r44RestoreIndex}=ctx.testEngine;
(async()=>{
  const original=await createRestorePoint('TEST',{skipConfirm:true});
  assert.equal(original.stored.length,names.length);
  assert(original.stored.every(x=>/^[0-9a-f]{64}$/.test(x.sha256)));
  values.set('settings',[{key:'strategy',value:'changed'}]);
  values.set('records',[{key:'AAA',value:{price:999}}]);
  await restoreRestorePoint(original.id);
  assert.equal(values.get('settings')[0].value,'original');
  assert.equal(values.get('records')[0].value.price,10);
  assert(values.get('meta').some(r=>r.key==='restorePoint:'+original.id+':manifest'),'restore checkpoint retained');
  const saved=clone(values.get('meta').find(r=>r.key==='restorePoint:'+original.id+':records'));
  values.get('meta').find(r=>r.key===saved.key).value[0].value.price=9999;
  values.set('records',[{key:'AAA',value:{price:73}}]);
  await assert.rejects(()=>restoreRestorePoint(original.id),/bütünlük/);
  assert.equal(values.get('records')[0].value.price,73,'tampered backup never modifies state');
  const ix=values.get('meta').findIndex(r=>r.key===saved.key);values.get('meta')[ix]=saved;
  failPutStore='records';
  await assert.rejects(()=>restoreRestorePoint(original.id),/SIMULATED_WRITE_FAILURE/);
  assert.equal(values.get('records')[0].value.price,73,'transaction abort leaves current records intact');
  failPutStore=null;
  failPutStore='meta';
  await assert.rejects(()=>resetApplicationR44(),/SIMULATED_WRITE_FAILURE/);
  assert.equal(values.get('records')[0].value.price,73,'failed reset must abort all stores');
  failPutStore=null;
  await resetApplicationR44();
  assert.equal(values.get('records').length,0,'reset clears active records');
  assert.equal(values.get('settings').length,0,'reset clears settings');
  const safety=r44RestoreIndex()[0];
  assert(safety?.id,'pre-reset recovery checkpoint survives');
  assert(values.get('meta').some(r=>r.key==='restorePoint:'+safety.id+':manifest'),'reset must preserve rollback blobs');
  await restoreRestorePoint(safety.id);
  assert.equal(values.get('records')[0].value.price,73,'rollback after reset recovers active rows');
  console.log('PASS Legacy restore/reset: SHA-256 integrity, prefetch, atomic commits, checkpoint retention, tamper and failure rollback');
})().catch(e=>{console.error(e);process.exitCode=1});
