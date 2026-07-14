/**
 * Freeman dev deploy auto-approver
 * =================================
 *
 * Watches GitHub Actions for workflow runs waiting on environment approval
 * and auto-approves any whose pending deployments target ONLY the
 * "Development" GitHub Environment. Runs targeting any other environment
 * (QA, Production, ...) are always skipped and left for manual approval.
 *
 * Also tracks queued / in-progress workflow runs and prints which job and
 * step each run is currently on (similar to `gh run watch`), logging a
 * final conclusion line (success/failure/cancelled) when a run completes.
 * Progress lines are only printed when a run's status/step changes.
 *
 * Usage:
 *   npx tsx scripts/dev/sitespecific-freeman-autoapprove.ts
 *
 * Options (env vars):
 *   REPO           Repo to watch (default: Freeman-DevOps-Organization/fm-application-fls)
 *   POLL_INTERVAL  Seconds between polls (default: 15)
 *   GH_TOKEN       Token for the gh CLI (optional if `gh auth login` was used)
 *
 * Auth:
 *   Uses the `gh` CLI. Either run `gh auth login` first, or export GH_TOKEN.
 *   The token needs `repo` scope (classic PAT) or Actions read/write
 *   (fine-grained), AND the token's user must be a required reviewer on the
 *   Development environment — otherwise GitHub rejects the approval with 422.
 *
 * Stopping:
 *   Ctrl-C exits cleanly. This is a foreground tool, not a daemon.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const REPO = process.env.REPO || "Freeman-DevOps-Organization/fm-application-fls";
const POLL_INTERVAL_SECONDS = Math.max(5, Number(process.env.POLL_INTERVAL) || 15);
const ALLOWED_ENVIRONMENT = "Development";

interface WorkflowRun {
  id: number;
  name: string;
  display_title: string;
  html_url: string;
  head_branch: string;
  status: string;
}

interface PendingDeployment {
  environment: { id: number; name: string };
  current_user_can_approve: boolean;
  wait_timer_started_at: string | null;
}

let stopping = false;
// Runs we already approved (or definitively skipped) this session, so we
// don't spam logs / re-attempt every poll. Skipped runs may become
// approvable later (e.g. reviewer added), so only silence repeats briefly.
const approvedRuns = new Set<number>();
const loggedSkips = new Set<string>();

interface WorkflowJob {
  name: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null;
  steps?: Array<{ name: string; status: string; conclusion: string | null; number: number }>;
}

// runId -> last printed progress line, so we only log on change, and can
// announce completion when a tracked run disappears from the active list.
const trackedRuns = new Map<number, { lastLine: string; desc: string }>();

function ts(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${ts()}] ${msg}`);
}

async function gh(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("gh", args, {
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (err: any) {
    const stderr: string = err?.stderr || "";
    if (/gh auth login|GH_TOKEN|not logged in|authentication/i.test(stderr)) {
      console.error(
        `\nAuthentication problem talking to GitHub:\n${stderr.trim()}\n\n` +
          "Fix: run `gh auth login`, or export GH_TOKEN with a token that has\n" +
          "`repo` scope (classic) or Actions read/write (fine-grained).",
      );
      process.exit(1);
    }
    throw err;
  }
}

async function ghJson<T>(args: string[]): Promise<T> {
  return JSON.parse(await gh(args)) as T;
}

async function checkAuth(): Promise<void> {
  try {
    const login = (await gh(["api", "user", "--jq", ".login"])).trim();
    log(`Authenticated to GitHub as '${login}'.`);
  } catch (err: any) {
    console.error(
      "Could not authenticate with GitHub. Run `gh auth login` or set GH_TOKEN.\n" +
        (err?.stderr || err?.message || String(err)),
    );
    process.exit(1);
  }
  // Verify we can see the repo's Actions runs at all (scope check).
  try {
    await gh(["api", `repos/${REPO}/actions/runs?per_page=1`, "--jq", ".total_count"]);
  } catch (err: any) {
    console.error(
      `Cannot read Actions runs for ${REPO}. The token likely lacks access or scope\n` +
        "(need `repo` scope / Actions read-write on this repository).\n" +
        (err?.stderr || err?.message || String(err)),
    );
    process.exit(1);
  }
}

/**
 * Describe where a run currently is: its in-progress job and step, e.g.
 * "job 'deploy' › step 3/7: Upload artifact". Falls back gracefully.
 */
