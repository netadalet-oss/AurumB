'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const read=f=>fs.readFileSync(f,'utf8'),R=read('app/src/main/assets/runtime.js'),A=read('app/src/main/java/com/aurum/bistterminal8/MainActivity.kt'),P=read('app/src/main/java/com/aurum/bistterminal8/PipelineService.kt'),G=read('app/build.gradle');
for(const [src,needle,desc] of [
 [R,'const V141225_PAGE_SIZE=24;','24 Legacy rows'],[R,'const V141225_COLUMN_PAGE_SIZE=18;','18 Legacy data columns'],
 [R,'function v141225ColumnPager(){','column pager'],[R,'globalThis.changeV141225ColumnPage=function','column navigation'],
 [R,"aurum.lastDataAttempt.v1",'separate attempt status'],[R,"nativeComplete('',false,'NO_PENDING_SLOT')",'scheduler failure'],
 [R,'nav.dataset.aurumNavBound','tabs bound before IndexedDB'],[A,'onRenderProcessGone','Legacy foreground renderer'],
 [P,'WEBVIEW_RENDERER_GONE','Legacy background renderer'],
 [P,'WEBVIEW_UNSUPPORTED_CHROMIUM','fail incompatible scheduled runtime'],
 [A,'WebView.getCurrentWebViewPackage()','check Legacy Chromium before UI JS'],
 [A,'AurumB Legacy verileri silinmedi','non-destructive compatibility notice'],
 [G,"applicationId 'com.aurum.nextrevised09'",'unchanged Legacy package'],
 [G,'versionCode 123','unchanged Legacy installer version']
])assert(src.includes(needle),desc);
assert(!R.includes('const V141225_PAGE_SIZE=200;'));
assert(!R.includes("nativeComplete('',true,'NO_PENDING_SLOT')"));
assert(!fs.existsSync('app/build.gradle.kts'),'Do not introduce Android canonical build tree');

const ledger=read('app/src/main/java/com/aurum/bistterminal8/SchedulerLedger.kt');
assert(ledger.includes('if (prefs.contains(token)) return null'),'one native execution per scheduled alarm identity');
assert(ledger.includes('if (!prefs.edit().putString(token, record.toString()).commit()) return null'),'never run a scheduled job without durable ledger storage');
assert(ledger.includes('private fun reconcileLocked('),'stale RUNNING jobs are terminally reconciled');
assert(ledger.includes('STALE_RUNNING_RECONCILED'),'stale scheduler status must be inspectable');
assert(ledger.includes('if (record.optString("status") in terminal) return'),'a finished job must never be overwritten by callbacks');
assert(P.includes('activeToken?.let { SchedulerLedger.complete(this,it,"FAILED","SERVICE_DESTROYED_BEFORE_COMPLETION") }'),'service termination cannot strand a running scheduled job');

console.log('AurumB Legacy stability transfer contract OK');
