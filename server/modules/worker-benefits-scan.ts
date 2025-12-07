import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { IStorage } from "../storage";
import { policies } from "../policies";
import { runBenefitsScan } from "../services/benefits-scan";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const scanRequestSchema = z.object({
  month: z.number().min(1).max(12),
  year: z.number().min(2000).max(2100),
  mode: z.enum(["test", "live"]),
});

export function registerWorkerBenefitsScanRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  app.post(
    "/api/workers/:id/benefits/scan",
    requireAuth,
    requireAccess(policies.workersManage),
    async (req, res) => {
      try {
        const { id: workerId } = req.params;

        const validationResult = scanRequestSchema.safeParse(req.body);
        if (!validationResult.success) {
          return res.status(400).json({
            message: "Validation error",
            errors: validationResult.error.errors,
          });
        }

        const { month, year, mode } = validationResult.data;

        const result = await runBenefitsScan(storage, workerId, month, year, mode);
        
        res.json(result);
      } catch (error: any) {
        console.error("Benefits scan error:", error);
        res.status(500).json({
          message: error.message || "Failed to run benefits scan",
        });
      }
    }
  );
}
