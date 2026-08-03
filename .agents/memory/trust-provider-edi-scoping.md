---
name: Trust-provider EDI scoping decision
description: Why EDI file membership is scoped by benefit, not by the config's providerId
---

Rule: `trust-provider-edi` plugin configs carry a `providerId` subsidiary dimension, but file membership is defined solely by the configured benefit (`benefitSiriusId`) — workers with a monthly benefit record for that benefit in the as-of month (user decision: "EDI files are driven by benefits", not elections). Dependents come from worker relations and must use canonical active semantics (start ≤ as-of AND end null/≥ as-of) — an end-only filter leaks future-dated dependents into counts and rows.

**Why:** The schema has NO provider→benefit or provider→election relation, and the legacy PHP generators also scoped only by benefit. An architect review flagged "config's provider is ignored" as a cross-provider PII risk; it is by design until a provider↔benefit linkage exists (follow-up task proposed). COBRA detection = wmb row's employer with siriusId "COBRA" (per user).

The config UI labels the provider field "Provider (label only — does not filter members)" so admins aren't misled. A golden-file format check (`scripts/dev/check-kaiser-edi-format.ts`, validation `kaiser-edi-format`) pins the 65-field/1120-byte Kaiser layout and overpunch encoding against an independent transcription of the PHP layout.

**How to apply:** New EDI file-type plugins should scope by benefit the same way; if a provider↔benefit relation is ever added, tighten `getPrimaryKeys` in each plugin and validate configs point at benefits owned by their provider.
