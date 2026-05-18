/**
 * Startup-gating drift check.
 *
 * Loads the expected Drizzle schema for the core (shared/schema.ts) plus
 * every currently-enabled schema-managing component, reflects the live
 * database, and produces a single aggregated drift report. The server
 * refuses to boot if any drift is detected (see `server/app-init.ts`).
 *
 * Drift kinds detected per table:
 *   - missing columns (expected by schema but not in DB)
 *   - column type mismatches
 *   - missing constraints (FK, unique, PK, check)
 *   - missing indexes (or with wrong unique/method/columns/predicate)
 *
 * Reuses the structural drift comparator in `component-schema-push.ts`.
 *
 * Tables belonging to disabled components are intentionally IGNORED —
 * their data may legitimately exist in the DB (retainData on disable) but
 * we do not require their schema to match the latest Drizzle definition.
 */

import { getAllComponents } from "../../shared/components";
import { isComponentEnabledSync } from "./component-cache";
import { detectSchemaDrift, type SchemaDriftReport } from "./component-schema-push";
import * as mainSchema from "../../shared/schema";
import { tableExists } from "../storage/utils";
import { logger } from "../logger";

const NAME_SYM_DESC = "drizzle:Name";

function getDrizzleTableName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const sym = Object.getOwnPropertySymbols(value).find(s => s.description === NAME_SYM_DESC);
  if (!sym) return null;
  const name = (value as Record<symbol, unknown>)[sym];
  return typeof name === "string" ? name : null;
}

function buildSchemaTableIndex(module: Record<string, unknown>): Map<string, any> {
  const out = new Map<string, any>();
  for (const value of Object.values(module)) {
    const name = getDrizzleTableName(value);
    if (name) out.set(name, value);
  }
  return out;
}

