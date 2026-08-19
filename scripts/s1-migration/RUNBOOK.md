# S1 → S2 Production Migration Runbook

**Status:** verified end-to-end on 2026-08-06 by a full dev rehearsal (fresh target,
complete loader chain, parity gates) against the production-shaped synthetic S1
dataset (seed `20260803`, ~50 workers). Every command below ran exactly as written,
exit 0, in one uninterrupted sequence.

**Sanitization:** this document contains aggregate counters only — no S1
credentials, no hostnames, no record-level values. Keep it that way.

**Scope:** the S1 (Drupal 7 / MariaDB) → S2 data migration: staging, all loaders,
parity gates. Out of scope: file/S3 assets (N22), DNS/cutover mechanics,
credential rotation (all S1 `variable`-table credentials rotate at cutover and
never bulk-migrate).

---

## 1. Environment

| Variable | Meaning |
|---|---|
| `EXTERNAL_DATABASE_URL` | The S2 **target** database. Every loader resolves `EXTERNAL_DATABASE_URL \|\| DATABASE_URL` via `shared/database-url.ts`. Neon `-pooler.` hostnames are rewritten to the direct endpoint automatically. |
| `S1_DATABASE_URL` | The S1 MariaDB (mysql2). **Must carry an explicit port.** Beware trailing whitespace in the value — `generate.mjs` fails with `Incorrect database name 'smf_prod '`. Safe invocation: `S1_DATABASE_URL="$(printf %s "$S1_DATABASE_URL" | tr -d '[:space:]')" …` |

The production run happens **inside the HIPAA boundary**. Loader/harness output is
aggregates-only by design and safe to share; never paste raw S1 rows anywhere.

### Database nomenclature (fixed terms — use these names everywhere)

| Name | What it is |
|---|---|
| **S1** | The source: Drupal 7 / MariaDB production copy (`S1_DATABASE_URL`). |
| **migration-rehearsal-2026-08-06** | The S2 rehearsal target (Neon, Oregon) that the 2026-08 rehearsal loaders point at via `EXTERNAL_DATABASE_URL`. Holds `s1_staging.*` (records, id_map) plus the loaded S2 schema. |
| **prod target** | The real S2 production database (bao-prd) written only at cutover. |

### Running in the prod boundary (migration image)

The deployed web image is lean (no `tsx`, no `scripts/`), so the migration runs
from the dedicated **`migration` build target** of the same `Dockerfile`:

```bash
docker build --target migration -t sirius-migration:<git-sha> .
```

⚠ **The image pins the source at build time.** A loader fix landed on
`bao-dev` does nothing for ECS runs until the image is rebuilt from the new
SHA — and a run already in flight keeps its old image to the end. Before
attributing behavior to a fix, confirm the task's image SHA includes it
(2026-08-09 example: the t16 typed-elections fix required an image
≥ `a000e65b`; the long t20 hours run started on an image predating the
heartbeat-ETA and WARN-throttle commits, so neither shows in its logs).

It contains the full source tree + all node_modules (incl. `tsx`) and starts
no server. Execute it as an **ECS one-off task** (`run-task`) in the same VPC
as the target DB — never through the web app or any HTTP path. One task per
runbook step, the step command passed as a container command override:

```jsonc
// aws ecs run-task --overrides (per step):
{ "containerOverrides": [{
    "name": "migration",
    "command": ["npx", "tsx", "scripts/s1-migration/bootstrap-target.ts"],
    "environment": []   // env comes from the task definition secrets below
}]}
```

Task definition requirements:
- **Env/secrets:** `EXTERNAL_DATABASE_URL` (S2 target) and `S1_DATABASE_URL`
  (S1 MariaDB) via Secrets Manager — the only two variables the scripts need.
- **Size:** ~1–2 GB memory, 1 vCPU. Loaders are keyset-paged and benched under
  a 512 MB heap cap; 2 GB gives headroom for the ~1M-node stage step.
- **No timeout / long-lived:** the long poles (hours, benefit-history) are
  potentially tens of hours — run as a one-off task (not Lambda, not a service
  with health checks), and disable any scheduler-imposed stop.
- Run steps **sequentially** (one task at a time) per the §3 load order;
  bootstrap/seed concurrency is refused by an advisory lock anyway.

Running the image with no command prints usage and exits — nothing touches a
database without an explicit runbook command.

## 2. Target bootstrap (ONE command — no manual preconfiguration)

```bash
npx tsx scripts/s1-migration/bootstrap-target.ts          # fresh/empty target
npx tsx scripts/s1-migration/bootstrap-target.ts --wipe   # populated target
```

The bootstrap brings ANY target (empty, schema-only, or previously populated)
to the exact state the loaders expect:

1. **Schema** — empty-DB bootstrap (if empty) + core migrations + component
   migrations, the same sequence the app boots with.
2. **Wipe** — a populated target is refused unless `--wipe` is passed. `--wipe`
   truncates every table EXCEPT `variables` (migration/schema bookkeeping),
   `roles`, and `role_permissions`, **always preserving the admin users**
   (`--admin-email`, comma-separated; default `mmcdermott@cgtconsultinginc.com`
   + `john.young@activistcentral.net`) with their auth identities and role
   assignments, and drops `s1_staging` for a fresh stage (`--keep-staging` to
   skip).
3. **Admin** — creates each listed admin user + full-permission `admin` role if absent.
4. **Components** — enables the production-owned positive allowlist:
   `bulk`, `cardcheck`, `employer.company`, `ledger`,
   `ledger.payment.batch`, `sitespecific.bao`, `system.sftp.client`,
   `trust.benefits`, `trust.benefits.scan`, `trust.elections`,
   `trust.providers`, `trust.providers.edi`, and `worker.relations`. Debug,
   dummy gateway, facility, and staging-only components remain disabled.
5. **Seeds** (all idempotent) — policies (all 7: PA, UH, EC, COBRA + RES, TT,
   U; a legacy `R`/"Restaurant Plan" row renames IN PLACE to `UH`/"Unite Here
   Plan" per the 2026-08-11 ruling — reported `renamedFromR: 1`, row UUID
   preserved so id_map/policy history need no correction; a target holding
   BOTH R and UH aborts), employment statuses, the Employee/Employer
   Contributions accounts, the single global BAO Hourly configuration,
   genders, and call reasons. Every registered singleton cron config is
   materialized and every cron config is disabled.

`trust_providers` / `trust_benefits` are **not** seeded here — they derive from
the staged S1 nodes (§4.0b), so no hand-maintained benefit list exists anywhere.

Remaining manual preconditions:
1. **S1 access** — read access to the frozen S1 MariaDB from the migration host.
2. **App traffic stopped** on the target for the duration of the run (loaders
   suppress notifications and — with `--migration-mode` — charge plugins, but
   concurrent user writes would race the id_map).

## 3. Load order (load-bearing — do not reorder)

```
bootstrap-target → stage → seed-trust-config → seed-policy-benefits
→ options → contacts/workers
→ beneficiaries → member-statuses → employers → policies → relationships
→ employee-ids → users → elections → benefit-history → payments → ledger
→ hours → call-logs → cardchecks → enrollment-packet-tags → parity gates
→ okta pre-provisioning (dry-run; real bulk run is a CUTOVER step)
```

Key ordering facts:
- **payments before ledger** — AR allocation rows reference payment nids.
- **relationships after contacts/workers** — running relationships first breaks
  worker-number sequence initialization (setval ordering).
- **policies after employers**, **elections after policies + benefit config**.
- call-logs needs contacts AND workers (handler refs resolve contact-first with
  a worker fallback); dev also needs `dev/seed-call-log-traps.ts` after staging
  (restage sweeps the fakes); enrollment-packet-tags needs
  contacts (contact-level grain, corrected 2026-08-11 — no worker/wmb
  dependency).
- **seed-trust-config + seed-policy-benefits after stage, before
  elections/benefit-history** — the first creates
  `trust_providers`/`trust_benefits` from staged S1 nodes; the second assigns
  every target-resolved staged benefit to EC and UH without source UUIDs.
- **users after contacts/workers** — the T27 uid→worker pre-link resolves
  through id_map `worker`; running users first leaves every account unlinked.
- **beneficiaries after contacts/workers** — designations resolve workers via
  id_map `worker`; nothing downstream depends on it. Dev needs
  `dev/seed-beneficiary-fakes.ts` after staging (synthetic worker JSON has no
  `beneficiaries`; restage sweeps the fakes).
- **cardchecks after contacts/workers** — records resolve the worker side of
  the `field_sirius_log_handler` ref via id_map `worker`; definitions load
  before records inside the loader (single command). The production bootstrap
  provisions the cardcheck schema, but definitions remain migration/manual
  configuration and are not invented by bootstrap. Dev needs
  `dev/seed-cardcheck-fakes.ts` after
  staging (synthetic staging has ZERO cardcheck rows; restage sweeps the
  fakes).

## 4. Command sequence

Run every command from the repo root with `EXTERNAL_DATABASE_URL` pointed at the
target. **General reject policy: run each loader with NO `--allow-rejects` first.**
If it exits 1, read the report's `rejects`/`rejectSamples`, triage, and only then
re-run with the specific classes you have justified (loaders are idempotent — a
re-run skips already-mapped rows). The dev column shows the flags the rehearsal
needed; **dev-only flags are forbidden in prod**.

### 4.0 Stage (AT FREEZE)

```bash
npx tsx scripts/s1-migration/stage.ts          # prod: default in-scope bundles
# dev rehearsal used: stage.ts --all   (synthetic policies live in sirius_trust_policy;
#                                       prod's policy bundle sirius_json_definition is in-scope by default)
```
- Exits 1 if any bundle's staged count ≠ S1 node count — that is the gate.
- Expected shape: every line `s1=N extracted=N staged=N OK`; final
  `Done: <n> bundle(s) staged, all counts verified.`
- **Liveness:** bundles that run longer than ~60s emit a timer-driven
  heartbeat once a minute — `  progress <bundle>: staged=N/M (P%) elapsed=Es
  rate=R rows/s` (aggregates only). The heartbeat fires even while a single
  slow batch is still in flight (it reports the last completed count), so a
  big bundle (sirius_payperiod, smf_worker_month) with no progress line for
  several minutes indicates a hung connection, not a slow healthy run.
  Heartbeats do not change the final `s1=N … OK` verification lines or
  exit-code gate.
- Also stages taxonomy terms and `raw sirius_ledger_ar`.
- Prod volume is ~1M+ nodes; use `--batch` sizing if memory pressure appears.
  Staging extracts for actively-rewritten tables must run at freeze (06 §4.17).

