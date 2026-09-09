import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import {
  registerMigration,
  type Migration,
} from "../../../server/services/migration-runner";

async function up(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS letter_templates (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
      context_ids text[] NOT NULL DEFAULT '{}'::text[],
      content jsonb NOT NULL DEFAULT '{}'::jsonb,
      medium varchar NOT NULL,
      name text NOT NULL,
      sirius_id varchar,
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      CONSTRAINT letter_templates_sirius_id_unique UNIQUE (sirius_id)
    )
  `);
}

const migration: Migration = {
  version: 1110,
  name: "create_letter_templates",
  description:
    "Create reusable tokenized letter templates with soft token-context references.",
  up,
};

registerMigration(migration);

export default migration;