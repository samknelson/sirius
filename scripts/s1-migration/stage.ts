/**
 * S1 -> s1_staging extractor CLI.
 *
 * Usage:
 *   npx tsx scripts/s1-migration/stage.ts                 # in-scope bundles + taxonomy terms
 *   npx tsx scripts/s1-migration/stage.ts --bundles sirius_worker,sirius_contact
 *   npx tsx scripts/s1-migration/stage.ts --all           # every populated node bundle
 *   npx tsx scripts/s1-migration/stage.ts --skip-terms --batch 1000
 *
 * Output is AGGREGATES ONLY (counts, durations, anomaly tallies) — never row
 * values; the production run happens inside the HIPAA boundary and this
 * report format must stay safe to share.
 *
 * Exit code 1 if any bundle's staged count != S1 node count.
 */
import { createS1Pool, listNodeBundles, buildFieldCatalog } from "./lib/s1";
import { extractBundle, extractTerms, makeProgressLogger, type BundleExtractReport } from "./lib/extract";
import {
  ensureStagingSchema,
  upsertRecords,
  upsertTerms,
  stagedCount,
  stagedTermCount,
  stagingNow,
  deleteStaleRecords,
  deleteStaleTerms,
  recordRun,
  ensureRawLedgerTable,
  upsertRawLedger,
  deleteStaleRawLedger,
  stagedRawLedgerCount,
  type RawLedgerRow,
  ensureRawUserTables,
  upsertRawUsers,
  upsertRawUsersRoles,
  upsertRawRoles,
  upsertRawAuthmap,
  deleteStaleRawUserTable,
  stagedRawUserTableCount,
  type RawUserTable,
  nulSanitizedCount,
} from "./lib/staging";
import { pool as pgPool } from "../../server/storage/db";
import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";

/** In-scope node bundles per docs/s1-migration (02-mapping, 03 §12 load order). */
const IN_SCOPE_BUNDLES = [
  "sirius_contact",
  "sirius_worker",
  "sirius_contact_relationship",
  "grievance_shop",
  "grievance_shop_contact",
  "sirius_trust_provider",
  "sirius_trust_benefit",
  "sirius_trust_worker_election",
  "sirius_trust_worker_benefit",
  // P4 RULED 2026-08-06 (N27): field_sirius_trust_policy targets are
  // sirius_json_definition nodes (242,664 prod refs to 15 distinct nodes);
  // staging this bundle lets load-policies.ts resolve the policy nids.
  "sirius_json_definition",
  "sirius_payperiod",
  "smf_worker_month",
  "sirius_employee",
  "sirius_payment",
  "sirius_ledger_account",
  "sirius_phonenumber",
  "sirius_log",
  "sirius_bulk",
];

/**
 * Ruled-DROP bundles: never staged, never silently ignored. Each run logs the
 * live S1 node count with the documented skip reason so the production run
 * report accounts for every row (docs/s1-migration N-item pattern, cf. N18).
 */
const DOCUMENTED_SKIP_BUNDLES: Record<string, string> = {
  // N3 CLOSED 2026-08-06: epayperiod hours-reporting workflow tracker; S2's
  // wizard_employer_monthly recreates equivalent state per import. Written
  // daily in S1 — post-freeze rows are expected and also dropped.
  // See docs/n3-employer-payperiod-drop.md (tracked ruling record).
  sirius_employer_payperiod: "employer_payperiod_workflow_state",
};

