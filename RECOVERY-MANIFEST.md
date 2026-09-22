# AurumB APK recovery manifest

Source artifact: base.apk
Package: com.aurum.bistterminal8
App identity: Aurum BIST Rev 20 / AurumB-REV20

## Recovery rule
Only files proven to belong to this APK are admitted. Name similarity alone is rejected.
The repositories named aurumbuild/aurumbuildv1/aurumbuildv2 were inspected and rejected because their deleted history is an unrelated AurumBuild construction/real-estate web application.

## Exact APK asset inventory
| APK path | SHA-256 |
|---|---|
| assets/aurum-icon.svg | d91912feaf53d20ba0a718b75781b40d25fc16314647b4740492c70ad7cc3121 |
| assets/core.js | e1c55ed27fb3f905ea5807a33eb9e958acd16061e4d7faeb2c337a5d1b24f325 |
| assets/features.js | 73975ab3184fd93aac5334c9158b175825a06e56bb6320697da8be21a5ba982e |
| assets/index.html | 2b0336de0aa1b43e397827016c7c4d3d122ab5ecaf5643d4f8bdbe52bd01864b |
| assets/manifest.webmanifest | d4815ec60cfb1b429d83c75d7e61fbfcf5620a3467f3006db541dedd4264c0e6 |
| assets/native-bridge.js | 4f76faaf808c96a131cdbbb6af4cc6dc1e75ecc43777843bfa555b0fbe53462f |
| assets/native-market-http.js | cea7f4c20d973208f25bf0f309ce3de6ebe9a435e7d22fd95a0fcff44ce91c72 |
| assets/native-secure-ai.js | 6cd51671d63eb3b99eb297d5150aa5e578764c5724e548f84476987e54a0e7ff |
| assets/offline-first.js | 2d21920f9314db67d8b4ae98cbbc72345015693f3082358ba1a5f6f05e005b6c |
| assets/rev20-customization.js | 24e723703af59bf4cb6f831f307b46d208935317d430c4a666c9418abdbd6b5e |
| assets/runtime.js | 46a7a9f721c7c66f5acd33f31e9c5fbf50400ee2fd7ab9675e15cb295a17ace2 |
| assets/styles.css | 1c6ff7c946c6d21302cd11f6d0552a32fad7fd3232ceb0c5fe1bdf81d8875bd2 |

## Native DEX identity
classes3.dex contains application classes:
AurumScheduler, BootReceiver, MainActivity (+ NativeBridge and compiler-generated lambdas), NativeMarketHttp, NativeOpenAI, PipelineService, SchedulerLedger, SecureSecretStore, TriggerReceiver.

No GitHub source match was found for the package/class combination. Therefore reconstructed Kotlin is not labeled as original source.
