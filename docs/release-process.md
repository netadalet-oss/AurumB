# Release process

A release is allowed only after all required gates pass on the product branch.

## Gates

1. core/domain invariant checks
2. unit tests
3. Android local unit tests
4. lint
5. instrumentation-test APK compilation
6. static secret/WebView/eval/cleartext checks
7. Android debug build during development
8. Room migration tests
9. release build with debug/developer/test credentials disabled
10. dependency/security review
11. parity matrix review
12. install/open/data/scheduler/offline/error-path smoke verification on an Android target

## Artifacts

APK/AAB output is not called a release merely because compilation succeeded. A release must be tied to source SHA and checksum/signature metadata.

Runtime code injection/update patches are prohibited.

## Current clean-room status

Until CI and Android-target verification are observed as successful, the branch must remain draft and no release-ready claim may be made.


## Signed release contract

Compilation and packaging are separate states.

- `assembleRelease` / `bundleRelease` may be used by CI as compile/package verification and are not by themselves release authorization.
- The canonical signed packaging entrypoint is `:app:packageVerifiedRelease`.
- Signing material is supplied only through environment/CI secret injection:
  - `AURUM_RELEASE_KEYSTORE`
  - `AURUM_RELEASE_STORE_PASSWORD`
  - `AURUM_RELEASE_KEY_ALIAS`
  - `AURUM_RELEASE_KEY_PASSWORD`
- The keystore and passwords must never be committed, exported, logged, or embedded in APK assets.
- `:app:verifyReleaseSigning` fails closed when signing material is absent or the keystore path is invalid.
- `:app:releaseChecksums` writes `app/build/release-checksums.sha256` for generated APK/AAB artifacts.
- Release publication must verify Android signing and compare the published artifact hashes against that checksum manifest.