interface CliArgs {
  bundles: string[] | null;
  all: boolean;
  skipTerms: boolean;
  skipRaw: boolean;
  rawOnly: boolean;
  batch: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { bundles: null, all: false, skipTerms: false, skipRaw: false, rawOnly: false, batch: 500 };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--bundles":
        args.bundles = String(argv[++i] ?? "").split(",").filter(Boolean);
        break;
      case "--all":
        args.all = true;
        break;
      case "--skip-terms":
        args.skipTerms = true;
        break;
      case "--skip-raw":
        args.skipRaw = true;
        break;
      case "--raw-only":
        // Stage ONLY the raw (non-node) tables — for resuming a run that
        // completed its bundles (or is being finished selectively via
        // --bundles) without re-extracting any node bundle or terms.
        args.rawOnly = true;
        break;
      case "--batch":
        args.batch = Math.max(1, Number(argv[++i] ?? 500));
        break;
      default:
        throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

/**
 * Raw (non-node) table staging — sirius_ledger_ar (T18). Same lossless +
 * watermark + count-verify contract as bundles; keyset-paginated by the
 * ledger_id PK. Decimal amounts arrive as strings from mysql2 and are staged
 * verbatim (never parsed to float).
 */
async function stageRawLedgerAr(
  s1: Pool,
  batch: number,
): Promise<{ table: string; s1Count: number; extracted: number; staged: number; staleRemoved: number; durationMs: number }> {
  const t0 = Date.now();
  await ensureRawLedgerTable();
  const watermark = await stagingNow();
  const [cntRows] = await s1.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM sirius_ledger_ar`);
  const s1Count = Number(cntRows[0]?.n ?? 0);
  const progress = makeProgressLogger("raw sirius_ledger_ar", s1Count);
  let lastId = 0;
  let extracted = 0;
  try {
  for (;;) {
    const [rows] = await s1.query<RowDataPacket[]>(
      `SELECT ledger_id, ledger_amount, ledger_status, ledger_account, ledger_participant,
              ledger_reference, ledger_ts, ledger_memo, ledger_key, ledger_json
         FROM sirius_ledger_ar WHERE ledger_id > ? ORDER BY ledger_id LIMIT ?`,
      [lastId, batch],
    );
    if (rows.length === 0) break;
    const mapped: RawLedgerRow[] = rows.map((r) => ({
      ledgerId: Number(r.ledger_id),
      amount: r.ledger_amount == null ? null : String(r.ledger_amount),
      status: r.ledger_status == null ? null : String(r.ledger_status),
      account: r.ledger_account == null ? null : Number(r.ledger_account),
      participant: r.ledger_participant == null ? null : Number(r.ledger_participant),
      reference: r.ledger_reference == null ? null : Number(r.ledger_reference),
      ts: r.ledger_ts == null ? null : Number(r.ledger_ts),
      memo: r.ledger_memo == null ? null : String(r.ledger_memo),
      key: r.ledger_key == null ? null : String(r.ledger_key),
      json: r.ledger_json == null ? null : String(r.ledger_json),
    }));
    await upsertRawLedger(mapped);
    extracted += rows.length;
    progress.update(extracted);
    lastId = mapped[mapped.length - 1].ledgerId;
  }
  } finally {
    progress.stop();
  }
  const staleRemoved = await deleteStaleRawLedger(watermark);
  const staged = await stagedRawLedgerCount();
  return { table: "sirius_ledger_ar", s1Count, extracted, staged, staleRemoved, durationMs: Date.now() - t0 };
}

interface RawTableReport {
  table: string;
  s1Count: number;
  extracted: number;
  staged: number;
  staleRemoved: number;
  durationMs: number;
}

/**
 * T27 raw user tables: `users` (uid>1 only — anonymous + superuser excluded;
 * pass/tfa columns never selected),
 * `users_roles`, `role`, `authmap`. Small tables in prod (~2.5k users) but
 * users is keyset-paged anyway for uniformity.
 */
async function stageRawUserTables(s1: Pool, batch: number): Promise<RawTableReport[]> {
  await ensureRawUserTables();
  const reports: RawTableReport[] = [];

  // users — NEVER select pass / tfa columns (dropped by design).
  {
    const t0 = Date.now();
    const watermark = await stagingNow();
    // uid 0 (anonymous) and uid 1 (Drupal superuser) are NEVER staged — the
    // superuser must not be migrated or role-mapped (privilege escalation).
    const [cntRows] = await s1.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM users WHERE uid > 1`);
    const s1Count = Number(cntRows[0]?.n ?? 0);
    let lastId = 1;
    let extracted = 0;
    for (;;) {
      const [rows] = await s1.query<RowDataPacket[]>(
        `SELECT uid, name, mail, created, access, login, status, timezone, data
           FROM users WHERE uid > ? ORDER BY uid LIMIT ?`,
        [lastId, batch],
      );
      if (rows.length === 0) break;
      await upsertRawUsers(
        rows.map((r) => ({
          uid: Number(r.uid),
          name: r.name == null ? null : String(r.name),
          mail: r.mail == null ? null : String(r.mail),
          created: r.created == null ? null : Number(r.created),
          access: r.access == null ? null : Number(r.access),
          login: r.login == null ? null : Number(r.login),
          status: Number(r.status ?? 0),
          timezone: r.timezone == null ? null : String(r.timezone),
          data: r.data == null ? null : String(r.data),
        })),
      );
      extracted += rows.length;
      lastId = Number(rows[rows.length - 1].uid);
    }
    const staleRemoved = await deleteStaleRawUserTable("raw_users", watermark);
    reports.push({
      table: "users",
      s1Count,
      extracted,
      staged: await stagedRawUserTableCount("raw_users"),
      staleRemoved,
      durationMs: Date.now() - t0,
    });
  }

  const simple: Array<{
    table: string;
    raw: RawUserTable;
    countSql: string;
    selectSql: string;
    upsert: (rows: RowDataPacket[]) => Promise<void>;
  }> = [
    {
      table: "users_roles",
      raw: "raw_users_roles",
      countSql: `SELECT COUNT(*) AS n FROM users_roles`,
      selectSql: `SELECT uid, rid FROM users_roles ORDER BY uid, rid`,
      upsert: (rows) => upsertRawUsersRoles(rows.map((r) => ({ uid: Number(r.uid), rid: Number(r.rid) }))),
    },
    {
      table: "role",
      raw: "raw_roles",
      countSql: `SELECT COUNT(*) AS n FROM role`,
      selectSql: `SELECT rid, name, weight FROM role ORDER BY rid`,
      upsert: (rows) =>
        upsertRawRoles(
          rows.map((r) => ({
            rid: Number(r.rid),
            name: r.name == null ? null : String(r.name),
            weight: r.weight == null ? null : Number(r.weight),
          })),
        ),
    },
    {
      table: "authmap",
      raw: "raw_authmap",
      countSql: `SELECT COUNT(*) AS n FROM authmap`,
      selectSql: `SELECT aid, uid, authname, module FROM authmap ORDER BY aid`,
      upsert: (rows) =>
        upsertRawAuthmap(
          rows.map((r) => ({
            aid: Number(r.aid),
            uid: Number(r.uid),
            authname: r.authname == null ? null : String(r.authname),
            module: r.module == null ? null : String(r.module),
          })),
        ),
    },
  ];
  for (const t of simple) {
    const t0 = Date.now();
    const watermark = await stagingNow();
    let s1Count = 0;
    let extracted = 0;
    try {
      const [cntRows] = await s1.query<RowDataPacket[]>(t.countSql);
      s1Count = Number(cntRows[0]?.n ?? 0);
      const [rows] = await s1.query<RowDataPacket[]>(t.selectSql);
      await t.upsert(rows);
      extracted = rows.length;
    } catch (err: unknown) {
      // Synthetic dev MariaDB may lack `role`/`authmap` — stage 0 rows and
      // report the absence; the count check still verifies staged==s1 (0==0).
      if ((err as { code?: string })?.code === "ER_NO_SUCH_TABLE") {
        console.warn(`raw ${t.table}: table absent in S1 (synthetic gap) — staged 0 rows`);
      } else {
        throw err;
      }
    }
    const staleRemoved = await deleteStaleRawUserTable(t.raw, watermark);
    reports.push({
      table: t.table,
      s1Count,
      extracted,
      staged: await stagedRawUserTableCount(t.raw),
      staleRemoved,
      durationMs: Date.now() - t0,
    });
  }
  return reports;
}

