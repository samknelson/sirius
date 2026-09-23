import { db } from "../../../server/db";
import { sql } from "drizzle-orm";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

const migration: Migration = {
  version: 1202,
  name: "create_employer_contact_payment_grants",
  description: "Persist per-employer-contact online payment and saved-method grants.",
  async up() {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS employer_contact_payment_grants (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        employer_contact_id varchar NOT NULL
          CONSTRAINT ec_payment_grants_contact_fk REFERENCES employer_contacts(id) ON DELETE CASCADE,
        can_pay boolean NOT NULL DEFAULT false,
        can_manage_methods boolean NOT NULL DEFAULT false,
        CONSTRAINT employer_contact_payment_grants_contact_unique UNIQUE (employer_contact_id)
      )
    `);
  },
};

registerMigration(migration);
export default migration;