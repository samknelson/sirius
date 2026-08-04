---
name: S1 loader reject policy + storage-contract pre-validation
description: Conventions all future S1-migration loaders must follow — strict per-run reject allowlist, fatal-vs-annotation verify gating, sanitized error codes, satellite writes only after full row validation.
---

Established in the milestone-3 review round (employers/policies/relationships loaders); future loaders (elections, benefits, ledger…) must follow the same rules.

**Rule 1 — strict reject allowlist.** A loader exits non-zero if ANY reject reason occurs that was not explicitly allowed for that run via `--allow-rejects r1,r2` (full report still prints first). No blanket dev flags; each allowance is a conscious per-run operator ruling. Dev synthetic gaps get their specific reason allowed (e.g. `owner_missing` for relationships).
**Why:** counted-but-ignored rejects silently omit production rows at scale; the earlier `--allow-missing-owner`-style single-purpose flag didn't cover new reject classes appearing unexpectedly.

**Rule 2 — verify gating is per-reason, not per-row.** Keep an explicit FATAL (row-skipping) reason list per loader; the verify pass skips only rows rejected for those. Annotation rejects (bad phone, unresolved industry, dropped extra types) must NOT mask verification of rows that DID load.
**Why:** a blanket `hasAny(nid)` skip let any minor annotation suppress detection of a missing/mismatched row.

**Rule 3 — pre-validate S2 storage contracts; satellite writes last.** Read the storage layer's validation (e.g. worker relations: start date REQUIRED, no future start, end ≥ start; employer contacts: ONE link per contact+employer) and turn each violation into a dedicated reject BEFORE any write for the row — especially before creating satellite rows (shell workers), so rejects can't orphan them. Residual storage throws get SANITIZED codes (`validation_<field>` / `storage_error`), never `err.message` (Postgres diagnostics can embed row values — HIPAA).

**How to apply:** copy the `--allow-rejects` parsing + `RejectLog.disallowedReasons`/`hasAnyIn` usage from `scripts/s1-migration/load-relationships.ts` when writing a new loader; enumerate its FATAL set explicitly; read the target storage module's validate/assert functions first and mirror them as pre-checks.
