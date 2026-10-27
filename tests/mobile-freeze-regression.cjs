'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = p => fs.readFileSync(p, 'utf8');
const runtime = read('app/src/main/assets/runtime.js');
const main = read('app/src/main/java/com/aurum/bistterminal8/MainActivity.kt');
const pipeline = read('app/src/main/java/com/aurum/bistterminal8/PipelineService.kt');
const gradle = read('app/build.gradle');

assert.match(runtime, /const V141225_PAGE_SIZE=24;/);
assert.match(runtime, /const V141225_COLUMN_PAGE_SIZE=18;/);
assert.match(runtime, /\$\{v141225ColumnPager\(\)\}<div class="table-wrap/);
assert.match(runtime, /nav\.addEventListener\('click',[\s\S]*?await nextPaint\(\)/);
assert.match(runtime, /if\(!BACKGROUND_SYNC\)render\(\)/);
assert.match(runtime, /c\.dataset\.page=page;c\.className=\x60page-\$\{page\}\x60/);
assert.match(runtime, /nativeComplete\('',false,'NO_PENDING_SLOT'\)/);
assert.doesNotMatch(runtime, /nativeComplete\('',true,'NO_PENDING_SLOT'\)/);
assert.match(runtime, /aurum\.lastDataAttempt\.v1/);
assert.match(runtime, /lastAttempt\.status==='FAILED'/);
assert.match(runtime, /DATA_FILL_BELOW_70_KEEP_LAST_VALID_SNAPSHOT/);
assert.match(runtime, /await atomicPublish\(job,universe\)/);

const anchor = 'function v141225VisibleHeaders(){';
const end = 'function v141225PageRows(';
const from = runtime.indexOf(anchor), to = runtime.indexOf(end, from);
assert.ok(from >= 0 && to > from);
const functions = runtime.slice(from, to);
const all = ['Hisse','VeriZamani',...Array.from({length:47},(_,i)=>'FIELD_'+i)];
const evaluator = vm.runInNewContext(
  `let V141225_COLUMN_PAGE_INDEX=0;const V141225_COLUMN_PAGE_SIZE=18;
   const V141225_ALL_HEADERS=${JSON.stringify(all)};
   ${functions}
   ({visible:()=>v141225VisibleHeaders(),pager:()=>v141225ColumnPager(),
     setIndex:n=>{V141225_COLUMN_PAGE_INDEX=n}})`
);
assert.equal(evaluator.visible().length, 20);
assert.deepEqual(Array.from(evaluator.visible().slice(0,2)), ['Hisse','VeriZamani']);
assert.match(evaluator.pager(), /Sütun grubu 1 \/ 3/);
evaluator.setIndex(2);
assert.equal(evaluator.visible().length, 13);
assert.match(evaluator.pager(), /Sütun grubu 3 \/ 3/);
evaluator.setIndex(99);
assert.equal(evaluator.visible().length, 13); // out-of-range page clamps, never loses identity

assert.match(main, /override fun onRenderProcessGone\(/);
assert.match(main, /rendererLost = true/);
assert.match(main, /setContentView\(layout\)/);
assert.match(main, /putBoolean\("aurum\.rendererLost", rendererLost\)/);
assert.match(main, /if \(::webView\.isInitialized && !rendererLost\)/);
assert.match(pipeline, /override fun onRenderProcessGone\(/);
assert.match(pipeline, /"FAILED", "WEBVIEW_RENDERER_GONE"/);
assert.match(pipeline, /releaseTransferWakeLock\(\)/);
assert.match(pipeline, /OperationLock\.release/);
assert.match(gradle, /applicationId 'com\.aurum\.nextrevised09'/);
assert.match(gradle, /versionCode 124/);
assert.match(runtime, /const AURUM_APP_VERSION_CODE=124/);

console.log('Mobile freeze regression contracts passed (memory window, nav, renderer loss, scheduler and persistence).');
