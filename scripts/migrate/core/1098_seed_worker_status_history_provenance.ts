import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1098";

/**
 * Worker status history is process-owned. Both tables keep their local
 * timestamps: worker_wsh uses created_at as a live same-date tie-break, and
 * worker_msh keeps it as its historical local field even though migration
 * 1099 no longer needs to use it for ordering.
 */
async function up(): Promise<void> {
  logger.info(
    "Preserving worker status-history timestamps; worker history is excluded from entity metadata",
    { service: SERVICE },
  );
}

const migration: Migration = {
  version: 1098,
  name: "seed_worker_status_history_provenance",
  description:
    "Preserve worker_msh.created_at and worker_wsh.created_at because worker status history is excluded from entity metadata.",
  up,
};

registerMigration(migration);

export default migration;