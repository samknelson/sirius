# S1 → S2 Migration Mapping Spec

Design spec for converting the legacy **S1** system — Drupal 7 on **MariaDB 10.6.25** (AWS RDS `smf-db-prod`, us-west-2) — into **S2** (this codebase). This is analysis/spec only — nothing here writes to S1 or S2.

> **Read [06-strategy-revision.md](06-strategy-revision.md) first.** It corrects the spec's original foundation: the "S1 database" first profiled was a ~10-row-per-table MariaDB→JSON→Postgres transload (431 of 818 tables), now **retired**. Everything below reflects the corrected, production-structure-derived state.

- **Source of truth for S1 shape:** the production structure profile — [`s1-schema.sql`](s1-schema.sql) (full DDL, 818 tables, zero rows) and [`profile/`](profile/) (`tables.tsv`, `columns.tsv`, `fielddata_stats.tsv`). Extracted from a temporary restore of production; structure and aggregates only, **no production rows**.
- **Source of truth for the target:** S2's schema (`shared/schema.ts`, `shared/schema/`) and storage layer (`server/storage/`).
- **Development database:** RDS MariaDB 10.6.25 (`smf-db-dev-anon`) with the real schema and **synthetic rows only** (06 §6). The retired Neon Postgres sample must not be built against. Production data is PHI and never leaves the HIPAA boundary; the eventual migration tool emits only aggregates and counts.

## Documents

| Doc | Contents |
|-----|----------|
| [06-strategy-revision.md](06-strategy-revision.md) | **Read first.** Source correction (MariaDB), real bundle census (40 populated bundles, 9.15M nodes), scope changes (grievance descoped; `smf_worker_month` + 3 bundles added), ETL traps, dev-environment plan, N-series questions. |
| [01-field-inventory.md](01-field-inventory.md) | Regenerated from production structure: all 319 `field_data_*` tables with real MariaDB column types, per-bundle live row counts and multi-value flags, application tables, core tables, full 818-table census. Regenerate via `node scripts/oneoffs/s1-inventory-from-profile.mjs`. |
| [02-mapping.md](02-mapping.md) | One row per S1 field → concrete S2 `table.column`, or NEEDS-TRANSFORM / AMBIGUOUS-SOURCE / NO-S2-EQUIVALENT / DROP. Grouped by S1 bundle. Includes the sample-derived-inference re-derivation list (06 §9.6) and new §13 for previously-invisible bundles. |
| [03-transformations.md](03-transformations.md) | Per NEEDS-TRANSFORM entry: the actual conversion and which S2 ingestion path to route through. Source-side reads are MySQL dialect; S2-side writes are Postgres via storage. |
| [04-entity-reassembly.md](04-entity-reassembly.md) | How `field_data_*` tables join back into whole logical records per bundle (MySQL dialect), each bundle's S2 entity target, and the per-entity decision on `field_revision_*` history. |
| [05-open-questions.md](05-open-questions.md) | Open Q#/N# items with owners: blocking JSON-payload structure questions (N1/N9), coverage-history policy (N2), unmapped bundles (N3-N5, N8), semantic confirmations, data-quality rules. |

## Current blocking items (before ETL build)

1. **N1/N9 — `field_sirius_json` structure** on `smf_worker_month` (2.47M rows) and `sirius_payperiod` (3.61M rows) — these payloads likely carry S1's coverage months and hours amounts respectively; 2.5M+ rows are unmigratable until their structure is known.
2. **N2 — coverage policy:** migrate S1's actual granted months (`smf_worker_month`) vs regenerate via S2's WMB scan. Regeneration risks retroactively revoking granted coverage (COBRA events).
3. **Validation gates** (06 §8): dev MariaDB instance up (`10.6.25-MariaDB`), profiler rewritten for MySQL and matching `profile/*.tsv` shape, all reassembly SQL executing against dev, one multi-value bundle reassembly returning correct counts.

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
