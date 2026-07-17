/**
 * Empty-database bootstrap (Task #670).
 *
 * Historically this app could only boot against a database that had been
 * shaped by years of `db:push` runs — the migration framework assumes the
 * core tables already exist (the migration runner itself stores its version
 * in the `variables` table, and no migration creates the core tables). A
 * truly empty database (e.g. a freshly provisioned Aurora cluster) therefore
 * could not be initialized by the app at all.
 *
 * This module closes that gap. At startup, BEFORE anything touches the
 * database, it:
 *
 *   1. Detects whether the database is empty (no `variables` table AND no
 *      other tables in the public schema).
 *   2. If empty and `ALLOW_EMPTY_DB_BOOTSTRAP=1` is set, creates the full
 *      current schema — every core table in `shared/schema.ts` plus the
 *      tables of every default-enabled schema-managing component — by
 *      reusing the Drizzle→DDL generator in `component-schema-push.ts`
 *      (enums, tables with constraints, indexes), ordered by foreign-key
 *      dependencies.
 *   3. Stamps `migrations_version` to the highest registered core migration
 *      version and initializes `component_schema_state_<id>` (including
 *      `migrationVersion`) for each default-enabled schema-managing
 *      component, so no historical migration ever replays against the
 *      freshly created schema.
 *   4. Lets the existing startup drift gate verify the result — bootstrap
 *      does not weaken or bypass any existing check.
 *
 * If the database is empty and the env var is NOT set, boot fails with a
 * clear operator-facing error instead of the previous cryptic
 * `relation "variables" does not exist`. If the database is non-empty,
 * this module is a strict no-op.
 *
 * NOTE on the storage-layer rule: like the migration runner and the drift
 * gate, this is bootstrap infrastructure that must run before the app is
 * functional — it uses the sanctioned introspection helpers in
 * `server/storage/utils.ts` and executes its generated DDL through
 * `storage.rawSql`, the same path `component-schema-push.ts` uses.
 */

import {
  getSchemaManagingComponents,
  getComponentSchemaStateVariableName,
  type ComponentDefinition,
  type ComponentSchemaState,
  type ComponentTableState,
} from "../../shared/components";
import * as mainSchema from "../../shared/schema";
import { generateCreateStatements } from "./component-schema-push";
import { storage } from "../storage";
import { runInTransaction } from "../storage/transaction-context";
import { tableExists, listAllPublicTables } from "../storage/utils";
import {
  getMigrations,
  getAllComponentMigrations,
} from "../../scripts/migrate";
import { logger } from "../logger";

const NAME_SYM_DESC = "drizzle:Name";

function getDrizzleTableName(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const sym = Object.getOwnPropertySymbols(value).find(
    (s) => s.description === NAME_SYM_DESC,
  );
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

function collectPgEnums(module: Record<string, unknown>): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const value of Object.values(module)) {
    if (value && typeof value === "function") {
      const v = value as any;
      if (typeof v.enumName === "string" && Array.isArray(v.enumValues)) {
        result.set(v.enumName, v.enumValues);
      }
    }
  }
  return result;
}

async function loadComponentSchemaModule(
  schemaPath: string,
): Promise<Record<string, unknown>> {
  try {
    const rel = schemaPath.replace(/^\.\//, "");
    const url = new URL(`../../${rel}`, import.meta.url);
    return (await import(url.href)) as Record<string, unknown>;
  } catch {
    return mainSchema as unknown as Record<string, unknown>;
  }
}

interface TablePlan {
  tableName: string;
  createTableSql: string;
  createIndexSqls: string[];
  /** Tables this table's foreign keys reference (excluding itself). */
  dependsOn: Set<string>;
}

/** FK targets as emitted by component-schema-push's renderForeignKey. */
const FK_REFERENCE_RE = /FOREIGN KEY \([^)]*\) REFERENCES "([^"]+)"/g;

function extractFkTargets(createTableSql: string, selfName: string): Set<string> {
  const out = new Set<string>();
  for (const m of createTableSql.matchAll(FK_REFERENCE_RE)) {
    if (m[1] !== selfName) out.add(m[1]);
  }
  return out;
}

/**
 * Order table plans so every table is created after all tables it references.
 * Self-references are fine inline; cycles (which would need deferred ALTERs)
 * are reported as a hard error rather than guessed at.
 */
