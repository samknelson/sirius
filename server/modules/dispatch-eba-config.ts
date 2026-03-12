import type { Express, Request, Response } from "express";
import type { IStorage } from "../storage";
import { z } from "zod";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const VARIABLE_NAME = "dispatch_eba_settings";

export const dispatchEbaSettingsSchema = z.object({
  advanceDays: z.number().int().min(1).max(365).default(30),
});

export type DispatchEbaSettings = z.infer<typeof dispatchEbaSettingsSchema>;

const DEFAULT_SETTINGS: DispatchEbaSettings = {
  advanceDays: 30,
};

export async function getEbaSettings(storage: IStorage): Promise<DispatchEbaSettings> {
  const variable = await storage.variables.getByName(VARIABLE_NAME);
  if (!variable) return DEFAULT_SETTINGS;
  try {
    return dispatchEbaSettingsSchema.parse(variable.value);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function registerDispatchEbaConfigRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  app.get(
    "/api/config/dispatch/eba",
    requireAuth,
    requireAccess('admin'),
    async (_req, res) => {
      try {
        const settings = await getEbaSettings(storage);
        res.json({ config: settings });
      } catch (error: any) {
        console.error("Error fetching dispatch EBA config:", error);
        res.status(500).json({ message: error.message || "Failed to fetch config" });
      }
    }
  );

  app.put(
    "/api/config/dispatch/eba",
    requireAuth,
    requireAccess('admin'),
    async (req, res) => {
      try {
        const parseResult = dispatchEbaSettingsSchema.safeParse(req.body);
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
        console.error("Error saving dispatch EBA config:", error);
        res.status(500).json({ message: error.message || "Failed to save config" });
      }
    }
  );

  app.get(
    "/api/dispatch-eba/settings",
    requireAuth,
    async (_req, res) => {
      try {
        const settings = await getEbaSettings(storage);
        res.json({ advanceDays: settings.advanceDays });
      } catch (error: any) {
        console.error("Error fetching EBA settings:", error);
        res.status(500).json({ message: error.message || "Failed to fetch settings" });
      }
    }
  );
}
