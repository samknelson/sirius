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
import { extractBundle, extractTerms, type BundleExtractReport } from "./lib/extract";
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
} from "./lib/staging";
import { pool as pgPool } from "../../server/storage/db";

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
  batch: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { bundles: null, all: false, skipTerms: false, batch: 500 };
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
      case "--batch":
        args.batch = Math.max(1, Number(argv[++i] ?? 500));
        break;
      default:
        throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

async function main() {
  const startedAt = new Date();
  const args = parseArgs(process.argv.slice(2));
  const s1 = createS1Pool();
  await ensureStagingSchema();

  const populated = await listNodeBundles(s1);
  const populatedNames = new Set(populated.map((b) => b.bundle));

  let targets: string[];
  if (args.bundles) {
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

  await recordRun(startedAt, args as unknown as Record<string, unknown>, {
    reports,
    mismatches,
    documentedSkips,
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
