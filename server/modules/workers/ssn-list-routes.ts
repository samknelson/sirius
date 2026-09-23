import type { Express, RequestHandler } from "express";
import type { WorkerStorage, WorkersPaginationParams } from "../../storage/workers";
import { WorkerBenefitRoleFilterError } from "@shared/worker-benefit-role-filters";
import { parseWorkerSsnFilter, WorkerSsnFilterError } from "./ssn-filter";

type ListFilters = Omit<WorkersPaginationParams, "page" | "pageSize" | "ssnFilter">;

export function registerWorkerSsnListRoutes(
  app: Express,
  listAccess: RequestHandler,
  requireAuth: RequestHandler,
  requirePermission: (permission: string) => RequestHandler,
  workers: Pick<WorkerStorage, "getWorkersWithDetailsPaginated" | "getAllMatchingContactIds">,
  parseFilters: (body: Record<string, unknown>) => ListFilters,
): void {
  const ssnAccess = requirePermission("workers.ssn");
  app.post("/api/workers/with-details/paginated", listAccess, ssnAccess, async (req, res) => {
    try {
      const ssnFilter = parseWorkerSsnFilter(req.body?.ssn);
      const rawPage = Number(req.body?.page);
      const rawPageSize = Number(req.body?.pageSize);
      const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
      const pageSize = Number.isInteger(rawPageSize) && rawPageSize > 0 ? Math.min(rawPageSize, 100) : 50;
      const filters = parseFilters(req.body ?? {});
      res.json(await workers.getWorkersWithDetailsPaginated({ page, pageSize, ...filters, ssnFilter }));
    } catch (error) {
      if (error instanceof WorkerSsnFilterError || error instanceof WorkerBenefitRoleFilterError) {
        return res.status(400).json({ message: error.message });
      }
      console.error("Failed to fetch paginated workers");
      res.status(500).json({ message: "Failed to fetch workers" });
    }
  });
  app.post("/api/workers/with-details/all-ids", requireAuth, requirePermission("staff"), ssnAccess, async (req, res) => {
    try {
      const ssnFilter = parseWorkerSsnFilter(req.body?.ssn);
      const filters = parseFilters(req.body ?? {});
      const contactIds = await workers.getAllMatchingContactIds({ ...filters, ssnFilter });
      res.json({ contactIds, total: contactIds.length });
    } catch (error) {
      if (error instanceof WorkerSsnFilterError || error instanceof WorkerBenefitRoleFilterError) {
        return res.status(400).json({ message: error.message });
      }
      console.error("Failed to fetch matching worker contact IDs");
      res.status(500).json({ message: "Failed to fetch matching workers" });
    }
  });
}