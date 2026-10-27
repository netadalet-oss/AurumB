# AurumB canonical data model

## Provenance

Every external observation carries provider, requested/received timestamps, market timestamp, symbol, currency, quality, freshness, raw fingerprint and transform version.

Freshness states: LIVE, CACHED, STALE, UNAVAILABLE.
Missing, invalid and zero are distinct states.

## Room state

Room v15 persists:
- market observations and OHLCV bars,
- point-in-time universe snapshots and instrument lifecycle,
- analysis runs and selection evidence,
- append-only signals and audit events,
- scheduler state,
- model/challenger records,
- AI request/response fingerprints,
- notification deliveries,
- regional financial-news items with publication/receipt timestamps and raw fingerprints,
- append-only selection outcomes used for point-in-time calibration and learning,
- explicit paid AI-call audit flags,
- durable import journal state for cross-store crash recovery,
- append-only scheduler run history,
- persisted Türkiye/Nederland portal quote snapshots,
- virtual portfolio state, positions and transactions.

Critical finance/model state is not stored in localStorage.

## Decision identity

Each production run is tied to appVersion, modelVersion, formulaVersion and dataSchemaVersion. Old decisions are not recalculated in place when a model changes.

The stock extreme-move eligibility contract is versioned in the formula/model identity. Evidence from formula versions that predate the >12.5% current/daily exclusion is retained for audit but is not eligible for current calibration or learning.

## Money

Persisted money/price values use decimal strings. Display rounding is separate from model arithmetic.
