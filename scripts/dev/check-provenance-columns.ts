#!/usr/bin/env tsx
/**
 * Check Bespoke Provenance Columns
 *
 * "When was this record made, and by whom?" has one answer in this codebase:
 * `entity_metadata`, written by the storage logging middleware, read by the
 * record-history badge and the admin metadata viewer. It covers every logged
 * table at once, names a person as well as a date, and keeps a modified stamp
 * the table's own columns never did.
 *
 * Roughly two dozen tables predate it and carry their own `created_at`,
 * `updated_at`, `created_by` or `date_created` column — a second, partial
 * answer to the same question, usually date-only, never with a person, and
 * never kept in step with the framework the rest of the app reads. Retiring
 * them is a task per area; `docs/provenance-columns.md` is the inventory and
 * the decision rule those tasks follow.
 *
 * This rule stops the pile growing while that work lands. A new
 * creation/modification date or person column in the shared schema is a
 * violation unless it is on the allowlist below — which starts as the
 * inventory's KEEP list (operational timestamps that are business data, not
 * provenance) plus every column not yet retired. Each area task deletes its
 * own entries as it lands, so the list drains to just the keepers.
 *
 * WHAT IT SEES. Column declarations in `shared/` schema files: the database
 * column name inside a Drizzle column builder, attributed to the `pgTable`
 * whose block it sits in. It is textual — it reads the schema as written, not
 * as pushed — which is the point: the schema file is where a new column gets
 * added, and where the reviewer is looking.
 *
 * ADDING A COLUMN AND MEANING IT. If the column really is operational data —
 * a rate-limit window, a cache's freshness, when a message was sent, when an
 * event fired, a history row's effective date — add it to ALLOWLIST with the
 * reason, and add it to the KEEP table in `docs/provenance-columns.md` so the
 * two say the same thing. If it is provenance, do not add it: the framework
 * already answers it, for free, for every table.
 *
 * Usage: npx tsx scripts/dev/check-provenance-columns.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const INVENTORY_DOC = "docs/provenance-columns.md";

/**
 * Column names that claim to say when a record was made or last changed.
 * Matched on the DATABASE column name, exactly — a `start_at` or an
 * `expires_at` is a business date and says so.
 */
const DATE_COLUMNS = new Set([
  "created_at",
  "created_on",
  "created_date",
  "date_created",
  "updated_at",
  "updated_on",
  "updated_date",
  "date_updated",
  "modified_at",
  "modified_on",
  "modified_date",
  "date_modified",
  "changed",
  "changed_at",
  "date_changed",
  "last_modified",
  "last_modified_at",
  "last_updated",
  "last_updated_at",
  "assigned_at",
]);

/** Column names that claim to say WHO made or last changed a record. */
const PERSON_COLUMNS = new Set([
  "created_by",
  "created_by_id",
  "created_user_id",
  "updated_by",
  "updated_by_id",
  "modified_by",
  "modified_by_id",
  "changed_by",
  "author_id",
  "author_name",
  "assigned_by",
]);

/**
 * The framework's own table. Its `created_*` / `modified_*` columns are not a
 * bespoke answer to the question — they ARE the answer.
 */
const FRAMEWORK_TABLES = new Set(["entity_metadata"]);

/**
 * Every bespoke provenance column the schema still carries, and why it is
 * allowed to. Keyed `table.column`.
 *
 * Two kinds of entry, and the reason says which:
 *
 *  - KEEP — operational data that happens to be a timestamp. It stays for
 *    good, and stays here for good.
 *  - RETIRE (owning task named) — provenance that has not moved yet. The task
 *    that retires it deletes its entries from this list in the same change
 *    that drops the columns.
 *
 * Every entry mirrors a row in `docs/provenance-columns.md`; the doc carries
 * the longer rationale.
 */
