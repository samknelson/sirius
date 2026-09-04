import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../components";
import { storage } from "../../../storage";
import {
  createBaoDpRateRequestSchema,
  updateBaoDpRateRequestSchema,
  listBaoDpRatesQuerySchema,
} from "../../../../shared/schema/sitespecific/bao/schema";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (
  policyId: string,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const RATES_TABLE_MISSING_MESSAGE =
  "DP rates table does not exist. Please enable the BAO component first.";

export function registerBaoDpRatesRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  _requirePermission: PermissionMiddleware,
  requireAccess: AccessMiddleware,
) {
  const ratesStorage = storage.baoDpRates;
  const componentMiddleware = requireComponent("sitespecific.bao");

  app.get(
    "/api/sitespecific/bao/dp/rates",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        if (!(await ratesStorage.tableExists())) {
          return res.status(503).json({ message: RATES_TABLE_MISSING_MESSAGE });
        }
        const query = listBaoDpRatesQuerySchema.parse({
          benefitId: req.query.benefitId || undefined,
          tierTransition: req.query.tierTransition || undefined,
          asOfYmd: req.query.asOfYmd || undefined,
        });
        const rates = await ratesStorage.list(query);
        res.json(rates);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid filters", errors: error.errors });
        }
        console.error("Failed to list DP rates:", error);
        res.status(500).json({ message: "Failed to list DP rates" });
      }
    },
  );

  app.get(
    "/api/sitespecific/bao/dp/rates/effective",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        if (!(await ratesStorage.tableExists())) {
          return res.status(503).json({ message: RATES_TABLE_MISSING_MESSAGE });
        }
        const query = listBaoDpRatesQuerySchema.parse({
          benefitId: req.query.benefitId || undefined,
          tierTransition: req.query.tierTransition || undefined,
          asOfYmd: req.query.asOfYmd || undefined,
        });
        if (!query.benefitId || !query.tierTransition) {
          return res
            .status(400)
            .json({ message: "benefitId and tierTransition are required" });
        }
        const asOf = query.asOfYmd ?? new Date().toISOString().slice(0, 10);
        const rate = await ratesStorage.getEffectiveRate(
          query.benefitId,
          query.tierTransition,
          asOf,
        );
        if (!rate) {
          return res.status(404).json({ message: "No effective rate found" });
        }
        res.json(rate);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid filters", errors: error.errors });
        }
        console.error("Failed to get effective DP rate:", error);
        res.status(500).json({ message: "Failed to get effective DP rate" });
      }
    },
  );

  app.post(
    "/api/sitespecific/bao/dp/rates",
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        if (!(await ratesStorage.tableExists())) {
          return res.status(503).json({ message: RATES_TABLE_MISSING_MESSAGE });
        }
        const parsed = createBaoDpRateRequestSchema.parse(req.body);
        const record = await ratesStorage.create({
          benefitId: parsed.benefitId,
          tierTransition: parsed.tierTransition,
          rate: String(parsed.rate),
          effectiveYmd: parsed.effectiveYmd,
          provisional: parsed.provisional ?? false,
        });
        res.status(201).json(record);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        if (error.code === "23505") {
          return res.status(409).json({
            message: "A rate already exists for this benefit, transition, and effective date",
          });
        }
        if (error.code === "23503") {
          return res.status(400).json({ message: "Unknown benefit" });
        }
        console.error("Failed to create DP rate:", error);
        res.status(500).json({ message: "Failed to create DP rate" });
      }
    },
  );

  app.patch(
    "/api/sitespecific/bao/dp/rates/:id",
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        if (!(await ratesStorage.tableExists())) {
          return res.status(503).json({ message: RATES_TABLE_MISSING_MESSAGE });
        }
        const parsed = updateBaoDpRateRequestSchema.parse(req.body);
        const record = await ratesStorage.update(req.params.id, {
          ...(parsed.benefitId !== undefined ? { benefitId: parsed.benefitId } : {}),
          ...(parsed.tierTransition !== undefined
            ? { tierTransition: parsed.tierTransition }
            : {}),
          ...(parsed.rate !== undefined ? { rate: String(parsed.rate) } : {}),
          ...(parsed.effectiveYmd !== undefined ? { effectiveYmd: parsed.effectiveYmd } : {}),
          ...(parsed.provisional !== undefined ? { provisional: parsed.provisional } : {}),
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
            message: "A rate already exists for this benefit, transition, and effective date",
          });
        }
        if (error.code === "23503") {
          return res.status(400).json({ message: "Unknown benefit" });
        }
        console.error("Failed to update DP rate:", error);
        res.status(500).json({ message: "Failed to update DP rate" });
      }
    },
  );

  app.delete(
    "/api/sitespecific/bao/dp/rates/:id",
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
        console.error("Failed to delete DP rate:", error);
        res.status(500).json({ message: "Failed to delete DP rate" });
      }
    },
  );
}
