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

        const description = generateDescription(
          config.module,
          String(key),
          entityId,
          beforeState,
          afterState,
          changes
        );

        setImmediate(() => {
          storageLogger.info(`Storage operation: ${config.module}.${String(key)}`, {
            module: config.module,
            operation: String(key),
            entity_id: entityId,
            description,
            meta: details, // Nest details under 'meta' to match JSONB column
          });
        });

        return result;
      } catch (err) {
        error = err;

        const entityId = methodConfig.getEntityId?.(args);
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

        const description = `Failed to ${String(key)} on ${config.module} "${entityId || 'unknown'}"`;

        setImmediate(() => {
          storageLogger.error(`Storage operation failed: ${config.module}.${String(key)}`, {
            module: config.module,
            operation: String(key),
            entity_id: entityId,
            description,
            meta: details, // Nest details under 'meta' to match JSONB column
          });
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
