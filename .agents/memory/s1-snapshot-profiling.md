---
name: S1 legacy DB snapshot profiling
description: What the read-only S1 (Drupal 7) Neon snapshot actually contains and how to profile it for migration work.
---

The "live" S1 database (read-only Neon connection in the `EXTERNAL_DATABASE_URL` secret, role `s1_readonly_b`; never commit the connection string) is a **structural sample: every table holds ≤10 rows** — including `node`, `field_config`, `field_config_instance` — even though nids inside field data reach 22M+. `pg_class.reltuples` ≈ 10 everywhere.

**Why it matters:** any "row count", "fill rate", bundle census, or "column is all-null" observation from this connection is sample-derived, not production truth. Fully-null columns may be anonymization-masked OR just absent from the sample — never conclude a field is unused. `node.changed` is uniformly ~Oct 2023 (anonymizer artifact); only `created` and revision timestamps are usable.

**Known gaps in the snapshot's table set:** the `node/grievance` bundle's own field tables, hours-amount/status fields on `sirius_payperiod`, and subscriber/date fields on `sirius_trust_worker_election` are missing despite being provably real (referenced by `field_config_instance`). The 431-table set is itself incomplete.

**How to apply:** re-run `scripts/oneoffs/s1-profile.mjs` (S1URL env var) against a full S1 copy before building any ETL; it regenerates the JSON profile that `docs/s1-migration/01-field-inventory.md` was built from. The full migration mapping spec lives in `docs/s1-migration/`.

Also: SELECT grants on the S1 role were initially missing but were fixed by the owner; if `permission denied for table node` reappears, the owner must re-run `GRANT USAGE ON SCHEMA public; GRANT SELECT ON ALL TABLES IN SCHEMA public`.
