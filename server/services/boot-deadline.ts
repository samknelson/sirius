/**
 * Bounded boot steps (Task #1350).
 *
 * The boot chain is a sequence of unbounded awaits, and the process
 * deliberately stays alive when it fails. Those two together produce the
 * worst outcome there is: a task that hangs forever in "initializing" while
 * the load balancer keeps it in rotation and the rollout is reported as
 * successful. A step that cannot make progress must END — visibly, naming
 * what it was waiting on — not wait.
 *
 * WHAT THIS DOES AND DOES NOT DO — read this before using it.
 *
 * It bounds the WAIT, not the work. Rejecting the race does not cancel the
 * query the step is blocked on, does not close a connection, and does not
 * stop the step from finishing later. After a timeout the step's work is in
 * an UNKNOWN state: possibly still running, possibly about to commit.
 *
 * Two obligations follow, and they are not optional:
 *
 *   1. a caller holding mutual exclusion (an advisory lock, a leader claim)
 *      around timed-out work must NOT release it. Releasing would let the
 *      next process start the same work while the abandoned attempt is still
 *      running — precisely the concurrency the lock exists to prevent. Hold
 *      it until the process itself dies, which is the only moment the work
 *      is provably over.
 *   2. the boot must treat the step as failed and stop. The value of the
 *      deadline is not that the work stops; it is that the BOOT stops
 *      pretending it is still starting, and instead reports a failure naming
 *      what it was waiting on.
 *
 * PURE LEAF: no imports, so the earliest boot code can use it.
 */

/**
 * A boot step exceeded its deadline. Carries the step name and what the step
 * was waiting on, because "boot timed out" alone tells an operator with no
 * shell on the target exactly nothing.
 */
export class BootStepTimeoutError extends Error {
  constructor(
    readonly step: string,
    readonly timeoutMs: number,
    readonly waitingOn: string,
  ) {
    super(
      `Boot step "${step}" gave up after ${timeoutMs} ms waiting on ${waitingOn}. ` +
        "The step made no progress within its deadline, so the boot fails here " +
        "rather than waiting indefinitely.",
    );
    this.name = "BootStepTimeoutError";
  }
}

/**
 * Run `fn` with a hard deadline. Resolves with its value, or rejects with
 * {@link BootStepTimeoutError} once `timeoutMs` has passed.
 *
 * A non-positive `timeoutMs` disables the deadline: an operator who has to
 * run one enormous migration on a redeploy needs an escape hatch that does
 * not require a new build.
 */
export async function withBootDeadline<T>(
  step: string,
  timeoutMs: number,
  waitingOn: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!(timeoutMs > 0)) return fn();

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new BootStepTimeoutError(step, timeoutMs, waitingOn)),
          timeoutMs,
        );
        // The deadline must never be the reason the process stays alive.
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
