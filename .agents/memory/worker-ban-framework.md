---
name: Worker-ban framework conventions
description: Durable rules for configurable ban types and behavior plugins
---

- Ban types are option rows whose data multi-selects singleton behavior plugins; `worker_bans.type` is a soft reference (no FK) validated at write time and delete-guarded.
  **Why:** avoids risky enum/FK migrations while keeping types admin-configurable.
- Unconditional dispatch-accept behaviors produce global `ban` facts; conditional behaviors (facility, job type) produce per-target `ban_facility`/`ban_jobtype` facts via their own denorm plugins.
- USER-CONFIRMED design (Aug 2026): bans are ordinary eligibility criteria — storage writes the ban, a denorm listener updates worker_dispatch_elig_denorm, eligibility plugins ONLY query that table. No live source-row reads at accept time, no synchronous recompute, no always-on ban layer; the brief post-save fact lag is accepted (same as DNC/skills/HFE). Enforcement is per-job-type config — a job type without the ban criterion intentionally permits banned workers (e.g. "emergency dispatch"). **Why:** user explicitly rejected exceptions/hardcoded rules and compartment-breaking writes; do not "fix" the eventual-consistency window again. **How to apply:** never add ban special-casing to accept paths; new accept/write paths call the generic fact-based `checkWorkerAcceptance`.
- Editing a ban type's behaviors changes every existing ban of that type; any surface mutating ban-type semantics must re-emit the ban-saved event per referencing ban so denorm recomputes immediately (daily sweep is too slow).
- A manifest-only plugin kind (no config adapter) still needs entries in the client PluginKind union AND the per-kind search-params map, or tsc fails.
- Conditional ban context (e.g. a job's facility) must be an authoritative persisted field with server-side validation — a ban behavior whose context is never populated silently never matches.
- Standalone scripts exercising component-gated plugins must load the component cache first or all gated plugins appear disabled.
- `worker_bans.denorm_active` is owned by the `worker_ban_active` denorm plugin (endDate-window cache; enforcement never reads it). Nothing else may write it; date rollovers repair via the hourly denorm backfill, and a flag flip re-emits the ban-saved event AFTER COMMIT so worker dispatch facts recompute.
