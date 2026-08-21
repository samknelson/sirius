/**
 * S1 -> s1_staging extractor CLI.
 *
 * Usage:
 *   npx tsx scripts/s1-migration/stage.ts --mode daily
 *   npx tsx scripts/s1-migration/stage.ts --mode final-freeze
 *   npx tsx scripts/s1-migration/stage.ts --mode daily --bundles sirius_worker,sirius_contact
 *   npx tsx scripts/s1-migration/stage.ts --mode daily --skip-terms --batch 1000
 *
 * Output is AGGREGATES ONLY (counts, durations, anomaly tallies) — never row
 * values; the production run happens inside the HIPAA boundary and this
 * report format must stay safe to share.
 *
 * Daily node cleanup requires matching extraction/verification NID
 * fingerprints and a matching post-scan source count; moving sets retry
 * three times, then fail closed. Daily terms/raw scans remain strict.
 * Final-freeze exits 1 unless all source/scanned/staged counts are exact.
 */
import { createS1Pool, listNodeBundles, buildFieldCatalog, type S1FieldInstance } from "./lib/s1";
import {
  extractBundle,
  extractBundleIncremental,
  extractBundleIncrementalSharded,
  verifyBundleIdentityWorkset,
  extractTerms,
  makeProgressLogger,
  type BundleExtractReport,
  type IncrementalBundleHooks,
} from "./lib/extract";
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
  upsertRawUserContacts,
  deleteStaleRawUserTable,
  stagedRawUserTableCount,
  type RawUserTable,
  nulSanitizedCount,
  stagedRecordMetadata,
  markStagedRecordsSeen,
} from "./lib/staging";
import { assessCountEvidence, type CountEvidence, type StageMode } from "./lib/stage-evidence";
import { shouldRefreshNodePayload } from "./lib/incremental-node";
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

/** The three bundles that dominated the first real-S1 stage (~96.8%). They
 * shard within the bundle, but remain serial relative to one another so daily
 * staging never launches all three source-intensive scans at once. */
const DAILY_SHARDED_BUNDLES = new Set(["sirius_payperiod", "smf_worker_month", "sirius_log"]);

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
  mode: StageMode;
  bundles: string[] | null;
  all: boolean;
  skipTerms: boolean;
  skipRaw: boolean;
  rawOnly: boolean;
  batch: number;
  heavyShards: number;
  bundleConcurrency: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    mode: "final-freeze",
    bundles: null,
    all: false,
    skipTerms: false,
    skipRaw: false,
    rawOnly: false,
    batch: 500,
    heavyShards: 2,
    bundleConcurrency: 2,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--mode": {
        const mode = String(argv[++i] ?? "");
        if (mode !== "daily" && mode !== "final-freeze") {
          throw new Error(`--mode must be daily or final-freeze (got "${mode}")`);
        }
        args.mode = mode;
        break;
      }
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
      case "--heavy-shards":
        args.heavyShards = Math.max(1, Math.min(4, Number(argv[++i] ?? 2)));
        break;
      case "--bundle-concurrency":
        args.bundleConcurrency = Math.max(1, Math.min(2, Number(argv[++i] ?? 2)));
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
): Promise<{ table: string; s1Count: number; sourceCountAfter: number; extracted: number; staged: number; staleRemoved: number; durationMs: number }> {
  const t0 = Date.now();
  await ensureRawLedgerTable();
  const watermark = await stagingNow();
  const [cntRows] = await s1.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM sirius_ledger_ar`);
  const s1Count = Number(cntRows[0]?.n ?? 0);
  const progress = makeProgressLogger("raw sirius_ledger_ar", s1Count, { verb: "staged" });
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
  const [afterRows] = await s1.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM sirius_ledger_ar`);
  return {
    table: "sirius_ledger_ar",
    s1Count,
    sourceCountAfter: Number(afterRows[0]?.n ?? 0),
    extracted,
    staged,
    staleRemoved,
    durationMs: Date.now() - t0,
  };
}

interface RawTableReport {
  table: string;
  s1Count: number;
  sourceCountAfter: number;
  extracted: number;
  staged: number;
  staleRemoved: number;
  durationMs: number;
}

