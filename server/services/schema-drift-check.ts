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
import { tableExists, listAllPublicTables } from "../storage/utils";
import { logger } from "../logger";
import { bootStatus } from "./boot-status";
import { getEnvironmentVariable } from "../config/env-registry";
import { getMigrations, getMigrationStatus } from "./migration-runner";
import { recordDriftOutcome } from "./bringup-report";

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
  /** Tables in the live DB that aren't owned by core or any (enabled OR disabled) component manifest. */
  extraTables: string[];
  /** Component IDs whose schemas were checked. */
  checkedComponents: string[];
  /** Core tables checked (sample size for logging). */
  coreTableCount: number;
}

function reportIsEmpty(r: SchemaDriftReport): boolean {
  return (
    r.missingColumns.length === 0 &&
    r.extraColumns.length === 0 &&
    r.typeMismatches.length === 0 &&
    r.missingConstraints.length === 0 &&
    r.missingIndexes.length === 0
  );
}

/**
 * Tables that legitimately live in the public schema but are not modeled in
 * Drizzle (infrastructure / framework bookkeeping). Adding to this list is a
 * conscious decision — prefer modeling tables in Drizzle whenever possible.
 */
const EXTRA_TABLE_ALLOWLIST = new Set<string>([
  "session", // express-session (StorageSessionStore; legacy unmodeled table name)
]);

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
          extraColumns: [],
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

  // ----- Extra tables (live tables not owned by any manifest, not in core
  //       schema, and not in the infrastructure allowlist) -----
  const allKnownTables = new Set<string>();
  for (const name of mainIndex.keys()) allKnownTables.add(name);
  for (const c of getAllComponents()) {
    if (!c.managesSchema || !c.schemaManifest) continue;
    for (const t of c.schemaManifest.tables) allKnownTables.add(t);
  }
  const liveTables = await listAllPublicTables();
  const extraTables: string[] = [];
  for (const t of liveTables) {
    if (allKnownTables.has(t)) continue;
    if (EXTRA_TABLE_ALLOWLIST.has(t)) continue;
    extraTables.push(t);
  }

  return {
    hasDrift: perTable.length > 0 || missingTables.length > 0 || extraTables.length > 0,
    perTable,
    missingTables,
    extraTables,
    checkedComponents,
    coreTableCount,
  };
}

export class StartupSchemaDriftError extends Error {
  report: AggregateDriftReport;
  constructor(report: AggregateDriftReport, remediation: string[] = []) {
    super(formatAggregate(report, remediation));
    this.name = "StartupSchemaDriftError";
    this.report = report;
  }
}

/**
 * One drift item, reduced to the identifiers a migration would mention.
 * `tokens` is what the correlation below looks for in a migration's name and
 * description.
 */
interface DriftItem {
  label: string;
  tokens: string[];
}

function enumerateDriftItems(r: AggregateDriftReport): DriftItem[] {
  const items: DriftItem[] = [];
  for (const t of r.missingTables) {
    items.push({ label: `missing table ${t}`, tokens: [t] });
  }
  for (const t of r.extraTables) {
    items.push({ label: `extra table ${t}`, tokens: [t] });
  }
  for (const t of r.perTable) {
    const detail: string[] = [];
    if (t.missingColumns.length) detail.push(`missing columns ${t.missingColumns.join(", ")}`);
    if (t.extraColumns.length) detail.push(`extra columns ${t.extraColumns.join(", ")}`);
    if (t.typeMismatches.length) detail.push(`type mismatches ${t.typeMismatches.join("; ")}`);
    if (t.missingConstraints.length)
      detail.push(`missing constraints ${t.missingConstraints.join("; ")}`);
    if (t.missingIndexes.length) detail.push(`missing indexes ${t.missingIndexes.join("; ")}`);
    items.push({
      label: `${t.tableName}: ${detail.join("; ")}`,
      tokens: [t.tableName, ...t.missingColumns, ...t.extraColumns],
    });
  }
  return items;
}

/**
 * Does a migration's own text mention this identifier?
 *
 * A deliberately shallow, textual correlation: migrations do not declare
 * which tables they touch, and inventing a declaration would mean editing
 * every existing migration. Boundaries are non-word characters (so `_`
 * counts), which keeps `files` from matching `profiles` while still matching
 * `files_file_system_id`. The output always says the match is by name and
 * description, so nobody mistakes it for a guarantee.
 */
function mentions(haystack: string, token: string): boolean {
  const needle = token.toLowerCase();
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : haystack[at - 1];
    const after = haystack[at + needle.length] ?? "";
    const isWord = (c: string) => /[a-z0-9]/.test(c);
    if (!isWord(before) && !isWord(after)) return true;
    from = at + 1;
  }
}

export interface DriftRemediationInput {
  /** Stored `migrations_version`. */
  storedVersion: number;
  /** Every registered core migration, baselines included. */
  migrations: { version: number; name: string; description: string; baseline?: boolean }[];
}

