import type { Express } from 'express';
import { requireAuth, requireAccess, buildContext, checkAccess } from '../accessControl';
import { accessPolicyRegistry } from '@shared/accessPolicies';

/**
 * Register access policy evaluation routes
 */
export function registerAccessPolicyRoutes(app: Express) {
  // GET /api/access/policies - List all policies (requires admin permission)
  app.get("/api/access/policies", requireAccess('admin'), async (req, res) => {
    try {
      const { scope, entityType } = req.query;
      
      let policies = accessPolicyRegistry.getAll();
      
      // Filter by scope if provided
      if (scope === 'route' || scope === 'entity') {
        policies = accessPolicyRegistry.getByScope(scope);
      }
      
      // Filter by entity type if provided
      if (entityType && typeof entityType === 'string') {
        policies = policies.filter(p => p.entityType === entityType);
      }

      // Format policies for frontend display
      const policyList = policies.map(policy => ({
        id: policy.id,
        name: policy.name,
        description: policy.description,
        scope: policy.scope,
        entityType: policy.entityType,
        requirements: policy.rules, // Frontend expects 'requirements' field
      }));
      
      res.json(policyList);
    } catch (error) {
      console.error('Error listing policies:', error);
      res.status(500).json({ message: 'Failed to list policies' });
    }
  });

  // GET /api/access/policies/:policyId - Get policy details and check access
  app.get("/api/access/policies/:policyId", requireAuth, async (req, res) => {
    try {
      const { policyId } = req.params;
      const { entityId } = req.query;
      
      // Get the policy by ID
      const policy = accessPolicyRegistry.get(policyId);
      
      if (!policy) {
        return res.status(404).json({ 
          message: `Policy '${policyId}' not found` 
        });
      }
      
      // Build context from request
      const context = await buildContext(req);
      
      // Check access using the unified system
      const result = await checkAccess(
        policyId, 
        context.user, 
        entityId as string | undefined
      );
      
      res.json({
        policy: {
          id: policy.id,
          name: policy.name,
          description: policy.description,
          scope: policy.scope,
          entityType: policy.entityType,
        },
        access: {
          granted: result.granted,
          reason: result.reason,
        },
        evaluatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error evaluating policy:', error);
      res.status(500).json({ message: 'Failed to evaluate policy' });
    }
  });
}
