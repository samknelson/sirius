---
name: Migration system-zone pin
description: Why every S1→S2 migration process is gated on TZ=America/Los_Angeles and how the gate/evidence are wired; read before touching loader date handling or migration entrypoints.
---

**Rule:** every migration entrypoint that writes S1-derived timestamps must run
in the pinned S2 system zone (single source `scripts/s1-migration/lib/timezone-pin.ts`);
the gate (`lib/timezone-contract.ts`) is invoked from `ensureStagingSchema()`
(the universal first call) and explicitly in bootstrap/sync. There is NO
override flag, and aliases (US/Pacific) are rejected on purpose.

**Why:** S2 no-zone `timestamp` columns mean "wall clock in the process zone"
(pg serializes Dates in the process zone; pool hook aligns sessions). A loader
in UTC and an app in LA silently store every migrated instant 7–8 h off. The
zone is a fund decision frozen from the first rehearsal through production —
changing it later reinterprets stored data with no migration path.

**How to apply:**
- New writing entrypoint → call `ensureStagingSchema()` first, or add it to the
  `NO_S1_TIMESTAMPS` allowlist in `tests/s1-migration/timezone-pin-structure.test.ts`
  with a justification. The structure test fails otherwise.
- The gate reads the target's `ENV_TZ` override row via `peekEnvOverride` and
  applies it like app boot; evidence rides in every loader envelope
  (`runtime.timeZone`) and sync.ts refuses envelopes without it.
- Dev shell here is UTC: prefix migration commands / tests that hit staging
  with `TZ=America/Los_Angeles` (tests set `process.env.TZ` at file top;
  vitest `pool: forks` makes that safe).
- Never `new Date(str)`/`Date.parse(str)` an S1 string; date-only stays a
  string (`toYmd`), UTC-stored gets `Z` (`parseUtcInstant`), fund buckets use
  the pinned-zone Intl helpers. S2 read-backs (naive text) may use `new Date`
  ONLY because the process is pinned.
- User zones (`users.timezone`) are staged+counted only; the structure test
  grep-fails any loader reading them.