async function describeRunProgress(runId: number): Promise<string> {
  let jobs: WorkflowJob[];
  try {
    ({ jobs } = await ghJson<{ jobs: WorkflowJob[] }>([
      "api",
      `repos/${REPO}/actions/runs/${runId}/jobs?per_page=50`,
    ]));
  } catch {
    return "(job details unavailable)";
  }
  if (!jobs || jobs.length === 0) return "(no jobs yet)";

  const done = jobs.filter((j) => j.status === "completed").length;
  const activeJob = jobs.find((j) => j.status === "in_progress");
  if (!activeJob) {
    const queued = jobs.find((j) => j.status === "queued" || j.status === "waiting");
    if (queued) return `job '${queued.name}' ${queued.status} (${done}/${jobs.length} jobs done)`;
    return `${done}/${jobs.length} jobs done`;
  }

  const steps = activeJob.steps || [];
  const activeStep = steps.find((s) => s.status === "in_progress");
  if (activeStep) {
    return `job '${activeJob.name}' › step ${activeStep.number}/${steps.length}: ${activeStep.name}`;
  }
  const stepsDone = steps.filter((s) => s.status === "completed").length;
  return `job '${activeJob.name}' running (${stepsDone}/${steps.length} steps done)`;
}

/** Log progress of queued/in-progress runs (change-only) and completions. */
async function pollProgress(): Promise<void> {
  const active: WorkflowRun[] = [];
  for (const status of ["queued", "in_progress"]) {
    try {
      const { workflow_runs } = await ghJson<{ workflow_runs: WorkflowRun[] }>([
        "api",
        `repos/${REPO}/actions/runs?status=${status}&per_page=50`,
      ]);
      active.push(...workflow_runs);
    } catch (err: any) {
      log(`WARN: could not list ${status} runs: ${(err?.stderr || err?.message || "").trim()}`);
    }
  }

  const activeIds = new Set(active.map((r) => r.id));

  // Completion: previously-tracked runs no longer queued/in-progress.
  for (const [runId, info] of trackedRuns) {
    if (activeIds.has(runId)) continue;
    trackedRuns.delete(runId);
    try {
      const run = await ghJson<WorkflowRun & { conclusion: string | null }>([
        "api",
        `repos/${REPO}/actions/runs/${runId}`,
      ]);
      if (run.status === "completed") {
        const c = (run.conclusion || "unknown").toUpperCase();
        log(`DONE [${c}]: ${info.desc}`);
      } else {
        // e.g. moved back to 'waiting' on another approval gate
        log(`RUN now '${run.status}': ${info.desc}`);
      }
    } catch {
      log(`DONE (conclusion unavailable): ${info.desc}`);
    }
  }

  for (const run of active) {
    if (stopping) return;
    const desc = `"${run.display_title}" (${run.name}, branch ${run.head_branch}) ${run.html_url}`;
    const progress = run.status === "queued" ? "queued" : await describeRunProgress(run.id);
    const line = `${run.status}: ${progress}`;
    const prev = trackedRuns.get(run.id);
    if (!prev || prev.lastLine !== line) {
      trackedRuns.set(run.id, { lastLine: line, desc });
      log(`RUN ${line} — ${desc}`);
    }
  }
}

