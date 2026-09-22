# Native reconstruction status

All source marked `RECONSTRUCTED_FROM_DEX` is behavior-oriented recovery, not original Kotlin text.

| Class | DEX descriptor proven | Source reconstructed | Confidence note |
|---|---:|---:|---|
| SecureSecretStore | yes | yes | Keystore/AES-GCM identifiers proven; implementation reconstructed |
| SchedulerLedger | yes | yes | method surface proven; internal preference key layout requires further instruction verification |
| TriggerReceiver | yes | yes | receiver/service relationship reconstructed |
| BootReceiver | yes | yes | manifest actions proven; rearm relationship reconstructed |
| AurumScheduler | yes | pending | method offsets known |
| NativeMarketHttp | yes | pending | bridge/API surface and host allowlist evidence available |
| NativeOpenAI | yes | pending | OpenAI host + bridge callback evidence available |
| PipelineService | yes | pending | lifecycle surface known |
| MainActivity | yes | pending | bridge commands and method offsets known |

No source from similarly named unrelated repositories is accepted into the application tree.
