# Android identity correction

Binary `AndroidManifest.xml` decoding establishes two distinct namespaces:

- APK/application ID: `com.aurum.rev20.smartfastx.debug`
- Native Kotlin/DEX package: `com.aurum.bistterminal8`

APK version metadata:
- versionCode: `5`
- versionName: `1.0.4-rev20.5`
- compileSdk: `35`
- minSdk: `26`
- targetSdk: `35`
- debuggable in supplied APK: `true`

Application components decoded from APK:
- `com.aurum.bistterminal8.MainActivity` — launcher/exported
- `com.aurum.bistterminal8.PipelineService` — non-exported, dataSync foreground service
- `com.aurum.bistterminal8.TriggerReceiver` — non-exported
- `com.aurum.bistterminal8.BootReceiver` — exported; BOOT_COMPLETED, MY_PACKAGE_REPLACED, TIME_SET, TIMEZONE_CHANGED

Permissions decoded from APK:
`INTERNET`, `ACCESS_NETWORK_STATE`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_DATA_SYNC`,
`POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`.

The earlier recovery note that treated `com.aurum.bistterminal8` as the Android package/applicationId was incomplete: it is the native class namespace, not the manifest package of this supplied debug APK.
