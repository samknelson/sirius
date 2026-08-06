---
name: S1 migration rehearsal target pattern
description: How to stand up/reset a full-chain rehearsal target, and the gotchas the first full rehearsal exposed
---

# S1 migration rehearsal target pattern

The verified procedure lives in `scripts/s1-migration/RUNBOOK.md` (§9 dev reset appendix). Durable lessons behind it:

- **Rehearsal target = separate database on the dev Postgres host** (`s2_rehearsal`), never the shared dev DB. Reset is `DROP DATABASE ... WITH (FORCE)` + recreate — cheap, recoverable, keeps counters meaningful. The role has CREATEDB.
- **Empty-DB bootstrap is schema-only**: `ALLOW_EMPTY_DB_BOOTSTRAP=1` creates core + default-enabled component tables and STAMPS `migrations_version` at head — but data-seed migrations never execute (e.g. the seeded `options_call_reason` rows) and optional components are not provisioned. A fresh-bootstrapped target needs: component provisioning via `enableComponentSchema` per enabled schema-managing component (retry-to-fixed-point handles dependency order), plus re-applying any idempotent migration data seeds. Tracked helpers: `scripts/s1-migration/dev/{enable-components,seed-genders,seed-call-reasons}.ts`.
- **`S1_DATABASE_URL` secret carries trailing whitespace** → raw DSN consumers (generate.mjs / mysql2 URL parse) fail with `Incorrect database name 'smf_prod '`. Wrap: `S1_DATABASE_URL="$(printf %s "$S1_DATABASE_URL" | tr -d '[:space:]')"`. Loader `createS1Pool` tolerates it; anything else may not.
- **Policy bundle is a generic JSON-definition store**: `sirius_json_definition` can hold non-policy nodes (dev: `workers_v1`). load-policies rejects unmatched rows that no election references as allowable `policy_unmatched_unreferenced`; referenced-but-unmatched stays unconditionally fatal.
- **Parity harness allowances mirror loader allowances exactly** — `verify-month-parity --allow-unresolved` must equal the benefit-history `--allow-rejects` list, and `--open-end-through` must equal the loader's value per environment (prod ruling: 2026-09; dev synthetic: 2026-12).
- Dev-to-prod timing extrapolation is unreliable (WAN round-trips dominate at ~4 rows/s per loader); the runbook mandates re-measuring rates in-boundary on day one before committing to the freeze window.

**Why:** the first full rehearsal (2026-08-06) failed at exactly these points (components missing → relation-type writes failed, call-logs abort on unseeded reasons, policies fatal on workers_v1) before running clean end-to-end with all parity gates at 0 drift/0 disagreement.

## Zero-preconfig bootstrap (2026-08-06)
- `bootstrap-target.ts` is the ONE setup command (schema + `--wipe` + components + seeds); `seed-trust-config.ts` derives trust_providers/trust_benefits from staged S1 nodes AFTER stage.ts — no hand benefit list anywhere (§4.15 carry-over-as-is; covers Carelon EAP vs BH, VSP vs VSP Enhanced, Progyny).
- Wipe is one atomic tx (snapshot admin → truncate all except variables/roles/role_permissions → restore); `--keep-staging` must clear s1_staging.id_map+runs or loaders skip recreation against truncated targets.
- Advisory lock key 727001 = single-run guard for migration tooling; release the lock client BEFORE pool.end() or the process hangs forever.
- Wipe/retry guarantees have an automated failure-injection harness (see RUNBOOK §9); rerun it after touching wipe logic. Lesson: SIGKILLed children's pool backends outlive the process briefly — poll pg_stat_activity before asserting rollback, and scope assertions to fixture rows because post-wipe seed steps repopulate baseline data.
- Month-parity `--allow-unresolved` must mirror the benefit-history loader's `--allow-rejects` exactly, else spurious FAIL.
