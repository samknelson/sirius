/**
 * Shared catalog framework — declaration and registration.
 *
 * Registration is open during startup and closed once startup finishes. The
 * closed set carries a version so anything derived from a catalog can tell when
 * it has gone stale.
 */

import { getCatalogComponentRevision } from "./component";
import type { CatalogAudience, CatalogDefinition } from "./types";

const AUDIENCES: readonly CatalogAudience[] = ["signed-out", "signed-in", "gated"];

const catalogs = new Map<string, CatalogDefinition>();

/**
 * Bumped on every registration and on close. Folded into
 * {@link getCatalogVersion} alongside the component revision, because a
 * catalog's contents depend on both what is registered and what is switched on.
 */
let registrationEpoch = 0;

let closed = false;

/**
 * Distinguishes this process from any other.
 *
 * The registration epoch alone is a count, and the same code booted twice
 * produces the same count. That is fine within a process but useless to an HTTP
 * cache across a deploy: change a catalog's labels, permissions or detail
 * without changing how many catalogs there are, and the version is byte-for-byte
 * what it was before, so a validating cache serves the old answer. A per-process
 * identity means a deploy always invalidates. A plain restart invalidates too,
 * which costs a cache refill and is the cheap side of the trade.
 */
const PROCESS_ID = Math.random().toString(36).slice(2, 10);

/**
 * Validate a catalog declaration and return it unchanged.
 *
 * Separate from {@link registerCatalog} so a declaration can be authored,
 * exported and unit-tested without being registered.
 */
export function defineCatalog(definition: CatalogDefinition): CatalogDefinition {
  const { id, label, audience, viewPermission, restrictedPermission } = definition;

  if (!id || !id.trim()) {
    throw new Error("Catalog id is required.");
  }
  if (!label || !label.trim()) {
    throw new Error(`Catalog '${id}' requires a label.`);
  }
  if (!AUDIENCES.includes(audience)) {
    throw new Error(
      `Catalog '${id}' declares an unknown audience '${audience}'. ` +
        `Expected one of: ${AUDIENCES.join(", ")}.`,
    );
  }
  if (typeof definition.entries !== "function") {
    throw new Error(
      `Catalog '${id}' must declare entries as a function. Entries are derived ` +
        "on every read so component switching takes effect without a restart.",
    );
  }

  // A gated catalog without a permission is unreadable-by-nobody or
  // readable-by-everybody depending on how the reader is written. Refuse the
  // ambiguity at declaration time.
  if (audience === "gated" && !viewPermission?.trim()) {
    throw new Error(
      `Catalog '${id}' has audience 'gated' and must declare a viewPermission.`,
    );
  }
  if (audience !== "gated" && viewPermission) {
    throw new Error(
      `Catalog '${id}' declares a viewPermission but its audience is ` +
        `'${audience}', so the permission would never be checked. Use audience ` +
        "'gated', or drop the permission.",
    );
  }
  if (restrictedPermission !== undefined && !restrictedPermission.trim()) {
    throw new Error(
      `Catalog '${id}' declares an empty restrictedPermission. Name a ` +
        "permission, or omit the field entirely.",
    );
  }

  return definition;
}

/**
 * Register a catalog. Refuses a duplicate id, and refuses to run at all once
 * registration has closed.
 */
export function registerCatalog(definition: CatalogDefinition): CatalogDefinition {
  const validated = defineCatalog(definition);

  if (closed) {
    throw new Error(
      `Cannot register catalog '${validated.id}': catalog registration closed ` +
        "at the end of startup. Register it from the startup sequence.",
    );
  }
  if (catalogs.has(validated.id)) {
    throw new Error(`Catalog '${validated.id}' is already registered.`);
  }

  catalogs.set(validated.id, validated);
  registrationEpoch++;
  return validated;
}

/** Look up one catalog declaration by id. */
export function getCatalogDefinition(id: string): CatalogDefinition | undefined {
  return catalogs.get(id);
}

/** Is this catalog registered? */
export function hasCatalog(id: string): boolean {
  return catalogs.has(id);
}

/**
 * Every registered catalog declaration, in registration order.
 *
 * This is the unfiltered set. It is the right thing to read when interpreting
 * something already stored — the same reason the token framework keeps its
 * declaration lookups unfiltered. To find out what a deployment currently
 * *offers* a reader, go through the read functions instead.
 */
export function listCatalogDefinitions(): CatalogDefinition[] {
  return Array.from(catalogs.values());
}

/** Close registration. Called once, at the end of startup. */
export function closeCatalogRegistration(): void {
  if (closed) return;
  closed = true;
  registrationEpoch++;
}

/** Has registration closed? */
export function isCatalogRegistrationClosed(): boolean {
  return closed;
}

/**
 * A token that changes whenever what the catalogs would answer changes — a new
 * process, a change to the registered set, or a component switched on or off.
 *
 * Anything caching a catalog read keys on this. Requires the component source
 * to be wired, since part of the answer comes from there.
 *
 * It is not the whole cache key. One catalog answers differently by tier, so a
 * cache shared across readers must key on the served tier as well; a resolved
 * catalog reports its own tier for exactly this reason.
 */
export function getCatalogVersion(): string {
  return `${PROCESS_ID}:${registrationEpoch}:${getCatalogComponentRevision()}`;
}

/** Drop every registration and reopen. For tests. */
export function resetCatalogRegistry(): void {
  catalogs.clear();
  closed = false;
  registrationEpoch = 0;
}
