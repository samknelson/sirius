---
name: Synthetic S1 tag-data gap
description: The dev S1 MariaDB predates the sirius_contact_tags vocabulary — worker-month tag consumers no-op in dev.
---

The synthetic dev S1 MariaDB was seeded with an older generator than the one
committed in the repo: `field_data_field_sirius_contact_tags` exists but every
tid value is NULL (worker-month and contact rows alike), and the
`sirius_contact_tags` vocabulary/terms do not exist at all. The committed
generator DOES create the vocabulary and tid values — the live dev DB just
predates it.

**Why:** any loader/harness that consumes worker-month tags resolves keep-tag
tids from `s1_staging.terms` and finds nothing in dev, so a dev run is a
legitimate no-op (zero in scope), NOT a loader bug. Staged rows show
`field_sirius_contact_tags: [null, ...]`.

**How to apply:** don't "fix" the extractor when dev tag runs come back empty —
verify against production or use seeded staged fakes (see the T29 smoke:
seed fake terms + fake staged worker-month rows in `s1_staging` directly,
self-cleaning). Regenerating the dev MariaDB would fix tids but also churn
nids, breaking existing id_map state from prior loader runs — don't do it
casually.
