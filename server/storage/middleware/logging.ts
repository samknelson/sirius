/**
 * Storage Logging Middleware
 * 
 * Provides extensible, configurable logging for storage operations across all storage modules.
 * This middleware wraps storage factories to automatically log CRUD operations with:
 * - Complete argument capture (no redaction - logs all data including sensitive information)
 * - Before/after state snapshots for change tracking
 * - Automatic diff calculation showing what changed
 * - Async logging via Winston (non-blocking)
 * - Per-method opt-in configuration
 * 
 * @example
 * // Configure logging for a storage module
 * const workerLoggingConfig: StorageLoggingConfig<WorkerStorage> = {
 *   module: 'workers',
 *   methods: {
 *     createWorker: {
 *       enabled: true,
 *       getEntityId: (args) => args[0]?.firstName + ' ' + args[0]?.lastName,
 *       after: async (args, result) => result
 *     },
 *     updateWorker: {
 *       enabled: true,
 *       getEntityId: (args) => args[0], // Worker ID
 *       before: async (args, storage) => await storage.getWorker(args[0]),
 *       after: async (args, result) => result
 *     },
 *     deleteWorker: {
 *       enabled: true,
 *       getEntityId: (args) => args[0],
 *       before: async (args, storage) => await storage.getWorker(args[0])
 *     }
 *   }
 * };
 * 
 * // Apply middleware in database.ts
 * this.workers = withStorageLogging(createWorkerStorage(), workerLoggingConfig);
 */

import { storageLogger } from "../../logger";
import { getRequestContext, isFrameworkWrite } from "../../middleware/request-context";
import { isInTransaction, onAfterCommit, runOutsideTransaction } from "../transaction-context";
import { entityMetadataStorage } from "../system/entity-metadata";

/**
 * Where a record lives, for the entity-metadata row this operation maintains.
 * A constant for the usual case; a function for a polymorphic parent — a note
 * or a file hangs off a worker, an employer or a provider, and only the call
 * itself knows which.
 */
export type EntityTableResolver<T = any> =
  | string
  | ((args: any[], result?: any, beforeState?: any) => string | undefined | Promise<string | undefined>);

/**
 * What a logged method does to its record's provenance.
 *
 * - `created` — the record came into existence here; stamps the creator.
 * - `modified` — the record changed. The default for every logged method,
 *   including the ones that are not named like CRUD (`setAddressAsPrimary`,
 *   `upsert*`, …), because they do change the record.
 * - `deleted` — the record is gone; its metadata row (and its `seq`) goes too.
 * - `none` — this method does not mutate a record whose provenance we track.
 *   The default for the bulk family, whose log entry summarizes a batch rather
 *   than naming a record (see `withStorageLogging`).
 */
export type EntityMetadataMode =
  | 'created'
  | 'modified'
  | 'deleted'
  | 'none';

/**
 * What a method did to its record's provenance, when the answer is not the
 * same every call.
 *
 * A method named like CRUD says what it does in its name; an upsert does not.
 * Whether an upsert created the record or changed one that was already there
 * is only knowable from the call itself, and a config that has to answer
 * "created" or "modified" for both cases lies in one of them — either a new
 * record loses the creator we did observe, or a repair names its repairer as
 * the author. The resolver is handed the same three things every other hook
 * gets, so a config can decide from a `before` state whether the record
 * existed.
 */
export type EntityMetadataModeResolver =
  | EntityMetadataMode
  | ((args: any[], result?: any, beforeState?: any) => EntityMetadataMode | Promise<EntityMetadataMode>);

/** When metadata maintenance runs; the default remains after commit. */
export type EntityMetadataTiming = 'afterCommit' | 'transactional';
/**
 * Which raw tables the logging configs wired into this process actually name.
 *
 * Nothing else can answer this. A config is handed to `withStorageLogging`
 * one module at a time from `database.ts` (and from the component and plugin
 * wiring beyond it) and is never collected anywhere, so the only place that
 * sees them all is the wrapper itself — which records what it was wired with
 * as it is wired.
 *
 * `hostTable` counts as much as `table` does: a host gets a subrecord stamp,
 * which is a provenance row like any other.
 *
 * A config whose table is named by the call rather than by the config (the
 * options tables) cannot be enumerated from here at all; those modules are
 * recorded separately so the completeness check can say what it could not
 * see rather than quietly leaving it out.
 */
const loggedTableNames = new Set<string>();
const modulesNamingTablesAtRuntime = new Set<string>();

/** Every statically-named logged table, as wired so far. */
export function getLoggedTableNames(): string[] {
  return Array.from(loggedTableNames).sort();
}

/** Modules whose table is decided by the call, so it cannot be listed here. */
export function getModulesNamingTablesAtRuntime(): string[] {
  return Array.from(modulesNamingTablesAtRuntime).sort();
}

function noteLoggedTable(module: string, resolver: EntityTableResolver<any> | undefined): void {
  if (resolver === undefined) return;
  if (typeof resolver === 'string') {
    loggedTableNames.add(resolver);
    return;
  }
  modulesNamingTablesAtRuntime.add(module);
}

/**
 * Configuration for logging a single storage method
 */
export interface MethodLoggingConfig<T = any> {
  /** Function to capture state before the operation (e.g., read current record) */
  before?: (args: any[], storage: T) => Promise<any>;
  
  /** Function to capture state after the operation (e.g., return the result) 
   * @param beforeState - The state captured by the before() callback (if any), useful for determining create vs update
   */

