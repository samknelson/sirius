/**
 * Task #730 verification: table creation ordering in component schema push.
 *
 * 1. For EVERY schema-managing component, resolve its manifest tables and run
 *    sortTablesByDependencies — asserts no cycles and that every table comes
 *    after all its intra-component FK targets.
 * 2. Asserts the EDLS order places options_edls_tasks before edls_crews even
 *    if the manifest were mis-ordered (simulated with a shuffled manifest).
 */
import { getSchemaManagingComponents, getComponentById } from "../../shared/components";
import * as mainSchema from "../../shared/schema";
import { sortTablesByDependencies } from "../../server/services/component-schema-push";

const NAME_SYM_PREFIX = "drizzle:Name";
function getSym(obj: any, description: string): symbol | undefined {
  return Object.getOwnPropertySymbols(obj).find((s) => s.description === description);
}
function tableNameOf(table: any): string | null {
  const sym = getSym(table, NAME_SYM_PREFIX);
  return sym ? (table[sym] as string) : null;
}

function findTable(mod: Record<string, unknown>, tableName: string): any {
  for (const value of Object.values(mod)) {
    if (value && typeof value === "object" && tableNameOf(value) === tableName) return value;
  }
  return null;
}

async function loadModule(schemaPath: string): Promise<Record<string, unknown>> {
  const rel = schemaPath.replace(/^\.\/shared\//, "../../shared/").replace(/\.ts$/, "");
  try {
    return (await import(rel)) as Record<string, unknown>;
  } catch {
    return mainSchema as unknown as Record<string, unknown>;
  }
}

function intraDeps(tableSchema: any, tableName: string, manifest: Set<string>): string[] {
  // re-derive FK targets the same way the sorter does, via drizzle symbols
  const out = new Set<string>();
  const inlineSym = getSym(tableSchema, "drizzle:PgInlineForeignKeys");
  const fks: any[] = inlineSym ? tableSchema[inlineSym] ?? [] : [];
  for (const fk of fks) {
    const ref = fk.reference();
    const t = tableNameOf(ref.foreignTable);
    if (t && t !== tableName && manifest.has(t)) out.add(t);
  }
  const ebSym = getSym(tableSchema, "drizzle:ExtraConfigBuilder");
  const ecSym = getSym(tableSchema, "drizzle:ExtraConfigColumns");
  if (ebSym && typeof tableSchema[ebSym] === "function") {
    const cfg = tableSchema[ebSym](ecSym ? tableSchema[ecSym] : {});
    const items: any[] = Array.isArray(cfg) ? cfg : Object.values(cfg ?? {});
    for (const item of items) {
      if (item && item.constructor?.name === "ForeignKeyBuilder") {
        const built = item.build(tableSchema);
        const t = tableNameOf(built.reference().foreignTable);
        if (t && t !== tableName && manifest.has(t)) out.add(t);
      }
    }
  }
  return [...out];
}

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  PASS: ${msg}`);
  else {
    failures++;
    console.error(`  FAIL: ${msg}`);
  }
}

async function main() {
  for (const component of getSchemaManagingComponents()) {
    if (!component.managesSchema || !component.schemaManifest) continue;
    const { tables, schemaPath } = component.schemaManifest;
    console.log(`\nComponent ${component.id} (${tables.length} tables)`);
    const mod = await loadModule(schemaPath);
    const resolved = tables.map((tableName) => {
      let tableSchema = findTable(mod, tableName) ?? findTable(mainSchema as any, tableName);
      if (!tableSchema) throw new Error(`table ${tableName} not found for ${component.id}`);
      return { tableName, tableSchema };
    });
    const ordered = sortTablesByDependencies(resolved, component.id);
    check(ordered.length === tables.length, `sorted output has all ${tables.length} tables`);
    const manifestSet = new Set(tables);
    const pos = new Map(ordered.map((t, i) => [t.tableName, i]));
    for (const t of ordered) {
      for (const dep of intraDeps(t.tableSchema, t.tableName, manifestSet)) {
        check(
          pos.get(dep)! < pos.get(t.tableName)!,
          `${component.id}: ${dep} created before ${t.tableName}`,
        );
      }
    }
  }

  // EDLS worst-case: fully reversed manifest still sorts correctly.
  const edls = getComponentById("edls")!;
  const mod = await loadModule(edls.schemaManifest!.schemaPath);
  const reversed = [...edls.schemaManifest!.tables].reverse().map((tableName) => ({
    tableName,
    tableSchema: findTable(mod, tableName) ?? findTable(mainSchema as any, tableName),
  }));
  const ordered = sortTablesByDependencies(reversed, "edls");
  const names = ordered.map((t) => t.tableName);
  console.log(`\nEDLS reversed-manifest order: ${names.join(", ")}`);
  check(
    names.indexOf("options_edls_tasks") < names.indexOf("edls_crews"),
    "reversed manifest: options_edls_tasks before edls_crews",
  );
  check(
    names.indexOf("edls_sheets") < names.indexOf("edls_crews"),
    "reversed manifest: edls_sheets before edls_crews",
  );
  check(
    names.indexOf("edls_crews") < names.indexOf("edls_assignments"),
    "reversed manifest: edls_crews before edls_assignments",
  );

  // Cycle detection: fabricate a two-table cycle using drizzle tables.
  const { pgTable, varchar } = await import("drizzle-orm/pg-core");
  const a: any = pgTable("cycle_a", { id: varchar("id").primaryKey(), bId: varchar("b_id").references(() => b.id) });
  const b: any = pgTable("cycle_b", { id: varchar("id").primaryKey(), aId: varchar("a_id").references((): any => a.id) });
  try {
    sortTablesByDependencies(
      [
        { tableName: "cycle_a", tableSchema: a },
        { tableName: "cycle_b", tableSchema: b },
      ],
      "test",
    );
    check(false, "cycle detection throws");
  } catch (e: any) {
    check(/Circular foreign-key dependency/.test(e.message), `cycle detection throws: ${e.message.slice(0, 80)}...`);
  }

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
