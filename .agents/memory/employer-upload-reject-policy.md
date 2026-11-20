---
name: Employer upload rejection policy
description: Operator decision to use reason-based allowances rather than a fixed source-ID cohort.
---

Employer-upload migration follows ordinary reason-based `--allow-rejects`:
`missing_upload_parent` and `missing_employer_node` may be allowed for all
source identities. Do not restore the original exact-ID allowlist.

**Why:** On 2026-11-20 the operator explicitly superseded the earlier
153-identity approval and asked for the same allowance paradigm as other
loaders, both ad hoc and in the daily fleet.

**How to apply:** Keep rejects visible with their real reasons and counts;
do not use a documentation JSON file as runtime policy. This does not approve
the unsupported `complete` source type, source repairs, or database execution.
