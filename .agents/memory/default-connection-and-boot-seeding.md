---
name: Default connection resolution and manual T631 configuration
description: Why an ambiguous default must be refused rather than guessed, and why T631 has no automatic legacy migration or startup seeding.
---

## Refuse an ambiguous default; do not pick one

When a caller asks for "the" connection without naming one and more than one is enabled,
raise a conflict instead of taking the first by ordering.

**Why:** picking by ordering looks harmless because the wrong choice usually still
*works*. It stops looking harmless when the operation is a sync that deactivates every
record absent from the answer it was handed. Two connections then take turns deactivating
each other's members, on a schedule, with nothing in any log looking wrong. A refusal is
noisy and immediate; a silent wrong default corrupts data quietly.

The same split matters in what the resolution throws: **misconfiguration throws, remote
and network conditions return a result.** A scheduled job must not be able to read
"credential broken" as "the vendor says there are no members" — that is the same
deactivation bug arriving by a different road.

**How to apply:** resolve-the-default is its own function with its own error types (none
enabled, more than one enabled), and the ambiguous one carries the competing ids so the
message can name them. Routes must map those statuses through instead of flattening them
to 500.

## T631 configuration is manual and authoritative

Do not migrate, seed, repair, or synthesize a T631 vendor connection from legacy
environment variables. The operator creates the plugin row and its named combined JSON
credential secret manually in every deployment.

**Why:** the owner explicitly chose a clean cutover over compatibility machinery. The new
plugin configuration is authoritative and final; deployments are intentionally allowed to
lose T631 connectivity until they are manually configured.

**How to apply:** startup remains healthy when no connection exists. T631 operations must
fail clearly before making a remote call. Do not add a legacy fallback, migration script,
startup blocker, startup migration test, or boot-time seed for this integration.
