/**
 * DEV-ONLY rehearsal helper — provision optional components on a freshly
 * empty-DB-bootstrapped rehearsal target.
 *
 * ALLOW_EMPTY_DB_BOOTSTRAP=1 creates core tables + default-enabled component
 * tables ONLY. Loaders also need the optional components the fund runs with
 * (worker.relations for T15/T4 relation types, sitespecific.bao, ledger.*,
 * trust.*, ...). This mirrors the dev reference set (captured 2026-08-06 from
 * the dev DB `components` variable) onto the target: sets the `components`
 * variable, then provisions every enabled schema-managing component through
 * the normal lifecycle path (dependency-checked, schema-state-stamped).
 *
 * PRODUCTION: NOT used — the prod S2 target is a long-lived database whose
 * components are already enabled/configured. This exists so a rehearsal
 * target reset is reproducible.
 *
 * Usage: EXTERNAL_DATABASE_URL=<rehearsal-db> npx tsx scripts/s1-migration/dev/enable-components.ts
 */
import { pool } from "../../../server/storage/db";
import { storage } from "../../../server/storage/database";
import { enableComponentSchema } from "../../../server/services/component-lifecycle";
import { componentRegistry } from "../../../shared/components";

const DESIRED: Record<string, boolean> = {"bulk":true,"debug":true,"ledger":true,"ledger.stripe":true,"trust.benefits":true,"trust.elections":true,"trust.providers":true,"employer.company":true,"sitespecific.bao":true,"worker.relations":true,"system.sftp.client":true,"trust.benefits.scan":true,"trust.providers.edi":true,"ledger.dummy_gateway":true,"ledger.payment.batch":true,"trust.providers.login":true,"trust.benefits.eligibility.exemptions":true};

async function main() {
  const existing = await storage.variables.getByName("components");
  if (existing) await storage.variables.update(existing.id, { value: DESIRED });
  else await storage.variables.create({ name: "components", value: DESIRED });
  console.log("components variable set:", Object.keys(DESIRED).length, "enabled");

  const managed = componentRegistry.filter((c) => c.managesSchema && DESIRED[c.id]);
  // dependency order via retry-to-fixed-point (registry order is close; deps defer)
  const pending = new Set(managed.map((c) => c.id));
  let progressed = true;
  while (pending.size && progressed) {
    progressed = false;
    for (const id of [...pending]) {
      const res = await enableComponentSchema(id);
      if (res.success) { console.log("provisioned:", id); pending.delete(id); progressed = true; }
      else console.log("deferred:", id, "-", String((res as any).error ?? (res as any).message ?? "").slice(0, 120));
    }
  }
  if (pending.size) { console.error("FAILED to provision:", [...pending].join(", ")); process.exit(1); }
  await pool.end();
  console.log("DONE");
}
main().catch((e) => { console.error(e); process.exit(1); });
