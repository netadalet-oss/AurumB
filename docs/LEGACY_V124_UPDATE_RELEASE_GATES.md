# Legacy v124 installation-preserving update gate (28 October 2026)

This document refers to the **independent Legacy application**, not the canonical Android cleanroom variants. It is a release checklist, not a release approval.

## Immutable update contract
- Keep `applicationId`, Legacy `app/build.gradle` Groovy, Kotlin source under `app/src/main/java/`, existing databases/IndexedDB origin and SharedPreferences names and keys.
- `versionCode` is **124** on the isolated PR branch, higher than the independent Legacy `main` baseline **123**. Do not present v123 APKs as updates.
- The v124 APK **MUST be signed by the same certificate** as the existing v123 Legacy installation. Debug certificates, temporary keystores, and freshly generated release certificates cannot be used for an in-place update.
- If the historical signing key or independently verified installed certificate is unavailable, stop. Do not uninstall an app, clear Android app storage, silently change package identity, or label an artifact as an upgrade.

## Changes staged (not device-certified)
- Foreground and scheduled WebViews use trusted-origin `WebChromeClient.onJsPrompt` for `aurum://native?`; JavaScriptInterface, which lacks caller-origin information, was removed.
- A native prompt is only accepted when the requesting URL **and** top-level URL are from `https://appassets.androidplatform.net/assets/`. Other origins get `ERR:UNTRUSTED_ORIGIN`.
- The existing `native-bridge.js` must continue to use the real browser prompt as fallback. `tests/legacy-bridge-origin.cjs` exercises this routing and the release signing policy.
- Scheduled-event ledger updates must durably commit terminal states, reject unknown or already-terminal tokens, and only publish data when `ok=1` has been durably recorded; do not silently ignore failed transfers.
- Previously staged static parity and JS tests do not replace WebView/IndexedDB/device equivalence.

## Non-skippable release acceptance
1. Confirm all relevant source commits and native/JS behaviors have traceable Legacy equivalents; review the `LEGACY_REVISION_MATRIX.md` gaps and private-source/public-repo boundary.
2. Run all JS regressions, Kotlin compile/unit/lint, both debug and release builds on the **same final PR HEAD**.
3. Pass API 26 and API 35 foreground/offline/headless scheduled WebView tests, failed/raced pipeline end conditions, history/portfolio and data snapshot integrity tests.
4. Obtain the existing installed v123 Legacy APK or trusted installed signer fingerprint. Confirm it matches the **actual** release-key certificate with `apksigner verify --print-certs`.
5. Build v124 signed candidate with that original signer, validate APK manifest package/version and certificate, then `adb install -r` over a test v123 installation **without uninstall**.
6. Compare before/after IndexedDB record counts, history T1–T30, backup recovery, native prefs, scheduled jobs, encrypted credentials, last verified market/NAV timestamps, and no accidental data reset.
7. Merge or publish **only after review and explicit approval**. Draft PR branches are not release branches.

**Current status:** These release criteria have not all been met. No production-safe v124 update has been certified.

## AurumB-specific signing control
GitHub workflow `.github/workflows/android-build.yml` requires all four existing `AURUMB_KEYSTORE_*` inputs and compares the generated APK certificate against the existing workflow pin. Absence/mismatch stops signing. Historical installed APK certificate must still be independently confirmed; the workflow pin alone is not an on-device migration test.

The GitHub PR verification job uploads a debug APK for test evaluation only. It is not an in-place production update. The public repository must never receive copied private canonical implementation secrets.
