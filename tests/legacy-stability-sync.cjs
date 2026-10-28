'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const read=f=>fs.readFileSync(f,'utf8'),R=read('app/src/main/assets/runtime.js'),A=read('app/src/main/java/com/aurum/bistterminal8/MainActivity.kt'),P=read('app/src/main/java/com/aurum/bistterminal8/PipelineService.kt'),G=read('app/build.gradle');
for(const [src,needle,desc] of [
 [R,'const V141225_PAGE_SIZE=24;','24 Legacy rows'],[R,'const V141225_COLUMN_PAGE_SIZE=18;','18 Legacy data columns'],
 [R,'function v141225ColumnPager(){','column pager'],[R,'globalThis.changeV141225ColumnPage=function','column navigation'],
 [R,"aurum.legacy.lastDataAttempt.v1",'separate attempt status'],[R,"nativeComplete('',false,'NO_PENDING_SLOT')",'scheduler failure'],
 [R,'nav.dataset.aurumNavBound','tabs bound before IndexedDB'],[A,'onRenderProcessGone','Legacy foreground renderer'],
 [P,'WEBVIEW_RENDERER_GONE','Legacy background renderer'],[G,"applicationId 'com.aurum.nextrevised09'",'unchanged Legacy package'],
 [G,'versionCode 123','unchanged Legacy installer version']
])assert(src.includes(needle),desc);
assert(!R.includes('const V141225_PAGE_SIZE=200;'));
assert(!R.includes("nativeComplete('',true,'NO_PENDING_SLOT')"));
assert(!fs.existsSync('app/build.gradle.kts'),'Do not introduce Android canonical build tree');
console.log('AurumB Legacy stability transfer contract OK');
