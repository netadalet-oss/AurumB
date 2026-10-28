'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const m=JSON.parse(fs.readFileSync('docs/legacy-web-parity.lock.json','utf8'));
assert.equal(m.schema,'legacy-web-revision-parity-v1');
assert(m.exact.length>=30,'unexpected missing synchronized web assets');
const known=new Set();
for(const entry of m.exact){
 assert(!known.has(entry.path),'duplicate file '+entry.path);known.add(entry.path);
 const buf=fs.readFileSync(entry.path);
 const sha=crypto.createHash('sha1').update('blob '+buf.length+String.fromCharCode(0)).update(buf).digest('hex');
 assert.equal(sha,entry.blob,'unexpected divergence from verified source in '+entry.path);
}
assert(!m.exact.some(x=>x.path.endsWith('native-room-sync.js')),'canonical Room bridge must not be mirrored');
assert(!fs.existsSync('app/build.gradle.kts'),'legacy build system must remain Groovy');
assert(fs.existsSync('app/build.gradle'),'Legacy build missing');
console.log('Legacy AurumB exact web parity: '+m.exact.length+' verified assets; '+m.adapted.length+' intentional adaptations');
