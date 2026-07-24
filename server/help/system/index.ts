import type { Help } from "@shared/schema";
import { sanitizeHelpHtml } from "../sanitize";
import { likePatternMatches } from "../path-match";
import { trustProvidersHelp } from "./trust-providers";

/**
 * A "system" help entry ships as source code and is always present,
 * with no database row. IDs must be stable and prefixed with
 * `system:` so routes can recognize and protect them from mutation.
 * `paths` uses the same SQL-LIKE `%` wildcard semantics as DB entries.
 */
export interface SystemHelpEntry {
  id: `system:${string}`;
  paths: string[];
  summary: string;
  details?: string | null;
}

/** Shape returned to clients: a Help row plus a source discriminator. */
export type HelpWithSource = Help & { source: "system" | "config" };

const entries: SystemHelpEntry[] = [
  trustProvidersHelp,
];

function toHelp(entry: SystemHelpEntry): HelpWithSource {
  return {
    id: entry.id,
    paths: entry.paths,
    summary: entry.summary,
    details:
      typeof entry.details === "string" ? sanitizeHelpHtml(entry.details) : null,
    data: null,
    source: "system",
  };
}

const registry = new Map<string, HelpWithSource>();
for (const entry of entries) {
  if (!entry.id.startsWith("system:")) {
    throw new Error(`System help entry id must start with "system:": ${entry.id}`);
  }
  if (registry.has(entry.id)) {
    throw new Error(`Duplicate system help entry id: ${entry.id}`);
  }
  registry.set(entry.id, toHelp(entry));
}

export function isSystemHelpId(id: string): boolean {
  return id.startsWith("system:");
}

export function getSystemHelp(id: string): HelpWithSource | undefined {
  return registry.get(id);
}

export function getAllSystemHelps(): HelpWithSource[] {
  return [...registry.values()].sort((a, b) => a.summary.localeCompare(b.summary));
}

export function findSystemHelpsForPath(path: string): HelpWithSource[] {
  return getAllSystemHelps().filter((help) =>
    help.paths.some((pattern) => likePatternMatches(pattern, path))
  );
}
