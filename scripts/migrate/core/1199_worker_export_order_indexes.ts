import { pool } from "../../../server/storage/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

const migration: Migration = {
  version: 1199,
  name: "worker_export_order_indexes",
  description: "Support bounded worker export traversal in either name order.",
  up: async () => {
    // Concurrent creation avoids blocking contact/worker writes during rollout.
    // This migration runs outside a transaction, like other online index builds.
    await pool.query("CREATE INDEX CONCURRENTLY IF NOT EXISTS contacts_worker_export_family_given_idx ON contacts (family, given)");
    await pool.query("CREATE INDEX CONCURRENTLY IF NOT EXISTS contacts_worker_export_given_family_idx ON contacts (given, family)");
    await pool.query("CREATE INDEX CONCURRENTLY IF NOT EXISTS workers_contact_id_idx ON workers (contact_id)");
  },
};

registerMigration(migration);
export default migration;