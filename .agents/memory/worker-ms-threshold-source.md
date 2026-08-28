---
name: BAO member-status threshold source & merge contract
description: Where the S1 hours threshold comes from and how worker-ms JSON updates must merge
---

- The S1 source for a member status's BAO hours threshold is ONLY the taxonomy term NAME suffix ("… - NN hours"); the term's fields/json carry nothing. A name without the suffix (e.g. "PA Worker") means "no threshold" — report it, never invent a value or erase an S2-configured one.
- Canonical S2 location: `options_worker_ms.data.sitespecific.bao.threshold`. Every surface (universal options form via `x-data-path`, BAO thresholds page, S1 loader, eligibility resolution) goes through `shared/worker-ms-threshold.ts` — read/merge/validate there, never hand-roll.
- **Why:** the original loader dropped `data` entirely (rows landed with `data=null`), silently falling all statuses back to the 100-hour default; the fix's contract is deep-merge with null-leaf deletes so sibling JSON survives partial updates.
- **How to apply:** any new worker-ms JSON field gets a `dataPath` on its field definition + server-side merge via `mergeOptionData`; whole-column replacement is a bug.
- Test fixture gotcha: worker relations and msh reject FUTURE start dates (`start_ymd cannot be in the future`), so deterministic eligibility scenarios must use past months, not far-future ones.
