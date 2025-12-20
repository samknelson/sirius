import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";
import { getAllComponents, getComponentById, ComponentConfig, getAncestorComponentIds, ComponentDefinition, ComponentSchemaState } from "../../shared/components";
import {
  enableComponentSchema,
  disableComponentSchema,
  checkComponentSchemaDrift,
  getComponentSchemaInfo,
} from "../services/component-lifecycle";

// Type for middleware functions
type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Get the configuration state for all components
 * Uses isComponentEnabled which includes hierarchical parent checking
 */
async function getComponentConfigs(): Promise<ComponentConfig[]> {
  const allComponents = getAllComponents();
  const configs: ComponentConfig[] = [];

  for (const component of allComponents) {
    const enabled = await isComponentEnabled(component.id);
    
    configs.push({
      componentId: component.id,
      enabled
    });
  }

  return configs;
}

/**
 * Get all enabled component IDs
 * Returns only components that are fully enabled (including parent checks)
 */
export async function getEnabledComponentIds(): Promise<string[]> {
  const allComponents = getAllComponents();
  const enabledIds: string[] = [];

  for (const component of allComponents) {
    const enabled = await isComponentEnabled(component.id);
    if (enabled) {
      enabledIds.push(component.id);
    }
  }

  return enabledIds;
}

/**
 * Check if a component is enabled
 * Also checks that all parent components are enabled (hierarchical check)
 */
export async function isComponentEnabled(componentId: string): Promise<boolean> {
  const component = getComponentById(componentId);
  if (!component) {
    return false;
  }

  // Check all ancestor components - if any are disabled, this component is disabled
  const ancestors = getAncestorComponentIds(componentId);
  for (const ancestorId of ancestors) {
    const ancestorComponent = getComponentById(ancestorId);
    if (!ancestorComponent) {
      continue; // Skip if ancestor not found in registry
    }
    
    const ancestorVariableName = `component_${ancestorId}`;
    const ancestorVariable = await storage.variables.getByName(ancestorVariableName);
    const ancestorEnabled = ancestorVariable ? ancestorVariable.value === true : ancestorComponent.enabledByDefault;
    
    if (!ancestorEnabled) {
      return false; // Parent is disabled, so this component must be disabled
    }
  }

  // All parents are enabled, now check this component's own status
  const variableName = `component_${componentId}`;
  const variable = await storage.variables.getByName(variableName);
  
  return variable ? variable.value === true : component.enabledByDefault;
}

/**
 * Middleware factory to require a component to be enabled
 * Returns 403 with descriptive error if component is not enabled
 */
export function requireComponent(componentId: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const enabled = await isComponentEnabled(componentId);
      
      if (!enabled) {
        const component = getComponentById(componentId);
        const componentName = component?.name || componentId;
        
        res.status(403).json({
          message: `Access denied: The "${componentName}" feature is not enabled`,
          error: "component_disabled",
          componentId: componentId,
          componentName: componentName
        });
        return;
      }
      
      next();
    } catch (error) {
      res.status(500).json({ message: "Failed to check component status" });
    }
  };
}

/**
 * Register component configuration routes
 */
export function registerComponentRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware
) {
  // GET /api/components/config - Get component configuration states
  app.get("/api/components/config", requireAccess(policies.admin), async (req, res) => {
    try {
      const configs = await getComponentConfigs();
      res.json(configs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch component configurations" });
    }
  });

  // PUT /api/components/config/:componentId - Update component enabled state
  app.put("/api/components/config/:componentId", requireAccess(policies.admin), async (req, res) => {
    try {
      const { componentId } = req.params;
      const { enabled, confirmDestructive } = req.body;

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ message: "enabled must be a boolean" });
      }

      const component = getComponentById(componentId);
      if (!component) {
        return res.status(404).json({ message: "Component not found" });
      }

      if (component.managesSchema && !enabled) {
        const schemaInfo = await getComponentSchemaInfo(component);
        const hasActiveTables = schemaInfo.tablesExist.some(exists => exists);
        
        if (hasActiveTables && confirmDestructive !== "DELETE") {
          return res.status(400).json({
            message: "This component has active database tables. Disabling it will DELETE all data.",
            requiresConfirmation: true,
            confirmationType: "destructive",
            tables: schemaInfo.tables,
            instructions: "To confirm, send confirmDestructive: 'DELETE' in the request body"
          });
        }
      }

      if (component.managesSchema) {
        if (enabled) {
          const lifecycleResult = await enableComponentSchema(componentId);
          if (!lifecycleResult.success) {
            return res.status(500).json({
              message: "Failed to create component tables",
              schemaOperations: lifecycleResult.schemaOperations,
              error: lifecycleResult.error
            });
          }
        } else {
          const lifecycleResult = await disableComponentSchema(componentId);
          if (!lifecycleResult.success) {
            return res.status(500).json({
              message: "Failed to drop component tables",
              schemaOperations: lifecycleResult.schemaOperations,
              error: lifecycleResult.error
            });
          }
        }
      }

      const variableName = `component_${componentId}`;
      const existingVariable = await storage.variables.getByName(variableName);
      
      if (existingVariable) {
        await storage.variables.update(existingVariable.id, {
          name: variableName,
          value: enabled
        });
      } else {
        await storage.variables.create({
          name: variableName,
          value: enabled
        });
      }

      const effectiveEnabled = await isComponentEnabled(componentId);

      res.json({
        componentId,
        enabled: effectiveEnabled,
        requestedState: enabled,
        managesSchema: component.managesSchema || false,
        message: `Component ${enabled ? 'enabled' : 'disabled'} successfully${effectiveEnabled !== enabled ? ' (but disabled due to parent component)' : ''}`
      });
    } catch (error) {
      console.error("Failed to update component configuration:", error);
      res.status(500).json({ message: "Failed to update component configuration" });
    }
  });

  // GET /api/components/:componentId/schema-info - Get schema information for a component
  app.get("/api/components/:componentId/schema-info", requireAccess(policies.admin), async (req, res) => {
    try {
      const { componentId } = req.params;
      const component = getComponentById(componentId);
      
      if (!component) {
        return res.status(404).json({ message: "Component not found" });
      }

      const schemaInfo = await getComponentSchemaInfo(component);
      res.json({
        componentId,
        ...schemaInfo
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get component schema info" });
    }
  });

  // POST /api/components/:componentId/check-drift - Check schema drift for a component
  app.post("/api/components/:componentId/check-drift", requireAccess(policies.admin), async (req, res) => {
    try {
      const { componentId } = req.params;
      const component = getComponentById(componentId);
      
      if (!component) {
        return res.status(404).json({ message: "Component not found" });
      }

      const driftResult = await checkComponentSchemaDrift(componentId);
      res.json(driftResult);
    } catch (error) {
      res.status(500).json({ message: "Failed to check schema drift" });
    }
  });

  // GET /api/components/:componentId/enabled - Check if a specific component is enabled
  app.get("/api/components/:componentId/enabled", requireAuth, async (req, res) => {
    try {
      const { componentId } = req.params;
      const enabled = await isComponentEnabled(componentId);
      res.json({ componentId, enabled });
    } catch (error) {
      res.status(500).json({ message: "Failed to check component status" });
    }
  });
}
