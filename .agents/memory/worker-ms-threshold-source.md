---
name: BAO member-status threshold source
description: Where the S1 hours threshold comes from and the merge rule for member-status JSON
---

- The S1 source for a member status's BAO hours threshold is ONLY the taxonomy term NAME suffix ("… - NN hours"); the term's staged fields/json carry nothing. A name without the suffix (e.g. "PA Worker") means "no threshold" — report it, never invent a value or erase an S2-configured one.
- **Why:** the original options loader dropped `data` entirely (rows landed with `data=null`), silently falling every status back to the 100-hour default and blanking 60-hour hospitality statuses.
- **How to apply:** member-status JSON updates are deep-merged (null leaf = delete), never whole-column replaced — top-level `data: null` is rejected. Any restore/reconcile of thresholds must preserve S2-only sibling keys.
- Test fixture gotcha: worker relations and msh reject FUTURE start dates, so deterministic eligibility scenarios must use past months, not far-future ones.
