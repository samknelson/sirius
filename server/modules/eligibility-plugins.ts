import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { requireAccess } from "../services/access-policy-evaluator";
import {
  getEligibilityPlugin,
} from "../plugins/trust/eligibility/registry";
import {
  evaluateBenefitEligibility,
  validateEligibilityRelationship,
  EligibilityRelationshipError,
} from "../plugins/trust/eligibility/executor";
import type { EligibilityRule } from "../plugins/trust/eligibility/types";
import { z } from "zod";

const evaluateEligibilitySchema = z.object({
  benefitId: z.string().uuid(),
  policyId: z.string().uuid(),
  workerId: z.string().uuid(),
  scanType: z.enum(["start", "continue"]),
  asOfMonth: z.number().int().min(1).max(12).optional(),
  asOfYear: z.number().int().min(2000).max(2100).optional(),
  stopAfterIneligible: z.boolean().optional(),
  relationship: z
    .object({
      dependentWorkerId: z.string().uuid(),
    })
    .optional(),
});

export function registerEligibilityPluginRoutes(
  app: Express,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
  requirePermission: (permission: string) => (req: Request, res: Response, next: NextFunction) => void
) {
  
  // NOTE: GET /api/eligibility-plugins and GET /api/eligibility-plugins/:id
  // were removed in Task #208. The trust eligibility plugin manifest is
  // now served by the unified endpoint at
  // GET /api/plugins/trust-eligibility/manifest. Per-plugin detail lookups
  // simply read the matching entry from that manifest on the client.

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
        // Even when no rules exist, hard-validate any supplied
        // relationship so bad inputs surface as 400 instead of a
        // misleading "eligible" response.
        const now = new Date();
        await validateEligibilityRelationship(
          input.workerId,
          input.relationship,
          input.asOfMonth ?? now.getMonth() + 1,
          input.asOfYear ?? now.getFullYear(),
        );
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
          relationship: input.relationship,
        }
      );

      res.json(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.errors });
      }
      if (error instanceof EligibilityRelationshipError) {
        return res.status(400).json({ message: error.message });
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

      const validation = await plugin.validateConfig(config);
      res.json(validation);
    } catch (error) {
      console.error("Failed to validate config:", error);
      res.status(500).json({ message: "Failed to validate configuration" });
    }
  });
}
