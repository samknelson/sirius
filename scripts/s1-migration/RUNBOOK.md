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

### Running in the prod boundary (migration image)

The deployed web image is lean (no `tsx`, no `scripts/`), so the migration runs
from the dedicated **`migration` build target** of the same `Dockerfile`:

```bash
docker build --target migration -t sirius-migration:<git-sha> .
```

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
4. **Components** — enables the fund set: `bulk`, `debug`, `employer.company`,
   `ledger` + all `ledger.*`, `sitespecific.bao`, `system.sftp.client`, all
   `trust.*`, `worker.relations`.
5. **Seeds** (all idempotent) — policies (all 7: PA, R, EC, COBRA + RES, TT, U),
   employment statuses, genders, call reasons.

`trust_providers` / `trust_benefits` are **not** seeded here — they derive from
the staged S1 nodes (§4.0b), so no hand-maintained benefit list exists anywhere.

Remaining manual preconditions:
1. **S1 access** — read access to the frozen S1 MariaDB from the migration host.
2. **App traffic stopped** on the target for the duration of the run (loaders
   suppress notifications and — with `--migration-mode` — charge plugins, but
   concurrent user writes would race the id_map).

## 3. Load order (load-bearing — do not reorder)

```
bootstrap-target → stage → seed-trust-config → options → contacts/workers
→ member-statuses → employers → policies → relationships → employee-ids
→ users → elections → benefit-history → payments → ledger → hours
→ call-logs → enrollment-packet-tags → parity gates
→ okta pre-provisioning (dry-run; real bulk run is a CUTOVER step)
```

Key ordering facts:
- **payments before ledger** — AR allocation rows reference payment nids.
- **relationships after contacts/workers** — running relationships first breaks
  worker-number sequence initialization (setval ordering).
- **policies after employers**, **elections after policies + benefit config**.
- call-logs needs contacts (handler resolution); enrollment-packet-tags needs
  workers + wmb.
- **seed-trust-config after stage, before elections/benefit-history** — it
  creates `trust_providers`/`trust_benefits` from the staged S1 nodes.
- **users after contacts/workers** — the T27 uid→worker pre-link resolves
  through id_map `worker`; running users first leaves every account unlinked.

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

### 4.1 – 4.14 Loaders

**Liveness (heartbeats now cover the loaders, not just staging).** Every
long-running loader (contacts-workers, relationships, elections,
benefit-history, payments, ledger, hours, call-logs, enrollment-packet-tags)
emits a once-a-minute heartbeat to stdout — the same timer-driven mechanism as
the staging heartbeat, aggregates only (counts/elapsed/rate; never names, nids
beyond counts, or row contents):

