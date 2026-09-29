# APK ↔ source-tree linkage

## Evidence authority
The supplied reference APK is the primary binary evidence for this audit. Repository source may intentionally diverge where fixes are applied. Recovery metadata must not override measured APK bytes.

Reference APK SHA-256: `c255386ae87ae963ed347a6cb8ae0bc3140057f44be1aefbc8e15046d19f5cd8`.

## Application identity
- Reference APK package: `com.aurum.rev20.smartfastx.debug`
- Clean-install revised package: `com.aurum.bistterminal8`
- Application family/label: Aurum BIST Rev 20

## Reference APK WebView entry graph
Measured `assets/index.html` SHA-256: `e64f78e9a078dce6a6286a20369ace925c5aecb765e25d4f547be89e759d3ac5`.

Direct script tags in the supplied APK:
1. `native-bridge.js`
2. `native-market-http.js`
3. `native-secure-ai.js`
4. `core.js`
5. `features.js`
6. `runtime.js`
7. `rev20-user-contract.js`
8. `offline-first.js`
9. `rev20-final-rules.js`
10. `market-indicators-revision.js`
11. `netherlands-news-portal.js`
12. `background-keepalive-only.js`
13. `safe-transfer-acceleration.js`
14. `rev20-final-stability.js`
15. `final-hardening.js`
16. `market-rebuilt.js`
17. `trigger-contract.js`
18. `scheduler-settings.js`

The prior linkage document incorrectly named `rev20-customization.js` as a direct APK asset. That claim is withdrawn.

## Measured reference hashes
- `core.js`: `308b2811951a9578ac3faba32dbad42dbd7db724f71c01c03f50e063d9b575ab`
- `features.js`: `907099deb717558e424ee6b7f335bc7727ff9e224348701ccf5bb6d0c148b719`
- `runtime.js`: `df646928ec33e088e6297169d3f3b2c714d67c7d268002b170333d5ef265ff38`
- `native-market-http.js`: `925d86c01177118aeb5e0f5e236ccf778446e8e12ee2d457e1b453ab08fc8a29`
- `styles.css`: `8cebaad436b1a0001222f7f102bedfc7ab6c3fc50bedf640ee93ef91626d89ce`

## Native linkage
The asset layer calls Android through the `aurum://native?` protocol / `AurumNativeBridge.call(...)`.
- `native-market-http.js` ↔ `NativeMarketHttp.kt`
- `native-secure-ai.js` ↔ `NativeOpenAI.kt` + `SecureSecretStore.kt`
- `native-bridge.js` ↔ `MainActivity`
- scheduled/background execution ↔ `AurumScheduler.kt`, `BootReceiver.kt`, `TriggerReceiver.kt`, `PipelineService.kt`, `SchedulerLedger.kt`

## Integrity policy
`EXACT_APK` may be used only when bytes were measured from the supplied APK and the recorded hash matches those bytes. Reconstructed or revised source is not relabeled as exact merely because it has the same role or filename.
