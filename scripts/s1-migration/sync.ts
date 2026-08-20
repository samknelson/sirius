/**
 * One-command S1→S2 daily sync with FULL-FLEET gates — RUNBOOK §11.
 *
 *   npx tsx scripts/s1-migration/sync.ts --mode daily|final-freeze \
 *       [--profile production|dev] [--dry-run] [--force-reconcile] \
 *       [--skip-stage] [--keep-going]
 *
 * One run performs: advisory lock (727001, same key as bootstrap/seed — no
 * concurrent migration process of any kind) → stage.ts (count-verified,
 * abort on mismatch) → the whole fleet with dependency-ordered dev fake
 * re-seeds (dev profile only; each seed runs after the step it needs) → the whole
 * loader fleet in RUNBOOK order with the RULED per-loader allowances from
 * sync-config.ts → per-loader verify/reject/finding gates → balance parity +
 * month parity (rolling ruled month set) → ONE aggregate report persisted to
 * s1_staging.runs. Exit 0 only when EVERY gate passes.
 *
 * Result contract: every fleet step must emit the §10 standard envelope via
 * S1_RESULT_JSON_PATH. The orchestrator validates presence + schema + loader
 * name + LOGIC_VERSION against sync-config (a transform fix that bumps a
 * loader version without updating sync-config fails the run — the §10 bump
 * rule with teeth) and aggregates counters WITHOUT scraping log text.
 * Missing/malformed results fail the run even when the process exited 0.
 *
 * Gates (any failure ⇒ exit 1; parity PASS can never override them):
 *   stage      — staged counts must equal S1 counts.
 *   fleet      — per step: process exit 0, valid envelope, rejectGate pass
 *                (only RULED classes), verify pass, no blocking findings.
 *   findings   — mode policy on report-only deletion findings (§10 sweeps):
 *                daily: config-ruled kinds surface in the report for triage
 *                (rows stay untouched — sweeps are report-only by design);
 *                final-freeze: EVERY finding, ruled or not, is stop-the-line
 *                until resolved in S1 + restaged (or the mapping is ruled
 *                away). Unknown kinds are never forwarded, so loaders fail
 *                closed on them in both modes.
 *   balance    — 0¢ drift (verify-balance-parity).
 *   months     — verify-month-parity for {freeze, mid-history, current
 *                open-span month} — the open-span month advances per sync.
 *
 * Controls:
 *   --dry-run          Loaders run with --dry-run (no S2 writes, preview
 *                      counters). Stage + dev seeds still execute (staging is
 *                      migration scratch — an accurate preview needs a fresh
 *                      mirror); parity is skipped (it would judge the
 *                      UN-applied state); no runs row is recorded.
 *   --force-reconcile  Forwarded to every fingerprint-converted loader and
 *                      recorded PROMINENTLY in the aggregate report (§10:
 *                      emergency repair — S1 wins on migration-owned fields).
 *   --skip-stage       Re-run gates/loaders against staging AS-IS (retry
 *                      after a mid-fleet failure without a 25-min restage;
 *                      dev: implies seeded fakes are already in place).
 *   --keep-going       Do not abort the fleet on the first failed step —
 *                      collect every loader's result for triage. The run
 *                      still fails.
 *
 * Failed runs are safely re-runnable: loaders are idempotent reconcilers
 * (§7/§10) and fingerprints only advance after each loader's verify pass.
 * Output is AGGREGATES ONLY (HIPAA) — counts, classes, durations; never row
 * values or names.
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { pool as pgPool } from "../../server/storage/db";
import { resolveDatabaseUrl, describeDatabaseTarget } from "../../shared/database-url";
import { acquireExclusiveAppWriteFence, type AppWriteFenceLease } from "../../server/services/s1-write-fence";
import { ensureStagingSchema, recordRun, updateRunReport } from "./lib/staging";
import { finalizeWriteFenceReport } from "./lib/write-fence-report";
import {
  FLEET,
  PROFILES,
  validateSyncConfig,
  resolveOpenEndThrough,
  parityMonths,
  currentLaMonth,
  type FleetStep,
  type SyncMode,
  type SyncProfileName,
} from "./sync-config";

const MIGRATION_LOCK_KEY = 727001; // same key as bootstrap-target/seed-trust-config

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? String(process.argv[i + 1] ?? "") : null;
}
const MODE = (argValue("--mode") ?? "") as SyncMode;
const PROFILE_NAME = (argValue("--profile") ?? "production") as SyncProfileName;
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE_RECONCILE = process.argv.includes("--force-reconcile");
const SKIP_STAGE = process.argv.includes("--skip-stage");
const KEEP_GOING = process.argv.includes("--keep-going");

if (MODE !== "daily" && MODE !== "final-freeze") {
  console.error("Usage: sync.ts --mode daily|final-freeze [--profile production|dev] [--dry-run] [--force-reconcile] [--skip-stage] [--keep-going]");
  process.exit(1);
}
if (!(PROFILE_NAME in PROFILES)) {
  console.error(`FAIL: unknown profile "${PROFILE_NAME}" (known: ${Object.keys(PROFILES).join(", ")})`);
  process.exit(1);
}

const BASE = path.dirname(new URL(import.meta.url).pathname);

// ---------------------------------------------------------------------------
// Child process plumbing — results come back via S1_RESULT_JSON_PATH files,
// never by scraping stdout (the console stays the operator's progress view).
// ---------------------------------------------------------------------------
interface ChildRun {
  exitCode: number;
  durationSec: number;
  result: unknown | null; // parsed result file (null = missing/unparseable)
  resultError: string | null;
}

function runChild(script: string, args: string[], resultFile: string): ChildRun {
  const t0 = Date.now();
  try {
    fs.rmSync(resultFile, { force: true });
  } catch {
    /* ignore */
  }
  const res = spawnSync("npx", ["tsx", path.join(BASE, script), ...args], {
    stdio: "inherit",
    env: { ...process.env, S1_RESULT_JSON_PATH: resultFile, S1_SYNC_LOCK_HELD: "1" },
  });
  const durationSec = Math.round((Date.now() - t0) / 100) / 10;
  const exitCode = res.status ?? (res.signal ? 1 : 1);
  let result: unknown | null = null;
  let resultError: string | null = null;
  try {
    result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  } catch (e) {
    resultError = fs.existsSync(resultFile) ? "result file unparseable" : "result file missing";
  }
  return { exitCode, durationSec, result, resultError };
}

