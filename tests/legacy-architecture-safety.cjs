'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(p,'utf8'), root='app/src/main/assets';
const gradle=read('app/build.gradle'),html=read(root+'/index.html');
assert(gradle.includes("applicationId 'com.aurum.nextrevised09'"),'Legacy applicationId must be unchanged');
assert(/versionCode\s+123\b/.test(gradle),'Legacy versionCode must remain 123');
assert(!fs.existsSync('app/build.gradle.kts'),'must not replace Groovy with cleanroom Kotlin Gradle');
assert(!fs.existsSync('app/src/main/kotlin/io/aurum'),'must not inject canonical cleanroom Room/host');
assert(fs.existsSync('app/src/main/java/com/aurum/bistterminal8/MainActivity.kt'),'Legacy native host path must remain');
assert(fs.existsSync('app/src/main/java/com/aurum/bistterminal8/PipelineService.kt'),'Legacy scheduler host must remain');
assert(!fs.existsSync(root+'/native-room-sync.js'),'canonical Room mirror needs a native backend unavailable in Legacy');
assert(!html.includes('<script src="native-room-sync.js"'),'never load canonical Room bridge without a Legacy Room backend');
assert(html.includes('Content-Security-Policy'),'WebView must retain CSP');
for(const [,source] of html.matchAll(/<script\s+src="([^"]+)"/g)){
  if(/^https?:\/\//.test(source))continue;
  const file=source.split('?')[0];
  assert(fs.existsSync(path.join(root,file)), 'missing Legacy script: '+file);
}
for(const [,source] of html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)){
  if(/^https?:\/\//.test(source))continue;
  const file=source.split('?')[0];
  assert(fs.existsSync(path.join(root,file)), 'missing Legacy stylesheet: '+file);
}
const act=read('app/src/main/java/com/aurum/bistterminal8/MainActivity.kt');
const pipeline=read('app/src/main/java/com/aurum/bistterminal8/PipelineService.kt');
assert(act.includes('addJavascriptInterface('),'Legacy native JS bridge must still be present');
assert(act.includes('WebView.getCurrentWebViewPackage()'),'obsolete Chromium must be detected');
assert(act.includes('onRenderProcessGone'),'foreground renderer failure must remain handled');
assert(pipeline.includes('WEBVIEW_RENDERER_GONE'),'background renderer death must be terminal');
assert(pipeline.includes('WEBVIEW_UNSUPPORTED_CHROMIUM'),'unsupported headless Chromium must fail promptly');
const runtime=read(root+'/runtime.js');
assert(!runtime.includes('indexedDB.deleteDatabase('),'must not erase IndexedDB');
console.log('AurumB architecture-preserving Legacy safety gate passed');
