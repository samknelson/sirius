/**
 * Shared catalog framework — the component boundary.
 *
 * Catalogs live in `shared/` so both halves of the app can declare and read
 * them, but whether a component is switched on is server state sitting behind
 * the component cache. Shared code cannot reach it.
 *
 * So the server hands the check in at startup, the same way the shared access
 * policies take their evaluator. Until it does, this refuses to answer. It does
 * NOT guess: guessing "enabled" publishes entries for components that are off,
 * and guessing "disabled" hides entries that should be there. Both are silent,
 * and one of them is a leak.
 */

/** The server-supplied view of component state. */
export interface CatalogComponentSource {
  /** Is this component switched on right now? */
  isEnabled(componentId: string): boolean;

  /**
   * A counter that changes whenever component state changes.
   *
   * Anything deriving a cache from a catalog read must key on
   * {@link getCatalogVersion}, which folds this in. Without it, switching a
   * component leaves a derived cache serving entries the catalog no longer
   * offers.
   */
  getRevision(): number;
}

let source: CatalogComponentSource | null = null;

/**
 * Wire the server's component state in. Called once, during startup.
 *
 * Refuses a second wiring. What every catalog offers is decided through this
 * one object, so swapping it at runtime silently changes every answer the
 * framework gives; a second call is a mistake, not a reconfiguration.
 */
export function setCatalogComponentSource(next: CatalogComponentSource): void {
  if (source) {
    throw new Error(
      "Catalog component source is already wired. It is supplied once, during " +
        "startup — replacing it would silently change what every catalog offers.",
    );
  }
  source = next;
}

/** Unwire it. For tests. */
export function clearCatalogComponentSource(): void {
  source = null;
}

/** Has the server wired its component state in yet? */
export function hasCatalogComponentSource(): boolean {
  return source !== null;
}

function requireSource(): CatalogComponentSource {
  if (!source) {
    throw new Error(
      "Catalog component source is not wired. Call setCatalogComponentSource() " +
        "during startup before reading any catalog.",
    );
  }
  return source;
}

/**
 * Is the component supplying an entry switched on?
 *
 * Throws when the source has not been wired, and propagates whatever the source
 * throws — the component cache refuses to answer before it is warm, and that
 * refusal is the correct answer here too.
 */
export function isCatalogComponentEnabled(componentId: string): boolean {
  return requireSource().isEnabled(componentId);
}

/**
 * Refuse now if the source has not been wired.
 *
 * Called before deriving any catalog's entries, whether or not that catalog
 * happens to contain a component-owned entry. Without this, a catalog of purely
 * core entries answers perfectly well before startup has wired anything, and
 * then starts refusing the day someone adds the first component-owned entry to
 * it — the same read, answering two different ways for reasons unrelated to the
 * caller.
 */
export function assertCatalogComponentSource(): void {
  requireSource();
}

/** The current component-state revision. */
export function getCatalogComponentRevision(): number {
  return requireSource().getRevision();
}
