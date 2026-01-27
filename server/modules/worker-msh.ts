import type { Express } from "express";
import type { WorkerMshStorage } from "../storage/worker-msh";

export function registerWorkerMshRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any,
  requireAccess: any,
  workerMshStorage: WorkerMshStorage
) {
  app.get("/api/workers/:workerId/msh", requireAuth, requireAccess('worker.view', (req: any) => req.params.workerId), async (req, res) => {
    try {
      const { workerId } = req.params;
      const mshEntries = await workerMshStorage.getWorkerMsh(workerId);
      res.json(mshEntries);
    } catch (error) {
      console.error("Failed to fetch worker member status history:", error);
      res.status(500).json({ message: "Failed to fetch worker member status history" });
    }
  });

  app.post("/api/workers/:workerId/msh", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { workerId } = req.params;
      const { date, msId, industryId, data } = req.body;

      const mshEntry = await workerMshStorage.createWorkerMsh({
        workerId,
        date,
        msId,
        industryId,
        data,
      });

      res.status(201).json(mshEntry);
    } catch (error: any) {
      console.error("Failed to create worker member status history:", error);
      if (error.message?.includes("duplicate key") || error.code === "23505") {
        return res.status(409).json({ message: "Member status history entry already exists for this industry and date" });
      }
      res.status(500).json({ message: "Failed to create worker member status history" });
    }
  });

  app.patch("/api/worker-msh/:id", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { id } = req.params;
      const { date, msId, industryId, data } = req.body;

      const updated = await workerMshStorage.updateWorkerMsh(id, {
        date,
        msId,
        industryId,
        data,
      });

      if (!updated) {
        return res.status(404).json({ message: "Worker member status history entry not found" });
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Failed to update worker member status history:", error);
      if (error.message?.includes("duplicate key") || error.code === "23505") {
        return res.status(409).json({ message: "Member status history entry already exists for this industry and date" });
      }
      res.status(500).json({ message: "Failed to update worker member status history" });
    }
  });

  app.delete("/api/worker-msh/:id", requireAuth, requirePermission("staff"), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await workerMshStorage.deleteWorkerMsh(id);

      if (!deleted) {
        return res.status(404).json({ message: "Worker member status history entry not found" });
      }

      res.status(204).send();
    } catch (error) {
      console.error("Failed to delete worker member status history:", error);
      res.status(500).json({ message: "Failed to delete worker member status history" });
    }
  });
}