```
  progress <loader>: done=N/M (P%) elapsed=Es rate=R rows/s        # row loop
  progress <loader>: phase=pre-scan done=N/M elapsed=Es (liveness) # silent phases
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

**Storage-op log throttling (migration runs only).** The same loaders throttle
the per-row `Storage operation: ...` logging — both the console line and the
`winston_logs` DB insert — to 1-in-500 per operation by default, so each row
write costs one round-trip instead of several. A one-line notice on stderr at
loader start confirms throttling is active. `S1_LOADER_LOG_SAMPLE` tunes it
(`0` = suppress entirely, `1` = full per-row logging, `N` = every Nth).
App-server logging behavior is unchanged — only loader processes throttle.

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
| 1 | `npx tsx scripts/s1-migration/load-options.ts` | same | `unhandledVocabularies: {}`, `workerMsUnresolvedIndustry: 0`, `hourTypeVerify: "ok"`, `verifyFailures: 0`. Every worker-ms term resolves an industry (Q37). | 70 terms; created 4 industries, 10 relation types, 7 member statuses, 8 payment types |
| 2 | `npx tsx scripts/s1-migration/load-contacts-workers.ts` | same | `contacts.created+matched ≈ staged`; **T1 ruling 2026-08-06:** `workers.sirius_id = field_sirius_id`, nid → "Legacy NID" worker_ids row (every loaded worker gets one; no "Sirius ID" rows). Rejects are **annotations** (row still loads where possible): expect `ssn_collision_q36` (small), `worker_contact_unresolved` (small), `sirius_id_assigned` (workers with no field_sirius_id — count unknown in prod, triage the report); `sirius_id_not_numeric` expects 0 — triage any occurrence; **sirius_id collisions are FATAL** (pre-scan aborts before any write; no allow flag — see §5); `verifyFailures: 0` (includes sirius_id==field_sirius_id and Legacy NID coverage checks) | 74 contacts, 50 workers, 184 worker ids; rejects ssn_collision_q36=2, worker_contact_unresolved=2, sirius_id_assigned=2 |
| 3 | `npx tsx scripts/s1-migration/load-member-statuses.ts` | same | `assignments == workersWithMs`, `rejects: {}` | 28/28 |
| 4 | `npx tsx scripts/s1-migration/load-employers.ts` | same | `rejects: {}`; prod expects ~557 shop contacts → ~920 links (T24) | 10 employers, 8 contacts, 16 links |
| 5 | `npx tsx scripts/s1-migration/load-policies.ts --allow-rejects policy_ref_not_staged` | `--allow-rejects policy_unmatched_unreferenced` (non-policy `workers_v1` node) | Adopt-only. Prod: 15 referenced policy nodes all resolve via the N27 alias table; `policy_ref_not_staged = 23` (deleted-node orphan refs, §P4). `policy_unmatched` (referenced, unmatched) is ALWAYS fatal. If the bundle carries non-policy JSON definitions, they reject as `policy_unmatched_unreferenced` — inspect titles, then allow. | 4 mappings, 1 unreferenced non-policy node |
| 5b | `npx tsx scripts/s1-migration/load-employer-policies.ts` | same (dev no-ops: synthetic shops lack ledger.policy JSON) | **After employers (4) + policies (5).** Backfills employer_policy_history + denorm_policy_id from the shop's `field_sirius_json` → `ledger.policy.ebh` (the S1 employer Policy tab); without it EVERY migrated election shows "Unknown policy" (elections derive policy from the employer at read time — no election rerun needed). Prod expects `shopsWithPolicy ≈ 248`. Run clean first; `current_mismatch`/`current_without_history` mean S1 is self-inconsistent — triage before allowing. `verifyFailures: 0` | 10 staged, 0 with policy (documented no-op; parse/write/idempotency covered via seeded staged fakes) |
| 5c | `npx tsx scripts/s1-migration/load-employer-rates.ts --allow-rejects bad_rate` | same (dev no-ops: synthetic shops lack charge_plugins JSON; covered via seeded staged fakes) | **After employers (4) + fund config (bao-hourly charge config must exist — the loader resolves its account and aborts unless exactly one is enabled).** Imports per-employer hourly rate history from shop `field_sirius_json` → `charge_plugins.settings.<uuid>.rates.history` into `sitespecific_bao_employer_rates`; without it post-cutover hours rows silently create NO hourly charges. Prod expects ≈698 rates / ≈136 shops (incl. future-dated rows to 2028 — real negotiated increases). Expected rejects: `bad_rate=2` (known colon typos `6:00`/`6:75` on one shop, cleanly re-entered under another uuid — allow), `rate_conflict=1` (one shop has two different rates for the same date under the same instance — S1 self-inconsistent; fix in S1 and rerun, or explicitly add `rate_conflict` to the allow list to skip that shop). `verifyFailures: 0` | 10 staged, 0 with rates (documented no-op; parse/precedence/write/idempotency covered via seeded staged fakes) |
| 6 | `npx tsx scripts/s1-migration/load-relationships.ts` | same | `rejects: {}` — no-start rows load via the N26 default-dates ruling; prod expects `datesDefaulted ≈ 115` | 24 relations, datesDefaulted=2 |
| 7 | `npx tsx scripts/s1-migration/load-employee-ids.ts` | `--allow-rejects duplicate_code` (2 synthetic) | Run clean first. `duplicate_code` may genuinely occur in prod — inspect, then allow with the observed count. On RE-run, one of a dup pair becomes `code_owned_by_other_worker` and one adopts. | 28 created, 10 types, duplicate_code=2 |
| 8 | `npx tsx scripts/s1-migration/load-elections.ts` | same | `resolved == staged`, `benefitResolution.unresolved: 0`, `ambiguousNames: 0`; untyped elections are the prod majority (expected) | 40/40; 30 untyped |
| 9 | `npx tsx scripts/s1-migration/load-benefit-history.ts --open-end-through 2026-09` | `--open-end-through 2026-12` + `--allow-rejects start_missing,subscriber_worker_mismatch,relation_subscriber_mismatch` (3 synthetic traps) | **`--open-end-through 2026-09` is the RULED production value** (freeze month; cutover 2026-10-01). Prod ~609K spans. Run clean first; every reject is a triage item. `benefitResolution.unresolved: 0`, `verifyFailures: 0`, open-span share ≈ 27%. | 102 spans → 99 resolved, 24 open, 896 month rows, 3 trap rejects |
| 10 | `npx tsx scripts/s1-migration/load-payments.ts` | same | `created+adopted == staged`, `accounts.failed: 0`; per-status split mirrors S1 (Cleared/Received/Canceled/Failed → cleared/draft/canceled/error) | 30 payments across 3 accounts |
| 11 | `npx tsx scripts/s1-migration/load-ledger.ts` | `--allow-rejects non_cleared_status` (2 Pending) | **After payments.** Non-cleared S1 AR rows are intentionally not migrated → `non_cleared_status` is expected in prod too: verify the count equals the frozen S1 non-cleared count, then allow. `perAccount[*].ok: true` for every account (count+sum match is built in). | 58/58 rows, all 3 accounts ok, sums exact |
| 12 | `npx tsx scripts/s1-migration/load-hours.ts --migration-mode` | same | **`--migration-mode` is REQUIRED on prod** (suppresses charge plugins — T18 already migrated ledger; replay = double-billing; the loader preflight aborts if runnable charge plugins exist without it). `verifyMismatchCount: 0`, `unresolvedWorker/Employer: 0`; `legacy_json_format` skips are known-format legacy rows | 300 staged → 298 written+verified, 2 legacy skips |
| 13 | `npx tsx scripts/s1-migration/load-call-logs.ts --migration-mode` | + `--allow-rejects category_missing,category_unmapped,handler_missing,handler_unresolved` (4 synthetic traps, 1 each) | Prod ~12K sirius_log rows, only MSR types in scope (others silently out-of-scope, not rejects). Run clean first; triage real handler/category rejects before allowing. | 42 staged → 25 in scope → 21 created, 4 trap rejects |
| 14 | `npx tsx scripts/s1-migration/load-enrollment-packet-tags.ts --migration-mode` | same (dev no-ops: synthetic data lacks the keep tag) | `inScope > 0` on prod (dev `keepTagTids: []` no-op is a synthetic gap, NOT expected in prod); `duplicateWorkerMonth` small; `rejects: {}` | 200 staged, 0 in scope (documented no-op) |
| 15 | `npx tsx scripts/s1-migration/load-users.ts` | `--allow-rejects missing_mail,invalid_mail,duplicate_user_email` (synthetic traps) | **After contacts/workers** (T27, active accounts only; uid 0/1 never migrate). Run clean first; triage every fatal class. Reconciliation report (`reconciliation` in output) lists `no_resolvable_worker` / `ambiguous_worker_email` annotations for staff review — annotations don't block accounts. Reruns deactivate accounts blocked/deleted in S1 since the last run (`deactivatedBlocked`/`deactivatedDeleted`) and revoke their migration-owned worker link + role. Role name collisions with pre-existing S2 roles bind to zero-permission `<name> (s1-migrated)` review roles (`roles.collisionDetails`) — review before cutover. `verifyFailures: 0`; `workerLinked` should cover the expected member-account share. | see §4.15 |


### 4.15 Okta pre-provisioning (after load-users + parity)

```bash
## 5. Allow-rejects policy table

