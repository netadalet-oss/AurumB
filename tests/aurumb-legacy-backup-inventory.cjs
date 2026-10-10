'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const runtime=fs.readFileSync('app/src/main/assets/runtime.js','utf8');
const mark='(function installAurumLegacyBackupInventory(){';
const where=runtime.lastIndexOf(mark);
assert.ok(where>=0,'Inventory installer must exist');
const code=runtime.slice(where);
const names=['records','meta','settings','runs','logs','aiAudits','genomeHistory',
  'portfolioTransactions','learningHistory'];
const values=Object.fromEntries(names.map((name,i)=>[name,i+2]));
let reads=0,writes=0;
const database={
  name:'aurumb-user',version:24,objectStoreNames:names,
  transaction(list,mode) {
    assert.equal(mode,'readonly','inventory must not create a write transaction');
    assert.deepEqual([...list].sort(),[...names].sort());
    const tx={
      objectStore(name){
        return {
          count(){
            reads++;
            const request={};
            queueMicrotask(()=>{
              request.result=values[name];
              request.onsuccess?.();
              if(reads===names.length)queueMicrotask(()=>tx.oncomplete?.());
            });
            return request;
          },
          put(){writes++}
        };
      }
    };
    return tx;
  }
};
const keys=['aurum.qualified-buy-sell.v2','aurum.ui.dataScheduleTimes',
  'aurum.ui.marketScheduleTimes','aurum.storage.customKey'];
let readValues=0;
const storage={length:keys.length,key:index=>keys[index],getItem(){readValues++;throw Error('raw local storage must not be read')}};
const context=vm.createContext({
  state:{db:database},localStorage:storage,queueMicrotask,Date,Error
});
vm.runInContext(code,context);
(async()=>{
  const inv=await context.AurumLegacyBackupInventory.inspect();
  assert.equal(inv.schema,'AURUMB_LEGACY_BACKUP_INVENTORY_V1');
  assert.equal(inv.database,'aurumb-user');
  assert.equal(inv.databaseVersion,24);
  assert.equal(inv.indexedDbStores.length,names.length);
  assert.equal(inv.localStorageKeyCount,4);
  assert.equal(inv.localStorageKeys.length,4);
  assert.equal(inv.missingRequiredStores.length,0);
  assert.equal(inv.readyForCompleteBackup,false,
    'Do not claim complete Native+Legacy archive before atomic bridge exists');
  assert.equal(inv.reason,'LEGACY_TO_NATIVE_ATOMIC_BACKUP_AND_RESTORE_NOT_CONNECTED');
  assert.equal(reads,names.length,'All stores counted, including new ones');
  assert.equal(writes,0,'Read-only audit must never mutate an owner');
  assert.equal(readValues,0,'Secret-bearing localStorage values are never read');
  context.state.db=null;
  await assert.rejects(context.AurumLegacyBackupInventory.inspect(),
    /LEGACY_BACKUP_DB_NOT_READY/);
  console.log('PASS all-store inventory, key-only localStorage, no data mutation or false full-backup claim');
})().catch(e=>{console.error(e);process.exitCode=1});
