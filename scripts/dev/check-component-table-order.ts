#!/usr/bin/env tsx
/**
 * Check Component Table Ordering
 *
 * A component's manifest tables are created in FK-dependency order at
 * enable time (`sortTablesByDependencies` in
 * `server/services/component-schema-push.ts`). That sort can fail in two
 * ways that would break a fresh production enable with
 * "relation does not exist" (or refuse the enable outright):
 *
 * 1. A manifest table cannot be resolved to a Drizzle table definition
 *    in the component's schema module (or the main schema).
 * 2. The component's tables have a circular foreign-key dependency, so
 *    no valid creation order exists.
 *
 * This script runs the exact production sorter over every
 * schema-managing component in `shared/components.ts` and fails with an
 * actionable message on either problem, so a future component addition
 * can never reintroduce the fresh-enable failure at runtime.
 *
 * It also re-verifies the sorted output: every table must come after
 * every intra-component table it references.
 *
 * Usage: npx tsx scripts/dev/check-component-table-order.ts
 */
import { getSchemaManagingComponents } from "../../shared/components";
import * as mainSchema from "../../shared/schema";
import { sortTablesByDependencies } from "../../server/services/component-schema-push";

function getSym(obj: any, description: string): symbol | undefined {
  return Object.getOwnPropertySymbols(obj).find((s) => s.description === description);
}

function tableNameOf(table: any): string | null {
  const sym = getSym(table, "drizzle:Name");
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

/**
 * Re-derive a table's intra-component FK targets (inline .references()
 * plus extraConfig foreignKey() builders) the same way the sorter does,
 * so we can independently verify the sorted order.
 */
function intraDeps(tableSchema: any, tableName: string, manifest: Set<string>): string[] {
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

async function main(): Promise<void> {
  const errors: string[] = [];
  let componentCount = 0;
  let tableCount = 0;

  for (const component of getSchemaManagingComponents()) {
    if (!component.managesSchema || !component.schemaManifest) continue;
    componentCount++;
    const { tables, schemaPath } = component.schemaManifest;
    tableCount += tables.length;
    const mod = await loadModule(schemaPath);

    const resolved: { tableName: string; tableSchema: any }[] = [];
    let resolutionFailed = false;
    for (const tableName of tables) {
      const tableSchema =
        findTable(mod, tableName) ??
        findTable(mainSchema as unknown as Record<string, unknown>, tableName);
      if (!tableSchema) {
        errors.push(
          `Component "${component.id}": manifest table "${tableName}" has no Drizzle table ` +
            `definition in ${schemaPath} (or shared/schema). A fresh enable would fail with ` +
            `"Table ${tableName} not found in schema module". Export a pgTable named ` +
            `"${tableName}" from the component's schema module, or remove it from the manifest.`,
        );
        resolutionFailed = true;
        continue;
      }
      resolved.push({ tableName, tableSchema });
    }
    if (resolutionFailed) continue;

    let ordered: { tableName: string; tableSchema: any }[];
    try {
      ordered = sortTablesByDependencies(resolved, component.id);
    } catch (e: any) {
      errors.push(
        `Component "${component.id}": sortTablesByDependencies failed — ${e.message}. ` +
          `A fresh enable of this component would fail. Break the FK cycle (e.g. make one ` +
          `side's FK a plain column plus a deferred constraint added by a component migration).`,
      );
      continue;
    }

    if (ordered.length !== tables.length) {
      errors.push(
        `Component "${component.id}": sorted output has ${ordered.length} tables but the ` +
          `manifest lists ${tables.length}. The sorter dropped or duplicated a table.`,
      );
      continue;
    }

    const manifestSet = new Set(tables);
    const pos = new Map(ordered.map((t, i) => [t.tableName, i]));
    for (const t of ordered) {
      for (const dep of intraDeps(t.tableSchema, t.tableName, manifestSet)) {
        if (pos.get(dep)! >= pos.get(t.tableName)!) {
          errors.push(
            `Component "${component.id}": sorted order creates "${t.tableName}" before its ` +
              `FK target "${dep}" — a fresh enable would fail with "relation does not exist".`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error("Component table-order check FAILED:\n");
    for (const err of errors) {
      console.error(`  ✗ ${err}\n`);
    }
    console.error(
      `${errors.length} problem(s) across schema-managing components. Fix the schema/manifest ` +
        `so every component's tables resolve and sort into a valid FK creation order.`,
    );
    process.exit(1);
  }

  console.log(
    `✓ Component table-order check passed: ${componentCount} schema-managing component(s), ` +
      `${tableCount} manifest table(s) all resolve and sort into a valid FK creation order.`,
  );
}

main().catch((e) => {
  console.error(`Component table-order check crashed: ${e?.stack ?? e}`);
  process.exit(1);
});