async function loadModule(schemaPath: string): Promise<Record<string, unknown>> {
  const rel = schemaPath.replace(/^\.\//, "");
  const url = new URL(`../../${rel}`, import.meta.url);
  return (await import(url.href)) as Record<string, unknown>;
}

export interface AggregateDriftReport {
  hasDrift: boolean;
  perTable: SchemaDriftReport[];
  /** Tables expected by the schema (for enabled components + core) that are missing from the DB. */
  missingTables: string[];
  /** Component IDs whose schemas were checked. */
  checkedComponents: string[];
  /** Core tables checked (sample size for logging). */
  coreTableCount: number;
}

function reportIsEmpty(r: SchemaDriftReport): boolean {
  return (
    r.missingColumns.length === 0 &&
    r.typeMismatches.length === 0 &&
    r.missingConstraints.length === 0 &&
    r.missingIndexes.length === 0
  );
}

/**
 * Build the set of table names that belong to a DISABLED component. These
 * tables are skipped during the core drift sweep so retained-on-disable data
 * doesn't cause a startup-gate failure.
 */
function getIgnoredTableNames(): Set<string> {
  const ignored = new Set<string>();
  for (const c of getAllComponents()) {
    if (!c.managesSchema || !c.schemaManifest) continue;
    if (isComponentEnabledSync(c.id)) continue;
    for (const t of c.schemaManifest.tables) ignored.add(t);
  }
  return ignored;
}

export async function checkAggregateSchemaDrift(): Promise<AggregateDriftReport> {
  const perTable: SchemaDriftReport[] = [];
  const missingTables: string[] = [];
  const checkedComponents: string[] = [];
  const seenTables = new Set<string>();

  // ----- Enabled components -----
  for (const component of getAllComponents()) {
    if (!component.managesSchema || !component.schemaManifest) continue;
    if (!isComponentEnabledSync(component.id)) continue;

    checkedComponents.push(component.id);

    let componentModule: Record<string, unknown>;
    try {
      componentModule = await loadModule(component.schemaManifest.schemaPath);
    } catch (err) {
      // Fall back to the main schema barrel if the component-local schema
      // file can't be imported (e.g. a re-export style component).
      componentModule = mainSchema as unknown as Record<string, unknown>;
    }
    const moduleIndex = buildSchemaTableIndex(componentModule);
    const mainIndex = buildSchemaTableIndex(mainSchema as unknown as Record<string, unknown>);

    for (const tableName of component.schemaManifest.tables) {
      seenTables.add(tableName);
      const exists = await tableExists(tableName);
      if (!exists) {
        missingTables.push(tableName);
        continue;
      }
      const tableSchema = moduleIndex.get(tableName) ?? mainIndex.get(tableName);
      if (!tableSchema) {
        // Schema definition is missing for an active table — treat as drift
        // so the operator knows their manifest and Drizzle file disagree.
        perTable.push({
          tableName,
          missingColumns: [],
          typeMismatches: [`No Drizzle table definition found for "${tableName}" in component ${component.id}`],
          missingConstraints: [],
          missingIndexes: [],
        });
        continue;
      }
      const report = await detectSchemaDrift(tableSchema, tableName);
      if (!reportIsEmpty(report)) perTable.push(report);
    }
  }

  // ----- Core tables (everything in shared/schema.ts that isn't owned by a
  //       disabled component's manifest) -----
  const ignored = getIgnoredTableNames();
  const mainIndex = buildSchemaTableIndex(mainSchema as unknown as Record<string, unknown>);

  let coreTableCount = 0;
  for (const [tableName, tableSchema] of mainIndex) {
    if (seenTables.has(tableName)) continue;
    if (ignored.has(tableName)) continue;
    coreTableCount++;
    const exists = await tableExists(tableName);
    if (!exists) {
      missingTables.push(tableName);
      continue;
    }
    const report = await detectSchemaDrift(tableSchema, tableName);
    if (!reportIsEmpty(report)) perTable.push(report);
  }

  return {
    hasDrift: perTable.length > 0 || missingTables.length > 0,
    perTable,
    missingTables,
    checkedComponents,
    coreTableCount,
  };
}

export class StartupSchemaDriftError extends Error {
  report: AggregateDriftReport;
  constructor(report: AggregateDriftReport) {
    super(formatAggregate(report));
    this.name = "StartupSchemaDriftError";
    this.report = report;
  }
}

function formatAggregate(r: AggregateDriftReport): string {
  const lines: string[] = [
    "Schema drift detected at startup — refusing to boot.",
    "",
    `Checked: ${r.coreTableCount} core table(s) + ${r.checkedComponents.length} enabled component(s).`,
  ];
  if (r.missingTables.length > 0) {
    lines.push("");
    lines.push("Missing tables (expected by schema, not in DB):");
    for (const t of r.missingTables) lines.push(`  - ${t}`);
  }
  if (r.perTable.length > 0) {
    lines.push("");
    lines.push("Per-table drift:");
    for (const t of r.perTable) {
      lines.push(`  Table ${t.tableName}:`);
      if (t.missingColumns.length) lines.push(`    - missing columns: ${t.missingColumns.join(", ")}`);
      if (t.typeMismatches.length) lines.push(`    - type mismatches: ${t.typeMismatches.join("; ")}`);
      if (t.missingConstraints.length) lines.push(`    - missing constraints: ${t.missingConstraints.join("; ")}`);
      if (t.missingIndexes.length) lines.push(`    - missing indexes: ${t.missingIndexes.join("; ")}`);
    }
  }
  lines.push("");
  lines.push("To resolve:");
  lines.push("  1. If this is a developer making a schema change without a migration:");
  lines.push("     add a migration file under scripts/migrate/core/ or scripts/migrate/components/<id>/");
  lines.push("     and register it from scripts/migrate/index.ts.");
  lines.push("  2. If this is a deployment whose DB is out of sync:");
  lines.push("     write a baseline script under scripts/migrate/baseline/<replit-name>-<YYYYMMDD>.ts");
  lines.push("     following the procedure documented in replit.md → 'Baselining a deployment'.");
  lines.push("  3. To bypass the gate in a dev emergency, set SKIP_SCHEMA_DRIFT_CHECK=1 (NOT for production).");
  return lines.join("\n");
}

/**
 * Run the aggregate drift check and throw `StartupSchemaDriftError` if any
 * drift is detected. Honors `SKIP_SCHEMA_DRIFT_CHECK=1` as a dev escape hatch.
 */
export async function enforceStartupSchemaDrift(): Promise<void> {
  if (process.env.SKIP_SCHEMA_DRIFT_CHECK === "1") {
    logger.warn("Schema drift check SKIPPED via SKIP_SCHEMA_DRIFT_CHECK=1", {
      source: "startup",
      service: "schema-drift-check",
    });
    return;
  }

  const report = await checkAggregateSchemaDrift();
  if (!report.hasDrift) {
    logger.info("Schema drift check passed", {
      source: "startup",
      service: "schema-drift-check",
      coreTables: report.coreTableCount,
      components: report.checkedComponents.length,
    });
    return;
  }

  logger.error("Schema drift detected at startup", {
    source: "startup",
    service: "schema-drift-check",
    missingTables: report.missingTables,
    driftTableCount: report.perTable.length,
  });
  throw new StartupSchemaDriftError(report);
}
