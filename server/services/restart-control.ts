/**
 * Restart control (Task #1258).
 *
 * A process can only ever end itself. "Restart" therefore means: shut down
 * cleanly, exit, and trust whatever supervises the container to start a fresh
 * process. This module owns the two decisions that follow from that —
 *
 *   1. the exit code, and
 *   2. what the operator is told will happen when they press the button —
 *
 * and performs the shutdown itself. The prediction is computed from the
 * structured {@link ContainerFacts}, never from the status plugin's rendered
 * strings.
 *
 * ---------------------------------------------------------------------------
 * EXIT CODE DECISION
 * ---------------------------------------------------------------------------
 * We exit NON-ZERO, with the dedicated code 75.
 *
 * The choice is driven entirely by Docker's restart policies, because they are
 * the only ones that read the code at all:
 *
 *   - `--restart on-failure`      restarts ONLY on a non-zero exit. A clean
 *                                 exit 0 would leave the site down until
 *                                 someone started it by hand. This is the
 *                                 case that decides the question.
 *   - `--restart always`          restarts either way.
 *   - `--restart unless-stopped`  restarts either way.
 *   - `--restart no` (default)    never restarts — no code helps.
 *   - Amazon ECS services         replace a stopped task either way; the exit
 *                                 code only shows up in the stop reason.
 *   - Kubernetes (restartPolicy   restarts either way under the default
 *     Always)                     Always; `OnFailure` needs the non-zero code
 *                                 for the same reason as Docker.
 *
 * Non-zero is therefore strictly better: it restarts under every policy that
 * a zero exit restarts under, plus the two failure-only ones.
 *
 * 75 rather than 1 because 1 is what a genuine crash exits with. 75 is the
 * conventional EX_TEMPFAIL ("temporary failure, try again"), which is exactly
 * what an operator-requested restart is, and it keeps an intentional restart
 * distinguishable from a crash in container logs and ECS stop reasons.
 *
 * The page's prediction text below is written against this code; the two must
 * be changed together.
 */
import type { Server } from "node:http";
import { logger } from "../logger";
import type { ContainerFacts } from "./container-facts";

/** See the exit-code decision above. Non-zero, and not the crash code. */
export const RESTART_EXIT_CODE = 75;

/** How long to wait for in-flight connections before forcing them closed. */
const HTTP_CLOSE_GRACE_MS = 5_000;

export interface RestartPrediction {
  /**
   * Whether a replacement process is expected. Mirrors the facts service's
   * `supervised`; null means undetermined.
   */
  willComeBack: boolean | null;
  /** One-line headline, e.g. "The app should come back on its own." */
  headline: string;
  /** Plain-English paragraphs describing what pressing Restart will do here. */
  paragraphs: string[];
  /**
   * True when supervision could not be established and the operator must type
   * {@link RESTART_CONFIRM_PHRASE} before the button arms.
   */
  requiresTypedConfirmation: boolean;
  /** The exit code this process will use, so the page can state it. */
  exitCode: number;
}

/** What an operator must type when supervision cannot be established. */
export const RESTART_CONFIRM_PHRASE = "RESTART";

/**
 * Turn the structured facts into the prediction shown above the Restart
 * button. Every branch is decided from `facts`, never from rendered text.
 */
