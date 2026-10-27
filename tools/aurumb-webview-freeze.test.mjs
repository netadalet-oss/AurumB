import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const runtime=fs.readFileSync('app/src/main/assets/runtime.js','utf8');
const activity=fs.readFileSync('app/src/main/kotlin/com/aurum/bistterminal8/MainActivity.kt','utf8');
const pipeline=fs.readFileSync('app/src/main/kotlin/com/aurum/bistterminal8/PipelineService.kt','utf8');
const build=fs.readFileSync('app/build.gradle.kts','utf8');
const requirePart=(source,fragment,name)=>assert.ok(source.includes(fragment),name);

test('Veriler renders bounded pages with pinned identity and navigable column groups',()=>{
  requirePart(runtime,'const V141225_PAGE_SIZE=24;','24-row page cap');
  requirePart(runtime,'const V141225_COLUMN_PAGE_SIZE=18;','18-data-column cap');
  requirePart(runtime,'${v141225ColumnPager()}<div class="table-wrap','column pagination exposed');
  const start=runtime.indexOf('function v141225VisibleHeaders(){');
  const end=runtime.indexOf('function v141225PageRows(rows)',start);
  assert.ok(start>0&&end>start,'isolated pagination functions present');
  const code=runtime.slice(start,end);
  const headers=['Hisse','VeriZamani',...Array.from({length:47},(_,i)=>'F'+i)];
  const api=vm.runInNewContext(`let V141225_COLUMN_PAGE_INDEX=0; const V141225_COLUMN_PAGE_SIZE=18; const V141225_ALL_HEADERS=${JSON.stringify(headers)};
${code}
({read:()=>v141225VisibleHeaders(),pager:()=>v141225ColumnPager(),set:n=>{V141225_COLUMN_PAGE_INDEX=n}})`);
  assert.equal(api.read().length,20);
  assert.deepEqual(Array.from(api.read().slice(0,2)),['Hisse','VeriZamani']);
  assert.ok(api.pager().includes('Sütun grubu 1 / 3'));
  api.set(2);
  assert.equal(api.read().length,13);
  api.set(99);
  assert.equal(api.read().length,13,'out-of-range column page clamps');
});
test('navigation is bound ahead of IndexedDB initialization',()=>{
  const init=runtime.indexOf('async function bootstrapClean(){');
  const done=runtime.indexOf('async function recoverOnlyExistingOnStartup',init);
  const section=runtime.slice(init,done);
  assert.ok(section.indexOf("nav.addEventListener('click'")>=0,'nav handler present');
  assert.ok(section.indexOf("nav.addEventListener('click'")<section.indexOf('await loadState()'),'nav before state loading');
  requirePart(runtime,'c.dataset.page=page;c.className=', 'CSS state synchronized');
  requirePart(runtime,"if(page==='data'&&rootReady&&slots.has(page)&&operationBusyStatus", 'data DOM preserved during transfer');
});
test('scheduler errors and data timestamp provenance remain honest',()=>{
  requirePart(runtime,"nativeComplete('',false,'NO_PENDING_SLOT')",'missing slot failed');
  assert.ok(!runtime.includes("nativeComplete('',true,'NO_PENDING_SLOT')"),'missing slot must not succeed');
  requirePart(runtime,'aurum.lastDataAttempt.v1','separate last attempt record');
  requirePart(runtime,'DATA_FILL_BELOW_70_KEEP_LAST_VALID_SNAPSHOT','atomic quality barrier stays on');
});
test('foreground and background renderer exits preserve local data and terminate jobs',()=>{
  requirePart(activity,'override fun onRenderProcessGone','foreground renderer handler');
  requirePart(activity,'Verileri koruyarak yeniden aç','user initiated restart');
  requirePart(activity,'if (::webView.isInitialized && webView.parent != null) webView.saveState(outState)','do not save destroyed view');
  requirePart(pipeline,'override fun onRenderProcessGone','background renderer handler');
  requirePart(pipeline,'"FAILED", "WEBVIEW_RENDERER_GONE"','failure recorded');
  requirePart(pipeline,'"FAILED", "WEBVIEW_UNSUPPORTED_CHROMIUM"','unsupported headless renderer fails promptly');
  requirePart(pipeline,'releaseTransferWakeLock()','keepalive released');
  requirePart(pipeline,'OperationLock.release(lockKind, owner)','lock released');
  requirePart(build,'applicationId = "io.aurum.next.aurumb"','package remains same');
  requirePart(build,'versionCode = 4','update increments installed version');
  // These versions belong to different compatibility namespaces; existing .aurum overlays
  // must continue interpreting legacy minAppVersionCode/maxAppVersionCode against 123.
  requirePart(runtime,'const AURUM_APP_VERSION_CODE=123;','legacy runtime-overlay ABI unchanged');
  requirePart(runtime,'minAppVersionCode','runtime overlay compatibility remains active');
  requirePart(runtime,'maxAppVersionCode','runtime overlay compatibility remains active');
});
