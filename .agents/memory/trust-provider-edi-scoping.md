---
name: Trust-provider EDI scoping decision
description: Why EDI file membership is scoped by benefit, not by the config's providerId
---

Rule: File membership is defined solely by the configured benefit — workers with a monthly benefit record for that benefit in the as-of month (user decision: "EDI files are driven by benefits", not elections). Covered dependents follow their granted monthly coverage, not today's family.

**Why:** The legacy generators scoped by benefit. The provider field is an organizational label, not a membership filter.

Membership EDI classifies employer Sirius IDs `COBRA` and `13226164` as COBRA; never infer this from names or database UUIDs. Ordinary employer identity changes preserve segment continuity. COBRA class changes start new EDI segments but do not terminate a continuing benefit. Mixed classes or distinct family sources require explicit run-only administrator selection, never automatic precedence.

**Why:** The user confirmed the numeric Sirius ID and subsequently chose run-scoped source selection to handle S1 overlap conflicts. This supersedes the earlier correction-only EDI refusal, not S2's source-data policy. Ordinary same-family/same-class employer overlaps remain equivalent.

**How to apply:** Keep choices confined to membership EDI; they do not authorize dual coverage, changing COBRA eligibility, cases, grants, billing, inference or S1. Never inherit approvals into another run. Use historical classifications and preserve separate benefit/family identities. Generation must not repair source coverage.

The config UI labels the provider field "Provider (label only — does not filter members)" so admins aren't misled. Layout risk is pinned by a registry-driven conformance suite (`tests/edi/`): provider-neutral behavior is asserted once for every registered provider, each provider declares its field table on the plugin and an independent transcription of the legacy PHP layout as a checked-in fixture, and a provider registered without that fixture fails the suite. Golden records and provider quirks (Kaiser overpunch, HealthNet member type) sit alongside as per-provider assertions.

**How to apply:** New EDI file-type plugins should scope by benefit the same way; if a provider↔benefit relation is ever added, tighten `getPrimaryKeys` in each plugin and validate configs point at benefits owned by their provider.

Background evidence checking is a responsiveness change, not a confirmed fix for the reported gateway failure or permission to weaken historical evidence.

**Why:** The user identified synchronous discovery as a plausible cause of a 502, not an established cause. Historical continuity and later reinstatement must remain authoritative regardless of runtime cost.

**How to apply:** Distinguish synthetic computation timings from live query latency. Do not claim the gateway cause was proven, impose an arbitrary history cutoff, or treat an unavailable/stale heartbeat as permission to retry interrupted work.

Resource work must first scope authoritative queries and share historical
calculation; process isolation is conditional on measured residual responsiveness
risk, not a substitute for bounded reads. Do not introduce a persisted coverage
span denormalization without separate approval.

**Why:** The approved approach preserves complete EDI family/class segments and
reinstatement evidence while avoiding another freshness/backfill subsystem.

**How to apply:** Measure real database ingestion, peak process memory and
concurrent requests on an isolated target. A heap-growth threshold measured from
one starting sample is not a retained-memory estimate: garbage collection policy
can make the same completed workload show very different peaks. Report the
runtime limits used, and keep local evidence distinct from staging acceptance.
