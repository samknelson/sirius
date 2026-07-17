import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "contract";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    ) AS exists
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

/**
 * Create the three tables owned by the contract component.
 *
 * - contracts: the top-level record (name, stub_sections flag, jsonb data).
 * - contract_articles: articles belonging to a contract. contract_id is a
 *   required FK into contracts ON DELETE CASCADE (deleting a contract removes
 *   its articles). Ordered by the sequence column.
 * - contract_sections: sections belonging to an article. article_id is a
 *   required FK into contract_articles ON DELETE CASCADE (deleting an article
 *   removes its sections). body holds long text (simple HTML). Ordered by the
 *   sequence column.
 *
 * Idempotent: each table is created only if absent (the enable flow creates
 * them via component schema push first). Created in dependency order so the FK
 * targets exist before the referencing tables.
 */
async function up(): Promise<void> {
  if (!(await tableExists("contracts"))) {
    await db.execute(sql`
      CREATE TABLE contracts (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL,
        stub_sections boolean NOT NULL DEFAULT false,
        data jsonb
      )
    `);
    logger.info("Created contracts table", { service: "migration-contract-001" });
  } else {
    logger.info("contracts table already exists, skipping", {
      service: "migration-contract-001",
    });
  }

  if (!(await tableExists("contract_articles"))) {
    await db.execute(sql`
      CREATE TABLE contract_articles (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        sequence integer NOT NULL DEFAULT 0,
        contract_id varchar NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
        article_number varchar,
        name varchar NOT NULL,
        data jsonb
      )
    `);
    logger.info("Created contract_articles table", { service: "migration-contract-001" });
  } else {
    logger.info("contract_articles table already exists, skipping", {
      service: "migration-contract-001",
    });
  }

  if (!(await tableExists("contract_sections"))) {
    await db.execute(sql`
      CREATE TABLE contract_sections (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        sequence integer NOT NULL DEFAULT 0,
        article_id varchar NOT NULL REFERENCES contract_articles(id) ON DELETE CASCADE,
        section_number varchar,
        name varchar NOT NULL,
        body text,
        is_stub boolean NOT NULL DEFAULT false,
        data jsonb
      )
    `);
    logger.info("Created contract_sections table", { service: "migration-contract-001" });
  } else {
    logger.info("contract_sections table already exists, skipping", {
      service: "migration-contract-001",
    });
  }
}

const migration: Migration = {
  version: 1,
  name: "create_contract_tables",
  description:
    "Create the contracts, contract_articles, and contract_sections tables owned by the contract component. contract_articles.contract_id FKs contracts(id) ON DELETE CASCADE; contract_sections.article_id FKs contract_articles(id) ON DELETE CASCADE. Both child tables have a sequence column for ordering. Idempotent: skips any table that already exists (the enable flow creates them via component schema push first). Tables are created in dependency order.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
