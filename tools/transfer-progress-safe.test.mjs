import {readFileSync} from 'node:fs';import {test} from 'node:test';import assert from 'node:assert/strict';
const code=readFileSync('app/src/main/assets/runtime.js','utf8');
test('R206 full transfer: progress throttle never skips data acquisition or publication',()=>{
 const x=code.slice(code.indexOf('async function prepareGeneralDataR206('),code.indexOf('async function prepareMissingDataR206('));
 assert(x.includes('await makeCandidate(sym,start,end,indexBundle,job'));
 assert(x.includes('await stagePut(job.id,sym,rec)'));
 assert(x.includes('await atomicPublish(job,universe)'));
 assert(x.includes("status==='ERROR'||n-lastSourceProgressAt>=250"));
});
test('R206 repair: audit, missing fetch, and atomic quality gate remain intact',()=>{
 const x=code.slice(code.indexOf('async function prepareMissingDataR206('),code.indexOf('globalThis.resolveDataRefreshMode=resolveDataRefreshMode'));
 assert(x.includes('await makeCandidate(sym,start,end,indexBundle,job'));
 assert(x.includes("status==='ERROR'||n-lastSourceProgressAt>=250"));
 assert(x.includes("await bulkPut('stagingRecords',universe.map(sym=>({"));
 assert(x.includes('await atomicPublish(job,universe)'));
 assert(code.includes('nextRound===1?true:fill<target'));
});