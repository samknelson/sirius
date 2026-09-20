import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { logger } from "../../../server/logger";
import {
  registerMigration,
  type Migration,
} from "../../../server/services/migration-runner";

async function up(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE ws_clients
    ADD COLUMN IF NOT EXISTS data jsonb
  `);
  await db.execute(sql`
    UPDATE ws_clients
    SET data = '{}'::jsonb
    WHERE data IS NULL
  `);
  await db.execute(sql`
    ALTER TABLE ws_clients
    ALTER COLUMN data SET DEFAULT '{}'::jsonb,
    ALTER COLUMN data SET NOT NULL
  `);

  logger.info("Added extension data to web service clients", {
    service: "migration-1118",
  });
}

const migration: Migration = {
  version: 1118,
  name: "add_ws_clients_data",
  description:
    "Add a non-null JSONB extension object to web service clients and initialize existing rows.",
  up,
};

registerMigration(migration);
export default migration;