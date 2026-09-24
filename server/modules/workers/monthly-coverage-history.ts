import type { Express, RequestHandler } from "express";
import type { buildWorkerMonthlyCoverageHistory } from "../../services/sitespecific/bao/worker-monthly-coverage-history";

export function registerWorkerMonthlyCoverageHistoryRoute(
  app: Express,
  workerView: RequestHandler,
  buildHistory?: typeof buildWorkerMonthlyCoverageHistory,
) {
  app.get("/api/workers/:workerId/benefits/monthly-history", workerView, async (req, res) => {
    const offset = Number(req.query.offset ?? 0);
    const limit = Number(req.query.limit ?? 12);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 24) {
      return res.status(400).json({ message: "Invalid history page" });
    }
    try {
      const builder = buildHistory ?? (await import("../../services/sitespecific/bao/worker-monthly-coverage-history")).buildWorkerMonthlyCoverageHistory;
      res.json(await builder(req.params.workerId, offset, limit));
    } catch (error) {
      console.error("Failed to fetch worker monthly coverage history:", error);
      res.status(500).json({ message: "Monthly coverage history unavailable" });
    }
  });
}