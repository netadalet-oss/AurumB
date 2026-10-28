# AurumB Legacy — Revision coverage (safe public inventory)

Independent Legacy lineage remains `com.aurum.nextrevised09`, Groovy Gradle, Java-path Kotlin and existing IndexedDB. Canonical Aurum source is private; commit messages and source paths are **not exported verbatim** into this public repository.

## Scope
The canonical branch contains **24 source commits** dated on/after 11 Oct 2026 in the inspected window; a separate draft repair adds further deltas. This is a count-based audit, **not proof** of exact common ancestry or of full port coverage.

| Revision category | Commits with matching keywords | Port and evidence |
|---|---:|---|
| ui | 7 | Adapt applicable behavior; protect Legacy UI/ABI; evidence in PR #57 |
| transfer | 15 | Adapt applicable behavior; protect Legacy UI/ABI; evidence in PR #57 |
| scheduler | 3 | Adapt applicable behavior; protect Legacy UI/ABI; evidence in PR #57 |
| architecture | 13 | Adapt applicable behavior; protect Legacy UI/ABI; evidence in PR #57 |

## Confirmed Legacy-specific preservation
- K_Tarihsel manual gap-filling buttons (1/5/10/30 days) and cached-page observer restored from public Legacy source; previous accidental loss now covered by regression.
- Mandatory first completion round and four optional targets (95/90/80/70) are treated as **new behavior**, not reverted to the old 100/95/90/80/70 CI assertion.
- No native Room source or Kotlin project tree copied from the private canonical repository.

## Not certified
Native database schema/migrations, Java–Kotlin native API equivalence, UI source archives, production signing and existing-data upgrade remain unverified. A full per-commit functional mapping must be completed before declaring every revision mirrored.


## Complete reachable-history size and scope
- GitHub chronological commit walk of the canonical `Aurum/aurumb` branch yields **1338 reachable commits** from its most recent revision back to 2026-10-01T17:55:06Z. The canonical repository was created later than the independent Legacy repository, so this is the **available** canonical history, not proof of history before the source repository existed.
- The **24** commits inventoried above are only the most recent targeted time window; **do not mistake them for the full sync scope**. Ancestor commits can be shared across both canonical branches and need change-domain deduplication.
- A full one-to-one port requires a versioned feature/API matrix, individual acceptance tests for all non-equivalent behavior and a Legacy-only upgrade proof. Current draft PR is **partial**; never merge or call it full parity until these prerequisites are met.
- Preserve independent Legacy `applicationId`, existing native host paths and signing chain. Android cleanroom-native `Room` classes are not a drop-in Legacy dependency.


## Verified repaired-source web asset tree comparison

- Source: `netadalet-oss/Aurum` repair branch at `d66f77f1ff3749bf76ef3e20e8ba9865f38c7f23`.
- Target: independent `AurumB` Legacy repository, keeping `com.aurum.nextrevised09`, the original Groovy/Kotlin source layout and data contracts.
- Canonical repaired Android source has **31 asset blobs**. Independent Git tree comparison on this PR: **30 exact SHA-1 blob matches** with Legacy; `app/src/main/assets/runtime.js` differs intentionally for Legacy UI/native ABI adapters. No canonical asset is missing.
- This compares immutable Git *blob identity*, not runtime behavior of independent native architectures.
- A bytewise match of web assets does **not** establish equivalence of native Room migrations, backup/restore, alarm handling, production signing, or 1,000+ reachable historical commits.
- Current PR is staged; no Legacy `main` merge or Legacy release APK was performed.
