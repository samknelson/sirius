import * as coreSchema from "../../shared/schema";
import { pool } from "../../server/storage/db";

const INLINE_FKS_SYM = "drizzle:PgInlineForeignKeys";
const NAME_SYM = "drizzle:Name";
const EXTRA_CONFIG_BUILDER_SYM = "drizzle:ExtraConfigBuilder";
const EXTRA_CONFIG_COLS_SYM = "drizzle:ExtraConfigColumns";
const COLS_SYM = "drizzle:Columns";

function getSym(obj: any, desc: string): symbol | undefined {
  return Object.getOwnPropertySymbols(obj).find((s) => s.description === desc);
}
function getTableName(t: any): string | undefined {
  const s = getSym(t, NAME_SYM);
  return s ? t[s] : undefined;
}

interface ExpectedFk {
  table: string;
  cols: string[];
  ftable: string;
  fcols: string[];
  name?: string;
  onDelete?: string;
  onUpdate?: string;
}

function collectFks(tableSchema: any): ExpectedFk[] {
  const tableName = getTableName(tableSchema);
  if (!tableName) return [];
  const out: ExpectedFk[] = [];
  const push = (fk: any) => {
    const ref = fk.reference();
    const ftable = getTableName(ref.foreignTable);
    if (!ftable) return;
    out.push({
      table: tableName,
      cols: ref.columns.map((c: any) => c.name as string),
      ftable,
      fcols: ref.foreignColumns.map((c: any) => c.name as string),
      name: fk.name ?? ref.name,
      onDelete: fk.onDelete,
      onUpdate: fk.onUpdate,
    });
  };
  const inlineSym = getSym(tableSchema, INLINE_FKS_SYM);
  if (inlineSym) for (const fk of (tableSchema[inlineSym] as any[]) ?? []) push(fk);

  const ebSym = getSym(tableSchema, EXTRA_CONFIG_BUILDER_SYM);
  const ecSym = getSym(tableSchema, EXTRA_CONFIG_COLS_SYM);
  const colsSym = getSym(tableSchema, COLS_SYM);
  if (ebSym && typeof tableSchema[ebSym] === "function") {
    const ecCols = ecSym ? tableSchema[ecSym] : colsSym ? tableSchema[colsSym] : {};
    const cfg = tableSchema[ebSym](ecCols);
    const items: any[] = Array.isArray(cfg) ? cfg : Object.values(cfg ?? {});
    for (const item of items) {
      if (item && item.constructor?.name === "ForeignKeyBuilder") {
        push(item.build(tableSchema));
      }
    }
  }
  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");

  // All pgTables exported from shared/schema (includes component re-exports)
  const tables: any[] = [];
  const seen = new Set<string>();
  for (const val of Object.values(coreSchema) as any[]) {
    if (!val || typeof val !== "object") continue;
    const name = getTableName(val);
    if (!name || seen.has(name)) continue;
    if (!getSym(val, COLS_SYM)) continue;
    seen.add(name);
    tables.push(val);
  }

  const existingTablesRes = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`
  );
  const existingTables = new Set(existingTablesRes.rows.map((r: any) => r.table_name));

  // Existing FKs, structurally keyed
  const fkRes = await pool.query(`
    SELECT c.conname,
           rel.relname AS table_name,
           frel.relname AS ftable_name,
           (SELECT array_agg(a.attname ORDER BY k.ord)
              FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols,
           (SELECT array_agg(a.attname ORDER BY k.ord)
              FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS fcols
      FROM pg_constraint c
      JOIN pg_class rel ON rel.oid = c.conrelid
      JOIN pg_class frel ON frel.oid = c.confrelid
     WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
  `);
  const toArr = (v: any): string[] =>
    Array.isArray(v) ? v : String(v).replace(/^\{|\}$/g, "").split(",").filter(Boolean);
  const existingFkKeys = new Set<string>();
  for (const r of fkRes.rows) {
    existingFkKeys.add(`${r.table_name}|${toArr(r.cols).join(",")}|${r.ftable_name}|${toArr(r.fcols).join(",")}`);
  }

  const missing: ExpectedFk[] = [];
  for (const t of tables) {
    const tName = getTableName(t)!;
    if (!existingTables.has(tName)) continue;
    for (const fk of collectFks(t)) {
      if (!existingTables.has(fk.ftable)) continue;
      const key = `${fk.table}|${fk.cols.join(",")}|${fk.ftable}|${fk.fcols.join(",")}`;
      if (!existingFkKeys.has(key)) missing.push(fk);
    }
  }

  console.log(`Expected-but-missing FKs: ${missing.length}`);
  let ok = 0;
  const failures: string[] = [];
  for (const fk of missing) {
    const name = fk.name ?? `${fk.table}_${fk.cols.join("_")}_${fk.ftable}_${fk.fcols.join("_")}_fk`;
    let sql = `ALTER TABLE "${fk.table}" ADD CONSTRAINT "${name}" FOREIGN KEY (${fk.cols
      .map((c) => `"${c}"`)
      .join(", ")}) REFERENCES "${fk.ftable}" (${fk.fcols.map((c) => `"${c}"`).join(", ")})`;
    if (fk.onDelete) sql += ` ON DELETE ${fk.onDelete.toUpperCase()}`;
    if (fk.onUpdate) sql += ` ON UPDATE ${fk.onUpdate.toUpperCase()}`;
    if (!apply) {
      console.log(`[dry-run] ${sql};`);
      continue;
    }
    try {
      await pool.query(sql);
      ok++;
    } catch (e: any) {
      failures.push(`${fk.table}.${fk.cols.join(",")}: ${e.message}`);
    }
  }
  if (apply) {
    console.log(`Added: ${ok}, failed: ${failures.length}`);
    for (const f of failures) console.log(`  FAIL ${f}`);
  }
  await pool.end();
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
