# AurumB Legacy — Private Source History Coverage (Aggregated)

The independent Legacy AurumB repository is **public**. Its counterpart, `netadalet-oss/Aurum`, is private. This audit therefore deliberately includes **no canonical source commit hashes, subject lines, file paths, code, or secrets**.

## Complete accessible history, not proven common ancestry

A paginated walk of every reachable source commit in the private canonical AurumB **repair branch** yields **1369 commits**, from **2026-10-01T17:55:06Z** through **2026-10-27T20:43:06Z**. **56** are dated on or after 2026-10-08. The independent Legacy repository predates this canonical repository; there is **no verified Git merge-base** that identifies an exact common fork point.

## Coarse subject classification (mutually exclusive)

| First matching title category | Commit count |
|---|---:|
| ui | 225 |
| transfer | 121 |
| scheduler | 58 |
| persistence | 194 |
| security | 72 |
| tests | 162 |
| build | 73 |
| other | 464 |
| **Total** | **1369** |

Each commit appears once. These are classifications of source commit titles, **not evidence that each change is implemented or tested in Legacy**.

## What is actually verified

Independent Git-tree blob comparison: **30 of 31** repaired-source web assets are byte-identical to the staged Legacy branch. The remaining `runtime.js` contains Legacy-specific adaptations. No repaired-source asset is missing. The separate Legacy Groovy/Java-path native architecture, Android package `com.aurum.nextrevised09`, app data and original signing identity have not been replaced.

## Not yet verified

- Every individual source commit's intended *behavior*, not just the final web assets.
- Canonical Room-backed native persistence, migrations, backup, update, AI, key custody and alarm equivalence against the independent Legacy API and data schemas.
- A successfully tested, signer-compatible upgrade over a Legacy device with actual data.

Never claim one-to-one completion from this title inventory or web file equality. Keep PR #57 in draft until native acceptance and release-safety gates pass.