function topoSortPlans(plans: TablePlan[]): TablePlan[] {
  const byName = new Map(plans.map((p) => [p.tableName, p]));
  const sorted: TablePlan[] = [];
  const placed = new Set<string>();

  // Validate external references up front: on an empty database, an FK to a
  // table we are not creating can never succeed.
  for (const p of plans) {
    for (const dep of p.dependsOn) {
      if (!byName.has(dep)) {
        throw new Error(
          `[empty-db-bootstrap] Table "${p.tableName}" references "${dep}", which is not part of the ` +
            `bootstrap set (core tables + default-enabled schema-managing components). ` +
            `This usually means a core table references a component-owned table.`,
        );
      }
    }
  }

  let remaining = plans.slice();
  while (remaining.length > 0) {
    const ready = remaining.filter((p) =>
      [...p.dependsOn].every((dep) => placed.has(dep)),
    );
    if (ready.length === 0) {
      throw new Error(
        `[empty-db-bootstrap] Circular foreign-key dependency among tables: ` +
          remaining.map((p) => p.tableName).join(", ") +
          `. Bootstrap cannot order their CREATE TABLE statements; this requires deferred ALTER TABLE support.`,
      );
    }
    for (const p of ready) {
      sorted.push(p);
      placed.add(p.tableName);
    }
    remaining = remaining.filter((p) => !placed.has(p.tableName));
  }
  return sorted;
}

function highestVersion(migrations: { version: number }[]): number {
  return migrations.reduce((max, m) => Math.max(max, m.version), 0);
}

/**
 * Detect an empty database and either bootstrap it (when
 * `ALLOW_EMPTY_DB_BOOTSTRAP=1`) or fail with a clear operator error.
 * Strict no-op on any database that already has a `variables` table.
 */
