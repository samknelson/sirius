import { getTableColumns } from "drizzle-orm";
import { getTableConfig, type AnyPgTable, type PgColumn } from "drizzle-orm/pg-core";
import { normalizeFieldName } from "@shared/tokens";
import { registerTokenPlugin } from "../registry";
import { memo, type TokenEntity, type TokenEvalContext } from "../types";
import {
  ENTITY_PATH_FIELD,
  entityDeclaresLocation,
  resolveEntityPath,
} from "../entity-location";
import { resolveRowKey } from "../row-key";
import { formatPhpDate, fmtDateShort } from "../php-date";

// Re-exported from its own module (the entity-location builder needs it
// too, and this file imports that builder).
export { resolveRowKey };

function columnFor(entity: TokenEntity, rowKey: string): PgColumn | undefined {
  if (!entity.table) return undefined;
  const cols = getTableColumns(entity.table) as Record<string, PgColumn>;
  return cols[rowKey];
}

/**
 * When the column is a foreign key to a table with a `name` column
 * (options tables, bargaining units, employers, …), render the
 * referenced row's display name instead of the raw id.
 */
async function followForeignKeyName(
  entity: TokenEntity,
  column: PgColumn,
  value: string,
  ctx: TokenEvalContext,
): Promise<string | null> {
  if (!entity.table) return null;
  const config = getTableConfig(entity.table);
  for (const fk of config.foreignKeys) {
    const ref = fk.reference();
    if (ref.columns.length !== 1 || ref.columns[0].name !== column.name) continue;
    const target = ref.foreignColumns[0].table as AnyPgTable;
    const targetCols = getTableColumns(target) as Record<string, PgColumn>;
    if (!targetCols.name) return null;
    const targetConfig = getTableConfig(target);
    const targetKeyCol = ref.foreignColumns[0].name;
    return memo(ctx, `fk-name:${targetConfig.name}:${value}`, () =>
      ctx.storage.bulkTokens.getNameByReference(
        targetConfig.name,
        targetKeyCol,
        value,
      ),
    );
  }
  return null;
}

function isDateColumn(column: PgColumn | undefined): boolean {
  if (!column) return false;
  const t = column.columnType || "";
  return t.includes("Date") || t.includes("Timestamp");
}

function formatValue(
  value: unknown,
  column: PgColumn | undefined,
  format: string | undefined,
): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date || isDateColumn(column)) {
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return format ? formatPhpDate(d, format) : fmtDateShort(d);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((v) => (v == null ? "" : String(v)))
      .filter((v) => v !== "");
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (typeof value === "object") return null; // jsonb blobs are not renderable
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * Generic leaf: {{…entity.field(name="…")}} — reads any field off the
 * current entity. Works on every entity type; valid names derive from
 * the entity's declared table (see entityTable) plus derived extras.
 * Foreign keys to named tables render the referenced display name;
 * dates format with fmtDateShort or an explicit PHP-style format.
 */
registerTokenPlugin({
  metadata: {
    id: "token.field",
    name: "Field",
    shortLabel: "field",
    description: "A named field of the current entity",
    segmentName: "field",
    inputTypes: ["*"],
    outputType: "value",
    args: {
      name: {
        required: true,
        description: "Field name as defined in the schema (snake_case or camelCase)",
      },
      format: {
        description: "PHP-style date format for date fields (e.g. Y-m-d)",
      },
      default: {
        description: "Fallback text when the field is empty",
      },
    },
  },
  async resolve(entity, args, ctx) {
    const e = entity as TokenEntity | null;
    if (!e || typeof e !== "object" || !e.row) return null;
    const fallback = args.default || null;
    // `path` is advertised as a field of every kind that declared where
    // its records live, and resolved through the SAME builder the
    // `path` leaf uses, so the two can never drift apart. A field takes
    // no arguments, so it is always the kind's default tab. The boot
    // check refuses a declaration on a table that has a real `path`
    // column, so this can never shadow a stored value.
    if (
      normalizeFieldName(args.name) === ENTITY_PATH_FIELD &&
      entityDeclaresLocation(e.kind)
    ) {
      return resolveEntityPath(e) ?? fallback;
    }
    const key = resolveRowKey(e, args.name);
    if (!key) return fallback;
    const value = e.row[key];
    if (value == null || value === "") return fallback;
    const column = columnFor(e, key);
    if (column && typeof value === "string") {
      const refName = await followForeignKeyName(e, column, value, ctx);
      if (refName) return refName;
    }
    return formatValue(value, column, args.format) ?? fallback;
  },
  sampleValue(args) {
    return args.default || `\u00AB${args.name || "field"}\u00BB`;
  },
});
