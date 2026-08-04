/**
 * S1 (Drupal 7 / MariaDB) source connection + field-metadata discovery.
 *
 * Spec: docs/s1-migration/ (local-only). Key rules honored here:
 * - `deleted` is an integer — compare unquoted (06 ETL traps).
 * - `entity_type` filter is load-bearing (field tables are shared across
 *   node/term/user/comment entities).
 * - Do NOT assume `language='und'` — we read all rows and count anomalies.
 * - Multi-value fields must never be flat-joined; callers aggregate by delta.
 */
import mysql from "mysql2/promise";
import type { Pool, RowDataPacket } from "mysql2/promise";

export function getS1Url(): string {
  const url = process.env.S1_DATABASE_URL;
  if (!url) {
    throw new Error(
      "S1_DATABASE_URL is not set. It must point at the synthetic S1 MariaDB (never production from this workspace).",
    );
  }
  return url;
}

export function createS1Pool(): Pool {
  return mysql.createPool({
    uri: getS1Url(),
    waitForConnections: true,
    connectionLimit: 4,
    // Verbatim staging: D7 DATE/DATETIME columns are wall-time STRINGS with
    // per-field timezone conventions (06 §5). Without this, mysql2 converts
    // them to JS Dates (an extract-time transform) and the staged value picks
    // up a spurious UTC marker. All timezone interpretation is load-time.
    dateStrings: true,
    // Dev (Railway synthetic DB) has no TLS; the production run inside the
    // HIPAA boundary must set ?ssl parameters on the URL itself.
  });
}

/** Meta columns present on every field_data_* table — everything else is payload. */
const FIELD_META_COLUMNS = new Set([
  "entity_type",
  "bundle",
  "deleted",
  "entity_id",
  "revision_id",
  "language",
  "delta",
]);

export interface S1FieldInstance {
  fieldName: string; // e.g. "field_sirius_ssn"
  fieldType: string; // Drupal field type, or "unknown" when inferred
  cardinality: number; // 1 = single, -1 = unlimited, n = capped multi
  tableName: string; // field_data_<fieldName>
  /** Payload columns, in ordinal order, e.g. ["field_sirius_ssn_value"]. */
  dataColumns: string[];
  /** dataColumns with the `<fieldName>_` prefix stripped, e.g. ["value"]. */
  shortColumns: string[];
}

/** All field instances for one entity type, keyed by bundle. */
export type FieldCatalog = Map<string, S1FieldInstance[]>;

async function fetchDataColumns(
  pool: Pool,
  tableName: string,
): Promise<string[] | null> {
  const [cols] = await pool.query<RowDataPacket[]>(
    `SELECT column_name AS name
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?
      ORDER BY ordinal_position`,
    [tableName],
  );
  if (cols.length === 0) return null; // table absent from this schema
  return cols.map((c) => String(c.name)).filter((c) => !FIELD_META_COLUMNS.has(c));
}

function makeInstance(
  fieldName: string,
  fieldType: string,
  cardinality: number,
  tableName: string,
  dataColumns: string[],
): S1FieldInstance {
  return {
    fieldName,
    fieldType,
    cardinality,
    tableName,
    dataColumns,
    shortColumns: dataColumns.map((c) =>
      c.startsWith(`${fieldName}_`) ? c.slice(fieldName.length + 1) : c,
    ),
  };
}

/**
 * Build the bundle -> fields catalog for an entity type.
 *
 * Primary path: Drupal's own metadata (field_config_instance + field_config)
 * — authoritative field types and cardinality; this is what production has.
 *
 * Fallback (synthetic dev DBs that seeded field DATA but not field metadata):
 * scan every field_data_* table for bundles actually present. Cardinality is
 * inferred from the max delta observed (0 -> single, >0 -> multi); fieldType
 * is "unknown" — staging is lossless either way, loaders interpret values.
 */
export async function buildFieldCatalog(
  pool: Pool,
  entityType: string,
): Promise<{ catalog: FieldCatalog; source: "field_config" | "table_scan" }> {
  const catalog: FieldCatalog = new Map();

  const [instances] = await pool.query<RowDataPacket[]>(
    `SELECT fci.bundle AS bundle, fci.field_name AS fieldName,
            fc.type AS fieldType, fc.cardinality AS cardinality
       FROM field_config_instance fci
       JOIN field_config fc ON fc.id = fci.field_id
      WHERE fci.entity_type = ? AND fci.deleted = 0 AND fc.deleted = 0
      ORDER BY fci.bundle, fci.field_name`,
    [entityType],
  );

  if (instances.length > 0) {
    const columnsByTable = new Map<string, string[] | null>();
    for (const inst of instances) {
      const fieldName = String(inst.fieldName);
      const tableName = `field_data_${fieldName}`;
      if (!columnsByTable.has(tableName)) {
        columnsByTable.set(tableName, await fetchDataColumns(pool, tableName));
      }
      const dataColumns = columnsByTable.get(tableName);
      if (!dataColumns) continue;
      const bundle = String(inst.bundle);
      const list = catalog.get(bundle) ?? [];
      list.push(
        makeInstance(fieldName, String(inst.fieldType), Number(inst.cardinality), tableName, dataColumns),
      );
      catalog.set(bundle, list);
    }
    return { catalog, source: "field_config" };
  }

  // Fallback: table scan.
  const [tables] = await pool.query<RowDataPacket[]>(
    `SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name LIKE 'field!_data!_%' ESCAPE '!'`,
  );
  for (const t of tables) {
    const tableName = String(t.name);
    const fieldName = tableName.slice("field_data_".length);
    let bundles: RowDataPacket[];
    try {
      [bundles] = await pool.query<RowDataPacket[]>(
        `SELECT bundle, MAX(delta) AS maxDelta FROM \`${tableName}\`
          WHERE entity_type = ? AND deleted = 0 GROUP BY bundle`,
        [entityType],
      );
    } catch {
      continue; // not a standard field table
    }
    if (bundles.length === 0) continue;
    const dataColumns = await fetchDataColumns(pool, tableName);
    if (!dataColumns || dataColumns.length === 0) continue;
    for (const b of bundles) {
      const bundle = String(b.bundle);
      const cardinality = Number(b.maxDelta) > 0 ? -1 : 1;
      const list = catalog.get(bundle) ?? [];
      list.push(makeInstance(fieldName, "unknown", cardinality, tableName, dataColumns));
      catalog.set(bundle, list);
    }
  }
  return { catalog, source: "table_scan" };
}

export interface S1BundleCount {
  bundle: string;
  count: number;
}

export async function listNodeBundles(pool: Pool): Promise<S1BundleCount[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT type AS bundle, COUNT(*) AS count FROM node GROUP BY type ORDER BY count DESC`,
  );
  return rows.map((r) => ({ bundle: String(r.bundle), count: Number(r.count) }));
}
