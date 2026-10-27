# AI contract

AI is advisory, not the decision authority.

Allowed uses include data-integrity review, anomaly explanation, challenger suggestions, model audit, contextual reporting and natural-language explanations.

## Transport

- HTTPS only.
- Explicit allowlisted gateway host.
- no redirect following.
- bounded request/response size and timeout.
- rate limiting and retry/backoff.
- same market fingerprint is cached/audited to avoid repeat paid analysis.

## Schema

Requests and responses are typed JSON. Candidate weights, if present, must contain exactly K1-K7. Confidence must be finite and in [0,1].

No AI text is executed. No `eval`, generated source execution or runtime patch injection exists.

## Promotion

`AiPolicy` never directly accepts a proposal as champion. Any proposal must become a deterministic challenger and pass the normal validation/promotion pipeline.