### 4.0b Trust config from staging (providers + benefits)

```bash
npx tsx scripts/s1-migration/seed-trust-config.ts
npx tsx scripts/s1-migration/seed-policy-benefits.ts
```

Creates `trust_providers` and `trust_benefits` from the staged
`sirius_trust_provider` / `sirius_trust_benefit` nodes — the §4.15
"carry over as-is" ruling. Because the set derives from S1 itself, the prod
run automatically carries EVERY live benefit (Carelon EAP and Carelon
Behavioral Health as two distinct benefits, VSP and VSP Enhanced both live,
Progyny, Hinge, Liberty, Kaiser E, feed-less Life and AD&D, and the
historical plans) — no hand-maintained name list to go stale. Idempotent
(id_map → sirius_id/provenance → unique-name adopt → create); exits 1 on any
staged node missing a title. Benefit↔provider links are intentionally not
created (S1 has no such relation). Expect `titleMissingNids: []` and, on a
wiped target, `created == staged` on both sides.

`seed-policy-benefits.ts` resolves EC/UH by Sirius ID and benefits through the
staged `benefit` id_map. It assigns the complete resolved set only when a
policy has no assignment, adopts an exact existing set, and fails rather than
overwriting a differing non-empty assignment. Other policy metadata is kept.

### 4.1 – 4.14 Loaders

**Liveness (heartbeats now cover the loaders, not just staging).** Every
long-running loader (contacts-workers, relationships, elections,
benefit-history, payments, ledger, hours, call-logs, enrollment-packet-tags)
emits a once-a-minute heartbeat to stdout — the same timer-driven mechanism as
the staging heartbeat, aggregates only (counts/elapsed/rate; never names, nids
beyond counts, or row contents):

```
  progress <loader>: done=N/M (P%) elapsed=Es rate=R rows/s eta=1h23m  # row loop
  progress <loader>: phase=pre-scan done=N/M elapsed=Es rate=R rows/s (liveness)
```

- The `phase=` form fires during the otherwise-silent stretches (`pre-scan`,
  `flush`, `verify`) so a hung connection is distinguishable from a slow
  healthy phase.
- The heartbeat fires even while a single slow batch is in flight (it reports
  the last completed count). **For these loaders, no heartbeat line for
  several minutes = hung connection — investigate.** The tiny loaders
  (options, member-statuses, employers, policies, employee-ids, users) have no
  heartbeat and finish in seconds; silence there is normal.
- `S1_PROGRESS_INTERVAL_MS` overrides the 60s interval (dev/smoke only).
- Heartbeat lines are separate stdout lines; the final JSON report block and
  exit-code gates are unchanged.
- **`rate=`/`eta=` appear on every heartbeat form** — including liveness
  ticks — on images built from commits ≥ 2026-08-09. `eta` (format `1h23m`)
  is omitted when the total is unknown or nothing is done yet; an absent eta
  is honest, not broken.
- ⚠ **`rate=` is the cumulative average since loader start, not current
  speed.** Early fast pages inflate it and it declines for hours toward
  steady state on big loaders (t17 settled ≈41 spans/s on the real target) —
  a falling displayed rate is normal index-growth behavior, not degradation.
  Compute the instantaneous rate from the delta between two heartbeat lines
  before calling a run slow.

**Storage-op log suppression (migration runs only).** The same loaders
suppress the per-row `Storage operation: ...` logging entirely by default —
both the console line and the `winston_logs` DB insert — so each row write
costs one round-trip instead of several. Failures still surface via the
RejectLog/run report. A one-line notice on stderr at loader start confirms
suppression is active. `S1_LOADER_LOG_SAMPLE` tunes it (`0` = suppress
entirely — the default, `1` = full per-row logging, `N` = every Nth).
App-server logging behavior is unchanged — only loader processes throttle.

**Charge-executor WARN throttling (`--migration-mode`).** The charge
executor's per-row "suppressed by migration mode" WARN is throttled to one
line per trigger per 5 minutes, carrying a `suppressedSinceLastWarn` count
(images from commits ≥ 2026-08-09). On older images a multi-million-row
migration-mode load emits one WARN per row and floods the CloudWatch
stream — filter Live Tail to ERROR/FAIL to see real problems until the run
is on a rebuilt image.

⚠ **Consequence: `winston_logs` is no longer a reliable progress proxy** once
throttling is active. Measure progress from the heartbeat lines in the ECS
CloudWatch stream, or with plain table counts from the Neon SQL editor:

```sql
SELECT entity, count(*) FROM s1_staging.id_map GROUP BY entity ORDER BY 1;
SELECT count(*) FROM contacts;                -- contacts-workers
SELECT count(*) FROM workers;                 -- contacts-workers
SELECT count(*) FROM trust_wmb;               -- benefit-history month rows
SELECT count(*) FROM worker_hours;            -- hours
SELECT count(*) FROM worker_trust_elections;  -- elections
```

