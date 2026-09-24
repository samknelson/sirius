/**
 * Bring-up report (Task #1301).
 *
 * ONE contiguous, clearly delimited block describing everything the process
 * learned while bringing the schema up: which database it actually reached,
 * what state that database was in, the core and per-component migration
 * bookkeeping, what was pending, and how the drift gate ended. It is printed
 * on every boot — success or failure — before the app serves traffic, and it
 * is retrievable over HTTP from the init-failure page and /health under the
 * existing EXPOSE_BOOT_ERRORS control.
 *
 * WHY IT EXISTS. The operator of the target deployment has no shell there.
 * Their entire diagnostic surface is the deploy log and a browser. Before
 * this report, three completely different situations — migrations never
 * attempted, migrations attempted and failed, and a `migrations_version`
 * stamped AHEAD of the schema — all produced a byte-identical drift dump, so
 * there was no way to tell which repair was needed.
 *
 * PURE LEAF MODULE: no imports at all (not even the logger or the env
 * registry). `server/storage/db.ts` writes into it at module load and
 * `server/production-entry.ts` reads it before app-init has been loaded, so
 * it must be safe at both ends of the boot path. It only holds data and
 * formats strings; every value is supplied by the code that learns it.
 */

export type DatabaseState =
  | "empty"
  | "partially-initialized"
  | "initialized"
  | "unknown";

export type BringUpMode = "normal" | "report-only";

export interface BringUpDatabaseIdentity {
  /** Host the process actually connected to. Never credentials. */
  host: string;
  port: string;
  database: string;
  user: string;
  /** "pg" | "neon". */
  driver: string;
  /** Human-readable TLS mode, e.g. "encrypted, certificate NOT verified". */
  tls: string;
  /** Whether DATABASE_URL was given directly or assembled from DB_* parts. */
  urlSource: string;
}

export interface MigrationRef {
  version: number;
  name: string;
}

export interface ComponentMigrationInfo {
  componentId: string;
  /** Stored `component_schema_state_<id>.migrationVersion`, null when the variable is absent. */
  storedVersion: number | null;
  /** Highest registered per-component migration version (0 when none). */
  highestVersion: number;
  pending: MigrationRef[];
}

export interface BringUpReport {
  mode: BringUpMode;
  database: BringUpDatabaseIdentity | null;
  databaseState: DatabaseState;
  /** Tables in the public schema at classification time. */
  liveTableCount: number | null;
  /** True when this boot created the schema on an empty database. */
  bootstrapped: boolean;
  core: {
    /** Stored `migrations_version`, null when not read (e.g. empty database). */
    storedVersion: number | null;
    /** Highest registered ORDINARY core migration version. */
    highestRegisteredVersion: number;
    /** Highest registered BASELINE version (0 when none registered). */
    highestBaselineVersion: number;
    pending: MigrationRef[];
    /** Migrations applied during this boot, null when the runner did not run. */
    ran: number | null;
    resume: {
      requestedVersion: number;
      previousVersion: number;
      applied: boolean;
    } | null;
  };
  components: {
    enabledCount: number;
    schemaManaging: ComponentMigrationInfo[];
  } | null;
  drift: {
    status: "not-run" | "skipped" | "passed" | "failed";
    /** One line per drift item; empty when the gate passed. */
    summary: string[];
  };
  /** How this process's bring-up related to other tasks booting at once. */
  concurrency: BringUpConcurrencyInfo;
  /** Set when the bring-up phase threw; names the phase and quotes the error. */
  failure: { phase: string; message: string } | null;
}

/**
 * The outcome of contending for the schema bring-up lock (Task #1350).
 *
 * Kept as its own string union rather than imported from `boot-status.ts`:
 * both modules are pure leaves reached at different points of the boot, and
 * neither may grow an import. The two unions are intentionally the same
 * vocabulary so a reader comparing /health to the report sees one word.
 */
export type BringUpConcurrencyOutcome =
  | "not-run"
  | "unlocked-report-only"
  | "sole"
  | "waited-and-proceeded"
  | "deferred-to-peer"
  | "peer-failed"
  | "lock-timeout";

/** What another booting task recorded about ITS bring-up run. */
export interface BringUpPeerRun {
  status: "in-progress" | "succeeded" | "failed";
  /** Identifies the process that wrote it; not a hostname, just a boot id. */
  bootId: string;
  startedAt: string;
  finishedAt: string | null;
  /** Phase the peer was in when it failed. */
  phase: string | null;
  /** The peer's error message, verbatim. */
  error: string | null;
}

export interface BringUpConcurrencyInfo {
  outcome: BringUpConcurrencyOutcome;
  /** Milliseconds spent waiting for the lock; null when never attempted. */
  waitedMs: number | null;
  /** The peer run this process observed, when there was one. */
  peer: BringUpPeerRun | null;
  /** Free-form lines explaining what was skipped or re-verified, and why. */
  notes: string[];
}

