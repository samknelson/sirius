/**
 * The pinned S2 system zone — a pure leaf (no imports) so calendar helpers
 * and tests can name it without pulling in the database. The gate that
 * enforces it, and the full contract, live in ./timezone-contract.ts.
 *
 * This is a fund decision (RUNBOOK §1 "Time zone pin"), not a setting: the
 * app, every migration process and every DB session run in this zone from the
 * first rehearsal through cutover and for the life of the production site.
 */
export const MIGRATION_SYSTEM_TIME_ZONE = "America/Los_Angeles";
