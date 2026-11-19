---
name: Trust-provider EDI scoping decision
description: Why EDI file membership is scoped by benefit, not by the config's providerId
---

Rule: File membership is defined solely by the configured benefit — workers with a monthly benefit record for that benefit in the as-of month (user decision: "EDI files are driven by benefits", not elections). Covered dependents follow their granted monthly coverage, not today's family.

**Why:** The legacy generators scoped by benefit. The provider field is an organizational label, not a membership filter.

Membership EDI classifies employer Sirius IDs `COBRA` and `13226164` as COBRA; never infer this from names or database UUIDs. Ordinary employer identity changes preserve segment continuity. COBRA class changes start new EDI segments but do not terminate a continuing benefit.

## Conflicting coverage (supersedes run-scoped source selection)

Rule: conflicting coverage (same person, benefit and month with a different source or COBRA class) is not allowed in production. While existing dual coverage is cleaned up, a feed excludes every conflicting candidate, cascades to dependents left without a retained subscriber, and lists each exclusion in detail for an administrator to acknowledge. Staff no longer pick a winning source. One site-wide, on-by-default setting carries the temporary rule; off means any conflict stops the run with correction required.

**Why:** User decision. Omitting a member from a replacement membership file can make the carrier end their coverage, so the exclusion list needs an explicit acknowledgement and travels with the generated run. The rule is temporary and must stay removable.

**How to apply:** A feed never changes source coverage, relationship or employer records. Never inherit an acknowledgement into another run or a changed list. Saved manual decisions on older runs are shown read-only; regenerating uses the current rule. Keep the exclusion rule behind the single setting so removing it is one deletion, not a sweep.

## Start dates come from lifecycle events

Rule: a coverage start date is the latest `restart` event month at or before the anchor month, moved forward past the latest month in that run without a record of the member's own class. The database returns one row per anchor; a person's months never reach the application, and nothing older than the run start is read. Missing, pending, failed or behind-coverage events refuse the run with a count instead of estimating a date.

**Why:** The month-by-month history traversal reached its whole-check time ceiling at Kaiser scale. The events are already maintained per worker, benefit and run. This supersedes the earlier instruction not to rely on persisted span data; no new table or event type was added.

**How to apply:** Do not reintroduce a whole-history read, an on-disk staging store or a whole-check elapsed ceiling: keep per-query limits and population/row/byte ceilings. An event-readiness check is part of correctness, not an optimization, because a late event means a wrong date in a carrier file. Shared EDI code must not import carrier modules; a carrier declares the supplemental benefits it needs and keeps its own rules (for example a start-date floor).

## Judging a conflict needs the person's complete month

Rule: decide whether a month conflicts only from EVERY record the person holds for that benefit and month. A read that follows one family's relationships sees one record per dependent and reports no conflict when the competing record is the dependent's own coverage or sits under another subscriber. Every excluded record is listed; none is dropped quietly.

**Why:** An ended family rebuilt from relationship-joined rows counted a dependent whose month conflicted, which changes the covered count and tier sent to the carrier.

**How to apply:** For any new month a feed uses (not only the report month), read the complete person-month groups before applying the conflict rule. Anything only counted by the database (for example earlier conflicts inside a run) is charged to the run's budget from the counts before its records are read, so an oversized list refuses without being loaded.

Every dependent counted in a historical family needs relationship authority and change detection, even if the month has no competing coverage.

**Why:** Conflict-free coverage does not prove that a relationship names that dependent or overlaps the covered month; these dependents change carrier family counts and tiers too.

**How to apply:** Validate and fingerprint relationships for everyone contributing to the file, not only the anchor member or records described in an exclusion.

A bounded input batch is not a bounded database result. Charge result pages to the shared row and byte budget before accumulating further pages or batches.

**Why:** One person can have arbitrarily many source records. Applying a budget only after accumulating termination or supplemental evidence defeats the memory ceiling.

## Reading synthetic scale timings

Timing taken on a local-socket database with synthetic rows hides per-round-trip latency. Report the number of read transactions alongside durations, and label such figures as local, never as production timing.

The config UI labels the provider field "Provider (label only — does not filter members)" so admins aren't misled. Layout risk is pinned by a registry-driven conformance suite (`tests/edi/`): provider-neutral behavior is asserted once for every registered provider, each provider declares its field table on the plugin and an independent transcription of the legacy PHP layout as a checked-in fixture, and a provider registered without that fixture fails the suite. Golden records and provider quirks (Kaiser overpunch, HealthNet member type) sit alongside as per-provider assertions.

**How to apply:** New EDI file-type plugins should scope by benefit the same way; if a provider↔benefit relation is ever added, tighten `getPrimaryKeys` in each plugin and validate configs point at benefits owned by their provider.
