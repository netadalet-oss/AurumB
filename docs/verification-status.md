# AurumB verification status

This file records only executed or externally observed verification states.

## Repository state
- Clean-room product branch: `aurumb`.
- Base root is independent from the legacy Aurum commit chain.
- Legacy AurumB/AurumF repositories and APKs are forensic references only.
- No legacy runtime/patch file is copied into the new source tree.

## Current verified CI
GitHub Actions run `36933652278` completed successfully for branch SHA
`9f557cb00202560a09612b7a9bc8fd5b70f855ac`.

The successful job executed:
- core invariant checks
- JVM/unit tests
- Android unit tests
- Android lint
- instrumentation-test compilation
- static security checks
- debug APK build
- release APK build
- release AAB build

## Point-in-time and persistence gates
- market bars require both market time and receive time to be visible at `asOf`
- news is stored with publication/receive timestamps and provenance
- instrument listing lifecycle supports delisting and relisting intervals
- Room schema is migration-only; destructive fallback is prohibited
- selection outcomes become learning evidence only after evaluation time

## Remaining verification gate
The Android emulator/device smoke workflow must complete `connectedDebugAndroidTest`.
A cancelled smoke run is not counted as success.

## Release state
Release artifacts compile in CI, but production readiness is not declared until the
device smoke gate and final parity/provenance audit are also green.