  after?: (args: any[], result: any, storage: T, beforeState?: any) => Promise<any>;
  
  /** Function to extract a human-readable entity ID from arguments, result, or beforeState */

  getEntityId?: (args: any[], result?: any, beforeState?: any) => string | undefined | Promise<string | undefined>;
  
  /** Function to extract the host entity ID (parent entity: user, worker, contact, employer) */

  getHostEntityId?: (args: any[], result?: any, beforeState?: any) => string | undefined | Promise<string | undefined>;
  
  /** Custom function to generate a human-readable description of the operation */

  getDescription?: (args: any[], result: any, beforeState: any, afterState: any, storage: T) => Promise<string> | string;
  
  /** Whether to enable logging for this method (default: false) */

  enabled?: boolean;

  /**
   * Optional per-call predicate: when it returns false, the successful
   * operation produces NO log entry. Lets a method log conditionally based
   * on its arguments or result (e.g. an upsert that only logs when it
   * actually inserted). Only consulted on success — failed operations still
   * produce their error log entry regardless of this predicate.
   */

  shouldLog?: (args: any[], result: any) => boolean;

  /**
   * Optional projection applied to `args` before they are persisted in the
   * log entry's `meta.args` (success AND error paths). Use it to redact
   * sensitive payloads (e.g. full session data, credentials) while keeping
   * the identifying arguments. The live call always receives the real args.
   */

  logArgs?: (args: any[]) => any;

  // ---- defineLoggingConfig helper hints (consulted only when useDefaults is true) ----

  /**
   * Per-method metadata sidecar. When the default `after`/`before` hook is
   * synthesized (because the method config does not set its own), the returned
   * value is included as `metadata` alongside the `[state.key]` wrapper. The
   * function may return a value or a Promise; the middleware awaits the
   * result so configs can perform async related-entity lookups.
   */

  metadata?: (args: any[], result: any, beforeState?: any) => any | Promise<any>;

  /**
   * Shortcut for `getHostEntityId`: extract `result?.[field]`,
   * falling back to `args[0]?.[field]` and then either
   * `beforeState?.[state.key]?.[field]` (when a wrapper key is configured)
   * or `beforeState?.[field]` (when the before state is the raw row).
   * Per-method value wins over the module-level `hostEntityIdField`.
   */

  hostEntityIdField?: string;

  /**
   * Per-method state descriptor. See `StateDescriptor`. The relevant fields
   * depend on the method kind: `previousKey` for update, `fallbackId` for
   * create, `includeOnDelete` for delete.
   */

  state?: StateDescriptor;

  /**
   * Declarative description shortcut. When set (and `getDescription` is not),
   * the middleware synthesizes:
   *   - create → `Created <Label> [<id>] <name>`
   *   - update → `Updated <Label> [<id>] <oldName> → <newName>` when names
   *              differ, otherwise `Updated <Label> [<id>] <name>`
   *   - delete → `Deleted <Label> [<id>] <name>`
   * `name` / `id` are field paths read off the resolved state row
   * (`result` for create/update with create falling back to `args[0]`,
   * `beforeState?.[state.key]` — or `beforeState` when no wrapper — for
   * delete and the "previous" half of update). Field lookups use falsy
   * fallback (`||`, so empty string is treated as missing). When `id` is
   * configured the `[<id>]` bracket is always rendered, even if the
   * resolved id is empty — matching legacy hand-written descriptions.
   */

  describe?: DescribeShortcut;

  // ---- entity-metadata declarations ----

  /**
   * Raw database table this method's record lives in, when it is not the
   * module's own `table` (a module whose methods write more than one table).
   */
  table?: string;

  /**
   * Raw database table the HOST entity lives in — the record whose
   * `subrecord_modified_*` pair this operation advances. Per-method value wins
   * over the module-level `hostTable`. Without it (and without a module-level
   * one) no subrecord touch is recorded, even when `getHostEntityId` resolves.
   */
  hostTable?: EntityTableResolver<T>;

  /**
   * The record's OWN id, when the log entry's `entity_id` is something else —
   * a parent's id, a placeholder, a batch summary. Provenance is filed under
   * this id instead.
   */
  metadataEntityId?: (args: any[], result?: any, beforeState?: any) => string | undefined | Promise<string | undefined>;

  /**
   * Override what this method does to its record's provenance. A function when
   * only the call can say — see {@link EntityMetadataModeResolver}.
   */
  metadataMode?: EntityMetadataModeResolver;

  /**
   * Run metadata maintenance in the caller's transaction when one is active.
   * Outside a transaction, the normal after-commit path is retained.
   */
  metadataTiming?: EntityMetadataTiming;

  /**
   * For bulk operations whose synthetic log entity has no provenance row,
   * still advance the host's subrecord metadata.
   */
  metadataHostTouch?: boolean;
}

/**
 * Unified state descriptor shared by `StorageLoggingConfig.state` (module
 * level) and `MethodLoggingConfig.state` (per-method). Each field is only
 * meaningful at one level:
 *
 * - `key` — module level. Wrapper key for before/after state (e.g. `'policy'`
 *   means the synthesized hooks emit `{ policy: row }`).
 * - `previousKey` — per-method update only. Copies `beforeState?.[key]`
 *   into the after state under this key.
 * - `fallbackId` — per-method create only. Returned by the synthesized
 *   `getEntityId` when `result?.id` is unavailable (error path).
 * - `includeOnDelete` — per-method delete only. When true, the synthesized
 *   `after` returns `{ deleted: result, [key]: beforeState?.[key], metadata? }`
 *   instead of being omitted.
 */
