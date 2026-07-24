import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../components";
import { storage } from "../../../storage";
import {
  createBaoPremiumRateRequestSchema,
  updateBaoPremiumRateRequestSchema,
  listBaoPremiumRatesQuerySchema,
} from "../../../../shared/schema/sitespecific/bao/schema";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (
  policyId: string,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const RATES_TABLE_MISSING_MESSAGE =
  "Premium rates table does not exist. Please enable the BAO component first.";

export function registerBaoPremiumRatesRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  _requirePermission: PermissionMiddleware,
  requireAccess: AccessMiddleware,
) {
  const ratesStorage = storage.baoPremiumRates;
  const componentMiddleware = requireComponent("sitespecific.bao");

  app.get(
    "/api/sitespecific/bao/premium/rates",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        if (!(await ratesStorage.tableExists())) {
          return res.status(503).json({ message: RATES_TABLE_MISSING_MESSAGE });
        }
        const query = listBaoPremiumRatesQuerySchema.parse({
          benefitId: req.query.benefitId || undefined,
          coverageTier: req.query.coverageTier || undefined,
          asOfYmd: req.query.asOfYmd || undefined,
        });
        const rates = await ratesStorage.list(query);
        res.json(rates);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid filters", errors: error.errors });
        }
        console.error("Failed to list premium rates:", error);
        res.status(500).json({ message: "Failed to list premium rates" });
      }
    },
  );

  app.post(
    "/api/sitespecific/bao/premium/rates",
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        if (!(await ratesStorage.tableExists())) {
          return res.status(503).json({ message: RATES_TABLE_MISSING_MESSAGE });
        }
        const parsed = createBaoPremiumRateRequestSchema.parse(req.body);
        const record = await ratesStorage.create({
          benefitId: parsed.benefitId,
          coverageTier: parsed.coverageTier,
          rate: String(parsed.rate),
          effectiveYmd: parsed.effectiveYmd,
        });
        res.status(201).json(record);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        if (error.code === "23505") {
          return res.status(409).json({
            message: "A rate already exists for this benefit, coverage tier, and effective date",
          });
        }
        if (error.code === "23503") {
          return res.status(400).json({ message: "Unknown benefit" });
        }
        console.error("Failed to create premium rate:", error);
        res.status(500).json({ message: "Failed to create premium rate" });
      }
    },
  );

  app.patch(
    "/api/sitespecific/bao/premium/rates/:id",
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        if (!(await ratesStorage.tableExists())) {
          return res.status(503).json({ message: RATES_TABLE_MISSING_MESSAGE });
        }
        const parsed = updateBaoPremiumRateRequestSchema.parse(req.body);
        const record = await ratesStorage.update(req.params.id, {
          ...(parsed.benefitId !== undefined ? { benefitId: parsed.benefitId } : {}),
          ...(parsed.coverageTier !== undefined ? { coverageTier: parsed.coverageTier } : {}),
          ...(parsed.rate !== undefined ? { rate: String(parsed.rate) } : {}),
          ...(parsed.effectiveYmd !== undefined ? { effectiveYmd: parsed.effectiveYmd } : {}),
        });
        if (!record) {
          return res.status(404).json({ message: "Rate entry not found" });
        }
        res.json(record);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        if (error.code === "23505") {
          return res.status(409).json({
            message: "A rate already exists for this benefit, coverage tier, and effective date",
          });
        }
        if (error.code === "23503") {
          return res.status(400).json({ message: "Unknown benefit" });
        }
        console.error("Failed to update premium rate:", error);
        res.status(500).json({ message: "Failed to update premium rate" });
      }
    },
  );

  app.delete(
    "/api/sitespecific/bao/premium/rates/:id",
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        if (!(await ratesStorage.tableExists())) {
          return res.status(503).json({ message: RATES_TABLE_MISSING_MESSAGE });
        }
        const deleted = await ratesStorage.delete(req.params.id);
        if (!deleted) {
          return res.status(404).json({ message: "Rate entry not found" });
        }
        res.status(204).send();
      } catch (error) {
        console.error("Failed to delete premium rate:", error);
        res.status(500).json({ message: "Failed to delete premium rate" });
      }
    },
  );
}
