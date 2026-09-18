import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import { logger } from "../../../server/logger";

const SERVICE = "migration-1195";

type LegacyReference = {
  contextId: "ledger_payment" | "ledger_payment_batch";
  entityId: string;
  fileId: string;
};

function present(value: unknown): boolean {
  return value === true || value === "t";
}

async function tableExists(tableName: string, client: any): Promise<boolean> {
  const result = await client.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${tableName}
    ) AS exists
  `);
  return present(result.rows?.[0]?.exists);
}

async function columnExists(client: any, tableName: string, columnName: string): Promise<boolean> {
  const result = await client.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${tableName}
        AND column_name = ${columnName}
    ) AS exists
  `);
  return present(result.rows?.[0]?.exists);
}

/**
 * Adopt the two old single-file pointers into entity_files without touching
 * the files row's id, filesystem, or storage path. Everything, including the
 * validation and retirement of the old columns, is one transaction: a bad
 * legacy reference leaves the old schema and data intact for repair.
 *
 * The ledger batch table is component/installation dependent, so every step
 * involving it is guarded by information_schema checks. The migration is also
 * safe to replay after a failed deployment or against a database where one
 * side was already retired.
 */
async function up(): Promise<void> {
  await db.transaction(async (tx) => {
    const sources: Array<{ table: string; contextId: LegacyReference["contextId"] }> = [];
    const hasPaymentsTable = await tableExists("ledger_payments", tx);
    const hasBatchesTable = await tableExists("ledger_payment_batches", tx);
    if (
      hasPaymentsTable &&
      (await columnExists(tx, "ledger_payments", "attachment_file_id"))
    ) {
      sources.push({ table: "ledger_payments", contextId: "ledger_payment" });
    }
    if (
      hasBatchesTable &&
      (await columnExists(tx, "ledger_payment_batches", "attachment_file_id"))
    ) {
      sources.push({ table: "ledger_payment_batches", contextId: "ledger_payment_batch" });
    }

    const refs: LegacyReference[] = [];
    if (sources.some((s) => s.table === "ledger_payments")) {
      const rows = await tx.execute(sql`
        SELECT id, attachment_file_id FROM ledger_payments
        WHERE attachment_file_id IS NOT NULL
      `);
      for (const row of rows.rows as Array<{ id: string; attachment_file_id: string }>) {
        refs.push({ contextId: "ledger_payment", entityId: row.id, fileId: row.attachment_file_id });
      }
    }
    if (sources.some((s) => s.table === "ledger_payment_batches")) {
      const rows = await tx.execute(sql`
        SELECT id, attachment_file_id FROM ledger_payment_batches
        WHERE attachment_file_id IS NOT NULL
      `);
      for (const row of rows.rows as Array<{ id: string; attachment_file_id: string }>) {
        refs.push({ contextId: "ledger_payment_batch", entityId: row.id, fileId: row.attachment_file_id });
      }
    }

    // A file can have only one entity_files row. Do not guess if legacy data
    // points one file at two records (including one payment and one batch).
    const byFile = new Map<string, LegacyReference[]>();
    for (const ref of refs) byFile.set(ref.fileId, [...(byFile.get(ref.fileId) ?? []), ref]);
    const shared = [...byFile.entries()].filter(([, rows]) => rows.length > 1);
    if (shared.length > 0) {
      throw new Error(
        `Cannot migrate ledger attachments: file(s) referenced by multiple legacy records: ${
          shared.slice(0, 20).map(([id, rows]) => `${id} (${rows.map((r) => `${r.contextId}/${r.entityId}`).join(", ")})`).join("; ")
        }. Repair the duplicate references and re-run migrations.`,
      );
    }

    // Existing entity_files rows and files ownership metadata must either
    // already describe exactly this attachment or be absent. This catches a
    // prior/manual adoption and prevents silently stealing another context's
    // file.
    for (const ref of refs) {
      const existing = await tx.execute(sql`
        SELECT context_id, entity_id
        FROM entity_files
        WHERE file_id = ${ref.fileId}
      `);
      if (existing.rows.length > 0) {
        const row = existing.rows[0] as any;
        if (row.context_id !== ref.contextId || row.entity_id !== ref.entityId) {
          throw new Error(
            `Cannot migrate ledger attachment ${ref.fileId}: entity_files already owns it as ` +
            `${row.context_id}/${row.entity_id}, not ${ref.contextId}/${ref.entityId}.`,
          );
        }
      }
      const owner = await tx.execute(sql`
        SELECT entity_type, entity_id FROM files WHERE id = ${ref.fileId}
      `);
      if (owner.rows.length === 0) {
        throw new Error(
          `Cannot migrate ledger attachments: legacy reference ${ref.contextId}/${ref.entityId} ` +
          `points to missing file ${ref.fileId}. Restore the files row and re-run migrations.`,
        );
      }
      const file = owner.rows[0] as any;
      const expectedLegacyType = ref.contextId === "ledger_payment"
        ? "ledger_payment"
        : "ledger_payment_batch";
      const expectedType = `entity-files:${ref.contextId}`;
      const ownershipIsBlank = file.entity_type === null && file.entity_id === null;
      const ownershipMatches =
        file.entity_id === ref.entityId &&
        (file.entity_type === expectedLegacyType || file.entity_type === expectedType);
      if (!ownershipIsBlank && !ownershipMatches) {
        throw new Error(
          `Cannot migrate ledger attachment ${ref.fileId}: files ownership metadata ` +
          `(${file.entity_type ?? "null"}/${file.entity_id}) conflicts with ${ref.contextId}/${ref.entityId}.`,
        );
      }
    }

    for (const ref of refs) {
      await tx.execute(sql`
        INSERT INTO entity_files (context_id, entity_id, file_id, name)
        VALUES (${ref.contextId}, ${ref.entityId}, ${ref.fileId},
          (SELECT file_name FROM files WHERE id = ${ref.fileId}))
        ON CONFLICT (file_id) DO NOTHING
      `);
      await tx.execute(sql`
        UPDATE files
        SET entity_type = ${`entity-files:${ref.contextId}`}, entity_id = ${ref.entityId}
        WHERE id = ${ref.fileId}
      `);
    }

    // Prove the cutover before dropping the only legacy pointers.
    for (const ref of refs) {
      const represented = await tx.execute(sql`
        SELECT 1 FROM entity_files
        WHERE context_id = ${ref.contextId}
          AND entity_id = ${ref.entityId}
          AND file_id = ${ref.fileId}
      `);
      if (represented.rows.length !== 1) {
        throw new Error(
          `Cannot retire legacy attachment reference ${ref.contextId}/${ref.entityId}: ` +
          `file ${ref.fileId} was not represented in entity_files.`,
        );
      }
    }

    // Drop the old FKs explicitly before the columns. IF EXISTS keeps this
    // rerunnable and tolerates databases whose generated FK names differ.
    if (sources.some((s) => s.table === "ledger_payments")) {
      await tx.execute(sql`ALTER TABLE ledger_payments DROP CONSTRAINT IF EXISTS ledger_payments_attachment_file_id_files_id_fk`);
      await tx.execute(sql`ALTER TABLE ledger_payments DROP COLUMN IF EXISTS attachment_file_id`);
    }
    if (sources.some((s) => s.table === "ledger_payment_batches")) {
      await tx.execute(sql`ALTER TABLE ledger_payment_batches DROP CONSTRAINT IF EXISTS ledger_payment_batches_attachment_file_id_files_id_fk`);
      await tx.execute(sql`ALTER TABLE ledger_payment_batches DROP COLUMN IF EXISTS attachment_file_id`);
    }
  });
  logger.info("Unified legacy ledger payment attachments under entity_files", { service: SERVICE });
}

const migration: Migration = {
  version: 1195,
  name: "unify_ledger_payment_attachments",
  description:
    "Adopt legacy payment and payment-batch attachment pointers into entity_files without moving files, validate ownership and representation, then retire legacy columns.",
  up,
};

registerMigration(migration);
export default migration;