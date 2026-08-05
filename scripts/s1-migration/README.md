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

## S2 target preconditions

The loaders write through the S2 storage layer, and several of them treat
parts of S2 as **fund configuration that must already exist** — they verify
or adopt against it and fail loudly rather than invent it. Before running the
loaders against ANY target (fresh branch or production), ensure:

**Environment**
- `EXTERNAL_DATABASE_URL` → the S2 target. Every loader prints the resolved
  target banner at startup — read it before continuing.
- `S1_DATABASE_URL` → the S1 MariaDB source (stage only; production URL must
  carry SSL params).
- The S2 DB role must be able to create the `s1_staging` schema/tables.
- The S2 schema must be fully migrated (start the app once; it must report
  "No pending migrations").

**Preconfigured S2 data (loaders never create these)**
- `options_employment_status` must contain all 11 names in the T20 hour-type
  mapping: Active, No Charge, Terminated, LOA, FMLA, Disability, Military
  Leave, Initial Eligibility, Deceased, Event Center Hours Purchasing, COBRA
  (case-insensitive). Missing any → T4 and T20 hard-fail, no flag relaxes it.
  On a fresh database run `seed-employment-statuses.ts` first, then review
  the `employed` flags with the fund (they gate eligibility and the
  member-status scan).
- **Policies** — `load-policies.ts` is ADOPT-ONLY: every referenced S1 trust
  policy must match an existing S2 `policies` row by name or `sirius_id`
  (case-insensitive). Unmatched or unstaged targets hard-fail the whole run
  before any writes; no allowance flag. Matched policies are assumed to be
  correctly configured (benefit lists etc.) — the loader does not validate
  that. Synthetic runs have zero policy refs (no-op); production must stage
  the policy bundle explicitly (`--bundles`, it is not in the default list)
  and have the policy catalogue configured beforehand.
- `options_gender` rows for any gender values the contacts loader must
  resolve by name (unresolvable → counted reject, not silent).

**Adopted-if-present, created-if-missing (no preconfig required)**
- T4 options types (`industry`, `worker-ms`, `ledger-payment-type`,
  `worker-relation-type`): existing rows are adopted by unambiguous
  case-insensitive name (ambiguous names or conflicting `sirius_id`s
  hard-fail); missing rows are created.
- `options_employer_contact_type`: ensured by normalized name from shop
  contact roles/terms.

**Operational preconditions**
- **Charge plugins:** the hours loader writes `worker_hours` through storage,
  which can trigger hour-driven charge plugins. On production the charge
  plugins must be disabled (or a migration mode implemented) before T20, or
  the load can double-bill. There is no CLI flag for this yet.
- **Load order matters:** stage → seed-employment-statuses (fresh DB) →
  options → contacts/workers → employers → policies → relationships → hours.
  Later loaders resolve earlier loaders' `id_map` entries; missing mappings
  are rejects/skips. `id_map` rows pointing at deleted S2 rows hard-fail —
  repair the map, never delete it.
- **Sequences:** the contacts/workers loader runs the one sanctioned
  `setval`; relationship shell workers allocate above that range. Don't load
  relationships before contacts/workers.
- **Synthetic-only allowances** (never on production):
  `--allow-unresolved-industry` (T4), `--allow-rejects owner_missing` (T15),
  `--stub-missing` (T20).

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

- `seed-employment-statuses.ts` — fresh-database prerequisite for T4/T20:
  idempotently creates the 11 `options_employment_status` rows the hour-type
  mapping (06 §4.12) verifies against. Employment statuses are S2
  configuration, not migrated S1 data — a long-lived dev database already has
  them, a schema-only branch does not (T4 then fails its verify pass). Never
  updates existing rows; review the seeded `employed` flags with the fund
  (they gate eligibility and the member-status scan).

- `load-options.ts` — T4: staged taxonomy terms → `options_*` via unified-options
  storage. Vocab dispositions are explicit (unhandled vocab = preflight failure,
  before any write). Resolution per term: id_map → siriusId column (tables
  without one, e.g. `options_ledger_payment_type`, carry the tid in `data.s1Tid`
  with id_map authoritative) → unambiguous case-insensitive name adoption →
  create. `worker-ms` requires the term-attached `field_sirius_industry` (Q37);
  unresolved industries FAIL the run unless `--allow-unresolved-industry`
  (dev-only — synthetic terms stage no fields). Sequence only written for
  sequence-capable types. Re-run must report zero created/updated.

