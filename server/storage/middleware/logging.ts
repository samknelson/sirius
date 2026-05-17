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
import { getRequestContext } from "../../middleware/request-context";

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
   * delete and the "previous" half of update). Brackets around the id are
   * omitted when the id is empty.
   */
  describe?: DescribeShortcut;
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

        if (hooks.after) {
          afterState = await hooks.after(args, result, storage, beforeState);
        }

        const details: Record<string, any> = {
          args,
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

        // Defer all logging work (including potentially expensive async lookups) to avoid blocking the main operation
        setImmediate(async () => {
          try {
            const context = getRequestContext();
            
            // Resolve entity ID asynchronously after the main operation has returned
            const entityId = hooks.getEntityId
              ? await hooks.getEntityId(args, result, beforeState)
              : undefined;

            // Resolve host entity ID asynchronously
            const hostEntityId = hooks.getHostEntityId
              ? await hooks.getHostEntityId(args, result, beforeState)
              : undefined;

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
              user_id: context?.userId,
              user_email: context?.userEmail,
              ip_address: context?.ipAddress,
              meta: details, // Nest details under 'meta' to match JSONB column
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
          args,
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
              user_id: context?.userId,
              user_email: context?.userEmail,
              ip_address: context?.ipAddress,
              meta: details, // Nest details under 'meta' to match JSONB column
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