export interface StateDescriptor {
  key?: string;
  previousKey?: string;
  fallbackId?: string;
  includeOnDelete?: boolean;
}

export interface DescribeShortcut {
  label: string;
  name?: string;
  id?: string;
  /** Fallback used when the resolved row has no value at `name`. Defaults to `'Unknown'`. */
  defaultName?: string;
}

/**
 * Complete logging configuration for a storage module
 */
export interface StorageLoggingConfig<T> {
  /** Module name for log identification (e.g., 'variables', 'workers', 'contacts.addresses') */
  module: string;

  /**
   * Raw database table this module's records live in (e.g. `contact_phone`).
   * Required: every logged mutation maintains an `entity_metadata` row, and
   * nothing else in the system maps a module name to a table. A method that
   * writes a different table overrides it with its own `table`.
   *
   * A resolver, for the rare module (the options tables) whose records live in
   * a table named by the call itself.
   */
  table: EntityTableResolver<T>;

  /**
   * Raw database table the host entity lives in — see
   * `MethodLoggingConfig.hostTable`. Module-level default; per-method values
   * still win.
   */
  hostTable?: EntityTableResolver<T>;

  /**
   * Module-level default for `MethodLoggingConfig.metadataMode`. Per-method
   * values still win.
   *
   * The reason to set `'none'` here is a module whose rows are not entities in
   * this sense at all — the session store, whose key is a cookie id rather
   * than a record id. Declaring it once beats repeating it per method and
   * says the exemption belongs to the table.
   */
  metadataMode?: EntityMetadataMode;

  /** Module-level default for when metadata maintenance runs. */
  metadataTiming?: EntityMetadataTiming;

  /** Per-method logging configurations */
  methods: {
    [K in keyof T]?: MethodLoggingConfig<T>;
  };

  /**
   * Opt-in flag (set by `defineLoggingConfig`) that asks the middleware to
   * fill in `getEntityId` / `before` / `after` for any method config that
   * omits them, using the conventions described on `defineLoggingConfig`.
   * Existing hand-written configs that do not set this keep the legacy
   * "missing means undefined" behavior, so their log shapes do not drift.
   */
  useDefaults?: boolean;

  /**
   * Module-level state descriptor. `state.key` is the wrapper key used by
   * the default `before` / `after` hooks (so `{ [state.key]: row }`); when
   * unset the defaults pass the raw value through. Only consulted when
   * `useDefaults` is true.
   */
  state?: StateDescriptor;

  /**
   * Name of the storage method used by the default `before` hook to load
   * the pre-mutation state. Defaults to `'get'`. Only consulted when
   * `useDefaults` is true.
   */
  getter?: string;

  /**
   * Module-level default for `getHostEntityId`. Per-method values still win.
   * Only consulted when `useDefaults` is true.
   */
  hostEntityId?: (args: any[], result?: any, beforeState?: any) => string | undefined | Promise<string | undefined>;

  /**
   * Module-level shortcut: for any method whose config does not set its own
   * `getHostEntityId` / `hostEntityIdField`, the synthesized `getHostEntityId`
   * extracts this field from `result` / `args[0]` / `beforeState?.[stateKey]`.
   * Only consulted when `useDefaults` is true.
   */
  hostEntityIdField?: string;
}

/**
 * Per-method shape accepted by `defineLoggingConfig`. Identical to
 * `MethodLoggingConfig` except every field is optional — anything left out
 * is filled in by the middleware defaults when `useDefaults` is true.
 */
export interface DefineMethodConfig<T> extends Partial<MethodLoggingConfig<T>> {}

/**
 * Ergonomic factory for "simple" storage logging configs. Produces a regular
 * `StorageLoggingConfig<T>` with `useDefaults: true` so the middleware fills
 * in the boilerplate hooks.
 *
 * Conventions provided by the middleware for any method whose config omits
 * a hook (and only when `useDefaults` is true):
 *
 * - `getEntityId`:
 *     - methods whose name (case-insensitive) starts with `create` →
 *       `result?.id`
 *     - everything else → `args[0]`
 * - `before`: for non-`create` methods, if the storage exposes the configured
 *   `getter` (default `'get'`), call it with `args[0]` and either return the
 *   raw row (when no `stateKey`) or wrap it as `{ [stateKey]: row }`.
 * - `after`: for non-`delete` methods, return the raw `result` (when no
 *   `stateKey`) or wrap it as `{ [stateKey]: result }`.
 * - `getHostEntityId`: falls back to the module-level `hostEntityId` if a
 *   method does not specify its own.
 *
 * Defaults are conservative — anything explicitly set on the method wins, and
 * defaults that don't apply (e.g. no `get` method on the storage) are safe
 * no-ops. All methods produced by this helper are `enabled: true`.
 */
