import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";
import { employerMonthlyPluginConfigSchema } from "@shared/schema";
import { getPluginMetadata } from "@shared/pluginMetadata";

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
  app.put("/api/welcome-messages/:roleId", requireAccess(policies.admin), async (req, res) => {
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
  app.put("/api/dashboard-plugins/config/:pluginId", requireAccess(policies.admin), async (req, res) => {
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

  // GET /api/dashboard-plugins/:pluginId/settings - Get plugin settings
  app.get("/api/dashboard-plugins/:pluginId/settings", requireAuth, async (req, res) => {
    try {
      const { pluginId } = req.params;
      const user = req.user as any;
      const replitUserId = user.claims.sub;
      const dbUser = await storage.users.getUserByReplitId(replitUserId);
      
      if (!dbUser) {
        res.status(401).json({ message: "User not found" });
        return;
      }
      
      // Get plugin metadata to check permissions
      const metadata = getPluginMetadata(pluginId);
      if (!metadata) {
        res.status(404).json({ message: "Plugin not found" });
        return;
      }
      
      // Check permissions
      if (metadata.requiredPermissions && metadata.requiredPermissions.length > 0) {
        const userPermissions = await storage.users.getUserPermissions(dbUser.id);
        const userPermissionKeys = userPermissions.map(p => p.key);
        const hasPermission = metadata.requiredPermissions.some(
          perm => userPermissionKeys.includes(perm)
        );
        
        if (!hasPermission) {
          res.status(403).json({ message: "Access denied: Insufficient permissions" });
          return;
        }
      }
      
      const variableName = `dashboard_plugin_${pluginId}_settings`;
      const variable = await storage.variables.getByName(variableName);
      
      // If unified settings don't exist, try to migrate from legacy format
      if (!variable && pluginId === "welcome_messages") {
        // Migrate welcome messages from individual role variables
        const roles = await storage.users.getAllRoles();
        const migratedSettings: Record<string, string> = {};
        
        for (const role of roles) {
          const legacyVarName = `welcome_message_${role.id}`;
          const legacyVar = await storage.variables.getByName(legacyVarName);
          if (legacyVar) {
            migratedSettings[role.id] = legacyVar.value as string;
          }
        }
        
        // Save migrated settings to new unified variable
        if (Object.keys(migratedSettings).length > 0) {
          await storage.variables.create({ 
            name: variableName, 
            value: migratedSettings 
          });
          res.json(migratedSettings);
          return;
        }
      } else if (!variable && pluginId === "employer_monthly") {
        // Migrate employer monthly config from legacy variable
        const legacyVar = await storage.variables.getByName('employer_monthly_plugin_config');
        if (legacyVar) {
          const migratedSettings = legacyVar.value;
          await storage.variables.create({ 
            name: variableName, 
            value: migratedSettings 
          });
          res.json(migratedSettings);
          return;
        }
      }
      
      res.json(variable ? variable.value : {});
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch plugin settings" });
    }
  });

  // PUT /api/dashboard-plugins/:pluginId/settings - Update plugin settings
  app.put("/api/dashboard-plugins/:pluginId/settings", requireAuth, async (req, res) => {
    try {
      const { pluginId } = req.params;
      const settings = req.body;
      const user = req.user as any;
      const replitUserId = user.claims.sub;
      const dbUser = await storage.users.getUserByReplitId(replitUserId);
      
      if (!dbUser) {
        res.status(401).json({ message: "User not found" });
        return;
      }
      
      // Get plugin metadata to check permissions and validate schema
      const metadata = getPluginMetadata(pluginId);
      if (!metadata) {
        res.status(404).json({ message: "Plugin not found" });
        return;
      }
      
      // Check permissions
      if (metadata.requiredPermissions && metadata.requiredPermissions.length > 0) {
        const userPermissions = await storage.users.getUserPermissions(dbUser.id);
        const userPermissionKeys = userPermissions.map(p => p.key);
        const hasPermission = metadata.requiredPermissions.some(
          perm => userPermissionKeys.includes(perm)
        );
        
        if (!hasPermission) {
          res.status(403).json({ message: "Access denied: Insufficient permissions" });
          return;
        }
      }
      
      // Validate settings against schema if provided
      if (metadata.settingsSchema) {
        const result = metadata.settingsSchema.safeParse(settings);
        if (!result.success) {
          res.status(400).json({ 
            message: "Invalid settings format",
            errors: result.error.errors,
          });
          return;
        }
      }
      
      const variableName = `dashboard_plugin_${pluginId}_settings`;
      const existingVariable = await storage.variables.getByName(variableName);
      
      if (existingVariable) {
        await storage.variables.update(existingVariable.id, { value: settings });
      } else {
        await storage.variables.create({ name: variableName, value: settings });
      }
      
      res.json({ success: true, settings });
    } catch (error) {
      res.status(500).json({ message: "Failed to update plugin settings" });
    }
  });

  // Employer Monthly Plugin routes - Manage employer monthly upload statistics and configuration
  
  // GET /api/dashboard-plugins/employer-monthly/stats - Get employer upload statistics for a specific month
  app.get("/api/dashboard-plugins/employer-monthly/stats", requireAuth, async (req, res) => {
    try {
      const { year, month, wizardType } = req.query;
      const user = req.user as any;
      const replitUserId = user.claims.sub;
      const dbUser = await storage.users.getUserByReplitId(replitUserId);
      
      if (!dbUser) {
        res.status(401).json({ message: "User not found" });
        return;
      }
      
      // Default to current month if not provided
      const now = new Date();
      const yearNum = year ? Number(year) : now.getFullYear();
      const monthNum = month ? Number(month) : now.getMonth() + 1;
      
      if (!wizardType || typeof wizardType !== 'string') {
        res.status(400).json({ message: "Wizard type is required" });
        return;
      }
      
      if (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > 2100) {
        res.status(400).json({ message: "Year must be a valid integer between 1900 and 2100" });
        return;
      }
      
      if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
        res.status(400).json({ message: "Month must be a valid integer between 1 and 12" });
        return;
      }
      
      // Verify user has access to this wizard type
      const userRoles = await storage.users.getUserRoles(dbUser.id);
      const variable = await storage.variables.getByName('employer_monthly_plugin_config');
      const config = variable ? (variable.value as Record<string, string[]>) : {};
      
      const allowedWizardTypes = new Set<string>();
      for (const role of userRoles) {
        const roleTypes = config[role.id] || [];
        roleTypes.forEach(type => allowedWizardTypes.add(type));
      }
      
      if (!allowedWizardTypes.has(wizardType)) {
        res.status(403).json({ message: "Access denied: You do not have permission to view statistics for this wizard type" });
        return;
      }
      
      const stats = await storage.wizardEmployerMonthly.getMonthlyStats(
        yearNum,
        monthNum,
        wizardType
      );
      
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer monthly stats" });
    }
  });

  // GET /api/dashboard-plugins/employer-monthly/my-wizard-types - Get wizard types for current user's roles
  app.get("/api/dashboard-plugins/employer-monthly/my-wizard-types", requireAuth, async (req, res) => {
    try {
      const user = req.user as any;
      const replitUserId = user.claims.sub;
      const dbUser = await storage.users.getUserByReplitId(replitUserId);
      
      if (!dbUser) {
        res.status(401).json({ message: "User not found" });
        return;
      }

      const userRoles = await storage.users.getUserRoles(dbUser.id);
      const variable = await storage.variables.getByName('employer_monthly_plugin_config');
      const config = variable ? (variable.value as Record<string, string[]>) : {};
      
      const wizardTypesSet = new Set<string>();
      for (const role of userRoles) {
        const roleTypes = config[role.id] || [];
        roleTypes.forEach(type => wizardTypesSet.add(type));
      }
      
      res.json(Array.from(wizardTypesSet));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch wizard types for user" });
    }
  });

  // GET /api/dashboard-plugins/employer-monthly/config - Get role-to-wizard-type configuration (admin only)
  app.get("/api/dashboard-plugins/employer-monthly/config", requireAccess(policies.admin), async (req, res) => {
    try {
      const variable = await storage.variables.getByName('employer_monthly_plugin_config');
      const config = variable ? (variable.value as Record<string, string[]>) : {};
      res.json(config);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch employer monthly plugin configuration" });
    }
  });

  // PUT /api/dashboard-plugins/employer-monthly/config - Update role-to-wizard-type configuration
  app.put("/api/dashboard-plugins/employer-monthly/config", requireAccess(policies.admin), async (req, res) => {
    try {
      const parseResult = employerMonthlyPluginConfigSchema.safeParse(req.body);
      
      if (!parseResult.success) {
        res.status(400).json({ message: "Invalid configuration format", errors: parseResult.error.errors });
        return;
      }
      
      const config = parseResult.data;
      const existingVariable = await storage.variables.getByName('employer_monthly_plugin_config');
      
      if (existingVariable) {
        await storage.variables.update(existingVariable.id, { value: config });
      } else {
        await storage.variables.create({ name: 'employer_monthly_plugin_config', value: config });
      }
      
      res.json(config);
    } catch (error) {
      res.status(500).json({ message: "Failed to update employer monthly plugin configuration" });
    }
  });
}
