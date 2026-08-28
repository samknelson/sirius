import {
  registerEnvironmentVariables,
  getEnvironmentVariable,
  getRawProcessEnv,
  setEnvironmentVariable,
} from "../../../server/config/env-registry";

registerEnvironmentVariables([
  { name: "S1_MIGRATION_DEBUG", description: "Enable verbose S1 migration error logging.", secret: false, category: "core" },
  { name: "S1_RESULT_JSON_PATH", description: "Path where an S1 migration command writes its JSON result.", secret: false, category: "core" },
  { name: "S1_DATABASE_URL", description: "S1 (legacy Drupal MariaDB) connection URL", secret: true, category: "core" },
  { name: "S1_SYNC_LOCK_HELD", description: "Marker indicating the parent S1 sync process holds the migration lock.", secret: false, category: "core" },
  { name: "S1_BOOTSTRAP_LOCK_HELD", description: "Marker indicating the parent S1 bootstrap process holds the migration lock.", secret: false, category: "core" },
  { name: "S1_BOOTSTRAP_TEST_FAULT", description: "Fault injection point for S1 bootstrap tests.", secret: false, category: "core" },
  { name: "S1_BOOTSTRAP_TEST_PAUSE_BEFORE_CHILDREN_MS", description: "Test pause before S1 bootstrap starts child processes.", secret: false, category: "core" },
  { name: "S1_PROGRESS_INTERVAL_MS", description: "S1 migration progress reporting interval in milliseconds.", secret: false, category: "core" },
  { name: "S1_T20_FLUSH_AT", description: "S1 T20 test row at which to flush pending work.", secret: false, category: "core" },
  { name: "S1_T20_CRASH_AFTER_FLUSH", description: "S1 T20 test row at which to crash after flushing.", secret: false, category: "core" },
  { name: "S1_FLEET_SMOKE", description: "Permit the S1 fleet smoke mutation utility to run.", secret: false, category: "core" },
  { name: "SOURCE_CONFIG_DATABASE_URL", description: "Source database URL for copying fund configuration.", secret: true, category: "core" },
  { name: "S1_LOADER_LOG_SAMPLE", description: "S1 loader storage-operation log sampling interval.", secret: false, category: "core" },
  { name: "S1_LOADER_PAGE_SIZE", description: "S1 loader page size.", secret: false, category: "core" },
  { name: "GEN_SEED", description: "Deterministic seed for the synthetic S1 data generator.", secret: false, category: "core" },
  { name: "GEN_WORKERS", description: "Worker count for the synthetic S1 data generator.", secret: false, category: "core" },
  { name: "S1_CANARY_EMAIL", description: "Canary email used by the synthetic S1 data generator.", secret: false, category: "core" },
]);

export {
  registerEnvironmentVariables,
  getEnvironmentVariable,
  getRawProcessEnv,
  setEnvironmentVariable,
};