import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";
import { getAllComponents, getComponentById, ComponentConfig } from "../../shared/components";

// Type for middleware functions
type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Get the configuration state for all components
 */
async function getComponentConfigs(): Promise<ComponentConfig[]> {
  const allComponents = getAllComponents();
  const configs: ComponentConfig[] = [];

  for (const component of allComponents) {
    const variableName = `component_${component.id}`;
    const variable = await storage.variables.getVariableByName(variableName);
    
    configs.push({
      componentId: component.id,
      enabled: variable ? variable.value === true : component.enabledByDefault
    });
  }

  return configs;
}

/**
 * Check if a component is enabled
 */
export async function isComponentEnabled(componentId: string): Promise<boolean> {
  const component = getComponentById(componentId);
  if (!component) {
    return false;
  }

  const variableName = `component_${componentId}`;
  const variable = await storage.variables.getVariableByName(variableName);
  
  return variable ? variable.value === true : component.enabledByDefault;
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
  app.get("/api/components/config", requireAccess(policies.components), async (req, res) => {
    try {
      const configs = await getComponentConfigs();
      res.json(configs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch component configurations" });
    }
  });

  // PUT /api/components/config/:componentId - Update component enabled state
  app.put("/api/components/config/:componentId", requireAccess(policies.components), async (req, res) => {
    try {
      const { componentId } = req.params;
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ message: "enabled must be a boolean" });
      }

      // Verify component exists
      const component = getComponentById(componentId);
      if (!component) {
        return res.status(404).json({ message: "Component not found" });
      }

      const variableName = `component_${componentId}`;
      
      // Check if variable exists
      const existingVariable = await storage.variables.getVariableByName(variableName);
      
      if (existingVariable) {
        // Update existing variable
        await storage.variables.updateVariable(existingVariable.id, {
          name: variableName,
          value: enabled
        });
      } else {
        // Create new variable
        await storage.variables.createVariable({
          name: variableName,
          value: enabled
        });
      }

      res.json({
        componentId,
        enabled,
        message: `Component ${enabled ? 'enabled' : 'disabled'} successfully`
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to update component configuration" });
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
