import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAccess } from "../accessControl";
import { chargePluginRegistry, getAllEnabledChargePlugins, isChargePluginEnabled } from "../charge-plugins/registry";
import { type ChargePluginMetadata } from "../charge-plugins/types";
import { z } from "zod";
import { insertChargePluginConfigSchema } from "@shared/schema";
import { requireComponent } from "./components";

/**
 * Register routes for charge plugin configuration management
 */
export function registerChargePluginRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
  requirePermission: (permission: string) => (req: Request, res: Response, next: NextFunction) => void
) {
  
  // GET /api/charge-plugins - Get all registered charge plugins (filtered by component status)
  app.get("/api/charge-plugins", requireAuth, requireComponent("ledger"), requireAccess('admin'), async (req, res) => {
    try {
      // Get only plugins whose required components are enabled
      const registeredPlugins = await getAllEnabledChargePlugins();
      const plugins: ChargePluginMetadata[] = registeredPlugins.map(p => p.metadata);
      
      // Sort by ID for consistent ordering
      plugins.sort((a, b) => a.id.localeCompare(b.id));
      
      res.json(plugins);
    } catch (error) {
      console.error("Failed to fetch charge plugins:", error);
      res.status(500).json({ message: "Failed to fetch charge plugins" });
    }
  });

  // GET /api/charge-plugin-configs - Get all plugin configurations
  app.get("/api/charge-plugin-configs", requireAuth, requireComponent("ledger"), requireAccess('admin'), async (req, res) => {
    try {
      const configs = await storage.chargePluginConfigs.getAll();
      res.json(configs);
    } catch (error) {
      console.error("Failed to fetch charge plugin configs:", error);
      res.status(500).json({ message: "Failed to fetch charge plugin configs" });
    }
  });

  // GET /api/charge-plugin-configs/:id - Get a specific plugin configuration
  app.get("/api/charge-plugin-configs/:id", requireAuth, requireComponent("ledger"), requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const config = await storage.chargePluginConfigs.get(id);
      
      if (!config) {
        return res.status(404).json({ message: "Plugin configuration not found" });
      }
      
      res.json(config);
    } catch (error) {
      console.error("Failed to fetch charge plugin config:", error);
      res.status(500).json({ message: "Failed to fetch charge plugin config" });
    }
  });

  // GET /api/charge-plugin-configs/by-plugin/:pluginId - Get all configurations for a specific plugin
  app.get("/api/charge-plugin-configs/by-plugin/:pluginId", requireAuth, requireComponent("ledger"), requireAccess('admin'), async (req, res) => {
    try {
      const { pluginId } = req.params;
      
      // Check if the plugin is enabled (its required component is active)
      const pluginEnabled = await isChargePluginEnabled(pluginId);
      if (!pluginEnabled) {
        return res.status(403).json({ message: "This plugin is not available because its required component is disabled" });
      }
      
      const configs = await storage.chargePluginConfigs.getByPluginId(pluginId);
      res.json(configs);
    } catch (error) {
      console.error("Failed to fetch charge plugin configs by plugin ID:", error);
      res.status(500).json({ message: "Failed to fetch charge plugin configs" });
    }
  });

  // POST /api/charge-plugin-configs - Create a new plugin configuration
  app.post("/api/charge-plugin-configs", requireAuth, requireComponent("ledger"), requireAccess('admin'), async (req, res) => {
    try {
      // Validate request body
      const configData = insertChargePluginConfigSchema.parse(req.body);
      
      // Verify the plugin exists in registry
      const plugin = chargePluginRegistry.get(configData.pluginId);
      if (!plugin) {
        return res.status(400).json({ message: `Plugin '${configData.pluginId}' not found in registry` });
      }

      // Check if the plugin is enabled (its required component is active)
      const pluginEnabled = await isChargePluginEnabled(configData.pluginId);
      if (!pluginEnabled) {
        return res.status(403).json({ message: "Cannot configure this plugin because its required component is disabled" });
      }

      // Validate scope and employerId
      if (configData.scope === "employer" && !configData.employerId) {
        return res.status(400).json({ message: "Employer ID is required for employer-scoped configurations" });
      }
      if (configData.scope === "global" && configData.employerId) {
        return res.status(400).json({ message: "Employer ID should not be provided for global configurations" });
      }

      // Check for duplicate configuration
      const existing = await storage.chargePluginConfigs.getByPluginIdAndScope(
        configData.pluginId,
        configData.scope,
        configData.employerId || undefined
      );
      
      if (existing) {
        return res.status(409).json({ message: "Configuration already exists for this plugin and scope" });
      }

      const config = await storage.chargePluginConfigs.create(configData);
      res.status(201).json(config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid configuration data", errors: error.errors });
      }
      console.error("Failed to create charge plugin config:", error);
      res.status(500).json({ message: "Failed to create charge plugin config" });
    }
  });

  // PUT /api/charge-plugin-configs/:id - Update a plugin configuration
  app.put("/api/charge-plugin-configs/:id", requireAuth, requireComponent("ledger"), requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      
      // Verify config exists
      const existing = await storage.chargePluginConfigs.get(id);
      if (!existing) {
        return res.status(404).json({ message: "Plugin configuration not found" });
      }

      // Check if the plugin is enabled (its required component is active)
      const pluginEnabled = await isChargePluginEnabled(existing.pluginId);
      if (!pluginEnabled) {
        return res.status(403).json({ message: "Cannot update this plugin configuration because its required component is disabled" });
      }

      // Parse update data (partial is allowed)
      const updateSchema = insertChargePluginConfigSchema.partial();
      const updateData = updateSchema.parse(req.body);

      // Build update payload - only include fields that are provided
      const updatePayload: Partial<typeof updateData> = {};
      
      if (updateData.enabled !== undefined) {
        updatePayload.enabled = updateData.enabled;
      }
      
      if (updateData.settings !== undefined) {
        updatePayload.settings = updateData.settings;
      }

      // Update only the provided mutable fields
      const config = await storage.chargePluginConfigs.update(id, updatePayload);
      
      if (!config) {
        return res.status(404).json({ message: "Plugin configuration not found" });
      }
      
      res.json(config);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid configuration data", errors: error.errors });
      }
      console.error("Failed to update charge plugin config:", error);
      res.status(500).json({ message: "Failed to update charge plugin config" });
    }
  });

  // DELETE /api/charge-plugin-configs/:id - Delete a plugin configuration
  app.delete("/api/charge-plugin-configs/:id", requireAuth, requireComponent("ledger"), requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      
      const deleted = await storage.chargePluginConfigs.delete(id);
      
      if (!deleted) {
        return res.status(404).json({ message: "Plugin configuration not found" });
      }
      
      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete charge plugin config:", error);
      res.status(500).json({ message: "Failed to delete charge plugin config" });
    }
  });
}
