# AurumB release checklist

A compiled artifact is not automatically a production release.

## Automated gates
- core/domain invariants pass
- deterministic property-style invariants pass
- JVM and Android unit tests pass
- Android lint passes
- instrumentation-test APK compiles
- connected Android device/emulator tests pass
- static secret/WebView/eval/cleartext checks pass
- debug APK compiles
- release APK compiles
- release AAB compiles
- Room 1-to-current migration test passes
- point-in-time DAO tests pass

## Data/model gates
- K1-K7 golden parity fixture passes
- K8-K10 remain non-decision/meta roles
- selection/adaptive portfolio invariants pass
- no look-ahead in market/news/outcome evidence
- listing/delisting/relisting lifecycle is point-in-time
- transaction costs are included in outcome/backtest economics
- challenger cannot self-promote
- AI cannot mutate production weights directly

## Security/release gates
- release signing material is injected externally and never committed
- `:app:packageVerifiedRelease` fails closed without signing material
- APK/AAB SHA-256 manifest is generated
- published artifact signature and checksum are verified
- no legacy runtime/patch asset exists in the clean-room tree
- dependency/security review completed

## Manual/target smoke gates
- app installs and opens
- all functional screens render
- data refresh success/failure states are visible
- selection evidence/rejection reasons render
- scheduler survives process restart as designed
- offline/cached/stale states are distinguishable
- notification permission denial does not crash
- import validation/recovery path is exercised

Record the exact source SHA and CI/device run IDs in the release record. Do not mark a gate complete from compilation alone.