/**
 * T27 raw user tables: `users` (uid>1 only — anonymous + superuser excluded;
 * pass/tfa columns never selected),
 * `users_roles`, `role`, `authmap`, plus the user↔contact association
 * (`field_data_field_sirius_contact` rows with entity_type='user'). Small
 * tables in prod (~2.5k users) but users is keyset-paged anyway for
 * uniformity.
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
      sourceCountAfter: Number((await s1.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM users WHERE uid > 1`))[0][0]?.n ?? 0),
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
    {
      // user↔contact association — the ownership signal for shared email
      // addresses (contacts + users loaders both resolve through it).
      table: "field_data_field_sirius_contact (entity_type='user')",
      raw: "raw_user_contact",
      countSql: `SELECT COUNT(*) AS n FROM field_data_field_sirius_contact
                  WHERE entity_type = 'user' AND deleted = 0`,
      selectSql: `SELECT entity_id AS uid, delta, field_sirius_contact_target_id AS contact_nid
                    FROM field_data_field_sirius_contact
                   WHERE entity_type = 'user' AND deleted = 0
                   ORDER BY entity_id, delta`,
      upsert: (rows) =>
        upsertRawUserContacts(
          rows.map((r) => ({
            uid: Number(r.uid),
            delta: Number(r.delta),
            contactNid: Number(r.contact_nid),
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
      sourceCountAfter: Number((await s1.query<RowDataPacket[]>(t.countSql))[0][0]?.n ?? 0),
      extracted,
      staged: await stagedRawUserTableCount(t.raw),
      staleRemoved,
      durationMs: Date.now() - t0,
    });
  }
  return reports;
}

interface NamedCountEvidence extends CountEvidence {
  source: string;
  extractionStartedAt: string;
  extractionFinishedAt: string;
  payloadExtracted: number;
  staleRemoved: number;
  identityVerified?: boolean;
  identityVerificationAttempts?: number;
}

async function stageNodeBundle(params: {
  s1: Pool;
  bundle: string;
  fields: S1FieldInstance[];
  batch: number;
  mode: StageMode;
  heavyShards: number;
}): Promise<{ report: BundleExtractReport; evidence: NamedCountEvidence }> {
  const { s1, bundle, fields, batch, mode, heavyShards } = params;
  const extractionStartedAt = new Date();
  let watermark = await stagingNow();
  let report: BundleExtractReport;
  let identityVerified = mode !== "daily";
  let identityVerificationAttempts = 0;
  let initialSourceCountBefore: number | null = null;
  let totalPayloadExtracted = 0;
  let totalIdentityReadMs = 0;
  let totalFieldReadMs = 0;
  let totalStagingCallbackMs = 0;

  if (mode === "daily") {
    const maxIdentityAttempts = 3;
    let finalReport: BundleExtractReport | null = null;
    for (let attempt = 1; attempt <= maxIdentityAttempts; attempt++) {
      identityVerificationAttempts = attempt;
      watermark = await stagingNow();
      const incrementalHooks: IncrementalBundleHooks = {
        selectPayloadIds: async (nodes) => {
          const prior = await stagedRecordMetadata(bundle, nodes.map((node) => node.nid));
          const selected = new Set<number>();
          for (const node of nodes) {
            const staged = prior.get(node.nid);
            if (shouldRefreshNodePayload(node, staged)) selected.add(node.nid);
          }
          await markStagedRecordsSeen(bundle, nodes.map((node) => node.nid), watermark);
          return selected;
        },
        onPayload: upsertRecords,
      };
      const attemptReport =
        DAILY_SHARDED_BUNDLES.has(bundle) && heavyShards > 1
          ? await extractBundleIncrementalSharded(s1, bundle, fields, batch, incrementalHooks, heavyShards)
          : await extractBundleIncremental(s1, bundle, fields, batch, incrementalHooks);
      initialSourceCountBefore ??= attemptReport.s1NodeCount;
      totalPayloadExtracted += attemptReport.payloadExtracted;
      totalIdentityReadMs += attemptReport.timings.identityReadMs;
      totalFieldReadMs += attemptReport.timings.fieldReadMs;
      totalStagingCallbackMs += attemptReport.timings.stagingCallbackMs;
      const verification = await verifyBundleIdentityWorkset(s1, bundle, batch, attemptReport.shards);
      identityVerified =
        verification.identitiesScanned === attemptReport.identitiesScanned &&
        verification.identityHash === attemptReport.identityHash &&
        verification.sourceCountAfter === verification.identitiesScanned;
      if (identityVerified) {
        attemptReport.s1NodeCount = initialSourceCountBefore;
        attemptReport.sourceCountAfter = verification.sourceCountAfter;
        attemptReport.payloadExtracted = totalPayloadExtracted;
        attemptReport.timings = {
          identityReadMs: totalIdentityReadMs,
          fieldReadMs: totalFieldReadMs,
          stagingCallbackMs: totalStagingCallbackMs,
        };
        attemptReport.durationMs = Date.now() - extractionStartedAt.getTime();
        finalReport = attemptReport;
        break;
      }
      console.warn(
        `${bundle}: identity workset moved during attempt ${attempt}/${maxIdentityAttempts} ` +
          `(extracted=${attemptReport.identitiesScanned}, verified=${verification.identitiesScanned}); retrying before cleanup`,
      );
    }
    if (!finalReport || !identityVerified) {
      throw new Error(`${bundle}: source identity workset did not stabilize after ${maxIdentityAttempts} attempts; no stale cleanup performed`);
    }
    report = finalReport;
  } else {
    report = await extractBundle(s1, bundle, fields, batch, upsertRecords);
  }

  // Cleanup is intentionally after the whole bundle (including every shard)
  // settles. A rejected extraction never reaches this destructive step.
  const stale = await deleteStaleRecords(bundle, watermark);
  const staged = await stagedCount(bundle);
  const finishedAt = new Date();
  const evidence: NamedCountEvidence = {
    source: bundle,
    extractionStartedAt: extractionStartedAt.toISOString(),
    extractionFinishedAt: finishedAt.toISOString(),
    payloadExtracted: report.payloadExtracted,
    staleRemoved: stale,
    identityVerified,
    identityVerificationAttempts,
    ...assessCountEvidence(mode, {
      sourceCountBefore: report.s1NodeCount,
      sourceCountAfter: report.sourceCountAfter,
      identitiesScanned: report.identitiesScanned,
      stagedCount: staged,
    }),
  };
  const ok = evidence.status === "pass" ? (evidence.acceptedLiveDrift ? "LIVE-DRIFT-ACCEPTED" : "OK") : "MISMATCH";
  console.log(
    `${bundle}: sourceBefore=${report.s1NodeCount} sourceAfter=${report.sourceCountAfter} scanned=${report.identitiesScanned} payloads=${report.payloadExtracted} staged=${staged}${stale ? ` staleRemoved=${stale}` : ""} ${ok} (${report.durationMs}ms)`,
  );
  console.log(
    `  timings: identityRead=${report.timings.identityReadMs}ms fieldRead=${report.timings.fieldReadMs}ms stagingCallbacks=${report.timings.stagingCallbackMs}ms`,
  );
  if (report.shards?.length) {
    console.log(
      `  shards: ${report.shards.map((shard) => `${shard.index}[${shard.afterNid + 1}-${shard.throughNid}]=${shard.identitiesScanned}/${shard.payloadExtracted} (${shard.durationMs}ms)`).join(" ")}`,
    );
  }
  const fieldSummary = Object.entries(report.fieldRowCounts)
    .filter(([, rows]) => rows > 0)
    .map(([field, rows]) => `${field}=${rows}`)
    .join(" ");
  if (fieldSummary) console.log(`  field rows: ${fieldSummary}`);
  logAnomalies(report.anomalies);
  return { report, evidence };
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
  let acceptedLiveDrifts = 0;
  const countEvidence: NamedCountEvidence[] = [];

  const assess = (
    source: string,
    started: Date,
    finished: Date,
    counts: {
      sourceCountBefore: number;
      sourceCountAfter: number;
      identitiesScanned: number;
      stagedCount: number;
      payloadExtracted: number;
      staleRemoved: number;
    },
    gateMode: StageMode = args.mode,
  ): NamedCountEvidence => {
    const evidence = {
      source,
      extractionStartedAt: started.toISOString(),
      extractionFinishedAt: finished.toISOString(),
      payloadExtracted: counts.payloadExtracted,
      staleRemoved: counts.staleRemoved,
      ...assessCountEvidence(gateMode, counts),
    };
    countEvidence.push(evidence);
    if (evidence.status === "fail") mismatches++;
    if (evidence.acceptedLiveDrift) acceptedLiveDrifts++;
    return evidence;
  };

  if (!args.skipTerms) {
    const extractionStartedAt = new Date();
    const watermark = await stagingNow();
    const { catalog: termCatalog } = await buildFieldCatalog(s1, "taxonomy_term");
    const termReport = await extractTerms(s1, termCatalog, args.batch, upsertTerms);
    const stale = await deleteStaleTerms(watermark);
    const staged = await stagedTermCount();
    const evidence = assess("terms", extractionStartedAt, new Date(), {
      sourceCountBefore: termReport.s1TermCount,
      sourceCountAfter: termReport.sourceCountAfter,
      identitiesScanned: termReport.extracted,
      stagedCount: staged,
      payloadExtracted: termReport.extracted,
      staleRemoved: stale,
    }, "final-freeze");
    const ok = evidence.status === "pass" ? (evidence.acceptedLiveDrift ? "LIVE-DRIFT-ACCEPTED" : "OK") : "MISMATCH";
    console.log(
      `terms: sourceBefore=${termReport.s1TermCount} sourceAfter=${termReport.sourceCountAfter} scanned=${termReport.extracted} staged=${staged}${stale ? ` staleRemoved=${stale}` : ""} ${ok} (${termReport.durationMs}ms)`,
    );
    console.log(`  vocabularies: ${JSON.stringify(termReport.vocabularies)}`);
    logAnomalies(termReport.anomalies);
  }

  const runBundle = (bundle: string) =>
    stageNodeBundle({
      s1,
      bundle,
      fields: nodeCatalog.get(bundle) ?? [],
      batch: args.batch,
      mode: args.mode,
      heavyShards: args.heavyShards,
    });
  const bundleResults: Array<{ report: BundleExtractReport; evidence: NamedCountEvidence }> = [];
  if (args.mode === "daily") {
    const lightBundles = targets.filter((bundle) => !DAILY_SHARDED_BUNDLES.has(bundle));
    for (let i = 0; i < lightBundles.length; i += args.bundleConcurrency) {
      const wave = lightBundles.slice(i, i + args.bundleConcurrency);
      console.log(`daily bundle wave: ${wave.join(", ")} (concurrency=${wave.length})`);
      bundleResults.push(...(await Promise.all(wave.map(runBundle))));
    }
    for (const bundle of targets.filter((name) => DAILY_SHARDED_BUNDLES.has(name))) {
      console.log(`daily heavy bundle: ${bundle} (serial bundle, ${args.heavyShards} identity-range shard(s))`);
      bundleResults.push(await runBundle(bundle));
    }
  } else {
    for (const bundle of targets) bundleResults.push(await runBundle(bundle));
  }
  const targetOrder = new Map(targets.map((bundle, index) => [bundle, index]));
  bundleResults.sort(
    (a, b) => (targetOrder.get(a.report.bundle) ?? Number.MAX_SAFE_INTEGER) - (targetOrder.get(b.report.bundle) ?? Number.MAX_SAFE_INTEGER),
  );
  for (const { report, evidence } of bundleResults) {
    reports.push(report);
    countEvidence.push(evidence);
    if (evidence.status === "fail") mismatches++;
    if (evidence.acceptedLiveDrift) acceptedLiveDrifts++;
  }

  // Raw tables stage on default and --all runs; selective --bundles runs
  // skip them (like bundles they weren't asked for), --skip-raw always skips.
  let rawLedgerReport: Awaited<ReturnType<typeof stageRawLedgerAr>> | null = null;
  if (!args.skipRaw && (args.bundles == null || args.rawOnly)) {
    const extractionStartedAt = new Date();
    rawLedgerReport = await stageRawLedgerAr(s1, args.batch);
    const evidence = assess("raw:sirius_ledger_ar", extractionStartedAt, new Date(), {
      sourceCountBefore: rawLedgerReport.s1Count,
      sourceCountAfter: rawLedgerReport.sourceCountAfter,
      identitiesScanned: rawLedgerReport.extracted,
      stagedCount: rawLedgerReport.staged,
      payloadExtracted: rawLedgerReport.extracted,
      staleRemoved: rawLedgerReport.staleRemoved,
    }, "final-freeze");
    const ok = evidence.status === "pass" ? (evidence.acceptedLiveDrift ? "LIVE-DRIFT-ACCEPTED" : "OK") : "MISMATCH";
    console.log(
      `raw sirius_ledger_ar: sourceBefore=${rawLedgerReport.s1Count} sourceAfter=${rawLedgerReport.sourceCountAfter} extracted=${rawLedgerReport.extracted} staged=${rawLedgerReport.staged}${rawLedgerReport.staleRemoved ? ` staleRemoved=${rawLedgerReport.staleRemoved}` : ""} ${ok} (${rawLedgerReport.durationMs}ms)`,
    );
  } else if (args.bundles != null && !args.skipRaw) {
    console.log("raw sirius_ledger_ar: skipped (selective --bundles run)");
  }

  // T27 raw user tables stage under the same policy as raw AR.
  let rawUserReports: RawTableReport[] | null = null;
  if (!args.skipRaw && (args.bundles == null || args.rawOnly)) {
    const extractionStartedAt = new Date();
    rawUserReports = await stageRawUserTables(s1, args.batch);
    for (const r of rawUserReports) {
      const evidence = assess(`raw:${r.table}`, extractionStartedAt, new Date(), {
        sourceCountBefore: r.s1Count,
        sourceCountAfter: r.sourceCountAfter,
        identitiesScanned: r.extracted,
        stagedCount: r.staged,
        payloadExtracted: r.extracted,
        staleRemoved: r.staleRemoved,
      }, "final-freeze");
      const ok = evidence.status === "pass" ? (evidence.acceptedLiveDrift ? "LIVE-DRIFT-ACCEPTED" : "OK") : "MISMATCH";
      console.log(
        `raw ${r.table}: sourceBefore=${r.s1Count} sourceAfter=${r.sourceCountAfter} extracted=${r.extracted} staged=${r.staged}${r.staleRemoved ? ` staleRemoved=${r.staleRemoved}` : ""} ${ok} (${r.durationMs}ms)`,
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
    acceptedLiveDrifts,
    countEvidence,
    documentedSkips,
    nulSanitizedValues: nulSanitizedCount(),
    rawLedgerAr: rawLedgerReport,
    rawUserTables: rawUserReports,
  });

  // Machine-readable handoff for the sync orchestrator (§11): aggregates only.
  const resultPath = process.env.S1_RESULT_JSON_PATH;
  if (resultPath) {
    const { writeFileSync } = await import("fs");
    writeFileSync(
      resultPath,
      JSON.stringify({
        contractVersion: 2,
        step: "stage",
        mode: args.mode,
        status: mismatches === 0 ? "pass" : "fail",
        mismatches,
        acceptedLiveDrifts,
        countEvidence,
        bundles: reports.length,
        nulSanitizedValues: nulSanitizedCount(),
        rawLedgerStaged: rawLedgerReport?.staged ?? null,
        rawUserTables: rawUserReports?.length ?? null,
      }),
    );
  }

  console.log(
    mismatches === 0
      ? `\nDone: ${reports.length} bundle(s) staged; evidence gate passed${acceptedLiveDrifts ? ` with ${acceptedLiveDrifts} bounded live-source drift(s)` : ""}.`
      : `\nDone with ${mismatches} STAGING EVIDENCE FAILURE(S) — inspect before loading.`,
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
