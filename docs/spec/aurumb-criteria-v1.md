# AurumB criteria specification v1

This document records the verified effective criterion intent and weights from the supplied APK. Exact numerical helper semantics (percentile, bandValue, missing-data propagation and outlier handling) remain versioned implementation contracts and must be fixture-tested before parity is declared.

## Decision criteria

Base weights:
- K1 0.196970
- K2 0.181819
- K3 0.136364
- K4 0.151515
- K5 0.121212
- K6 0.121212
- K7 0.090908

The sum is 1 within 1e-5 tolerance.

### K1 — Fiyat-Hacim Kırılımı
Weighted components observed in effective APK logic: near 20-day high 25%, close-location 20%, volume breakout percentile 20%, turnover ratio percentile 15%, OBV/volume normalization percentile 10%, ADX band 10%. Upper-wick and limit-up-risk penalties are applied afterward.

### K2 — Kontrollü Momentum
Day-change band 20%, short-degree/momentum band 15%, RSI band 18%, MFI band 12%, EMA trend 18%, MACD histogram delta percentile 17%.

### K3 — Volatilite Genişlemesi
ATR band 28%, 5/21 volume-ratio band 17%, Bollinger expansion/compression measure 16%, range expansion 16%, volume breakout percentile 13%, close location 10%.

### K4 — Kısa Vadeli Göreceli Güç
Relative 5-day 30%, relative 10-day 25%, relative 21-day 20%, short EMA trend 15%, regime-dependent beta fit 10%.

### K5 — Likidite ve Uygulanabilirlik
Log median turnover percentile 25%, turnover ratio percentile 18%, inverse estimated transaction cost 22%, inverse participation 15%, inverse Amihud 12%, inverse tick impact 8%.

### K6 — Gap ve Gün İçi Devam
Gap band 20%, intraday continuation 24%, day continuation 12%, close location 18%, volume breakout percentile 16%, inverse upper wick 10%; limit-up-risk penalty follows.

### K7 — Destekten Toparlanma
Lower-wick percentile 19%, recovery RSI band 18%, RSI delta percentile 17%, MACD histogram delta percentile 18%, distance-to-lower-Bollinger band 13%, prior weakness band 8%, volume breakout percentile 7%.

## Hard market-move eligibility gate

Before feature construction, criterion scoring, ranking, signal generation, backtest participation or learning eligibility, the instrument is checked by the shared `ExtremeMoveEligibility`.

- Absolute daily change greater than **21.0%**: excluded.
- Absolute instantaneous/current change greater than **21.0%**: excluded.
- Exactly ±21.0%: not excluded by this gate.
- When both available measures return to an absolute value of 21.0% or less on fresh point-in-time data, this gate no longer excludes the instrument.
- Missing data is not converted to zero; other data-quality rules still apply.
- The 21.0% threshold is a canonical product rule, not a user-adjustable setting.
- Backtest uses the same gate. Learning evidence from a decision that violates the daily gate is ineligible.
- Existing already-open virtual positions remain mark-to-market/accounting and risk-exit eligible; the gate suppresses new candidate/model evidence and does not corrupt portfolio bookkeeping.

## Meta criteria

K8, K9 and K10 have zero decision weight in the clean-room catalog.
- K8: diagnostic consensus/technical alignment.
- K9: failure-risk/data-quality view.
- K10: reward/penalty memory derived from later realized outcomes of K1–K7.

They do not independently create a selection seat or override the deterministic K1–K7 decision engine.

## Clean-room rule

The legacy formulas are specifications and golden-fixture sources only. Production code must have one implementation per formula, explicit null semantics, versioned transforms and point-in-time data eligibility.