async function pollOnce(): Promise<void> {
  const { workflow_runs: runs } = await ghJson<{ workflow_runs: WorkflowRun[] }>([
    "api",
    `repos/${REPO}/actions/runs?status=waiting&per_page=50`,
  ]);

  await pollProgress();

  if (runs.length === 0) {
    if (trackedRuns.size === 0) log("No workflow runs waiting on approval or in progress.");
    return;
  }

  log(`${runs.length} workflow run(s) in 'waiting' state.`);

  for (const run of runs) {
    if (stopping) return;
    if (approvedRuns.has(run.id)) continue;

    let pending: PendingDeployment[];
    try {
      pending = await ghJson<PendingDeployment[]>([
        "api",
        `repos/${REPO}/actions/runs/${run.id}/pending_deployments`,
      ]);
    } catch (err: any) {
      log(`WARN: could not fetch pending deployments for run ${run.id}: ${(err?.stderr || err?.message || "").trim()}`);
      continue;
    }

    if (pending.length === 0) continue;

    const envNames = pending.map((p) => p.environment.name);
    const runDesc = `"${run.display_title}" (${run.name}, branch ${run.head_branch}) ${run.html_url}`;

    // HARD SAFETY RULE: every pending deployment must target Development.
    const disallowed = envNames.filter((n) => n !== ALLOWED_ENVIRONMENT);
    if (disallowed.length > 0) {
      const key = `${run.id}:env:${envNames.join(",")}`;
      if (!loggedSkips.has(key)) {
        loggedSkips.add(key);
        log(`SKIP (non-${ALLOWED_ENVIRONMENT} environment(s): ${disallowed.join(", ")}): ${runDesc}`);
      }
      continue;
    }

    const notApprovable = pending.filter((p) => !p.current_user_can_approve);
    if (notApprovable.length > 0) {
      const key = `${run.id}:cannot-approve`;
      if (!loggedSkips.has(key)) {
        loggedSkips.add(key);
        log(
          `SKIP (your user cannot approve — are you a required reviewer on '${ALLOWED_ENVIRONMENT}'?): ${runDesc}`,
        );
      }
      continue;
    }

    const environmentIds = [...new Set(pending.map((p) => p.environment.id))];
    try {
      const args = [
        "api",
        "--method",
        "POST",
        `repos/${REPO}/actions/runs/${run.id}/pending_deployments`,
        "-f",
        "state=approved",
        "-f",
        `comment=Auto-approved by sitespecific-freeman-autoapprove (${ALLOWED_ENVIRONMENT} only)`,
      ];
      for (const id of environmentIds) {
        args.push("-F", `environment_ids[]=${id}`);
      }
      await gh(args);
      approvedRuns.add(run.id);
      log(`APPROVED [${ALLOWED_ENVIRONMENT}]: ${runDesc}`);
    } catch (err: any) {
      const stderr = (err?.stderr || err?.message || "").trim();
      if (/422/.test(stderr)) {
        log(
          `FAILED to approve (HTTP 422 — token user is probably not a required reviewer on '${ALLOWED_ENVIRONMENT}'): ${runDesc}\n  ${stderr}`,
        );
      } else {
        log(`FAILED to approve: ${runDesc}\n  ${stderr}`);
      }
    }
  }
}

async function main(): Promise<void> {
  log(`Freeman auto-approver starting.`);
  log(`Repo: ${REPO}`);
  log(`Auto-approving environment: ${ALLOWED_ENVIRONMENT} ONLY (all others are skipped).`);
  log(`Poll interval: ${POLL_INTERVAL_SECONDS}s. Press Ctrl-C to stop.`);

  await checkAuth();

  const stop = () => {
    if (stopping) process.exit(130);
    stopping = true;
    log("Ctrl-C received — finishing current cycle and exiting. (Press again to force-quit.)");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopping) {
    try {
      await pollOnce();
    } catch (err: any) {
      log(`ERROR during poll: ${(err?.stderr || err?.message || String(err)).trim()}`);
    }
    if (stopping) break;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, POLL_INTERVAL_SECONDS * 1000);
      const onStop = () => {
        clearTimeout(t);
        resolve();
      };
      process.once("SIGINT", onStop);
      process.once("SIGTERM", onStop);
    });
  }

  log("Stopped.");
  process.exit(0);
}

main();
