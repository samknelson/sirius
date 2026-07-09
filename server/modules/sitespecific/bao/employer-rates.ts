import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../components";
import { storage } from "../../../storage";
import {
  bulkUpsertBaoEmployerRatesRequestSchema,
  updateBaoEmployerRateRequestSchema,
  listBaoEmployerRatesQuerySchema,
  type InsertBaoEmployerRate,
} from "../../../../shared/schema/sitespecific/bao/schema";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (
  policyId: string,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

const TABLE_MISSING_MESSAGE =
  "BAO Employer Rates table does not exist. Please enable the BAO component first.";

export function registerBaoEmployerRatesRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  _requirePermission: PermissionMiddleware,
  requireAccess: AccessMiddleware,
) {
  const ratesStorage = storage.baoEmployerRates;
  const componentMiddleware = requireComponent("sitespecific.bao");

  app.get(
    "/api/sitespecific/bao/employer-rates",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        if (!(await ratesStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const query = listBaoEmployerRatesQuerySchema.parse({
          employerId: req.query.employerId || undefined,
          accountId: req.query.accountId || undefined,
          sourceId: req.query.sourceId || undefined,
          fromYmd: req.query.fromYmd || undefined,
          toYmd: req.query.toYmd || undefined,
          mode: req.query.mode || undefined,
        });
        const rates = await ratesStorage.list(query);
        res.json(rates);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid filters", errors: error.errors });
        }
        console.error("Failed to list BAO employer rates:", error);
        res.status(500).json({ message: "Failed to list employer rates" });
      }
    },
  );

  app.post(
    "/api/sitespecific/bao/employer-rates/bulk",
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        if (!(await ratesStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const parsed = bulkUpsertBaoEmployerRatesRequestSchema.parse(req.body);
        if (parsed.sourceId) {
          const missing = await storage.baoRateSources.missingEmployerAssociations(
            parsed.sourceId,
            parsed.employerIds,
          );
          if (missing.length > 0) {
            return res.status(400).json({
              message:
                "The selected source is not associated with all selected employers. Add the employer(s) to the source first.",
              employerIds: missing,
            });
          }
        }
        const entries: InsertBaoEmployerRate[] = parsed.employerIds.flatMap((employerId) =>
          parsed.rates.map((r) => ({
            employerId,
            accountId: r.accountId,
            rate: String(r.rate),
            effectiveYmd: parsed.effectiveYmd,
            sourceId: parsed.sourceId ?? null,
          })),
        );
        const results = await ratesStorage.bulkUpsert(entries);
        res.status(201).json(results);
      } catch (error: any) {
        if (error.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        if (error.code === "23503") {
          return res.status(400).json({ message: "Unknown employer or fund account" });
        }
        console.error("Failed to bulk upsert BAO employer rates:", error);
        res.status(500).json({ message: "Failed to save employer rates" });
      }
    },
  );

  app.patch(
    "/api/sitespecific/bao/employer-rates/:id",
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        if (!(await ratesStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const parsed = updateBaoEmployerRateRequestSchema.parse(req.body);
        if (parsed.sourceId) {
          const existing = await ratesStorage.get(req.params.id);
          if (!existing) {
            return res.status(404).json({ message: "Rate entry not found" });
          }
          const missing = await storage.baoRateSources.missingEmployerAssociations(
            parsed.sourceId,
            [existing.employerId],
          );
          if (missing.length > 0) {
            return res.status(400).json({
              message:
                "The selected source is not associated with this rate's employer. Add the employer to the source first.",
            });
          }
        }
        const record = await ratesStorage.update(req.params.id, {
          ...(parsed.rate !== undefined ? { rate: String(parsed.rate) } : {}),
          ...(parsed.effectiveYmd !== undefined ? { effectiveYmd: parsed.effectiveYmd } : {}),
          ...(parsed.sourceId !== undefined ? { sourceId: parsed.sourceId } : {}),
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
            message: "A rate already exists for this employer, account, and effective date",
          });
        }
        console.error("Failed to update BAO employer rate:", error);
        res.status(500).json({ message: "Failed to update employer rate" });
      }
    },
  );

  app.delete(
    "/api/sitespecific/bao/employer-rates/:id",
    requireAuth,
    componentMiddleware,
    requireAccess("admin"),
    async (req, res) => {
      try {
        if (!(await ratesStorage.tableExists())) {
          return res.status(503).json({ message: TABLE_MISSING_MESSAGE });
        }
        const deleted = await ratesStorage.delete(req.params.id);
        if (!deleted) {
          return res.status(404).json({ message: "Rate entry not found" });
        }
        res.status(204).send();
      } catch (error) {
        console.error("Failed to delete BAO employer rate:", error);
        res.status(500).json({ message: "Failed to delete employer rate" });
      }
    },
  );
}