const ALLOWLIST: Record<string, string> = {
  // ── KEEP: operational timestamps ─────────────────────────────────────────
  // Rate-limit window. `created_at` is when the bucket entry was recorded and
  // is compared against `expires_at` to decide whether a caller is over quota.
  "flood.created_at": "KEEP — rate-limit window, not provenance",
  // Cache freshness. The row IS an observation with a time on it; the age of
  // the row is what decides whether the cached answer may still be served.
  "wc_cache.created_at": "KEEP — cache freshness, not provenance",
  "sitespecific_btu_political_district_cache.created_at":
    "KEEP — cache freshness, not provenance",
  // Message send time. An in-app message's `created_at` is when it was sent —
  // it is displayed to the recipient and orders their inbox.
  "comm_inapp.created_at": "KEEP — message send time, not provenance",
  // Event emission. `events` / `event_occurrences` record that something
  // happened; the timestamp is the happening, not a record's history.
  "events.created_at": "KEEP — event emission time, not provenance",
  "event_occurrences.created_at": "KEEP — event emission time, not provenance",
  // Event-bus scheduling state. The status row's `created_at` is when the
  // deferred event was claimed, which the pump and the retention purge read.
  "ebs_status.created_at": "KEEP — event-bus scheduling state, not provenance",
  // Change watermark. `edls_sheets.changed` drives changed-since export
  // filtering, passport export ordering and a notifier — it is read by
  // behaviour, so it is business data. See the inventory's KEEP table.
  "edls_sheets.changed": "KEEP — change watermark read by exports and a notifier",
  // Membership join tables with no id of their own. Provenance is keyed by a
  // record id and these rows do not have one, so the framework cannot answer
  // for them at all.
  "user_roles.assigned_at": "KEEP — join table with no record id to key provenance by",
  "role_permissions.assigned_at":
    "KEEP — join table with no record id to key provenance by",
  // Tie-break ordering key. `worker_wsh` has no unique (worker_id, date), so a
  // worker can hold two work-status entries for one effective date, and the
  // one entered LAST is the current status — an answer the work-status denorm
  // and dispatch eligibility read. Its twin on `worker_msh` was retired: that
  // table's unique (worker_id, industry_id, date) made the same tie-break
  // unreachable. See the inventory's KEEP table.
  "worker_wsh.created_at": "KEEP — tie-break ordering key for same-date work statuses",
  "ledger_payments.created_at": "KEEP — payment creation time displayed and ordered by ledger lists",
  "ledger_paymentmethods.created_at":
    "KEEP — payment-method creation time displayed and ordered by payment-method lists",

  // ── RETIRE: not moved yet, one task per area ─────────────────────────────
  "wizard_report_data.created_at":
    "KEEP — bulk report output: the retention purge reads a row's age to decide " +
    "whether the run's output has expired, and it is the order the rows are read back in",
  "sitespecific_btu_csg.created_at": "RETIRE — Retire BTU Table Timestamps",
  "sitespecific_btu_csg.updated_at": "RETIRE — Retire BTU Table Timestamps",
  "sitespecific_btu_political_officials.created_at": "RETIRE — Retire BTU Table Timestamps",
  "sitespecific_btu_political_officials.updated_at": "RETIRE — Retire BTU Table Timestamps",
  "sitespecific_btu_political_worker_reps.created_at": "RETIRE — Retire BTU Table Timestamps",
};

export interface ProvenanceColumn {
  file: string;
  line: number;
  table: string;
  column: string;
  kind: "date" | "person";
}