const report: BringUpReport = {
  mode: "normal",
  database: null,
  databaseState: "unknown",
  liveTableCount: null,
  bootstrapped: false,
  core: {
    storedVersion: null,
    highestRegisteredVersion: 0,
    highestBaselineVersion: 0,
    pending: [],
    ran: null,
    resume: null,
  },
  components: null,
  drift: { status: "not-run", summary: [] },
  concurrency: { outcome: "not-run", waitedMs: null, peer: null, notes: [] },
  failure: null,
};

export function getBringUpReport(): BringUpReport {
  return report;
}

export function setBringUpMode(mode: BringUpMode): void {
  report.mode = mode;
}

export function recordDatabaseIdentity(identity: BringUpDatabaseIdentity): void {
  report.database = identity;
}

export function recordDatabaseState(state: DatabaseState, liveTableCount: number): void {
  report.databaseState = state;
  report.liveTableCount = liveTableCount;
}

export function recordDatabaseBootstrapped(): void {
  report.bootstrapped = true;
}

export function recordCoreMigrationStatus(status: {
  storedVersion: number;
  highestRegisteredVersion: number;
  highestBaselineVersion: number;
  pending: MigrationRef[];
}): void {
  report.core.storedVersion = status.storedVersion;
  report.core.highestRegisteredVersion = status.highestRegisteredVersion;
  report.core.highestBaselineVersion = status.highestBaselineVersion;
  report.core.pending = status.pending;
}

export function recordCoreMigrationRun(ran: number): void {
  report.core.ran = ran;
}

export function recordMigrationResume(resume: {
  requestedVersion: number;
  previousVersion: number;
  applied: boolean;
}): void {
  report.core.resume = resume;
}

export function recordComponentMigrationStatus(
  enabledCount: number,
  schemaManaging: ComponentMigrationInfo[],
): void {
  report.components = { enabledCount, schemaManaging };
}

export function recordDriftOutcome(
  status: BringUpReport["drift"]["status"],
  summary: string[],
): void {
  report.drift = { status, summary };
}

export function recordBringUpConcurrency(
  outcome: BringUpConcurrencyOutcome,
  details?: { waitedMs?: number | null; peer?: BringUpPeerRun | null },
): void {
  report.concurrency.outcome = outcome;
  if (details && "waitedMs" in details) report.concurrency.waitedMs = details.waitedMs ?? null;
  if (details && "peer" in details) report.concurrency.peer = details.peer ?? null;
}

export function recordBringUpConcurrencyNote(note: string): void {
  report.concurrency.notes.push(note);
}

export function recordBringUpFailure(phase: string, message: string): void {
  report.failure = { phase, message };
}

const WIDTH = 78;
const RULE = "=".repeat(WIDTH);

function section(lines: string[], title: string): void {
  lines.push("");
  lines.push(`-- ${title} ${"-".repeat(Math.max(0, WIDTH - title.length - 4))}`);
}

function describeState(state: DatabaseState): string {
  switch (state) {
    case "empty":
      return "EMPTY (no tables in the public schema)";
    case "partially-initialized":
      return "PARTIALLY INITIALIZED (tables present, but no `variables` table)";
    case "initialized":
      return "INITIALIZED (this app's `variables` table is present)";
    default:
      return "UNKNOWN (not classified)";
  }
}

function describeConcurrency(outcome: BringUpConcurrencyOutcome): string {
  switch (outcome) {
    case "unlocked-report-only":
      return "no lock taken (report-only writes nothing, so it cannot race)";
    case "sole":
      return "SOLE — the lock was free; this task did the bring-up alone";
    case "waited-and-proceeded":
      return "WAITED for another booting task, then did remaining work itself";
    case "deferred-to-peer":
      return "DEFERRED — another task brought the schema up; verified and skipped";
    case "peer-failed":
      return "PEER FAILED — another task's bring-up failed while this one waited";
    case "lock-timeout":
      return "TIMED OUT waiting for the lock (another task holds it, or died holding it)";
    default:
      return "not run";
  }
}

/**
 * Render the report as one contiguous block. Pure: safe to call from an
 * error path, from the HTTP layer, and before the logger exists.
 */
