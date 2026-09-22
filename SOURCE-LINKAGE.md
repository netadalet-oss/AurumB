# APK ↔ source-tree linkage

## Application identity
- Android package: `com.aurum.bistterminal8`
- APK application family: `Aurum BIST Rev 20` / `AurumB-REV20`
- Native application bytecode: `classes3.dex`

## Web application entry graph
`app/src/main/assets/index.html` is the WebView application entry point and references:
1. `aurum-icon.svg`
2. `manifest.webmanifest`
3. `styles.css`
4. `native-bridge.js`
5. `native-market-http.js`
6. `native-secure-ai.js`
7. `core.js`
8. `features.js`
9. `runtime.js`
10. `rev20-customization.js`
11. `offline-first.js`

All eleven referenced files are present in the APK `assets/` directory. Their hashes are recorded in RECOVERY-MANIFEST.md.

## Native source-path evidence
Kotlin debug/source metadata embedded in `classes3.dex` proves these original source filenames:
- `app/src/main/java/com/aurum/bistterminal8/AurumScheduler.kt`
- `app/src/main/java/com/aurum/bistterminal8/BootReceiver.kt`
- `app/src/main/java/com/aurum/bistterminal8/MainActivity.kt`
- `app/src/main/java/com/aurum/bistterminal8/NativeMarketHttp.kt`
- `app/src/main/java/com/aurum/bistterminal8/NativeOpenAI.kt`
- `app/src/main/java/com/aurum/bistterminal8/PipelineService.kt`
- `app/src/main/java/com/aurum/bistterminal8/SchedulerLedger.kt`
- `app/src/main/java/com/aurum/bistterminal8/SecureSecretStore.kt`
- `app/src/main/java/com/aurum/bistterminal8/TriggerReceiver.kt`

The DEX also proves nested/synthetic classes belonging to MainActivity, PipelineService, NativeMarketHttp and NativeOpenAI.

## Bridge linkage
The asset layer calls Android through the `aurum://native?` protocol / `AurumNativeBridge.call(...)`.
- `native-market-http.js` ↔ `NativeMarketHttp.kt`
- `native-secure-ai.js` ↔ `NativeOpenAI.kt` + `SecureSecretStore.kt`
- `native-bridge.js` ↔ `MainActivity.NativeBridge`
- scheduled/background execution ↔ `AurumScheduler.kt`, `BootReceiver.kt`, `TriggerReceiver.kt`, `PipelineService.kt`, `SchedulerLedger.kt`

## Integrity policy
A file is marked **EXACT** only when its bytes/text come directly from the supplied APK or an independently matching historical source.
A native Kotlin file reconstructed from DEX must be marked **RECONSTRUCTED** until an original historical source matches it.
Unrelated repositories are never merged merely because their name contains Aurum.
