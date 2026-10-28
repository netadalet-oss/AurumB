# AurumB Legacy — architecture-preserving sync ledger

Source of improvements: `netadalet-oss/Aurum` branch `aurumb`, plus the independent repair PR #52 (`fix/aurumb-webview-freeze-20261027`).
Legacy target: this repository's `main` via branch `sync/legacy-upgrades-20261028`.

## Absolute invariants
- Remain **Legacy**: keep `app/build.gradle`, original `app/src/main/java/` host and its bridge/scheduler, legacy data schema, `.aurum` update contract, main branch history.
- Keep `applicationId=com.aurum.nextrevised09`, `versionCode=123` and legacy signer unchanged. Do NOT install canonical `io.aurum.next.aurumb` APK on Legacy.
- Never delete/clear IndexedDB, Room or settings; do not restore a deleted source tree.
- Do not clone `Aurum`'s native Kotlin/Gradle tree or `io.aurum.aurumb` Room classes into this repository.

## Ported and staged (not yet merged)
- WebView Veriler grid max 24 rows × 18 metric columns plus fixed stock/time; both page and column navigation.
- Attach Legacy tabs before asynchronous state restoration, preserve verified data table during transfers.
- Show last failed attempted refresh separately from the last VERIFIED data time.
- Mark `NO_PENDING_SLOT` as unsuccessful rather than a completed scheduler job.
- Non-destructive foreground/background Chromium renderer-exit handling, lock/wakelock failure cleanup.
- No changes to existing Legacy installer package name, version or signing workflow.
- Syntax/regression checks are bound to Legacy CI on PR.

## Not yet certified for exact feature parity
Canonical Android sources contain native Room, persistence migrations, crypto/backup recovery, fund/stock scheduling, telemetry, and 2026-10-15 UI modules not present in the Legacy project. Blind copying would silently *convert or break* Legacy, contrary to the owner's instruction.
Every remaining relevant feature must be **functionally adapted and tested against Legacy's own native interfaces**, not copied verbatim. No assertion of 100% parity is made until a full per-commit feature matrix and both Android emulators plus real legacy data migration checks pass.

Canonical `Aurum` is private whereas this repository is public. Do not bulk-publish private native/security implementation or secrets; review every source transfer before merging.
