# Local completion handoff

The repository-side recovery work has been separated from the bytes that must be copied directly from the supplied APK.

## Copy from APK without editing

Copy these entries byte-for-byte:

```
assets/core.js                 -> app/src/main/assets/core.js
assets/features.js             -> app/src/main/assets/features.js
assets/runtime.js              -> app/src/main/assets/runtime.js
assets/styles.css              -> app/src/main/assets/styles.css
assets/rev20-customization.js  -> app/src/main/assets/rev20-customization.js
```

Expected SHA-256:

```
e1c55ed27fb3f905ea5807a33eb9e958acd16061e4d7faeb2c337a5d1b24f325  core.js
73975ab3184fd93aac5334c9158b175825a06e56bb6320697da8be21a5ba982e  features.js
46a7a9f721c7c66f5acd33f31e9c5fbf50400ee2fd7ab9675e15cb295a17ace2  runtime.js
1c6ff7c946c6d21302cd11f6d0552a32fad7fd3232ceb0c5fe1bdf81d8875bd2  styles.css
24e723703af59bf4cb6f831f307b46d208935317d430c4a666c9418abdbd6b5e  rev20-customization.js
```

Do not normalize line endings or re-save these files in an editor before hashing.

## Native boundary

The APK proves these Kotlin source filenames, but not their original source text:

```
AurumScheduler.kt
BootReceiver.kt
MainActivity.kt
NativeMarketHttp.kt
NativeOpenAI.kt
PipelineService.kt
SchedulerLedger.kt
SecureSecretStore.kt
TriggerReceiver.kt
```

Until source-equivalent decompilation is completed, do not create empty or guessed `.kt` files: doing so would make the source tree look complete while silently changing program semantics.

## Completion criterion

Recovery is complete only when:
1. all APK-exact assets match their recorded SHA-256;
2. Android manifest/resources are recovered or reconstructed with provenance;
3. native classes are reconstructed from DEX and marked as reconstructed unless original historical source is found;
4. the project builds and the resulting runtime bridge surface matches the APK.