- `load-contacts-workers.ts` — T3+T1: `sirius_contact` → contacts (+ phones,
  addresses), `sirius_worker` → workers (+ worker_ids) with EXPLICIT
  `sirius_id = nid` and a post-load `setval` (the one raw-SQL write,
  spec-sanctioned). Absorbs hours-loader stubs: adopts the stub worker's
  auto-created contact (no duplicate contact rows), stamps the real
  sirius_id/ssn onto the stub worker, flips id_map stub=false. Email/SSN
  uniqueness pre-checked (dups → report, Q36); worker-level contact-style
  mirror fields ignored (N10, contact node wins). Storage side: workers
  storage gained `createWorkerForMigration`/`updateWorkerForMigration` —
  migration-only, per T1. Re-run must report zero creates/updates.
  Note: T12's `data.duplicateEmail` stash and Q10's language column need a
  `contacts.data`/`contacts.language` schema addition that doesn't exist yet —
  duplicate emails currently live only in the run report.

- `load-employers.ts` — T7+T24: `grievance_shop` → employers (absorbs
  hours-loader stubs in place; `sirius_id = String(nid)`; industry via term
  id_map → industry options `siriusId` fallback, unresolved = counted reject +
  NULL), `grievance_shop_contact` → contacts + `employer_contacts` (contact
  types ensured BY NAME in `options_employer_contact_type` from `co_role` free
  text + `contact_types` term names). **T24 multi-link (N25 ruling
  2026-08-05):** one `employer_contacts` row per (contact, employer, type) —
  co_role-derived type first, then term order; storage now enforces
  uniqueness on the (contact, employer, type) triple instead of the pair.
  Milestone-3 single-link rows self-heal on re-run (an untyped link is
  retyped to the first missing type, remaining types become new links);
  operator-added links with other types are KEPT (`s2ExtraLinksKept`); no
  type info → one NULL-type link, and drift-reconcile never nulls an
  operator-set type. Prod expectation (07 §P5): 557 contacts → ~920 links
  (the 363 assignments dropped under single-link now load); verify checks
  every resolved type has its link.
  Phones (Phone / Phone 2 / Fax) and address (`address_2` merged into street —
  the address storage has no line2 input). Shop fields with no S2 home are
  counted, never loaded: `external_id` (Q26 — employers has no data column),
  `name_tts`, tags, `dispatch_job_types` (Q24), contract/attachments (T10/T23
  file milestone), company refs (`companies`/`employer_companies` deferred —
  absent from synthetic; the counter surfaces prod volume). Re-run must report
  zero creates/links. Reject policy: ANY reject reason must be explicitly
  allowed via `--allow-rejects r1,r2` or the run exits 1 (fail-loud; verify
  skips only row-skipping reasons, annotations never mask verification).

- `load-policies.ts` — ADOPT-ONLY mapper, not a creator: S1 policy references
  (election `field_sirius_trust_policy` targets + any staged
  `sirius_trust_policy` bundle rows) resolve to EXISTING `policies` rows by
  name / `sirius_id` (case-insensitive) and land in id_map entity `policy`.
  S2 policies are configuration (benefitIds etc.) — creating them from S1
  titles would produce broken configs, so unresolvable refs hard-fail BEFORE
  any id_map write. Elections never store a policy id in S2 (02 §5b — derived
  via `resolveEmployerPolicyAsOf`); the id_map exists for T16's
  `data.s1PolicyNid` stash + audit. Dev: the synthetic policy field table is
  EMPTY → documented no-op. **Prod prereq: 07 §P4** must identify the target
  bundle; stage it (add to `stage.ts` in-scope list if missing) before running.

