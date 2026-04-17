import { storage } from "../../server/storage";
import { registerMigration, type Migration } from "../../server/services/migration-runner";
import { logger } from "../../server/logger";

async function up(): Promise<void> {
  await storage.rawSql.execute(`
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_replit_user_id_unique;
    ALTER TABLE users DROP COLUMN IF EXISTS replit_user_id;
  `);

  logger.info("Dropped replit_user_id column and unique constraint from users table", {
    service: "migration-002",
  });
}

const migration: Migration = {
  version: 2,
  name: "drop_replit_user_id",
  description: "Remove unused replit_user_id column and its unique constraint from the users table",
  up,
};

registerMigration(migration);

export default migration;
