import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAccess } from "../accessControl";
import { 
  getAllEligibilityPlugins, 
  getEligibilityPlugin,
  eligibilityPluginRegistry,
} from "../eligibility-plugins/registry";
import { evaluateBenefitEligibility } from "../eligibility-plugins/executor";
import type { EligibilityRule } from "../eligibility-plugins/types";
import { z } from "zod";
import { getEnabledComponentIds } from "./components";

const evaluateEligibilitySchema = z.object({
  benefitId: z.string().uuid(),
  policyId: z.string().uuid(),
  workerId: z.string().uuid(),
  scanType: z.enum(["start", "continue"]),
  asOfMonth: z.number().int().min(1).max(12).optional(),
  asOfYear: z.number().int().min(2000).max(2100).optional(),
  stopAfterIneligible: z.boolean().optional(),
});

export function registerEligibilityPluginRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
  requirePermission: (permission: string) => (req: Request, res: Response, next: NextFunction) => void
) {
  
  app.get("/api/eligibility-plugins", requireAuth, requireAccess('admin'), async (req, res) => {
    try {
      const enabledComponents = await getEnabledComponentIds();
      const registeredPlugins = eligibilityPluginRegistry.getAllFiltered(enabledComponents);
      
      const plugins = registeredPlugins.map(p => ({
        id: p.metadata.id,
        name: p.metadata.name,
        description: p.metadata.description,
      }));
      
      plugins.sort((a, b) => a.id.localeCompare(b.id));
      
      res.json(plugins);
    } catch (error) {
      console.error("Failed to fetch eligibility plugins:", error);
      res.status(500).json({ message: "Failed to fetch eligibility plugins" });
    }
  });

  app.get("/api/eligibility-plugins/:id", requireAuth, requireAccess('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const plugin = getEligibilityPlugin(id);
      
      if (!plugin) {
        return res.status(404).json({ message: "Eligibility plugin not found" });
      }

      const enabledComponents = await getEnabledComponentIds();
      const isEnabled = eligibilityPluginRegistry.isPluginEnabled(id, enabledComponents);
      
      if (!isEnabled) {
        return res.status(404).json({ 
          message: "Eligibility plugin not available",
          reason: "Required component is disabled"
        });
      }
      
      res.json({
        id: plugin.metadata.id,
        name: plugin.metadata.name,
        description: plugin.metadata.description,
      });
    } catch (error) {
      console.error("Failed to fetch eligibility plugin:", error);
      res.status(500).json({ message: "Failed to fetch eligibility plugin" });
    }
  });

  app.post("/api/eligibility/evaluate", requireAuth, requireAccess('admin'), async (req, res) => {
    try {
      const input = evaluateEligibilitySchema.parse(req.body);
      
      const policy = await storage.policies.getPolicyById(input.policyId);
      if (!policy) {
        return res.status(404).json({ message: "Policy not found" });
      }

      const policyData = (policy.data as Record<string, unknown>) || {};
      const eligibilityRules = (policyData.eligibilityRules as Record<string, EligibilityRule[]>) || {};
      const benefitRules = eligibilityRules[input.benefitId] || [];

      if (benefitRules.length === 0) {
        return res.json({
          benefitId: input.benefitId,
          eligible: true,
          results: [],
          message: "No eligibility rules configured for this benefit",
        });
      }

      const result = await evaluateBenefitEligibility(
        input.benefitId,
        benefitRules,
        {
          scanType: input.scanType,
          workerId: input.workerId,
          asOfMonth: input.asOfMonth,
          asOfYear: input.asOfYear,
          stopAfterIneligible: input.stopAfterIneligible,
        }
      );

      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      console.error("Failed to evaluate eligibility:", error);
      res.status(500).json({ message: "Failed to evaluate eligibility" });
    }
  });

  app.post("/api/eligibility/validate-config", requireAuth, requireAccess('admin'), async (req, res) => {
    try {
      const { pluginKey, config } = req.body;
      
      if (!pluginKey || typeof pluginKey !== 'string') {
        return res.status(400).json({ message: "pluginKey is required" });
      }
      
      const plugin = getEligibilityPlugin(pluginKey);
      if (!plugin) {
        return res.status(404).json({ message: `Plugin not found: ${pluginKey}` });
      }

      const validation = plugin.validateConfig(config);
      res.json(validation);
    } catch (error) {
      console.error("Failed to validate config:", error);
      res.status(500).json({ message: "Failed to validate configuration" });
    }
  });
}
