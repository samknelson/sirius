---
name: S1 migration rehearsal target pattern
description: How to stand up/reset a full-chain rehearsal target, and the gotchas the first full rehearsal exposed
---

# S1 migration rehearsal target pattern

The verified procedure lives in `scripts/s1-migration/RUNBOOK.md` (incl. the dev reset appendix). Durable lessons behind it:

- **Rehearsal target = separate database on the dev Postgres host**, never the shared dev DB. Reset = drop-with-force + recreate; the role has CREATEDB.
- **Empty-DB bootstrap is schema-only**: it stamps the migration counter at head, so data-seed migrations never execute and optional components are not provisioned. A fresh target needs component provisioning (retry to fixed point for dependency order) plus re-applied idempotent data seeds; the bootstrap script wraps all of this as the ONE setup command.
- **The S1 DSN secret carries trailing whitespace** → raw DSN consumers fail with a mangled database name. Strip with `tr -d '[:space:]'` before use.
- **Parity harness allowances must mirror loader allowances exactly** (same allow-lists, same open-end cutoff per environment), else spurious FAIL.
- Dev-to-prod timing extrapolation is unreliable (WAN round-trips dominate); re-measure rates in-boundary before committing to a freeze window.
- Wipe is one atomic tx (snapshot admin state → truncate → restore); a keep-staging wipe must still clear id_map + run history or loaders skip recreation against truncated targets.
- A single advisory lock guards all migration tooling; release the lock client BEFORE ending the pool or the process hangs.
- After touching wipe/retry logic, rerun its failure-injection harness. SIGKILLed children's DB backends briefly outlive the process — poll pg_stat_activity before asserting rollback, and scope assertions to fixture rows.
