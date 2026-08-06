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
  Besides node bundles, it also mirrors S1's raw (non-node) `sirius_ledger_ar`
  table into `s1_staging.raw_ledger_ar` (keyset-paginated, count-verified;
  `--skip-raw` to omit).
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
- Target setup is one command: `bootstrap-target.ts` (schema + optional `--wipe`
  preserving the admin user + components + idempotent seeds). `trust_providers`
  and `trust_benefits` are NOT preconfigured — `seed-trust-config.ts` derives
  them from the staged S1 nodes after `stage.ts` (§4.15 carry-over-as-is).
  (`copy-fund-config.ts` remains as a dev utility for id-preserving copies from
  `SOURCE_CONFIG_DATABASE_URL`, but is no longer part of the run.)
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
  which can trigger hour-driven charge plugins. On production, run T20 with
  `--migration-mode` — every write then runs inside a
  charge-plugin-suppressed ambient scope (`withChargePluginsSuppressed`,
  checked in the charge-plugin executor), so the load cannot double-bill.
  Without the flag, the loader preflights and ABORTS before writing if any
  charge plugin is runnable (component enabled + enabled config).
- **Production runbook:** `RUNBOOK.md` in this directory is the verified,
  step-by-step production procedure (exact commands, allow-rejects policy
  table, expected counters, timings, parity gate) — proven by a full dev
  rehearsal on 2026-08-06. Operators follow the runbook; this README is the
  loader reference.
- **Load order matters:** bootstrap-target → stage → seed-trust-config →
  options → contacts/workers → member-statuses → employers → policies →
  relationships → employee-ids → elections → benefit-history → **payments →
  ledger** → hours → enrollment-packet-tags. Payments run BEFORE ledger:
  negative AR rows reference payment nids, and T18 resolves them through
  id_map `payment`. T29 (enrollment-packet-tags) only needs the `worker`
  id_map, so any slot after contacts/workers works; it is listed last to
  keep the spine loads together.
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

**Typechecking:** the migration scripts live OUTSIDE the app tsconfig, so the
app `tsc` does NOT cover them. After touching anything under
`scripts/s1-migration/`, run:

```bash
npx tsc -p tsconfig.scripts.json --noEmit
```

This command is also registered as the `typecheck-scripts` validation, so it
runs as a named CI-style check (safe against any target — it never touches a
database).