// ---------------------------------------------------------------------------
// Envelope validation (the machine-readable loader result contract, §10)
// ---------------------------------------------------------------------------
const SUMMARY_FIELDS = ["created", "updated", "unchanged", "deleted", "deactivated", "reportOnly", "rejected"] as const;

interface EnvelopeLike {
  loader: string;
  logicVersion: number;
  dryRun: boolean;
  forceReconcile: boolean;
  summary: Record<(typeof SUMMARY_FIELDS)[number], number>;
  rejectGate: { status: "pass" | "fail"; counts: Record<string, number>; allowed: string[]; disallowed: Array<{ reason: string; count: number }> };
  verify: { status: "pass" | "fail"; failures: number };
  findings: Array<{ kind: string }>;
  blockingFindings: Array<{ kind: string }>;
}

function validateEnvelope(step: FleetStep, run: ChildRun, forcedThisRun: boolean): { env: EnvelopeLike | null; contractErrors: string[] } {
  const errs: string[] = [];
  if (run.result == null) {
    errs.push(run.resultError ?? "result file missing");
    return { env: null, contractErrors: errs };
  }
  const e = run.result as Partial<EnvelopeLike>;
  if (e.loader !== step.loader) errs.push(`loader name "${String(e.loader)}" != expected "${step.loader}"`);
  if (e.logicVersion !== step.logicVersion) {
    errs.push(
      `logicVersion ${String(e.logicVersion)} != sync-config expectation ${step.logicVersion} — ` +
        `a transform change must bump the loader LOGIC_VERSION and sync-config.ts in the same commit (§10)`,
    );
  }
  if (typeof e.dryRun !== "boolean" || e.dryRun !== DRY_RUN) errs.push(`envelope dryRun=${String(e.dryRun)} != run dryRun=${DRY_RUN}`);
  if (typeof e.forceReconcile !== "boolean") errs.push("envelope forceReconcile missing");
  else if (forcedThisRun && !e.forceReconcile) errs.push("orchestrator passed --force-reconcile but the loader did not report it");
  const s = e.summary as Record<string, unknown> | undefined;
  if (!s || typeof s !== "object") errs.push("summary missing");
  else {
    for (const f of SUMMARY_FIELDS) {
      if (typeof s[f] !== "number" || !Number.isFinite(s[f] as number)) errs.push(`summary.${f} missing/non-numeric`);
    }
  }
  const rg = e.rejectGate;
  if (!rg || (rg.status !== "pass" && rg.status !== "fail") || typeof rg.counts !== "object" || !Array.isArray(rg.disallowed)) {
    errs.push("rejectGate missing/malformed");
  }
  const v = e.verify;
  if (!v || (v.status !== "pass" && v.status !== "fail") || typeof v.failures !== "number") errs.push("verify missing/malformed");
  if (!Array.isArray(e.findings) || !Array.isArray(e.blockingFindings)) errs.push("findings/blockingFindings missing");
  return { env: errs.length === 0 ? (e as EnvelopeLike) : null, contractErrors: errs };
}

