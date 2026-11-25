import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration } from "../../../server/services/boot/migration-runner";

registerMigration({
  version: 1129,
  name: "dashboard_refresh",
  description: "Per-instance dashboard auto-refresh, disabled by default",
  async up() {
    await db.execute(sql`ALTER TABLE plugin_configs_dashboard
      ADD COLUMN IF NOT EXISTS auto_refresh boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS refresh_interval_seconds integer NOT NULL DEFAULT 30`);
  },
});
