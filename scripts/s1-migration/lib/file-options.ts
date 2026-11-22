import { sql } from "drizzle-orm";
import { db } from "../../../server/storage/db";
import { FILE_TYPES, type FileType } from "./file-candidates";

/** Validate all definitions before creating any: a late collision writes nothing. */
export async function ensureFileTypes(dryRun: boolean) {
  const result = await db.execute(sql`SELECT id,name,sirius_id,data FROM options_file_type`);
  const rows = (result as unknown as { rows: Array<{ id: string; name: string; sirius_id: string; data: { contextIds?: string[] } }> }).rows;
  const ids = new Map<FileType, string>();
  const missing: typeof FILE_TYPES[number][] = [];
  for (const def of FILE_TYPES) {
    const [key, name, context] = def;
    const matches = rows.filter(r => r.sirius_id === `s1-file-${key}`);
    if (matches.length > 1 || rows.some(r => r.name === name && r.sirius_id !== `s1-file-${key}`)) throw new Error("file_type_collision");
    if (!matches.length) { missing.push(def); continue; }
    const row = matches[0];
    if (row.name !== name || JSON.stringify(row.data?.contextIds) !== JSON.stringify([context])) throw new Error("file_type_incompatible");
    ids.set(key, row.id);
  }
  if (dryRun && missing.length) throw new Error("dry_run_file_types_missing");
  for (const [key, name, context] of missing) {
    const inserted = await db.execute(sql`INSERT INTO options_file_type(id,name,sirius_id,data)
      VALUES(${`s1-file-${key}`},${name},${`s1-file-${key}`},${JSON.stringify({ contextIds: [context] })}::jsonb) RETURNING id`);
    ids.set(key, (inserted as unknown as { rows: { id: string }[] }).rows[0].id);
  }
  return ids;
}
