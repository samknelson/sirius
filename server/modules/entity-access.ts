/**
 * Entity Access API Module
 * 
 * Provides API endpoints for checking entity-level access using the unified policy system.
 */

import { Express } from 'express';
import { z } from 'zod';
import { requireAuth, requireAccess, buildContext, checkAccess } from '../accessControl';
import { 
  evaluatePolicy,
  evaluatePolicyBatch,
  getAccessCacheStats,
  invalidateAccessCache,
  clearAccessCache
} from '../services/access-policy-evaluator';
import { accessPolicyRegistry } from '@shared/accessPolicies';
import { logger } from '../logger';
import { isComponentEnabled } from './components';

const SERVICE = 'entity-access-api';

export function registerEntityAccessModule(app: Express, storage: any): void {
  /**
   * GET /api/access/check
   * 
   * Check access to a specific entity
   * Query params:
   *   - policy: Policy ID (e.g., 'worker.view')
   *   - entityId: Entity ID to check access for (optional for route-level policies)
   */
  app.get('/api/access/check', requireAuth, async (req, res) => {
    try {
      const schema = z.object({
        policy: z.string(),
        entityId: z.string().optional(),
      });

      const result = schema.safeParse(req.query);
      if (!result.success) {
        return res.status(400).json({ 
          message: 'Invalid query parameters',
          errors: result.error.errors 
        });
      }

      const { policy: policyId, entityId } = result.data;

      // Get user from context
      const context = await buildContext(req);
      if (!context.user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      // Check access using the unified system
      const accessResult = await checkAccess(policyId, context.user, entityId);

      res.json({
        granted: accessResult.granted,
        reason: accessResult.reason,
      });
    } catch (error) {
      logger.error('Error checking entity access', {
        service: SERVICE,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: 'Failed to check access' });
    }
  });

  /**
   * POST /api/access/check-batch
   * 
   * Check access to multiple entities at once
   * Body:
   *   - policy: Policy ID
   *   - entityIds: Array of entity IDs
   */
  app.post('/api/access/check-batch', requireAuth, async (req, res) => {
    try {
      const schema = z.object({
        policy: z.string(),
        entityIds: z.array(z.string()),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          message: 'Invalid request body',
          errors: result.error.errors 
        });
      }

      const { policy: policyId, entityIds } = result.data;

      // Get user from context
      const context = await buildContext(req);
      if (!context.user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      // Get access storage interface
      const accessStorage = {
        getUserPermissions: async (userId: string) => {
          const permissions = await storage.users.getUserPermissions(userId);
          return permissions.map((p: any) => p.key);
        },
        hasPermission: async (userId: string, permissionKey: string) => {
          return storage.users.userHasPermission(userId, permissionKey);
        },
        getUserByReplitId: async (replitUserId: string) => {
          return storage.users.getUserByReplitId(replitUserId);
        },
        getUser: async (userId: string) => {
          return storage.users.getUser(userId);
        },
      };

      // Evaluate batch access
      const accessResults = await evaluatePolicyBatch(
        context.user,
        policyId,
        entityIds,
        storage,
        accessStorage,
        isComponentEnabled
      );

      // Convert Map to plain object
      const resultsObject: Record<string, { granted: boolean; reason?: string }> = {};
      accessResults.forEach((result, entityId) => {
        resultsObject[entityId] = {
          granted: result.granted,
          reason: result.reason,
        };
      });

      res.json({
        policy: policyId,
        results: resultsObject,
      });
    } catch (error) {
      logger.error('Error checking batch entity access', {
        service: SERVICE,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: 'Failed to check batch access' });
    }
  });

  /**
   * GET /api/access/cache/stats
   * 
   * Get access cache statistics (admin only)
   */
  app.get('/api/access/cache/stats', requireAccess('admin'), async (req, res) => {
    try {
      const stats = getAccessCacheStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: 'Failed to get cache stats' });
    }
  });

  /**
   * POST /api/access/cache/invalidate
   * 
   * Invalidate cache entries matching a pattern (admin only)
   */
  app.post('/api/access/cache/invalidate', requireAccess('admin'), async (req, res) => {
    try {
      const schema = z.object({
        userId: z.string().optional(),
        policyId: z.string().optional(),
        entityId: z.string().optional(),
      });

      const result = schema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          message: 'Invalid request body',
          errors: result.error.errors 
        });
      }

      const count = invalidateAccessCache(result.data);

      res.json({
        message: 'Cache entries invalidated',
        count,
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to invalidate cache' });
    }
  });

  /**
   * POST /api/access/cache/clear
   * 
   * Clear all cache entries (admin only)
   */
  app.post('/api/access/cache/clear', requireAccess('admin'), async (req, res) => {
    try {
      clearAccessCache();

      res.json({
        message: 'Cache cleared',
      });
    } catch (error) {
      res.status(500).json({ message: 'Failed to clear cache' });
    }
  });
}