/**
 * Turn a drift report into instructions the operator of a shell-less target
 * can actually act on.
 *
 * Three situations produce an identical table diff, and they need opposite
 * responses. This correlates each drift item against the registered
 * migrations and says which one this is:
 *
 *   - a migration that covers the item is PENDING — it will apply on the
 *     next boot (or it just failed, in which case the migration error above
 *     is the real fault);
 *   - a migration that covers the item is at or below the stored version —
 *     the stamp is AHEAD of the schema, and the fix is one environment
 *     variable plus a redeploy;
 *   - no registered migration mentions the item at all — no environment
 *     variable can help, and a baseline script has to ship in the next image.
 */
export function buildDriftRemediation(
  r: AggregateDriftReport,
  input: DriftRemediationInput,
): string[] {
  const items = enumerateDriftItems(r);
  const covering = items.map((item) => {
    const matches = input.migrations
      .filter((m) => {
        const haystack = `${m.name} ${m.description}`.toLowerCase();
        return item.tokens.some((t) => mentions(haystack, t));
      })
      // Newest first: a token like `sirius_id` is mentioned by many old
      // migrations, but the one that would CREATE the drifted item is the
      // most recent match. Everything below it is noise for this purpose.
      .sort((a, b) => b.version - a.version);
    return { item, matches, best: matches.length > 0 ? matches[0].version : null };
  });

  const pending = covering.filter((c) =>
    c.matches.some((m) => m.version > input.storedVersion),
  );
  const stampAhead = covering.filter(
    (c) =>
      c.matches.length > 0 && c.matches.every((m) => m.version <= input.storedVersion),
  );
  const uncovered = covering.filter((c) => c.matches.length === 0);

  /** At most three matches, newest first, with a count of the rest. */
  const describeMatches = (matches: { version: number; name: string }[]): string => {
    const shown = matches.slice(0, 3).map((m) => `${m.version} (${m.name})`);
    const rest = matches.length - shown.length;
    return rest > 0 ? `${shown.join(", ")}, +${rest} earlier` : shown.join(", ");
  };

  const lines: string[] = [];
  lines.push("Correlation with the registered migrations (matched by migration name and");
  lines.push(`description; stored migrations_version = ${input.storedVersion}):`);

  if (pending.length > 0) {
    lines.push("");
    lines.push("  A. PENDING MIGRATIONS COVER THESE ITEMS:");
    for (const c of pending) {
      const versions = describeMatches(c.matches.filter((m) => m.version > input.storedVersion));
      lines.push(`     - ${c.item.label}  →  ${versions}`);
    }
    lines.push("     Those migrations have not been applied to this database. They run");
    lines.push("     automatically on the next boot — if this boot reached the drift gate");
    lines.push("     with them still pending, read the migration error printed above: that");
    lines.push("     failure is the real fault and this drift is only its symptom.");
  }

  if (stampAhead.length > 0) {
    // Resume from just below the EARLIEST of the per-item best matches: low
    // enough that every drifted item's migration re-runs, high enough not to
    // replay half the history because one old migration happened to mention
    // a column name.
    const lowest = Math.min(...stampAhead.map((c) => c.best!));
    const resumeFrom = lowest - 1;
    lines.push("");
    lines.push("  B. THE STORED VERSION IS AHEAD OF THE SCHEMA:");
    for (const c of stampAhead) {
      lines.push(`     - ${c.item.label}  →  ${describeMatches(c.matches)}`);
    }
    lines.push(
      `     Those migrations are recorded as applied (stored version ${input.storedVersion}),`,
    );
    lines.push("     but their result is not in the database. That is what an empty-database");
    lines.push("     bootstrap, a restored dump, or a hand-edited variable leaves behind.");
    lines.push("     Replay them: set");
    lines.push("");
    lines.push(`         MIGRATIONS_RESUME_FROM_VERSION=${resumeFrom}`);
    lines.push("");
    lines.push("     and redeploy. That lowers the stored version once, re-applies every");
    lines.push("     migration above it, and is logged as a one-shot recovery. REMOVE the");
    lines.push("     variable after the boot succeeds — left in place it sets the stamp on");
    lines.push("     every restart.");
    lines.push("     The migrations in that range check for their own work before doing it,");
    lines.push("     so re-applying them over schema that is already correct is a no-op. If");
    lines.push("     one of them refuses to re-apply anyway, the boot stops and names it:");
    lines.push("     set the SAME variable to THAT migration's version to declare it applied");
    lines.push("     and resume past it. Do that only when its work is verifiably present.");
  }

  if (uncovered.length > 0) {
    lines.push("");
    lines.push("  C. NO REGISTERED MIGRATION COVERS THESE ITEMS:");
    for (const c of uncovered) lines.push(`     - ${c.item.label}`);
    lines.push("     No environment variable can repair these: nothing in the image knows");
    lines.push("     how to create them. A baseline script must ship in the NEXT image");
    lines.push("     (scripts/migrate/baseline/<name>-<YYYYMMDD>.ts, registered from");
    lines.push("     scripts/migrate/index.ts) — see docs/baselining.md. If instead you are");
    lines.push("     a developer who just changed shared/schema*, the missing piece is your");
    lines.push("     own migration under scripts/migrate/core/ or components/<id>/.");
  }

  lines.push("");
  lines.push("  To inspect this deployment without letting it write anything, redeploy with");
  lines.push("  BRINGUP_REPORT_ONLY=1: it prints the full bring-up report and stops before");
  lines.push("  any migration, bootstrap or variable write. The runbook for a target you");
  lines.push("  cannot log into is in docs/aurora.md ('Diagnosing a deployment with no shell').");
  return lines;
}

