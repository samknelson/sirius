/**
 * DEV-ONLY rehearsal helper — enable + provision the `cardcheck` component on
 * a rehearsal target.
 *
 * The cardcheck component is intentionally NOT in the §2 bootstrap set
 * (enable-components.ts mirrors the dev reference `components` variable,
 * captured before cardchecks existed), but the cardcheck loader hard-requires
 * its tables (load-cardchecks preflight aborts loudly otherwise). This flips
 * the variable entry and provisions the schema through the normal component
 * lifecycle — the same end state RUNBOOK §4 row 13b requires.
 *
 * PRODUCTION: NOT used — prod S2 has the component enabled/configured as fund
 * config. Idempotent: safe to re-run.
 *
 * Usage: EXTERNAL_DATABASE_URL=<rehearsal-db> npx tsx scripts/s1-migration/dev/enable-cardcheck.ts
 */
import { pool } from "../../../server/storage/db";
import { storage } from "../../../server/storage/database";
import { enableComponentSchema } from "../../../server/services/component-lifecycle";
import { componentRegistry } from "../../../shared/components";

const COMPONENT_ID = "cardcheck";

async function main() {
  const comp = componentRegistry.find((c) => c.id === COMPONENT_ID);
  if (!comp) {
    console.error(`FAIL: component "${COMPONENT_ID}" not in registry`);
    process.exit(1);
  }
  const existing = await storage.variables.getByName("components");
  const value = { ...((existing?.value as Record<string, boolean> | null) ?? {}), [COMPONENT_ID]: true };
  if (existing) await storage.variables.update(existing.id, { value });
  else await storage.variables.create({ name: "components", value });
  console.log(`components variable: ${COMPONENT_ID}=true`);

  if (comp.managesSchema) {
    const res = await enableComponentSchema(COMPONENT_ID);
    if (!res.success) {
      console.error(`FAIL: could not provision ${COMPONENT_ID} schema:`, String((res as any).error ?? (res as any).message ?? "").slice(0, 200));
      process.exit(1);
    }
    console.log(`provisioned: ${COMPONENT_ID}`);
  }
  await pool.end();
  console.log("DONE");
}
main().catch((e) => { console.error(e); process.exit(1); });
