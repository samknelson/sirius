import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

const migration: Migration = {
  version: 15,
  name: "case_types_and_workflow_rules",
  description: "Add BAO case types and workflow metadata, backfill General, and seed Benefit Appeal statuses.",
  async up() {
    await db.transaction(async (tx) => {
      await tx.execute(sql`CREATE TABLE IF NOT EXISTS options_bao_case_type (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(255) NOT NULL UNIQUE,
        description text, sequence integer NOT NULL DEFAULT 0, workflow_code varchar(64) NOT NULL UNIQUE, data jsonb)`);
      for (const statement of [
        sql`ALTER TABLE options_bao_case_status ADD COLUMN IF NOT EXISTS case_type_id varchar`,
        sql`ALTER TABLE options_bao_case_status ADD COLUMN IF NOT EXISTS duration_days integer`,
        sql`ALTER TABLE options_bao_case_status ADD COLUMN IF NOT EXISTS workflow_step varchar(64)`,
        sql`ALTER TABLE options_bao_case_status ADD COLUMN IF NOT EXISTS default_resolution_id varchar`,
        sql`ALTER TABLE options_bao_case_status ADD COLUMN IF NOT EXISTS requires_outreach_note boolean NOT NULL DEFAULT false`,
        sql`ALTER TABLE sitespecific_bao_cases ADD COLUMN IF NOT EXISTS case_type_id varchar`,
      ]) await tx.execute(statement);
      await tx.execute(sql`INSERT INTO options_bao_case_type (name, description, sequence, workflow_code) VALUES
        ('General', 'General BAO case', 0, 'general'), ('Benefit Appeal', 'Benefit appeal workflow', 1, 'benefit_appeal')
        ON CONFLICT (workflow_code) DO NOTHING`);
      await tx.execute(sql`UPDATE sitespecific_bao_cases SET case_type_id=(SELECT id FROM options_bao_case_type WHERE workflow_code='general') WHERE case_type_id IS NULL`);
      await tx.execute(sql`UPDATE options_bao_case_status SET case_type_id=(SELECT id FROM options_bao_case_type WHERE workflow_code='general') WHERE case_type_id IS NULL`);
      await tx.execute(sql`ALTER TABLE sitespecific_bao_cases ALTER COLUMN case_type_id SET NOT NULL`);
      await tx.execute(sql`ALTER TABLE options_bao_case_status ALTER COLUMN case_type_id SET NOT NULL`);
      await tx.execute(sql`INSERT INTO options_bao_case_status
        (name, closed, sequence, case_type_id, duration_days, workflow_step, requires_outreach_note)
        SELECT x.name,x.closed,x.sequence,t.id,x.duration_days,x.workflow_step,x.requires_outreach_note
        FROM (VALUES
          ('Submitted',false,0,NULL::int,'submitted',false),('Auto-Denied',false,1,90,'auto_denied',false),
          ('Trustee Review',false,2,30,'trustee_review',false),('Approved',true,3,NULL,'approved',true),
          ('Closed–Denied',true,4,NULL,'denied',true),('Closed–No Response',true,5,NULL,'no_response',false)
        ) x(name,closed,sequence,duration_days,workflow_step,requires_outreach_note)
        CROSS JOIN (SELECT id FROM options_bao_case_type WHERE workflow_code='benefit_appeal') t
        WHERE NOT EXISTS (SELECT 1 FROM options_bao_case_status s WHERE s.name=x.name)`);
    });
  },
};
registerComponentMigration("sitespecific.bao", migration);
export default migration;