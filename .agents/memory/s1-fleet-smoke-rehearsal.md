---
name: Fleet-sync rehearsal smoke pattern
description: Throwaway-DB full-fleet rehearsal (smoke-sync-fleet) and the cross-loader constraints on choosing synthetic mutation targets
---

`scripts/s1-migration/dev/smoke-sync-fleet.ts` proves sync convergence on a throwaway Postgres DB (`s1_fleet_smoke` on the local helium host): setup → lock-refusal → initial → dry-run → mutate → modes (final-freeze block/unblock) → cleanup. Children get overridden `EXTERNAL_DATABASE_URL`/`DATABASE_URL`; never point it at shared dev Neon. DB is kept on failure for post-mortem queries.

Choosing mutation targets is cross-loader constrained — a "random staged row" breaks unrelated gates:

- **Delete-target worker must not be user-linked**: t27 verify fails with "retains stale migration-owned worker link" if a user's resolved worker vanishes from staging. All synthetic bene-fake carriers were user-linked until seed-beneficiary-fakes started preferring non-user-linked workers (stable ORDER BY user-linked flag, then nid).
- **Delete-target worker should avoid duplicate-code employee families** (belt-and-suspenders; the real fix is the loader-side claim registration — see rerun-reject-stability).
- **Edit-only targets need none of those exclusions** — an edit deletes nothing, so pct-edit candidates scan the full bene-mapped pool.
- **Dev-structural findings are the assertion baseline, not zero**: clean dev runs always report exactly `{sweep_skipped_no_keep_tag_terms: 1}`; assert equality with that baseline, not emptiness.
- Staged `field_sirius_contact` / `field_sirius_worker` refs come in four shapes (scalar, {target_id}, [scalar], [{target_id}]); blind `->> ::bigint` casts crash on the array shape — extract via ordered `#>>` paths + jsonb_typeof CASE before one outer cast.

**Why:** rehearsal must prove loader-verify convergence and findings-by-mode behavior, not just parity; a mis-chosen mutation manufactures failures in loaders the mutation never intended to test.
**How to apply:** when adding a new mutation to the smoke, ask which OTHER loaders read that entity (links, dedup registries, ownership signals) before picking the target row.
