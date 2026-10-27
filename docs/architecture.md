# AurumB clean-room architecture

## Module boundaries

- `core/domain`: immutable finance/domain models and invariants.
- `core/formula`: canonical K1-K7 mathematics. No Android/network/persistence dependency.
- `core/selection`: ranking, execution-risk penalty and integrity validation.
- `core/backtest`: reuses production formula/selection functions; point-in-time only.
- `core/learning`: evidence eligibility, deterministic candidate learning, champion/challenger policy.
- `core/common`: provenance, calendar, notification, broker, logging, health, settings and AI contracts.
- `app/provider`: KAP/Bigpara/Yahoo/TCMB/ECB adapters.
- `app/pipeline`: historical sync and selection publication.
- `app/persistence`: Room v15 structured state with explicit sequential migrations and exported schema.
- `app/scheduler`: one WorkManager owner (`AppScheduler` + audited workers).
- `app/ai`: strict native gateway; advisory only.
- `app/portfolio`: virtual portfolio and reports.
- `app/notification`: local/email/push adapters + persisted dedupe/repeat policy.
- `app/security`: Android Keystore-backed secret storage.
- `app/transfer`: versioned checksum-validated export/import.
- `app/ui`: native navigation and presentation.

## Dependency direction

Providers -> canonical observations/bars -> persistence -> features -> formulas -> selection -> append-only decision evidence -> signal/portfolio -> realized outcomes -> learning evidence.

Learning may create a challenger but cannot mutate the champion without deterministic validation. AI can create advisory proposals but cannot bypass the same gate.

## Canonical-owner rule

A responsibility has one owner. New fixes modify that owner; no `patch2`, `override-final` or duplicate runtime is permitted.
