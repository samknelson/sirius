---
name: Benefits scan fixed-point for same-run dependencies
description: Eligibility rules that check "does the worker have benefit X this month" must see the outcome of the same scan run, not pre-scan DB state.
---

The rule: any eligibility plugin that checks current-month benefit membership (e.g. Linked benefits) must read the scan's effective set, not the database, during a benefits scan.

**Why:** the scan decides create/delete for all policy benefits in one run; a single DB-based pass makes dependent benefits lag one month behind their prerequisite (chicken-and-egg: prerequisite gets "Create", dependents get "No Change").

**How to apply:** the executor threads an optional `presentBenefitIds: ReadonlySet<string>` through `EligibilityEvaluationInput` → `EligibilityContext`. The benefits scan iterates to a fixed point (effective set = current records − deletes + creates, bounded by benefit count + 1 passes, warn on non-convergence). Plugins use the set when present and fall back to the DB query for standalone/test-page evaluations. New membership-checking plugins must follow the same pattern; anti-monotone rules could oscillate — last pass wins.