export interface DefineLoggingConfigOptions<T> {
  module: string;
  /** Raw database table this module's records live in — see `StorageLoggingConfig.table`. */
  table: EntityTableResolver<T>;
  /** Raw database table the host entity lives in — see `MethodLoggingConfig.hostTable`. */
  hostTable?: EntityTableResolver<T>;
  /** Module-level default for the metadata operation type. */
  metadataMode?: EntityMetadataMode;
  /** Module-level default for when metadata maintenance runs. */
  metadataTiming?: EntityMetadataTiming;
  /** Module-level state descriptor. Only `state.key` is meaningful here. */
  state?: StateDescriptor;
  getter?: string;
  hostEntityId?: (args: any[], result?: any, beforeState?: any) => string | undefined | Promise<string | undefined>;
  /** Module-level shortcut — see `StorageLoggingConfig.hostEntityIdField`. */
  hostEntityIdField?: string;
  methods: {
    [K in keyof T]?: DefineMethodConfig<T>;
  };
}

export function defineLoggingConfig<T>(
  opts: DefineLoggingConfigOptions<T>
): StorageLoggingConfig<T> {
  const methods: { [K in keyof T]?: MethodLoggingConfig<T> } = {};
  for (const key of Object.keys(opts.methods) as (keyof T)[]) {
    const m = opts.methods[key] || {};
    methods[key] = { enabled: true, ...m } as MethodLoggingConfig<T>;
  }
  return {
    module: opts.module,
    table: opts.table,
    hostTable: opts.hostTable,
    metadataMode: opts.metadataMode,
    metadataTiming: opts.metadataTiming,
    useDefaults: true,
    state: opts.state,
    getter: opts.getter,
    hostEntityId: opts.hostEntityId,
    hostEntityIdField: opts.hostEntityIdField,
    methods,
  };
}

interface ResolvedHooks {
  getEntityId?: MethodLoggingConfig<any>['getEntityId'];
  getHostEntityId?: MethodLoggingConfig<any>['getHostEntityId'];
  before?: MethodLoggingConfig<any>['before'];
  after?: MethodLoggingConfig<any>['after'];
  getDescription?: MethodLoggingConfig<any>['getDescription'];
}

/**
 * Attach masquerade provenance to an audit-log meta payload. While the acting
 * request is masquerading, the log's user_id/user_email are the effective
 * (masqueraded) actor; the real session user is recorded here under
 * `masqueradedBy` so the audit trail keeps full provenance.
 */
function withMasqueradeMeta(
  details: Record<string, any>,
  context: ReturnType<typeof getRequestContext>,
): Record<string, any> {
  if (!context?.originalUserId) return details;
  return {
    ...details,
    masqueradedBy: {
      userId: context.originalUserId,
      userEmail: context.originalUserEmail,
    },
  };
}

