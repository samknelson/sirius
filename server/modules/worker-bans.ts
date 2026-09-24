import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { requireComponent } from "./components";
import { workerBanPluginRegistry } from "../plugins/worker-bans/registry";
import { resolveBanType } from "../plugins/worker-bans/service";

type RequireAccess = (policy: string, getEntityId?: (req: Request) => string | Promise<string | undefined> | undefined) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const createWorkerBanApiSchema = z.object({
  workerId: z.string(),
  type: z.string().optional().nullable(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullable().optional(),
  message: z.string().nullable().optional(),
  data: z.record(z.unknown()).optional().nullable(),
});

const updateWorkerBanApiSchema = z.object({
  type: z.string().optional().nullable(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().nullable().optional(),
  message: z.string().nullable().optional(),
  data: z.record(z.unknown()).optional().nullable(),
});

/**
 * Validate a ban's type + argument payload: the type must resolve to a
 * configured ban type (or the legacy literal), and every required argument
 * field declared by the type's component-enabled plugins must be present in
 * `data`. Returns an error message or null when valid.
 */
async function validateBanTypeAndData(
  type: string | null | undefined,
  data: Record<string, unknown> | null | undefined,
): Promise<string | null> {
  if (!type) return null;
  const resolved = await resolveBanType({ id: "new", type });
  if (resolved.name === null && resolved.pluginIds.length === 0) {
    return "Unknown ban type";
  }
  const enabled = new Map(workerBanPluginRegistry.listEnabledSync().map((p) => [p.id, p]));
  for (const pluginId of resolved.pluginIds) {
    const plugin = enabled.get(pluginId);
    if (!plugin?.argumentSchema) continue;
    const required = (plugin.argumentSchema.required as string[] | undefined) ?? [];
    for (const field of required) {
      const value = (data ?? {})[field];
      if (value === undefined || value === null || value === "") {
        const props = plugin.argumentSchema.properties as Record<string, { title?: string }> | undefined;
        const label = props?.[field]?.title ?? field;
        return `${label} is required for a ${plugin.name} ban`;
      }
    }
  }
  return null;
}

export function registerWorkerBansRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess
) {
  const dispatchComponent = requireComponent("dispatch");

  app.get("/api/worker-bans/worker/:workerId", requireAuth, dispatchComponent, requireAccess('worker.view', req => req.params.workerId), async (req: Request, res: Response) => {
    try {
      const bans = await storage.workerBans.getByWorker(req.params.workerId);
      res.json(bans);
    } catch (error) {
      console.error("Error fetching worker bans:", error);
      res.status(500).json({ error: "Failed to fetch worker bans" });
    }
  });

  app.get("/api/worker-bans/:id", requireAuth, dispatchComponent, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ban = await storage.workerBans.get(req.params.id);
      if (!ban) {
        return res.status(404).json({ error: "Worker ban not found" });
      }
      (req as any).banEntry = Object.freeze({ ...ban });
      next();
    } catch (error) {
      console.error("Error fetching worker ban:", error);
      res.status(500).json({ error: "Failed to fetch worker ban" });
    }
  }, requireAccess('worker.view', req => (req as any).banEntry?.workerId), async (req: Request, res: Response) => {
    try {
      const ban = (req as any).banEntry;
      res.json(ban);
    } catch (error) {
      console.error("Error returning worker ban:", error);
      res.status(500).json({ error: "Failed to fetch worker ban" });
    }
  });

  app.post("/api/worker-bans", requireAuth, dispatchComponent, requireAccess('staff'), async (req: Request, res: Response) => {
    try {
      const validated = createWorkerBanApiSchema.parse(req.body);
      const typeError = await validateBanTypeAndData(validated.type, validated.data ?? undefined);
      if (typeError) {
        return res.status(400).json({ error: typeError });
      }
      const ban = await storage.workerBans.create({
        workerId: validated.workerId,
        type: validated.type ?? null,
        startDate: validated.startDate,
        endDate: validated.endDate ?? null,
        message: validated.message ?? null,
        data: validated.data ?? null,
      });
      res.status(201).json(ban);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      if (error instanceof Error) {
        console.error("Error creating worker ban:", error.message);
        return res.status(400).json({ error: error.message });
      }
      console.error("Error creating worker ban:", error);
      res.status(500).json({ error: "Failed to create worker ban" });
    }
  });

  app.put("/api/worker-bans/:id", requireAuth, dispatchComponent, requireAccess('staff'), async (req: Request, res: Response) => {
    try {
      const validated = updateWorkerBanApiSchema.parse(req.body);
      const existing = await storage.workerBans.get(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Worker ban not found" });
      }

      const effectiveType = validated.type !== undefined ? validated.type : existing.type;
      const effectiveData =
        validated.data !== undefined
          ? validated.data
          : (existing.data as Record<string, unknown> | null);
      const typeError = await validateBanTypeAndData(effectiveType, effectiveData ?? undefined);
      if (typeError) {
        return res.status(400).json({ error: typeError });
      }

      const updateData: Record<string, any> = {};
      if (validated.type !== undefined) updateData.type = validated.type;
      if (validated.startDate !== undefined) updateData.startDate = validated.startDate;
      if (validated.endDate !== undefined) updateData.endDate = validated.endDate ?? null;
      if (validated.message !== undefined) updateData.message = validated.message;
      if (validated.data !== undefined) updateData.data = validated.data;

      const ban = await storage.workerBans.update(req.params.id, updateData);
      if (!ban) {
        return res.status(404).json({ error: "Worker ban not found" });
      }
      res.json(ban);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid data", details: error.errors });
      }
      if (error instanceof Error) {
        console.error("Error updating worker ban:", error.message);
        return res.status(400).json({ error: error.message });
      }
      console.error("Error updating worker ban:", error);
      res.status(500).json({ error: "Failed to update worker ban" });
    }
  });

  app.delete("/api/worker-bans/:id", requireAuth, dispatchComponent, requireAccess('staff'), async (req: Request, res: Response) => {
    try {
      const deleted = await storage.workerBans.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Worker ban not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting worker ban:", error);
      res.status(500).json({ error: "Failed to delete worker ban" });
    }
  });
}
