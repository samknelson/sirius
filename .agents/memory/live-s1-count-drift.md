---
name: Live S1 count drift
description: Daily staging count policy for a changing real-S1 source versus final-freeze.
---

Daily sync staging against the live S1 database must not require every extracted bundle count to exactly equal a separately queried source count. Report the bundle, direction, magnitude, and extraction window; fail only when evidence indicates incomplete staging or drift outside the defined live-change contract. Final-freeze retains a strict stable-source consistency requirement.

**Why:** The first real-source daily rehearsal ran against an actively changing database and produced small count deltas in the largest tables even though extraction completed normally. Exact zero drift is unattainable when the count and extraction do not share a stable snapshot.

**How to apply:** Design daily gates around auditable extraction boundaries, bounded drift, and relational/content verification. Do not weaken final-freeze: use a quiesced or consistent source and require strict parity there.