import type { Express, NextFunction, Request, Response } from "express";
import { requireComponent } from "../../components";
import { storage } from "../../../storage";
import {
  createBaoEeContributionRateRequestSchema,
  listBaoEeContributionRatesQuerySchema,
  updateBaoEeContributionRateRequestSchema,
} from "../../../../shared/schema/sitespecific/bao/schema";
import type { BaoEeContributionRatesStorage } from "../../../storage/sitespecific/bao/ee-contribution-rates";

type AuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void | Promise<unknown>;
type AccessMiddleware = (
  policyId: string,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<unknown>;

interface BaoEeContributionRatesRouteDependencies {
  ratesStorage?: BaoEeContributionRatesStorage;
  componentMiddleware?: AuthMiddleware;
}

const TABLE_MISSING_MESSAGE =
  "Employee contribution rates table does not exist. Please enable the BAO component first.";

export function registerBaoEeContributionRatesRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  _requirePermission: unknown,
  requireAccess: AccessMiddleware,
  dependencies: BaoEeContributionRatesRouteDependencies = {},
) {
  const ratesStorage = dependencies.ratesStorage ?? storage.baoEeContributionRates;
  const componentMiddleware =
    dependencies.componentMiddleware ?? requireComponent("sitespecific.bao");
  const path = "/api/policies/:policyId/bao-ee-contribution-rates";

  // Policy records themselves are admin-gated; contribution configuration
  // follows that same policy/account boundary rather than exposing a policy's
  // rates to a broader staff-only BAO endpoint.
  app.get(path, requireAuth, componentMiddleware, requireAccess("admin"), async (req, res) => {
    try {
      if (!(await ratesStorage.tableExists())) {
        return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
      }
      const query = listBaoEeContributionRatesQuerySchema.parse({
        policyId: req.params.policyId,
        benefitId: req.query.benefitId || undefined,
      });
      res.json(await ratesStorage.list(query));
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid filters", errors: error.errors });
      }
      console.error("Failed to list BAO employee contribution rates:", error);
      res.status(500).json({ message: "Failed to list employee contribution rates" });
    }
  });

  app.post(path, requireAuth, componentMiddleware, requireAccess("admin"), async (req, res) => {
    try {
      if (!(await ratesStorage.tableExists())) {
        return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
      }
      const parsed = createBaoEeContributionRateRequestSchema.parse({
        ...req.body,
        policyId: req.params.policyId,
      });
      res.status(201).json(await ratesStorage.create(parsed));
    } catch (error: any) {
      if (error.name === "ZodError") {
        return res.status(400).json({ message: "Invalid data", errors: error.errors });
      }
      if (error.code === "23505") {
        return res.status(409).json({
          message: "A contribution rate already exists for this policy, benefit, and effective date",
        });
      }
      if (error.code === "23503") {
        return res.status(400).json({ message: "Unknown policy or benefit" });
      }
      console.error("Failed to create BAO employee contribution rate:", error);
      res.status(500).json({ message: "Failed to create employee contribution rate" });
    }
  });

  app.patch(
    `${path}/:id`,
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        if (!(await ratesStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const existing = await ratesStorage.get(req.params.id);
        if (!existing || existing.policyId !== req.params.policyId) {
          return res.status(404).json({ message: "Rate entry not found" });
        }
        const parsed = updateBaoEeContributionRateRequestSchema.parse(req.body);
        const record = await ratesStorage.update(req.params.id, parsed);
        res.json(record);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        if (error.code === "23505") {
          return res.status(409).json({
            message: "A contribution rate already exists for this policy, benefit, and effective date",
          });
        }
        if (error.code === "23503") {
          return res.status(400).json({ message: "Unknown benefit" });
        }
        console.error("Failed to update BAO employee contribution rate:", error);
        res.status(500).json({ message: "Failed to update employee contribution rate" });
      }
    },
  );

  app.delete(
    `${path}/:id`,
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        if (!(await ratesStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const existing = await ratesStorage.get(req.params.id);
        if (!existing || existing.policyId !== req.params.policyId) {
          return res.status(404).json({ message: "Rate entry not found" });
        }
        await ratesStorage.delete(req.params.id);
        res.status(204).send();
      } catch (error) {
        console.error("Failed to delete BAO employee contribution rate:", error);
        res.status(500).json({ message: "Failed to delete employee contribution rate" });
      }
    },
  );
}