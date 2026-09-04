import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

const migration: Migration = {
  version: 18,
  name: "create_case_documents",
  description: "Create the generic BAO case document attachment table.",
  async up() {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        CREATE TABLE IF NOT EXISTS sitespecific_bao_case_documents (
          id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
          case_id varchar NOT NULL,
          file_id varchar NOT NULL,
          document_type varchar(64) NOT NULL DEFAULT 'other',
          uploaded_by_user_id varchar NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT sitespecific_bao_case_documents_file_uq UNIQUE (file_id),
          CONSTRAINT sitespecific_bao_case_documents_case_id_fkey FOREIGN KEY (case_id) REFERENCES sitespecific_bao_cases(id) ON DELETE CASCADE,
          CONSTRAINT sitespecific_bao_case_documents_file_id_fkey FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
          CONSTRAINT sitespecific_bao_case_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
        )
      `);
      await tx.execute(sql`CREATE INDEX IF NOT EXISTS sitespecific_bao_case_documents_case_idx ON sitespecific_bao_case_documents(case_id)`);
    });
  },
};
registerComponentMigration("sitespecific.bao", migration);
export default migration;