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
  // Oneoff jobs framework: queries job_runs directly with db/getClient and
  // drizzle operators; belongs in a storage namespace for job runs.
  // Relocated with the runner; preserves the existing exception, not new queries.
  'server/plugins/system/oneoff/runner.ts': 'oneoff runner queries job_runs via db/getClient + drizzle operators',
  'server/modules/system/oneoff.ts': 'oneoff module imports db directly',
  'server/plugins/system/oneoff/plugins/test.ts': 'test oneoff builds a sql`` query without the read-only opt-in',

  // Member status scan: worker/ledger/cardcheck queries built in a service.
  'server/services/member-status-scan.ts': 'member status scan builds worker/ledger/cardcheck queries via getClient',

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
