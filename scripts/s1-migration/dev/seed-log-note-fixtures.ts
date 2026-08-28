/**
 * DEV-ONLY fixtures for the S1 log-notes importer.
 *
 * These rows intentionally cover note types, no-medium and multi-issue
 * classifications, spelling normalization, document detail, permitted
 * correspondence, and the excluded families. They are staged after the
 * contacts/workers loader so the handler nid is resolved through id_map.
 */
import { db, pool } from "../../../server/storage/db";
import { sql } from "drizzle-orm";
import { ensureStagingSchema } from "../lib/staging";
import { ensureIdMap } from "../lib/idmap";
import { contentHashOf } from "../lib/sync";

const CREATED_EPOCH = 1717200000;
const scalar = (value: string) => ({ value, format: null });

async function main() {
  await ensureStagingSchema();
  await ensureIdMap();
  const result = await db.execute(sql`
    SELECT m.s1_id
      FROM s1_staging.id_map m
      JOIN workers w ON w.contact_id = m.s2_id
     WHERE m.entity = 'contact' AND m.stub = false
     GROUP BY m.s1_id
    HAVING count(*) = 1
     ORDER BY m.s1_id LIMIT 1
  `);
  const handler = Number((result as unknown as { rows: Array<{ s1_id: string | number }> }).rows[0]?.s1_id);
  if (!Number.isFinite(handler)) throw new Error("ABORTING: load contacts-workers before seeding log-note fixtures");

  const rows = [
    ["99939301", "Comment fixture", "comment", "comment", "Internal comment", null],
    ["99939302", "Inbound fixture", "Call from Member", "Enrrolment", "Inbound", [handler]],
    ["99939303", "Outbound fixture", "Call to Member", "Disability/FMLA", "Outbound", [handler]],
    ["99939304", "Multi issue fixture", "Hotline Call from Member", "ID card not received", "Several issues", [handler]],
    ["99939305", "Alias fixture", "Issue Reported for Member", "Dyntl", "Dental alias", [handler]],
    ["99939306", "Document fixture", "material", "material", "Document detail", [handler]],
    ["99939307", "Email fixture", "Email from Member", "Eligibility", "Member email", [handler]],
    ["99939308", "Letter fixture", "Letter", "Appeal Denial", "Appeal letter", [handler]],
    ["99939309", "Excluded bulk fixture", "bulk:queue", "sent", "Excluded", [handler]],
    ["99939310", "Excluded system email", "email", "sending", "Excluded", [handler]],
    ["99939311", "Excluded Twilio fixture", "twilio:conversation", "incoming_sms", "Excluded", [handler]],
    ["99939312", "Excluded raw SMF fixture", "smf", "importraw", "Excluded", [handler]],
    ["99939313", "Long body fixture", "Office Visit", "Walk In", "Long note", [handler]],
    ["99939314", "Multi value fixture", "Comment", "Public", "Multi part", [handler]],
  ] as const;

  for (const [nid, title, category, type, summary, handlers] of rows) {
    const fields: Record<string, unknown> = {
      field_sirius_category: scalar(category),
      field_sirius_type: scalar(type),
      field_sirius_summary: scalar(summary),
      field_sirius_notes: nid === "99939313"
        ? scalar(`long fixture body ${nid} ${"lorem ipsum dolor sit amet ".repeat(200)}`)
        : nid === "99939314"
          ? [scalar(`fixture part one ${nid}`), scalar(`fixture part two ${nid}`), scalar(`fixture part three ${nid}`)]
          : scalar(`fixture body ${nid}`),
    };
    if (handlers) fields.field_sirius_log_handler = handlers;
    const staged = {
      bundle: "sirius_log",
      nid: Number(nid),
      vid: Number(nid),
      title,
      uid: 1,
      status: 1,
      created: CREATED_EPOCH,
      changed: CREATED_EPOCH,
      fields,
    };
    await db.execute(sql`
      INSERT INTO s1_staging.records
        (bundle, nid, vid, title, uid, status, created, changed, fields, content_hash)
      VALUES
        ('sirius_log', ${Number(nid)}, ${Number(nid)}, ${title}, 1, 1,
         ${CREATED_EPOCH}, ${CREATED_EPOCH}, ${JSON.stringify(fields)}::jsonb,
         ${contentHashOf(staged)})
      ON CONFLICT (bundle, nid) DO UPDATE SET
        title = EXCLUDED.title, created = EXCLUDED.created,
        changed = EXCLUDED.changed, fields = EXCLUDED.fields,
        content_hash = EXCLUDED.content_hash, extracted_at = now()
    `);
  }
  console.log(`seeded ${rows.length} log-note fixtures (handler source nid ${handler})`);
  await pool.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "fixture seed failed");
  process.exit(1);
});