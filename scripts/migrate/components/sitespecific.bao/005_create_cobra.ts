import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";

const COMPONENT_ID = "sitespecific.bao";
const SERVICE = "migration-sitespecific.bao-005";

async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    )
  `);
  return result.rows?.[0]?.exists === true || result.rows?.[0]?.exists === "t";
}

async function up(): Promise<void> {
  if (!(await tableExists("options_bao_cobra_status"))) {
    await db.execute(sql`
      CREATE TABLE options_bao_cobra_status (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(255) NOT NULL,
        description text,
        closed boolean NOT NULL DEFAULT false,
        sequence integer NOT NULL DEFAULT 0,
        data jsonb,
        CONSTRAINT options_bao_cobra_status_name_unique UNIQUE (name)
      )
    `);
    logger.info("Created options_bao_cobra_status table", { service: SERVICE });
  }

  // Seed default statuses (idempotent by name).
  await db.execute(sql`
    INSERT INTO options_bao_cobra_status (name, closed, sequence)
    VALUES
      ('New', false, 0),
      ('Pending First Payment', false, 1),
      ('Enrolled', false, 2),
      ('Delinquent', false, 3),
      ('Closed', true, 4)
    ON CONFLICT (name) DO NOTHING
  `);

  if (!(await tableExists("options_bao_cobra_qualifying_event"))) {
    await db.execute(sql`
      CREATE TABLE options_bao_cobra_qualifying_event (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(255) NOT NULL,
        description text,
        sequence integer NOT NULL DEFAULT 0,
        data jsonb,
        CONSTRAINT options_bao_cobra_qualifying_event_name_unique UNIQUE (name)
      )
    `);
    logger.info("Created options_bao_cobra_qualifying_event table", { service: SERVICE });
  }

  await db.execute(sql`
    INSERT INTO options_bao_cobra_qualifying_event (name, sequence)
    VALUES
      ('Low Hours', 0),
      ('Age Out', 1),
      ('Death', 2),
      ('Divorce', 3),
      ('Other', 4)
    ON CONFLICT (name) DO NOTHING
  `);

  if (!(await tableExists("sitespecific_bao_cobra_rates"))) {
    await db.execute(sql`
      CREATE TABLE sitespecific_bao_cobra_rates (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        benefit_id varchar NOT NULL,
        covered_lives_tier varchar NOT NULL,
        rate numeric(10,2) NOT NULL,
        effective_ymd date NOT NULL,
        data jsonb,
        CONSTRAINT sitespecific_bao_cobra_rates_benefit_tier_effective_uq
          UNIQUE (benefit_id, covered_lives_tier, effective_ymd),
        CONSTRAINT sitespecific_bao_cobra_rates_benefit_id_fkey
          FOREIGN KEY (benefit_id) REFERENCES trust_benefits(id) ON DELETE CASCADE
      )
    `);
    logger.info("Created sitespecific_bao_cobra_rates table", { service: SERVICE });
  }

  if (!(await tableExists("sitespecific_bao_cobra_cases"))) {
    await db.execute(sql`
      CREATE TABLE sitespecific_bao_cobra_cases (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        source varchar NOT NULL,
        status_id varchar NOT NULL,
        qualifying_event_id varchar,
        covered_person_worker_id varchar NOT NULL,
        subscriber_worker_id varchar NOT NULL,
        relationship varchar,
        cobra_effective_ymd date NOT NULL,
        offer_ymd date,
        last_day_to_elect_ymd date,
        election_made_ymd date,
        initial_payment_deadline_ymd date,
        payment_status varchar,
        medical_benefit_lost_id varchar,
        dental_benefit_lost_id varchar,
        max_period_ymd date,
        data jsonb,
        CONSTRAINT sitespecific_bao_cobra_cases_status_id_fkey
          FOREIGN KEY (status_id) REFERENCES options_bao_cobra_status(id),
        CONSTRAINT sitespecific_bao_cobra_cases_qualifying_event_id_fkey
          FOREIGN KEY (qualifying_event_id) REFERENCES options_bao_cobra_qualifying_event(id) ON DELETE SET NULL,
        CONSTRAINT sitespecific_bao_cobra_cases_covered_person_worker_id_fkey
          FOREIGN KEY (covered_person_worker_id) REFERENCES workers(id) ON DELETE CASCADE,
        CONSTRAINT sitespecific_bao_cobra_cases_subscriber_worker_id_fkey
          FOREIGN KEY (subscriber_worker_id) REFERENCES workers(id) ON DELETE CASCADE,
        CONSTRAINT sitespecific_bao_cobra_cases_medical_benefit_lost_id_fkey
          FOREIGN KEY (medical_benefit_lost_id) REFERENCES trust_benefits(id) ON DELETE SET NULL,
        CONSTRAINT sitespecific_bao_cobra_cases_dental_benefit_lost_id_fkey
          FOREIGN KEY (dental_benefit_lost_id) REFERENCES trust_benefits(id) ON DELETE SET NULL
      )
    `);
    logger.info("Created sitespecific_bao_cobra_cases table", { service: SERVICE });
  }
}

const migration: Migration = {
  version: 5,
  name: "create_bao_cobra",
  description:
    "Create the COBRA tables for the BAO component: options_bao_cobra_status (with closed flag, seeded with default statuses), options_bao_cobra_qualifying_event (seeded with default qualifying events), sitespecific_bao_cobra_rates (effective-dated per-benefit / covered-lives-tier rate table), and sitespecific_bao_cobra_cases (COBRA case tracking with auto-calculated deadline dates). Idempotent: table creation is skipped when a table already exists (the enable flow creates them via component schema push first) and option seeds use ON CONFLICT DO NOTHING.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
