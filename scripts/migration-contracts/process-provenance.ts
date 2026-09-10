import { readFileSync } from "node:fs";
import { join } from "node:path";

type MigrationSources = Record<"cleanup" | "repair" | "ledger", string>;

const EXCLUDED_LEDGER_TABLES = ["ledger", "ledger_ea", "ledger_gateway_customers"] as const;

function readMigrationSources(rootDir: string): MigrationSources {
  const dir = join(rootDir, "scripts", "migrate", "core");
  return {
    cleanup: readFileSync(join(dir, "1103_remove_process_entity_metadata.ts"), "utf8"),
    repair: readFileSync(join(dir, "1106_restore_process_local_provenance.ts"), "utf8"),
    ledger: readFileSync(join(dir, "1108_restore_ledger_metadata.ts"), "utf8"),
  };
}

function requireMatch(
  failures: string[],
  source: string,
  pattern: RegExp,
  description: string,
): void {
  if (!pattern.test(source)) failures.push(description);
}

function requireOrderedMatches(
  failures: string[],
  source: string,
  patterns: [RegExp, string][],
  description: string,
): void {
  let cursor = 0;
  for (const [pattern, detail] of patterns) {
    const match = source.slice(cursor).match(pattern);
    if (!match || match.index === undefined) {
      failures.push(`${description}: ${detail}`);
      return;
    }
    cursor += match.index + match[0].length;
  }
}

/**
 * Rehearse the migration histories that can exist in a deployed database.
 *
 * This is intentionally a source-level rehearsal rather than a database test:
 * these migrations run during boot, where a test database would need to model
 * every optional component schema. The assertions pin the data-preservation
 * decisions at the SQL boundary and run in the migration validation gate.
 */
export function rehearseProcessProvenanceMigrations(rootDir = process.cwd()): void {
  const { cleanup, repair, ledger } = readMigrationSources(rootDir);
  const failures: string[] = [];

  // History A: the old cleanup path still has entity_metadata available, so
  // local payment dates must be copied before the rows are deleted.
  requireOrderedMatches(
    failures,
    cleanup,
    [
      [/UPDATE ledger_payments p/, "payment rows are updated from metadata"],
      [/m\.table_name = 'ledger_payments'/, "payment metadata is the source"],
      [/ALTER TABLE ledger_payments RENAME COLUMN created_at TO date_created/, "the local payment name is restored"],
      [/UPDATE ledger_paymentmethods p/, "payment-method rows are updated from metadata"],
      [/m\.table_name = 'ledger_paymentmethods'/, "payment-method metadata is the source"],
      [/DELETE FROM entity_metadata/, "metadata cleanup happens after repair"],
    ],
    "pre-cleanup history",
  );
  requireMatch(
    failures,
    cleanup,
    /m\.created_date IS NOT NULL/,
    "pre-cleanup history: only known dates are copied",
  );
  requireMatch(
    failures,
    cleanup,
    /table_name IN \('ledger', 'ledger_ea', 'ledger_gateway_customers'\)/,
    "excluded ledger history: all three excluded tables are removed from metadata",
  );

  // History B: the old blanket cleanup already removed the metadata rows.
  // Repair can restore nullable columns, but it must not write replacement
  // dates into existing rows.
  requireMatch(
    failures,
    repair,
    /ALTER TABLE ledger_payments ALTER COLUMN date_created DROP NOT NULL/,
    "post-cleanup history: payment provenance remains nullable",
  );
  requireMatch(
    failures,
    repair,
    /ALTER TABLE snapshots ALTER COLUMN created_at DROP NOT NULL/,
    "post-cleanup history: process provenance remains nullable",
  );
  if (/\bUPDATE\s+(?:ledger_payments|ledger_paymentmethods|snapshots)\b/i.test(repair)) {
    failures.push("post-cleanup history: repair must not invent dates with UPDATE");
  }

  // History C: payment-batch is optional. Every reference to its data insert
  // must remain behind the table probe so a disabled component can finish boot.
  const paymentBatchGuard = ledger.match(
    /IF to_regclass\('public\.ledger_payment_batches'\) IS NOT NULL THEN([\s\S]*?)END IF;/,
  );
  if (!paymentBatchGuard) {
    failures.push("optional payment-batch history: insert must be table-guarded");
  } else if (!paymentBatchGuard[1].includes("INSERT INTO entity_metadata")) {
    failures.push("optional payment-batch history: guarded branch must seed metadata");
  }
  for (const table of ["ledger_accounts", "ledger_payment_batches"]) {
    requireMatch(
      failures,
      ledger,
      new RegExp(`SELECT '${table}', id, NULL, NULL`),
      `maintained ledger history: ${table} receives a baseline row`,
    );
  }

  // The accounting-entry and provider-mapping tables are explicitly excluded.
  // Check the actual context literals used by INSERTs, not prose/comments.
  const insertedContexts = Array.from(
    ledger.matchAll(/SELECT '([^']+)', id, NULL, NULL/g),
    (match) => match[1],
  );
  for (const table of EXCLUDED_LEDGER_TABLES) {
    if (insertedContexts.includes(table)) {
      failures.push(`excluded ledger history: ${table} must not receive metadata`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      [
        "Process-provenance migration rehearsal failed:",
        ...failures.map((failure) => `  - ${failure}`),
      ].join("\n"),
    );
  }
}