function resolveHooks<T extends Record<string, any>>(
  key: string,
  methodConfig: MethodLoggingConfig<T>,
  config: StorageLoggingConfig<T>,
  storage: T,
): ResolvedHooks {
  if (!config.useDefaults) {
    return {
      getEntityId: methodConfig.getEntityId,
      getHostEntityId: methodConfig.getHostEntityId,
      before: methodConfig.before,
      after: methodConfig.after,
      getDescription: methodConfig.getDescription,
    };
  }

  const has = (k: string) =>
    Object.prototype.hasOwnProperty.call(methodConfig, k);

  const lower = key.toLowerCase();
  // Bulk patterns (createMany, updateMany, deleteMany, bulkCreate, bulkUpdate,
  // bulkDelete) work on arrays, not a single row id. They get bulk-friendly
  // defaults: a "batch of N" entity id, no auto before-fetch (the helper
  // can't look up many rows generically), and a `{ count: N }` after for
  // non-delete operations.
  const isBulkCreate = /^(bulkCreate|createMany)/i.test(key);
  const isBulkUpdate = /^(bulkUpdate|updateMany)/i.test(key);
  const isBulkDelete = /^(bulkDelete|deleteMany)/i.test(key);
  const isBulk = isBulkCreate || isBulkUpdate || isBulkDelete;

  // Single-row CRUD: defaults assume args[0] is the row id.
  const isCreate = !isBulk && lower.startsWith('create');
  const isUpdate = !isBulk && lower.startsWith('update');
  const isDelete = !isBulk && lower.startsWith('delete');
  const isSingle = isCreate || isUpdate || isDelete;

  // Anything else (upsert, deleteByEventId, setAsX, …) gets no defaults;
  // the config must spell out hooks explicitly. This avoids wrong
  // assumptions about what args[0] is.
  const isConventional = isSingle || isBulk;

  const stateKey = config.state?.key;
  const getterName = config.getter || 'get';
  const getterFn =
    typeof (storage as any)[getterName] === 'function'
      ? (storage as any)[getterName].bind(storage)
      : null;
  const wrap = (value: any) => (stateKey ? { [stateKey]: value } : value);

  let defaultGetEntityId: ((args: any[], result?: any) => any) | undefined;
  let defaultBefore: ((args: any[]) => Promise<any>) | undefined;
  let defaultAfter:
    | ((args: any[], result: any, _storage: T, beforeState?: any) => Promise<any>)
    | undefined;

  // Helper-hint shortcuts. metadata/state.previousKey/state.includeOnDelete
  // are wired through the synthesized after-hook; state.fallbackId through the
  // synthesized create getEntityId; hostEntityIdField (per-method or module)
  // through the synthesized getHostEntityId.
  const metadataFn = methodConfig.metadata;
  const state = methodConfig.state;
  const previousStateKey =
    isUpdate && state?.previousKey ? state.previousKey : undefined;
  const includeAfterOnDelete = isDelete && state?.includeOnDelete === true;
  const entityIdFallback = isCreate ? state?.fallbackId : undefined;
  const hostField = methodConfig.hostEntityIdField ?? config.hostEntityIdField;

  // Build an after-hook that wraps the result with `[stateKey]` and merges in
  // metadata / previousState when those hints are configured. Reused for
  // create/update and for delete when includeAfterOnDelete is set.
  // `metadataFn` may return a value or a Promise — the result is awaited so
  // configs can perform async related-entity lookups.
  const wrapAfterWithExtras = async (
    args: any[],
    result: any,
    beforeState: any,
    base: Record<string, any>,
  ): Promise<Record<string, any>> => {
    const out: Record<string, any> = { ...base };
    if (previousStateKey && stateKey && beforeState && stateKey in beforeState) {
      out[previousStateKey] = beforeState[stateKey];
    }
    if (metadataFn) {
      out.metadata = await metadataFn(args, result, beforeState);
    }
    return out;
  };

  if (isSingle) {
    defaultGetEntityId = (args: any[], result?: any) =>
      isCreate ? (result?.id ?? entityIdFallback) : args[0];
    if (!isCreate && getterFn) {
      defaultBefore = async (args: any[]) => wrap(await getterFn(args[0]));
    }
    if (!isDelete) {
      defaultAfter = async (
        args: any[],
        result: any,
        _storage: T,
        beforeState?: any,
      ) =>
        stateKey || metadataFn || previousStateKey
          ? wrapAfterWithExtras(args, result, beforeState, stateKey ? { [stateKey]: result } : { result })
          : wrap(result);
    } else if (includeAfterOnDelete && stateKey) {
      defaultAfter = async (
        args: any[],
        result: any,
        _storage: T,
        beforeState?: any,
      ) =>
        wrapAfterWithExtras(args, result, beforeState, {
          deleted: result,
          [stateKey]: beforeState?.[stateKey],
        });
    }
  } else if (isBulk) {
    defaultGetEntityId = (args: any[], result?: any) => {
      const items = isBulkCreate ? result : args[0];
      const count = Array.isArray(items) ? items.length : 0;
      return `batch of ${count}`;
    };
    if (!isBulkDelete) {
      defaultAfter = async (_args: any[], result: any) => ({
        count: Array.isArray(result) ? result.length : (result ?? 0),
      });
    }
  }
  void isConventional;

  // Synthesized getHostEntityId from a field shortcut. The fallback chain is
  // intentionally narrower on create so that the error path (result=undefined)
  // matches the legacy `result?.<field>` convention exactly — bulk creates
  // historically returned undefined on failure rather than reading the field
  // off the incoming row payload. Update/delete keep the broader chain
  // (result -> args[0] -> beforeState[stateKey]) since their before-state is
  // available and args[0] is the row id (not the payload).
  let defaultGetHostEntityId:
    | ((args: any[], result?: any, beforeState?: any) => any)
    | undefined;
  if (hostField) {
    if (isCreate) {
      defaultGetHostEntityId = (_args: any[], result?: any) =>
        result?.[hostField];
    } else {
      defaultGetHostEntityId = (args: any[], result?: any, beforeState?: any) =>
        result?.[hostField] ??
        args[0]?.[hostField] ??
        (stateKey ? beforeState?.[stateKey]?.[hostField] : beforeState?.[hostField]);
    }
  }

  // Synthesize getDescription from the `describe` shortcut (only when the
  // method config does not provide its own getDescription).
  let defaultGetDescription: MethodLoggingConfig<T>['getDescription'] | undefined;
  if (methodConfig.describe && (isCreate || isUpdate || isDelete)) {
    const d = methodConfig.describe;
    const defaultName = d.defaultName ?? 'Unknown';
    const readBefore = (beforeState: any) =>
      stateKey ? beforeState?.[stateKey] : beforeState;
    defaultGetDescription = async (args: any[], result: any, beforeState: any) => {
      const beforeRow = readBefore(beforeState);
      const stateRow = isCreate
        ? (result ?? args[0])
        : isDelete
        ? beforeRow
        : (result ?? beforeRow);
      const previousRow = isUpdate ? beforeRow : undefined;
      // Legacy semantics: use `||` (falsy fallback, treats empty string as
      // missing) and always render the `[id]` bracket when `d.id` is
      // configured — even when the id is empty — to match hand-written
      // configs like policies.ts.
      const idPart = d.id
        ? `[${(stateRow?.[d.id] || previousRow?.[d.id] || '')}] `
        : '';
      const name = d.name
        ? (stateRow?.[d.name] || previousRow?.[d.name] || defaultName)
        : defaultName;
      if (isCreate) return `Created ${d.label} ${idPart}${name}`;
      if (isDelete) return `Deleted ${d.label} ${idPart}${name}`;
      const oldName = d.name
        ? (previousRow?.[d.name] || defaultName)
        : defaultName;
      if (oldName !== name) {
        return `Updated ${d.label} ${idPart}${oldName} → ${name}`;
      }
      return `Updated ${d.label} ${idPart}${name}`;
    };
  }

  return {
    getEntityId: has('getEntityId') ? methodConfig.getEntityId : defaultGetEntityId,
    getHostEntityId: has('getHostEntityId')
      ? methodConfig.getHostEntityId
      : (defaultGetHostEntityId ?? config.hostEntityId),
    before: has('before') ? methodConfig.before : defaultBefore,
    after: has('after') ? methodConfig.after : defaultAfter,
    getDescription: methodConfig.getDescription ?? defaultGetDescription,
  };
}

