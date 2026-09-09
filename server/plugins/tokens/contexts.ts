import type { TokenContextDeclaration } from "@shared/token-contexts";

/**
 * THE TOKEN CONTEXT REGISTRY.
 *
 * One entry per token-editing surface: the complete ordered list of
 * roots that surface's templates may start from (see
 * `shared/token-contexts.ts` for what a context is and why a surface
 * has exactly one).
 *
 * Everything server-side that has to know a surface's roots — its
 * catalog route, its browsable tree, its save-time validation, its
 * coverage check — asks here by context id, and the client is offered
 * the same list through the `token-contexts` catalog. That is the whole
 * point: the roots are stated once, in code, and every reader of them
 * is reading the same statement.
 *
 * TWO WAYS IN. Most surfaces are fixed and register themselves
 * ({@link registerTokenContext}). Some come in families — one per
 * token-templated notifier — so they are GENERATED from a registry
 * ({@link registerTokenContextSource}) and re-derived on every read.
 * Deriving is what keeps a plugin registered late (a component switched
 * on after boot) from being missing a context nobody knew to declare.
 *
 * A hand-written context WINS over a generated one of the same id, in
 * either registration order, because the generated list is consulted
 * only for ids the declared map does not hold. Order-dependent
 * precedence is the bug this shape exists to avoid: a surface that
 * needed to state its own roots would otherwise get them or not
 * depending on which module was imported first.
 */

const declared = new Map<string, TokenContextDeclaration>();
const sources: Array<() => TokenContextDeclaration[]> = [];

function checkDeclaration(declaration: TokenContextDeclaration): void {
  if (declaration.rootNames.length === 0) {
    throw new Error(
      `Token context "${declaration.id}" names no roots. A context IS its root ` +
        `list: a surface with nothing to write tokens about has no editor to open.`,
    );
  }
  const seen = new Set<string>();
  for (const name of declaration.rootNames) {
    if (seen.has(name)) {
      throw new Error(
        `Token context "${declaration.id}" names the root "${name}" twice; the ` +
          `list is what the author sees, top to bottom.`,
      );
    }
    seen.add(name);
  }
}

/** Declare one surface's context. Ids are unique; a repeat is a bug. */
export function registerTokenContext(
  declaration: TokenContextDeclaration,
): void {
  const existing = declared.get(declaration.id);
  if (existing) {
    throw new Error(
      `Token context "${declaration.id}" is already declared ("${existing.name}"). ` +
        `Two surfaces sharing an id would each believe the other's roots were theirs.`,
    );
  }
  checkDeclaration(declaration);
  declared.set(declaration.id, { ...declaration });
}

/**
 * Declare a FAMILY of contexts, generated from a registry on every read.
 *
 * The generator runs per read, so a plugin registered after boot brings
 * its context with it and one whose component was switched off takes its
 * context away, with nothing to invalidate.
 */
export function registerTokenContextSource(
  generate: () => TokenContextDeclaration[],
): void {
  sources.push(generate);
}

/** Every context this deployment offers: declared first, then generated. */
export function listTokenContexts(): TokenContextDeclaration[] {
  const contexts = [...declared.values()];
  const seen = new Set(declared.keys());
  for (const generate of sources) {
    for (const generated of generate()) {
      // A declared context of the same id has already been taken; the
      // generated one is the fallback, never the override.
      if (seen.has(generated.id)) continue;
      checkDeclaration(generated);
      seen.add(generated.id);
      contexts.push(generated);
    }
  }
  return contexts;
}

/** One context by id, or `undefined` if this deployment has no such surface. */
export function getTokenContext(
  id: string,
): TokenContextDeclaration | undefined {
  const own = declared.get(id);
  if (own) return own;
  return listTokenContexts().find((context) => context.id === id);
}

/**
 * The roots a context names.
 *
 * Throws for an unknown id rather than answering with an empty list: an
 * empty root list reads as "this surface offers no tokens", which is a
 * plausible-looking editor and a silently unvalidatable template. A
 * caller naming a context that does not exist is a wiring mistake and
 * should say so where it happens.
 */
export function tokenContextRootNames(id: string): string[] {
  const context = getTokenContext(id);
  if (!context) {
    throw new Error(
      `Unknown token context "${id}". A surface must declare its context before ` +
        `reading the roots it offers.`,
    );
  }
  return [...context.rootNames];
}
