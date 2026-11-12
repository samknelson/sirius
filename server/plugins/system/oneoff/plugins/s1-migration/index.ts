import { sql } from "drizzle-orm";
import { registerOneoffPlugin } from "../../registry";
import { registerS1MigrationRoutes, S1_MIGRATION_COMPONENT_ID } from "./routes";

/**
 * Discovery imports only definitions and read handlers, never CLI entrypoints.
 * Migration writes remain available only to explicitly invoked internal tools.
 * The normal singleton lifecycle creates a disabled configuration. Enabling
 * it exposes only these reads; it never enables an importer or cron schedule.
 */
registerOneoffPlugin({
  metadata: {
    id: "s1-migration",
    name: "S1 Migration",
    description: "Read-only migration status, Sirius ID ownership, and import run history. Execution remains CLI-only.",
    singleton: true,
    requiredPolicy: "admin",
    requiredComponent: S1_MIGRATION_COMPONENT_ID,
  },
  actions: [],
  dashboard: true,
  registerReadRoutes: registerS1MigrationRoutes,
  async status({ db }) {
    const result = await db.execute(sql`SELECT to_regclass('s1_staging.records') IS NOT NULL AS present`);
    return { tableExists: (result.rows[0] as { present: boolean } | undefined)?.present === true, rowCount: 0 };
  },
});
