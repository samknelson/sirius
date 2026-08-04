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

## Known production-hardening TODOs (before the real run)

- Bulk transport (`COPY`/temp-table ingest) + per-bundle checkpointing for
  the 9.15M-node volume; benchmark against real payperiod JSON sizes.
- A consistent S1 read snapshot (single REPEATABLE READ connection or a
  frozen replica) — the cutover plan's freeze window covers this, but the
  extractor should not assume it.
