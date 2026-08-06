# S1 → S2 Migration Mapping Spec

Design spec for converting the legacy **S1** system — Drupal 7 on **MariaDB 10.6.25** (AWS RDS `smf-db-prod`, us-west-2) — into **S2** (this codebase). This is analysis/spec only — nothing here writes to S1 or S2.

> **Read [06-strategy-revision.md](06-strategy-revision.md) first.** It corrects the spec's original foundation: the "S1 database" first profiled was a ~10-row-per-table MariaDB→JSON→Postgres transload (431 of 818 tables), now **retired**. Everything below reflects the corrected, production-structure-derived state.

- **Source of truth for S1 shape:** the production structure profile — [`s1-schema.sql`](s1-schema.sql) (full DDL, 818 tables, zero rows) and [`profile/`](profile/) (`tables.tsv`, `columns.tsv`, `fielddata_stats.tsv`). Extracted from a temporary restore of production; structure and aggregates only, **no production rows**.
- **Source of truth for the target:** S2's schema (`shared/schema.ts`, `shared/schema/`) and storage layer (`server/storage/`).
- **Development database:** MariaDB 10.6.25 on Railway (`altaria.proxy.rlwy.net`, db `smf_prod`) with the real 818-table schema and **synthetic rows only** (06 §6) — deployed by mmcdermott4, reachable from this workspace via the `S1_DATABASE_URL` secret (connection verified 2026-08-04; ~944 synthetic nodes across all in-scope bundles). Build and test the ETL against this. The retired Neon Postgres sample must not be built against. Production data is PHI and never leaves the HIPAA boundary; the eventual migration tool emits only aggregates and counts.

## Documents

| Doc | Contents |
|-----|----------|
| [06-strategy-revision.md](06-strategy-revision.md) | **Read first.** Source correction (MariaDB), real bundle census (40 populated bundles, 9.15M nodes), scope changes (grievance descoped; `smf_worker_month` + 3 bundles added), ETL traps, dev-environment plan, N-series questions. |
| [01-field-inventory.md](01-field-inventory.md) | Regenerated from production structure: all 319 `field_data_*` tables with real MariaDB column types, per-bundle live row counts and multi-value flags, application tables, core tables, full 818-table census. Regenerate via `node scripts/oneoffs/s1-inventory-from-profile.mjs`. |
| [02-mapping.md](02-mapping.md) | One row per S1 field → concrete S2 `table.column`, or NEEDS-TRANSFORM / AMBIGUOUS-SOURCE / NO-S2-EQUIVALENT / DROP. Grouped by S1 bundle. Includes the sample-derived-inference re-derivation list (06 §9.6) and new §13 for previously-invisible bundles. |
| [03-transformations.md](03-transformations.md) | Per NEEDS-TRANSFORM entry: the actual conversion and which S2 ingestion path to route through. Source-side reads are MySQL dialect; S2-side writes are Postgres via storage. |
| [04-entity-reassembly.md](04-entity-reassembly.md) | How `field_data_*` tables join back into whole logical records per bundle (MySQL dialect), each bundle's S2 entity target, and the per-entity decision on `field_revision_*` history. |
| [05-open-questions.md](05-open-questions.md) | Open Q#/N# items with owners (N-numbering per 06 §8): tag vocabulary (N11), member-status target model (N12), benefit-history decision (N17), unmapped bundles (N3-N5, N8), semantic confirmations, data-quality rules. |

## ETL status

The **extract/staging framework is built**: `scripts/s1-migration/` (committed to the repo — code only, no S1 details). `stage.ts` reassembles all in-scope node bundles + taxonomy terms from S1 into the lossless `s1_staging` Postgres schema (records/terms/runs), idempotent by `(bundle, nid)`, aggregates-only reporting. First full run against the synthetic DB: 18 bundles + 36 terms, all counts verified (2026-08-04). Next phase: per-transform loaders (T1…T29) reading from `s1_staging` and writing through the S2 storage layer in the §12 load order.

## Current blocking items (before the affected ETL builds)

Both JSON payloads are now RESOLVED (06 v4): payperiod hours live at `$.totals.hours.total` (§4.12, T20) and `smf_worker_month`'s JSON is autotag bookkeeping — its **tags** are the payload (§4.2, T29). Remaining blockers:

1. **N11 — worker-month tag vocabulary** → S2 target (blocks T29's 2.53M rows). Vocabulary enumeration: [07-prod-query-pack.md](07-prod-query-pack.md) §A.
2. **N12 — member_status** — S2 target confirmed (`options_worker_ms` + `worker_msh`, per-industry current); only the same-industry co-assignment check remains (07 §B) before T6 can build.
3. **N17 — benefit history import-vs-regenerate** — deferred by design until the staged extract's regenerate-vs-actual diff produces a disagreement rate (T17 stages now, loads nothing).
4. **Validation gates** (06 §9): dev MariaDB instance up (`10.6.25-MariaDB`, live — `S1_DATABASE_URL`, TLS off for dev only), collation split 807/11, profiler output matching `profile/*.tsv` shape, all reassembly SQL executing against dev, one multi-value bundle reassembly returning correct counts, date-transform test covering both timezone conventions and both DST edges.

**Do not write ETL code that connects to production.** The reader module takes its DSN from an environment variable; the production DSN is supplied only inside the HIPAA-scope deployment.

## Target-side conventions this spec relies on (verified in S2 code)

- **`sirius_id` convention.** S2 tables carry `sirius_id` columns designed to hold legacy S1 identifiers for idempotent upsert: `workers`, `employers`, `policies`, `bargaining_units`, `trust_benefits`, `cardcheck_definitions`, most `options_*` tables, `facilities`, `companies`, `dispatch_job_group`, etc. The migration keys every entity on `sirius_id = <S1 nid/tid>` (as text), making re-runs idempotent.
- **Storage layer, not raw INSERTs.** All writes route through `server/storage/*` methods (e.g. `createContact`, `createOrMatchAddress`, `upsertWorkerHours`, unified-options upserts, ledger/payment creates) so S2 invariants, denorms and events hold. Explicit exceptions are called out per entity in `03-transformations.md`.
- **Existing import paths.** S2 already has wizard feed engines (`server/plugins/wizards/engine/feed.ts`), a worker-import path (`server/storage/sitespecific/btu/worker-import.ts` pattern), employment-status mapping (`wizard_employment_status_mappings`), and one-off importers under `scripts/migrate/core/`. Where an S1 entity matches one of these paths, the mapping says so and routes through it.
- **Derived data is regenerated, not migrated** — except where 06 §4.2 makes it a policy question (N2). S2 recomputes denorms (`denorm`, `worker_*_denorm`, ledger balances). S1's denormalized/cache artifacts (`field_sirius_denorm_benefits`, `sirius_ledger_balance`, `sirius_quickhash`, `taxonomy_index`, `search_*`) are DROPped and re-derived in S2 after load.

## Classification key (used in 02-mapping.md)

| Class | Meaning |
|-------|---------|
| direct | Lands in a concrete S2 `table.column` with at most a trivial cast. |
| NEEDS-TRANSFORM | Concrete S2 destination, but requires a real conversion (remap, split/merge, unpack, denormalize). Spelled out in `03-transformations.md`. |
| AMBIGUOUS-SOURCE | The S1 field's role could not be established from structure/context. Listed in `05-open-questions.md` (Q# / N#). |
| NO-S2-EQUIVALENT | Meaning understood, but S2 has no home; a decision is needed (add schema, stash in `data` jsonb, or drop). |
| DROP | Deliberately not migrated (D7 boilerplate, caches, denorms S2 regenerates, dead config, empty bundles). |