/**
 * What a method does to its record's provenance when its config does not say.
 *
 * Every logged method counts as a modification — the exceptions are named
 * like CRUD (create / delete) and the bulk family, whose single log entry
 * describes a batch rather than a record and therefore has no record id to
 * file provenance under. A bulk path maintains no per-record metadata; that
 * follows from riding on the log's grain and is accepted.
 */
async function resolveMetadataMode(
  methodKey: string,
  methodConfig: MethodLoggingConfig<any>,
  configMode: EntityMetadataMode | undefined,
  args: any[],
  result: any,
  beforeState: any,
): Promise<EntityMetadataMode> {
  if (typeof methodConfig.metadataMode === 'function') {
    return methodConfig.metadataMode(args, result, beforeState);
  }
  if (methodConfig.metadataMode) return methodConfig.metadataMode;
  if (configMode) return configMode;
  if (/^(bulkCreate|createMany|bulkUpdate|updateMany|bulkDelete|deleteMany)/i.test(methodKey)) {
    return 'none';
  }
  const lower = methodKey.toLowerCase();
  if (lower.startsWith('create')) return 'created';
  if (lower.startsWith('delete')) return 'deleted';
  return 'modified';
}

function resolveMetadataTiming<T>(
  methodConfig: MethodLoggingConfig<T>,
  config: StorageLoggingConfig<T>,
): EntityMetadataTiming {
  return methodConfig.metadataTiming ?? config.metadataTiming ?? 'afterCommit';
}

async function resolveTable(
  resolver: EntityTableResolver | undefined,
  args: any[],
  result: any,
  beforeState: any,
): Promise<string | undefined> {
  if (typeof resolver === 'function') return resolver(args, result, beforeState);
  return resolver;
}

/**
 * Maintain the `entity_metadata` rows a logged mutation implies: the record's
 * own, and — when the log entry names a host — the host's subrecord pair.
 *
 * Usually runs deferred, off the caller's transaction. Transactional logging
 * configs call this from the active save transaction instead; that path is
 * used when a consumer must capture the exact resulting metadata before the
 * save returns.
 */
async function maintainEntityMetadata(params: {
  config: StorageLoggingConfig<any>;
  methodConfig: MethodLoggingConfig<any>;
  args: any[];
  result: any;
  beforeState: any;
  loggedEntityId: string | undefined;
  hostEntityId: string | undefined;
  at: Date;
  actorId: string | null;
  metadataMode: EntityMetadataMode;
}): Promise<void> {
  const {
    config,
    methodConfig,
    args,
    result,
    beforeState,
    at,
    actorId,
    metadataMode,
  } = params;

  const tableName = metadataMode === 'none'
    ? undefined
    : await resolveTable(
        methodConfig.table ?? config.table,
        args,
        result,
        beforeState,
      );

  // The log's entity id is only usually the record's own id, so a config may
  // name a different resolver for provenance purposes.
  const entityId = methodConfig.metadataEntityId
    ? await methodConfig.metadataEntityId(args, result, beforeState)
    : params.loggedEntityId;

  const hostTable = await resolveTable(
    methodConfig.hostTable ?? config.hostTable,
    args,
    result,
    beforeState,
  );
  const hostEntityId = params.hostEntityId;

  if (
    metadataMode !== 'none' &&
    tableName &&
    entityId !== undefined &&
    entityId !== null
  ) {
    if (metadataMode === 'deleted') {
      await entityMetadataStorage.recordDeletion({ tableName, entityId });
    } else {
      await entityMetadataStorage.recordMutation({
        tableName,
        entityId,
        at,
        actorId,
        created: metadataMode === 'created',
      });
    }
  }

  // Many configs name a record as its own host so that its log entries show
  // up on its own page. That is not a subrecord change.
  if (
    hostTable &&
    hostEntityId &&
    hostEntityId !== entityId &&
    (metadataMode !== 'none' || methodConfig.metadataHostTouch)
  ) {
    await entityMetadataStorage.recordSubrecordTouch({
      tableName: hostTable,
      entityId: hostEntityId,
      at,
      actorId,
    });
  }
}

/**
 * Wraps a storage module with logging middleware
 * 
 * @param storage - The storage instance to wrap (from createXStorage() factory)
 * @param config - Logging configuration specifying which methods to log and what to capture
 * @returns A wrapped storage instance with the same interface but enhanced with logging
 * 
 * @example
 * const variables = withStorageLogging(
 *   createVariableStorage(),
 *   variableLoggingConfig
 * );
 */
