import type { Express, Request, Response } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { storage } from "../../storage";
import { requireComponent } from "../components";

type RequireAccess = (policy: string, getEntityId?: (req: Request) => string | Promise<string | undefined> | undefined) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

// Blank clears the code. Anything else is stored trimmed.
const setCodeSchema = z.object({
  accessCode: z.string().nullable(),
});

/**
 * Worker Access Tokens (`worker.aat`).
 *
 * Every route is gated with the `worker.mine` entity policy against the
 * worker id in the path, so staff qualify for any worker and a worker
 * qualifies for their own record only.
 */
export function registerWorkerAatRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
) {
  const aatComponent = requireComponent("worker.aat");
  const workerIdParam = (req: Request) => req.params.workerId;

  // Read: returns null when the worker has no access-token row yet, so the
  // page can render its "nothing issued" empty state without a 404 dance.
  app.get(
    "/api/workers/:workerId/aat",
    requireAuth,
    aatComponent,
    requireAccess("worker.mine", workerIdParam),
    async (req: Request, res: Response) => {
      try {
        const record = await storage.workerAat.getByWorker(req.params.workerId);
        res.json(record ?? null);
      } catch (error) {
        console.error("Error fetching worker access token:", error);
        res.status(500).json({ error: "Failed to fetch access token" });
      }
    },
  );

  // Generate / regenerate the access UUID. Creates the row on first use.
  app.post(
    "/api/workers/:workerId/aat/uuid",
    requireAuth,
    aatComponent,
    requireAccess("worker.mine", workerIdParam),
    async (req: Request, res: Response) => {
      try {
        const record = await storage.workerAat.setAccessUuid(req.params.workerId, randomUUID());
        res.json(record);
      } catch (error) {
        console.error("Error generating worker access UUID:", error);
        res.status(500).json({ error: "Failed to generate access UUID" });
      }
    },
  );

  // Set, change, or clear the access code. Creates the row on first use.
  app.put(
    "/api/workers/:workerId/aat/code",
    requireAuth,
    aatComponent,
    requireAccess("worker.mine", workerIdParam),
    async (req: Request, res: Response) => {
      try {
        const { accessCode } = setCodeSchema.parse(req.body ?? {});
        const trimmed = accessCode?.trim() ?? "";
        const workerId = req.params.workerId;

        if (!trimmed) {
          // Clearing a code the worker never had is a no-op, not an error:
          // there is simply no row to clear.
          const cleared = await storage.workerAat.clearAccessCode(workerId);
          return res.json(cleared ?? null);
        }

        const record = await storage.workerAat.setAccessCode(workerId, trimmed);
        res.json(record);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: "Invalid data", details: error.errors });
        }
        console.error("Error saving worker access code:", error);
        res.status(500).json({ error: "Failed to save access code" });
      }
    },
  );
}
