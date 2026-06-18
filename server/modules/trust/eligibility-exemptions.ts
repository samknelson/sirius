import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireComponent } from "../components";
import { TrustBenefitEligibilityExemptionValidationError } from "../../storage/trust/eligibility-exemptions";

type RequireAccess = (
  policy: string,
  getEntityId?: (req: Request) => string | Promise<string | undefined> | undefined,
) => (req: Request, res: Response, next: NextFunction) => void;
type RequireAuth = (req: Request, res: Response, next: NextFunction) => void;

function handleError(res: Response, error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    return res.status(400).json({ error: "Invalid data", details: error.errors });
  }
  if (error instanceof TrustBenefitEligibilityExemptionValidationError) {
    return res.status(400).json({ error: error.message, field: error.field });
  }
  console.error(fallback, error);
  if (error instanceof Error) {
    return res.status(500).json({ error: fallback, details: error.message });
  }
  return res.status(500).json({ error: fallback });
}

export function registerTrustBenefitEligibilityExemptionsRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
) {
  const exemptionsComponent = requireComponent("trust.benefits.eligibility.exemptions");

  // List exemptions for a worker (staff-only)
  app.get(
    "/api/workers/:id/benefits/exemptions",
    requireAuth,
    exemptionsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const rows = await storage.trustBenefitEligibilityExemptions.listByWorker(req.params.id);
        res.json(rows);
      } catch (error) {
        handleError(res, error, "Failed to fetch eligibility exemptions");
      }
    },
  );

  // Get one exemption (staff-only)
  app.get(
    "/api/benefits/exemptions/:id",
    requireAuth,
    exemptionsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const row = await storage.trustBenefitEligibilityExemptions.getById(req.params.id);
        if (!row) return res.status(404).json({ error: "Eligibility exemption not found" });
        res.json(row);
      } catch (error) {
        handleError(res, error, "Failed to fetch eligibility exemption");
      }
    },
  );

  // Create
  app.post(
    "/api/workers/:id/benefits/exemptions",
    requireAuth,
    exemptionsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const created = await storage.trustBenefitEligibilityExemptions.create(req.params.id, req.body);
        res.status(201).json(created);
      } catch (error) {
        handleError(res, error, "Failed to create eligibility exemption");
      }
    },
  );

  // Update (subscriberWorkerId immutable)
  app.patch(
    "/api/benefits/exemptions/:id",
    requireAuth,
    exemptionsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const updated = await storage.trustBenefitEligibilityExemptions.update(req.params.id, req.body);
        if (!updated) return res.status(404).json({ error: "Eligibility exemption not found" });
        res.json(updated);
      } catch (error) {
        handleError(res, error, "Failed to update eligibility exemption");
      }
    },
  );

  // Delete
  app.delete(
    "/api/benefits/exemptions/:id",
    requireAuth,
    exemptionsComponent,
    requireAccess('staff'),
    async (req: Request, res: Response) => {
      try {
        const deleted = await storage.trustBenefitEligibilityExemptions.delete(req.params.id);
        if (!deleted) return res.status(404).json({ error: "Eligibility exemption not found" });
        res.status(204).send();
      } catch (error) {
        handleError(res, error, "Failed to delete eligibility exemption");
      }
    },
  );
}
