/**
 * "Waiting on a restart" tracking (Task #1258).
 *
 * The Environment Variables page classifies each variable by when a change to
 * it takes effect. That classification answers "would a change need a
 * restart?"; the Restart & Reload page needs the stronger question, "has one
 * changed since this process started?".
 *
 * So at boot we take a baseline of the effective value of every variable that
 * is classified restart-only, and later compare against it. Only variables
 * whose effective value actually differs are reported as waiting.
 *
 * Values are hashed, never stored: many of these variables are secrets, and
 * this module only ever needs to answer "same or different".
 *
 * The list of variables to watch is drawn entirely from the existing
 * per-variable classification — there is no hand-maintained list here.
 */
import { createHash } from "node:crypto";
import {
  getEnvironmentVariable,
  listEnvironmentVariables,
} from "../config/env-registry";

/** Sentinel distinguishing "unset" from a value that happens to be empty. */
const UNSET = "\u0000unset";

let baseline: Map<string, string> | null = null;

function hashValue(name: string): string {
  let value: string | undefined;
  try {
    value = getEnvironmentVariable(name);
  } catch {
    // A required-but-unset variable throws from the getter. Treat that the
    // same as unset: the comparison only cares whether it changed.
    value = undefined;
  }
  if (value === undefined || value === "") return UNSET;
  return createHash("sha256").update(value).digest("hex");
}

function restartClassifiedNames(): string[] {
  return listEnvironmentVariables()
    .filter((v) => v.changeTakesEffect === "restart")
    .map((v) => v.name);
}

/**
 * Capture the baseline. Call once from the boot sequence, AFTER the in-app
 * override map is installed — an override present at boot is part of what the
 * running process is using, not a pending change.
 */
export function captureRestartBaseline(): void {
  const next = new Map<string, string>();
  for (const name of restartClassifiedNames()) {
    next.set(name, hashValue(name));
  }
  baseline = next;
}

export interface PendingRestartVariable {
  name: string;
  description: string;
  category: string;
  secret: boolean;
  /** "changed" when the value differs from boot, "added"/"removed" at edges. */
  change: "added" | "changed" | "removed";
}

/**
 * Registered variables classified restart-only whose effective value differs
 * from the one this process started with. Returns an empty list when no
 * baseline was captured (e.g. a boot that failed before this point) — an
 * unknown answer must not be shown as "everything is pending".
 */
export function listPendingRestartVariables(): PendingRestartVariable[] {
  if (!baseline) return [];
  const declarations = new Map(
    listEnvironmentVariables().map((v) => [v.name, v] as const),
  );

  const pending: PendingRestartVariable[] = [];
  for (const name of restartClassifiedNames()) {
    const before = baseline.get(name);
    // A variable registered after the baseline was taken has nothing to
    // compare against; it cannot be "waiting" on anything.
    if (before === undefined) continue;
    const now = hashValue(name);
    if (now === before) continue;

    const declaration = declarations.get(name);
    pending.push({
      name,
      description: declaration?.description ?? "",
      category: declaration?.category ?? "core",
      secret: declaration?.secret ?? true,
      change:
        before === UNSET ? "added" : now === UNSET ? "removed" : "changed",
    });
  }
  return pending;
}

/** Whether a baseline exists, so callers can say "unknown" rather than "none". */
export function hasRestartBaseline(): boolean {
  return baseline !== null;
}