function countByKind(findings: Array<{ kind: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) out[f.kind] = (out[f.kind] ?? 0) + 1;
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  validateSyncConfig();
  const profile = PROFILES[PROFILE_NAME];
  const startedAt = new Date();
  const failures: string[] = [];
  const horizon = resolveOpenEndThrough(profile, startedAt);
  const months = parityMonths(profile, startedAt);

  console.log(`[sync] target: ${describeDatabaseTarget(resolveDatabaseUrl())}`);
  console.log(`[sync] mode=${MODE} profile=${PROFILE_NAME} dryRun=${DRY_RUN} skipStage=${SKIP_STAGE} keepGoing=${KEEP_GOING}`);
  console.log(`[sync] open-end horizon: ${horizon}${profile.openEndThrough === "current-la-month" ? " (current LA month — advances per sync)" : " (pinned)"}`);
  console.log(`[sync] parity months: ${months.join(", ")} (open-span month = ${currentLaMonth(startedAt)})`);
  if (FORCE_RECONCILE) {
    console.log("");
    console.log("⚠⚠⚠  FORCE-RECONCILE RUN — fingerprints ignored; S1 overwrites migration-owned fields on EVERY mapped row (§10 emergency repair). Recorded in the run report.  ⚠⚠⚠");
    console.log("");
  }

  // --- Advisory lock: one migration process per target, ever. -------------
  await ensureStagingSchema();
  const lockClient = await pgPool.connect();
  const [{ got }] = (await lockClient.query(`SELECT pg_try_advisory_lock(${MIGRATION_LOCK_KEY}) AS got`)).rows as Array<{ got: boolean }>;
  if (!got) {
    console.error("FAIL: another migration process (sync/bootstrap/seed) holds the advisory lock on this target — concurrent sync runs are refused.");
    lockClient.release();
    await pgPool.end();
    process.exit(1);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "s1-sync-"));
  const report: Record<string, unknown> = {
    command: "sync",
    mode: MODE,
    profile: PROFILE_NAME,
    dryRun: DRY_RUN,
    forceReconcile: FORCE_RECONCILE, // prominent: top-level, plus per-step below
    skipStage: SKIP_STAGE,
    keepGoing: KEEP_GOING,
    openEndThrough: horizon,
    parityMonths: months,
  };
  let writeFence: AppWriteFenceLease | undefined;
  let aggregateRunId: number | undefined;

  try {
    if (DRY_RUN) {
      report.writeFence = { status: "skipped", reason: "dry-run" };
      console.log("[sync] app write fence: SKIPPED (dry-run leaves the app fully writable)");
    } else {
      console.log("[sync] app write fence: waiting for in-flight app mutations to finish …");
      const fenceStartedAt = Date.now();
      // Use this process's normal pool: unlike the live app, the migration
      // process has no concurrent handlers whose pool capacity must be
      // reserved. The dedicated lock client remains held for the whole run.
      writeFence = await acquireExclusiveAppWriteFence(pgPool);
      const waitSec = Math.round((Date.now() - fenceStartedAt) / 100) / 10;
      report.writeFence = { status: "acquired", waitSec, heldThroughAggregateRecord: true };
      console.log(`[sync] app write fence: ACQUIRED after ${waitSec}s — reads stay online; writes and background work defer until release`);
    }
    // --- 1. Stage (count-verified mirror of live S1) ----------------------
    if (SKIP_STAGE) {
      report.stage = { status: "skipped", note: "operator ran with --skip-stage; staging used as-is" };
      console.log("[sync] stage: SKIPPED (--skip-stage)");
    } else {
      console.log("[sync] stage: re-staging from S1 …");
      const run = runChild("stage.ts", profile.stageArgs, path.join(tmpDir, "stage.json"));
      const r = (run.result ?? {}) as { mismatches?: number };
      const mismatches = typeof r.mismatches === "number" ? r.mismatches : null;
      const ok = run.exitCode === 0 && mismatches === 0;
      report.stage = { status: ok ? "pass" : "fail", exitCode: run.exitCode, durationSec: run.durationSec, mismatches, resultError: run.resultError };
      if (!ok) {
        failures.push(
          run.resultError
            ? `stage: ${run.resultError} (exit ${run.exitCode})`
            : `stage: count mismatch(es)=${String(mismatches)} exit=${run.exitCode} — staged view does not mirror S1; aborting before any loader runs`,
        );
        return; // stage gate: abort everything
      }
    }

    // --- 2. Loader fleet, in ruled order, with ruled allowances -----------
    const fleetRecords: Array<Record<string, unknown>> = [];
    report.fleet = fleetRecords;
    const totals = { created: 0, updated: 0, unchanged: 0, deleted: 0, deactivated: 0, reportOnly: 0, rejected: 0 };
    const findingsByKind: Record<string, number> = {};
    const finalFreezeBlocked: Array<{ step: string; kinds: Record<string, number> }> = [];
    const seedRuns: Array<{ script: string; afterStep: string; exitCode: number }> = [];
    let aborted = false;

    for (const step of FLEET) {
      const pol = profile.steps[step.id] ?? {};
      const args: string[] = [];
      if (DRY_RUN) args.push("--dry-run");
      const forcedThisRun = FORCE_RECONCILE && step.supportsForceReconcile;
      if (forcedThisRun) args.push("--force-reconcile");
      if (pol.allowRejects?.length) args.push("--allow-rejects", pol.allowRejects.join(","));
      // Findings: forward the RULED kinds in BOTH modes so the fleet completes
      // and reports; final-freeze blocking is enforced by the orchestrator
      // below. Unknown kinds are never forwarded ⇒ loaders fail closed.
      const allowFindings = [...profile.dailyAllowedFindings, ...(pol.allowFindings ?? [])];
      if (step.supportsAllowFindings && allowFindings.length > 0) {
        args.push("--allow-findings", allowFindings.join(","));
      }
      if (step.id === "benefit-history" && profile.openEndThrough !== "current-la-month") {
        args.push("--open-end-through", profile.openEndThrough);
      }
      if (step.extraArgs?.length) args.push(...step.extraArgs);
      if (pol.extraArgs?.length) args.push(...pol.extraArgs);

      console.log(`\n[sync] ── ${step.id} (${step.script}${args.length ? " " + args.join(" ") : ""})`);
      const run = runChild(step.script, args, path.join(tmpDir, `${step.id}.json`));
      const { env, contractErrors } = validateEnvelope(step, run, forcedThisRun);

      const stepFailures: string[] = [];
      if (run.exitCode !== 0) stepFailures.push(`process exit ${run.exitCode}`);
      for (const ce of contractErrors) stepFailures.push(`result contract: ${ce}`);
      if (env) {
        if (env.rejectGate.status === "fail") {
          stepFailures.push(`disallowed rejects: ${env.rejectGate.disallowed.map((d) => `${d.reason}=${d.count}`).join(", ")}`);
        }
        if (env.verify.status === "fail") stepFailures.push(`verifyFailures=${env.verify.failures}`);
        if (env.blockingFindings.length > 0) {
          stepFailures.push(`blocking findings: ${JSON.stringify(countByKind(env.blockingFindings))}`);
        }
        for (const f of SUMMARY_FIELDS) totals[f] += env.summary[f];
        const kinds = countByKind(env.findings);
        for (const [k, n] of Object.entries(kinds)) findingsByKind[k] = (findingsByKind[k] ?? 0) + n;
        // Mode gate: final-freeze treats EVERY unresolved report-only finding
        // as stop-the-line, even the daily-ruled ones. Only step-level
        // config-RULED structural kinds (StepPolicy.allowFindings) are exempt
        // — those are ruled, not "unresolved/unruled".
        const freezeBlocking = env.findings.filter((f) => !(pol.allowFindings ?? []).includes(f.kind));
        if (MODE === "final-freeze" && freezeBlocking.length > 0) {
          finalFreezeBlocked.push({ step: step.id, kinds: countByKind(freezeBlocking) });
        }
      }

      fleetRecords.push({
        id: step.id,
        loader: step.loader,
        logicVersion: env?.logicVersion ?? null,
        exitCode: run.exitCode,
        durationSec: run.durationSec,
        status: stepFailures.length === 0 ? "pass" : "fail",
        failures: stepFailures,
        forceReconcile: env?.forceReconcile ?? forcedThisRun,
        summary: env?.summary ?? null,
        rejectGate: env ? { status: env.rejectGate.status, counts: env.rejectGate.counts, allowed: env.rejectGate.allowed, disallowed: env.rejectGate.disallowed } : null,
        verify: env ? env.verify : null,
        findingsByKind: env ? countByKind(env.findings) : null,
        blockingFindings: env ? env.blockingFindings.length : null,
      });

      if (stepFailures.length > 0) {
        failures.push(`${step.id}: ${stepFailures.join("; ")}`);
        console.error(`[sync] ✗ ${step.id} FAILED — ${stepFailures.join("; ")}`);
        if (!KEEP_GOING) {
          aborted = true;
          report.fleetAbortedAt = step.id;
          console.error(`[sync] aborting fleet (run with --keep-going to collect all loader results for triage)`);
          break;
        }
      } else {
        const s = env!.summary;
        console.log(
          `[sync] ✓ ${step.id} ${run.durationSec}s created=${s.created} updated=${s.updated} unchanged=${s.unchanged} deleted=${s.deleted} ` +
            `deactivated=${s.deactivated} reportOnly=${s.reportOnly} rejected=${s.rejected}` +
            (env!.findings.length ? ` findings=${JSON.stringify(countByKind(env!.findings))}` : ""),
        );
        // Dev-only staged-fake re-seeds gated on this step's id_map rows (a
        // restage sweeps the fakes; --skip-stage keeps them, so no re-seed).
        // NOTE: on a FRESH target a full-stage --dry-run cannot satisfy these
        // seeds (dry loaders create no mappings) — dry-run previews are for
        // already-loaded targets; the smoke uses --skip-stage for its preview.
        if (!SKIP_STAGE) {
          for (const seed of profile.postStageSeeds) {
            if (seed.afterStep !== step.id) continue;
            console.log(`[sync] seed (after ${step.id}): ${seed.script}`);
            const sr = runChild(seed.script, [], path.join(tmpDir, "seed.json"));
            seedRuns.push({ script: seed.script, afterStep: seed.afterStep, exitCode: sr.exitCode });
            report.seeds = seedRuns;
            if (sr.exitCode !== 0) {
              failures.push(
                `seed ${seed.script} (after ${step.id}) failed (exit ${sr.exitCode}) — aborting: later fleet steps consume the seeded staged fakes`,
              );
              aborted = true;
              report.fleetAbortedAt = step.id;
            }
          }
          if (aborted) break;
        }
      }
    }

    report.fleetTotals = totals;
    report.findingsByKind = findingsByKind;

    // Mode gate on report-only findings.
    if (MODE === "final-freeze" && finalFreezeBlocked.length > 0) {
      report.finalFreezeBlocked = finalFreezeBlocked;
      for (const b of finalFreezeBlocked) {
        failures.push(
          `final-freeze: ${b.step} has unresolved report-only finding(s) ${JSON.stringify(b.kinds)} — ` +
            `stop-the-line: resolve in S1 + restage, or rule the mapping away; per-run acknowledgement is a daily-mode measure only`,
        );
      }
    }
    if (MODE === "daily" && Object.keys(findingsByKind).length > 0) {
      console.log(`\n[sync] report-only findings surfaced for triage (daily mode): ${JSON.stringify(findingsByKind)}`);
    }

    // --- 3. Cross-domain parity gates (separate coverage dimensions; their
    //        PASS can never override an earlier loader-level failure). ------
    if (DRY_RUN) {
      report.parity = { status: "skipped", note: "dry-run: parity would judge the un-applied state" };
    } else if (aborted) {
      report.parity = { status: "skipped", note: `fleet aborted at ${String(report.fleetAbortedAt)}` };
    } else {
      const balArgs = ["--tolerance-cents", String(profile.parity.toleranceCents)];
      if (profile.parity.allowMismatches.length) balArgs.push("--allow-mismatches", profile.parity.allowMismatches.join(","));
      console.log(`\n[sync] ── balance parity (${balArgs.join(" ")})`);
      const bal = runChild("verify-balance-parity.ts", balArgs, path.join(tmpDir, "parity-balance.json"));
      const balRes = (bal.result ?? {}) as { result?: string };
      const balOk = bal.exitCode === 0 && balRes.result === "PASS";
      if (!balOk) failures.push(`balance parity FAILED (exit ${bal.exitCode}${bal.resultError ? `, ${bal.resultError}` : ""})`);

      // Month parity mirrors the benefit-history allowances EXACTLY (§6).
      const t17Allows = profile.steps["benefit-history"]?.allowRejects ?? [];
      const allowUnresolved = [...t17Allows, ...profile.parity.extraAllowUnresolved];
      const monthRecords: Array<Record<string, unknown>> = [];
      for (const month of months) {
        const mArgs = ["--month", month, "--max-disagreement-pct", String(profile.parity.maxDisagreementPct), "--open-end-through", horizon];
        if (allowUnresolved.length) mArgs.push("--allow-unresolved", allowUnresolved.join(","));
        console.log(`\n[sync] ── month parity ${month} (${mArgs.join(" ")})`);
        const mp = runChild("verify-month-parity.ts", mArgs, path.join(tmpDir, `parity-month-${month}.json`));
        const mpRes = (mp.result ?? {}) as { result?: string };
        const mpOk = mp.exitCode === 0 && mpRes.result === "PASS";
        monthRecords.push({ month, status: mpOk ? "pass" : "fail", exitCode: mp.exitCode, durationSec: mp.durationSec });
        if (!mpOk) failures.push(`month parity ${month} FAILED (exit ${mp.exitCode}${mp.resultError ? `, ${mp.resultError}` : ""})`);
      }
      report.parity = {
        status: balOk && monthRecords.every((m) => m.status === "pass") ? "pass" : "fail",
        balance: { status: balOk ? "pass" : "fail", exitCode: bal.exitCode, durationSec: bal.durationSec, toleranceCents: profile.parity.toleranceCents },
        months: monthRecords,
        allowUnresolved,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`sync aborted by an unexpected error: ${message.split("\n")[0]}`);
    console.error(`[sync] unexpected error: ${message.split("\n")[0]}`);
  } finally {
    // --- 4. One aggregate run report, always ------------------------------
    const durationSec = Math.round((Date.now() - startedAt.getTime()) / 100) / 10;
    report.durationSec = durationSec;
    report.failures = failures;
    report.result = failures.length === 0 ? "PASS" : "FAIL";
    const gates = {
      stage: (report.stage as { status?: string } | undefined)?.status ?? "not-run",
      fleet: Array.isArray(report.fleet) && (report.fleet as Array<{ status: string }>).every((s) => s.status === "pass") && !report.fleetAbortedAt ? "pass" : "fail",
      findingsMode:
        MODE === "final-freeze"
          ? Array.isArray(report.finalFreezeBlocked) && (report.finalFreezeBlocked as unknown[]).length > 0
            ? "fail"
            : "pass"
          : "pass (daily: ruled findings surface for triage)",
      parity: (report.parity as { status?: string } | undefined)?.status ?? "not-run",
    };
    report.gates = gates;

    console.log("\n[sync] ════════════════════════════════════════════════");
    console.log(`[sync] gates: stage=${gates.stage} fleet=${gates.fleet} findings[${MODE}]=${gates.findingsMode} parity=${gates.parity}`);
    if (FORCE_RECONCILE) console.log("[sync] ⚠ this was a FORCE-RECONCILE run");
    console.log(`[sync] RESULT: ${String(report.result)} (${durationSec}s)${failures.length ? `\n[sync] failures:\n${failures.map((f) => `  - ${f}`).join("\n")}` : ""}`);

    const resultPath = process.env.S1_RESULT_JSON_PATH;
    if (resultPath) {
      try {
        fs.writeFileSync(resultPath, JSON.stringify(report));
      } catch (e) {
        console.error(`[sync] could not write S1_RESULT_JSON_PATH: ${(e as Error).message}`);
      }
    }
    if (!DRY_RUN) {
      try {
        aggregateRunId = await recordRun(startedAt, { command: "sync", mode: MODE, profile: PROFILE_NAME, dryRun: DRY_RUN, forceReconcile: FORCE_RECONCILE, skipStage: SKIP_STAGE, keepGoing: KEEP_GOING }, report);
      } catch (e) {
        console.error(`[sync] recordRun failed (non-fatal): ${(e as Error).message?.split("\n")[0]}`);
      }
    } else {
      console.log("[sync] dry-run: no runs row recorded");
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    if (writeFence) {
      await finalizeWriteFenceReport(writeFence, report, failures);
      if ((report.writeFence as { releaseStatus?: string }).releaseStatus === "released") {
        console.log("[sync] app write fence: RELEASED — writes and background work may resume");
      } else {
        console.error("[sync] app write fence: explicit release failed; lock session discarded and database pool will close");
      }
      if (aggregateRunId !== undefined) {
        try {
          await updateRunReport(aggregateRunId, report);
        } catch (e) {
          failures.push("aggregate sync run could not be updated with final fence cleanup status");
          report.failures = failures;
          report.result = "FAIL";
          console.error(`[sync] final aggregate run update failed: ${(e as Error).message?.split("\n")[0]}`);
        }
      }
      // Write the process result after every cleanup/persistence attempt so
      // operators never read a stale PASS when terminal cleanup failed.
      if (resultPath) {
        try {
          fs.writeFileSync(resultPath, JSON.stringify(report));
        } catch (e) {
          console.error(`[sync] could not update S1_RESULT_JSON_PATH with fence cleanup: ${(e as Error).message}`);
        }
      }
      console.log(`[sync] FINAL RESULT after fence cleanup: ${String(report.result)}`);
    }
    lockClient.release();
    await pgPool.end();
    process.exitCode = failures.length === 0 ? 0 : 1;
  }
}

main().catch((e) => {
  const dbg = process.env.S1_MIGRATION_DEBUG === "1";
  console.error(dbg ? e : `FATAL ${(e as Error).name}: ${String((e as Error).message ?? e).split("\n")[0]}`);
  process.exit(1);
});
