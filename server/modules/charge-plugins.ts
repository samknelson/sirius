import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAccess } from "../services/access-policy-evaluator";
import { chargePluginRegistry, getAllEnabledChargePlugins, isChargePluginEnabled } from "../charge-plugins/registry";
import { type ChargePluginMetadata, TriggerType } from "../charge-plugins/types";
import { executeChargePlugins } from "../charge-plugins/executor";
import { z } from "zod";
import { insertChargePluginConfigSchema, trustWmb, workerHours, ledger } from "@shared/schema";
import { requireComponent } from "./components";
import { wizardRegistry } from "../wizards/index.js";
import { getClient } from "../storage/transaction-context";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "../logger";

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

  app.get("/api/charge-plugin-rerun/wizards", requireAuth, requireComponent("ledger"), requireAccess('admin'), async (_req, res) => {
    try {
      const [wizardsComplete, wizardsCompleted] = await Promise.all([
        storage.wizards.list({ status: "complete" }),
        storage.wizards.list({ status: "completed" }),
      ]);
      const seenIds = new Set<string>();
      const completedWizards = [...wizardsComplete, ...wizardsCompleted].filter((w) => {
        if (seenIds.has(w.id)) return false;
        seenIds.add(w.id);
        return true;
      });

      const typeMap = new Map<string, string>();
      for (const wt of wizardRegistry.getAll()) {
        typeMap.set(wt.name, wt.displayName);
      }

      const results = await Promise.all(
        completedWizards.map(async (w) => {
          const data = w.data as Record<string, unknown> | null;
          const la = (data?.launchArguments ?? {}) as Record<string, unknown>;
          const year = la.year as number | undefined;
          const month = la.month as number | undefined;

          let employerName: string | null = null;
          if (w.entityId) {
            try {
              const employer = await storage.employers.getEmployer(w.entityId);
              employerName = employer?.name ?? null;
            } catch {
              // ignore
            }
          }

          const db = getClient();
          let wmbCount = 0;
          let hoursCount = 0;

          if (w.entityId && year && month) {
            const wmbMonth = ((month - 1 + 3) % 12) + 1;
            const wmbYear = year + Math.floor((month - 1 + 3) / 12);
            const wmbs = await db
              .select({ id: trustWmb.id })
              .from(trustWmb)
              .where(
                and(
                  eq(trustWmb.employerId, w.entityId),
                  eq(trustWmb.year, wmbYear),
                  eq(trustWmb.month, wmbMonth)
                )
              );
            wmbCount = wmbs.length;

            const hours = await db
              .select({ id: workerHours.id })
              .from(workerHours)
              .where(
                and(
                  eq(workerHours.employerId, w.entityId),
                  eq(workerHours.year, year),
                  eq(workerHours.month, month)
                )
              );
            hoursCount = hours.length;
          }

          return {
            id: w.id,
            type: w.type,
            displayName: typeMap.get(w.type) ?? w.type,
            date: w.date,
            entityId: w.entityId,
            employerName,
            year,
            month,
            wmbCount,
            hoursCount,
          };
        })
      );

      results.sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : 0;
        const db = b.date ? new Date(b.date).getTime() : 0;
        return db - da;
      });

      res.json(results);
    } catch (error) {
      logger.error("Failed to fetch wizards for charge plugin rerun", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to fetch wizards" });
    }
  });

  app.post("/api/charge-plugin-rerun/execute", requireAuth, requireComponent("ledger"), requireAccess('admin'), async (req, res) => {
    try {
      const { wizardIds, triggers } = req.body as {
        wizardIds: string[];
        triggers?: string[];
      };

      if (!wizardIds || !Array.isArray(wizardIds) || wizardIds.length === 0) {
        return res.status(400).json({ message: "wizardIds array is required" });
      }

      const enabledTriggers = new Set(triggers ?? ["wmb_saved", "hours_saved"]);
      const db = getClient();

      const results: Array<{
        wizardId: string;
        employerId: string;
        employerName: string | null;
        year: number;
        month: number;
        wmbProcessed: number;
        wmbErrors: number;
        hoursProcessed: number;
        hoursErrors: number;
        totalTransactions: number;
        error?: string;
      }> = [];

      for (const wizardId of wizardIds) {
        const wizard = await storage.wizards.getById(wizardId);
        if (!wizard) {
          results.push({
            wizardId,
            employerId: "",
            employerName: null,
            year: 0,
            month: 0,
            wmbProcessed: 0,
            wmbErrors: 0,
            hoursProcessed: 0,
            hoursErrors: 0,
            totalTransactions: 0,
            error: "Wizard not found",
          });
          continue;
        }

        if (wizard.status !== "complete" && wizard.status !== "completed") {
          results.push({
            wizardId,
            employerId: wizard.entityId ?? "",
            employerName: null,
            year: 0,
            month: 0,
            wmbProcessed: 0,
            wmbErrors: 0,
            hoursProcessed: 0,
            hoursErrors: 0,
            totalTransactions: 0,
            error: `Wizard status is "${wizard.status}" — only completed wizards can be rerun`,
          });
          continue;
        }

        const data = wizard.data as Record<string, unknown> | null;
        const la = (data?.launchArguments ?? {}) as Record<string, unknown>;
        const year = la.year as number | undefined;
        const month = la.month as number | undefined;

        if (!wizard.entityId || !year || !month) {
          results.push({
            wizardId,
            employerId: wizard.entityId ?? "",
            employerName: null,
            year: year ?? 0,
            month: month ?? 0,
            wmbProcessed: 0,
            wmbErrors: 0,
            hoursProcessed: 0,
            hoursErrors: 0,
            totalTransactions: 0,
            error: "Wizard is missing employer, year, or month information",
          });
          continue;
        }

        let employerName: string | null = null;
        try {
          const employer = await storage.employers.getEmployer(wizard.entityId);
          employerName = employer?.name ?? null;
        } catch {
          // ignore
        }

        let wmbProcessed = 0;
        let wmbErrors = 0;
        let hoursProcessed = 0;
        let hoursErrors = 0;
        let totalTransactions = 0;
        let entriesDeleted = 0;

        if (enabledTriggers.has("wmb_saved")) {
          const wmbMonth = ((month - 1 + 3) % 12) + 1;
          const wmbYear = year + Math.floor((month - 1 + 3) / 12);
          const wmbs = await db
            .select()
            .from(trustWmb)
            .where(
              and(
                eq(trustWmb.employerId, wizard.entityId),
                eq(trustWmb.year, wmbYear),
                eq(trustWmb.month, wmbMonth)
              )
            );

          if (wmbs.length > 0) {
            const wmbIds = wmbs.map((w) => w.id);
            const deleted = await db
              .delete(ledger)
              .where(
                and(
                  eq(ledger.referenceType, "wmb"),
                  inArray(ledger.referenceId, wmbIds)
                )
              );
            entriesDeleted += deleted.rowCount ?? 0;
            logger.info("Deleted existing WMB ledger entries before rerun", {
              wizardId,
              count: deleted.rowCount ?? 0,
              wmbCount: wmbs.length,
            });
          }

          for (const wmb of wmbs) {
            try {
              const result = await executeChargePlugins({
                trigger: TriggerType.WMB_SAVED,
                wmbId: wmb.id,
                workerId: wmb.workerId,
                employerId: wmb.employerId,
                benefitId: wmb.benefitId,
                year: wmb.year,
                month: wmb.month,
              });
              totalTransactions += result.totalTransactions.length;
              wmbProcessed++;
            } catch (err) {
              wmbErrors++;
              logger.error("Charge plugin rerun WMB error", {
                wmbId: wmb.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }

        if (enabledTriggers.has("hours_saved")) {
          const hours = await db
            .select()
            .from(workerHours)
            .where(
              and(
                eq(workerHours.employerId, wizard.entityId),
                eq(workerHours.year, year),
                eq(workerHours.month, month)
              )
            );

          if (hours.length > 0) {
            const hoursIds = hours.map((h) => h.id);
            const deletedHours = await db
              .delete(ledger)
              .where(
                and(
                  inArray(ledger.referenceType, ["hours", "hour"]),
                  inArray(ledger.referenceId, hoursIds)
                )
              );
            entriesDeleted += deletedHours.rowCount ?? 0;
            logger.info("Deleted existing hours ledger entries before rerun", {
              wizardId,
              count: deletedHours.rowCount ?? 0,
              hoursCount: hours.length,
            });
          }

          for (const h of hours) {
            try {
              const result = await executeChargePlugins({
                trigger: TriggerType.HOURS_SAVED,
                hoursId: h.id,
                workerId: h.workerId,
                employerId: h.employerId,
                year: h.year,
                month: h.month,
                day: h.day,
                hours: h.hours || 0,
                employmentStatusId: h.employmentStatusId,
                home: h.home,
              });
              totalTransactions += result.totalTransactions.length;
              hoursProcessed++;
            } catch (err) {
              hoursErrors++;
              logger.error("Charge plugin rerun hours error", {
                hoursId: h.id,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }

        results.push({
          wizardId,
          employerId: wizard.entityId,
          employerName,
          year,
          month,
          wmbProcessed,
          wmbErrors,
          hoursProcessed,
          hoursErrors,
          totalTransactions,
          entriesDeleted,
        });
      }

      res.json({ results });
    } catch (error) {
      logger.error("Charge plugin rerun failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Rerun failed" });
    }
  });
}