async function main() {
  const startedAt = new Date();
  const args = parseArgs(process.argv.slice(2));
  const s1 = createS1Pool();
  await ensureStagingSchema();

  const populated = await listNodeBundles(s1);
  const populatedNames = new Set(populated.map((b) => b.bundle));

  let targets: string[];
  if (args.rawOnly) {
    if (args.bundles) throw new Error("--raw-only cannot be combined with --bundles");
    if (args.skipRaw) throw new Error("--raw-only cannot be combined with --skip-raw");
    targets = [];
    args.skipTerms = true;
    console.log("raw-only run: skipping terms and all node bundles");
  } else if (args.bundles) {
    targets = args.bundles;
    const missing = targets.filter((b) => !populatedNames.has(b));
    if (missing.length > 0) {
      console.warn(`WARNING: requested bundles with zero S1 nodes: ${missing.join(", ")}`);
    }
  } else if (args.all) {
    targets = populated.map((b) => b.bundle);
  } else {
    targets = IN_SCOPE_BUNDLES.filter((b) => populatedNames.has(b));
    const empty = IN_SCOPE_BUNDLES.filter((b) => !populatedNames.has(b));
    if (empty.length > 0) console.log(`in-scope bundles with zero S1 nodes (skipped): ${empty.join(", ")}`);
  }

  // Ruled-DROP bundles are excluded in every mode (including --all/--bundles),
  // with the documented reason + live S1 count logged — never a silent drop.
  const documentedSkips: Array<{ bundle: string; reason: string; s1NodeCount: number }> = [];
  targets = targets.filter((b) => {
    const reason = DOCUMENTED_SKIP_BUNDLES[b];
    if (!reason) return true;
    const s1NodeCount = populated.find((p) => p.bundle === b)?.count ?? 0;
    documentedSkips.push({ bundle: b, reason, s1NodeCount });
    return false;
  });
  for (const [bundle, reason] of Object.entries(DOCUMENTED_SKIP_BUNDLES)) {
    if (documentedSkips.some((s) => s.bundle === bundle)) continue;
    const s1NodeCount = populated.find((p) => p.bundle === bundle)?.count ?? 0;
    documentedSkips.push({ bundle, reason, s1NodeCount });
  }
  for (const s of documentedSkips) {
    console.log(
      `${s.bundle}: DOCUMENTED SKIP reason=${s.reason} s1=${s.s1NodeCount} (ruled DROP — see docs/n3-employer-payperiod-drop.md)`,
    );
  }

  const { catalog: nodeCatalog, source: catalogSource } = await buildFieldCatalog(s1, "node");
  console.log(`field catalog: source=${catalogSource}, bundles with fields=${nodeCatalog.size}`);

  const reports: BundleExtractReport[] = [];
  let mismatches = 0;

  if (!args.skipTerms) {
    const watermark = await stagingNow();
    const { catalog: termCatalog } = await buildFieldCatalog(s1, "taxonomy_term");
    const termReport = await extractTerms(s1, termCatalog, args.batch, upsertTerms);
    const stale = await deleteStaleTerms(watermark);
    const staged = await stagedTermCount();
    const ok = staged === termReport.s1TermCount ? "OK" : "MISMATCH";
    if (ok === "MISMATCH") mismatches++;
    console.log(
      `terms: s1=${termReport.s1TermCount} extracted=${termReport.extracted} staged=${staged}${stale ? ` staleRemoved=${stale}` : ""} ${ok} (${termReport.durationMs}ms)`,
    );
    console.log(`  vocabularies: ${JSON.stringify(termReport.vocabularies)}`);
    logAnomalies(termReport.anomalies);
  }

  for (const bundle of targets) {
    const watermark = await stagingNow();
    const report = await extractBundle(s1, bundle, nodeCatalog.get(bundle) ?? [], args.batch, upsertRecords);
    reports.push(report);
    // Only reconcile after a fully successful extraction — a thrown batch
    // aborts the run before this point, leaving prior staged rows intact.
    const stale = await deleteStaleRecords(bundle, watermark);
    const staged = await stagedCount(bundle);
    const ok = staged === report.s1NodeCount ? "OK" : "MISMATCH";
    if (ok === "MISMATCH") mismatches++;
    console.log(
      `${bundle}: s1=${report.s1NodeCount} extracted=${report.extracted} staged=${staged}${stale ? ` staleRemoved=${stale}` : ""} ${ok} (${report.durationMs}ms)`,
    );
    const fieldSummary = Object.entries(report.fieldRowCounts)
      .filter(([, n]) => n > 0)
      .map(([f, n]) => `${f}=${n}`)
      .join(" ");
    if (fieldSummary) console.log(`  field rows: ${fieldSummary}`);
    logAnomalies(report.anomalies);
  }

  // Raw tables stage on default and --all runs; selective --bundles runs
  // skip them (like bundles they weren't asked for), --skip-raw always skips.
  let rawLedgerReport: Awaited<ReturnType<typeof stageRawLedgerAr>> | null = null;
  if (!args.skipRaw && (args.bundles == null || args.rawOnly)) {
    rawLedgerReport = await stageRawLedgerAr(s1, args.batch);
    const ok = rawLedgerReport.staged === rawLedgerReport.s1Count ? "OK" : "MISMATCH";
    if (ok === "MISMATCH") mismatches++;
    console.log(
      `raw sirius_ledger_ar: s1=${rawLedgerReport.s1Count} extracted=${rawLedgerReport.extracted} staged=${rawLedgerReport.staged}${rawLedgerReport.staleRemoved ? ` staleRemoved=${rawLedgerReport.staleRemoved}` : ""} ${ok} (${rawLedgerReport.durationMs}ms)`,
    );
  } else if (args.bundles != null && !args.skipRaw) {
    console.log("raw sirius_ledger_ar: skipped (selective --bundles run)");
  }

  // T27 raw user tables stage under the same policy as raw AR.
  let rawUserReports: RawTableReport[] | null = null;
  if (!args.skipRaw && (args.bundles == null || args.rawOnly)) {
    rawUserReports = await stageRawUserTables(s1, args.batch);
    for (const r of rawUserReports) {
      const ok = r.staged === r.s1Count ? "OK" : "MISMATCH";
      if (ok === "MISMATCH") mismatches++;
      console.log(
        `raw ${r.table}: s1=${r.s1Count} extracted=${r.extracted} staged=${r.staged}${r.staleRemoved ? ` staleRemoved=${r.staleRemoved}` : ""} ${ok} (${r.durationMs}ms)`,
      );
    }
  } else if (args.bundles != null && !args.skipRaw) {
    console.log("raw user tables: skipped (selective --bundles run)");
  }

  if (nulSanitizedCount() > 0) {
    console.log(
      `nul-sanitized: ${nulSanitizedCount()} string value(s) had \\u0000 stripped (Postgres cannot store NUL in text/jsonb)`,
    );
  }

  await recordRun(startedAt, args as unknown as Record<string, unknown>, {
    reports,
    mismatches,
    documentedSkips,
    nulSanitizedValues: nulSanitizedCount(),
    rawLedgerAr: rawLedgerReport,
    rawUserTables: rawUserReports,
  });

  console.log(
    mismatches === 0
      ? `\nDone: ${reports.length} bundle(s) staged, all counts verified.`
      : `\nDone with ${mismatches} COUNT MISMATCH(ES) — inspect before loading.`,
  );

  await s1.end();
  await pgPool.end();
  process.exit(mismatches === 0 ? 0 : 1);
}

function logAnomalies(a: { nonUndLanguage: number; duplicateDelta: number; extraDeltaOnSingle: number }) {
  if (a.nonUndLanguage || a.duplicateDelta || a.extraDeltaOnSingle) {
    console.log(
      `  anomalies: nonUndLanguage=${a.nonUndLanguage} duplicateDelta=${a.duplicateDelta} extraDeltaOnSingle=${a.extraDeltaOnSingle}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
