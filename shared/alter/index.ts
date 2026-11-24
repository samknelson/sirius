/**
 * Typed replacement-value hooks. No server imports; startup injects availability.
 * See docs/alter-hooks.md for lifecycle and callback obligations.
 */
export interface AlterDeclaration {
  id: string;
  description: string;
  semantics: string;
}

declare const contract: unique symbol;
export interface AlterHook<Value, Context, Metadata = Record<string, never>> extends AlterDeclaration {
  readonly [contract]?: (value: Value, context: Context, metadata: Metadata) => [Value, Context, Metadata];
}

export interface AlterImplementation<Value, Context, Metadata> {
  id: string;
  description: string;
  component: string;
  priority: number;
  metadata: Metadata;
  alter(value: Value, context: Readonly<Context>): Value | Promise<Value>;
}

export interface AlterSource {
  isKnown(component: string): boolean;
  isEnabled(component: string): boolean | Promise<boolean>;
}

export class AlterExecutionError extends Error {
  constructor(readonly hookId: string, readonly callbackId: string) {
    // Never retain callback errors: they can contain request data or credentials.
    super(`Alter hook '${hookId}' callback '${callbackId}' failed`);
    this.name = "AlterExecutionError";
  }
}

function identifier(value: string): void {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_.-]*$/.test(value)) {
    throw new Error("Alter identities must be lowercase dotted/dashed identifiers");
  }
}

function text(value: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error("Alter description and semantics are required");
}

/** Copy and deeply freeze JSON metadata, rejecting rather than dropping non-JSON values. */
function snapshot<T>(value: T, ancestors = new Set<object>()): T {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || ancestors.has(value)) throw new Error("Alter metadata must be acyclic JSON");
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("Alter metadata must contain only plain JSON objects");
  }
  ancestors.add(value);
  const copy = Array.isArray(value)
    ? value.map(item => snapshot(item, ancestors))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, ancestors)]));
  ancestors.delete(value);
  return Object.freeze(copy) as T;
}

/** Independent instances are useful for isolated checks; production uses alterHooks below. */
export function createAlterRegistry() {
  const hooks = new Map<string, AlterDeclaration>();
  type Erased = Omit<AlterImplementation<any, any, any>, 'alter'> & {
    hook: AlterDeclaration;
    alter: (value: any, context: any) => any;
  };
  const callbacks = new Map<string, Erased>();
  let source: AlterSource | undefined;

  function open() {
    if (source) throw new Error("Alter registration is closed");
  }
  function known(hook: AlterDeclaration) {
    if (hooks.get(hook.id) !== hook) throw new Error(`Unknown alter hook '${hook.id}'`);
  }
  function ordered(hook: AlterDeclaration) {
    return [...callbacks.values()].filter(cb => cb.hook === hook)
      .sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  return {
    declare<Value, Context, Metadata = Record<string, never>>(declaration: AlterDeclaration): AlterHook<Value, Context, Metadata> {
      open();
      identifier(declaration.id);
      text(declaration.description);
      text(declaration.semantics);
      if (hooks.has(declaration.id)) throw new Error(`Duplicate alter hook '${declaration.id}'`);
      const hook = Object.freeze({ id: declaration.id, description: declaration.description, semantics: declaration.semantics });
      hooks.set(hook.id, hook);
      return hook;
    },
    register<Value, Context, Metadata>(
      hook: AlterHook<Value, Context, Metadata>,
      implementation: AlterImplementation<NoInfer<Value>, NoInfer<Context>, NoInfer<Metadata>>,
    ): void {
      open();
      known(hook);
      identifier(implementation.id);
      identifier(implementation.component);
      text(implementation.description);
      if (!Number.isFinite(implementation.priority) || typeof implementation.alter !== "function") {
        throw new Error(`Invalid alter callback '${implementation.id}'`);
      }
      if (callbacks.has(implementation.id)) throw new Error(`Duplicate alter callback '${implementation.id}'`);
      callbacks.set(implementation.id, Object.freeze({
        hook, id: implementation.id, description: implementation.description,
        component: implementation.component, priority: implementation.priority,
        metadata: snapshot(implementation.metadata), alter: implementation.alter,
      }));
    },
    close(capability: AlterSource): void {
      open();
      if (typeof capability.isKnown !== "function" || typeof capability.isEnabled !== "function") {
        throw new Error("Alter component capability required");
      }
      for (const cb of callbacks.values()) {
        known(cb.hook);
        if (!capability.isKnown(cb.component)) throw new Error(`Unknown alter component '${cb.component}'`);
      }
      source = Object.freeze({ ...capability });
    },
    async run<Value, Context, Metadata>(hook: AlterHook<Value, Context, Metadata>, value: NoInfer<Value>, context: NoInfer<Context>): Promise<Value> {
      known(hook);
      if (!source) throw new Error("Alter registration has not closed");
      let result = value;
      for (const cb of ordered(hook)) {
        try {
          if (await source.isEnabled(cb.component)) result = await cb.alter(result, context);
        } catch {
          throw new AlterExecutionError(hook.id, cb.id);
        }
      }
      return result;
    },
    implementations<Value, Context, Metadata>(hook: AlterHook<Value, Context, Metadata>) {
      known(hook);
      return ordered(hook).map(cb => ({
        id: cb.id, description: cb.description, component: cb.component,
        priority: cb.priority, metadata: cb.metadata as Metadata,
      }));
    },
    declarations(): readonly AlterDeclaration[] {
      return [...hooks.values()];
    },
    isClosed: () => source !== undefined,
  };
}

export const alterHooks = createAlterRegistry();
