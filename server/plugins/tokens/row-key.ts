import { getTableColumns } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { normalizeFieldName } from "@shared/tokens";
import type { TokenEntity } from "./types";

/**
 * Find the row key matching a requested field name. Accepts either the
 * TS property name (camelCase) or the DB column name (snake_case);
 * comparison is case/underscore-insensitive.
 *
 * Lives in its own module rather than beside the generic field leaf that
 * made it: the entity-location builder needs it too, and that module is
 * imported BY the field leaf.
 */
export function resolveRowKey(entity: TokenEntity, name: string): string | null {
  const wanted = normalizeFieldName(name);
  // Direct row keys (covers derived/denorm extras and shaped entities).
  for (const key of Object.keys(entity.row)) {
    if (normalizeFieldName(key) === wanted) return key;
  }
  // DB column names → TS property names via the declared table.
  if (entity.table) {
    for (const [prop, col] of Object.entries(getTableColumns(entity.table))) {
      if (normalizeFieldName((col as PgColumn).name) === wanted) return prop;
    }
  }
  return null;
}
