import type { Express, Request, Response } from "express";
import type { IStorage } from "../../storage";
import { z } from "zod";
import { dispatchStatusEnum, type DispatchStatus } from "@shared/schema/dispatch/schema";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const VARIABLE_NAME = "dispatch_seniority_reset_settings";

const dispatchStatusSchema = z.enum(dispatchStatusEnum);

export const dispatchSeniorityResetSettingsSchema = z.object({
  triggerStatuses: z.array(dispatchStatusSchema).default(["notified"]),
});

export type DispatchSeniorityResetSettings = z.infer<typeof dispatchSeniorityResetSettingsSchema>;

const DEFAULT_SETTINGS: DispatchSeniorityResetSettings = {
  triggerStatuses: ["notified"],
};

export async function getSeniorityResetSettings(storage: IStorage): Promise<DispatchSeniorityResetSettings> {
  const variable = await storage.variables.getByName(VARIABLE_NAME);
  if (!variable) return DEFAULT_SETTINGS;
  try {
    return dispatchSeniorityResetSettingsSchema.parse(variable.value);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function registerDispatchSeniorityResetConfigRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  app.get(
    "/api/config/dispatch/seniority-reset",
    requireAuth,
    requireAccess('admin'),
    async (_req, res) => {
      try {
        const settings = await getSeniorityResetSettings(storage);
        res.json({ config: settings });
      } catch (error: any) {
        console.error("Error fetching dispatch seniority-reset config:", error);
        res.status(500).json({ message: error.message || "Failed to fetch config" });
      }
    }
  );

  app.put(
    "/api/config/dispatch/seniority-reset",
    requireAuth,
    requireAccess('admin'),
    async (req, res) => {
      try {
        const parseResult = dispatchSeniorityResetSettingsSchema.safeParse(req.body);
        if (!parseResult.success) {
          return res.status(400).json({
            message: "Invalid configuration format",
            errors: parseResult.error.errors,
          });
        }

        const config: DispatchSeniorityResetSettings = {
          triggerStatuses: Array.from(new Set(parseResult.data.triggerStatuses)) as DispatchStatus[],
        };

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
        console.error("Error saving dispatch seniority-reset config:", error);
        res.status(500).json({ message: error.message || "Failed to save config" });
      }
    }
  );
}
