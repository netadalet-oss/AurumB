# DEX method descriptors (direct extraction)

Source: supplied APK `classes3.dex`. These signatures and code offsets were parsed directly from the DEX class_data/code_item metadata.

## AurumScheduler
- `configuredTimes(Context): List` @ 0x30cc
- `install(Context, boolean, List): boolean` @ 0x2eb8
- `rearm(Context): void` @ 0x34a4
- `scheduleNextForTime(Context, String, Instant): void` @ 0x3558
- `cancelKnown(Context): void` @ 0x33d4
- `pending(Context, String, long): PendingIntent` @ 0x2e48
- `valid(String): boolean` @ 0x3094

## BootReceiver
- `onReceive(Context, Intent): void` @ 0x36f0

## MainActivity
- `currentFolderUri(): Uri` @ 0x3cf4
- `exportBytes(String,String,String,String,String): String` @ 0x3e8c
- `handleNative(String,String): String` @ 0x4170
- `openSecretEditor(): void` @ 0x51a0
- `postNotification(String,String,String,String): String` @ 0x4838
- `onCreate(Bundle): void` @ 0x4ce4
- `onDestroy(): void` @ 0x4ec4
- `onSaveInstanceState(Bundle): void` @ 0x4f64
- nested `NativeBridge.call(String,String): String` @ 0x3a80

## NativeMarketHttp
- `allowed(URL): boolean` @ 0x5224
- `cancel(String): void` @ 0x53d8
- `request(Context,String,String,String,String,int,Function1): void` @ 0x59e8
- worker lambda @ 0x5410

## NativeOpenAI
- `request(Context,String,String,String,Function1): void` @ 0x5f3c
- worker lambda @ 0x5b24

## PipelineService
- `onBind(Intent): IBinder` @ 0x60dc
- `onCreate(): void` @ 0x629c
- `onDestroy(): void` @ 0x6340
- `onStartCommand(Intent,int,int): int` @ 0x60f0

## SchedulerLedger
- `begin(Context,long,String): String` @ 0x6384
- `complete(Context,String,String,String): void` @ 0x6598
- `token(long,String): String` @ 0x64cc

## SecureSecretStore
- `configured(Context): boolean` @ 0x6668
- `delete(Context): void` @ 0x6870
- `get(Context): String` @ 0x66ac
- `key(): SecretKey` @ 0x6780
- `put(Context,String): void` @ 0x68c0

## TriggerReceiver
- `onReceive(Context,Intent): void` @ 0x69cc

The offsets above make subsequent instruction-level reconstruction reproducible and prevent guessed APIs from entering the source tree.
