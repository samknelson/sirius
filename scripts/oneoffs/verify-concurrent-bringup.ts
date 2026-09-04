/**
 * One-off proof that two tasks booting at once do not wedge each other.
 *
 * The deployed topology runs one image as two ECS services against a single
 * database and a rollout restarts both at the same instant. The claim under
 * test is that the schema bring-up serializes: exactly one process
 * classifies/bootstraps/migrates, the other waits and then verifies rather
 * than re-applying, and BOTH finish.
 *
 * This cannot live in `tests/` — it needs a live database and two real OS
 * processes racing each other, which is exactly the thing a unit test cannot
 * fake. Run it by hand against a dev database.
 *
 * Usage:
 *   npx tsx scripts/oneoffs/verify-concurrent-bringup.ts            # current schema
 *   npx tsx scripts/oneoffs/verify-concurrent-bringup.ts --pending  # one pending migration
 *   npx tsx scripts/oneoffs/verify-concurrent-bringup.ts --timeout  # holder never lets go
 *   npx tsx scripts/oneoffs/verify-concurrent-bringup.ts --stall    # migration outlives its deadline
 *
 * `--pending` registers a synthetic core migration one version above the
 * highest registered one, whose `up()` inserts a marker variable named after
 * the process that ran it. Two processes race for it; the proof is that
 * exactly ONE marker exists afterwards. The stored `migrations_version` and
 * every marker are restored/removed before the script exits, so the database
 * is left exactly as it was found.
 *
 * `--timeout` proves the other half of the promise: a task that CANNOT get
 * the lock stops instead of hanging. The parent takes the bring-up lock and
 * keeps it, then boots one child with a two-second lock deadline; the child
 * must fail, name `bringup-lock` as its blocker, and exit.
 *
 * `--stall` proves the nastiest case. A step deadline bounds the WAIT, not
 * the work: when it fires, the migration it gave up on may still be running.
 * A child is given a migration that sleeps far past its step deadline, and
 * the proof is that after the child has already reported failure it is STILL
 * holding the bring-up lock — so no second task can start migrating
 * alongside the abandoned run — and that the lock becomes available the
 * moment that process dies.
 *
 * The child processes run ONLY the bring-up phase (not app-init), because
 * that phase is what is being serialized.
 */

import { getRawProcessEnv } from "../../server/config/env-registry";

const SCRIPT = "scripts/oneoffs/verify-concurrent-bringup.ts";
const RESULT_TAG = "BRINGUP_PROOF_RESULT ";
const PROBE_PREFIX = "concurrent_bringup_probe_";
const MIGRATIONS_VARIABLE = "migrations_version";
const STATE_VARIABLE = "bringup_state";

const childRole = process.argv.find((a) => a.startsWith("--child="))?.slice("--child=".length);
const withPending = process.argv.includes("--pending");
const timeoutScenario = process.argv.includes("--timeout");
const stallScenario = process.argv.includes("--stall");
const stallMs = Number(
  process.argv.find((a) => a.startsWith("--stall-ms="))?.slice("--stall-ms=".length) ?? 30_000,
);

