/**
 * PolicyContext Implementation
 * 
 * Provides the runtime context for policy handlers, including
 * permission checks, entity loading, and policy delegation.
 */

import type { PolicyContext, PolicyUser, PolicyResult } from '@shared/access-policies';
import type { User } from '@shared/schema';
import { logger } from '../logger';
import { getEntityLoader } from './access-policy-evaluator';

const SERVICE = 'policy-context';

/**
 * Access control storage interface for permission checks
 */
export interface AccessControlStorage {
  hasPermission(userId: string, permissionKey: string): Promise<boolean>;
  getUserPermissions(userId: string): Promise<string[]>;
  getUser(userId: string): Promise<User | undefined>;
  getUserByReplitId(replitId: string): Promise<User | undefined>;
}

/**
 * Options for creating a PolicyContext
 */
export interface PolicyContextOptions {
  user: User;
  entityId?: string;
  entityData?: Record<string, any>;
  storage: any;
  accessStorage: AccessControlStorage;
  checkComponent: (componentId: string) => Promise<boolean>;
  evaluatePolicy: (policyId: string, entityId?: string, entityData?: Record<string, any>) => Promise<boolean>;
  /** Pre-loaded entity to avoid duplicate loads (used when cacheKeyFields requires early loading) */
  preloadedEntity?: Record<string, any> | null;
  /** Entity type for the preloaded entity */
  preloadedEntityType?: string;
  /** Entity ID for the preloaded entity (for comparison in loadEntity) */
  preloadedEntityId?: string;
}

/**
 * Create a PolicyContext for policy handler evaluation
 */
export function createPolicyContext(options: PolicyContextOptions): PolicyContext {
  const { user, entityId, entityData, storage, accessStorage, checkComponent, evaluatePolicy, preloadedEntity, preloadedEntityType, preloadedEntityId } = options;
  
  const policyUser: PolicyUser = {
    id: user.id,
    email: user.email,
  };
  
  let cachedUserContact: { id: string; email: string } | null | undefined = undefined;
  let cachedUserWorker: { id: string; contactId: string } | null | undefined = undefined;
  
  return {
    user: policyUser,
    entityId,
    entityData,
    storage,
    
    async hasPermission(permission: string): Promise<boolean> {
      return accessStorage.hasPermission(user.id, permission);
    },
    
    async hasAnyPermission(permissions: string[]): Promise<boolean> {
      for (const perm of permissions) {
        if (await accessStorage.hasPermission(user.id, perm)) {
          return true;
        }
      }
      return false;
    },
    
    async hasAllPermissions(permissions: string[]): Promise<boolean> {
      for (const perm of permissions) {
        if (!await accessStorage.hasPermission(user.id, perm)) {
          return false;
        }
      }
      return true;
    },
    
    async loadEntity<T = Record<string, any>>(entityType: string, loadEntityId: string): Promise<T | null> {
      // Return preloaded entity if it matches (avoids duplicate database loads)
      if (preloadedEntity && preloadedEntityType === entityType && preloadedEntityId === loadEntityId) {
        return preloadedEntity as T;
      }
      
      const registeredLoader = getEntityLoader(entityType);
      if (registeredLoader) {
        try {
          return await registeredLoader(loadEntityId, storage) as T | null;
        } catch (error) {
          logger.error(`Error loading entity ${entityType}:${loadEntityId} via registered loader`, { 
            service: SERVICE, 
            error: (error as Error).message 
          });
          return null;
        }
      }
      
      const fallbackLoaderMap: Record<string, (id: string) => Promise<any>> = {
        'worker': async (id) => storage.workers?.getWorkerById?.(id),
        'employer': async (id) => storage.employers?.getEmployerById?.(id),
        'contact': async (id) => storage.contacts?.getContactById?.(id),
        'file': async (id) => storage.files?.getFileById?.(id),
        'cardcheck': async (id) => storage.cardchecks?.getCardcheckById?.(id),
        'esig': async (id) => storage.esigs?.getEsigById?.(id),
        'worker.dispatch.dnc': async (id) => storage.workerDispatchDnc?.getById?.(id),
        'edls_sheet': async (id) => storage.edlsSheets?.get?.(id),
      };
      
      const fallbackLoader = fallbackLoaderMap[entityType];
      if (!fallbackLoader) {
        logger.warn(`No entity loader for type: ${entityType}`, { service: SERVICE });
        return null;
      }
      
      try {
        return await fallbackLoader(loadEntityId);
      } catch (error) {
        logger.error(`Error loading entity ${entityType}:${loadEntityId}`, { 
          service: SERVICE, 
          error: (error as Error).message 
        });
        return null;
      }
    },
    
    async checkPolicy(policyId: string, policyEntityId?: string, policyEntityData?: Record<string, any>): Promise<boolean> {
      return evaluatePolicy(policyId, policyEntityId, policyEntityData);
    },
    
    async isComponentEnabled(componentId: string): Promise<boolean> {
      return checkComponent(componentId);
    },
    
    async getUserContact(): Promise<{ id: string; email: string } | null> {
      if (cachedUserContact !== undefined) {
        return cachedUserContact;
      }
      
      try {
        const contact = await storage.contacts?.getContactByEmail?.(user.email);
        cachedUserContact = contact ? { id: contact.id, email: contact.email } : null;
        return cachedUserContact;
      } catch (error) {
        logger.error(`Error getting user contact`, { 
          service: SERVICE, 
          error: (error as Error).message 
        });
        cachedUserContact = null;
        return null;
      }
    },
    
    async getUserWorker(): Promise<{ id: string; contactId: string } | null> {
      if (cachedUserWorker !== undefined) {
        return cachedUserWorker;
      }
      
      try {
        const contact = await this.getUserContact();
        if (!contact) {
          cachedUserWorker = null;
          return null;
        }
        
        const worker = await storage.workers?.getWorkerByContactId?.(contact.id);
        cachedUserWorker = worker ? { id: worker.id, contactId: worker.contactId } : null;
        return cachedUserWorker;
      } catch (error) {
        logger.error(`Error getting user worker`, { 
          service: SERVICE, 
          error: (error as Error).message 
        });
        cachedUserWorker = null;
        return null;
      }
    },
  };
}