| Reject class | Loader | Dev rehearsal | Production |
|---|---|---|---|
| `policy_unmatched_unreferenced` | policies | ALLOWED (1 — synthetic `workers_v1`) | Allow ONLY after inspecting reported titles (non-policy JSON definitions) |
| `policy_ref_not_staged` | policies | not present | **Expected: 23** (deleted-node orphan refs, §P4). Allow. |
| `policy_unmatched` (referenced) | policies | never | NEVER allowable — fix alias table / seed policies |
| `duplicate_code` | employee-ids | ALLOWED (2 synthetic) | Run clean; if present, inspect + allow observed count. Re-run shape differs (adopt + `code_owned_by_other_worker`). |
| `start_missing` | benefit-history | ALLOWED (1 synthetic trap) | Run clean; triage before allowing |
| `subscriber_worker_mismatch` | benefit-history | ALLOWED (1 synthetic trap) | Run clean; triage before allowing |
| `relation_subscriber_mismatch` | benefit-history | ALLOWED (1 synthetic trap) | Run clean; triage before allowing |
| `non_cleared_status` | ledger | ALLOWED (2 Pending) | **Expected** — verify count == frozen S1 non-cleared AR count, then allow |
| `category_missing` / `category_unmapped` / `handler_missing` / `handler_unresolved` | call-logs | ALLOWED (1 each, synthetic traps) | Run clean; triage real occurrences, then allow with observed counts |
| `ssn_collision_q36`, `worker_contact_unresolved`, `worker_gender_unresolved`, `sirius_id_assigned`, … | contacts-workers | reported (annotations — non-fatal) | Same; review the report, no flag needed. `sirius_id_assigned` = workers with no/non-numeric `field_sirius_id` loaded with a sequence-assigned sirius_id (documented T1 rule) |
| sirius_id collision (pre-scan / cross-run) | contacts-workers | not present | **FATAL, no allow flag exists.** Fund finding 2026-08-06: S1's unlocked ID counter duplicated ~1 in 410 sirius_ids; 19 values are each shared by two DISTINCT people (38 workers). The loader aborts before any write and lists the colliding values + nids. NEVER dedupe/merge — that combines two people's benefit histories. Triage: fund re-numbers one member of each pair in S1 (or rules a manual assignment), re-stage, re-run. |
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
  (prod: **2026-09**).
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
- **stage.ts re-run** re-extracts and re-verifies counts; safe to repeat, but
  re-staging after loaders have run must only happen from the SAME freeze
  snapshot.
- If a loader exits 1 with `FAIL: reject reason(s) not allowed`, that is the
  fail-loud policy working: triage each reason, then allow explicitly.
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
| call-logs | 5.5 s | 25 in scope | ~4.5 |
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
- Dev uses `--open-end-through 2026-12` (synthetic open spans extend past the
  ruled prod freeze month); production uses **2026-09**. The parity harness must
  be given the same value the loader used, in each environment.


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