/** Blank out comments, preserving length so line numbers still line up. */
function blankComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`\\])\/\/[^\n]*/g, (match, prefix) => {
    const keep = typeof prefix === "string" ? prefix : "";
    return keep + " ".repeat(match.length - keep.length);
  });
}

/** `pgTable("name"` — the table every column below it belongs to. */
const TABLE_OPENER = /\bpgTable\(\s*["']([a-z][a-z0-9_]*)["']/g;

/** `something: varchar("db_column"` — one column declaration. */
const COLUMN_DECL =
  /\b[A-Za-z_$][\w$]*\s*:\s*[A-Za-z_$][\w$]*\s*\(\s*["']([a-z][a-z0-9_]*)["']/g;

/**
 * Every provenance-shaped column one schema file declares.
 *
 * A column belongs to the nearest `pgTable(` opener above it. That is the
 * whole parse: schema files in this repo declare one table per `pgTable(`
 * call and never nest them, so the nearest opener is the owner.
 */
export function scanSchemaSource(file: string, source: string): ProvenanceColumn[] {
  const text = blankComments(source);
  const openers: { offset: number; table: string }[] = [];
  TABLE_OPENER.lastIndex = 0;
  let opener: RegExpExecArray | null;
  while ((opener = TABLE_OPENER.exec(text)) !== null) {
    openers.push({ offset: opener.index, table: opener[1] });
  }
  if (openers.length === 0) return [];

  const found: ProvenanceColumn[] = [];
  COLUMN_DECL.lastIndex = 0;
  let decl: RegExpExecArray | null;
  while ((decl = COLUMN_DECL.exec(text)) !== null) {
    const column = decl[1];
    const kind = DATE_COLUMNS.has(column)
      ? ("date" as const)
      : PERSON_COLUMNS.has(column)
        ? ("person" as const)
        : null;
    if (kind === null) continue;

    let table: string | null = null;
    for (const candidate of openers) {
      if (candidate.offset > decl.index) break;
      table = candidate.table;
    }
    if (table === null || FRAMEWORK_TABLES.has(table)) continue;

    found.push({
      file,
      line: text.slice(0, decl.index).split("\n").length,
      table,
      column,
      kind,
    });
  }
  return found;
}

/**
 * Schema files in the working tree — tracked AND untracked, so a brand-new
 * schema file cannot dodge the rule by not being committed yet.
 */
export function schemaFiles(): string[] {
  const listed = [
    execFileSync("git", ["ls-files", "shared"], { encoding: "utf-8" }),
    execFileSync("git", ["ls-files", "--others", "--exclude-standard", "shared"], {
      encoding: "utf-8",
    }),
  ]
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".ts"));
  return Array.from(new Set(listed)).sort();
}

function main(): void {
  console.log("Checking for bespoke provenance columns...\n");

  const files = schemaFiles();
  if (files.length === 0) {
    // Never fail open: no files means the listing broke, not that the schema
    // is clean.
    console.error("✗ Found no files under shared/ to scan — refusing to pass.");
    process.exit(1);
  }

  const declared: ProvenanceColumn[] = [];
  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, "utf-8");
    } catch (error) {
      console.error(`✗ Could not read ${file}: ${(error as Error).message}`);
      process.exit(1);
    }
    if (!source.includes("pgTable")) continue;
    declared.push(...scanSchemaSource(file, source));
  }

  const violations = declared.filter(
    (found) => ALLOWLIST[`${found.table}.${found.column}`] === undefined,
  );

  // An allowlist entry for a column that is no longer declared is stale — the
  // area task dropped the column but left the entry, and the next one to read
  // the list would think there is work left to do.
  const seen = new Set(declared.map((found) => `${found.table}.${found.column}`));
  const stale = Object.keys(ALLOWLIST).filter((key) => !seen.has(key));

  if (violations.length === 0 && stale.length === 0) {
    console.log(
      `✓ No bespoke provenance columns outside the allowlist ` +
        `(${declared.length} allowlisted column(s) across ${files.length} schema file(s)).`,
    );
    process.exit(0);
  }

  if (violations.length > 0) {
    console.log(`✗ Found ${violations.length} bespoke provenance column(s):\n`);
    for (const violation of violations) {
      console.log(`  ${violation.file}:${violation.line}`);
      console.log(`    ${violation.table}.${violation.column} (${violation.kind} column)`);
      console.log("");
    }
    console.log(
      "ARCHITECTURE RULE: a record's creation and modification history lives in",
    );
    console.log(
      "`entity_metadata`, maintained by the storage logging middleware — not in a",
    );
    console.log("column on the table.");
    console.log("");
    console.log("To fix:");
    console.log(
      "1. Drop the column and let the framework answer instead. A screen that only",
    );
    console.log(
      "   DISPLAYS the date reads the record history the badge already reads; a list",
    );
    console.log("   that sorts or filters on it reads provenance.");
    console.log(
      "2. If the column actually drives behaviour (a change watermark, an export",
    );
    console.log(
      "   ordering key, a cache's freshness, a rate-limit window), it is business",
    );
    console.log(
      `   data: add it to ALLOWLIST in this script and to the KEEP table in`,
    );
    console.log(`   ${INVENTORY_DOC}, with the reason.`);
    console.log("");
    console.log(`See ${INVENTORY_DOC} for the full inventory and the decision rule.`);
    console.log("");
  }

  if (stale.length > 0) {
    console.log(`✗ ${stale.length} allowlist entr(y/ies) name a column that is gone:\n`);
    for (const key of stale) {
      console.log(`  ${key} — ${ALLOWLIST[key]}`);
    }
    console.log("");
    console.log(
      `Remove them from ALLOWLIST in this script and from ${INVENTORY_DOC}: the`,
    );
    console.log("column has been retired, and the list should show what is left.");
    console.log("");
  }

  process.exit(1);
}

if (/check-provenance-columns\.ts$/.test(process.argv[1] ?? "")) {
  main();
}
