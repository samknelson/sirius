/**
 * Shrink-only baseline for the `storage-encapsulation` architecture-lint rule
 * (scripts/dev/check-storage-encapsulation.ts).
 *
 * Each entry is a server file that already built database queries outside the
 * storage layer when the rule was tightened to catch drizzle-orm operators,
 * `getClient`, `db` imports and schema-table imports. A listed file is not
 * reported. Do NOT add entries: new query code belongs in a storage method.
 *
 * The rule fails when an entry's file no longer exists or no longer violates,
 * so when you move a file's queries into storage, delete its entry here.
 *
 * Key: repo-relative path. Value: why the file is still here / what to move.
 */
export const STORAGE_ENCAPSULATION_BASELINE: Record<string, string> = {
  // Owner-approved: oneoffs intentionally support direct database reads/writes,
  // including the runner's bookkeeping and explicit read-write client contract.
  // These existing exceptions are not storage-encapsulation cleanup targets.
  'server/plugins/system/oneoff/runner.ts': 'intentional oneoff job_runs reads/writes via db/getClient + drizzle operators',
  'server/modules/system/oneoff.ts': 'intentional oneoff module database access',
  'server/plugins/system/oneoff/plugins/test.ts': 'intentional oneoff direct SQL through its database-access contract',

  // Quicksearch shared SQL helpers: sql`` fragments shared by quicksearch
  // plugins; shared infra without its own needsReadOnlyDb flag.
  'server/plugins/quicksearch/sql.ts': 'quicksearch shared sql`` helpers outside storage',

  // Route registration: uses the sql`` template directly.
  'server/routes.ts': 'routes.ts imports sql from drizzle-orm',

  // Boot / schema infrastructure that drives DDL or pool lifecycle.
  'server/services/component/schema-push.ts': 'component schema push compiles DDL with PgDialect over the schema namespace',
  'server/services/maintenance-mode.ts': 'maintenance mode registers a pool checkout initializer on the db module',
  'server/services/restart-control.ts': 'restart control dynamically imports the pool to drain it',

};
