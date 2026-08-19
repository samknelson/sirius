/**
 * DEV-ONLY rehearsal helper — seed the FUND CONFIG the loader fleet
 * hard-requires but a freshly bootstrapped rehearsal target lacks:
 *
 *   - the "Employer Contributions" ledger account, and
 *   - exactly ONE enabled `bao-hourly` charge config pointing at it
 *     (load-employer-rates resolves its rate target through that config and
 *     aborts otherwise — RUNBOOK §4 row 5c).
 *
 * On the REAL prod target this exists as fund configuration (copy-fund-config
 * / operator setup); on the long-lived shared dev DB it also exists. This
 * helper exists for THROWAWAY fleet-rehearsal targets only.
 *
 * Raw SQL on purpose (matches the proven employers-smoke pattern): loaders
 * read storage in fresh processes, so no cache invalidation is needed.
 * Idempotent: adopts an existing enabled config / existing account by name.
 *
 * Usage: EXTERNAL_DATABASE_URL=<rehearsal-db> npx tsx scripts/s1-migration/dev/seed-fund-config.ts
 */
import { db, pool } from "../../../server/storage/db";
import { sql } from "drizzle-orm";

const CFG_SIRIUS_ID = "dev.fleet-rehearsal.bao-hourly";

async function rows<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  const res = await db.execute(q);
  return (res as unknown as { rows: T[] }).rows;
}

async function main() {
  const existing = await rows<{ id: string }>(
    sql`SELECT id FROM plugin_configs WHERE plugin_kind = 'charge' AND plugin_id = 'bao-hourly' AND enabled = true`,
  );
  if (existing.length === 1) {
    console.log("bao-hourly charge config already present — nothing to do");
    await pool.end();
    return;
  }
  if (existing.length > 1) {
    console.error("FAIL: multiple enabled bao-hourly charge configs — resolve duplicates first.");
    process.exit(1);
  }

  let acct = await rows<{ id: string }>(
    sql`SELECT id FROM ledger_accounts WHERE name = 'Employer Contributions' AND is_active = true`,
  );
  if (acct.length > 1) {
    console.error("FAIL: multiple active 'Employer Contributions' ledger accounts.");
    process.exit(1);
  }
  if (acct.length === 0) {
    acct = await rows<{ id: string }>(
      sql`INSERT INTO ledger_accounts (name, description)
          VALUES ('Employer Contributions', 'Rehearsal fund config (dev seed)')
          RETURNING id`,
    );
    console.log("created 'Employer Contributions' ledger account");
  }

  const cfg = await rows<{ id: string }>(
    sql`INSERT INTO plugin_configs (plugin_kind, plugin_id, enabled, name, sirius_id)
        VALUES ('charge', 'bao-hourly', true, 'BAO Hourly (rehearsal fund config)', ${CFG_SIRIUS_ID})
        RETURNING id`,
  );
  await db.execute(
    sql`INSERT INTO plugin_configs_charge (id, scope, account) VALUES (${cfg[0].id}, 'global', ${acct[0].id})`,
  );
  console.log("seeded enabled bao-hourly charge config (global scope → Employer Contributions)");
  await pool.end();
  console.log("DONE");
}
main().catch((e) => { console.error(e); process.exit(1); });
