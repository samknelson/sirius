import type { Express } from "express";
import type { WorkerHoursStorage } from "../storage/worker-hours";
import type { LedgerStorage } from "../storage/ledger";

export function registerWorkerHoursRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any,
  requireAccess: any,
  workerHoursStorage: WorkerHoursStorage,
  ledgerStorage: LedgerStorage
) {
  // GET /api/workers/:workerId/hours - Get hours for a worker with optional view parameter
  app.get("/api/workers/:workerId/hours", requireAuth, requireAccess('worker.view', (req: any) => req.params.workerId), async (req, res) => {
    try {
      const { workerId } = req.params;
      const view = (req.query.view as string) || 'daily';
      
      let hours;
      switch (view) {
        case 'current':
          hours = await workerHoursStorage.getWorkerHoursCurrent(workerId);
          break;
        case 'history':
          hours = await workerHoursStorage.getWorkerHoursHistory(workerId);
          break;
        case 'monthly':
          hours = await workerHoursStorage.getWorkerHoursMonthly(workerId);
          break;
        case 'daily':
        default:
          hours = await workerHoursStorage.getWorkerHours(workerId);
          break;
      }
      
      res.json(hours);
    } catch (error) {
      console.error("Failed to fetch worker hours:", error);
      res.status(500).json({ message: "Failed to fetch worker hours" });
    }
  });

  // POST /api/workers/:workerId/hours - Create a new hours entry for a worker
  app.post("/api/workers/:workerId/hours", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { workerId } = req.params;
      const { month, year, day, employerId, employmentStatusId, hours, home } = req.body;

      if (!month || !year || !day || !employerId || !employmentStatusId) {
        return res.status(400).json({ message: "Month, year, day, employer ID, and employment status ID are required" });
      }

      const result = await workerHoursStorage.createWorkerHours({
        workerId,
        month,
        year,
        day,
        employerId,
        employmentStatusId,
        hours: hours ?? null,
        home: home ?? false,
      });

      res.status(201).json({
        ...result.data,
        ledgerNotifications: result.notifications || [],
      });
    } catch (error: any) {
      console.error("Failed to create worker hours:", error);
      if (error.message?.includes("duplicate key") || error.code === "23505") {
        return res.status(409).json({ message: "Hours entry already exists for this worker, employer, and date" });
      }
      res.status(500).json({ message: "Failed to create worker hours" });
    }
  });

  // GET /api/worker-hours/:id - Get a single worker hours entry
  app.get("/api/worker-hours/:id", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { id } = req.params;
      const hoursEntry = await workerHoursStorage.getWorkerHoursById(id);

      if (!hoursEntry) {
        return res.status(404).json({ message: "Hours entry not found" });
      }

      res.json(hoursEntry);
    } catch (error) {
      console.error("Failed to fetch hours entry:", error);
      res.status(500).json({ message: "Failed to fetch hours entry" });
    }
  });

  // PATCH /api/worker-hours/:id - Update a worker hours entry
  app.patch("/api/worker-hours/:id", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { id } = req.params;
      const { year, month, day, employerId, employmentStatusId, hours, home } = req.body;

      const result = await workerHoursStorage.updateWorkerHours(id, {
        year,
        month,
        day,
        employerId,
        employmentStatusId,
        hours,
        home,
      });

      if (!result) {
        return res.status(404).json({ message: "Worker hours entry not found" });
      }

      res.json({
        ...result.data,
        ledgerNotifications: result.notifications || [],
      });
    } catch (error: any) {
      console.error("Failed to update worker hours:", error);
      if (error.message?.includes("duplicate key") || error.code === "23505") {
        return res.status(409).json({ message: "Hours entry already exists for this worker, employer, and date" });
      }
      res.status(500).json({ message: "Failed to update worker hours" });
    }
  });

  // DELETE /api/worker-hours/:id - Delete a worker hours entry
  app.delete("/api/worker-hours/:id", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { id } = req.params;
      const result = await workerHoursStorage.deleteWorkerHours(id);

      if (!result.success) {
        return res.status(404).json({ message: "Worker hours entry not found" });
      }

      if (result.notifications && result.notifications.length > 0) {
        res.json({ ledgerNotifications: result.notifications });
      } else {
        res.status(204).send();
      }
    } catch (error) {
      console.error("Failed to delete worker hours:", error);
      res.status(500).json({ message: "Failed to delete worker hours" });
    }
  });

  // GET /api/worker-hours/:id/transactions - Get ledger entries for an hours entry
  app.get("/api/worker-hours/:id/transactions", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { id } = req.params;
      
      const hoursEntry = await workerHoursStorage.getWorkerHoursById(id);
      
      if (!hoursEntry) {
        return res.json([]);
      }
      
      const newFormatTransactions = await ledgerStorage.entries.getTransactions({
        referenceType: "hour",
        referenceId: id,
      });
      
      const compositeReferenceId = `${hoursEntry.workerId}:${hoursEntry.employerId}:${hoursEntry.year}:${hoursEntry.month}`;
      const legacyTransactions = await ledgerStorage.entries.getTransactions({
        referenceType: "hour",
        referenceId: compositeReferenceId,
      });
      
      const hoursTypeTransactions = await ledgerStorage.entries.getTransactions({
        referenceType: "hours",
        referenceId: id,
      });
      
      const allTransactions = [...newFormatTransactions, ...legacyTransactions, ...hoursTypeTransactions];
      const uniqueTransactions = allTransactions.filter((tx, index, self) => 
        index === self.findIndex(t => t.id === tx.id)
      );
      
      res.json(uniqueTransactions);
    } catch (error) {
      console.error("Failed to fetch hours transactions:", error);
      res.status(500).json({ message: "Failed to fetch hours transactions" });
    }
  });
}
