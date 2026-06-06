---
name: Charge configs read via generic plugin search must re-apply legacy ordering
description: When a charge-specific storage namespace is consolidated onto storage.pluginConfigs.search("charge", …), single-row lookups must re-sort by account-nulls-last/id in TS.
---

When charge config reads were consolidated off a dedicated charge storage
namespace and onto the generic `storage.pluginConfigs.search("charge", {...})`
surface, single-row lookups lost their ordering guarantee silently.

**Rule:** The generic plugin-config search orders results by `(ordering, id)`.
The legacy charge single-row picks (first-enabled-by-plugin, by-plugin-and-scope)
ordered by `account ASC NULLS LAST, id ASC`. These differ. Any lookup that
depends on *which single row wins* must re-apply the legacy order in TypeScript
(a `pickFirstByAccountOrder`-style comparator) after mapping search envelopes —
do NOT rely on the generic search order for determinism.

**Also:** non-employer scopes (global/batch) must constrain `employerId: null`;
employer scope passes the employerId. The global/employer override merge
(employer config overrides the global targeting the SAME account, null account
is its own bucket) is billing-critical and lives in a pure, unit-tested helper —
keep it pure so parity can be asserted without a database.

**Why:** charge resolution is billing-critical; a different row winning, or a
missing `employerId IS NULL` constraint pulling in employer rows for a
global lookup, changes what a worker is charged. The author-time type checker
will not catch an ordering/semantics regression — only behavioral parity tests
(see `scripts/oneoffs/verify-charge-config-resolution.ts`) will.

**How to apply:** any time you move a bespoke config read onto the generic
`pluginConfigs.search`, map envelopes with the kind's `toXConfig` helper, then
re-impose the legacy single-row ordering and scope/employer null constraints
that the old storage method enforced in SQL.
