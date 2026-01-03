import type { Express } from "express";
import type { WorkerWshStorage } from "../storage/worker-wsh";

export function registerWorkerWshRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any,
  requireAccess: any,
  workerWshStorage: WorkerWshStorage
) {
  // GET /api/workers/:workerId/wsh - Get work status history for a worker (requires worker.view policy: staff or worker with matching email)
  app.get("/api/workers/:workerId/wsh", requireAuth, requireAccess('worker.view', (req: any) => req.params.workerId), async (req, res) => {
    try {
      const { workerId } = req.params;
      const wshEntries = await workerWshStorage.getWorkerWsh(workerId);
      res.json(wshEntries);
    } catch (error) {
      console.error("Failed to fetch worker work status history:", error);
      res.status(500).json({ message: "Failed to fetch worker work status history" });
    }
  });

  // POST /api/workers/:workerId/wsh - Create a new work status history entry for a worker (requires workers.manage permission)
  app.post("/api/workers/:workerId/wsh", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { workerId } = req.params;
      const { date, wsId, data } = req.body;

      const wshEntry = await workerWshStorage.createWorkerWsh({
        workerId,
        date,
        wsId,
        data,
      });

      res.status(201).json(wshEntry);
    } catch (error: any) {
      console.error("Failed to create worker work status history:", error);
      if (error.message?.includes("duplicate key") || error.code === "23505") {
        return res.status(409).json({ message: "Work status history entry already exists" });
      }
      res.status(500).json({ message: "Failed to create worker work status history" });
    }
  });

  // PATCH /api/worker-wsh/:id - Update a worker work status history entry (requires workers.manage permission)
  app.patch("/api/worker-wsh/:id", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { id } = req.params;
      const { date, wsId, data } = req.body;

      const updated = await workerWshStorage.updateWorkerWsh(id, {
        date,
        wsId,
        data,
      });

      if (!updated) {
        return res.status(404).json({ message: "Worker work status history entry not found" });
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Failed to update worker work status history:", error);
      if (error.message?.includes("duplicate key") || error.code === "23505") {
        return res.status(409).json({ message: "Work status history entry already exists" });
      }
      res.status(500).json({ message: "Failed to update worker work status history" });
    }
  });

  // DELETE /api/worker-wsh/:id - Delete a worker work status history entry (requires workers.manage permission)
  app.delete("/api/worker-wsh/:id", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await workerWshStorage.deleteWorkerWsh(id);

      if (!deleted) {
        return res.status(404).json({ message: "Worker work status history entry not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete worker work status history:", error);
      res.status(500).json({ message: "Failed to delete worker work status history" });
    }
  });
}