/** Everything the parent needs to judge one child's run. */
interface ChildResult {
  role: string;
  ok: boolean;
  concurrency: string;
  blockedOn: string | null;
  bootId: string;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runChild(role: string): Promise<void> {
  const { getBootIdentity } = await import("../../server/services/boot-identity");
  const { bootStatus } = await import("../../server/services/boot-status");
  const { registerMigration, getHighestCoreMigrationVersion } = await import(
    "../../server/services/migration-runner"
  );
  const { runSchemaBringUp } = await import("../../server/services/bringup");
  const { storage } = await import("../../server/storage");
  const { bootId } = getBootIdentity();

  if (withPending || stallScenario) {
    // Registered AFTER the bring-up module imported scripts/migrate, so it
    // lands on top of the real sequence. Writing a variable keeps the probe
    // schema-neutral: no table for the drift gate to object to.
    const storedVersion = Number((await storage.variables.getByName("migrations_version"))?.value ?? 0);
    registerMigration({
      version: Math.max(getHighestCoreMigrationVersion(), storedVersion) + 1,
      name: "concurrency-probe",
      description: "Proof migration: records which racing process actually ran it.",
      up: async () => {
        // The stall child's migration deliberately outlives its step deadline,
        // standing in for a migration blocked on a lock or simply slow.
        if (stallScenario) await sleep(stallMs);
        await storage.variables.create({
          name: `${PROBE_PREFIX}${bootId}`,
          value: { role, ranAt: new Date().toISOString() },
        });
      },
    });
  }

  let ok = true;
  let error: string | undefined;
  try {
    await runSchemaBringUp();
  } catch (err) {
    ok = false;
    error = err instanceof Error ? err.message : String(err);
  }

  process.stdout.write(
    `\n${RESULT_TAG}${JSON.stringify({
      role,
      ok,
      concurrency: bootStatus.bringUpConcurrency,
      blockedOn: bootStatus.blockedOn,
      bootId,
      error,
    } satisfies ChildResult)}\n`,
  );

  if (stallScenario) {
    // Stay alive exactly like the real thing: a task whose boot failed keeps
    // running and keeps answering "not ready". That is what makes holding the
    // lock meaningful, and it is what the parent is about to test. The parent
    // kills this process when it is done looking.
    setInterval(() => {}, 1_000);
    return;
  }
  // The pool keeps the loop alive; the child's job is done either way.
  process.exit(ok ? 0 : 1);
}

/** Spawn one child and resolve with its reported result (or null). */
function spawnChild(
  spawnFn: typeof import("node:child_process").spawn,
  role: string,
  extraArgs: string[],
  extraEnv: Record<string, string> = {},
): {
  result: Promise<ChildResult | null>;
  reported: Promise<ChildResult | null>;
  kill: () => void;
  closed: Promise<number | null>;
} {
  const child = spawnFn("npx", ["tsx", SCRIPT, `--child=${role}`, ...extraArgs], {
    env: { ...getRawProcessEnv(), ...extraEnv },
    // Own process group. `npx` is a shim: it spawns node as ITS child, so
    // signalling the shim alone leaves the real process running and holding
    // the stdout pipe open — the close event would never arrive.
    detached: true,
  });
  let out = "";
  let announce: (r: ChildResult | null) => void = () => {};
  const reported = new Promise<ChildResult | null>((resolve) => (announce = resolve));
  const parse = (): ChildResult | null => {
    const line = out.split("\n").find((l) => l.startsWith(RESULT_TAG));
    return line ? (JSON.parse(line.slice(RESULT_TAG.length)) as ChildResult) : null;
  };
  const capture = (buf: Buffer) => {
    out += buf.toString();
    const parsed = parse();
    if (parsed) announce(parsed);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const closed = new Promise<number | null>((resolve) => {
    child.on("close", (code) => {
      announce(parse());
      resolve(code);
    });
  });
  const result = closed.then(() => {
    const parsed = parse();
    if (!parsed) console.log(out.split("\n").slice(-25).join("\n"));
    return parsed;
  });
  const kill = () => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  };
  return { result, reported, kill, closed };
}

/**
 * Hold the lock and let one child run out of patience. Proves the failure is
 * bounded, attributed, and terminal — the thing that was missing when a UAT
 * task sat in "initializing" behind a load balancer that kept routing to it.
 */
async function runTimeoutScenario(): Promise<void> {
  const { spawn } = await import("node:child_process");
  const { storage } = await import("../../server/storage");
  const { BRINGUP_LOCK_NAME } = await import("../../server/services/bringup-lock");

  const holder = await storage.advisoryLock.tryAcquireSession(BRINGUP_LOCK_NAME, {
    timeoutMs: 5_000,
  });
  if (!holder) throw new Error("could not take the bring-up lock to hold it");
  console.log("[parent] holding the bring-up lock; booting one child with a 2s deadline");

  const child = spawnChild(spawn, "T", [], { BRINGUP_LOCK_TIMEOUT_MS: "2000" });
  const result = await child.result;
  console.log(`[parent] child exited with code ${await child.closed}`);
  await holder.release();

  const failures: string[] = [];
  if (!result) failures.push("the child produced no result — did it exit at all?");
  else {
    console.log(
      `[parent] child: ok=${result.ok} concurrency=${result.concurrency} ` +
        `blockedOn=${result.blockedOn} error=${result.error}`,
    );
    if (result.ok) failures.push("the child must FAIL when it cannot get the lock");
    if (result.concurrency !== "lock-timeout") {
      failures.push(`expected concurrency=lock-timeout, got ${result.concurrency}`);
    }
    if (result.blockedOn !== "bringup-lock") {
      failures.push(`expected blockedOn=bringup-lock, got ${result.blockedOn}`);
    }
  }
  finish(failures, "an unavailable lock ends the boot with a named blocker.");
}

/**
 * A migration that outlives its step deadline. The boot must stop — and must
 * NOT hand the lock over, because the migration it abandoned may still be
 * running and a second task starting the same migrations alongside it is the
 * exact race the lock exists to prevent.
 */
async function runStallScenario(): Promise<void> {
  const { spawn } = await import("node:child_process");
  const { storage } = await import("../../server/storage");
  const { BRINGUP_LOCK_NAME } = await import("../../server/services/bringup-lock");

  const before = await storage.variables.getByName(MIGRATIONS_VARIABLE);
  console.log(
    `[parent] booting one child with a 2s step deadline and a ${stallMs} ms migration`,
  );
  const child = spawnChild(spawn, "S", ["--stall", `--stall-ms=${stallMs}`], {
    BRINGUP_STEP_TIMEOUT_MS: "2000",
  });

  const failures: string[] = [];
  try {
    const result = await Promise.race([
      child.reported,
      sleep(90_000).then(() => {
        throw new Error("the stalled child never reported a result");
      }),
    ]);

    if (!result) failures.push("the child produced no result");
    else {
      console.log(
        `[parent] child: ok=${result.ok} concurrency=${result.concurrency} ` +
          `blockedOn=${result.blockedOn} error=${result.error}`,
      );
      if (result.ok) failures.push("a step that blows its deadline must fail the boot");
      if (result.blockedOn !== "migrations") {
        failures.push(`expected blockedOn=migrations, got ${result.blockedOn}`);
      }
    }

    // THE POINT: the failed child is still holding the lock, because the work
    // it gave up on may still be running.
    const stolen = await storage.advisoryLock.tryAcquireSession(BRINGUP_LOCK_NAME, {
      timeoutMs: 3_000,
    });
    if (stolen) {
      await stolen.release();
      failures.push(
        "the lock was released while the timed-out migration may still be running — " +
          "another task could start migrating alongside it",
      );
    } else {
      console.log("[parent] the failed child still holds the lock, as it must");
    }
  } finally {
    // Killing it stands in for ECS replacing the task: the session dies, so
    // the database drops the lock and the next rollout is not wedged.
    child.kill();
    await child.closed;
  }

  const afterDeath = await storage.advisoryLock.tryAcquireSession(BRINGUP_LOCK_NAME, {
    timeoutMs: 10_000,
  });
  if (!afterDeath) {
    failures.push("the lock was NOT released when the holding process died — that would wedge");
  } else {
    console.log("[parent] the lock became free as soon as that process died");
    await afterDeath.release();
  }

  await cleanUpProbes(before);
  finish(failures, "a timed-out step fails the boot and keeps the lock until the process dies.");
}

/** Remove probe markers and restore the version the probe migration bumped. */
async function cleanUpProbes(
  before: { id: string; value: unknown } | undefined,
): Promise<void> {
  const { storage } = await import("../../server/storage");
  const markers = await storage.variables.getByNamePrefix(PROBE_PREFIX);
  for (const marker of markers) await storage.variables.delete(marker.id);
  if (before) {
    const now = await storage.variables.getByName(MIGRATIONS_VARIABLE);
    if (JSON.stringify(now?.value ?? null) !== JSON.stringify(before.value)) {
      await storage.variables.update(before.id, { value: before.value });
    }
  }
  if (markers.length > 0 || before) {
    console.log(
      `[parent] restored ${MIGRATIONS_VARIABLE} to ${JSON.stringify(before?.value ?? null)} ` +
        `and removed ${markers.length} probe marker(s)`,
    );
  }
}

function finish(failures: string[], claim: string): never {
  if (failures.length > 0) {
    console.error("\nFAIL");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\nPASS — ${claim}`);
  process.exit(0);
}

async function runParent(): Promise<void> {
  if (timeoutScenario) return runTimeoutScenario();
  if (stallScenario) return runStallScenario();
  const { spawn } = await import("node:child_process");
  const { storage } = await import("../../server/storage");

  const before = await storage.variables.getByName(MIGRATIONS_VARIABLE);
  console.log(
    `[parent] scenario: ${withPending ? "ONE PENDING MIGRATION" : "SCHEMA ALREADY CURRENT"}`,
  );
  console.log(`[parent] ${MIGRATIONS_VARIABLE} before: ${JSON.stringify(before?.value ?? null)}`);

  const failures: string[] = [];
  const extra = withPending ? ["--pending"] : [];

  // Both at once — the whole point.
  const children = [spawnChild(spawn, "A", extra), spawnChild(spawn, "B", extra)];
  const settled = await Promise.all(
    children.map(async (c) => ({ result: await c.result, code: await c.closed })),
  );
  const results: ChildResult[] = [];
  for (const { result, code } of settled) {
    if (!result) {
      failures.push(`a child produced no result line (exit ${code})`);
      continue;
    }
    results.push(result);
    console.log(
      `[parent] child ${result.role}: exit=${code} ok=${result.ok} ` +
        `concurrency=${result.concurrency} blockedOn=${result.blockedOn ?? "-"}` +
        (result.error ? ` error=${result.error}` : ""),
    );
  }

  try {
    // 1. Both tasks reached ready.
    if (results.length !== 2 || !results.every((r) => r.ok)) {
      failures.push("both processes must complete the bring-up; at least one did not");
    }

    // 2. Exactly one did the work; the other waited for it.
    const outcomes = results.map((r) => r.concurrency).sort();
    const soleCount = outcomes.filter((o) => o === "sole").length;
    const waiterCount = outcomes.filter(
      (o) => o === "waited-and-proceeded" || o === "deferred-to-peer",
    ).length;
    if (soleCount !== 1 || waiterCount !== 1) {
      failures.push(
        `expected one "sole" run and one waiter, got [${outcomes.join(", ")}]. ` +
          "Two 'sole' runs means the lock did not serialize them.",
      );
    }

    // 3. The pending migration ran exactly once.
    if (withPending) {
      const markers = await storage.variables.getByNamePrefix(PROBE_PREFIX);
      if (markers.length !== 1) {
        failures.push(
          `the probe migration ran ${markers.length} time(s); it must run exactly once`,
        );
      } else {
        console.log(
          `[parent] probe migration ran once, by ${markers[0].name.slice(PROBE_PREFIX.length)}`,
        );
      }
      // 4. And the waiter did NOT re-apply it.
      const deferred = results.find((r) => r.concurrency === "deferred-to-peer");
      const waited = results.find((r) => r.concurrency === "waited-and-proceeded");
      if (!deferred && !waited) failures.push("no process reported waiting for the other");
    } else {
      // With nothing pending, the waiter must recognize there is nothing to do.
      if (!results.some((r) => r.concurrency === "deferred-to-peer")) {
        failures.push(
          "on an already-current schema the waiter must report deferred-to-peer " +
            `(got [${outcomes.join(", ")}])`,
        );
      }
    }

    const after = await storage.variables.getByName(MIGRATIONS_VARIABLE);
    console.log(`[parent] ${MIGRATIONS_VARIABLE} after: ${JSON.stringify(after?.value ?? null)}`);
    const state = await storage.variables.getByName(STATE_VARIABLE);
    console.log(`[parent] ${STATE_VARIABLE}: ${JSON.stringify(state?.value ?? null)}`);
  } finally {
    // Leave the database exactly as found.
    await cleanUpProbes(withPending ? before : undefined);
  }

  finish(failures, "both processes booted; the bring-up ran exactly once.");
}

void (childRole ? runChild(childRole) : runParent());
