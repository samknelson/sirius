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

import { logger } from "../../logger";

/**
 * Configuration for logging a single storage method
 */
export interface MethodLoggingConfig<T = any> {
  /** Function to capture state before the operation (e.g., read current record) */
  before?: (args: any[], storage: T) => Promise<any>;
  
  /** Function to capture state after the operation (e.g., return the result) */
  after?: (args: any[], result: any, storage: T) => Promise<any>;
  
  /** Function to extract a human-readable entity ID from arguments or result */
  getEntityId?: (args: any[], result?: any) => string | undefined;
  
  /** Whether to enable logging for this method (default: false) */
  enabled?: boolean;
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

    wrappedStorage[key] = async function(...args: any[]) {
      let beforeState: any;
      let afterState: any;
      let result: any;
      let error: any;

      try {
        if (methodConfig.before) {
          beforeState = await methodConfig.before(args, storage);
        }

        result = await method.apply(storage, args);

        if (methodConfig.after) {
          afterState = await methodConfig.after(args, result, storage);
        }

        const entityId = methodConfig.getEntityId?.(args, result);

        const logData: Record<string, any> = {
          module: config.module,
          operation: String(key),
          args,
        };

        if (entityId !== undefined) {
          logData.entityId = entityId;
        }

        if (beforeState !== undefined) {
          logData.before = beforeState;
        }

        if (afterState !== undefined) {
          logData.after = afterState;
        }

        if (beforeState !== undefined && afterState !== undefined) {
          logData.changes = calculateChanges(beforeState, afterState);
        }

        setImmediate(() => {
          logger.info(`Storage operation: ${config.module}.${String(key)}`, logData);
        });

        return result;
      } catch (err) {
        error = err;

        const entityId = methodConfig.getEntityId?.(args);
        const logData: Record<string, any> = {
          module: config.module,
          operation: String(key),
          args,
          error: error instanceof Error ? {
            message: error.message,
            stack: error.stack,
            name: error.name
          } : error,
        };

        if (entityId !== undefined) {
          logData.entityId = entityId;
        }

        if (beforeState !== undefined) {
          logData.before = beforeState;
        }

        setImmediate(() => {
          logger.error(`Storage operation failed: ${config.module}.${String(key)}`, logData);
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
