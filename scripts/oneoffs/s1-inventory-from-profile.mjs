#!/usr/bin/env node
/**
 * Regenerates docs/s1-migration/01-field-inventory.md from the production
 * MariaDB structure profile (docs/s1-migration/profile/*.tsv + s1-schema.sql).
 *
 * Inputs (all structure/aggregates only — zero production rows):
 *   profile/columns.tsv         table, ordinal, column, data_type, column_type, nullable, default, key, charset
 *   profile/tables.tsv          table, engine, approx_rows, data_mb, index_mb, collation
 *   profile/fielddata_stats.tsv field table, entity_type, bundle, language, max_delta, row_count (deleted=0)
 *
 * Usage: node scripts/oneoffs/s1-inventory-from-profile.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = join(root, "docs", "s1-migration");
const tsv = (name) =>
  readFileSync(join(dir, "profile", name), "utf8")
    .split("\n")
    .filter((l) => l.length)
    .map((l) => l.split("\t"));

const columns = tsv("columns.tsv"); // [table, ord, col, data_type, column_type, nullable, default, key, charset]
const tables = tsv("tables.tsv"); // [table, engine, rows, dataMB, idxMB, collation]
const stats = tsv("fielddata_stats.tsv"); // [table, entity_type, bundle, lang, max_delta, rows]

// ---- indexes -------------------------------------------------------------
const colsByTable = new Map();
for (const c of columns) {
  if (!colsByTable.has(c[0])) colsByTable.set(c[0], []);
  colsByTable.get(c[0]).push(c);
}
const tableInfo = new Map(tables.map((t) => [t[0], t]));
const statsByTable = new Map();
for (const s of stats) {
  if (!statsByTable.has(s[0])) statsByTable.set(s[0], []);
  statsByTable.get(s[0]).push(s);
}

const D7_FIELD_COLS = new Set([
  "entity_type",
  "bundle",
  "deleted",
  "entity_id",
  "revision_id",
  "language",
  "delta",
]);

const allTables = [...colsByTable.keys()].sort();
const fieldDataTables = allTables.filter((t) => t.startsWith("field_data_"));
const fieldRevTables = new Set(allTables.filter((t) => t.startsWith("field_revision_")));

const fmtRows = (n) => Number(n).toLocaleString("en-US");
const esc = (s) => s.replaceAll("|", "\\|");

// ---- header --------------------------------------------------------------
let out = `# S1 Field Inventory (production MariaDB structure)

> **Source.** Generated from the production structure profile extracted from a temporary restore of \`smf-db-prod\` (MariaDB 10.6.25): \`profile/columns.tsv\` (real \`column_type\` per column), \`profile/tables.tsv\` (engine + approximate row counts), \`profile/fielddata_stats.tsv\` (per field table × entity_type × bundle: row count and max delta, filtered to \`deleted=0\`). **No production rows were used** — this inventory is structure and aggregates only. See [06-strategy-revision.md](06-strategy-revision.md).
>
> This file **replaces** the earlier inventory profiled from the ~10-row Neon Postgres sample. All previously "inferred" types are gone; every type below is the real MariaDB column definition. Fill rates and sample values are intentionally absent — value-level profiling must run inside the HIPAA boundary and emit aggregates only.
>
> Regenerate with: \`node scripts/oneoffs/s1-inventory-from-profile.mjs\`

Production schema: **${allTables.length} tables** (${fieldDataTables.length} \`field_data_*\` + ${fieldRevTables.size} \`field_revision_*\` twins + ${allTables.length - fieldDataTables.length - fieldRevTables.size} core/app tables).

Reading the tables below:
- **Value column types** are MariaDB \`column_type\` verbatim. \`NULL\` marks nullable columns.
- **rows** under usage = live rows (\`deleted=0\`) for that entity_type/bundle from production.
- **multi** = \`max_delta > 0\` in production → the field is multi-valued for that bundle and MUST be aggregated, not flat-joined.
- The only \`language\` value present anywhere is \`und\` (translation never enabled).
- Field-name prefixes (\`field_grievance_*\`, \`field_sirius_*\`) are Drupal **module namespaces, not domain markers** — check the bundle column, not the name.

`;

// ---- field_data section ----------------------------------------------------
out += `## \`field_data_*\` tables (${fieldDataTables.length})\n\n`;
out += `| # | Field table | ~Total rows | Rev twin | Value column(s): real MariaDB type | Used by (entity/bundle → live rows, multi) |\n`;
out += `|---|-------------|------------|----------|-------------------------------------|---------------------------------------------|\n`;

let zeroRowTables = [];
let i = 0;
for (const t of fieldDataTables) {
  const short = t.replace("field_data_", "");
  const info = tableInfo.get(t);
  const valueCols = colsByTable
    .get(t)
    .filter((c) => !D7_FIELD_COLS.has(c[2]))
    .map((c) => {
      const nullable = c[5] === "YES" ? " NULL" : "";
      return `\`${c[2].replace(short + "_", "…")}\` ${c[4]}${nullable}`;
    })
    .join("<br>");
  const st = statsByTable.get(t) ?? [];
  if (st.length === 0) {
    zeroRowTables.push({ table: t, cols: valueCols, rows: info ? info[2] : "?" });
    continue;
  }
  i++;
  const usage = st
    .sort((a, b) => Number(b[5]) - Number(a[5]))
    .map((s) => {
      const multi = Number(s[4]) > 0 ? ` **multi (max delta ${s[4]})**` : "";
      const et = s[1] === "node" ? "" : `${s[1]}/`;
      return `${et}\`${s[2]}\` → ${fmtRows(s[5])}${multi}`;
    })
    .join("<br>");
  const rev = fieldRevTables.has(t.replace("field_data_", "field_revision_")) ? "yes" : "—";
  out += `| ${i} | \`${t}\` | ${info ? fmtRows(info[2]) : "?"} | ${rev} | ${esc(valueCols)} | ${usage} |\n`;
}

out += `\n### \`field_data_*\` tables with zero live rows (${zeroRowTables.length})\n\n`;
out += `Configured field storage with no \`deleted=0\` rows for any entity type. **Not ETL targets.** Listed for completeness:\n\n`;
out += `| Field table | ~Total rows (incl. deleted) | Value column(s) |\n|---|---|---|\n`;
for (const z of zeroRowTables) {
  out += `| \`${z.table}\` | ${fmtRows(z.rows)} | ${esc(z.cols)} |\n`;
}

// ---- application tables ----------------------------------------------------
const appTables = allTables.filter(
  (t) => (t.startsWith("sirius_") || t.startsWith("smf_")) && !t.startsWith("field_"),
);
out += `\n## Application tables (non-field \`sirius_*\`)\n\n`;
for (const t of appTables) {
  const info = tableInfo.get(t);
  out += `### \`${t}\` — ~${info ? fmtRows(info[2]) : "?"} rows (${info ? info[3] : "?"} MB data)\n\n`;
  out += `| Column | Type | Null | Default | Key |\n|---|---|---|---|---|\n`;
  for (const c of colsByTable.get(t)) {
    out += `| \`${c[2]}\` | ${c[4]} | ${c[5]} | ${esc(c[6] ?? "")} | ${c[7] ?? ""} |\n`;
  }
  out += `\n`;
}

// ---- core tables of migration interest -------------------------------------
const CORE = [
  "node",
  "node_revision",
  "users",
  "users_roles",
  "role",
  "authmap",
  "taxonomy_vocabulary",
  "taxonomy_term_data",
  "taxonomy_term_hierarchy",
  "file_managed",
  "file_usage",
  "s3fs_file",
  "field_config",
  "field_config_instance",
  "comment",
  "flag",
  "flagging",
  "variable",
];
out += `## D7 core tables of migration interest\n\n`;
for (const t of CORE) {
  if (!colsByTable.has(t)) {
    out += `### \`${t}\` — **not present in production schema**\n\n`;
    continue;
  }
  const info = tableInfo.get(t);
  out += `### \`${t}\` — ~${info ? fmtRows(info[2]) : "?"} rows\n\n`;
  out += `| Column | Type | Null | Default | Key |\n|---|---|---|---|---|\n`;
  for (const c of colsByTable.get(t)) {
    out += `| \`${c[2]}\` | ${c[4]} | ${c[5]} | ${esc(c[6] ?? "")} | ${c[7] ?? ""} |\n`;
  }
  out += `\n`;
}

// ---- full census -----------------------------------------------------------
out += `## Full table census (${tables.length} tables, by approximate row count)\n\n`;
out += `Approximate row counts from \`information_schema\` (InnoDB estimates). \`field_revision_*\` twins are census-listed but not detailed above.\n\n`;
out += `| Table | Engine | ~Rows | Data MB | Index MB |\n|---|---|---|---|---|\n`;
for (const t of [...tables].sort((a, b) => Number(b[2]) - Number(a[2]))) {
  out += `| \`${t[0]}\` | ${t[1]} | ${fmtRows(t[2])} | ${t[3]} | ${t[4]} |\n`;
}

writeFileSync(join(dir, "01-field-inventory.md"), out);
console.log(
  `Wrote 01-field-inventory.md: ${fieldDataTables.length} field tables (${zeroRowTables.length} zero-row), ${appTables.length} app tables, ${tables.length} census rows`,
);
