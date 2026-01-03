import type { Express } from 'express';
import { requireAuth, requireAccess, buildContext, checkAccess, getComponentChecker, getAccessStorage } from '../accessControl';
import { accessPolicyRegistry } from '@shared/accessPolicies';
import { 
  TabEntityType, 
  TabAccessResult, 
  getTabsForEntity,
  TabDefinition 
} from '@shared/tabRegistry';

/**
 * Check if a tab's component requirement is met
 * Supports pipe-separated OR components (e.g., "cardcheck|bargainingunits|worker.steward")
 */
async function checkTabComponent(
  tab: TabDefinition, 
  componentChecker: (componentId: string) => Promise<boolean>
): Promise<boolean> {
  if (!tab.component) return true;
  
  // Handle OR components (pipe-separated)
  if (tab.component.includes('|')) {
    const components = tab.component.split('|');
    for (const comp of components) {
      if (await componentChecker(comp.trim())) {
        return true;
      }
    }
    return false;
  }
  
  return componentChecker(tab.component);
}

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

  // POST /api/access/tabs - Batch check tab access for an entity
  app.post("/api/access/tabs", requireAuth, async (req, res) => {
    try {
      const { entityType, entityId } = req.body as { entityType: TabEntityType; entityId: string };
      
      if (!entityType || !entityId) {
        return res.status(400).json({ 
          message: 'entityType and entityId are required' 
        });
      }

      // Get all tabs for this entity type
      const tabs = getTabsForEntity(entityType);
      
      if (tabs.length === 0) {
        return res.json({ tabs: [] });
      }

      // Get context for this user
      const context = await buildContext(req);
      
      if (!context.user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      // Get component checker
      const componentChecker = getComponentChecker();
      const accessStorage = getAccessStorage();
      
      if (!componentChecker || !accessStorage) {
        return res.status(500).json({ message: 'Access control not initialized' });
      }

      // Security: First check if user has base access to this entity type
      // This prevents users from probing tab access for entities they can't access at all
      // Map entity types to their corresponding base access policies
      const entityPolicyMap: Record<string, string> = {
        worker: 'worker.view',
        employer: 'employer.view',
        provider: 'provider',
        employer_contact: 'employer.view',
        provider_contact: 'provider',
        policy: 'authenticated',
        event: 'authenticated',
        bargaining_unit: 'authenticated',
        btu_csg: 'authenticated',
        cron_job: 'admin',
        dispatch_job: 'authenticated',
        dispatch_job_type: 'authenticated',
        ledger_account: 'ledger.staff',
        ledger_payment: 'ledger.staff',
        trust_benefit: 'staff',
        worker_hours: 'staff',
        user: 'admin',
      };
      const basePolicy = entityPolicyMap[entityType] || 'authenticated';
      const baseAccessResult = await checkAccess(basePolicy, context.user, entityId);
      
      if (!baseAccessResult.granted) {
        // User has no access to this entity - return 403 to avoid oracle attacks
        return res.status(403).json({ 
          message: 'Access denied to this entity' 
        });
      }

      // Batch evaluate access for all tabs
      const results: TabAccessResult[] = [];
      
      for (const tab of tabs) {
        let granted = true;
        let reason: string | undefined;

        // Check component requirement first
        const componentEnabled = await checkTabComponent(tab, componentChecker);
        if (!componentEnabled) {
          granted = false;
          reason = `Component not enabled: ${tab.component}`;
        }

        // Check policy or permission if component passed
        if (granted) {
          if (tab.policyId) {
            // Check policy with entity context
            const policyResult = await checkAccess(tab.policyId, context.user, entityId);
            granted = policyResult.granted;
            reason = policyResult.reason;
          } else if (tab.permission) {
            // Check permission directly
            const hasPermission = await accessStorage.hasPermission(context.user.id, tab.permission);
            // Also check admin bypass
            const isAdmin = await accessStorage.hasPermission(context.user.id, 'admin');
            granted = hasPermission || isAdmin;
            if (!granted) {
              reason = `Missing permission: ${tab.permission}`;
            }
          }
        }

        results.push({
          tabId: tab.id,
          granted,
          reason,
        });
      }

      res.json({ tabs: results });
    } catch (error) {
      console.error('Error checking tab access:', error);
      res.status(500).json({ message: 'Failed to check tab access' });
    }
  });
}
