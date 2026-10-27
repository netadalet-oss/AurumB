# AurumB clean-room provenance

## Scope

The `aurumb` branch is a clean-room implementation. The legacy AurumB/AurumF repositories and supplied APKs are treated as behavioral/forensic references only.

## Forensic inputs

Observed reference material includes:
- packaged APK component/permission metadata,
- packaged asset load order and effective override order,
- observable K1-K10 roles, K1-K7 weights and formula behavior,
- observable provider families, scheduler behavior, UI information architecture and persistence behavior,
- reference repository source inspected read-only to resolve exact helper/formula semantics.

## Excluded material

The new source tree does not contain legacy runtime patch files such as `core.js`, `runtime.js`, `features.js`, `rev20-*`, `market-rebuilt.js`, `native-bridge.js` or `offline-first.js`.

Legacy JavaScript/WebView execution architecture is not reused. There is no general-purpose JS/native execution bridge.

## Reimplementation method

Behavior is expressed through newly authored typed Kotlin modules with single canonical owners:
- formula and feature engineering,
- deterministic selection/adaptive portfolio construction,
- point-in-time universe and market data,
- backtest/walk-forward validation,
- champion/challenger learning,
- advisory-only AI,
- Room persistence/migrations,
- WorkManager scheduling,
- native UI, notifications and virtual portfolio.

Golden fixtures record externally derived expected outputs; they do not embed or execute legacy runtime code.

## Verification rule

A parity claim requires an explicit test, fixture, source observation or documented intentional change. Unknown behavior is not filled with fabricated values. Missing data remains missing and fail-closed where it affects decision integrity.