export async function ensureEmptyDatabaseBootstrap(): Promise<void> {
  const hasVariables = await tableExists("variables");
  if (hasVariables) {
    return; // Initialized database — normal startup path.
  }

  const liveTables = await listAllPublicTables();
  if (liveTables.length > 0) {
    throw new Error(
      [
        "This database has tables but no `variables` table, so it is neither empty nor",
        "initialized by this app. Empty-database bootstrap refuses to run against it.",
        `Existing tables: ${liveTables.join(", ")}`,
        "If this is a legacy or foreign database, point DATABASE_URL at a different database",
        "or clean this one out manually before bootstrapping.",
      ].join("\n"),
    );
  }

  if (process.env.ALLOW_EMPTY_DB_BOOTSTRAP !== "1") {
    throw new Error(
      [
        "The configured database is EMPTY (no tables in the public schema).",
        "",
        "This app cannot run against an uninitialized database. If this is a brand-new",
        "deployment and you intend to create the full schema from scratch, set",
        "",
        "    ALLOW_EMPTY_DB_BOOTSTRAP=1",
        "",
        "and restart. Bootstrap will create every core table plus the tables of all",
        "default-enabled schema-managing components, stamp the migration bookkeeping to",
        "the current version, and the normal startup drift gate will verify the result.",
        "See docs/aurora.md (\"Bootstrapping an empty database\") for details.",
        "",
        "If you did NOT expect an empty database, DATABASE_URL is probably pointing at",
        "the wrong place — fix it instead of setting the bootstrap flag.",
      ].join("\n"),
    );
  }

  logger.warn("Empty database detected — bootstrapping full schema (ALLOW_EMPTY_DB_BOOTSTRAP=1)", {
    source: "startup",
    service: "empty-db-bootstrap",
  });

  const mainModule = mainSchema as unknown as Record<string, unknown>;
  const mainIndex = buildSchemaTableIndex(mainModule);

  // Tables owned by ANY schema-managing component are excluded from the core
  // set (mirrors the drift gate's ownership rules).
  const componentOwned = new Set<string>();
  for (const c of getSchemaManagingComponents()) {
    for (const t of c.schemaManifest!.tables) componentOwned.add(t);
  }

  const defaultEnabledComponents = getSchemaManagingComponents().filter(
    (c) => c.enabledByDefault,
  );

  // ---- Collect enums (main schema + default-enabled component modules) ----
  const allEnums = collectPgEnums(mainModule);
  const componentModules = new Map<string, Record<string, unknown>>();
  for (const c of defaultEnabledComponents) {
    const mod = await loadComponentSchemaModule(c.schemaManifest!.schemaPath);
    componentModules.set(c.id, mod);
    for (const [name, values] of collectPgEnums(mod)) allEnums.set(name, values);
  }

  // ---- Generate DDL for every table in the bootstrap set ----
  const emittedEnums = new Set<string>();
  const enumStatements: string[] = [];
  const plans: TablePlan[] = [];

  const addTablePlan = (tableSchema: any, tableName: string) => {
    const statements = generateCreateStatements(
      tableSchema,
      tableName,
      allEnums,
      emittedEnums,
    );
    let createTableSql: string | null = null;
    const createIndexSqls: string[] = [];
    for (const stmt of statements) {
      if (stmt.kind === "create_type") {
        if (stmt.key) {
          if (emittedEnums.has(stmt.key)) continue;
          emittedEnums.add(stmt.key);
        }
        enumStatements.push(stmt.sql);
      } else if (stmt.kind === "create_table") {
        createTableSql = stmt.sql;
      } else if (stmt.kind === "create_index") {
        createIndexSqls.push(stmt.sql);
      }
    }
    if (!createTableSql) {
      throw new Error(
        `[empty-db-bootstrap] DDL generator produced no CREATE TABLE for "${tableName}".`,
      );
    }
    plans.push({
      tableName,
      createTableSql,
      createIndexSqls,
      dependsOn: extractFkTargets(createTableSql, tableName),
    });
  };

  // Core tables: everything in shared/schema.ts not owned by a component.
  for (const [tableName, tableSchema] of mainIndex) {
    if (componentOwned.has(tableName)) continue;
    addTablePlan(tableSchema, tableName);
  }

  // Default-enabled schema-managing components: their manifest tables.
  for (const c of defaultEnabledComponents) {
    const mod = componentModules.get(c.id)!;
    const modIndex = buildSchemaTableIndex(mod);
    for (const tableName of c.schemaManifest!.tables) {
      const tableSchema = modIndex.get(tableName) ?? mainIndex.get(tableName);
      if (!tableSchema) {
        throw new Error(
          `[empty-db-bootstrap] No Drizzle definition found for table "${tableName}" of component ${c.id}.`,
        );
      }
      addTablePlan(tableSchema, tableName);
    }
  }

  const ordered = topoSortPlans(plans);

  // Execute all DDL AND the migration-bookkeeping stamps in a single
  // transaction (Postgres DDL is transactional). If anything fails partway,
  // the database is left exactly as empty as it started, instead of stranded
  // in the "tables but no variables" state that the guard above refuses to
  // touch.
  const coreVersion = highestVersion(getMigrations());
  await runInTransaction(async () => {
    // ---- Execute: enums → tables (FK order) → indexes ----
    for (const sql of enumStatements) {
      await storage.rawSql.execute(sql);
    }
    for (const plan of ordered) {
      await storage.rawSql.execute(plan.createTableSql);
    }
    for (const plan of ordered) {
      for (const sql of plan.createIndexSqls) {
        await storage.rawSql.execute(sql);
      }
    }

    // ---- Stamp migration bookkeeping so history never replays ----
    // Core: `migrations_version` = highest registered core migration version
    // (includes baseline scripts at >= 1000 — they are per-deployment fix-ups
    // that a freshly created schema must never run).
    await storage.variables.create({
      name: "migrations_version",
      value: coreVersion,
    });

    // Components: initialize component_schema_state_<id> for each
    // default-enabled schema-managing component, with migrationVersion set to
    // its highest registered per-component migration.
    const componentMigrations = getAllComponentMigrations();
    const now = new Date().toISOString();
    for (const c of defaultEnabledComponents) {
      const tables: ComponentTableState[] = c.schemaManifest!.tables.map(
        (tableName) => ({
          tableName,
          status: "active",
          appliedAt: now,
          droppedAt: null,
          checksum: `v${c.schemaManifest!.version ?? 1}`,
        }),
      );
      const state: ComponentSchemaState = {
        manifestVersion: c.schemaManifest!.version ?? 1,
        lastSyncedAt: now,
        tables,
        drift: null,
        migrationVersion: highestVersion(componentMigrations.get(c.id) ?? []),
      };
      await storage.variables.create({
        name: getComponentSchemaStateVariableName(c.id),
        value: state,
      });
    }
  });

  logger.warn("Empty-database bootstrap complete", {
    source: "startup",
    service: "empty-db-bootstrap",
    tablesCreated: ordered.length,
    enumsCreated: enumStatements.length,
    migrationsVersionStamped: coreVersion,
    componentStatesInitialized: defaultEnabledComponents.map(
      (c: ComponentDefinition) => c.id,
    ),
  });
}
