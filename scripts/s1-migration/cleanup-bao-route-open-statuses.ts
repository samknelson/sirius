/**
 * Transactionally replace obsolete bao-route-open-* statuses with the
 * canonical Benefit Appeal Submitted status, clear inbound lapse references,
 * and delete the obsolete rows. Safe to rerun.
 *
 * Usage:
 *   npx tsx scripts/s1-migration/cleanup-bao-route-open-statuses.ts
 */
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "../../server/storage/db";

export type BaoRouteOpenCleanupResult = {
  obsoleteStatuses: number;
  movedCases: number;
  clearedLapseReferences: number;
  deletedStatuses: number;
};

export async function cleanupBaoRouteOpenStatuses(
  database: Pick<typeof db, "transaction"> = db,
  namePattern = "bao-route-open-%",
): Promise<BaoRouteOpenCleanupResult> {
  return database.transaction(async (tx) => {
    const obsoleteResult = await tx.execute(sql`
      SELECT id, name, case_type_id
      FROM options_bao_case_status
      WHERE name LIKE ${namePattern}
      ORDER BY id
      FOR UPDATE
    `);
    const obsolete = (obsoleteResult as unknown as {
      rows: Array<{ id: string; name: string; case_type_id: string }>;
    }).rows;
    if (obsolete.length === 0) {
      return { obsoleteStatuses: 0, movedCases: 0, clearedLapseReferences: 0, deletedStatuses: 0 };
    }

    const canonicalResult = await tx.execute(sql`
      SELECT s.id, s.case_type_id
      FROM options_bao_case_status s
      JOIN options_bao_case_type t ON t.id = s.case_type_id
      WHERE t.workflow_code = 'benefit_appeal'
        AND s.workflow_step = 'submitted'
      FOR UPDATE OF s
    `);
    const canonicalRows = (canonicalResult as unknown as {
      rows: Array<{ id: string; case_type_id: string }>;
    }).rows;
    if (canonicalRows.length !== 1) {
      throw new Error(`Expected exactly one canonical Benefit Appeal Submitted status; found ${canonicalRows.length}`);
    }
    const canonical = canonicalRows[0];
    const wrongType = obsolete.filter((row) => row.case_type_id !== canonical.case_type_id);
    if (wrongType.length > 0) {
      throw new Error(`Obsolete BAO route-open statuses have unexpected case types: ${wrongType.map((r) => r.name).join(", ")}`);
    }

    const obsoleteIds = obsolete.map((row) => row.id);
    const obsoleteIdList = sql.join(obsoleteIds.map((id) => sql`${id}`), sql`, `);
    const mismatchedCases = await tx.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM sitespecific_bao_cases
      WHERE status_id IN (${obsoleteIdList})
        AND case_type_id <> ${canonical.case_type_id}
    `);
    const mismatchCount = Number((mismatchedCases as unknown as { rows: Array<{ count: number }> }).rows[0]?.count ?? 0);
    if (mismatchCount > 0) {
      throw new Error(`Refusing cleanup: ${mismatchCount} obsolete-status case(s) have a mismatched case type`);
    }

    const moved = await tx.execute(sql`
      UPDATE sitespecific_bao_cases
      SET status_id = ${canonical.id}
      WHERE status_id IN (${obsoleteIdList})
      RETURNING id
    `);
    const cleared = await tx.execute(sql`
      UPDATE options_bao_case_status
      SET lapse_status_id = NULL
      WHERE lapse_status_id IN (${obsoleteIdList})
      RETURNING id
    `);
    const deleted = await tx.execute(sql`
      DELETE FROM options_bao_case_status
      WHERE id IN (${obsoleteIdList})
      RETURNING id
    `);

    return {
      obsoleteStatuses: obsolete.length,
      movedCases: (moved as unknown as { rows: unknown[] }).rows.length,
      clearedLapseReferences: (cleared as unknown as { rows: unknown[] }).rows.length,
      deletedStatuses: (deleted as unknown as { rows: unknown[] }).rows.length,
    };
  });
}

async function main() {
  const result = await cleanupBaoRouteOpenStatuses();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error("cleanup-bao-route-open-statuses failed:", error);
    process.exitCode = 1;
  });
}