export function buildRestartPrediction(facts: ContainerFacts): RestartPrediction {
  const paragraphs: string[] = [];

  paragraphs.push(
    `Pressing Restart shuts this process down cleanly and exits with code ${RESTART_EXIT_CODE}. ` +
      "Nothing inside the application can start it again — only whatever is supervising " +
      "the container can do that.",
  );

  // The supervision reason already makes this point when a platform signal
  // was overridden by it, so only raise it separately otherwise. Decided from
  // the structured flag, never by inspecting the reason text.
  if (!facts.isPid1 && !facts.supervisionPid1Downgraded) {
    paragraphs.push(
      `This process is not the container's entry process (it is process ${facts.pid}). ` +
        "Ending it may not end the container, in which case no supervisor will notice and " +
        "no replacement will be started.",
    );
  }

  paragraphs.push(facts.supervisionReason);

  if (facts.siblingInstancesPossible === true) {
    paragraphs.push(
      `${facts.siblingReason} To apply a change everywhere, use your orchestrator to ` +
        "replace all instances instead.",
    );
  }

  paragraphs.push(
    "Work in progress is not drained. Cron jobs, imports and other background work running " +
      "at that moment are interrupted, and anyone using the site sees an error until the new " +
      "process is serving.",
  );

  let headline: string;
  if (facts.supervised === true) {
    headline = "The app should come back on its own.";
    paragraphs.push(
      "Expect the site to be unavailable for a few seconds while the replacement process " +
        "boots, runs migrations and passes the schema check.",
    );
  } else {
    headline = "The app may not come back until someone starts it.";
    paragraphs.push(
      "Because that cannot be established from inside the process, treat this as a one-way " +
        "action: if nothing is supervising this container, the site stays down until it is " +
        "started again by hand or redeployed.",
    );
  }

  return {
    willComeBack: facts.supervised,
    headline,
    paragraphs,
    requiresTypedConfirmation: facts.supervised !== true,
    exitCode: RESTART_EXIT_CODE,
  };
}

/**
 * Server-side enforcement of the typed confirmation.
 *
 * The confirmation is a safety gate, not a UI flourish, so it is decided and
 * checked HERE — the page's input box is merely how a browser satisfies it.
 * A direct API call, a stale client built before the gate existed, or a page
 * left open while the environment changed must all be refused in exactly the
 * cases the prediction says need acknowledging.
 *
 * PURE, and takes the same structured facts the prediction is built from, so
 * the two can never disagree about whether confirmation was required.
 */
export function checkRestartConfirmation(
  facts: ContainerFacts,
  confirm: unknown,
): { ok: true } | { ok: false; message: string } {
  const { requiresTypedConfirmation } = buildRestartPrediction(facts);
  if (!requiresTypedConfirmation) return { ok: true };

  if (typeof confirm !== "string" || confirm.trim() !== RESTART_CONFIRM_PHRASE) {
    return {
      ok: false,
      message:
        `Supervision could not be established for this environment, so a restart must be ` +
        `confirmed explicitly: send "confirm": "${RESTART_CONFIRM_PHRASE}".`,
    };
  }
  return { ok: true };
}

/**
 * Shut down and exit. Closes the HTTP server, the WebSocket server and the
 * database pool, then exits with {@link RESTART_EXIT_CODE}.
 *
 * Every step is best-effort with a hard time limit: a shutdown that hangs is
 * strictly worse than an abrupt one, because the operator has already been
 * told the process is going away.
 */
export async function shutdownAndExit(server: Server | undefined): Promise<void> {
  logger.info("Restart requested — shutting down", {
    source: "restart",
    exitCode: RESTART_EXIT_CODE,
  });

  try {
    const { shutdown: shutdownWebsockets } = await import("./websocket");
    shutdownWebsockets();
  } catch (error) {
    logger.error("Failed to shut down the WebSocket server", {
      source: "restart",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (server) {
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timer = setTimeout(() => {
        // Keep-alive connections can hold `close()` open indefinitely.
        try {
          server.closeAllConnections?.();
        } catch {
          /* not fatal — we are exiting anyway */
        }
        done();
      }, HTTP_CLOSE_GRACE_MS);
      timer.unref?.();
      server.close(() => {
        clearTimeout(timer);
        done();
      });
    });
  }

  try {
    // Infrastructure access to the raw pool, as sanctioned by the storage
    // encapsulation rule: this is not a query, it is closing the connection
    // pool during shutdown, which the storage interface deliberately does not
    // expose. Lazy so the boot path never pulls the pool in through here.
    const { pool } = await import("../storage/db");
    await pool.end();
  } catch (error) {
    logger.error("Failed to close the database pool", {
      source: "restart",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info("Shutdown complete — exiting", {
    source: "restart",
    exitCode: RESTART_EXIT_CODE,
  });
  process.exit(RESTART_EXIT_CODE);
}
