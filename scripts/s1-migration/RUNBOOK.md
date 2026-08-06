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
   `roles`, and `role_permissions`, **always preserving the admin user**
   (`--admin-email`, default `mmcdermott@cgtconsultinginc.com`) with their auth
   identities and role assignments, and drops `s1_staging` for a fresh stage
   (`--keep-staging` to skip).
3. **Admin** — creates the admin user + full-permission `admin` role if absent.
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
→ elections → benefit-history → payments → ledger → hours
→ call-logs → enrollment-packet-tags → parity gates
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

| # | Command (prod) | Dev rehearsal delta | Expected counter shape (prod) | Dev-observed (reference) |
|---|---|---|---|---|
| 1 | `npx tsx scripts/s1-migration/load-options.ts` | same | `unhandledVocabularies: {}`, `workerMsUnresolvedIndustry: 0`, `hourTypeVerify: "ok"`, `verifyFailures: 0`. Every worker-ms term resolves an industry (Q37). | 70 terms; created 4 industries, 10 relation types, 7 member statuses, 8 payment types |
| 2 | `npx tsx scripts/s1-migration/load-contacts-workers.ts` | same | `contacts.created+matched ≈ staged`; rejects are **annotations** (row still loads where possible): expect `ssn_collision_q36` (small), `worker_contact_unresolved` (small); `verifyFailures: 0` | 74 contacts, 50 workers, 182 worker ids; rejects ssn_collision_q36=2, worker_contact_unresolved=2 |
| 3 | `npx tsx scripts/s1-migration/load-member-statuses.ts` | same | `assignments == workersWithMs`, `rejects: {}` | 28/28 |
| 4 | `npx tsx scripts/s1-migration/load-employers.ts` | same | `rejects: {}`; prod expects ~557 shop contacts → ~920 links (T24) | 10 employers, 8 contacts, 16 links |
| 5 | `npx tsx scripts/s1-migration/load-policies.ts --allow-rejects policy_ref_not_staged` | `--allow-rejects policy_unmatched_unreferenced` (non-policy `workers_v1` node) | Adopt-only. Prod: 15 referenced policy nodes all resolve via the N27 alias table; `policy_ref_not_staged = 23` (deleted-node orphan refs, §P4). `policy_unmatched` (referenced, unmatched) is ALWAYS fatal. If the bundle carries non-policy JSON definitions, they reject as `policy_unmatched_unreferenced` — inspect titles, then allow. | 4 mappings, 1 unreferenced non-policy node |
| 6 | `npx tsx scripts/s1-migration/load-relationships.ts` | same | `rejects: {}` — no-start rows load via the N26 default-dates ruling; prod expects `datesDefaulted ≈ 115` | 24 relations, datesDefaulted=2 |
| 7 | `npx tsx scripts/s1-migration/load-employee-ids.ts` | `--allow-rejects duplicate_code` (2 synthetic) | Run clean first. `duplicate_code` may genuinely occur in prod — inspect, then allow with the observed count. On RE-run, one of a dup pair becomes `code_owned_by_other_worker` and one adopts. | 28 created, 10 types, duplicate_code=2 |
| 8 | `npx tsx scripts/s1-migration/load-elections.ts` | same | `resolved == staged`, `benefitResolution.unresolved: 0`, `ambiguousNames: 0`; untyped elections are the prod majority (expected) | 40/40; 30 untyped |
| 9 | `npx tsx scripts/s1-migration/load-benefit-history.ts --open-end-through 2026-09` | `--open-end-through 2026-12` + `--allow-rejects start_missing,subscriber_worker_mismatch,relation_subscriber_mismatch` (3 synthetic traps) | **`--open-end-through 2026-09` is the RULED production value** (freeze month; cutover 2026-10-01). Prod ~609K spans. Run clean first; every reject is a triage item. `benefitResolution.unresolved: 0`, `verifyFailures: 0`, open-span share ≈ 27%. | 102 spans → 99 resolved, 24 open, 896 month rows, 3 trap rejects |
| 10 | `npx tsx scripts/s1-migration/load-payments.ts` | same | `created+adopted == staged`, `accounts.failed: 0`; per-status split mirrors S1 (Cleared/Received/Canceled/Failed → cleared/draft/canceled/error) | 30 payments across 3 accounts |
| 11 | `npx tsx scripts/s1-migration/load-ledger.ts` | `--allow-rejects non_cleared_status` (2 Pending) | **After payments.** Non-cleared S1 AR rows are intentionally not migrated → `non_cleared_status` is expected in prod too: verify the count equals the frozen S1 non-cleared count, then allow. `perAccount[*].ok: true` for every account (count+sum match is built in). | 58/58 rows, all 3 accounts ok, sums exact |
| 12 | `npx tsx scripts/s1-migration/load-hours.ts --migration-mode` | same | **`--migration-mode` is REQUIRED on prod** (suppresses charge plugins — T18 already migrated ledger; replay = double-billing; the loader preflight aborts if runnable charge plugins exist without it). `verifyMismatchCount: 0`, `unresolvedWorker/Employer: 0`; `legacy_json_format` skips are known-format legacy rows | 300 staged → 298 written+verified, 2 legacy skips |
| 13 | `npx tsx scripts/s1-migration/load-call-logs.ts --migration-mode` | + `--allow-rejects category_missing,category_unmapped,handler_missing,handler_unresolved` (4 synthetic traps, 1 each) | Prod ~12K sirius_log rows, only MSR types in scope (others silently out-of-scope, not rejects). Run clean first; triage real handler/category rejects before allowing. | 42 staged → 25 in scope → 21 created, 4 trap rejects |
| 14 | `npx tsx scripts/s1-migration/load-enrollment-packet-tags.ts --migration-mode` | same (dev no-ops: synthetic data lacks the keep tag) | `inScope > 0` on prod (dev `keepTagTids: []` no-op is a synthetic gap, NOT expected in prod); `duplicateWorkerMonth` small; `rejects: {}` | 200 staged, 0 in scope (documented no-op) |

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
| `ssn_collision_q36`, `worker_contact_unresolved`, `worker_gender_unresolved`, … | contacts-workers | reported (annotations — non-fatal) | Same; review the report, no flag needed |

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
