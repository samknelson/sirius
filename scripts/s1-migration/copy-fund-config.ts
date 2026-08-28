/**
 * DEV-ONLY legacy utility: copy fund CONFIGURATION (trust providers, trust
 * benefits, policies, and their option types) from another S2 database into
 * the current target.
 *
 * Not part of the production migration flow. Purpose: a development branch
 * lacks the fund config that load-policies adopts against (it never creates
 * policies). This copies ONLY config tables — never worker/contact/ledger
 * data — preserving row ids so cross-references (benefit provider links,
 * policy benefit lists in data) stay intact.
 *
 * Source:  SOURCE_CONFIG_DATABASE_URL (read-only usage)
 * Target:  EXTERNAL_DATABASE_URL (resolved exactly like the app; banner printed)
 *
 * Idempotent: INSERT ... ON CONFLICT (id) DO NOTHING; existing target rows
 * are never modified. Refuses to run if source and target are the same host.
 * trust_provider_contacts is intentionally NOT copied (references contacts,
 * which are migrated data, not config).
 *
 * Usage: npx tsx scripts/s1-migration/copy-fund-config.ts [--dry-run]
 */
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { getEnvironmentVariable } from "./lib/script-env";
import ws from "ws";
import { resolveDatabaseUrl, describeDatabaseTarget } from "../../shared/database-url";

neonConfig.webSocketConstructor = ws;

const DRY_RUN = process.argv.includes("--dry-run");

/** table → columns, in FK dependency order (parents first). */
const TABLES: Array<{ table: string; columns: string[] }> = [
  { table: "options_trust_provider_type", columns: ["id", "name", "description", "data"] },
  { table: "options_trust_benefit_type", columns: ["id", "name", "sirius_id", "sequence", "data"] },
  { table: "trust_providers", columns: ["id", "name", "data"] },
  {
    table: "trust_benefits",
    columns: ["id", "sirius_id", "name", "benefit_type", "color", "show_on_worker_list", "is_active", "description", "provider_id"],
  },
  { table: "policies", columns: ["id", "sirius_id", "name", "data"] },
];

function rewriteNeonPooler(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.includes("-pooler.") && u.hostname.endsWith(".neon.tech")) {
      u.hostname = u.hostname.replace("-pooler.", ".");
      return u.toString();
    }
  } catch {
    /* let the driver surface the error */
  }
  return url;
}

async function main() {
  const sourceUrl = getEnvironmentVariable("SOURCE_CONFIG_DATABASE_URL");
  if (!sourceUrl) throw new Error("SOURCE_CONFIG_DATABASE_URL is not set");
  const resolvedTarget = resolveDatabaseUrl();
  console.log(`[copy-fund-config] target: ${describeDatabaseTarget(resolvedTarget)}`);

  const sourceHost = new URL(sourceUrl).hostname.replace("-pooler.", ".");
  const targetHost = new URL(resolvedTarget.url).hostname.replace("-pooler.", ".");
  if (sourceHost === targetHost) {
    throw new Error(`source and target are the same host (${sourceHost}) — refusing to copy`);
  }
  console.log(`[copy-fund-config] source host: ${sourceHost}`);

  const source = new NeonPool({ connectionString: rewriteNeonPooler(sourceUrl) });
  const target = new NeonPool({ connectionString: rewriteNeonPooler(resolvedTarget.url) });
  const report: Record<string, { sourceRows: number; inserted: number; alreadyPresent: number }> = {};

  try {
    for (const { table, columns } of TABLES) {
      const cols = columns.join(", ");
      const res = await source.query(`SELECT ${cols} FROM ${table} ORDER BY id`);
      const rows = res.rows as Array<Record<string, unknown>>;
      let inserted = 0;
      let alreadyPresent = 0;
      if (!DRY_RUN) {
        for (const row of rows) {
          const values = columns.map((c) => {
            const v = row[c];
            // jsonb columns arrive as objects; pass them as JSON text
            return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
          });
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
          const r = await target.query(
            `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
            values,
          );
          if (r.rowCount === 1) inserted++;
          else alreadyPresent++;
        }
      }
      report[table] = { sourceRows: rows.length, inserted, alreadyPresent };
    }
  } finally {
    await source.end();
    await target.end();
  }

  console.log(JSON.stringify({ loader: "copy-fund-config", dryRun: DRY_RUN, report }, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