export function withStorageLogging<T extends Record<string, any>>(
  storage: T,
  config: StorageLoggingConfig<T>
): T {
  // Recorded before anything is wrapped, so a module counts as participating
  // whether or not any of its methods ever run.
  noteLoggedTable(config.module, config.table);
  noteLoggedTable(config.module, config.hostTable);
  for (const methodConfig of Object.values(config.methods)) {
    noteLoggedTable(config.module, methodConfig?.table);
    noteLoggedTable(config.module, methodConfig?.hostTable);
  }

  const wrappedStorage: any = {};

  for (const key in storage) {
    const method = storage[key];
    const methodConfig = config.methods[key];

    if (typeof method !== 'function') {
      wrappedStorage[key] = method;
      continue;
    }

    if (!methodConfig || methodConfig.enabled === false) {
      wrappedStorage[key] = method.bind(storage);
      continue;
    }

    const hooks = resolveHooks(key, methodConfig, config, storage);

    wrappedStorage[key] = async function(...args: any[]) {
      let beforeState: any;
      let afterState: any;
      let result: any;
      let error: any;

      try {
        if (hooks.before) {
          beforeState = await hooks.before(args, storage);
        }

        result = await method.apply(storage, args);
        // Captured here, not in the deferred block below: under load the
        // deferred work can run appreciably later, and an entity-metadata
        // stamp claims to be the time the mutation happened. The actor is
        // captured alongside it — the effective (masquerade-aware) user the
        // log entry attributes the operation to.
        const completedAt = new Date();
        const actorAtCompletion = getRequestContext()?.userId ?? null;

        // Conditional suppression: a method config may declare that only
        // some successful calls are log-worthy (e.g. upserts that inserted).
        if (methodConfig.shouldLog && !methodConfig.shouldLog(args, result)) {
          return result;
        }

        if (hooks.after) {
          afterState = await hooks.after(args, result, storage, beforeState);
        }

        const details: Record<string, any> = {
          args: methodConfig.logArgs ? methodConfig.logArgs(args) : args,
        };

        if (beforeState !== undefined) {
          details.before = beforeState;
        }

        if (afterState !== undefined) {
          details.after = afterState;
        }

        const changes = (beforeState !== undefined && afterState !== undefined)
          ? calculateChanges(beforeState, afterState)
          : {};

        if (Object.keys(changes).length > 0) {
          details.changes = changes;
        }

        // The log entry and the metadata row name the same record, and the two
        // are deferred separately, so the lookup is shared: whichever runs
        // first pays for it, the other reuses the answer.
        let ids: Promise<{ entityId?: string; hostEntityId?: string }> | undefined;
        const resolveIds = () =>
          (ids ??= (async () => ({
            entityId: hooks.getEntityId
              ? await hooks.getEntityId(args, result, beforeState)
              : undefined,
            hostEntityId: hooks.getHostEntityId
              ? await hooks.getHostEntityId(args, result, beforeState)
              : undefined,
          }))());

        // Entity metadata is normally scheduled by the COMMIT, not by the call. A
        // storage method can return and its enclosing transaction still roll
        // back, and this work runs on its own connection — a provenance row
        // written from here would outlive the mutation that claimed it.
        // `onAfterCommit` runs the callback straight away when there is no
        // transaction, and drops it when there is one that rolls back.
        const metadataMode = await resolveMetadataMode(
          String(key),
          methodConfig,
          config.metadataMode,
          args,
          result,
          beforeState,
        );
        const metadataTiming = resolveMetadataTiming(methodConfig, config);
        const maintain = async () => {
          const resolved = await resolveIds();
          await maintainEntityMetadata({
            config,
            methodConfig,
            args,
            result,
            beforeState,
            loggedEntityId: resolved.entityId,
            hostEntityId: resolved.hostEntityId,
            at: completedAt,
            actorId: actorAtCompletion,
            metadataMode,
          });
        };

        if (metadataTiming === 'transactional') {
          if (isInTransaction()) {
            await maintain();
          } else {
            try {
              // The wrapped storage call has already committed when there is
              // no ambient transaction, so this can run immediately without
              // risking metadata outliving a rolled-back business write.
              await runOutsideTransaction(maintain);
            } catch (metadataError) {
              // Preserve best-effort metadata semantics for standalone calls.
              console.error('Error maintaining entity metadata:', metadataError);
            }
          }
        } else {
          onAfterCommit(() => {
            setImmediate(async () => {
              try {
                await runOutsideTransaction(maintain);
              } catch (metadataError) {
                // Best effort: metadata never costs the mutation or the log.
                console.error('Error maintaining entity metadata:', metadataError);
              }
            });
          });
        }

        // A write the framework performed on its own behalf (see
        // `withFrameworkWrite`) is provenance, not audit. The metadata row
        // scheduled above still records that the record changed, and records
        // it against nobody because the scope cleared the actor; the log
        // viewer is spared an entry per boot for a self-heal no operator did
        // or can act on. Failures still log — that path is below.
        if (isFrameworkWrite()) return result;

        // Defer all logging work (including potentially expensive async lookups) to avoid blocking the main operation
        setImmediate(async () => {
          try {
            const context = getRequestContext();

            // Resolved after the main operation has returned
            const { entityId, hostEntityId } = await resolveIds();

            // Resolve description asynchronously
            let description: string;
            if (hooks.getDescription) {
              description = await hooks.getDescription(args, result, beforeState, afterState, storage);
            } else {
              description = generateDescription(
                config.module,
                String(key),
                entityId,
                beforeState,
                afterState,
                changes
              );
            }

            storageLogger.info(`Storage operation: ${config.module}.${String(key)}`, {
              module: config.module,
              operation: String(key),
              entity_id: entityId,
              host_entity_id: hostEntityId,
              description,
              // Audit attribution uses the effective actor (the masqueraded
              // user while masquerading). The real session user, if
              // different, is recorded in meta.masqueradedBy below.
              user_id: context?.userId,
              user_email: context?.userEmail,
              ip_address: context?.ipAddress,
              meta: withMasqueradeMeta(details, context), // Nest details under 'meta' to match JSONB column
            });
          } catch (loggingError) {
            // Don't let logging errors affect the main operation - just log the error
            console.error('Error in deferred logging:', loggingError);
          }
        });

        return result;
      } catch (err) {
        error = err;

        const details: Record<string, any> = {
          args: methodConfig.logArgs ? methodConfig.logArgs(args) : args,
          error: error instanceof Error ? {
            message: error.message,
            stack: error.stack,
            name: error.name
          } : error,
        };

        if (beforeState !== undefined) {
          details.before = beforeState;
        }

        // Defer error logging to avoid blocking the error throw
        setImmediate(async () => {
          try {
            const context = getRequestContext();
            
            // Resolve entity ID asynchronously
            const entityId = hooks.getEntityId
              ? await hooks.getEntityId(args, undefined, beforeState)
              : undefined;

            // Resolve host entity ID asynchronously
            const hostEntityId = hooks.getHostEntityId
              ? await hooks.getHostEntityId(args, undefined, beforeState)
              : undefined;

            const description = `Failed to ${String(key)} on ${config.module} "${entityId || 'unknown'}"`;

            storageLogger.error(`Storage operation failed: ${config.module}.${String(key)}`, {
              module: config.module,
              operation: String(key),
              entity_id: entityId,
              host_entity_id: hostEntityId,
              description,
              // Audit attribution uses the effective actor (the masqueraded
              // user while masquerading). The real session user, if
              // different, is recorded in meta.masqueradedBy below.
              user_id: context?.userId,
              user_email: context?.userEmail,
              ip_address: context?.ipAddress,
              meta: withMasqueradeMeta(details, context), // Nest details under 'meta' to match JSONB column
            });
          } catch (loggingError) {
            // Don't let logging errors affect error handling - just log it
            console.error('Error in deferred error logging:', loggingError);
          }
        });

        throw err;
      }
    };
  }

  return wrappedStorage as T;
}

