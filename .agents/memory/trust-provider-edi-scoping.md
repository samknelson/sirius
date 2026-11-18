---
name: Trust-provider EDI scoping decision
description: Why EDI file membership is scoped by benefit, not by the config's providerId
---

Rule: File membership is defined solely by the configured benefit — workers with a monthly benefit record for that benefit in the as-of month (user decision: "EDI files are driven by benefits", not elections). Covered dependents follow their granted monthly coverage, not today's family.

**Why:** The legacy generators scoped by benefit. The provider field is an organizational label, not a membership filter.

Membership EDI classifies employer Sirius IDs `COBRA` and `13226164` as COBRA; never infer this from names or database UUIDs. Ordinary employer identity changes preserve segment continuity. COBRA class changes start new EDI segments but do not terminate a continuing benefit. Mixed classes for one person/benefit/month require correction, not precedence.

**Why:** The user confirmed the numeric Sirius ID and explicitly chose correction-required handling for mixed overlaps. Ordinary-employer overlaps are not that ambiguity and must not block genuine endings.

**How to apply:** Keep this classification confined to membership EDI; it does not authorize changing COBRA eligibility, cases, grants or inference. Use historical classifications and preserve separate benefit/family identities. Generation must not repair source coverage.

The config UI labels the provider field "Provider (label only — does not filter members)" so admins aren't misled. Layout risk is pinned by a registry-driven conformance suite (`tests/edi/`): provider-neutral behavior is asserted once for every registered provider, each provider declares its field table on the plugin and an independent transcription of the legacy PHP layout as a checked-in fixture, and a provider registered without that fixture fails the suite. Golden records and provider quirks (Kaiser overpunch, HealthNet member type) sit alongside as per-provider assertions.

**How to apply:** New EDI file-type plugins should scope by benefit the same way; if a provider↔benefit relation is ever added, tighten `getPrimaryKeys` in each plugin and validate configs point at benefits owned by their provider.
