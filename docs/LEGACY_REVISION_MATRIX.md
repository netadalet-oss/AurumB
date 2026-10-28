# LEGACY_REVISION_MATRIX — AurumB (public-safe)

**Scope and confidentiality.** This matrix concerns independent `netadalet-oss/AurumB` (public), reviewed against a **private** Android source. It intentionally omits private-source commit IDs, commit subjects, source paths, code and any secrets. The full source history must be audited privately, not pasted into this public repository.

## Baselines (verified 2026-10-28)
- Legacy `main`: `7838ad96144357af6b753a0f22062d26b5cdd691`.
- Legacy working branch: `sync/legacy-upgrades-20261028`; draft PR **#57** targeting `main`.
- Legacy identity: `com.aurum.nextrevised09`, `main` versionCode 123, working-branch candidate versionCode 124, `app/build.gradle` (Groovy), `app/src/main/java/com/aurum/bistterminal8/`.
- Private Android source baseline is not a Legacy installer; no Android native tree or Room backend is to be copied.
- Accessible source history: **1,369 reachable commits including the Android repair branch**, classified only by title in `docs/PRIVATE_SOURCE_HISTORY_COUNTS_20261028.md`. This is **not** a proven fork point nor a per-commit port record.
- Source web-asset comparison is documented separately in `docs/REVISION_COVERAGE_20261028.md`. Matching bytes do not prove native behavior.

## Functional equivalence / risk matrix

Status terminology: `STAGED_STATIC` = corresponding code and static/test assertions found in the Legacy PR; `PARTIAL` = behavior covered only in part; `GAP` = no full Legacy-native equivalence proof. **None of these statuses means device-tested, upgrade-safe production parity.**

| Domain / expected behavior | Legacy target in this PR | Evidence available | Status | Acceptance gap / release risk |
|---|---|---|---|---|
| Bounded data grid: 24 rows, pinned stock/verified time, 18 metric columns, all fields retained | `app/src/main/assets/runtime.js` | `tests/legacy-stability-sync.cjs` runs synthetic 484-metric paging | STAGED_STATIC | Actual WebView/large IndexedDB memory and functional calculation/export test |
| Tabs usable before IndexedDB hydration | `runtime.js` | Early navigation binding asserted in stability test | STAGED_STATIC | Instrumented cold-start timing on API26/35 |
| Maintain verified DOM during foreground refresh | `runtime.js`, native `MainActivity.kt` | Foreground reload guard and source assertion | PARTIAL | Interrupted transfer/resume on actual loaded dataset |
| Distinguish failed attempt from verified market timestamp | `runtime.js` | Separate attempted-refresh key asserted | PARTIAL | UI and clock truth under network outage/reboot |
| Safe atomic publication / >=70% and mandatory post-main repair | `runtime.js` | Legacy quality assertions, existing transfer regressions | PARTIAL | Actual staged transfer rollback and partial-provider dataset |
| Manual T1–T30 history controls and immutable archive | `runtime.js`, `core.js` | `tests/aurumb-revision15-history.cjs`; packaged APK test | PARTIAL | Device history replay across T0/T1 boundary and old backups |
| Native scheduler once-only slot and durable ledger | `SchedulerLedger.kt`, `TriggerReceiver.kt` | `tests/legacy-stability-sync.cjs` static ledger assertions | PARTIAL | Exact-alarm denial, process death, reboot and concurrent worker tests |
| Do not misreport `NO_PENDING_SLOT` as success | `runtime.js`, `PipelineService.kt` | Legacy stability contract | STAGED_STATIC | Native ledger + UI end-to-end failure path |
| Renderer death must preserve data and release locks | `MainActivity.kt`, `PipelineService.kt` | Renderer callbacks and native lifecycle static assertions | PARTIAL | Repeated renderer death under transfer on API26/35 |
| Unsupported Chromium fails non-destructively | `MainActivity.kt`, `PipelineService.kt` | Legacy architecture gate | PARTIAL | Actual obsolete WebView runtime test |
| Trade email only for qualified AL/SAT events, safe retry | Existing Legacy relay/notification implementation | `scripts/test-trade-mail-delivery.cjs`, `test-trade-mail-roundtrip.cjs` | PARTIAL | End-to-end user-approved relay & provider outage |
| Backup / restore and legacy data migration | Existing Legacy storage, backup and signing chain | `tests/aurumb-legacy-backup-inventory.cjs` | GAP | Old installation, IndexedDB/Prefs/backup retention and rollback evidence |
| Private-source native Room, AI gateways, key custody, migrations, audit | Legacy-native adapters **to be designed**, not copied | No matching full native acceptance suite | GAP | Behavior-by-behavior specification and security review |
| Release signing / in-place upgrade from installed v123 to v124 | Independent Legacy APK and signer | No verified original Legacy signer proof | GAP | Higher Legacy versionCode, same certificate, `adb install -r`, persistence |
| Full reachable source-history equivalence | Private per-commit audit; public aggregate only | 1,369-title classification; not functional map | GAP | Private source SHA → behavioral contract → Legacy implementation → test → review |

## Quality gate / restrictions
- Existing PR #57 is **draft**. At inspected head, GitHub Actions Android Build passed but the emulator-smoke job was skipped. This proves build/test steps executed, **not** production signer or migration parity.
- **Public disclosure review required:** the current *public* working branch reportedly contains web assets byte-identical to a private source. That does not prove they are publishable. Before merge/release, identify confidential logic, tokens, internal endpoints, licensed assets and authorisation to republish; avoid further private-code transfer until approved.
- No direct `main` commit, branch force-push, database clearing, fabricated NAV/market timestamp, or automatic release.
- Historical scope and uncertain statuses must remain visible until each gap has an actual executable acceptance test and reviewer decision.

## 2026-10-28 release-gate update: trusted bridge and version-124 candidate

- Original Legacy `applicationId`, Groovy Gradle, Java source root, database names, and existing-user data model remain unchanged.
- **Candidate**, not certified production update: `versionCode=124`, with a new Legacy-local version name. This exceeds original Legacy v123 without inheriting the canonical Android app's version code.
- Both foreground and scheduled WebView native commands now use a `WebChromeClient.onJsPrompt` handler that checks the calling frame URL and the top-level appassets origin. The unscoped, iframe-accessible `addJavascriptInterface` command bridge was removed.
- `tests/legacy-bridge-origin.cjs` checks both native hosts, the browser fallback, the update version and signing policy. This is a source-level/isolated test, **not** adversarial Android device proof.
- Signed-release workflow fails closed unless historical Legacy update key and certificate identity are provided; no newly generated fresh-install signer can be accepted as a v123 update. Real installed-app certificate comparison and data-retention tests are **pending**.
- Do not confuse a debug-signed APK or an unsigned release candidate with a certified data-preserving update.
- PR CI is being extended to independently verify debug package identity and run API 26/35 emulator smoke. A successful build does not prove migration from the user's installed v123 APK.
