import type { Express, Request, Response } from "express";
import type { IStorage } from "../storage";
import { z } from "zod";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const VARIABLE_NAME = "worker_ban_notifications";

export const workerBanNotificationConfigSchema = z.object({
  email: z.boolean().default(false),
  sms: z.boolean().default(false),
  inApp: z.boolean().default(false),
});

export type WorkerBanNotificationConfig = z.infer<typeof workerBanNotificationConfigSchema>;

const DEFAULT_CONFIG: WorkerBanNotificationConfig = {
  email: false,
  sms: false,
  inApp: false,
};

export async function getWorkerBanNotificationConfig(storage: IStorage): Promise<WorkerBanNotificationConfig> {
  const variable = await storage.variables.getByName(VARIABLE_NAME);
  if (!variable) {
    return DEFAULT_CONFIG;
  }

  try {
    return workerBanNotificationConfigSchema.parse(variable.value);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function registerWorkerBanConfigRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  app.get(
    "/api/config/workers/ban",
    requireAuth,
    requireAccess('admin'),
    async (_req, res) => {
      try {
        const config = await getWorkerBanNotificationConfig(storage);
        res.json({ config });
      } catch (error: any) {
        console.error("Error fetching worker ban config:", error);
        res.status(500).json({ message: error.message || "Failed to fetch config" });
      }
    }
  );

  app.put(
    "/api/config/workers/ban",
    requireAuth,
    requireAccess('admin'),
    async (req, res) => {
      try {
        const parseResult = workerBanNotificationConfigSchema.safeParse(req.body);
        if (!parseResult.success) {
          return res.status(400).json({
            message: "Invalid configuration format",
            errors: parseResult.error.errors,
          });
        }

        const config = parseResult.data;

        const existingVariable = await storage.variables.getByName(VARIABLE_NAME);

        if (existingVariable) {
          await storage.variables.update(existingVariable.id, { value: config });
        } else {
          await storage.variables.create({
            name: VARIABLE_NAME,
            value: config,
          });
        }

        res.json({
          message: "Configuration saved",
          config,
        });
      } catch (error: any) {
        console.error("Error saving worker ban config:", error);
        res.status(500).json({ message: error.message || "Failed to save config" });
      }
    }
  );
}
