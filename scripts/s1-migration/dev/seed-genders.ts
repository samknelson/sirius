/**
 * DEV-ONLY rehearsal helper — seed options_gender on a fresh rehearsal target.
 *
 * The contacts loader (T3) resolves S1 gender values BY NAME against
 * options_gender; on a fresh target the table is empty and every gendered
 * contact would annotate worker_gender_unresolved. Names match the synthetic
 * generator's sirius_gender vocabulary.
 *
 * PRODUCTION: NOT used — options_gender is fund configuration and must exist
 * before the run (see RUNBOOK preconditions).
 *
 * Usage: EXTERNAL_DATABASE_URL=<rehearsal-db> npx tsx scripts/s1-migration/dev/seed-genders.ts
 */
import { createUnifiedOptionsStorage } from "../../../server/storage/unified-options";
import { withNotificationsSuppressed } from "../../../server/middleware/request-context";
import { pool } from "../../../server/storage/db";

async function main() {
  const options = createUnifiedOptionsStorage();
  const existing: Array<{ name: string }> = await options.list("gender");
  const have = new Set(existing.map((r) => r.name.toLowerCase()));
  const NAMES = ["Male", "Female", "Nonbinary", "Other", "Prefer Not To Answer"];
  let created = 0;
  for (const name of NAMES) {
    if (have.has(name.toLowerCase())) continue;
    const code = name === "Prefer Not To Answer" ? "PNTA" : name === "Nonbinary" ? "NB" : name === "Other" ? "O" : name[0];
    await withNotificationsSuppressed(() => options.create("gender", { name, code }));
    created++;
  }
  console.log(JSON.stringify({ seeded: created, present: NAMES.length - created }));
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