function formatAggregate(r: AggregateDriftReport, remediation: string[]): string {
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
  if (r.extraTables.length > 0) {
    lines.push("");
    lines.push("Extra tables (in DB, not owned by core or any component manifest):");
    for (const t of r.extraTables) lines.push(`  - ${t}`);
  }
  if (r.perTable.length > 0) {
    lines.push("");
    lines.push("Per-table drift:");
    for (const t of r.perTable) {
      lines.push(`  Table ${t.tableName}:`);
      if (t.missingColumns.length) lines.push(`    - missing columns: ${t.missingColumns.join(", ")}`);
      if (t.extraColumns.length) lines.push(`    - extra columns: ${t.extraColumns.join(", ")}`);
      if (t.typeMismatches.length) lines.push(`    - type mismatches: ${t.typeMismatches.join("; ")}`);
      if (t.missingConstraints.length) lines.push(`    - missing constraints: ${t.missingConstraints.join("; ")}`);
      if (t.missingIndexes.length) lines.push(`    - missing indexes: ${t.missingIndexes.join("; ")}`);
    }
  }
  lines.push("");
  lines.push("To resolve:");
  if (remediation.length > 0) {
    for (const line of remediation) lines.push(line);
    lines.push("");
    lines.push("  (In development only, SKIP_SCHEMA_DRIFT_CHECK=1 bypasses this gate. Never");
    lines.push("  set it on a deployment — it boots the app against a schema it disagrees with.)");
  } else {
    lines.push("  (the migration registry was not available, so no correlation was made)");
    lines.push("  Add the missing migration under scripts/migrate/core/ or");
    lines.push("  scripts/migrate/components/<id>/, or ship a baseline — see docs/baselining.md.");
  }
  return lines.join("\n");
}

/** Drift items as one line each, for the bring-up report's drift section. */
function summarizeAggregate(r: AggregateDriftReport): string[] {
  const lines = [
    `checked: ${r.coreTableCount} core table(s) + ${r.checkedComponents.length} enabled component(s)`,
  ];
  for (const item of enumerateDriftItems(r)) lines.push(`  - ${item.label}`);
  return lines;
}

/**
 * Run the drift check WITHOUT enforcing it, recording the outcome (and, when
 * it fails, the prescriptive remediation) into the bring-up report. Used by
 * report-only mode, which must not throw and must not write.
 */
export async function reportSchemaDriftOnly(storedVersion: number): Promise<void> {
  const report = await checkAggregateSchemaDrift();
  if (!report.hasDrift) {
    recordDriftOutcome("passed", summarizeAggregate(report));
    return;
  }
  recordDriftOutcome("failed", [
    ...summarizeAggregate(report),
    "",
    ...buildDriftRemediation(report, { storedVersion, migrations: getMigrations() }),
  ]);
}

/**
 * Run the aggregate drift check and throw `StartupSchemaDriftError` if any
 * drift is detected. Honors `SKIP_SCHEMA_DRIFT_CHECK=1` as a dev escape hatch.
 */
export async function enforceStartupSchemaDrift(): Promise<void> {
  if (getEnvironmentVariable("SKIP_SCHEMA_DRIFT_CHECK") === "1") {
    bootStatus.driftCheck = "skipped";
    recordDriftOutcome("skipped", [
      "SKIP_SCHEMA_DRIFT_CHECK=1 — this boot did NOT verify the schema.",
      "Whatever the app then does against this database is unvalidated.",
    ]);
    logger.warn("Schema drift check SKIPPED via SKIP_SCHEMA_DRIFT_CHECK=1", {
      source: "startup",
      service: "schema-drift-check",
    });
    return;
  }

  const report = await checkAggregateSchemaDrift();
  if (!report.hasDrift) {
    bootStatus.driftCheck = "passed";
    recordDriftOutcome("passed", summarizeAggregate(report));
    logger.info("Schema drift check passed", {
      source: "startup",
      service: "schema-drift-check",
      coreTables: report.coreTableCount,
      components: report.checkedComponents.length,
    });
    return;
  }

  bootStatus.driftCheck = "failed";
  logger.error("Schema drift detected at startup", {
    source: "startup",
    service: "schema-drift-check",
    missingTables: report.missingTables,
    driftTableCount: report.perTable.length,
  });

  // Correlate against the migration registry so the operator is told WHICH
  // of the three indistinguishable situations this is, and what to set.
  const { currentVersion } = await getMigrationStatus();
  const remediation = buildDriftRemediation(report, {
    storedVersion: currentVersion,
    migrations: getMigrations(),
  });
  recordDriftOutcome("failed", [...summarizeAggregate(report), "", ...remediation]);
  throw new StartupSchemaDriftError(report, remediation);
}
