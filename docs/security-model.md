# Security model

## Secrets

Secrets are never committed, exported, logged or exposed to a WebView/JS layer. `SecureSecretStore` encrypts device secrets using Android Keystore AES-GCM.

## Network

- cleartext traffic disabled in manifest and network security config.
- explicit HTTPS host allowlist.
- redirects disabled for finance and gateway clients.
- response size bounds.
- structured provider failures instead of silent fallback.

## WebView

The clean-room AurumB app does not use the legacy WebView runtime. There is no `addJavascriptInterface`, general-purpose native execute method, `unsafe-eval` or runtime JavaScript patch mechanism.

## XML/JSON

TCMB XML parsing disables DOCTYPE and external entities. AI/ECB/transfer JSON is schema/shape validated and bounded.

## Import/export

Exports have schema version and SHA-256 checksum. Secret-like fields are forbidden. Import performs dry validation before transactional portfolio replacement; failed import restores settings.

## Broker

Real execution is disabled by default. The broker contract requires explicit activation, user confirmation, amount/loss limits and idempotency.