export function formatBringUpReport(): string {
  const r = report;
  const lines: string[] = [];
  lines.push(RULE);
  lines.push(
    `SCHEMA BRING-UP REPORT${r.mode === "report-only" ? "  [REPORT-ONLY — nothing was written]" : ""}`,
  );
  lines.push(RULE);

  section(lines, "Database");
  if (r.database) {
    lines.push(`  host:       ${r.database.host}:${r.database.port}`);
    lines.push(`  database:   ${r.database.database}`);
    lines.push(`  user:       ${r.database.user}`);
    lines.push(`  driver:     ${r.database.driver}`);
    lines.push(`  tls:        ${r.database.tls}`);
    lines.push(`  url source: ${r.database.urlSource}`);
  } else {
    lines.push("  (no connection was established — the URL could not be resolved)");
  }
  lines.push(`  state:      ${describeState(r.databaseState)}`);
  if (r.liveTableCount !== null) {
    lines.push(`  tables:     ${r.liveTableCount} in the public schema`);
  }
  if (r.bootstrapped) {
    lines.push("  bootstrap:  this boot CREATED the schema (ALLOW_EMPTY_DB_BOOTSTRAP=1)");
  }

  section(lines, "Core migrations (migrations_version)");
  lines.push(
    `  stored version:            ${r.core.storedVersion === null ? "(not read)" : r.core.storedVersion}`,
  );
  lines.push(`  highest registered:        ${r.core.highestRegisteredVersion}`);
  lines.push(
    `  highest baseline script:   ${r.core.highestBaselineVersion === 0 ? "(none registered)" : r.core.highestBaselineVersion}`,
  );
  if (r.core.resume) {
    lines.push(
      `  resume override:           MIGRATIONS_RESUME_FROM_VERSION=${r.core.resume.requestedVersion} ` +
        (!r.core.resume.applied
          ? `— no change (stored version was already ${r.core.resume.previousVersion})`
          : r.core.resume.requestedVersion < r.core.resume.previousVersion
            ? `— stored version LOWERED from ${r.core.resume.previousVersion} (migrations above it replay)`
            : `— stored version RAISED from ${r.core.resume.previousVersion} ` +
              `(migrations up to ${r.core.resume.requestedVersion} declared applied and will NEVER run here)`),
    );
  }
  if (r.core.pending.length === 0) {
    lines.push("  pending:                   none");
  } else {
    lines.push(`  pending (${r.core.pending.length}):`);
    for (const m of r.core.pending) lines.push(`    - ${m.version}  ${m.name}`);
  }
  lines.push(
    `  applied this boot:         ${r.core.ran === null ? "(runner did not run)" : r.core.ran}`,
  );

  section(lines, "Component migrations");
  if (!r.components) {
    lines.push("  (component cache was not loaded)");
  } else {
    lines.push(
      `  enabled components:        ${r.components.enabledCount} ` +
        `(${r.components.schemaManaging.length} schema-managing, listed below)`,
    );
    if (r.components.schemaManaging.length === 0) {
      lines.push("  (no enabled schema-managing component has registered migrations)");
    } else {
      for (const c of r.components.schemaManaging) {
        // null = the component has no schema-state variable yet, which is
        // normal for one whose migrations have never had to run.
        const stored = c.storedVersion === null ? "unstamped" : c.storedVersion;
        const pending =
          c.pending.length === 0
            ? "up to date"
            : `pending ${c.pending.map((m) => `${m.version}:${m.name}`).join(", ")}`;
        lines.push(`    - ${c.componentId}: at ${stored} of ${c.highestVersion} — ${pending}`);
      }
    }
  }

  section(lines, "Concurrent boot (schema bring-up lock)");
  lines.push(`  outcome: ${describeConcurrency(r.concurrency.outcome)}`);
  if (r.concurrency.waitedMs !== null) {
    lines.push(`  waited:  ${r.concurrency.waitedMs} ms for the lock`);
  }
  if (r.concurrency.peer) {
    const p = r.concurrency.peer;
    lines.push(
      `  peer:    boot ${p.bootId} ${p.status}` +
        (p.finishedAt ? ` at ${p.finishedAt}` : ` (started ${p.startedAt})`),
    );
    if (p.phase) lines.push(`           phase: ${p.phase}`);
    if (p.error) for (const line of p.error.split("\n")) lines.push(`           ${line}`);
  }
  for (const note of r.concurrency.notes) lines.push(`  ${note}`);

  section(lines, "Schema drift gate");
  lines.push(`  status: ${r.drift.status}`);
  for (const line of r.drift.summary) lines.push(`  ${line}`);

  if (r.failure) {
    section(lines, "BRING-UP FAILED");
    lines.push(`  phase: ${r.failure.phase}`);
    for (const line of r.failure.message.split("\n")) lines.push(`  ${line}`);
  }

  lines.push("");
  lines.push(RULE);
  return lines.join("\n");
}

let printed = false;

/**
 * Print the report to stdout exactly once per process.
 *
 * Deliberately `console.log` rather than the winston logger: the report's
 * whole job is to be readable when the database is the thing that is broken,
 * and the logger's primary transport writes to that same database. A single
 * write also keeps the block contiguous in the deploy log.
 */
export function printBringUpReport(): void {
  if (printed) return;
  printed = true;
  console.log("\n" + formatBringUpReport() + "\n");
}
