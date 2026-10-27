# Provider inventory

## Equity universe
- KAP company directory: primary source.
- Bigpara company list: explicit fallback; failure is retained.

## Historical equity/market bars
- Yahoo Chart provider: canonical OHLCV adapter with provenance and response fingerprint.

## Turkey portal
- TCMB daily FX: primary for USD/TRY and EUR/TRY.
- Yahoo quote: visible fallback for FX.
- Yahoo: BIST 100 and gold portal values.

## Netherlands / euro area
- Yahoo: AEX quote.
- ECB Data Portal: EUR/USD reference rate, MRO rate and euro-area HICP annual rate.
- Yahoo: visible fallback for EUR/USD.

## Provider rule

No provider failure is silently erased. UI can show selected source, failed attempts, source timestamp, freshness and quality.

A provider's inclusion here does not mean every historical use is point-in-time safe. Backtest inputs must separately satisfy publication/availability-time rules.
