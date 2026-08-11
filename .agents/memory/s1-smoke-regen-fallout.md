---
name: S1 smoke guard/expectations vs regenerated staging
description: Dev staging regen gave synthetic payments real types; the s1 smoke guard fingerprint and t16–t19 smoke expectations are stale.
---

The synthetic dev staging was regenerated at some point before 2026-08-11: all 30 staged `sirius_payment` rows now carry `field_sirius_payment_type` (real term ids), where the original synthetic set was entirely type-less.

**Consequences (pre-existing, observed 2026-08-11):**
- `scripts/dev/run-s1-smoke-guarded.ts` REFUSES to run — its dev fingerprint requires "exactly 30 sirius_payment rows, ALL type-less". So the `s1-smoke-dev-only` validation fails at the guard, before any smoke logic.
- Running `scripts/oneoffs/s1-t16-t19-smoke.ts` directly (target verified as dev first!): t16/t17/t19 loader *exit codes* are 1 because the 30 real typed payments now reject as `payment_type_term_unmapped` (22) + `payment_type_option_missing` (8) — no id_map term entries / payment-type options exist in dev. The t19 "typeless real rows rejected === 30" assert is stale. T18 per-account parity also disagrees (real staged AR/payment set drifted from the hardcoded expectations). 17 failing checks total, all in t16–t19 sections.

**Why:** The guard fingerprint and smoke asserts hardcode the ORIGINAL synthetic dataset signature; regeneration silently invalidated both (same family as the id_map-staleness regen note).

**How to apply:** Don't treat these 17 failures (or the guard refusal) as regressions from current work. Fixing requires updating guard fingerprint + t19/t18 expectations coherently against the regenerated data (proposed as a follow-up of the policy-rulings task). The policy/seeder smoke sections run fine and the suite's `check()` never aborts, so new sections can still be validated by a direct run after confirming the target is the dev DB.
