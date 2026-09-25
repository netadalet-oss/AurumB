'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const runtime = read('app/src/main/assets/runtime.js');
const core = read('app/src/main/assets/core.js');
const market = read('app/src/main/assets/market-indicators-revision.js');
const appearance = read('app/src/main/assets/rev20-customization.js');
const acceleration = read('app/src/main/assets/safe-transfer-acceleration.js');
const keepalive = read('app/src/main/assets/background-keepalive-only.js');
const nativeAI = read('app/src/main/assets/native-secure-ai.js');
const pipeline = read('app/src/main/java/com/aurum/bistterminal8/PipelineService.kt');

const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); };
const count = (s, re) => (s.match(re) || []).length;

ok(runtime.includes('__AURUM_FINAL_DATA_SAFETY'), 'final data safety layer missing');
ok(runtime.includes('DATA_FILL_BELOW_70_KEEP_LAST_VALID_SNAPSHOT'), '70% rejection contract missing');
ok(!/lastSuccessfulSync\s*=\s*nowISO\(\)/.test(runtime), 'successful timestamp can advance directly from wall clock');
ok(runtime.includes('Display-only legacy recovery: never mutate activeDataSnapshot outside a successful gated publish.'), 'snapshot display-only recovery guard missing');
ok(runtime.includes('DIRECT_RECORD_WRITE_DISABLED_USE_GATED_ATOMIC_PUBLISH'), 'legacy direct record writer is enabled');
const orphan = runtime.slice(runtime.indexOf('async function recoverOrphanStagingRecords'), runtime.indexOf('async function atomicPublish'));
ok(orphan.includes("transaction('stagingRecords','readwrite')") && !orphan.includes("transaction(['records") && orphan.includes('discarded:orphan.length'), 'orphan staging cleanup contract missing');

const repair = runtime.slice(runtime.indexOf('async function repairLegacyCorruptRecordsLocal'), runtime.indexOf('const REPAIR_QUEUE_KEY'));
ok(repair.includes('dataIntegrityGate'), 'legacy local repair is not gated');
ok(repair.includes("transaction(['records','meta'],'readwrite')"), 'legacy local repair is not atomic across records/meta');

const finalSafety = runtime.slice(runtime.indexOf('function finalCandidateGate'), runtime.indexOf('/* ===== REV20.27'));
ok(finalSafety.includes('dataIntegrityGate'), 'final publish gate missing');
ok(finalSafety.includes('globalThis.atomicPublish'), 'final atomic publish wrapper missing');
ok(finalSafety.includes("dbGet('meta','activeDataSnapshot')") && finalSafety.includes('const out=await publish(job,universe)'), 'final wrapper does not derive success from published snapshot');
ok(finalSafety.includes("key:'lastSuccessfulSync'"), 'successful timestamp update missing from final publish contract');

const importBlock = core.slice(core.indexOf('const importMap='), core.indexOf('showToast', core.indexOf('const importMap=')));
ok(importBlock.includes('AurumFinalDataSafety'), 'file import does not use final safety gate');
ok(importBlock.includes("transaction(['records','meta'],'readwrite')"), 'file import is not atomic across records/meta');

ok(runtime.includes("const knBeforeR34=calculateKn"), 'deterministic Kn wrapper missing');
ok(runtime.includes('applyHistoryToFrozenBase'), 'S frozen Kn/history input path missing');
ok(runtime.includes('__AURUM_REV222_CONTRACT'), 'R222 PIT contract missing');
ok(!/stagingRecords[\s\S]{0,500}calculate(?:Kn|S)\s*\(/.test(runtime), 'staging data is wired directly into Kn/S');

ok(count(market, /setInterval\s*\(/g) === 1, 'market indicator module must own exactly one interval');
ok(market.includes('30*60*1000') || market.includes('30 * 60 * 1000'), 'market interval is not 30 minutes');
ok(market.includes('refresh({force:true})'), 'manual market refresh does not use the shared refresh engine');
ok(market.includes("if(!f&&old[k])fields[k]={...old[k],stale:true}") && market.includes("else if(old.EURUSD)fields.EURUSD={...old.EURUSD,stale:true}") && market.includes("else if(old.GOLDUSD)fields.GOLDUSD={...old.GOLDUSD,stale:true}"), 'market failures do not preserve prior field values');

ok(runtime.includes("restorePoint:*") || runtime.includes("startsWith('restorePoint:')") || runtime.includes('startsWith("restorePoint:")'), 'restore point archive preservation marker missing');
const restoreBlock = runtime.slice(runtime.indexOf('async function restoreRestorePoint'), runtime.indexOf('async function clearFromSettings'));
ok(restoreBlock.includes("startsWith('restorePoint:')") && restoreBlock.includes("bulkPut(name,archive)"), 'restore flow does not preserve restorePoint archive');
const resetBlock = runtime.slice(runtime.indexOf('async function resetApplicationR44'), runtime.indexOf('function restorePointsModule'));
ok(resetBlock.includes("createRestorePoint('UYGULAMA_SIFIRLAMA_ÖNCESİ'") && resetBlock.includes("startsWith('restorePoint:')") && resetBlock.includes("bulkPut('meta',restoreArchive)"), 'full reset does not preserve pre-reset restore archive');

for (const token of ['İnce','Normal','Kalın','İtalik','data-r20-color-default']) ok(appearance.includes(token), 'appearance control missing: '+token);
ok(appearance.includes('data-r20-action="defaults"') && appearance.includes('Tümünü Varsayılana Döndür'), 'appearance reset-all control missing');

ok(!/(concurrency|wave|retries|provider|quality|atomicPublish)\s*=/.test(acceleration), 'safe transfer acceleration mutates transfer/data semantics');
ok(!/(concurrency|wave|retries|provider|quality|atomicPublish)\s*=/.test(keepalive), 'background keepalive mutates transfer/data semantics');
ok(nativeAI.includes("nativePrompt('openai_request'") && !/apiKey|authorization/i.test(nativeAI), 'web AI bridge exposes or handles API credentials');
const promptBlock = pipeline.slice(pipeline.indexOf('override fun onJsPrompt'), pipeline.indexOf('webViewClient = object'));
ok(promptBlock.includes('"http_request"') && promptBlock.includes('"http_cancel"') && promptBlock.includes('ERR:BACKGROUND_NATIVE_COMMAND_BLOCKED'), 'background WebView native bridge is broader than required HTTP commands');

for (const dead of ['fast-background-transfer.js','market-display-fix2.js','market-percent-portal-patch.js']) {
  ok(!fs.existsSync(path.join(root, 'app/src/main/assets', dead)), 'dead asset still present: '+dead);
}

if (failures.length) {
  console.error('Aurum static contract audit failed:');
  for (const f of failures) console.error(' - '+f);
  process.exit(1);
}
console.log('Aurum static contract audit passed.');
