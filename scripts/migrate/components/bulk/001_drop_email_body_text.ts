import { sql } from "drizzle-orm";
import { db } from "../../../../server/db";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";
import { logger } from "../../../../server/logger";
import { escapeHtml } from "../../../../shared/utils/html/escape";

const COMPONENT_ID = "bulk";
const SERVICE = "migration-bulk-001";

/**
 * Stop storing a bulk email's plain-text alternative part.
 *
 * An email's plain-text part is DERIVED from its HTML body at send, per
 * recipient (see `deriveEmailPlainText`), because two authored copies of
 * one message are two things that can disagree — and the stored copy was
 * a second copy nothing read.
 *
 * A row that holds ONLY the text copy is the one case where the column is
 * not a duplicate: it is the whole message. Those are carried over into
 * the HTML body — escaped, with line breaks kept — before the column
 * goes, because dropping them would leave a bulk email with nothing to
 * say and no way to find out what it used to say.
 *
 * Idempotent: the carry-over only runs while the column is still there,
 * and the drop is a no-op once it is gone.
 */
async function up(): Promise<void> {
  const stillThere = await db.execute(sql`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bulk_messages_email'
      AND column_name = 'body_text'
  `);
  if ((stillThere.rows?.length ?? 0) > 0) {
    const carried = await db.execute(sql`
      SELECT id, body_text FROM bulk_messages_email
      WHERE body_text IS NOT NULL
        AND btrim(body_text) <> ''
        AND (body_html IS NULL OR btrim(body_html) = '')
    `);
    for (const row of carried.rows ?? []) {
      const id = row.id as string;
      const html = escapeHtml(String(row.body_text)).replace(/\r?\n/g, "<br>\n");
      await db.execute(sql`
        UPDATE bulk_messages_email SET body_html = ${html} WHERE id = ${id}
      `);
    }
    if ((carried.rows?.length ?? 0) > 0) {
      logger.info("Carried text-only bulk email bodies into the HTML body", {
        service: SERVICE,
        rows: carried.rows?.length ?? 0,
      });
    }
  }

  await db.execute(sql`
    ALTER TABLE bulk_messages_email DROP COLUMN IF EXISTS body_text
  `);
  logger.info("Dropped the stored bulk email plain-text body", { service: SERVICE });
}

const migration: Migration = {
  version: 1,
  name: "drop_email_body_text",
  description:
    "Drop bulk_messages_email.body_text: the plain-text alternative part is derived from the HTML body at send.",
  up,
};

registerComponentMigration(COMPONENT_ID, migration);

export default migration;
