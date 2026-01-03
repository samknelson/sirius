export interface PermissionDefinition {
  key: string;
  description: string;
  module?: string; // Which module registered this permission
}

export type PermissionRegistrationHook = (registry: PermissionRegistry) => void;

export class PermissionRegistry {
  private permissions = new Map<string, PermissionDefinition>();
  private hooks: PermissionRegistrationHook[] = [];
  private isInitialized = false;

  /**
   * Register a single permission
   */
  register(permission: PermissionDefinition): void {
    if (this.permissions.has(permission.key)) {
      throw new Error(`Permission '${permission.key}' is already registered`);
    }
    this.permissions.set(permission.key, permission);
  }

  /**
   * Register multiple permissions at once
   */
  registerMany(permissions: PermissionDefinition[]): void {
    permissions.forEach(permission => this.register(permission));
  }

  /**
   * Get all registered permissions
   */
  getAll(): PermissionDefinition[] {
    return Array.from(this.permissions.values());
  }

  /**
   * Check if a permission exists
   */
  exists(key: string): boolean {
    return this.permissions.has(key);
  }

  /**
   * Get a permission by key
   */
  getByKey(key: string): PermissionDefinition | undefined {
    return this.permissions.get(key);
  }

  /**
   * Get all permission keys
   */
  getKeys(): string[] {
    return Array.from(this.permissions.keys());
  }

  /**
   * Get permissions by module
   */
  getByModule(module: string): PermissionDefinition[] {
    return this.getAll().filter(p => p.module === module);
  }

  /**
   * Register a hook function that will be called during initialization
   */
  addHook(hook: PermissionRegistrationHook): void {
    if (this.isInitialized) {
      // If already initialized, execute the hook immediately
      hook(this);
    } else {
      // Otherwise, queue it for later execution
      this.hooks.push(hook);
    }
  }

  /**
   * Execute all registered hooks (private - use markInitialized instead)
   */
  private executeHooks(): void {
    this.hooks.forEach(hook => hook(this));
    // Clear hooks after execution to prevent duplicate execution
    this.hooks = [];
  }

  /**
   * Check if registry is initialized
   */
  isRegistryInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Mark registry as initialized and execute any remaining hooks
   */
  markInitialized(): void {
    if (!this.isInitialized) {
      try {
        // Execute hooks until no new ones are added
        while (this.hooks.length > 0) {
          const currentHooks = this.hooks.slice();
          this.hooks = [];
          currentHooks.forEach(hook => {
            try {
              hook(this);
            } catch (error) {
              // Log hook errors but continue with other hooks
              console.error(`Permission registry hook failed:`, error);
            }
          });
        }
        // Only mark initialized after all hooks complete successfully
        this.isInitialized = true;
      } catch (error) {
        // If initialization fails, reset state
        this.hooks = [];
        throw error;
      }
    }
  }

  /**
   * Clear all permissions (useful for testing)
   */
  clear(): void {
    this.permissions.clear();
    this.hooks = [];
    this.isInitialized = false;
  }
}

// Global registry instance
export const permissionRegistry = new PermissionRegistry();

/**
 * Initialize the registry with core permissions
 */
export function initializePermissions(): void {
  // Skip if already initialized to make this idempotent
  if (permissionRegistry.isRegistryInitialized()) {
    return;
  }

  // Register core permissions
  const corePermissions: PermissionDefinition[] = [
    {
      key: 'bookmark',
      description: 'Create and manage bookmarks for workers and employers',
      module: 'core'
    },
    {
      key: 'masquerade',
      description: 'Ability to masquerade as other users',
      module: 'core'
    },
    {
      key: 'employer.ledger',
      description: 'Access to employer ledger functionality for employer users',
      module: 'core'
    },
    {
      key: 'worker.ledger',
      description: 'Access to worker ledger functionality for worker users',
      module: 'core'
    },
    {
      key: 'provider.ledger',
      description: 'Access to provider ledger functionality for provider users',
      module: 'core'
    },
    {
      key: 'staff',
      description: 'Staff level access',
      module: 'core'
    },
    {
      key: 'provider',
      description: 'Provider level access',
      module: 'core'
    },
    {
      key: 'employer',
      description: 'Employer level access',
      module: 'core'
    },
    {
      key: 'worker',
      description: 'Worker level access',
      module: 'core'
    },
    {
      key: 'admin',
      description: 'Administrator level access',
      module: 'core'
    },
    {
      key: 'employer.manage',
      description: 'Manage user accounts for employer contacts',
      module: 'core'
    },
    {
      key: 'worker.steward',
      description: 'Access to shop steward functionality for workers',
      module: 'core'
    }
  ];

  permissionRegistry.registerMany(corePermissions);

  // Mark as initialized and execute any registered hooks
  permissionRegistry.markInitialized();
}

/**
 * Helper function for modules to register their permissions
 */
export function registerModulePermissions(hook: PermissionRegistrationHook): void {
  if (permissionRegistry.isRegistryInitialized()) {
    // If already initialized, execute immediately
    hook(permissionRegistry);
  } else {
    // Otherwise, queue for initialization
    permissionRegistry.addHook(hook);
  }
}

// Export the registry as default
export { permissionRegistry as default };