# DEX-proven native API surface

Source: supplied APK `classes3.dex`. This inventory records descriptors recovered from DEX metadata and is intended to constrain reconstructed source.

## MainActivity
Android Activity / WebView host. DEX proves nested `MainActivity$NativeBridge` and compiler-generated onCreate callbacks. Asset-side contract is `AurumNativeBridge.call(message, body)`.

## NativeMarketHttp
Native network transport used by `native-market-http.js`. DEX proves the class and synthetic lambda implementation classes generated for its asynchronous/network work.

## NativeOpenAI
Native OpenAI transport used by `native-secure-ai.js`. DEX proves the class and synthetic lambda implementation classes.

## SecureSecretStore
Native secure-secret persistence paired with the AI bridge. The web layer intentionally avoids persisting API secrets in ordinary browser storage.

## PipelineService
Android foreground data-sync service. DEX proves `onStartCommand` compiler-generated callback/lambda classes.

## AurumScheduler
Scheduling layer for pipeline/background runs.

## SchedulerLedger
Persistent scheduler/run bookkeeping layer.

## TriggerReceiver
Non-exported receiver used to trigger scheduled work.

## BootReceiver
Exported receiver restored from binary manifest for:
- BOOT_COMPLETED
- MY_PACKAGE_REPLACED
- TIME_SET
- TIMEZONE_CHANGED

## Proven package boundary
All classes above are under `com.aurum.bistterminal8`.
The supplied APK application ID is separately `com.aurum.rev20.smartfastx.debug`.

## Reconstruction rule
A reconstructed method must preserve its DEX descriptor and externally visible behavior. Unknown implementation details must not be invented merely to make compilation succeed.
