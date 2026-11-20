/**
 * CLI-only S1 employer-upload history → immutable actual S2 monthly wizards.
 * Run AFTER stage (feeds/logs/shops) and employers. No upload handlers/events.
 * --dry-run writes neither targets, mappings, nor run reports.
 * --force-reconcile is accepted for fleet parity; every run already proves targets.
 * --allow-rejects approved_historical_upload allows ONLY the approved ID/reason pairs.
 */
import { createHash } from "node:crypto";
import { s1EmployerWizards } from "../../server/plugins/system/oneoff/plugins/s1-migration/employer-wizards";
import { pool } from "../../server/storage/db";
import { recordRun } from "./lib/staging";
import { assertMigrationTimeZone, MigrationTimeZoneError } from "./lib/timezone-contract";
import { RejectLog } from "./lib/loader-utils";
import { buildLoaderResult, emitLoaderResult, emptySummary, loaderExitCode, parseForceReconcile } from "./lib/sync";
import {
  EMPLOYER_WIZARD_LOADER as LOADER,
  APPROVED_HISTORY_REJECT, approvedReject, indexUploadParents, resolveUpload,
} from "./lib/employer-wizards";

// Fleet preflight reads this literal without importing executable loaders.
const LOGIC_VERSION = 1;
let phase = "CLI arguments";

async function main() {
  const startedAt = new Date();
  const dryRun = process.argv.includes("--dry-run");
  const forceReconcile = parseForceReconcile();
  const limitIndex = process.argv.indexOf("--limit");
  const limit = limitIndex < 0 ? Infinity : Number(process.argv[limitIndex + 1]);
  if (limitIndex >= 0 && (!dryRun || !Number.isSafeInteger(limit) || limit < 1)) {
    throw new Error("--limit requires --dry-run and a positive integer");
  }
  const allowIndex = process.argv.indexOf("--allow-rejects");
  const allowedRejects = allowIndex < 0 ? [] : (process.argv[allowIndex + 1] ?? "").split(",").filter(Boolean);
  if (allowedRejects.some(r => r !== APPROVED_HISTORY_REJECT)) throw new Error("Only approved_historical_upload may be allowed.");
  phase = "migration timezone gate";
  await assertMigrationTimeZone();
  phase = "staging and destination prerequisites";
  await s1EmployerWizards.prerequisites();
  phase = "source relationships";
  const { parents, employers, mappedFeeds } = await s1EmployerWizards.context();
  const parentIndex = indexUploadParents(parents);
  const summary = emptySummary(), rejects = new RejectLog();
  const reasons: Record<string, number> = {}, correspondence: Record<string, number> = {};
  let scanned = 0, outOfScope = 0, candidates = 0, verifyFailures = 0, after = -1;
  scan: for (;;) {
    phase = "staged feed scan";
    const page = await s1EmployerWizards.page(after);
    if (!page.length) break;
    for (const feed of page) {
      if (scanned >= limit) break scan;
      scanned++;
      const resolution = resolveUpload(feed, parentIndex, employers);
      if (resolution.kind === "out_of_scope") {
        if (mappedFeeds.has(feed.nid)) {
          rejects.add("mapped_source_type_changed", { sourceNid: feed.nid }, feed.nid);
          verifyFailures++;
        }
        outOfScope++; continue;
      }
      candidates++;
      if (resolution.kind === "reject") {
        reasons[resolution.reason] = (reasons[resolution.reason] ?? 0) + 1;
        const reason = mappedFeeds.has(feed.nid) ? "mapped_source_unresolved"
          : approvedReject(feed.nid, resolution.reason) ? APPROVED_HISTORY_REJECT : resolution.reason;
        rejects.add(reason, { sourceNid: feed.nid, reason: resolution.reason }, feed.nid);
        continue;
      }
      const h = resolution.history;
      const fingerprint = createHash("sha256").update(JSON.stringify(h)).digest("hex");
      try {
        const outcome = await s1EmployerWizards.reconcile(h, fingerprint, LOGIC_VERSION, dryRun);
        summary[outcome]++;
        const key = `${h.sourceType}|${h.sourceStatus}|${h.year}-${String(h.month).padStart(2, "0")}`;
        correspondence[key] = (correspondence[key] ?? 0) + 1;
      } catch (error) {
        // Never log DB errors containing bound source payloads or connection details.
        const known = new Set(["destination_employer_missing", "source_identity_conflict",
          "destination_identity_conflict", "destination_verification_failed"]);
        const reason = error instanceof Error && known.has(error.message) ? error.message : "write_or_read_failed";
        rejects.add(reason, { sourceNid: feed.nid }, feed.nid);
        verifyFailures++;
      }
    }
    after = page[page.length - 1].nid;
    console.error(`Employer upload history: ${scanned} staged feeds inspected`);
  }
  const missingSource = limitIndex >= 0 ? 0 : await s1EmployerWizards.missingSourceCount();
  verifyFailures += missingSource; // Preserve historical rows, but fail on unapproved vanished sources.
  const result = buildLoaderResult({
    loader: LOADER, logicVersion: LOGIC_VERSION, dryRun, forceReconcile,
    summary, rejects, allowedRejects, verifyFailures,
    detail: { scanned, candidates, outOfScope, reasons, correspondence, missingSource,
      scope: limitIndex >= 0 ? "bounded-dry-run-no-deletion-check" : "all-staged-feeds",
      verification: dryRun ? "source-and-target-plan-only" : "transactional-target-correspondence",
      historicalFiles: "unavailable", notificationsSent: 0, processedUploads: 0 },
  });
  emitLoaderResult(result);
  phase = "retaining run report";
  if (!dryRun) await recordRun(startedAt, { loader: LOADER, forceReconcile }, result as unknown as Record<string, unknown>);
  process.exitCode = loaderExitCode(result);
}
main().catch((error: unknown) => {
  if (error instanceof MigrationTimeZoneError) console.error(error.message);
  else console.error(`Employer upload history aborted during ${phase}; no successful result was issued. ` +
    "Check the runbook prerequisites. Database messages are withheld to protect source data.");
  process.exitCode = 1;
}).finally(async () => {
  const { drainStorageSideEffects } = await import("../../server/storage/drain-storage-side-effects");
  try { await drainStorageSideEffects(); } finally { await pool.end(); }
});
