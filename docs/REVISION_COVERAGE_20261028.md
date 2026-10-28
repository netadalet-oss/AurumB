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
