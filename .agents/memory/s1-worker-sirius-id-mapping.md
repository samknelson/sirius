---
name: S1 worker sirius_id mapping ruling
description: workers.sirius_id = S1 field_sirius_id (not nid); nid lives in worker_ids "Legacy NID"
---

Fund ruling 2026-08-06: S1 `field_sirius_id` (~600k business series) maps exactly to `workers.sirius_id`; the S1 `nid` (~2.4M node counter, DISJOINT space) is preserved only as a `worker_ids` row of type "Legacy NID". No "Sirius ID" worker_ids row exists anymore. Employers unchanged (`sirius_id = String(nid)`).

**Why:** the two id spaces have zero overlap (verified on prod S1); the original T1 mapping (sirius_id = nid) conflated them.

**How to apply:** never treat `workers.sirius_id` as the S1 nid. Anything needing the nid must resolve via `s1_staging.id_map` (still nid → S2 UUID) or the Legacy NID worker_ids row.
