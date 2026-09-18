import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../components";
import { storage } from "../../../storage";
import { computeDpPaymentState } from "./dp-payment-state";
import {
  calculateDpCurrentMonthReport,
  DP_REPORT_STATUSES,
} from "../../../services/sitespecific/bao/dp-reporting";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (
  policyId: string,
  getEntityId?: (req: Request) => string | undefined | Promise<string | undefined>,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Worker-facing Domestic Partner (DP) charge / payment status routes.
 *
 * GET /api/workers/:workerId/sitespecific/bao/dp returns the per-month DP
 * charge and payment state from the DP payment-state module, enriched with
 * the DP dependents' names and the worker's entity-account id on the DP
 * billing account (so the client can link into the existing worker-owned
 * ledger payment flow — the same pattern as COBRA payments).
 */
export function registerBaoDpRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  _requirePermission: PermissionMiddleware,
  requireAccess: AccessMiddleware,
) {
  const componentMiddleware = requireComponent("sitespecific.bao");

  app.get(
    "/api/sitespecific/bao/dp-report/summary",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (_req, res) => {
      try {
        const report = await calculateDpCurrentMonthReport();
        const { rows: _rows, ...summary } = report;
        res.json(summary);
      } catch (error) {
        console.error("Failed to calculate DP report summary:", error);
        res.status(500).json({ message: "Failed to calculate Domestic Partner report" });
      }
    },
  );

  app.get(
    "/api/sitespecific/bao/dp-report/workers",
    requireAuth,
    componentMiddleware,
    requireAccess("staff"),
    async (req, res) => {
      try {
        const status = typeof req.query.status === "string" ? req.query.status : undefined;
        if (status && !DP_REPORT_STATUSES.includes(status as (typeof DP_REPORT_STATUSES)[number])) {
          return res.status(400).json({ message: "Invalid Domestic Partner report status" });
        }
        const report = await calculateDpCurrentMonthReport();
        const filtered = status
          ? report.rows.filter((row) => row.status === status)
          : report.rows;
        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));
        const start = (page - 1) * pageSize;
        res.json({
          asOfYmd: report.asOfYmd,
          currentMonth: report.currentMonth,
          data: filtered.slice(start, start + pageSize),
          total: filtered.length,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
          status: status ?? null,
        });
      } catch (error) {
        console.error("Failed to calculate DP report workers:", error);
        res.status(500).json({ message: "Failed to calculate Domestic Partner report" });
      }
    },
  );

  app.get(
    "/api/workers/:workerId/sitespecific/bao/dp",
    requireAuth,
    componentMiddleware,
    requireAccess("worker.dp", (req) => req.params.workerId),
    async (req, res) => {
      try {
        const workerId = req.params.workerId;
        const state = await computeDpPaymentState(workerId);
        if (!state) {
          // No enabled DP charge config / billing account: payment state
          // unknown. Surface that explicitly instead of guessing.
          return res.json({ configured: false, state: null, dependents: {}, eaId: null });
        }

        // Resolve DP dependent names, keyed by relationship id, from the
        // worker's domestic-partner relations (which carry the other
        // worker's name).
        const dependents: Record<string, string> = {};
        const dpRelations = await storage.workerRelations.searchWorkerRelations({
          workerId,
          relationTypeNameILike: "%domestic partner%",
        });
        for (const rel of dpRelations) {
          const other = rel.otherWorker;
          const name =
            other?.displayName ||
            [other?.given, other?.family].filter(Boolean).join(" ");
          if (name) dependents[rel.id] = name;
        }

        // The worker's entity account on the DP billing account, when it
        // exists (created by the charge run). Used for the pay link; never
        // created here — a read must not write.
        const eas = await storage.ledger.ea.getByEntity("worker", workerId);
        const ea = eas.find((e) => e.accountId === state.accountId) ?? null;

        res.json({
          configured: true,
          state,
          dependents,
          eaId: ea?.id ?? null,
        });
      } catch (error) {
        console.error("Failed to load worker DP screen:", error);
        res.status(500).json({ message: "Failed to load domestic partner information" });
      }
    },
  );
}
