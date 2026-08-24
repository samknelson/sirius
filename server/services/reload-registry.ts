/**
 * Reloadable-subsystem registry (Task #1258).
 *
 * Backs the "Reload configuration" half of the admin Restart & Reload page.
 * Each entry declares an id, an operator-facing label, exactly what it
 * re-reads, and a function that re-reads it in place.
 *
 * The point of the registry is honesty. A subsystem is listed as reloadable
 * ONLY when re-running its initializer genuinely changes what the running
 * process does. Everything else is declared restart-only, with the reason
 * spelled out, so the page can never suggest a reload does more than it does.
 *
 * Reloadable entries also name the environment variables they make live.
 * Those names must be classified "reload" in the env registry — asserted by
 * {@link assertReloadClassificationConsistency}, so the Environment Variables
 * page and this page cannot disagree about whether a change needs a restart.
 */
import { listEnvironmentVariables } from "../config/env-registry";

export interface ReloadableSubsystem {
  /** Stable id used by the reload endpoint's selection. */
  id: string;
  /** Operator-facing name, e.g. "Filesystem registry". */
  label: string;
  /** Exactly what re-reading re-reads. Shown verbatim on the page. */
  reReads: string;
  /**
   * Registered environment variable names whose new value this reload makes
   * live. Empty when the subsystem re-reads database state rather than the
   * environment.
   */
  makesLive: string[];
  /** Re-read in place. Returns a short outcome summary for the result list. */
  reload: () => Promise<string>;
}

export interface RestartOnlySubsystem {
  id: string;
  label: string;
  /** What the subsystem is built from. */
  reReads: string;
  /** Why re-reading it in place is impossible or would change nothing. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Reloadable
// ---------------------------------------------------------------------------

const reloadable: ReloadableSubsystem[] = [
  {
    id: "env-overrides",
    label: "Environment override map",
    reReads:
      "The in-app environment overrides stored in the variables table, which supply " +
      "a value for any registered variable that is not set in the real environment.",
    makesLive: [],
    async reload() {
      const { refreshEnvOverrides, getEnvOverrideMap } = await import("./env-overrides");
      await refreshEnvOverrides();
      const count = getEnvOverrideMap().size;
      return `${count} override${count === 1 ? "" : "s"} loaded.`;
    },
  },
  {
    id: "filesystems",
    label: "Filesystem registry",
    reReads:
      "The FILESYSTEMS environment variable. Configured filesystems are re-parsed and " +
      "every cached provider is dropped, so the next file operation builds a fresh one.",
    makesLive: ["FILESYSTEMS"],
    async reload() {
      const { initFileSystems, listFileSystemConfigs } = await import("./files");
      const { storage } = await import("../storage");
      const referencedIds = await storage.files.listDistinctFileSystemIds();
      initFileSystems(referencedIds);
      const count = listFileSystemConfigs().length;
      return `${count} filesystem${count === 1 ? "" : "s"} configured.`;
    },
  },
  {
    id: "cron",
    label: "Cron schedule",
    reReads:
      "Every enabled cron plugin configuration. Scheduled jobs are stopped and " +
      "re-registered from the current configuration.",
    makesLive: [],
    async reload() {
      const { cronScheduler } = await import("../cron/scheduler");
      await cronScheduler.reload();
      const count = cronScheduler.getScheduledJobCount();
      return `${count} job${count === 1 ? "" : "s"} scheduled.`;
    },
  },
];

// ---------------------------------------------------------------------------
// Restart-only
//
// Listed so the page can say WHY these are absent from the reload list rather
// than leaving an operator to guess. The authentication entries are the
// interesting case: the loaded auth configuration IS memoized at boot, but
// nothing reads that memo again once the session middleware is mounted and
// the providers are registered, so clearing the cache would change nothing at
// all. Listing it as reloadable would be a lie of the most convincing kind.
// ---------------------------------------------------------------------------

const restartOnly: RestartOnlySubsystem[] = [
  {
    id: "module-constants",
    label: "Values captured at module load",
    reReads:
      "The listening port, the database connection and driver, and the runtime mode.",
    reason:
      "These are read once, when the module that uses them is first loaded, and become " +
      "constants for the life of the process. A module load cannot be re-run in place.",
  },
  {
    id: "auth-providers",
    label: "Authentication provider wiring",
    reReads: "The enabled provider list and each provider's credentials.",
    reason:
      "The provider list is resolved during boot and each provider installs its own " +
      "routes and strategies on the running Express app. Re-reading the configuration " +
      "would not unregister or re-register any of them. SAML is the exception: its " +
      "entry point, issuer and certificate are re-read on every sign-in, so changes to " +
      "those already apply immediately without any action here.",
  },
  {
    id: "session",
    label: "Session middleware",
    reReads: "The session signing secret, the session lifetime, and the session store.",
    reason:
      "The session middleware is constructed once and mounted on the Express app during " +
      "boot. A new secret or lifetime can only be picked up by a process that builds the " +
      "middleware afresh.",
  },
];

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export function listReloadableSubsystems(): readonly ReloadableSubsystem[] {
  return reloadable;
}

export function listRestartOnlySubsystems(): readonly RestartOnlySubsystem[] {
  return restartOnly;
}

export function getReloadableSubsystem(id: string): ReloadableSubsystem | undefined {
  return reloadable.find((entry) => entry.id === id);
}

/** Every environment variable name made live by some reloadable subsystem. */
export function listReloadableVariableNames(): string[] {
  return Array.from(new Set(reloadable.flatMap((entry) => entry.makesLive))).sort();
}

export interface ReloadResult {
  id: string;
  label: string;
  ok: boolean;
  /** Outcome summary on success, error message on failure. */
  message: string;
  durationMs: number;
}

/**
 * Run the given subsystems (all of them when `ids` is omitted), in registry
 * order. One failing subsystem never stops the others — the operator gets a
 * per-entry result and can see exactly which re-read worked.
 */
export async function runReloads(ids?: string[]): Promise<ReloadResult[]> {
  const selected = ids
    ? ids
        .map((id) => getReloadableSubsystem(id))
        .filter((entry): entry is ReloadableSubsystem => entry !== undefined)
    : reloadable;

  const results: ReloadResult[] = [];
  for (const entry of selected) {
    const startedAt = Date.now();
    try {
      const message = await entry.reload();
      results.push({
        id: entry.id,
        label: entry.label,
        ok: true,
        message,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      results.push({
        id: entry.id,
        label: entry.label,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      });
    }
  }
  return results;
}

/**
 * Boot gate keeping the two surfaces in step: a variable classified "reload"
 * must be named by a reloadable subsystem, and a variable named by one must
 * be classified "reload". Either mismatch means the Environment Variables
 * page and the Restart & Reload page would tell an operator different things
 * about the same variable, so refuse to boot instead.
 */
export function assertReloadClassificationConsistency(): void {
  const named = new Set(listReloadableVariableNames());
  const classified = new Set(
    listEnvironmentVariables()
      .filter((v) => v.changeTakesEffect === "reload")
      .map((v) => v.name),
  );

  const problems: string[] = [];
  for (const name of Array.from(named)) {
    if (!classified.has(name)) {
      problems.push(
        `${name} is named by a reloadable subsystem but is not classified "reload" in the env registry`,
      );
    }
  }
  for (const name of Array.from(classified)) {
    if (!named.has(name)) {
      problems.push(
        `${name} is classified "reload" in the env registry but no reloadable subsystem names it`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Reloadable-subsystem / environment-variable classification mismatch:\n  - ${problems.join(
        "\n  - ",
      )}`,
    );
  }
}
