import fs from 'node:fs';

const read = p => fs.readFileSync(p,'utf8');
const runtime = read('app/src/main/assets/runtime.js');
const market = read('app/src/main/assets/market-rebuilt.js');
const trigger = read('app/src/main/assets/trigger-contract.js');
const scheduler = read('app/src/main/assets/scheduler-settings.js');
const manifest = read('app/src/main/AndroidManifest.xml');
const gradle = read('app/build.gradle');
const service = read('app/src/main/java/com/aurum/bistterminal8/PipelineService.kt');
const activity = read('app/src/main/java/com/aurum/bistterminal8/MainActivity.kt');
const lock = read('app/src/main/java/com/aurum/bistterminal8/PipelineOperationLock.kt');
const http = read('app/src/main/java/com/aurum/bistterminal8/NativeMarketHttp.kt');
const keepalive = read('app/src/main/assets/background-keepalive-only.js');

const results=[];
function test(name, fn){
  try{ fn(); results.push({name,status:'PASS'}); }
  catch(e){ results.push({name,status:'FAIL',detail:e.message}); }
}
function must(hay, needle, msg=needle){ if(!hay.includes(needle)) throw new Error(msg); }
function mustNot(hay, needle, msg=needle){ if(hay.includes(needle)) throw new Error(msg); }

test('S1 atomic publish phases',()=>{
  for(const x of ["STAGING:'STAGING'","VALIDATING:'VALIDATING'","READY_TO_PUBLISH:'READY_TO_PUBLISH'","atomicPublish(job,universe)"]) must(runtime,x);
});
test('S2 network wait preserves snapshot',()=>{
  must(runtime,"JOB_STATUS.WAITING_FOR_NETWORK");
  must(runtime,"Ağ bağlantısı bekleniyor");
  must(runtime,"DATA_FILL_BELOW_70_KEEP_LAST_VALID_SNAPSHOT");
  must(runtime,"önceki tablo korundu");
  must(runtime,"async function clearTableScope","record clearing must remain an explicit user-management path");
});
test('S3 provider failure isolated/retry aware',()=>{
  must(runtime,'providerConcurrencyLimit');
  must(runtime,'rateLimitedUntil');
  must(runtime,'retry');
});
test('S4 unknown percentage is not zero',()=>{
  must(market,"(ok?");
  must(market,":'—'");
  mustNot(market,"changePct??0","unknown percent coerced to zero");
});
test('S5 repair targets missing subset',()=>{
  must(runtime,'prepareMissingData');
  must(runtime,'missing');
  must(runtime,'R221_SMART_MAX_ROUNDS=5');
});
test('S6 below 70 cannot publish',()=>{
  must(runtime,'DATA_FILL_BELOW_70_KEEP_LAST_VALID_SNAPSHOT');
  must(runtime,'if(!candidateGate.ok)throw');
  const finalPub=runtime.indexOf('globalThis.atomicPublish=atomicPublish=async function r55AtomicPublish');
  if(finalPub<0)throw new Error('final publisher override missing');
  const finalSlice=runtime.slice(finalPub, runtime.indexOf('/* Repair publication',finalPub));
  must(finalSlice,'DATA_FILL_BELOW_70_KEEP_LAST_VALID_SNAPSHOT','final publisher override bypasses 70% gate');
  must(finalSlice,'HARD_CANCELLED_JOBS','final publisher override is not cancellation-safe');
  must(finalSlice,"code:'OPERATION_CANCELLED'",'final publisher override lacks cancellation terminal');
  must(runtime,'RETAIN_ONLY_NO_PARTIAL_ACTIVE_PUBLISH');
  const orphanStart=runtime.indexOf('async function recoverOrphanStagingRecords(){');
  const orphanEnd=runtime.indexOf('async function atomicPublish(job,universe){',orphanStart);
  const orphan=runtime.slice(orphanStart,orphanEnd);
  mustNot(orphan,"objectStore('records')",'orphan staging may not write active records');
  const localStart=runtime.indexOf('async function repairLegacyCorruptRecordsLocal(){');
  const localEnd=runtime.indexOf('const REPAIR_QUEUE_KEY',localStart);
  const local=runtime.slice(localStart,localEnd);
  must(local,"transaction(['records','meta'],'readwrite')",'local repair must publish full snapshot atomically');
  must(local,'sourceSnapshotId','local repair must create traceable successor snapshot');
});
test('S7 wake lock bounded and released',()=>{
  must(manifest,'android.permission.WAKE_LOCK');
  must(service,'acquireTransferWakeLock()');
  must(service,'releaseTransferWakeLock()');
  must(keepalive,'AurumTransferKeepalive');
});
test('S8 duplicate jobs serialized',()=>{
  must(lock,'@Synchronized');
  must(activity,'"job_lock_acquire"');
  must(service,'PipelineOperationLock.acquire');
  must(runtime,'job_lock_acquire');
});
test('S9 scheduled data isolated',()=>{
  must(trigger,"pipeline==='market'");
  must(service,'"SCHEDULED_DATA"');
  mustNot(runtime,"refreshMarket('DATA_COMMAND')","data pipeline still chains market");
});
test('S10 scheduled market isolated',()=>{
  must(trigger,'AurumStrictMarketRuntime');
  must(trigger,'AurumNLPortal.refresh(true)');
  must(service,'"SCHEDULED_MARKET"');
});
test('S11 boot rearm declared',()=>{
  must(manifest,'android.intent.action.BOOT_COMPLETED');
  must(manifest,'android.permission.RECEIVE_BOOT_COMPLETED');
});
test('S12 exact alarm degrades safely',()=>{
  must(manifest,'android.permission.SCHEDULE_EXACT_ALARM');
  must(activity,'"schedule_exact_settings"');
  must(read('app/src/main/java/com/aurum/bistterminal8/AurumScheduler.kt'),'setAndAllowWhileIdle');
});
test('S13 last valid market retained',()=>{
  must(market,'stale:true');
  must(market,'lastAttemptAt');
  must(market,'sourceTimestamp');
});
test('S14 news failure independent',()=>{
  must(trigger,'Promise.allSettled');
  must(trigger,'financePortal');
});
test('S15 in-place identity/migration guards',()=>{
  must(gradle,"applicationId 'com.aurum.nextrevised09'");
  must(gradle,'versionCode 123');
  must(scheduler,'dualScheduleMigrated.v1');
  must(scheduler,'aurum.b.scheduler.model.v13');
});

test('Native HTTP security contract',()=>{
  must(http,'url.protocol.equals("https"');
  must(http,'allowedHosts');
  must(http,'CANCELLED');
  must(http,'TIMEOUT');
  must(http,'DNS');
  must(http,'active.remove(id)');
});
test('Source time distinct from receive time',()=>{
  must(market,'sourceTimestamp');
  must(market,'receivedAt');
  must(runtime,'CANONICAL_MARKET_TIME_UNAVAILABLE');
});
test('No autonomous interval loop in effective runtime',()=>{
  mustNot(runtime,'setInterval(');
});
test('Manifest background security',()=>{
  must(manifest,'android:exported="false"');
  must(manifest,'android.permission.FOREGROUND_SERVICE_DATA_SYNC');
});

const fail=results.filter(x=>x.status==='FAIL');
for(const r of results) console.log((r.status==='PASS'?'PASS':'FAIL')+' | '+r.name+(r.detail?' | '+r.detail:''));
if(fail.length){ console.error('\n'+fail.length+' acceptance contract(s) failed'); process.exit(1); }
console.log('\nALL SOURCE-LEVEL ACCEPTANCE CONTRACTS PASSED');
