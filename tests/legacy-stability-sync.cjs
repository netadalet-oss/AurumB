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


// Behavioral regression: the real Legacy renderer must keep the identity/time
// fields visible across every column group, even for the full 484-column model.
const srcStart=R.indexOf('function v141225VisibleHeaders(){');
const srcEnd=R.indexOf('function v141225ColumnPager(){',srcStart);
assert(srcStart>=0&&srcEnd>srcStart,'extractable Legacy column paging function');
const headers=['Hisse','VeriZamani',...Array.from({length:484},(_,i)=>'metric_'+i)];
const tableLogic=new Function('headers',`
 let V141225_COLUMN_PAGE_INDEX=0;
 const V141225_COLUMN_PAGE_SIZE=18,V141225_ALL_HEADERS=headers;
 ${R.slice(srcStart,srcEnd)}
 return {visible:()=>v141225VisibleHeaders(),set:(n)=>{V141225_COLUMN_PAGE_INDEX=n}};
`)(headers);
for(const page of [0,1,5,26,999]){
 tableLogic.set(page);const visible=tableLogic.visible();
 assert(visible.length<=20,'wide table must not mount all columns');
 assert.equal(visible[0],'Hisse','stock code must remain pinned');
 assert.equal(visible[1],'VeriZamani','verified market timestamp must remain pinned');
}
tableLogic.set(0);assert.equal(tableLogic.visible().length,20);
tableLogic.set(999);assert.equal(tableLogic.visible().length,18); // 484 mod 18 = 16 metrics + 2 pinned


const mainActivity=fs.readFileSync('app/src/main/java/com/aurum/bistterminal8/MainActivity.kt','utf8');
assert(mainActivity.includes('rendererLost || webView.parent == null) return@runOnUiThread'),'late NativeMarketHttp/AI callbacks must not evaluate on a lost renderer');
assert(mainActivity.includes('!rendererLost && webView.parent != null && webView.canGoBack()'),'back stack must not access destroyed WebView');
assert(mainActivity.includes('!rendererLost && webView.parent != null) webView.saveState(outState)'),'do not persist destroyed renderer state');
assert(mainActivity.includes('if (::webView.isInitialized && !rendererLost && webView.parent != null)'),'AI-key callback guarded by renderer availability');

console.log('AurumB Legacy stability transfer contract OK');
