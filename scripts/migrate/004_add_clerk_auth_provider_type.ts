import { db } from "../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../server/services/migration-runner";
import { logger } from "../../server/logger";

async function up(): Promise<void> {
  const enumCheck = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_enum 
      WHERE enumlabel = 'clerk' 
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'auth_provider_type')
    ) AS exists
  `);

  const hasClerk = enumCheck.rows[0]?.exists === true || enumCheck.rows[0]?.exists === 't';

  if (hasClerk) {
    logger.info("auth_provider_type already includes 'clerk', skipping", {
      service: "migration-004",
    });
    return;
  }

  await db.execute(sql`ALTER TYPE auth_provider_type ADD VALUE 'clerk'`);

  logger.info("Added 'clerk' to auth_provider_type enum", {
    service: "migration-004",
  });
}

const migration: Migration = {
  version: 4,
  name: "add_clerk_auth_provider_type",
  up,
};

registerMigration(migration);