- `load-relationships.ts` — T15: `sirius_contact_relationship` →
  `worker_relations`. `worker_1` = owning contact's worker
  (`field_sirius_contact` → contact→worker reverse map); `worker_2` = alt
  contact's worker, else a SHELL worker is created for that contact (serial
  sirius_id above the post-setval range, `data.migrationShell=true`, id_map
  entity `shell-worker` keyed by the CONTACT nid — S2 relations join workers,
  not contacts). Reltype tid → term id_map →
  `options_worker_relation_type.siriusId` fallback. `active=No` with no end
  date end-dates from `node.changed` (documented convention).
  `field_sirius_count` → `data.sequence` (ordering, Q14). The relations
  storage contract (start date REQUIRED, no future starts, end ≥ start) is
  pre-validated BEFORE any shell creation, so a reject can't orphan a shell.
  **N26 ruling (2026-08-05): missing start dates are DEFAULTED, not
  rejected** — start `2000-01-01`; end keeps a real S1 end date, else
  `2000-01-02`; `data.datesDefaulted=true`; counters `datesDefaulted` /
  `datesDefaultedActiveYes` (prod expects 115 per 07 §P6). Remaining fatal
  date rejects: `bad_start_date` (present but unparseable — expect 0),
  `future_start_date` (the 2 prod rows were fixed directly in S1 — expect 0),
  `bad_end_date`, `end_before_start`. Residual storage failures surface as
  SANITIZED codes (`validation_<field>`/`storage_error` — never raw error
  text, HIPAA). Matched rows drift-reconcile dates/type/sequence/defaulted
  flag. Reject policy: ANY reject
  reason must be explicitly allowed via `--allow-rejects r1,r2` or the run
  exits 1. Dev: `--allow-rejects owner_missing` (synthetic stages NO owning
  field — all 15 reject; Q13: production has the owning field on ALL rows
  — 35,793 as of 2026-08-05 — so prod runs with no allowance until counts
  justify a conscious ruling).

## Known production-hardening TODOs (before the real run)

- **Write + id_map atomicity (contacts/workers loader):** a crash between a
  contact/worker create and its `putMapping` leaves an unmapped row; the
  re-run then creates a duplicate (or trips the unique email/SSN). Windows
  are single-row-narrow and the verify pass + unique constraints surface
  them, but for the real 129k/117k run either wrap create+map in one
  transaction (needs storage-layer tx plumbing) or sweep for unmapped
  migration-era rows before re-running after a crash.
- **Per-row lookups in contacts/workers loader:** phones/addresses/worker_ids
  are fetched per contact/worker and email/SSN uniqueness is prefetched as
  full in-memory maps. Fine at ≤130k rows (bounded memory, one query each),
  but the per-row satellite reads should be batched (keyset paging like the
  hours loader) before production.

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
- **Policy target bundle unknown (load-policies).** The production census has
  no policy bundle, yet elections carry 223,909 `field_sirius_trust_policy`
  refs. Run 07 §P4 in prod, add the answering bundle to `stage.ts`, re-stage,
  and confirm its titles match the configured S2 `policies` rows BEFORE
  running `load-policies.ts` there.
- **Employer external codes (Q26).** `field_grievance_external_id`
  ("H0000"-style) has no S2 home (`employers` lacks a data column). Counted in
  the run report and preserved in `s1_staging`; if EDI/exports need it later,
  add a column/`data` home and backfill from staging.
- **Shop company refs.** `field_grievance_company` →
  `companies`/`employer_companies` is deferred (absent from synthetic). The
  loader counts prod volume; build the mapping when the file/company milestone
  lands.
- **T24 multi-type shop contacts — RESOLVED (N25 ruling 2026-08-05).**
  `employer_contacts` widened to MULTI-LINK: one row per (contact, employer,
  type); storage guard + loader + verify updated, smoke-tested by
  `scripts/oneoffs/s1-n25-n26-smoke.ts`. Prod numbers in 07 §P5 (557
  contacts, 351 multi-type, 363 previously-dropped assignments now load).
- **Relationship date constraints — RESOLVED (N26 ruling 2026-08-05).**
  The 115 missing-start rows load with default dates (start `2000-01-01`,
  end `2000-01-02` unless a real S1 end exists; `data.datesDefaulted=true`).
  The 2 future-start rows were fixed directly in S1 by the fund;
  `future_start_date` stays a fatal tripwire (expect 0). Never blanket-allow
  the remaining date classes. Prod numbers in 07 §P6.
