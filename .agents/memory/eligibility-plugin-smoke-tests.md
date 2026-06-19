---
name: Eligibility plugin smoke tests
description: How to write standalone tsx smoke tests for trust eligibility plugins (no DB), and the import-order gotcha.
---

# Eligibility plugin smoke tests

Trust eligibility plugins live in
`server/plugins/trust/eligibility/plugins/*.ts` and expose
`evaluate(context: EligibilityContext, config): Promise<EligibilityResult>`.
There is no Jest/Vitest for them — the convention is a standalone `tsx`
"smoke test" script under `scripts/oneoffs/smoke-test-<plugin>.ts` with a
tiny `check(label, ok)` helper, run via `npx tsx scripts/oneoffs/...`.
Canonical example: `smoke-test-ageout.ts` (pure, no storage).

**Plugins that read storage** (e.g. `election` reads
`storage.workerTrustElections.getActiveByWorkerAsOf`,
`storage.workerRelations.get`, `storage.trustBenefits.getTrustBenefit`):
stub those methods in-memory on the imported `storage` singleton so no real
query runs. The plugin holds a reference to the same `storage` object, so
reassigning its methods before calling `evaluate` works.

**Import-order gotcha (will bite you):** importing the plugin module FIRST
triggers `ReferenceError: Cannot access 'PluginRegistry' before
initialization` (a circular import surfaced by load order). Import
`server/storage/database` BEFORE importing the plugin — that initializes the
module graph in the same order the app boots, after which the plugin import
is safe.
