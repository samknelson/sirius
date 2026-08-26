/**
 * One-off repair for the legacy S2 policy catalogue.
 *
 * The original rehearsal target used:
 *   R  / Restaurant Plan
 *
 * for the policy that is now canonically:
 *   UH / Unite Here Plan
 *
 * This script renames the existing row in place. It never creates a second
 * policy or deletes the legacy row, so the policy UUID and all existing
 * foreign-key/id_map references remain unchanged.
 *
 * The default mode is a report-only dry run. Use --apply only after reviewing
 * the report:
 *
 *   npx tsx scripts/oneoffs/s1-rename-policy-r-to-uh.ts
 *   npx tsx scripts/oneoffs/s1-rename-policy-r-to-uh.ts --dry-run
 *   npx tsx scripts/oneoffs/s1-rename-policy-r-to-uh.ts --apply
 *
 * The migration advisory lock is the same lock used by bootstrap/seed/sync,
 * so this cannot race an S1 migration operation.
 */
import { pool } from "../../server/storage/db";
import { describeDatabaseTarget, resolveDatabaseUrl } from "../../shared/database-url";

const APPLY = process.argv.includes("--apply");
const DRY_RUN = process.argv.includes("--dry-run") || !APPLY;
const MIGRATION_LOCK_KEY = 727001;

if (APPLY && process.argv.includes("--dry-run")) {
  console.error("FAIL: --apply and --dry-run cannot be used together.");
  process.exit(1);
}

interface PolicyRow {
  id: string;
  sirius_id: string;
  name: string;
}

function normalizedSiriusId(value: string): string {
  return value.trim().toUpperCase();
}

async function countIdMapReferences(client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ count: number }> }> }, policyId: string): Promise<number | null> {
  const exists = await client.query(`SELECT to_regclass('s1_staging.id_map') IS NOT NULL AS present`);
  if (!exists.rows[0]?.present) return null;
  const result = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM s1_staging.id_map
      WHERE entity = 'policy' AND s2_id = $1`,
    [policyId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function main(): Promise<number> {
  console.log(`[s1-rename-policy-r-to-uh] target: ${describeDatabaseTarget(resolveDatabaseUrl())}`);
  console.log(`[s1-rename-policy-r-to-uh] mode: ${DRY_RUN ? "report-only" : "APPLY"}`);

  const lockClient = await pool.connect();
  let inTransaction = false;
  try {
    const lock = await lockClient.query(
      `SELECT pg_try_advisory_lock($1::bigint) AS got`,
      [MIGRATION_LOCK_KEY],
    );
    if (!lock.rows[0]?.got) {
      console.error("FAIL: another migration/bootstrap/seed process holds the S1 migration advisory lock.");
      return 1;
    }

    await lockClient.query("BEGIN");
    inTransaction = true;

    // Normalize only for detection. The repair always writes the exact
    // canonical values below, and duplicate case/whitespace variants fail
    // closed rather than choosing one.
    const rows = (await lockClient.query(
      `SELECT id, sirius_id, name
         FROM policies
        WHERE UPPER(BTRIM(sirius_id)) IN ('R', 'UH')
        ORDER BY id
        FOR UPDATE`,
    )).rows as PolicyRow[];

    const rRows = rows.filter((row) => normalizedSiriusId(row.sirius_id) === "R");
    const uhRows = rows.filter((row) => normalizedSiriusId(row.sirius_id) === "UH");

    if (rRows.length > 1 || uhRows.length > 1) {
      console.error(
        `FAIL: ambiguous policy catalogue (R rows=${rRows.length}, UH rows=${uhRows.length}); no changes made.`,
      );
      await lockClient.query("ROLLBACK");
      inTransaction = false;
      return 1;
    }

    if (rRows.length > 0 && uhRows.length > 0) {
      console.error("FAIL: both R and UH policies exist; no changes made. Reconcile the duplicate rows manually.");
      await lockClient.query("ROLLBACK");
      inTransaction = false;
      return 1;
    }

    if (rRows.length === 0 && uhRows.length === 0) {
      console.error("FAIL: neither R nor UH exists; the expected policy catalogue is missing this policy.");
      await lockClient.query("ROLLBACK");
      inTransaction = false;
      return 1;
    }

    if (uhRows.length === 1) {
      const referenceCount = await countIdMapReferences(lockClient, uhRows[0].id);
      console.log(
        `NO-OP: UH / Unite Here Plan already exists; preserved policy references=${referenceCount == null ? "unavailable" : referenceCount}.`,
      );
      await lockClient.query("ROLLBACK");
      inTransaction = false;
      return 0;
    }

    const legacy = rRows[0];
    const referenceCount = await countIdMapReferences(lockClient, legacy.id);
    console.log(
      `PLAN: rename the existing R row in place to UH / Unite Here Plan; ` +
        `preserved policy references=${referenceCount == null ? "unavailable" : referenceCount}.`,
    );

    if (DRY_RUN) {
      console.log("DRY RUN: no rows changed.");
      await lockClient.query("ROLLBACK");
      inTransaction = false;
      return 0;
    }

    const updated = (await lockClient.query(
      `UPDATE policies
          SET sirius_id = 'UH',
              name = 'Unite Here Plan'
        WHERE id = $1
          AND UPPER(BTRIM(sirius_id)) = 'R'
        RETURNING id, sirius_id, name`,
      [legacy.id],
    )).rows as PolicyRow[];

    if (updated.length !== 1 || updated[0].id !== legacy.id) {
      throw new Error("expected exactly one in-place R → UH update, but the update result was unexpected");
    }

    const verified = (await lockClient.query(
      `SELECT id, sirius_id, name
         FROM policies
        WHERE UPPER(BTRIM(sirius_id)) IN ('R', 'UH')
        ORDER BY id`,
    )).rows as PolicyRow[];
    const verifiedR = verified.filter((row) => normalizedSiriusId(row.sirius_id) === "R");
    const verifiedUH = verified.filter((row) => normalizedSiriusId(row.sirius_id) === "UH");
    if (
      verifiedR.length !== 0 ||
      verifiedUH.length !== 1 ||
      verifiedUH[0].id !== legacy.id ||
      verifiedUH[0].name !== "Unite Here Plan"
    ) {
      throw new Error("post-update verification failed; transaction will be rolled back");
    }

    await lockClient.query("COMMIT");
    inTransaction = false;
    console.log("APPLIED: R was renamed to UH / Unite Here Plan in place; policy UUID and references were preserved.");
    return 0;
  } catch (error) {
    if (inTransaction) await lockClient.query("ROLLBACK").catch(() => undefined);
    console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}; no changes committed.`);
    return 1;
  } finally {
    lockClient.release();
    await pool.end();
  }
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error);
  process.exit(1);
});