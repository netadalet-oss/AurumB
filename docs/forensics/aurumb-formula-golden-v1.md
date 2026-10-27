# AurumB formula golden fixture v1

Source of truth: effective legacy `app/src/main/assets/core.js` `buildModels` behavior after final load-order resolution.

The clean-room implementation does not copy the legacy runtime. The legacy formula behavior was reduced to a mathematical fixture and then asserted against `AurumBFormulaEngine`.

Fixture universe:
- AAA = baseline synthetic record.
- BBB = the same record with +0.1 shifts on the cross-sectional fields used by percentile/rank-sensitive K1-K7 components.

Expected legacy scores:

| Symbol | K1 | K2 | K3 | K4 | K5 | K6 | K7 |
|---|---:|---:|---:|---:|---:|---:|---:|
| AAA | 52.145454545454545 | 83.0 | 85.0 | 10.0 | 28.5 | 75.4 | 31.285714285714286 |
| BBB | 87.145454545454545 | 100 | 98.0 | 100 | 71.5 | 91.4 | 92.285714285714286 |

Tolerance in the executable test: 1e-7 score points.

The fixture covers:
- band-value behavior,
- cross-sectional percentile direction,
- weighted missing-aware aggregation,
- K1/K6 post-score penalties,
- final criterion score clamping,
- regime-dependent K4 beta band,
- K5 inverse percentiles,
- K7 recovery composition.

This fixture is provenance/test evidence only; no legacy source block is copied into production code.
