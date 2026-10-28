# LEGACY_NATIVE_EQUIVALENCE_AUDIT — AurumB

**28 October 2026 — source-tree comparison, not executable feature certification.**
The independent Legacy app retains Groovy Gradle and its `app/src/main/java/` host. Android-native modules are NOT to be copied as a replacement for that host or the persisted Legacy data model.

## Existing Legacy-host files

| Legacy host filename | Compared repaired Android host | Result |
|---|---|---|
| `AurumScheduler.kt` | same logical host class | Source differs — manual behavior/API audit |
| `BootReceiver.kt` | same logical host class | Source differs — manual behavior/API audit |
| `BrowserActivity.kt` | same logical host class | Byte-identical Git blob |
| `MainActivity.kt` | same logical host class | Source differs — manual behavior/API audit |
| `MaintenanceService.kt` | same logical host class | Byte-identical Git blob |
| `NativeMarketHttp.kt` | same logical host class | Byte-identical Git blob |
| `NativeOpenAI.kt` | same logical host class | Byte-identical Git blob |
| `OperationLock.kt` | same logical host class | Byte-identical Git blob |
| `PipelineService.kt` | same logical host class | Source differs — manual behavior/API audit |
| `PublicationBus.kt` | same logical host class | Byte-identical Git blob |
| `SavedRelayPolicy.kt` | same logical host class | Byte-identical Git blob |
| `SchedulerLedger.kt` | same logical host class | Source differs — manual behavior/API audit |
| `SecureSecretStore.kt` | same logical host class | Byte-identical Git blob |
| `TransferKeepaliveService.kt` | same logical host class | Byte-identical Git blob |
| `TriggerReceiver.kt` | same logical host class | Byte-identical Git blob |

## Android-only architecture (not a copy checklist)

| Function area | Android-native source class count | Equivalence status |
|---|---:|---|
| ai | 3 | Legacy JS/native adapter mapping PENDING |
| calendar | 2 | Legacy JS/native adapter mapping PENDING |
| exchange | 4 | Legacy JS/native adapter mapping PENDING |
| health | 1 | Legacy JS/native adapter mapping PENDING |
| history | 1 | Legacy JS/native adapter mapping PENDING |
| learning | 2 | Legacy JS/native adapter mapping PENDING |
| market | 1 | Legacy JS/native adapter mapping PENDING |
| network | 3 | Legacy JS/native adapter mapping PENDING |
| notification | 4 | Legacy JS/native adapter mapping PENDING |
| persistence | 5 | Legacy JS/native adapter mapping PENDING |
| pipeline | 4 | Legacy JS/native adapter mapping PENDING |
| portfolio | 4 | Legacy JS/native adapter mapping PENDING |
| provider | 9 | Legacy JS/native adapter mapping PENDING |
| root | 2 | Legacy JS/native adapter mapping PENDING |
| scheduler | 3 | Legacy JS/native adapter mapping PENDING |
| security | 1 | Legacy JS/native adapter mapping PENDING |
| selection | 1 | Legacy JS/native adapter mapping PENDING |
| settings | 2 | Legacy JS/native adapter mapping PENDING |
| signal | 3 | Legacy JS/native adapter mapping PENDING |
| transfer | 1 | Legacy JS/native adapter mapping PENDING |
| ui | 3 | Legacy JS/native adapter mapping PENDING |
| universe | 1 | Legacy JS/native adapter mapping PENDING |
| update | 2 | Legacy JS/native adapter mapping PENDING |
| **Total** | **62** | **No one-to-one certified match** |

### Acceptance
- Compare actual behavior/API contracts before writing any Legacy-native adapters; an absent Android class does not prove the corresponding feature absent in Legacy JavaScript.
- Preserve Legacy database names/versions, IndexedDB, SharedPreferences, package ID, historical signer, and installed-user data.
- Never assert native parity solely from matching web assets, commit title counts or same-name host classes.
- Run JavaScript regression, Kotlin/Gradle build, Android API26/35, scheduler/reboot/renderer and old Legacy APK upgrade/migration checks before merge/release.

**Privacy:** this is a public-safe aggregate: private Android package paths, commit IDs, class names, source SHA values, and code were deliberately omitted. Private-source publishability must be reviewed before a public merge.
