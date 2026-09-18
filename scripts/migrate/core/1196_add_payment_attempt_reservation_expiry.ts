import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { db } from "../../../server/db";
import { sql } from "drizzle-orm";

const migration: Migration = {
  version: 1196,
  name: "add_payment_attempt_reservation_expiry",
  description: "Expire abandoned online-payment reservations so workers can retry safely.",
  async up() {
    await db.execute(sql`
      ALTER TABLE ledger_payment_attempts
        ADD COLUMN IF NOT EXISTS reservation_expires_at timestamp
    `);
  },
};

registerMigration(migration);