| # | Command (prod) | Dev rehearsal delta | Expected counter shape (prod) | Dev-observed (reference) |
|---|---|---|---|---|
| 1 | `npx tsx scripts/s1-migration/load-options.ts` | same | **Standard sync envelope (§10)** — top level is `summary` (created/updated/unchanged/…) + `rejectGate`/`verify`/`findings`; the legacy counters now sit under `detail`: `detail.unhandledVocabularies: {}`, `detail.workerMsUnresolvedIndustry: 0`, `detail.hourTypeVerify: "ok"`, `verify.failures: []`. Every worker-ms term resolves an industry (Q37). Re-runs fast-skip unchanged terms via consumed fingerprints (`detail.fastPathSkips`). Deletion policy: report-only — a term vanished from staging emits a blocking `deleted_in_s1` finding (§10). | 70 terms; created 4 industries, 10 relation types, 7 member statuses, 8 payment types |
| 2 | `npx tsx scripts/s1-migration/load-contacts-workers.ts` | same | `contacts.created+matched ≈ staged`; **T1 ruling 2026-08-06:** `workers.sirius_id = field_sirius_id`, nid → "Legacy NID" worker_ids row (every loaded worker gets one; no "Sirius ID" rows). Rejects are **annotations** (row still loads where possible): expect `ssn_collision_q36` (small), `worker_contact_unresolved` (small), `sirius_id_assigned` (workers with no field_sirius_id — count unknown in prod, triage the report); `sirius_id_not_numeric` expects 0 — triage any occurrence; **sirius_id collisions are FATAL** (pre-scan aborts before any write; no allow flag — see §5); `verifyFailures: 0` (includes sirius_id==field_sirius_id and Legacy NID coverage checks) | 74 contacts, 50 workers, 184 worker ids; rejects ssn_collision_q36=2, worker_contact_unresolved=2, sirius_id_assigned=2 |
| 2b | `npx tsx scripts/s1-migration/load-beneficiaries.ts` | requires `dev/seed-beneficiary-fakes.ts` first (synthetic worker JSON has no `beneficiaries`; re-run after any restage) + `--allow-rejects worker_unmapped,percent_sum_mismatch,pct_unusable,bad_json,unexpected_tier,list_exists_foreign,worker_map_broken` (seeded traps, 1 each); optional failure-path smoke `dev/smoke-beneficiary-clear-write-failure.ts` (exercises `write_failed` phase "clear" via a temporary trigger — dev only); sync smoke `dev/smoke-sync-beneficiaries.ts` | **After contacts/workers (2).** Loads `beneficiaries.primary[]` from worker `field_sirius_json` into the BAO beneficiaries store (replace-all via storage; authorship in id_map `bao-beneficiaries` — re-runs refresh loader-owned lists, NEVER clobber foreign ones). Values load VERBATIM (fund ruling: SSNs/phones that would fail the route schema are the legal record) — `softMismatches.ssnInvalid/phoneInvalid/percentOutOfRange` are report-only triage counts, not rejects. Staged-side reference (recomputed at run time, emitted as `stagedCounts` for fund comparison): ≈5,227 workers with key / ≈3,062 with ≥1 populated row / ≈5,087 populated rows. Run clean first; triage every fatal class (§5). `unexpected_tier` = ANNOTATION (primary still loads; a `contingent` tier is out of scope by ruling). Reconciliation is built in: `reconciliation.workersOk/rowsOk` true, `verifyFailures: 0`. **Sync-converted (§10):** re-runs fast-skip unchanged owned workers via versioned consumed fingerprints (no S2 reads); a staged worker that vanishes ENTIRELY → report-only `source_worker_missing` finding (S2 list + authorship mapping preserved; acknowledge per run via `--allow-findings source_worker_missing`; STOP-THE-LINE for the final freeze run); a missing S2 target stays the fatal `worker_map_broken` reject; LOGIC_VERSION bump or `--force-reconcile` reprocesses unchanged workers. | 14 seeded traps: 7 workers / 11 rows written (incl. legacy trailing-dot "50."/"50." → 50/50 and fractional 50.5/49.5 with precision retained), 1 owned stale list cleared (contingent-only staging); rejects 1 each of the 6 fatal trap classes (incl. worker_map_broken from a broken clear-path authorship row; pct_unusable worker carries 2 bad rows — blank + "50..") + unexpected_tier=2 (annotations — one on a loaded worker, one on the cleared worker); soft ssnInvalid=1, phoneInvalid=1, percentOutOfRange=2; re-run fast-skips all 7 owned workers (adopts only on LOGIC_VERSION bump or `--force-reconcile`), clears 0; clear-write-failure smoke all-PASS |
| 3 | `npx tsx scripts/s1-migration/load-member-statuses.ts` | same | `assignments == workersWithMs`, `rejects: {}` | 28/28 |
| 4 | `npx tsx scripts/s1-migration/load-employers.ts` | same | `rejects: {}`; prod expects ~557 shop contacts → ~920 links (T24) | 10 employers, 8 contacts, 16 links |
| 4b (optional, post-review) | `npx tsx scripts/s1-migration/cleanup-contact-type-options.ts` (report) → operator review → `--apply` | same | Task 344 cleanup after step 4's title-as-type correction: reports every `options_employer_contact_type` row with its `employer_contacts` ref count, split loader-stamped (`data.s1Loader`) vs staff-created. `--apply` deletes ONLY loader-stamped options with zero refs — each delete is one transaction taking FOR UPDATE on the option row and re-checking stamp + refs under the lock, so a concurrent adoption blocks and then fails FK instead of being silently NULLed (smoke: `dev/smoke-contact-type-cleanup.ts`); staff-created rows are never touched, only reported. Optional `--ids id1,id2` limits deletion to an operator-approved subset. Idempotent. | verified with seeded loader/staff orphan pair: report split correct; apply deleted the loader orphan, kept the staff orphan |
| 5 | `npx tsx scripts/s1-migration/load-policies.ts` | `--allow-rejects policy_unmatched_unreferenced` (non-policy `workers_v1` node) | Adopt-only. **Standard sync envelope (§10)** — legacy counters (incl. `mappedToInactive`) under `detail`; re-runs fast-skip unchanged nodes via consumed fingerprints; an S1 retitle re-resolves the nid and RETARGETS its mapping (`detail.remappedNids`). Deletion policy: report-only (`deleted_in_s1` findings block unless allowed, §10). Prod: 15 referenced policy nodes all resolve via the N27 alias table (UNITE HERE Plan family → `UH` since the 2026-08-11 R→UH rename). **Deleted-node orphan refs (23 per §P4) no longer reject** — they map to the Inactive policy (`sirius_id=U`) and surface as `detail.mappedToInactive`, a PER-NID map of election counts (expect nid 8868662 among them; an unexpected nid is a triage item, not an allowance). `policy_ref_not_staged` is retired; the loader aborts at startup if the Inactive policy is missing (run seed-migration-policies first). `policy_unmatched` (referenced, unmatched) is ALWAYS fatal. If the bundle carries non-policy JSON definitions, they reject as `policy_unmatched_unreferenced` — inspect titles, then allow. | 4 mappings, 1 unreferenced non-policy node |
| 5b | `npx tsx scripts/s1-migration/load-employer-policies.ts` | same, no allow flag needed (dev no-ops: synthetic shops lack ledger.policy JSON) | **After employers (4) + policies (5).** Backfills employer_policy_history + denorm_policy_id from the shop's `field_sirius_json` → `ledger.policy.ebh` (the S1 employer Policy tab); without it EVERY migrated election shows "Unknown policy" (elections derive policy from the employer at read time — no election rerun needed). Prod expects `shopsWithPolicy ≈ 248`. **`policy_unmapped` is no longer expected (2026-08-11 ruling):** the former 2 expected rejects — shops 2470203 (HORSESHOE CLUB) + 6283991 (BILTMORE LOS ANGELES), both DEAD accounts whose only "history" is one 1990-01-01 sentinel pointing at deleted policy nid 8868662 — now resolve through step 5's deleted-nid → Inactive id_map entries with no code change (confirmed via seeded-staged-fake smoke 2026-08-11), so those shops gain Inactive policy history dated 1990-01-01 (denorm_policy_id → Inactive), which accurately reflects "referenced a plan that no longer exists". Any `policy_unmapped`, `current_mismatch` or `current_without_history` now means S1 is self-inconsistent — triage before allowing. `verifyFailures: 0`. **Special employers (ruled 2026-08-09):** DISABILITY (12639701), DISABILITY-INDUSTRIAL (12639702), COBRA Employer (13226164) are real S1 shops that map like any employer. COBRA Employer elections carry policy "COBRA" (json definition 13226124); DISABILITY employers have NO policy by design (user corrected the one stray COBRA-policy election in S1) — their elections resolve to the policy default in S2, which is correct; do not treat as `policy_unmapped`. | 10 staged, 0 with policy (documented no-op; parse/write/idempotency covered via seeded staged fakes) |
| 5c | `npx tsx scripts/s1-migration/load-employer-rates.ts --allow-rejects bad_rate` | same (dev no-ops: synthetic shops lack charge_plugins JSON; covered via seeded staged fakes) | **After employers (4) + fund config (bao-hourly charge config must exist — the loader resolves its account and aborts unless exactly one is enabled).** Imports per-employer hourly rate history from shop `field_sirius_json` → `charge_plugins.settings.<uuid>.rates.history` into `sitespecific_bao_employer_rates`; without it post-cutover hours rows silently create NO hourly charges. Prod expects ≈698 rates / ≈136 shops (incl. future-dated rows to 2028 — real negotiated increases). Expected rejects: `bad_rate=2` (known colon typos `6:00`/`6:75` on one shop, cleanly re-entered under another uuid — allow), `rate_conflict=1` — shop 8865846 (CONRAD LOS ANGELES, H0305) has BOTH 5.75 and 6.50 entered for 2023-12-01 under the same instance; the S1 UI report shows the same duplicate pair. Conrad is an ACTIVE hourly employer (rates through 2025) — do NOT skip it via allow; have the fund delete the wrong 2023-12-01 row in S1, re-stage `grievance_shop` (the loader reads staged JSON, not live S1), and rerun. Allowing `rate_conflict` drops Conrad's ENTIRE rate history. `verifyFailures: 0` | 10 staged, 0 with rates (documented no-op; parse/precedence/write/idempotency covered via seeded staged fakes) |
| 6 | `npx tsx scripts/s1-migration/load-relationships.ts` | same | `rejects: {}` — no-start rows load via the N26 default-dates ruling; prod expects `datesDefaulted ≈ 115` | 24 relations, datesDefaulted=2 |
| 7 | `npx tsx scripts/s1-migration/load-employee-ids.ts` | `--allow-rejects duplicate_code` (2 synthetic) | Run clean first. `duplicate_code` may genuinely occur in prod — inspect, then allow with the observed count. On RE-run, one of a dup pair becomes `code_owned_by_other_worker` and one adopts. | 28 created, 10 types, duplicate_code=2 |
| 8 | `npx tsx scripts/s1-migration/load-elections.ts` | `--allow-rejects relation_unmapped` (synthetic dangling relation refs) | **Standard sync envelope (§10) — full reconcile.** Re-runs fast-skip unchanged nids via consumed fingerprints (`detail.fastPathSkips`); an election edited in S1 (dates/benefits/relationships/employer/active) is UPDATED in S2 (`summary.updated`, migration-owned fields overwritten verbatim, S1 wins; policy stays derived — never written); an election deleted in S1 is hard-DELETED via the sweep (`detail.sweep`, suppressed side effects); a mapped S2 row deleted out-of-band rejects as `mapped_row_missing` (triage; drop the mapping to let the next run recreate). Expect `resolved + fastPathSkips + rejects == staged` and `verifyFailures: 0`; rejected nids re-resolve every run (never fingerprint-advanced). Untyped elections remain the prod majority (typed = COVERAGE TIERS, load with NULL `enrollment_type` — finding 2026-08-09; fix ≥ `a000e65b`). **Freeze-era real-target run 2026-08-09:** staged 243,475 → resolved 242,532; 943 rejects, all allowed after triage. First converted run re-resolves everything once (fingerprint bootstrap), then dailies fast-skip. | 40 staged: 35 steady-state fast-skips, 5 `relation_unmapped` traps |
| 9 | `npx tsx scripts/s1-migration/load-benefit-history.ts [--open-end-through <YYYY-MM>]` | `--open-end-through 2026-12` + `--allow-rejects start_missing,subscriber_worker_mismatch,relation_subscriber_mismatch,employer_unresolved` (4 synthetic traps) | **Standard sync envelope (§10) — month-set reconcile.** Desired months are computed set-based into the persistent scratch table `s1_staging.t17_desired_spans` (fingerprints live THERE, not id_map) and diffed against `trust_wmb` for migrated workers: missing months created, stale months deleted, `source_relation_id` divergence repaired, wb anchors auto-created/repointed/retired (`detail.anchors`) so T18 provenance never dangles. `--open-end-through` is now OPTIONAL: **omitted → current LA month** (`detail.openEndThroughSource: "default-current-la-month"`) — the daily dual-run default; pass it explicitly only for the ruled transition month at final cutover (**= the month the migration run happens in, RULED, amended 2026-08-09**) or dev's 2026-12 convention. A later horizon adds only the delta months for open spans; spans closed in S1 retract previously-projected months. Retired rejects: `open_end_through_required`, `open_span_after_through` (now counter `detail.openSpansStartingAfterHorizon`, loads with empty month set), `mapped_anchor_missing` (anchors self-heal). Months beyond the horizon are never deleted (`detail.staleBeyondHorizon` — nonzero during dual-run means something else writes migrated months; investigate). Expect `verifyFailures: 0` (missing/stale/relDiverged/danglingAnchors all 0 post-apply). **Freeze-era real-target run 2026-08-09:** 612,076 staged spans → 528,656 anchors, 6,435,517 month rows, ≈4.2 h wall; 83,420 rejects, every class §5-ruled. First converted run re-resolves everything once (scratch bootstrap — expect freeze-scale wall time), then dailies fast-skip unchanged spans (`detail.fastPathSkips`) and write proportionally to churn. | 102 spans → 98 in scratch, 894 desired months, 24 open, 4 trap rejects |
| 10 | `npx tsx scripts/s1-migration/load-payments.ts` | same | **Standard sync envelope (§10)** — `created+updated+unchanged == staged`, `accounts.failed: 0`; per-status split mirrors S1 (Cleared/Received/Canceled/Failed → cleared/draft/canceled/error). Re-runs fast-skip unchanged payments via fingerprints; a payment changed in S1 (status/amount/date/payer/type) UPDATES the mapped row (memo never touched); a payment deleted in S1 sweeps (hard-delete payment + mapping — the delete cascades that payment's referencing ledger rows, and the sweep FIRST drops those cascaded `ar-*` rows' `ledger-ar` mappings so the standard step-11 run recreates every still-staged AR row without `--force-reconcile`; keep the 10→11 order; `detail.sweep.cascadedArMappingsDropped` / `foreignS1ImportCascades` report the fallout). Crash-repair provenance adoption (`details.s1Nid`) intact. | 30 payments across 3 accounts |
| 11 | `npx tsx scripts/s1-migration/load-ledger.ts` | `--allow-rejects non_cleared_status` (2 Pending) | **After payments.** Non-cleared S1 AR rows are intentionally not migrated → `non_cleared_status` is expected in prod too: verify the count equals the frozen S1 non-cleared count, then allow. `perAccount[*].ok: true` for every account (count+sum match is built in, recomputed post-sweep). **Standard sync envelope (§10)** — identity is id_map `ledger-ar` (`s1 ledger_id ↔ chargePluginKey 'ar-<id>'`); the FIRST converted run mass-adopts every pre-sync s1-import row into id_map (content-equal → mapping only; drifted → update). Changed AR rows (status/amount/memo/account/ts) update in place; rows deleted-or-no-longer-Cleared in S1 sweep (hard-delete via charge-plugin key + mapping). Non-`ar-*` s1-import keys are foreign (t16/t19 allocations) and are never swept. | 58/58 rows, all 3 accounts ok, sums exact |
| 12 | `npx tsx scripts/s1-migration/load-hours.ts --migration-mode` | same | **`--migration-mode` is REQUIRED on prod** (suppresses charge plugins — T18 already migrated ledger; replay = double-billing; the loader preflight aborts if runnable charge plugins exist without it). Hard gate: `verifyMismatchCount: 0`. **`unresolvedWorker`/`unresolvedEmployer` are NOT expected to be 0 on a real extract** (first full real-target run 2026-08-09: 3363 / 7 month-groups) — the report now carries `unresolved*DistinctNids` + ≤20 sample nids per side; triage via 07 §P7: `staged_but_unmapped > 0` = loader gap (MUST fix before cutover), `not_staged` = deleted in S1 (documented skip, confirm with the §P7e/P7f LEFT JOIN node queries). `missing_json` will exceed the ~1,853 sparse-field baseline on any no-freeze extract (observed 3,462) — surplus rows are payperiods whose JSON row landed after the extract read the node (live hours imports racing the extract); they recur in every live extract and their pickup belongs to the parallel-run full-sync design, not to T20 (profile with §P7d/P7g). `legacy_json_format` skips are known-format legacy rows. `multiStatusMonths` counts SAME-employer mixed hour types within one month only — a worker with different statuses at different employers is the supported norm (status is per-employer) and never hits this counter. **No `--allow-rejects` gate by design:** hours has no reject gate — problem rows are counted skips, never fatal; the skip-block + §P7 triage IS the gate. `--stub-missing` is FORBIDDEN on a real target (dev-only crutch). **Sync (§10):** monthly rows converge via the `s1_staging.hours_keys` sidecar — every written (worker, employer, month) key is stamped after its flush; keys NOT restamped by the current run mark stale day=1 rows (payperiods deleted or month-retargeted in S1) for deletion + key removal (`detail.staleHoursCleanup`; skipped on `--dry-run` or when the run's own verify failed). First sync run over a pre-sync target: add `--adopt-hours-keys` once to seed the sidecar from existing mapped-pair rows. | 300 staged → 298 written+verified, 2 legacy skips |
| 13 | `npx tsx scripts/s1-migration/load-call-logs.ts --migration-mode` | + `--allow-rejects category_missing,category_unmapped,handler_missing,handler_unresolved,handler_dangling` (5 synthetic traps, 1 each — requires `dev/seed-call-log-traps.ts` first, re-run after any restage) | Prod ~12K sirius_log rows, only MSR types in scope (others silently out-of-scope, not rejects). Handler refs resolve via id_map contact THEN worker fallback (worker's contact_id; `stats.handlerViaWorker`) — this recovered the rehearsal's ~9.2K `handler_unresolved` (worker refs). `handler_dangling` = no target staged at all (deleted S1 nodes) vs `handler_unresolved` = staged but unmapped (real gap — triage, don't just allow). Category `"issue reported for member"` maps to the new `issue_reported` channel (ruling 2026-08-11); `"letter"` maps to `letter` (ruling 2026-08-11); `"in person visit"` folds into `office_visit` and `"provider call"` maps to the new `provider_call` channel (rulings 2026-08-12 — the prod run's only 2 `category_unmapped` rejects), so residual `category_unmapped` should now be **0** in prod. Expected prod reject profile: `handler_dangling=2` (handler nids 17748264 and 17748261, `unresolvedHandlerNids.notStaged=2`) — verify both as deleted S1 nodes (LEFT JOIN node in MariaDB, §P7e pattern) before allowing via `--allow-rejects handler_dangling`. Triage from the report itself: `unmappedCategories` (per-value tally) and `unresolvedHandlerNids` (byStagedBundle + notStaged). Run clean first; triage real rejects before allowing. | 48 staged → 30 in scope → 25 created (1 via worker fallback, 1 on issue_reported, 1 on office_visit via "in person visit", 1 on provider_call), 5 trap rejects |
| 13b | `npx tsx scripts/s1-migration/load-cardchecks.ts --migration-mode` | requires `dev/seed-cardcheck-fakes.ts` first (synthetic staging has ZERO cardcheck rows; re-run after any restage) + `--allow-rejects disclaimer_missing,handler_dangling,bad_json,handler_unresolved` (seeded traps; steady-state re-runs with unchanged definitions drop `disclaimer_missing` — see dev column); sync smoke `dev/smoke-sync-cardchecks.ts` | **After contacts-workers. ⚠ PREREQUISITE: `cardcheck` component enabled + schema provisioned + app restarted (NOT in the §2 bootstrap set; preflight aborts loudly otherwise).** Definitions upsert by `sirius_id` = definition nid (prod: 4 — two payroll deduction forms, two arbitration agreements), then records (~1,114 at last fund pull). Report emits the staged per-definition × per-status table — diff it against the fund baseline (Kaiser PDF 777 / Health Net PDF 318 / HN arb 12 / Kaiser arb 7; drift expected, S1 is live) — plus defect-class counts (`dualAcceptanceMismatch`, `signedWithoutEsig` — the 768-vs-770 family, `noWorkerHandler` — tolerated skip, never a reject, `unresolvedHandlerNids` dangling vs staged). Expect `handler_dangling` (deleted S1 nodes) in prod — triage nid samples, then allow observed counts; `duplicate_signed`/`create_failed`/`bad_json` need fund triage, never blind-allow. `verifyFailures: 0`; per-cell staged = loaded + rejected + skipped is asserted. **Sync-converted (§10):** mapped records RECONCILE — in-place S1 transitions (unsigned→signed→revoked→wiped-back) and payload edits converge on the next sync through storage updates (the old unconditional mapped-skip is gone; duplicate-signed validation retained); definitions carry composite fingerprints (definition row + resolved disclaimer/customfield nodes); staged-vanished records → report-only `pending_retention` findings (rows + mappings preserved, never deleted/revoked; `--allow-findings pending_retention` per run; STOP-THE-LINE for the final freeze run pending the retention ruling); definition removals → standard `deleted_in_s1`. | defs 2 created; 10 in scope: 6 created, 1 noWorkerHandler skip; rejects 1 each disclaimer_missing, handler_dangling, bad_json, handler_unresolved; defects dualAcceptanceMismatch=1, signedWithoutEsig=1, offlineKeysPresent=1; rerun: records fast-skip 6, defs fast-skip 2, created=0 — `disclaimer_missing` STOPS re-firing once its definition fast-skips, while the record-side seeded rejects (handler_dangling/bad_json/handler_unresolved) re-fire every run because rejected rows never map |
| 14 | `npx tsx scripts/s1-migration/load-enrollment-packet-tags.ts --migration-mode` | same (dev no-ops: synthetic data lacks the keep tag) | scans `sirius_contact` (grain corrected 2026-08-11); `inScope ≈ 14,801` on prod (dev `keepTagTids: []` no-op is a synthetic gap, NOT expected in prod); `duplicateContactNode` small; `rejects: {}`; comm dates are approximate (node `changed`, flagged `dateApproximate`) | 0 in scope (documented no-op) |
| 15 | `npx tsx scripts/s1-migration/load-users.ts` | `--allow-rejects missing_mail,invalid_mail,duplicate_user_email` (synthetic traps) | **After contacts/workers** (T27, active accounts only; uid 0/1 never migrate). Run clean first; triage every fatal class. Reconciliation report (`reconciliation` in output) lists `no_resolvable_worker` / `ambiguous_worker_email` annotations for staff review — annotations don't block accounts. Reruns deactivate accounts blocked/deleted in S1 since the last run (`deactivatedBlocked`/`deactivatedDeleted`) and revoke their migration-owned worker link + role. Role name collisions with pre-existing S2 roles bind to zero-permission `<name> (s1-migrated)` review roles (`roles.collisionDetails`) — review before cutover. `verifyFailures: 0`; `workerLinked` should cover the expected member-account share. | see §4.15 |


### 4.15 Okta pre-provisioning (after load-users + parity)

*(Commands and procedure notes follow §9 below, kept together with the §4.16
canary and §4.17 cutover sections.)*

## 5. Allow-rejects policy table

| Reject class | Loader | Dev rehearsal | Production |
|---|---|---|---|
| `policy_unmatched_unreferenced` | policies | ALLOWED (1 — synthetic `workers_v1`) | Allow ONLY after inspecting reported titles (non-policy JSON definitions) |
| `policy_ref_not_staged` | policies | — | **RETIRED (2026-08-11 ruling).** Deleted-node orphan refs (23 per §P4) map to the Inactive policy (`sirius_id=U`) and report per-nid in `mappedToInactive` — review the nid list instead of allowing a reject. The loader aborts at startup if the Inactive policy is absent. |
| `policy_unmatched` (referenced) | policies | never | NEVER allowable — fix alias table / seed policies |
| `policy_unmapped` | employer-policies | not present | No longer expected (2026-08-11): the 2 dead shops referencing deleted nid 8868662 resolve via the Inactive id_map entries. Any occurrence = S1 self-inconsistency — triage. |
| `duplicate_code` | employee-ids | ALLOWED (2 synthetic) | Run clean; if present, inspect + allow observed count. Re-run shape differs (adopt + `code_owned_by_other_worker`). |
| `start_missing` | benefit-history | ALLOWED (1 synthetic trap) | **RULED 2026-08-09 (rehearsal triage): allow.** 16 spans with no start anchor (mostly inactive end-only rows) — unloadable. |
| `subscriber_worker_mismatch` | benefit-history | ALLOWED (1 synthetic trap) | **RULED 2026-08-09: allow.** 69 spans / 4 distinct pairs; the `field_sirius_worker` side is deleted from S1 (subscriber side maps fine) — unresolvable either way. |
| `relation_subscriber_mismatch` | benefit-history | ALLOWED (1 synthetic trap) | Run clean; triage before allowing |
| `end_before_start` | benefit-history | not present | **RULED 2026-08-09: allow.** Zero/negative-length spans (dominant pattern end = start − 1 day, an S1 cancellation convention, plus raw dirt) — they encode no coverage months. Observed 2026-08-09: 2,553. |
| `benefit_ref_missing` | benefit-history | not present | **RULED 2026-08-09: allow.** Spans with NO benefit field row at all (vs `benefit_unmapped`: ref present but dangling) — same deleted-node family, nothing loadable. Observed: 41. New class surfaced only at the END gate of the first full t17 pass; all writes had persisted, so the rerun with it allowed was adopt-only. |
| `benefit_unmapped` | benefit-history, elections | not present | **RULED 2026-08-09: allow.** Entirely deleted benefit nid 2457521 (BPA-era bad data) — out of scope. Observed 2026-08-09: 6,863 (benefit-history). |
| `worker_unmapped` | benefit-history, elections | ALLOWED (synthetic) | Sampled nids all deleted from S1 (deleted/merged contacts). Allow with observed counts. Observed 2026-08-09: 452 (benefit-history). |
| `relation_unmapped` | benefit-history | not present | **RULED 2026-08-09: allow, documented.** Deleted relationship nodes (15,778 of 37,520 distinct refs). Of 73,891 dangling spans, 73,833 are inactive + end-dated (BPA era). 58 carry active=Yes (54 open-ended, half started 2023+) but a deleted relationship cannot grant benefits (fund rule: relationship must be active), so they are stale-open rows, not live coverage — the 58-nid list was delivered to the fund for S1 cleanup (end-date or verify intentional removal). Underlying S1 gap: deleting a relationship does not close its benefit spans. Final 2026-08-09 run count: 71,964. |
| `employer_unresolved` | benefit-history | not present | Shopless spans (heavily 2020–2021, BPA era). **First rerun t16 elections with the typed-elections fix** (pre-fix, 61,823 coverage-tier-typed elections were skipped entirely and never reached id_map, so the election→employer fallback failed). **2026-08-09 rerun result: the fix worked** — 35,103 → **1,462** (`employerFromElection` rescued 33,881). The 1,462 residue was allowed for the rehearsal; its production disposition (drop vs designated employer) is STILL a pending fund ruling (05-open-questions "Unresolved"). |
| `non_cleared_status` | ledger | ALLOWED (2 Pending) | **Expected** — verify count == frozen S1 non-cleared AR count, then allow |
| `category_missing` / `category_unmapped` / `handler_missing` | call-logs | ALLOWED (1 each, synthetic traps) | Run clean; triage real occurrences (report `unmappedCategories` tallies every unmapped value), then allow with observed counts. First-rehearsal `category_unmapped=700` was entirely `"issue reported for member"` — **RULED 2026-08-11: new `issue_reported` channel**. The prod run's 2 residual rejects — `"in person visit"` (nid 17239418) and `"provider call"` (nid 17267794) — are **RULED 2026-08-12**: "in person visit" folds into `office_visit` (like "visit"), "provider call" becomes the new `provider_call` channel. With those, residual `category_unmapped` should be **0**; any occurrence is a new value needing its own ruling. |
| `handler_unresolved` | call-logs | ALLOWED (1, seeded staged fake) | Staged-but-unmapped handler target = a REAL resolution gap (check report `unresolvedHandlerNids.byStagedBundle` for the bundle). First-rehearsal 9,202 were worker refs, now resolved by the id_map("worker") fallback — expect ~0; triage any occurrence before allowing. |
| `handler_dangling` | call-logs | ALLOWED (1, seeded staged fake) | No handler target exists in staging (deleted S1 nodes — same family as `relation_unmapped`). Verify count against report `unresolvedHandlerNids.notStaged`, then allow with observed counts. **Prod expectation: 2** (handler nids 17748264 and 17748261, `unresolvedHandlerNids.notStaged=2`, observed on the 2026-08 prod run) — verify both nids are deleted S1 nodes (`SELECT ... FROM <ref> LEFT JOIN node ON nid WHERE node.nid IS NULL` in MariaDB) before allowing. |
| `ssn_collision_q36`, `worker_contact_unresolved`, `worker_gender_unresolved`, `sirius_id_assigned`, … | contacts-workers | reported (annotations — non-fatal) | Same; RULED annotation family — the standardized reject gate (§10/§11) still requires the explicit allowance (sync-config lists them), then review counts in the report. `sirius_id_assigned` = workers with no/non-numeric `field_sirius_id` loaded with a sequence-assigned sirius_id (documented T1 rule) |
| sirius_id collision (pre-scan / cross-run) | contacts-workers | not present | **FATAL, no allow flag exists.** Fund finding 2026-08-06: S1's unlocked ID counter duplicated ~1 in 410 sirius_ids; 19 values are each shared by two DISTINCT people (38 workers). The loader aborts before any write and lists the colliding values + nids. NEVER dedupe/merge — that combines two people's benefit histories. Triage: fund re-numbers one member of each pair in S1 (or rules a manual assignment), re-stage, re-run. |
| `bad_json` / `bad_shape` | beneficiaries | `bad_json` ALLOWED (1 seeded trap) | Run clean; unparseable/misshapen `field_sirius_json` is unloadable — inspect nid samples, then allow observed counts |
| `worker_unmapped` | beneficiaries | ALLOWED (1 seeded trap: staged worker with no id_map row) | Expected family: deleted/merged S1 contacts (same as benefit-history) — sample nids, verify, allow observed count |
| `pct_unusable` / `percent_sum_mismatch` | beneficiaries | ALLOWED (1 seeded trap each) | Fund says current data always totals 100 — run clean; any occurrence is S1 dirt for fund triage (fix in S1 + restage, or allow with observed nids documented) |
| `unexpected_tier` | beneficiaries | ALLOWED (2 seeded traps: `contingent`) | ANNOTATION — the primary tier still loads, and a loader-owned list still clears when staged primary is empty (contingent-only staging never preserves a stale primary list). A sibling tier under `beneficiaries` (e.g. `contingent`) is out of scope by ruling; review the reported tier keys, then allow |
| `list_exists_foreign` | beneficiaries | ALLOWED (1 seeded trap: operator-entered list) | A non-empty list the loader does not own is NEVER overwritten. On a fresh target expect 0; any occurrence means staff entered designations post-cutover-start — triage, usually allow (keep staff version) |
| `worker_map_broken` / `write_failed` | beneficiaries | `worker_map_broken` ALLOWED (1 seeded trap: clear-path authorship row → deleted worker); `write_failed` exercised by the dev-only clear-write-failure smoke | NEVER allow blind — an id_map row pointing at a deleted S2 worker (write path or clear-sweep authorship row) or a storage failure is an infrastructure problem; repair, re-run. Both fire on the clear sweep too (`phase` in the sample: `clear`/`clear-read`) — a stale owned list is never silently skipped |
| `disclaimer_missing` / `disclaimer_text_unlocated` / `customfield_missing` / `definition_json_unparseable` / `definition_title_missing` / `definition_write_failed` | cardchecks (definitions pass) | `disclaimer_missing` ALLOWED (1 seeded trap: pointer nid never staged) | Definitions-pass classes. The definition still upserts (body/data best-effort) EXCEPT `definition_title_missing`/`definition_write_failed`, which skip it — its records then reject `definition_unresolved`. `disclaimer_text_unlocated` = disclaimer node staged but the shape-tolerant text reader found nothing (raw JSON is preserved in `data.s1.disclaimer.json`) — triage the shape, extend the reader, don't blind-allow |
| `status_unknown` / `definition_unresolved` / `ambiguous_definition` / `bad_json` / `duplicate_signed` / `create_failed` | cardchecks | `bad_json` ALLOWED (1 seeded trap) | Run clean; `duplicate_signed` = a second signed S1 record for the same worker+definition (storage DUPLICATE_SIGNED guard) — S1-side duplicate, fund triage; `create_failed` carries a sanitized error class only — infrastructure problem, repair and re-run, never allow blind |
| `handler_unresolved` / `handler_dangling` | cardchecks | ALLOWED (1 each, seeded staged fakes) | Same taxonomy as call-logs: `handler_dangling` = no unresolved target staged at all (deleted S1 nodes — verify count against report `unresolvedHandlerNids.notStaged`); `handler_unresolved` = staged-but-unmapped (REAL gap — check `unresolvedHandlerNids.byStagedBundle`). Records with NO worker target at all are NOT rejects — counted as the tolerated `noWorkerHandler` skip class (`[No Handler]` records; `cardchecks.worker_id` is NOT NULL so they cannot load) |
| `mapped_worker_lost` / `update_failed` | cardchecks | not present (update paths covered by `dev/smoke-sync-cardchecks.ts`) | NEVER allow blind. `mapped_worker_lost` = an already-MAPPED record's worker handler no longer resolves — an S1 edit pointed a signed authorization at a different/deleted person; S2 cannot follow, triage the S1 edit. `update_failed` = storage update failed or the mapped S2 row is gone (sample `code: "target_missing"` → repair id_map) — infrastructure problem, repair and re-run |
| `source_worker_missing` (beneficiaries) / `pending_retention` (cardcheck records) — **findings, not rejects** | beneficiaries, cardchecks | exercised by the sync smokes (staged row deleted, then restored) | Report-only deletion-sweep findings (§10): the S1 source vanished from staging but these are member designations / SIGNED AUTHORIZATIONS — the loader preserves rows + mappings and NEVER deletes, revokes, or fabricates lifecycle history. Blocking (exit 1) until acknowledged per run via `--allow-findings source_worker_missing` / `--allow-findings pending_retention`. **STOP-THE-LINE for the final freeze run: a fund/legal retention ruling is required; per-run acknowledgement is a dual-run measure only.** Cardcheck DEFINITIONS removed from S1 use the standard `deleted_in_s1` finding instead |
| `missing_mail` / `invalid_mail` | users | ALLOWED (synthetic traps: 3 staff w/o mail, 1 bad mail) | Run clean; prod staff accounts may genuinely lack mail — inspect, then allow observed counts (those accounts cannot use Okta and need manual handling) |
| `duplicate_user_email` | users | ALLOWED (1 synthetic dup pair) | Run clean; lowest uid wins — triage which account the person actually uses, then allow |
| `no_resolvable_worker` / `ambiguous_worker_email` | users | reported (annotations — non-fatal) | Same; the reconciliation report is the staff-review artifact; unlinked users self-verify via SSN+DOB |

**Forbidden in production (synthetic-only, now unnecessary even in dev):**
`--stub-missing`, `--allow-unresolved-industry`, `--fallback-industry`,
`--fallback-payment-type`, `--allow-rejects owner_missing` (relationships),
`--allow-rejects worker_ref_missing` (elections/employee-ids).
## 6. Parity gate (the run is a FAIL without this)

Both harnesses must PASS. A load that completes but fails parity is a failed
migration with a triage list — do not proceed to cutover.

```bash
# Balance parity: per-account AR count+sum, payment count+sum, net — zero tolerance
npx tsx scripts/s1-migration/verify-balance-parity.ts
# (flags: --tolerance-cents N, --allow-mismatches c1,c2 — both stay at defaults unless the fund rules otherwise)

# Month parity: run for ≥3 months — the freeze month, one mid-history month, one open-span-era month
npx tsx scripts/s1-migration/verify-month-parity.ts \
  --month 2026-09 --max-disagreement-pct 0 --open-end-through 2026-09
```

Rules:
- `--open-end-through` MUST equal the value given to the benefit-history loader
  (= the transition month, §4 row 9; the 2026-08 rehearsal used **2026-08**).
- `--max-disagreement-pct` has no default on purpose; 0 is the target. Any
  non-zero threshold is an explicit fund decision.
- `--allow-unresolved` must mirror the loader's `--allow-rejects` EXACTLY —
  nothing more.
- PASS shape: `disagreementPct: 0`, `missingInS2: 0`, `extraInS2: 0`,
  `wrongBenefitPairs: 0`, `employerMismatchPairs: 0`; balance parity
  `driftCents: 0` on every account and in aggregate, `result: "PASS"`.

Rehearsal evidence: balance parity — 58/58 AR rows, 30/30 payments, drift 0¢ on
all 3 accounts and aggregate. Month parity 2025-06 — 82/82 matched, 0%
disagreement; 2026-06 (open-span era) — 24/24 matched, 0%.

Balance-parity triage procedure (mismatch classes → root causes →
allow-list → drift 0): `docs/s1-migration/08-ledger-payment-reconciliation.md`
— includes the validated debug-query kit (R/M series) and the expected
mismatch-class census derived from recorded t19 rejects.

## 7. Failure & retry guidance

- **Loaders are idempotent.** Every loader resolves `s1_staging.id_map` first and
  skips/adopts already-mapped rows. The retry procedure is always: read the
  report → fix the cause (config, alias table, allowance) → re-run the same
  command. Never wipe the target to retry a single loader.
- **Reports and run history** land in `s1_staging.runs` — the audit trail of
  every attempt, with the same aggregates-only JSON that was printed.
- Re-run counter shapes shift by design: `created` → `matched`/`adopted`/
  `alreadyMapped`; employee-ids dup pairs become one adopt + one
  `code_owned_by_other_worker`.
- **stage.ts re-run** re-extracts and re-verifies counts; safe to repeat at
  any time. **The historical same-freeze-only restage constraint is RETIRED:
  the entire fleet is converted (§10)** — every loader's re-run after ANY
  restage is a true reconcile (t27 users and §4.0b trust-config reconcile by
  full scan each run rather than fingerprints, with the same effect). The
  standard way to restage + re-run everything is the one-command sync (§11).
- **Converted loaders reconcile, not just adopt (§10).** Their re-runs
  classify every mapped row (created / updated / unchanged / deleted-in-S1)
  from consumed fingerprints and skip unchanged rows without per-row storage
  reads. Any transform-logic change REQUIRES a `LOGIC_VERSION` bump in the
  loader, or corrected shapes silently fail to propagate to rows whose S1
  content didn't change.
- If a loader exits 1 with `FAIL: reject reason(s) not allowed`, that is the
  fail-loud policy working: triage each reason, then allow explicitly.
- **The allow-gate evaluates at END of run, after all writes.** A run that
  fails the gate has already persisted its rows and id_map entries — the
  corrected re-run is adopt-only and much faster (2026-08-09: t17's gated
  first pass wrote everything in ≈4.2 h; the rerun with the new class allowed
  adopted 528,656 anchors / 6,435,517 month rows, created 0).
- The verify pass inside each loader (`verifyFailures`) re-reads what was
  written; any non-zero value is a stop-the-line defect, never allowable.

## 8. Timings (dev rehearsal) and prod window estimation

Dev volume: ~1,050 staged nodes, 102 spans, 300 payperiods, 60 AR rows, over
WAN to a Neon target (per-write round-trips dominate at this scale — treat rates
as conservative).

| Step | Dev time | Dev rows | Rate (rows/s) |
|---|---|---|---|
| stage --all | 21.4 s | ~1,050 nodes + 70 terms + 60 AR | ~50 |
| options | 2.9 s | 70 terms | — |
| contacts-workers | 44.2 s | 74 contacts + 52 workers | ~2.8 |
| member-statuses | 8.4 s | 28 | ~3.3 |
| employers | 6.0 s | 10 + 8 contacts | — |
| policies | 3.0 s | 5 refs | — |
| relationships | 9.1 s | 24 | ~2.6 |
| employee-ids | 7.2 s | 30 | ~4.2 |
| elections | 10.6 s | 40 | ~3.8 |
| benefit-history | 35.9 s | 102 spans → 896 month rows | ~25 month-rows/s |
| payments | 8.8 s | 30 | ~3.4 |
| ledger | 11.7 s | 60 | ~5.1 |
| hours | 72.0 s | 298 payperiods | ~4.1 |
| call-logs | 5.5 s | 30 in scope (incl. seeded staged fakes) | ~4.5 |
| enrollment-packet-tags | 2.8 s | 0 in scope | — |
| balance parity | 1.9 s | — | — |
| month parity (each) | 2.9 s | 102 spans scanned | — |

**Estimation method for the prod window:** prod rows ÷ the dev rate, then halve
the estimate's uncertainty by timing the FIRST loader (options) and the first
10K rows of contacts-workers on the day and re-extrapolating. At dev rates the
big four at prod volume (~557 employer contacts, ~243K elections, ~609K spans,
~1M+ payperiods, ~12K logs) are **tens of hours** — the in-boundary run
(low-latency DB link) should be much faster, but plan the freeze window from a
measured in-boundary rate, not this table, and treat hours (T20) and
benefit-history (T17) as the long poles.

**Real-target reference points (migration-rehearsal-2026-08-06, ECS in-VPC →
Neon, 2026-08-09):** benefit-history — 612,076 staged spans in ≈4.2 h
(cumulative rate declines to a ≈41 spans/s steady state as indexes grow —
normal). Hours — **completed 2026-08-11: 3,620,645 staged payperiods →
3,613,766 written+verified, 0 verify mismatches, ≈2 days wall clock
(2026-08-09 → 2026-08-11).** Most of that wall clock was an index gap, not
inherent cost: `upsertWorkerHours` seq-scanned `worker_hours` per row
(throughput decayed ~12 → ~8 rows/s) until `worker_hours_worker_id_idx` was
created live mid-run on 2026-08-10, after which throughput recovered.
**Prerequisite for any future hours run: that index must exist before the
load starts — migration 1121 now guarantees it on every bootstrapped
target** (IF NOT EXISTS no-op where it was created live), so a
bootstrap-target'd database is already covered; expect the cutover run to be
substantially faster than the rehearsal's 2 days. Idempotent adopt-only
re-runs are far faster than first loads. Use these, not the dev table, as the
basis for the cutover-window plan until better in-boundary measurements
exist.

## 9. Rehearsal reset procedure (dev only, recoverable)

The rehearsal target is a **separate database** (`s2_rehearsal`) on the dev
Postgres host — shared dev state (`neondb`) is never touched. Reset = drop +
recreate, then:

```bash
# 0. (once per synthetic refresh) regenerate prod-shaped S1 synthetic data
S1_DATABASE_URL="$(printf %s "$S1_DATABASE_URL" | tr -d '[:space:]')" node scripts/s1-migration/generate.mjs

# 1. point everything at it (all subsequent commands)
export EXTERNAL_DATABASE_URL="<dev-host-url>/s2_rehearsal"

# 2. one command: schema + wipe (admin preserved) + components + seeds
#    (creates the DB's contents in place; if the DB itself doesn't exist yet,
#     CREATE DATABASE s2_rehearsal on the dev host first)
npx tsx scripts/s1-migration/bootstrap-target.ts --wipe

# 3. run §4 with the dev-column flags (stage → seed-trust-config → loaders),
#    then §6 with --open-end-through 2026-12
```

Wipe-and-retry guarantees are covered by automated failure-injection tests
(throwaway DB, created and dropped on the dev Postgres host — nothing shared
is touched):

```bash
npx tsx scripts/oneoffs/s1-wipe-retry-tests.ts
```

They prove: (1) a wipe aborted mid-transaction (thrown error or SIGKILL,
after truncate and pre-commit) leaves the target unchanged; (2) `--wipe
--keep-staging` clears `s1_staging.id_map`/`runs` so retrying
seed-trust-config + a loader recreates every row (no stale id_map skips, no
duplicates); (3) concurrent bootstrap/seed runs are refused by the advisory
lock (key 727001). Run them after any change to `bootstrap-target.ts` wipe
logic — also registered as the `s1-wipe-retry` validation step.

Dev-only notes:
- The `s1-smoke-dev-only` validation fingerprints the OLD staged shape on the
  shared dev DB; it stays green as long as the shared dev staging schema is not
  re-staged from the regenerated S1. Re-staging the shared dev DB requires
  updating the smoke guard fingerprint first.
- Dev uses `--open-end-through 2026-12` (synthetic open spans extend past any
  realistic transition month); production uses the transition month (§4 row 9).
  The parity harness must be given the same value the loader used, in each
  environment.


## 10. Dual-run sync semantics (ALL fleet loaders converted)

S1 stays live and authoritative for ~1 month after the initial production
load, with roughly daily S1→S2 syncs (full re-stage → re-run loaders). S2 is
shadow/read-only during the dual-run; **S1 wins migration-owned fields
unconditionally** (ruled conflict policy). Staging already mirrors S1 exactly
(upsert + watermark stale-delete); this section covers how converted loaders
turn a re-run into a true reconcile.

**Mechanism.**
- Staged rows (records, terms, raw ledger, raw user tables) carry
  `content_hash` — a canonical SHA-256 of source content only (scalars +
  key-sorted fields JSON; extraction metadata excluded), written at staging
  upsert time. Count-verify and watermark semantics are unchanged.
- `s1_staging.id_map` carries `consumed_fingerprint`, `logic_version`,
  `last_synced_at`, `s1_deleted_at` (upgraded in place by `ensureIdMap`).
- Each converted loader declares a required `LOGIC_VERSION`. The consumed
  fingerprint is derived from the staged hash(es) — composite inputs combine
  multiple labeled hashes — so a row reconciles when EITHER its S1 content
  changed OR the loader's transform logic changed (version bump).
- Fast path: mapped + fingerprint match + version match → `unchanged`,
  skipped without any per-row storage read. Fingerprints advance only AFTER
  the loader's verify pass, so failed writes stay retryable. Rows with NULL
  staged hashes never fast-skip (they classify as changed until the next
  real `stage.ts` run populates hashes — harmless adopt/patch).
- **`--force-reconcile`** ignores matching fingerprints for the run (envelope
  reports `forceReconcile: true`). Use for emergency repair — e.g. S2 rows
  edited or damaged out-of-band — and for validation; ordinary
  adoption/ownership safeguards still apply. S1 wins: forced runs overwrite
  migration-owned fields back to staged values.

**Deletion sweep.** After its writes+verify, a converted loader sweeps
non-stub id_map entries whose S1 source vanished from staging and applies its
declared per-entity policy: hard-delete (through storage), deactivate (stamps
`s1_deleted_at`), or report-only. Options and policies are both
**report-only** (options rows and policies may be FK-referenced by live S2
data — deletion needs an operator ruling); elections and benefit-history
month rows are **hard-delete** (suppressed storage writes; delete-policy
sweeps do NOT raise blocking findings — only report-only sweeps do).
Report-only findings are TYPED
(`deleted_in_s1`) and BLOCKING: the loader exits 1 until the finding is
resolved (restore in S1 + restage, or rule and remove the mapping) or
explicitly acknowledged per run via `--allow-findings deleted_in_s1`.
Mappings and provenance stay intact; findings re-emit on every run until
resolved. Already-deactivated entries count as `alreadyHandled`, not new
findings.

### 10.1 Money loaders (t19 payments / t18 ledger / t20 hours)

All three
reconcile with **hard-delete** sweep policies (S1 wins; every write under
charge-plugin + notification suppression — no sync run can bill):
- *t18 ledger* — identity is id_map entity `ledger-ar` (S1 `ledger_id` ↔
  `chargePluginKey 'ar-<id>'`, plugin `s1-import`). The first converted run
  mass-adopts every pre-sync s1-import row (content-equal rows get a mapping
  write only). Changed AR rows update through `ledger.entries.update`; rows
  deleted OR no-longer-Cleared in S1 hard-delete by charge-plugin key. Every
  run also opens with a degraded-reference heal pre-pass (`detail.refHeal`):
  rows carrying `referenceType='s1-unknown'` whose stashed nid NOW resolves
  in id_map get their fingerprint cleared and re-resolve through the normal
  update path — a payment deleted-then-restored in S1 (or any late-arriving
  mapping) converges on the ordinary next run, no `--force-reconcile`;
  still-dangling refs (S1-deleted nodes) are counted and never re-written. The
  per-account count + cents-exact verify recomputes AFTER the sweep. Non-`ar-*`
  s1-import keys belong to other loaders and are never swept.
- *t19 payments* — changed S1 payments update migration-owned fields on the
  mapped row (status/allocated/amount/type/payer EA/dates; memo is
  staff-owned and never touched); S1-deleted payments hard-delete the payment
  + mapping. `payments.delete` cascades that payment's referencing ledger
  rows, so the sweep FIRST drops the cascaded `ar-*` rows' `ledger-ar`
  mappings (drop-before-delete: mapping-gone-but-row-present converges via
  t18's adopt path; the reverse would fast-skip forever) — then **t18 runs
  after t19** (RUNBOOK order rows 10→11) and recreates still-staged AR rows
  through its ordinary new-row path, no `--force-reconcile` needed. Payment
  references in AR rows resolve via id_map `payment`, which is also why t19
  runs first. Cascaded s1-import rows with non-`ar-*` keys belong to other
  loaders and are only counted (`foreignS1ImportCascades`) for triage.
- *t20 hours* — aggregates (payperiods → monthly rows) can't fingerprint
  per-row; convergence uses the `s1_staging.hours_keys` sidecar: written
  (worker, employer, month) keys are stamped per flush; keys not restamped by
  the current run mark stale day=1 rows for delete + key removal
  (`detail.staleHoursCleanup`), gated off on `--dry-run` or a failed verify so
  a broken run never deletes. Only sidecar-listed keys are ever deletable
  (rows are reconstructible aggregates). `--adopt-hours-keys` seeds the
  sidecar from existing mapped-pair rows — needed ONCE on a pre-sync target.
- Dev smoke: `npx tsx scripts/s1-migration/dev/smoke-money-sync.ts --phase
  payments|ledger|hours|parity` proves update/sweep convergence per loader
  plus a 0-drift `verify-balance-parity` run.

**Standard result envelope.** Converted loaders emit (stdout JSON, plus a
file when `S1_RESULT_JSON_PATH` is set — for orchestration):

```
summary:  { created, updated, unchanged, deleted, deactivated, reportOnly, rejected }
rejectGate: { status: pass|fail, counts, allowed, disallowed }
verify:     { status: pass|fail, failures: [] }
findings / blockingFindings   (typed, aggregates-only)
detail:     the loader's full legacy domain report (nested, nothing dropped)
```

Exit code is 1 on reject-gate failure, verify failure, or unresolved blocking
findings. Reports stay aggregates-only (no names/PII), and say when
`--force-reconcile` was used.

**Rules of thumb.**
- Transform change → bump that loader's `LOGIC_VERSION` in the same commit.
- Unchanged counters on a post-restage re-run mean "confirmed in sync", not
  "skipped work": that IS the daily sync green path.
- `--force-reconcile` is the escape hatch when fingerprints can't be trusted
  (repair after out-of-band S2 changes); it never changes source data or
  mappings.
- The ENTIRE fleet now reconciles (t27 users and §4.0b trust-config by full
  scan each run rather than fingerprints — same effect): §7's same-freeze
  restage constraint is retired, and §11's one-command sync is the standard
  way to run the fleet.
- Dev smoke: `npx tsx scripts/s1-migration/dev/smoke-sync-foundation.ts
  --phase units|options|policies` proves unchanged-skip, S1-edit update,
  logic-version-only update, forced update, and vanished-source handling
  end to end (also wired into the `typecheck`/`typecheck-scripts`
  validations for static health).

### 10.2 Beneficiaries & cardchecks specifics

- `load-beneficiaries` (entity `bao-beneficiaries`): the consumed fingerprint
  encodes the DECODED staged state — absent key, empty primary list,
  malformed JSON and populated rows are all distinguishable — so absent/empty
  still drives the owned clear sweep and malformed still rejects; unchanged
  owned workers skip BEFORE any S2 read, and replace-all writes, foreign-list
  protection and exact-list verification are unchanged. Sweep policy: a
  staged worker that vanished ENTIRELY emits report-only
  `source_worker_missing` (S2 list + authorship mapping preserved) —
  blocking until `--allow-findings source_worker_missing`, STOP-THE-LINE for
  the final freeze run (fund ruling required). A deleted S2 target stays the
  fatal `worker_map_broken` reject, never a finding.
- `load-cardchecks` (entities `cardcheck`, `cardcheck-definition`): record
  fingerprints combine the staged content hash with resolved
  worker/definition IDENTITY (mapped ids — not definition content), so a
  definition body edit reconciles the definition WITHOUT stampeding its
  records; definition fingerprints are composite over the definition row +
  resolved disclaimer/customfield pointer nodes (unstaged pointer targets
  contribute a `missing:<nid>` sentinel, so definition-pass rejects like
  `disclaimer_missing` re-fire only when the definition actually
  reprocesses). Mapped records now UPDATE through storage on
  status/signed-date/payload/worker/definition/logic-version change —
  in-place S1 transitions (unsigned→signed→revoked→wiped-back) converge on
  the next sync and immediately affect eligibility reads; duplicate-signed
  validation is retained. Sweep policy: records removed from the staged
  in-scope set are report-only `pending_retention` findings with per-status
  aggregates (`detail.sweep.records.pendingRetentionByStatus`) — rows and
  mappings preserved, NEVER deleted, revoked, or given fabricated lifecycle
  history; STOP-THE-LINE for the final freeze run until the fund/legal
  retention ruling. Definitions use the standard `deleted_in_s1` finding.

- Beneficiaries & cardchecks sync smokes (both need the §4 seeded fakes in
  place):
  `dev/smoke-sync-beneficiaries.ts` — unchanged skip without S2 reads, drift
  immunity, force/version reconcile, owned clear, vanished-source
  `source_worker_missing` policy (block → acknowledge → restore);
  `dev/smoke-sync-cardchecks.ts` — unsigned→signed→revoked→wiped-back
  transitions with eligibility flips, payload-only edit, version-only
  refresh, definition-input edit precision (records do NOT reprocess),
  duplicate-signed conflict, deleted-source `pending_retention` behavior.

### 10.3 Elections + benefit-history specifics (t16/t17)

- t17's unit of reconciliation is the MONTH SET, not the row: desired months
  derive from ALL staged spans covering a (worker, employer, benefit,
  relation) tuple via the scratch table `s1_staging.t17_desired_spans`, then
  diff set-based against `trust_wmb`. Fingerprints + logic_version live on
  the scratch rows, NOT id_map; the id_map `wb` entry remains purely the T18
  provenance anchor and must always point at a live `trust_wmb` row — the
  anchor pass repoints/retires/creates accordingly every run. Dropping the
  scratch table is safe: the next run re-resolves all spans (freeze-scale
  wall time) and converges to the same state.
- Stale-month deletion is scoped to migrated workers (non-stub id_map worker
  mappings) at months ≤ the horizon; everything else is untouchable.
  Corollary: **the S2 benefits scan must stay OFF for migrated workers during
  the dual-run** — rows it writes in covered months would be swept as stale
  on the next sync (see `detail.staleBeyondHorizon` for the beyond-horizon
  early-warning counter).
- **Horizon rule (§9 stands):** the parity harness must be given the SAME
  `--open-end-through` the loader last used, per environment.
- **After an id_map repair/remap** (worker/benefit/relation retarget, or an
  election remap), t17 scratch rows still carry resolutions computed from the
  OLD mappings and their fingerprints won't budge — run
  `load-benefit-history.ts --force-reconcile` once to rebuild. EXCEPTION
  (automatic): election-EMPLOYER drift needs no force — scratch rows flagged
  `employer_from_election` re-check their election's current employer every
  run (`detail.employerRefreshedFromElection`).
- Rejected spans keep their last-good scratch rows
  (`detail.rejectedWithStaleDesired`) — coverage never vanishes because one
  daily extract went bad; fix the reject, the next run reconciles.
- Dev smoke: `npx tsx scripts/s1-migration/dev/smoke-sync-elections-benefits.ts
  [--phase elections|benefits|parity]` proves S1-edit update,
  delete+recreate, extend/shorten/retarget/close-open convergence,
  rel-divergence repair, horizon advance/retract, anchor maintenance, and
  month parity (3 ruled months at `--max-disagreement-pct 0`) end to end.
  Prereq after a synthetic regen: re-run `load-relationships.ts` first
  (per-type id_map liveness — with zero live relation mappings every
  dependent span rejects `relation_unmapped`).

## 11. One-command daily sync (`sync.ts`) — full-fleet gates

    npx tsx scripts/s1-migration/sync.ts --mode daily [--profile production] \
        [--dry-run] [--force-reconcile] [--skip-stage] [--keep-going]

One run = migration advisory lock (727001; concurrent sync/bootstrap/seed
refused) → `stage.ts` (count-verified, abort on any mismatch) → dev fake
re-seeds (dev profile only) → the WHOLE loader fleet in §3 order with the
§5-ruled allowances → per-loader verify/reject/finding gates → balance parity
(0¢) + month parity (rolling ruled months) → ONE aggregate report printed and
persisted to `s1_staging.runs` (`report->>'command' = 'sync'`; also written
to `S1_RESULT_JSON_PATH` when set). Exit 0 only when EVERY gate passes.

**Config is checked in** (`sync-config.ts`), never ad-hoc shell flags: fleet
order (§3, including beneficiaries + cardchecks), per-loader `--allow-rejects`
(§5 rulings), per-loader LOGIC_VERSION expectations, open-end policy
(production: current LA month — the open-span month advances per sync; dev:
pinned), parity month selection (freeze month + one mid-history month + the
current open-span month), and the ruled report-only finding kinds per mode.
UNKNOWN reject/finding classes are never forwarded — loaders fail closed on
them (§5 fail-loud policy). Config changes are commits, reviewed like code.

**Result contract (no log scraping).** Every fleet step must write the §10
standard envelope to its `S1_RESULT_JSON_PATH` file. The orchestrator
validates presence, schema, loader name, dry-run/force echo, and
LOGIC_VERSION against `sync-config.ts` — a transform fix that bumps a
loader's version without updating sync-config FAILS the run (the §10 bump
rule, enforced), and a loader that exits 0 without a valid envelope fails the
run too. All counters aggregate from envelopes only.

**Gates** (any failure ⇒ exit 1; a later PASS never overrides an earlier
failure — balance/month parity cover money and coverage, NOT contacts,
beneficiaries, cardchecks, call logs, packet tags or other entity/config
state; loader-level exact verification is the convergence gate for those):

| gate | fails when |
|---|---|
| stage | any staged-vs-S1 count mismatch (aborts before any loader runs) |
| fleet | any loader: non-zero exit, missing/malformed envelope, LOGIC_VERSION drift, disallowed reject class, `verifyFailures` ≠ 0, blocking findings |
| findings (mode) | final-freeze: ANY unresolved report-only finding, ruled or not (daily: ruled kinds surface in the report for triage) |
| balance parity | any account drifts ≥ 1¢ (`--tolerance-cents 0`) |
| month parity | any ruled month fails at `--max-disagreement-pct 0` (allow-unresolved mirrors t17's §5 allowances exactly) |

**Modes.**
- `--mode daily` — the dual-run daily. Ruled report-only deletion findings
  (`deleted_in_s1`, `source_worker_missing`, `pending_retention`) surface in
  the aggregate report for triage; retained rows stay untouched.
- `--mode final-freeze` — the cutover sync against frozen S1. EVERY
  unresolved report-only finding is stop-the-line (signed cardchecks pending
  a retention ruling, beneficiary lists whose source worker vanished,
  unresolved S1 deletes) — resolve in S1 + restage, or rule the mapping away;
  per-run acknowledgement does not unblock this mode.

**Controls.**
- `--dry-run` — stage + dev seeds still run (staging is migration scratch);
  loaders run with `--dry-run` (no S2 writes, preview counters); parity and
  the runs row are skipped (they would judge/record the un-applied state).
- `--force-reconcile` — forwarded to every supporting loader; §10
  emergency-repair semantics; recorded PROMINENTLY (console banner +
  top-level `forceReconcile: true` + per-step echo in the report).
- `--skip-stage` — re-run gates/loaders against staging as-is (mid-fleet
  retry without the ~25-min restage).
- `--keep-going` — collect every loader's result instead of aborting at the
  first failed step (the run still fails; use for fleet-wide triage).

**Concurrency / retry.** One sync per target, ever — enforced by the same
advisory lock the bootstrap/seed tools take. Failed runs are safely
re-runnable (§7): loaders are idempotent reconcilers and fingerprints only
advance after each loader's verify pass.

**Rehearsal proof** (throwaway DB; never the shared dev DB):
`npx tsx scripts/s1-migration/dev/smoke-sync-fleet.ts` bootstraps a fresh
target, then proves end to end: lock refusal; a full stage→fleet→parity PASS
from the synthetic MariaDB; dry-run + force-reconcile forwarding (no runs
row); synthetic S1 adds/edits/deletes across people, config, beneficiaries,
cardchecks, elections, benefit months and money (including source deletions)
converging through one daily sync with all three finding kinds surfaced;
final-freeze BLOCKED by the retained deletions while fleet + parity gates
pass; and final-freeze PASS after the S1 side is restored.

## 12. Dual-run procedure (initial load → daily sync → freeze → cutover)

1. **Initial production load** — §2 bootstrap, then the §4 command sequence
   for the first full load (operator-paced, per-step triage), §6 parity.
   Okta pre-provisioning (§4.15) is DEFERRED to step 5.
2. **Daily sync + triage (~1 month)** — once per day, operator-invoked from
   inside the production boundary (§1; no cron, no app-hosted automation):
   `npx tsx scripts/s1-migration/sync.ts --mode daily`. Read the aggregate
   report (console or `s1_staging.runs`). Triage rules:
   - New reject class → triage (§5), obtain the fund ruling, then add it to
     `sync-config.ts` (a reviewed commit) — never a one-off shell flag.
   - Report-only findings → rule each one: restore the row in S1 (next sync
     converges) or record the explicit ruling. Final-freeze requires ZERO
     unresolved findings, so rulings cannot be deferred indefinitely.
   - Transform fix shipped → bump that loader's `LOGIC_VERSION` and
     `sync-config.ts` in the SAME commit; the next daily reconciles the
     corrected shape everywhere. The orchestrator fails on version drift, so
     a forgotten bump cannot pass silently.
   - Out-of-band S2 damage suspected → one `--force-reconcile` run (recorded
     in the report), then investigate how S2 got touched during shadow.
3. **S1 freeze** — the fund stops writing to S1; confirm quiesce (§4.0
   freeze checklist / final crawl).
4. **Final-freeze sync** — `npx tsx scripts/s1-migration/sync.ts --mode
   final-freeze`. Must be FULLY green: every loader's verify/reject gate,
   zero unresolved report-only findings, balance parity at 0¢, all ruled
   months at 0% disagreement. This is the final data movement of the
   migration.
5. **Okta provisioning → canary → cutover** — §4.15 → §4.16 → §4.17
   (manual, unchanged by the sync command).

### 4.15 (continued) Okta pre-provisioning commands

```bash
# ALWAYS first: dry-run — reports would-create/reuse/ambiguous, touches nothing
npx tsx scripts/s1-migration/provision-okta-users.ts

# CUTOVER ONLY: full real run (creates Okta accounts + sends activation emails)
OKTA_API_TOKEN=... npx tsx scripts/s1-migration/provision-okta-users.ts --execute
```

- Dry-run is the default; `--execute` is required to touch Okta. Without
  `OKTA_API_TOKEN`, dry-run uses a stubbed client (existence checks report
  "not found" — a warning says so). With a token set, dry-run performs REAL
  lookups; a stale/invalid token fails loudly as `okta_lookup_failed` on
  every user (observed dev 2026-08-06: 401 Invalid token) — either fix the
  token or unset it (`env -u OKTA_API_TOKEN …`) for a DB-state-only report.
- Idempotent + resume-safe: users with an existing okta `auth_identities` row
  are skipped, so a partially-failed run is re-run with the same command.
- `ambiguousOkta` (>1 Okta account with the login) and `failures` exit 1 —
  triage each before re-running.
- Expected dry-run shape (rehearsal): `wouldCreate == active migrated users`,
  `ambiguousOkta: []`, every would-create row with a worker link flagged.

### 4.16 Canary end-to-end procedure (repeatable)

The single REAL Okta test account proves loader → provisioning → live
sign-in → pre-linked worker, end to end. Everything else stays synthetic.

1. **Designate** the canary email = the real Okta test account's login.
   Regenerate synthetic S1 with `S1_CANARY_EMAIL=<email>` — worker index 1's
   contact and its member user account both carry that email.
2. **Run the pipeline** (§4.0–§4.15): stage → loaders (incl. load-users) →
   provisioning dry-run. Confirm in the load-users report that the canary is
   in `workerLinked`, and in the S2 DB that
   `users.data.migratedWorkerId` points at the synthetic worker.
3. **Provision the canary only**:
   `provision-okta-users.ts --execute --only <canary-email>` with a real
   `OKTA_API_TOKEN`. Confirm one Okta account (member group assigned) and one
   `auth_identities` row (externalId = Okta user id, metadata.workerId set).
4. **Sign in for real** through the new Okta app with the canary account
   (activation email → set password). Verify the session lands on the
   pre-created S2 user (NOT a new account), the worker profile is the
   attached synthetic worker, roles include `worker` + migrated S1 roles, and
   worker-facing data (statuses/benefits) renders.
5. **Reset (to re-run):** delete the canary's `auth_identities` row and the
   Okta test account (or deactivate+delete in Okta admin), reset
   `users.account_status` to `pending`; re-run from step 3. A full data reset
   is §9.

### 4.17 CUTOVER (manual, runbook-only)

- The **activation-email wave** = §4.15 full `--execute` run at cutover, after
  the final prod load + parity PASS. It is deliberately NOT part of any
  rehearsal or automated sequence.
- Staff accounts with no mail (missing_mail rejects) need manual Okta
  handling — list them from the final reconciliation report.

# Canary only (rehearsal / pre-cutover check) — the ONLY real run before cutover
OKTA_API_TOKEN=... npx tsx scripts/s1-migration/provision-okta-users.ts \
  --execute --only "$S1_CANARY_EMAIL"