function calculateChanges(before: any, after: any): Record<string, { from: any; to: any }> {
  if (before === null || before === undefined || after === null || after === undefined) {
    return {};
  }

  if (typeof before !== 'object' || typeof after !== 'object') {
    return before !== after ? { value: { from: before, to: after } } : {};
  }

  const changes: Record<string, { from: any; to: any }> = {};
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));

  for (const key of allKeys) {
    const beforeValue = before[key];
    const afterValue = after[key];

    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes[key] = { from: beforeValue, to: afterValue };
    }
  }

  return changes;
}

/**
 * Convert module name to a human-readable entity type
 * Handles both simple and dot-qualified module names
 */
function getEntityType(module: string): string {
  // Extract the last part after any dots (e.g., "contacts.addresses" -> "addresses")
  const parts = module.split('.');
  const lastPart = parts[parts.length - 1];
  
  // Simple mapping for common plural forms
  const singularMap: Record<string, string> = {
    'variables': 'variable',
    'users': 'user',
    'workers': 'worker',
    'employers': 'employer',
    'addresses': 'address',
    'phoneNumbers': 'phone number',
    'contacts': 'contact',
    'options': 'option',
    'benefits': 'benefit',
    'accounts': 'account',
    'trust-providers': 'trust provider',
  };
  
  // Return mapped singular form or the original if no mapping exists
  return singularMap[lastPart] || lastPart;
}

/**
 * Build a display name from contact name components
 */
function buildContactDisplayName(contact: any): string | null {
  if (!contact) return null;
  
  const parts: string[] = [];
  
  if (contact.title) parts.push(contact.title);
  if (contact.given) parts.push(contact.given);
  if (contact.middle) parts.push(contact.middle);
  if (contact.family) parts.push(contact.family);
  if (contact.generational) parts.push(contact.generational);
  if (contact.credentials) parts.push(contact.credentials);
  
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Generate a human-readable description of the storage operation
 */
function generateDescription(
  module: string,
  operation: string,
  entityId: string | undefined,
  beforeState: any,
  afterState: any,
  changes: Record<string, { from: any; to: any }>
): string {
  let entityName: string;
  
  // Special handling for contacts - build display name from components
  if (module === 'contacts' || module.startsWith('contacts.')) {
    const state = afterState || beforeState;
    const displayName = buildContactDisplayName(state);
    entityName = displayName || state?.name || entityId || 'unknown';
  } else {
    entityName = beforeState?.name || afterState?.name || entityId || 'unknown';
  }
  
  const entityType = getEntityType(module);
  
  // Extract operation type (create, update, delete, etc.)
  const operationType = operation.toLowerCase();
  
  if (operationType.includes('create')) {
    return `Created ${entityType} "${entityName}"`;
  }
  
  if (operationType.includes('delete')) {
    return `Deleted ${entityType} "${entityName}"`;
  }
  
  if (operationType.includes('update')) {
    const changedFields = Object.keys(changes);
    
    if (changedFields.length === 0) {
      return `Updated ${entityType} "${entityName}" (no changes detected)`;
    }
    
    if (changedFields.length === 1 && changedFields[0] === 'value') {
      // Special case for simple value updates (like variables)
      const change = changes.value;
      const fromValue = formatValue(change.from);
      const toValue = formatValue(change.to);
      return `Updated ${entityType} "${entityName}" from ${fromValue} to ${toValue}`;
    }
    
    // Multiple fields changed
    const fieldList = changedFields.join(', ');
    return `Updated ${entityType} "${entityName}" (changed: ${fieldList})`;
  }
  
  // Default description
  return `${operation} on ${entityType} "${entityName}"`;
}

/**
 * Format a value for display in descriptions
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  
  if (typeof value === 'string') {
    return `"${value}"`;
  }
  
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  
  return String(value);
}
