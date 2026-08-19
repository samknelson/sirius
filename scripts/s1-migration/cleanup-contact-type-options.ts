/**
 * Task 344 — cleanup of orphaned contact-type options left behind by the old
 * title import.
 *
 * The corrected T7+T24 loader (load-employers.ts) removes erroneous
 * title-as-type links but deliberately NEVER deletes
 * options_employer_contact_type rows (staff may have adopted them). This
 * operator-run script closes that loop:
 *
 *   1. REPORT (always): every contact-type option with its
 *      employer_contacts reference count, flagging which rows carry the
 *      loader provenance stamp (data.s1Loader) vs. staff-created.
 *   2. APPLY (--apply, after operator review of the report): delete options
 *      that are BOTH loader-stamped AND have zero employer_contacts
 *      references. Staff-created options (no s1Loader stamp) are NEVER
 *      touched, even when unused — only reported.
 *
 * Optional `--ids id1,id2,...` restricts deletion to an explicit
 * operator-approved subset (each id must still be loader-stamped + orphaned,
 * otherwise it is skipped with a reason).
 *
 * Each delete is race-safe: it runs in ONE transaction that takes
 * `SELECT ... FOR UPDATE` on the option row, re-reads the loader stamp and
 * the employer_contacts reference count under that lock, and only then
 * deletes. A concurrent employer_contacts insert referencing the option
 * needs an FK KEY SHARE lock on the same row, so it blocks until the
 * transaction commits and then fails with an FK violation (the option is
 * gone) — the ON DELETE SET NULL FK can never silently null a link created
 * mid-cleanup. (Direct SQL delete by design: the unified options storage
 * delete runs on its own connection and cannot participate in this
 * transaction; smoke: dev/smoke-contact-type-cleanup.ts.)
 * Idempotent: re-runs find nothing left to delete.
 *
 * Usage:
 *   npx tsx scripts/s1-migration/cleanup-contact-type-options.ts            # report only
 *   npx tsx scripts/s1-migration/cleanup-contact-type-options.ts --apply
 *   npx tsx scripts/s1-migration/cleanup-contact-type-options.ts --apply --ids <id1>,<id2>
 *
 * Output is option names + opaque ids + aggregates — no member data.
 */
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");
const idsArgIdx = process.argv.indexOf("--ids");
const ONLY_IDS: Set<string> | null =
  idsArgIdx >= 0 && process.argv[idsArgIdx + 1]
    ? new Set(
        process.argv[idsArgIdx + 1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      )
    : null;

type Row = {
  id: string;
  name: string;
  data: Record<string, unknown> | null;
  ref_count: string | number;
};

async function main() {
  const res = await db.execute(sql`
    SELECT o.id, o.name, o.data,
           (SELECT COUNT(*) FROM employer_contacts ec WHERE ec.contact_type_id = o.id) AS ref_count
    FROM options_employer_contact_type o
    ORDER BY o.name
  `);
  const rows = (res as unknown as { rows: Row[] }).rows;

  const enriched = rows.map((r) => ({
    id: r.id,
    name: r.name,
    refCount: Number(r.ref_count),
    loaderStamped: Boolean((r.data as any)?.s1Loader),
  }));

  const orphans = enriched.filter((r) => r.refCount === 0);
  const loaderOrphans = orphans.filter((r) => r.loaderStamped);
  const staffOrphans = orphans.filter((r) => !r.loaderStamped);

  console.log(`\n=== Contact-type options report (${enriched.length} total) ===`);
  console.log(`in use: ${enriched.length - orphans.length}, orphaned (0 employer_contacts refs): ${orphans.length}`);
  console.log(`orphaned + loader-created (deletable): ${loaderOrphans.length}`);
  console.log(`orphaned + staff-created (NEVER deleted, review manually): ${staffOrphans.length}\n`);

  const fmt = (r: (typeof enriched)[number]) =>
    `  ${r.id}  refs=${r.refCount}  ${r.loaderStamped ? "[s1-loader]" : "[staff]   "}  ${JSON.stringify(r.name)}`;

  if (loaderOrphans.length) {
    console.log("-- Orphaned loader-created options (deleted with --apply):");
    for (const r of loaderOrphans) console.log(fmt(r));
  }
  if (staffOrphans.length) {
    console.log("-- Orphaned staff-created options (left untouched):");
    for (const r of staffOrphans) console.log(fmt(r));
  }
  const inUse = enriched.filter((r) => r.refCount > 0);
  if (inUse.length) {
    console.log("-- In-use options (kept):");
    for (const r of inUse) console.log(fmt(r));
  }

  if (!APPLY) {
    console.log("\nDry run (report only). Re-run with --apply to delete the loader-created orphans above.");
    return;
  }

  /**
   * Atomically verify + delete one option. FOR UPDATE on the option row
   * serializes against concurrent employer_contacts inserts (FK takes KEY
   * SHARE on the referenced row), so the ref recount under the lock is
   * authoritative for the lifetime of the transaction.
   */
  const deleteLockedOrphan = async (
    id: string,
  ): Promise<{ ok: boolean; reason?: string }> =>
    db.transaction(async (tx) => {
      const lr = await tx.execute(
        sql`SELECT id, data FROM options_employer_contact_type WHERE id = ${id} FOR UPDATE`,
      );
      const row = (lr as unknown as { rows: Array<{ id: string; data: Record<string, unknown> | null }> }).rows[0];
      if (!row) return { ok: false, reason: "gone (already deleted?)" };
      if (!(row.data as any)?.s1Loader) return { ok: false, reason: "no longer loader-stamped" };
      const cr = await tx.execute(
        sql`SELECT COUNT(*)::int AS c FROM employer_contacts WHERE contact_type_id = ${id}`,
      );
      const c = Number((cr as unknown as { rows: Array<{ c: number }> }).rows[0]?.c ?? 0);
      if (c > 0) return { ok: false, reason: `adopted since report (${c} refs)` };
      await tx.execute(sql`DELETE FROM options_employer_contact_type WHERE id = ${id}`);
      return { ok: true };
    });

  let deleted = 0;
  let skipped = 0;
  const requested = ONLY_IDS ? [...ONLY_IDS] : loaderOrphans.map((r) => r.id);
  const byId = new Map(enriched.map((r) => [r.id, r]));
  console.log("");
  for (const id of requested) {
    const r = byId.get(id);
    if (!r) {
      console.log(`SKIP ${id}: not found in options_employer_contact_type`);
      skipped++;
      continue;
    }
    if (!r.loaderStamped) {
      console.log(`SKIP ${id} ${JSON.stringify(r.name)}: staff-created (no s1Loader stamp)`);
      skipped++;
      continue;
    }
    if (r.refCount > 0) {
      console.log(`SKIP ${id} ${JSON.stringify(r.name)}: has ${r.refCount} employer_contacts refs`);
      skipped++;
      continue;
    }
    // Atomic locked re-check + delete (guards the report→apply adoption race).
    const res2 = await deleteLockedOrphan(id);
    if (res2.ok) {
      console.log(`DELETED ${id} ${JSON.stringify(r.name)}`);
      deleted++;
    } else {
      console.log(`SKIP ${id} ${JSON.stringify(r.name)}: ${res2.reason}`);
      skipped++;
    }
  }
  console.log(`\nDone: deleted=${deleted} skipped=${skipped}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("cleanup-contact-type-options failed:", err);
    process.exit(1);
  });
