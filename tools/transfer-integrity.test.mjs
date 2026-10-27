import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = readFileSync(resolve(root, 'app/src/main/assets/runtime.js'), 'utf8');
const activity = readFileSync(resolve(root, 'app/src/main/kotlin/com/aurum/bistterminal8/MainActivity.kt'), 'utf8');
const scope = (start, end) => {
  const a = runtime.indexOf(start);
  assert.ok(a >= 0, `Start marker missing: ${start}`);
  const b = runtime.indexOf(end, a + start.length);
  assert.ok(b > a, `End marker missing: ${end}`);
  return runtime.slice(a, b);
};

test('70% boundary is enforced by the executable data integrity gate', () => {
  const gate = runtime.match(/^function dataIntegrityGate\(summary\)\{[^\n]+\}/m)?.[0];
  assert.ok(gate, 'dataIntegrityGate function not found');
  const check = runInNewContext(`${gate}; dataIntegrityGate`);
  for (const [fillPct, pass] of [[0, false], [69.99, false], [70, true], [95, true]]) {
    const verdict = check({fillPct, missingSymbolCount:0, fields:[]});
    assert.equal(verdict.ok, pass, `gate at ${fillPct}%`);
    assert.equal(verdict.commitAllowed, pass, `commit at ${fillPct}%`);
  }
});

test('R55 differential publisher blocks stale-only and low-quality candidates before writes', () => {
  const publication = scope('async function r55AtomicPublish(job,universe)', 'S.records=records;');
  const index = publication.indexOf('const transferredAt=');
  assert.ok(index > 0);
  assert.ok(publication.indexOf('newFresh') > 0);
  assert.ok(publication.indexOf('candidateGate.ok') > 0);
  assert.ok(publication.indexOf('HARD_CANCELLED_JOBS') > 0);
  assert.ok(publication.indexOf('candidateGate.ok') < index, 'quality check must precede DB transaction');
});

test('R206 only publishes after evaluating newly fetched records', () => {
  const job = scope('async function prepareGeneralDataR206(job', 'async function prepareMissingDataR206');
  const check = job.indexOf('const freshGate=dataIntegrityGate(dataSummary(freshRecords))');
  const publish = job.indexOf('atomicPublish(job,universe)');
  assert.ok(check > 0 && publish > check);
  assert.ok(job.includes('JOB_STATUS.RETRY_PENDING'));
  assert.ok(job.includes('r206SafePriorReference!==true'));
});

test('carried-forward rows are never marked as freshly collected', () => {
  const fallback = scope('function r221SafeCarryForward(', 'function r221SuppressOutOfCohortLive');
  assert.ok(fallback.includes("r.jobDataStatus='STALE'"));
  assert.ok(!fallback.includes("r.jobDataStatus='FRESH'"));
});

test('cold startup restores progress without starting requests, resume uses native operation lock', () => {
  const bootstrap = scope('async function bootstrapClean()', '/* Crash-safe foreground presentation');
  assert.ok(bootstrap.includes('await recoverOnlyExistingOnStartup()'));
  const restoration = scope('async function recoverOnlyExistingOnStartup()', 'let INTERRUPTED_RESUME_LOCK');
  assert.ok(restoration.includes("interrupted:true"));
  assert.ok(!restoration.includes('resumeManualStage('));
  const resume = scope('async function resumeInterruptedManualTransfer(', 'Object.assign(globalThis,');
  assert.ok(resume.includes('operation_lock_acquire'));
  assert.ok(resume.includes('operation_lock_release'));
  assert.ok(resume.includes('resumeManualStage(job)'));
});

test('Android gracefully handles renderer loss and maintains renderer recovery limit', () => {
  assert.match(activity, /override fun onRenderProcessGone\(/);
  assert.match(activity, /view\.destroy\(\)/);
  assert.match(activity, /rendererLossCount <= 2/);
  assert.match(activity, /installWebView\(\)/);
});

test('crash recovery cannot re-enable a persisted keepalive when the app starts', () => {
  const keepalive = readFileSync(resolve(root, 'app/src/main/assets/background-keepalive-only.js'), 'utf8');
  assert.ok(keepalive.includes('!r.interrupted'));
  assert.ok(!/^\s*sync\(\);\s*$/m.test(keepalive), 'a stale job must not start foreground service on app-open');
});

test('native foreground-service startup failure is reported rather than crashing Activity', () => {
  assert.ok(activity.includes('"ERR:KEEPALIVE_UNAVAILABLE"'));
  assert.ok(activity.includes('runCatching {\n                    val intent = android.content.Intent(this, TransferKeepaliveService::class.java)'));
});


test('new transfer: mandatory post-main round is never pre-counted after manual repair', () => {
  assert.ok(runtime.includes("const alreadyRan=0,completionOrigin="));
  assert.ok(runtime.includes("nextRound===1?true:fill<target"));
  assert.ok(runtime.includes("const R225_OPTIONAL_FILL_TARGETS=Object.freeze([95,90,80,70])"));
});
test('new transfer: source-verified canonical market clock uses valid third startup result', () => {
  const active = scope('prepareGeneralData=async function prepareGeneralDataR24','prepareMissingData=async function prepareMissingDataR24');
  assert.ok(active.includes('resolveCanonicalMarketPoint(start,end)'));
  assert.ok(active.includes("const cp=startup[2]?.status==='fulfilled'?startup[2].value:null"));
  assert.ok(!active.includes('startup[3]'));
});
test('new transfer: per-provider progress throttled without skipping persisted symbol and atomic publish', () => {
  const active=scope('prepareGeneralData=async function prepareGeneralDataR24','prepareMissingData=async function prepareMissingDataR24');
  assert.ok(active.includes('lastSourceProgressAt>=250'));
  assert.ok(active.includes('await stagePut(job.id,sym,rec)'));
  assert.ok(active.includes('await atomicPublish(job,universe)'));
});

test('transfer fast path batches local writes and preserves network/quality checks',()=>{
 const w=scope('async function r221SmartCompletion(job,','async function schedulerAuditTimesB');
 assert.ok(w.includes('networkSkippedNoTargets:noFetch'));
 assert.ok(w.includes('if(!noFetch)m=r221CompletionMetrics()'));
 const cohort=scope('async function enforceCohortAndGate(job,universe)','async function loadIndexAndCanonical(');
 assert.ok(cohort.includes("await bulkPut('stagingRecords',suppressed)"));
 const repair=scope('async function prepareMissingDataR206(','globalThis.resolveDataRefreshMode=resolveDataRefreshMode');
 assert.ok(repair.includes("await bulkPut('stagingRecords',universe.map(sym=>({"));
 assert.ok(repair.includes('HARD_CANCELLED_JOBS.has(String(job.id))||cancelRequested(job)'));
 assert.ok(repair.includes('await flushStageBatch(job.id)'));
});
