# S1 → S2 migration ETL

Extract/staging framework for the S1 (Drupal 7 / MariaDB) → S2 migration.
Full spec lives in `docs/s1-migration/` (**local-only, gitignored** — contains
S1 environment details; never force-add it).

## Architecture

```
S1 MariaDB (S1_DATABASE_URL)          S2 Postgres (EXTERNAL_DATABASE_URL)
  node + field_data_*  ──extract──▶  s1_staging.records / .terms  ──load──▶  app tables
                                      (lossless, raw values)        (via storage layer;
                                                                     next phase)
```

- **Stage** (`stage.ts`, this phase): reassembles whole node records per the
  spec's entity-reassembly pattern (`entity_type='node'`, unquoted
  `deleted=0`, delta-ordered multi-value aggregation, no language assumption)
  and upserts them losslessly into the `s1_staging` Postgres schema.
  Idempotent and self-reconciling — re-runs upsert by `(bundle, nid)`, and
  after a bundle extracts successfully, rows the run did not touch (records
  gone from S1) are deleted before count verification, so a green check
  proves *this* run mirrored the current source. A run that dies mid-bundle
  leaves the previous staged set intact for untouched rows; the next
  successful run heals everything.
- **Load** (next phase): per-transform loaders (T1…T29) read from
  `s1_staging`, apply the documented transforms (timezones, Yes/No booleans,
  tid remaps…), and write through the S2 storage layer in the spec's load
  order.

`s1_staging` is deliberately **outside** `shared/schema.ts` and the drift
gate — it is migration scratch space, not app schema.

## Field discovery

Primary: Drupal's `field_config_instance`/`field_config` (authoritative
cardinality + types — production has these). Fallback: if the metadata tables
are empty (the synthetic dev DB seeds field *data* but not field *metadata*),
the extractor scans `information_schema` + each `field_data_*` table for
bundle membership and infers cardinality from the max observed delta. The
run report prints which source was used.

## Usage

```bash
npx tsx scripts/s1-migration/stage.ts                  # in-scope bundles + taxonomy terms
npx tsx scripts/s1-migration/stage.ts --bundles sirius_worker,sirius_contact
npx tsx scripts/s1-migration/stage.ts --all            # every populated node bundle
npx tsx scripts/s1-migration/stage.ts --skip-terms --batch 1000
```

Exit code 1 if any staged count mismatches the S1 node count. Every run is
recorded in `s1_staging.runs` (args + per-bundle report).

## Rules honored (docs/s1-migration, 06 ETL traps)

- Output is **aggregates only** — counts, durations, anomaly tallies; never
  row values. The production run happens inside the HIPAA boundary and the
  report must stay safe to share.
- `deleted` compared unquoted; `entity_type` filter always applied.
- `language='und'` is *not* assumed — non-`und` rows are counted as
  anomalies; duplicate `(entity_id, delta)` rows keep the first and count.
- Values are staged **verbatim** (epoch ints, Yes/No strings, raw JSON
  strings). All transforms — including the two timezone conventions — happen
  at load time, never at extraction.
- `sirius_phonenubmer` (misspelled bundle, 7 title-only nodes) is not in the
  default in-scope list; disposition is a load-time decision (Q12).
- Duplicate `(entity_id, delta)` field rows (language variants) resolve
  deterministically: `'und'` first, then language, then `revision_id` —
  repeated runs stage identical payloads; occurrences are anomaly-counted.
- Upsert statements are bounded by rows AND serialized bytes (~4 MB) so
  large JSON payloads (production payperiods) can't build enormous
  single statements.

## Loaders (milestone 1: T20 hours)

- `load-hours.ts` — staged `sirius_payperiod` → `worker_hours` through
  `storage.workerHours.upsertWorkerHours` (notification-suppressed). Rules per
  06 v5 §4.12 / T20; run report is aggregates-only + S1 nids. `--dry-run`,
  `--stub-missing` (dev-only, single-process: creates minimal S2
  workers/employers via storage, recorded in `s1_staging.id_map` with
  `stub=true` for T4/T7 to enrich later).
- `lib/idmap.ts` — `s1_staging.id_map`, the S1→S2 crosswalk all loaders share.
  On mapping races the existing row wins (`putMapping` returns the winner).
- **Loader semantics are one-shot-at-freeze, not continuous sync**: re-runs
  upsert current groups but do NOT delete `worker_hours` rows whose source
  payperiods disappeared from a re-extraction. A full reload after the source
  changed requires wiping the loader's output first (or ownership tracking —
  see TODOs).

## Known production-hardening TODOs (before the real run)

- Bulk transport (`COPY`/temp-table ingest) + per-bundle checkpointing for
  the 9.15M-node volume; benchmark against real payperiod JSON sizes.
- A consistent S1 read snapshot (single REPEATABLE READ connection or a
  frozen replica) — the cutover plan's freeze window covers this, but the
  extractor should not assume it.
- **Loader migration mode with charge plugins disabled.** `upsertWorkerHours`
  executes charge plugins per row (`bao-hourly` fired 298 no-ops in the dev
  run). In production the migration must NOT replay charge plugins — ledger
  history arrives via T18 and replaying would double-bill. Needs an explicit
  ambient migration flag (same pattern as notification suppression) checked in
  the charge-plugin executor, plus per-row event/listener cost review.
- **Loader-side paging.** `load-hours.ts` currently materializes all staged
  payperiods in memory and upserts sequentially — fine at dev scale, not at
  3.6M rows. Needs keyset-paged staging reads, bounded write batches, and
  checkpointing.
- Row-level provenance (`$.entries` keys) is only aggregated in the run
  report; if per-row provenance must land in S2, `worker_hours` needs a home
  for it (no data column today).
