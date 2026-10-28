'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const load=path=>fs.readFileSync(path,'utf8');
const isB=load('app/build.gradle').includes("applicationId 'com.aurum.nextrevised09'");
const root=isB?'app/src/main/java/com/aurum/bistterminal8/':'app/src/main/java/com/aurum/fundterminall/';
const main=load(root+'MainActivity.kt'),background=load(root+'PipelineService.kt');
for(const [label,source] of [['foreground',main],['scheduled',background]]){
  assert(!source.includes('addJavascriptInterface('),label+': JavaScriptInterface exposes commands to arbitrary iframes');
  assert(source.includes('override fun onJsPrompt('),label+': origin-scoped prompt required');
  assert(source.includes('ERR:UNTRUSTED_ORIGIN'),label+': untrusted frame must fail closed');
  assert(source.includes('source.host') && source.includes('appassets.androidplatform.net'),label+': verify caller origin');
  assert(source.includes('source.path?.startsWith("/assets/")'),label+': verify local asset path');
  assert(source.includes('view?.url?.startsWith(') && source.includes('https://appassets.androidplatform.net/assets/'),label+': top-level asset origin required');
}
const calls=[];
const sandbox={
  window:{prompt:(message,body)=>{calls.push({message,body});return 'NATIVE_OK';}}
};
vm.runInNewContext(load('app/src/main/assets/native-bridge.js'),sandbox,{filename:'native-bridge.js'});
const nativeUri='aurum://native?cmd=schedule_status';
assert.equal(sandbox.AurumNativeCall(nativeUri,'audit'),'NATIVE_OK','bridge must fall back to prompt when direct interface is removed');
assert.equal(calls.length,1);
assert.equal(calls[0].message,nativeUri);
assert.equal(calls[0].body,'audit');
assert.equal(sandbox.window.prompt('ordinary prompt','hello'),'NATIVE_OK');
assert.equal(calls.length,2,'non-native prompt must retain the browser fallback');
const gradle=load('app/build.gradle');
assert(/versionCode\s+124\b/.test(gradle),'Legacy v124 update version mandatory');
const policy=load(isB?'.github/workflows/android-build.yml':'.github/workflows/android.yml');
const signing=isB?policy.slice(policy.indexOf('      - name: Align and sign installable APK')):policy.slice(policy.indexOf('  signed-update:'));
assert(signing.length>100,'signed update job must exist');
assert(signing.includes("versionCode='124'"),'signed artifact must be checked as v124');
assert(!signing.includes('keytool -genkeypair'),'fresh signing identity forbidden for update');
assert(!signing.includes('FRESH_INSTALL_ONLY'),'unrepeatable signing identity forbidden');
if(isB){
  assert(signing.includes('EXPECTED_SHA256='),'B release signing certificate pin mandatory');
  assert(signing.includes('if [ "$present" -ne 4 ]'),'B original key missing must fail closed');
}else{
  assert(signing.includes('AURUMF_EXPECTED_INSTALL_CERT_SHA256'),'F signer must be checked against installed certificate');
  assert(signing.includes('test "$ACTUAL" = "$EXPECTED"'),'F signer must match installed certificate');
  assert(!signing.includes('AurumF-release-key-BACKUP'),'never upload release keystores and their passwords');
}
console.log((isB?'AurumB':'AurumF')+' trusted native prompt and update signing policies passed');
