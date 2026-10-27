# AurumB APK forensic inventory — 30.09.2026

Source artifact: user-provided `AurumB_300926.apk`.

## Verified package/runtime facts

- Display label: Aurum BIST Rev 20.
- Version string visible in packaged manifest: `2.0.0-r38-separate-economic`.
- Packaged Android components include `MainActivity`, `BrowserActivity`, `PipelineService`, `TransferKeepaliveService`, `BootReceiver`, and `TriggerReceiver`.
- Permissions include INTERNET, ACCESS_NETWORK_STATE, POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED, WAKE_LOCK, FOREGROUND_SERVICE / DATA_SYNC and SCHEDULE_EXACT_ALARM.
- The APK assets are WebView-oriented and include a very large `runtime.js` plus layered overrides/patches.

## Actual script load order

1. native-bridge.js
2. native-market-http.js
3. native-secure-ai.js
4. core.js
5. features.js
6. runtime.js
7. rev20-user-contract.js
8. offline-first.js
9. rev20-final-rules.js
10. market-indicators-revision.js
11. netherlands-news-portal.js
12. background-keepalive-only.js
13. safe-transfer-acceleration.js
14. rev20-final-stability.js
15. final-hardening.js
16. market-rebuilt.js
17. trigger-contract.js
18. scheduler-settings.js

The clean-room rewrite uses this order only to resolve effective legacy behavior. None of these files are copied into the new tree.

## Verified providers/endpoints present in packaged JS

Observed references include KAP, Bigpara, İş Yatırım, Yahoo Finance, TCMB daily FX, Altınkaynak, Google News RSS and Stooq. These are legacy observations, not blanket approval for production use. New providers must expose provenance, freshness, quality and explicit failure state.

## Conflict evidence

Static inventory found repeated definitions/names such as `refresh`, `markup`, `load`, `render`, `worker`, `cached`, duplicate DOM ownership and repeated market/provider helpers. The clean-room architecture assigns one canonical owner per responsibility.

## Persistence observations

Packaged JS contains localStorage keys for resume checkpoints, health state, settings scroll/open state, offline package metadata, market refresh metadata and presentation state. Critical model/portfolio state is not to be rebuilt on localStorage.
