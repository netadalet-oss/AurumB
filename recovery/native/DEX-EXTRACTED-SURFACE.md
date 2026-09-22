# Direct DEX extraction — verified surface

This inventory was produced directly from the supplied APK's `classes3.dex`, without an external decompiler.

## Application classes and methods

### AurumScheduler.kt
- `configuredTimes`
- `install`
- `rearm`
- `scheduleNextForTime`
- `cancelKnown`
- `pending`
- `valid`

### BootReceiver.kt
- `onReceive`

### MainActivity.kt
- `onCreate`, `onDestroy`, `onSaveInstanceState`
- `handleNative`
- `exportBytes`
- `currentFolderUri`
- `openSecretEditor`
- `postNotification`
- nested `NativeBridge.call`
- WebChrome/WebViewClient/back-press generated classes

### NativeMarketHttp.kt
- `request`
- `cancel`
- `allowed`

### NativeOpenAI.kt
- `request`

### PipelineService.kt
- `onCreate`
- `onStartCommand`
- `onDestroy`
- `onBind`

### SchedulerLedger.kt
- `begin`
- `complete`
- `token`

### SecureSecretStore.kt
- `key`
- `configured`
- `get`
- `put`
- `delete`

### TriggerReceiver.kt
- `onReceive`

## DEX-proven native bridge commands

`http_request`, `http_cancel`, `openai_request`, `secret_status`,
`secret_input`, `secret_set`, `secret_delete`, `folder_status`,
`folder_pick`, `folder_clear`, `export`, `notify`, `schedule`.

## DEX-proven storage/runtime identifiers

- `aurum_openai_api_key_v1`
- `aurum_secure_secrets`
- `openai_ciphertext`
- `openai_iv`
- `aurum_export_folder`
- `aurum_scheduler`
- `aurum_scheduler_ledger`
- `aurum_pipeline`
- `aurum_background_pipeline`
- `com.aurum.bistterminal8.SCHEDULED_SLOT`

## DEX-proven URLs / callbacks

- `https://appassets.androidplatform.net/assets/index.html`
- background URL variant with `?background=1&epoch=`
- `api.openai.com`
- `window.AurumNativeAI.resolve(...)`
- `window.AurumNativeHTTP.resolve(...)`
- `window.AurumNativeAIKeySaved(true)`
- `window.refreshExportFolderStatus()`

The next reconstruction stage must preserve this surface. Source syntax remains marked RECONSTRUCTED_FROM_DEX unless an original historical source is independently matched.
