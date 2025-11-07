import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerDashboardRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {
  // Welcome Messages routes - Manage role-specific dashboard welcome messages
  
  // GET /api/welcome-messages - Get all welcome messages (returns object with roleId as key)
  app.get("/api/welcome-messages", requireAuth, async (req, res) => {
    try {
      const roles = await storage.users.getAllRoles();
      const welcomeMessages: Record<string, string> = {};
      
      for (const role of roles) {
        const variableName = `welcome_message_${role.id}`;
        const variable = await storage.variables.getByName(variableName);
        welcomeMessages[role.id] = variable ? (variable.value as string) : "";
      }
      
      res.json(welcomeMessages);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch welcome messages" });
    }
  });

  // PUT /api/welcome-messages/:roleId - Update a role's welcome message
  app.put("/api/welcome-messages/:roleId", requireAuth, requirePermission("variables.manage"), async (req, res) => {
    try {
      const { roleId } = req.params;
      const { message } = req.body;
      
      if (typeof message !== "string") {
        res.status(400).json({ message: "Invalid message format" });
        return;
      }
      
      // Verify role exists
      const role = await storage.users.getRole(roleId);
      if (!role) {
        res.status(404).json({ message: "Role not found" });
        return;
      }
      
      const variableName = `welcome_message_${roleId}`;
      const existingVariable = await storage.variables.getByName(variableName);
      
      if (existingVariable) {
        await storage.variables.update(existingVariable.id, { value: message });
      } else {
        await storage.variables.create({ name: variableName, value: message });
      }
      
      res.json({ message });
    } catch (error) {
      res.status(500).json({ message: "Failed to update welcome message" });
    }
  });

  // Dashboard Plugins routes - Manage dashboard plugin configurations
  
  // GET /api/dashboard-plugins/config - Get all plugin configurations
  app.get("/api/dashboard-plugins/config", requireAuth, async (req, res) => {
    try {
      const allVariables = await storage.variables.getAll();
      const pluginConfigs = allVariables
        .filter(v => v.name.startsWith('dashboard_plugin_'))
        .map(v => ({
          pluginId: v.name.replace('dashboard_plugin_', ''),
          enabled: v.value as boolean,
        }));
      
      res.json(pluginConfigs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch plugin configurations" });
    }
  });

  // PUT /api/dashboard-plugins/config/:pluginId - Update a plugin's configuration
  app.put("/api/dashboard-plugins/config/:pluginId", requireAuth, requirePermission("variables.manage"), async (req, res) => {
    try {
      const { pluginId } = req.params;
      const { enabled } = req.body;
      
      if (typeof enabled !== "boolean") {
        res.status(400).json({ message: "Invalid enabled value" });
        return;
      }
      
      const variableName = `dashboard_plugin_${pluginId}`;
      const existingVariable = await storage.variables.getByName(variableName);
      
      if (existingVariable) {
        await storage.variables.update(existingVariable.id, { value: enabled });
      } else {
        await storage.variables.create({ name: variableName, value: enabled });
      }
      
      res.json({ pluginId, enabled });
    } catch (error) {
      res.status(500).json({ message: "Failed to update plugin configuration" });
    }
  });
}