**Smoke suite as a validation:** the T16–T19 regression harness is registered
as the `s1-smoke-dev-only` validation. It runs through
`scripts/dev/run-s1-smoke-guarded.ts`, which is **DEV-ONLY**: the smoke seeds
and deletes fake staged rows / id_map entries / S2 rows, so the wrapper
fingerprints the synthetic dev dataset first (small `s1_staging.records`,
exactly 30 type-less staged `sirius_payment` rows, < 10k workers) and refuses
to run — writing nothing — if the resolved `EXTERNAL_DATABASE_URL` target
doesn't match. It must never point at production.

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
  `--migration-mode` (suppresses charge-plugin execution for all writes;
  REQUIRED on production — without it the loader aborts if any charge plugin
  is runnable), `--stub-missing` (dev-only, single-process: creates minimal S2
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
  `sirius_id = field_sirius_id` (**ruling 2026-08-06** — the nid is a disjoint
  node-counter space and loads as a "Legacy NID" `worker_ids` row instead;
  type seeded `sirius_id='s1-legacy-nid'`; no "Sirius ID" row anymore) and a
  post-load `setval` (the one raw-SQL write, spec-sanctioned). Missing/
  non-numeric `field_sirius_id` → worker loads with a sequence-assigned
  sirius_id + reject note (`sirius_id_assigned`/`sirius_id_not_numeric`);
  cross-worker collisions are FATAL (pre-write scan; colliding sirius_ids
  are distinct people per the 2026-08-06 fund finding — never dedupe/merge,
  no allow flag). Re-runs repair
  old nid-mapped rows in place (counters `oldMappingRepaired`,
  `oldSiriusIdRowsRemoved`); swaps/cycles among old values are made
  collision-safe by a parking pre-pass (`parkedForRekey`). SSN ownership is keyed on nid via id_map, not
  sirius_id. Absorbs hours-loader stubs: adopts the stub worker's
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

- `load-member-statuses.ts` — T6: worker `field_sirius_member_status`
  (multi-tid, delta order ignored) → one CURRENT `worker_msh` row per
  (worker, industry). Term tid → id_map(`term`) → `options_worker_ms`; the
  option's `industry_id` is authoritative (Q37 — never parsed from names).
  Two terms landing on the same industry reject
  (`duplicate_industry_assignment` — prod co-assignments always cross
  industries); an existing row with a DIFFERENT ms for the same industry
  rejects (`industry_ms_conflict`), same ms adopts (idempotent by natural
  key; provenance in `data.s1WorkerNid`/`data.s1Tid`). Row date =
  `node.changed` (sentinel 2000-01-01 when absent). NO history
  reconstruction, NO `worker_wsh` (06 §4.8a). Dev prereq: run
  `load-options.ts --fallback-industry <name>` first so the synthetic
  worker-ms terms (which stage no industry field) exist — synthetic-only
  flag; it fail-closes (refuses to run) if ANY staged worker-ms term carries
  `field_sirius_industry`, so it cannot mask a broken production reference.

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

- `load-employee-ids.ts` — N4 (closed 2026-08-06): `sirius_employee` →
  `worker_ids` via one `options_worker_id_type` per employer
  ("<employer name> Employee ID", `sirius_id = s1-employee-shop-<shopNid>`
  so reruns find the type even after a rename), mirroring the BPS Employee
  ID precedent. Row = worker ref (`field_sirius_worker`) + employer ref
  (`field_grievance_shop`) + code (`field_sirius_id`). Idempotent via id_map
  entity `employee-id`; matched rows drift-reconcile the value; an
  operator-added identical (type,value) row on the SAME worker is adopted,
  on a different worker it rejects (`code_owned_by_other_worker`).
  Duplicate codes within one employer reject as `duplicate_code` (the
  (type,value) UNIQUE would trip). Reject policy as everywhere: any reason
  must be allowed via `--allow-rejects` or exit 1. Dev:
  `--allow-rejects worker_ref_missing` (synthetic stages NO fields on the 3
  dev rows; production profiles all 541 rows with complete field sets —
  run with no allowance first).

- `load-elections.ts` — T16: `sirius_trust_worker_election` →
  `worker_trust_elections` via migration-only
  `workerTrustElections.createForMigration` (keeps FK/date validation and the
  TRUST_ELECTION_SAVED emit; skips the dual-coverage assert and
  auto-end-dating that reshape operator edits — history loads verbatim).
  Benefit refs resolve id_map → `trust_benefits.sirius_id` → unambiguous
  name (name-resolved pairs are adopted INTO id_map `benefit`); benefit ORDER
  is preserved. Election type: tid → staged term name → canonical code
  (FirstTime/OpenEnrollment/LifeEvent → `first_time`/`open_enrollment`/
  `life_event`; `--type-map tid=code` for prod surprises); untyped elections
  load with NULL `enrollment_type`. Policy refs never land in S2 (02 §5b,
  policy is derived) — stashed as `data.s1PolicyNid`. Relations resolve via
  id_map `relation`. `active=No` with no end date end-dates from
  `node.changed` (T15 convention). Verify = full field equality on every
  created/adopted row. Dev: `--allow-rejects worker_ref_missing` (synthetic
  elections stage no worker field — all 40 reject; smoke covers the real
  paths).

- `load-benefit-history.ts` — T17: `sirius_trust_worker_benefit` coverage
  spans → per-month `trust_wmb` rows through `storage.trust.wmb`
  (notification+charge suppressed). Expansion is calendar-month inclusive of
  both endpoints. OPEN spans (no end date) require an explicit
  `--open-end-through YYYY-MM` horizon — the loader refuses to guess the
  fund's intent (prod needs a ruling: likely the freeze month). Dependent
  rows: `field_sirius_contact_relation` → id_map `relation`; the relation's
  `worker_2` becomes the row's worker with `source_relation_id` set, and the
  staged subscriber must equal the relation's `worker_1`
  (`relation_subscriber_mismatch` otherwise). Employer: shop ref, else the
  referenced election's employer. Inactive no-end spans end-date from
  `node.changed`. id_map `wb` anchor = the span's first-month row; existing
  months are adopted (idempotent re-runs). Dev: `--allow-rejects
  benefit_unmapped` (synthetic benefit titles don't match fund-config names;
  smoke seeds mapped ones).

- `load-payments.ts` — T19, runs BEFORE T18: `sirius_payment` →
  `ledger_payments` via migration-only `ledger.payments.createForMigration`
  (the public create's input type omits `dateCreated` so app payments default
  to now(); the migration path preserves the verbatim historical timestamp).
  Payer → EA: worker → shell-worker → contact → employer priority, then
  `ledger.ea.getOrCreate`. Account: id_map `ledger-account`, else adopt by
  exact name, else create (broken id_map rows fail loud). Status map:
  Cleared→`cleared` (+`dateCleared`=dateCreated, `allocated`),
  Canceled→`canceled`, Failed→`error`, Pending→`draft`,
  Received→`draft` (+`dateReceived`). Amount = abs(dollar_amt); negative
  sources are counted and flagged in `details`. Type: tid → id_map `term` →
  payment-type option. Type-less rows reject (`payment_type_missing`) — there
  is deliberately NO fallback flag; genuinely type-less production rows would
  need a conscious fund ruling first. Payment-type/account currency parity is
  preflighted per row (`currency_mismatch` reject) because
  `createForMigration` skips the storage cross-check. Crash repair: a payment
  created before its id_map write landed is re-adopted by provenance
  (`details.s1Nid`), never duplicated (same pattern in T16 via `data.s1Nid`).
  Dev: the 30 synthetic payments stage no type → run with
  `--allow-rejects payment_type_missing`; the smoke covers the typed path,
  currency preflight, and crash repair end-to-end.

- `load-ledger.ts` — T18: `s1_staging.raw_ledger_ar` → `ledger` charge
  entries under charge plugin `s1-import` with
  `chargePluginKey='ar-<ledger_id>'` (charge plugins + notifications
  suppressed; entries are inert history). Only Cleared rows load — prod AR is
  100% Cleared; dev's 10 Pending run under `--allow-rejects
  non_cleared_status`. Amounts land VERBATIM (sign included: positive
  charges, negative allocations), and the verify pass recomputes per-account
  count + cents-exact sum of the FULL resolved set against the DB's
  s1-import aggregate — any drift is exit 1. Reference nids resolve wb →
  election → payment → worker → shell-worker → relation → employer →
  contact; unresolved references keep the row loadable with
  `referenceType='s1-unknown'` + `referenceId=String(nid)`, and
  `data.s1ReferenceNid` is always stashed for audit. `date` = raw epoch ts;
  `statement_ymd` = LA-calendar first-of-month of that ts.

- `load-enrollment-packet-tags.ts` — T29 (closes N24, ruled 2026-08-05):
  `smf_worker_month` tags stay extract-and-stage only EXCEPT exactly one —
  **"Comms: Received Enrollment Packet"** — which loads as one offline
  `comm` record per tagged (worker, month). **S2 home decision (build-time
  ruling, recorded here + in the loader header):** NOT comm +
  comm_interaction (its `call_reason_id` is a NOT NULL FK into the seeded
  MSR call reasons and its channel is constrained to the six call/visit
  channels — a packet is not a member-service interaction) and NOT
  comm_postal (NOT NULL to-address columns; S1 has no packet address).
  Instead: a parent-only `comm` row, medium `offline`, status `logged`,
  contact = the worker's contact, `sent` = `received` = first-of-month UTC,
  provenance + month in `data` (`s1Loader`, `kind:
  enrollment_packet_received`, `ym`, `s1.{nid,workerNid,tid}`). The comm
  history UI renders unknown mediums as a plain capitalized label with no
  child-details requirement. Keep-tag tid(s) resolve from `s1_staging.terms`
  by normalized name in vocabulary `sirius_contact_tags`; the same name in
  any OTHER vocabulary hard-fails before any write. Grain is one comm per
  (worker, month): duplicate tagged nodes adopt the first node's comm
  (`duplicateWorkerMonth`). Idempotent via id_map `wm-packet`; crash repair
  re-adopts by (contact, month) provenance (T16/T19 pattern); mapped-but-
  deleted comms hard-reject (`mapped_comm_missing` — repair the map).
  Prod scale (2.53M nodes / 13.57M tag rows) is covered by `pagedStaged`
  keyset paging + page-batched IN-queries for every lookup. Dev: the
  synthetic S1 MariaDB predates the tag vocabulary (all worker-month tag
  tids are NULL, no `sirius_contact_tags` terms), so the dev run is a
  documented no-op (`keepTagTids=[]`, `inScope=0`);
  `scripts/oneoffs/s1-t29-packet-tag-smoke.ts` seeds self-cleaning fakes
  for the real paths (scope filter, grain adoption, reject gate, idempotent
  re-run, crash repair, foreign-vocabulary preflight).

`scripts/oneoffs/s1-t16-t19-smoke.ts` covers the four loaders end-to-end:
it seeds fully-populated fake staged rows against real dev entities (the
synthetic dev data is structurally sparse — no worker refs on elections, no
types on payments), runs each loader as a real CLI, asserts report counters,
DB rows, idempotent re-runs and the T19 fail-closed guard, then cleans up.


## Parity harnesses (the cutover gates)

The fund ruled (2026-08-05) that cutover is judged by **validation, not
loading**: benefit history imports directly and is validated by a
month-parity run, and balance correctness requires reconciling BOTH S1
ledger AR and S1 payments together — neither is complete alone. Two
read-only harnesses produce aggregate PASS/FAIL reports with non-zero exit
on any breach (CI-able; a production run can be judged objectively). Both
follow the loader conventions: JSON report to stdout, run recorded in
`s1_staging.runs`, HIPAA-safe output (counts, rates, cents sums per
fund-level account, reason codes; samples are S1 nids or opaque S2 row ids —
never names, never per-person amounts tied to identity). Neither writes to
S2 or staged data.

- `verify-balance-parity.ts` — the N6 balance gate. Per ledger account and
  in aggregate, recomputes cents-exact counts + sums on both sides of both
  money streams and reports the drift plus a combined net position
  (AR − cleared payments):
  - AR: staged `raw_ledger_ar` Cleared rows ↔ `ledger` entries under charge
    plugin `s1-import` (key `ar-<ledger_id>`), signs verbatim. Forward pass
    (staged→S2, keyset-paged with batched key lookups) catches
    missing/amount/account drift; a reverse pass over the S2 `s1-import` set
    catches `ar_extra_in_s2`.
  - Payments: staged `sirius_payment` ↔ `ledger_payments` with
    `details.source='s1-migration'`, matched by `details.s1Nid`; the sign is
    restored from `details.s1NegativeAmount` before comparing. Only cleared
    rows count toward money sums; every row gets presence/status/amount/
    account checks.

  Flags: `--tolerance-cents` (default **0** — cents-exact is the
  conservative default; any nonzero tolerance is a fund decision) and
  `--allow-mismatches r1,r2` (same fail-loud contract as the loaders'
  `--allow-rejects`: every mismatch class present must be explicitly
  allowed or the run exits 1; allowed rows are excluded from BOTH sides'
  sums so drift shows only unexplained money). Tolerance never masks a
  disallowed mismatch class — the two gates are independent.

- `verify-month-parity.ts` — the benefit-history gate. For
  `--month YYYY-MM`, compares S2's `trust_wmb` rows against the staged
  `sirius_trust_worker_benefit` spans covering that month, resolved with the
  exact T17 rules but read-only (benefit crosswalk in dry mode, dependents
  via relations → `worker_2`, employer fallback via the linked election,
  inactive-no-end end-dating from `node.changed`). Open-ended spans follow
  the EXACT T17 horizon semantics: `--open-end-through YYYY-MM` treats them
  as ending at that horizon; without the flag every open span is unresolved
  (`open_end_through_required` — T17 refused to load such spans without an
  operator-named horizon, so the harness refuses to guess about them too),
  and an open span starting after the horizon is unresolved
  (`open_span_after_through`). Pass the same horizon the loader ran with,
  or the gate would judge coverage T17 deliberately never loaded.
  Classification per worker: `matched`, `employer_mismatch` (same
  worker+benefit, different employer), `wrong_benefit` (covered both sides
  by different benefits), `missing_in_s2`, `extra_in_s2`; reported overall
  and per benefit. `disagreementPct` = disagreeing tuple-sides / total
  tuple-sides.

  Flags: `--max-disagreement-pct` is **required with no default** — the
  threshold is an explicit operator decision every run; and
  `--allow-unresolved r1,r2` for S1-side resolution rejects (loader reject
  policy: every reason present must be allowed; dev's synthetic spans all
  need `start_missing`).

  The S1 side is a pluggable **evidence source** (`EVIDENCE_SOURCES`): when
  the staged worker-month tags land (T29), they register as a second source
  and the same comparison/gate machinery reports both independently —
  cross-source disagreement then shows up as diverging per-source reports.

**Thresholds:** the defaults (0-cent tolerance, no month-parity default at
all) are deliberately the most conservative options; they came from the
2026-08-05 ruling that validation gates cutover, not from a fund-approved
error budget. Final production thresholds need fund sign-off — Laura/Sam
own the N6/parity test design.

`scripts/oneoffs/s1-parity-smoke.ts` proves the gates CATCH problems: it
baselines both harnesses green on dev, seeds a staged Cleared AR row and
payment with no S2 counterpart (asserting exit 1, exact mismatch classes and
cents-exact drift; that `--tolerance-cents` alone cannot mask class
failures; that allowances green the run and pull the allowed rows out of the
sums), seeds a 2031-05 month with exactly one of each disagreement class
(asserting the exact counts and `disagreementPct`, the threshold edge, and
that the threshold flag is required), then cleans up and asserts both
harnesses are green again.

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
  T16 (elections) and T19 (payments) self-heal this gap: they re-adopt
  orphaned rows by provenance (`s1Nid` in data/details) and repair id_map
  on the next run — port that pattern to contacts/workers before prod.

- Bulk transport (`COPY`/temp-table ingest) + per-bundle checkpointing for
  the 9.15M-node volume; benchmark against real payperiod JSON sizes.
- A consistent S1 read snapshot (single REPEATABLE READ connection or a
  frozen replica) — the cutover plan's freeze window covers this, but the
  extractor should not assume it.
- ~~Loader migration mode with charge plugins disabled.~~ DONE: T20 has
  `--migration-mode` (ambient `withChargePluginsSuppressed`, same pattern as
  notification suppression, checked at the top of the charge-plugin
  executor), plus a preflight that aborts a non-migration-mode run while any
  charge plugin is runnable. Remaining: per-row event/listener cost review.
- ~~Loader-side paging (Track C).~~ DONE: T16–T20 all stream staged rows via
  keyset paging (`pagedStaged`/`pagedRawLedger`, page size 2000, override
  `S1_LOADER_PAGE_SIZE`). Per-row lookups are now page-batched IN-queries:
  T16 adoption existence + verify, T17 election-employer fallback, per-page
  `trust_wmb` prefetch and batched anchor checks, T18 `charge_plugin_key`
  existence, T19 per-page mappings + batched verify. T20 streams payperiods
  ordered by worker (expression index on staging, created by the loader) so
  each worker's month-groups flush — resolve + write + verify — as soon as
  the stream passes that worker; memory is bounded by one worker's groups +
  a 1000-group flush buffer, never total month-group cardinality. Benchmarked
  at prod volume by `scripts/oneoffs/s1-trackc-bench.ts` (synthetic 220k
  elections / 100k spans / 150k payments / 200k AR / 400k payperiods): each
  dry-run finishes in 15–35s under a hard 512MB Node heap cap. Per-row
  storage writes stay — they're the correctness boundary. Remaining (not
  paging): per-bundle checkpointing for crash-resume mid-run (crash-repair
  provenance already covers correctness).
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
