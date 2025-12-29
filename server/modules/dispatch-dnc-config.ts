import type { Express, Request, Response } from "express";
import type { IStorage } from "../storage";
import { policies } from "../policies";
import { z } from "zod";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

const VARIABLE_NAME = "dispatch_dnc_notifications";

export const dispatchDncNotificationConfigSchema = z.object({
  email: z.boolean().default(false),
  sms: z.boolean().default(false),
  inApp: z.boolean().default(false),
});

export type DispatchDncNotificationConfig = z.infer<typeof dispatchDncNotificationConfigSchema>;

const DEFAULT_CONFIG: DispatchDncNotificationConfig = {
  email: false,
  sms: false,
  inApp: false,
};

export function registerDispatchDncConfigRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  app.get(
    "/api/config/dispatch/dnc",
    requireAuth,
    requireAccess(policies.admin),
    async (_req, res) => {
      try {
        const variable = await storage.variables.getByName(VARIABLE_NAME);
        if (!variable) {
          return res.json({ config: DEFAULT_CONFIG });
        }

        let config: DispatchDncNotificationConfig;
        try {
          config = dispatchDncNotificationConfigSchema.parse(variable.value);
        } catch {
          return res.json({ config: DEFAULT_CONFIG });
        }

        res.json({ config });
      } catch (error: any) {
        console.error("Error fetching dispatch DNC config:", error);
        res.status(500).json({ message: error.message || "Failed to fetch config" });
      }
    }
  );

  app.put(
    "/api/config/dispatch/dnc",
    requireAuth,
    requireAccess(policies.admin),
    async (req, res) => {
      try {
        const parseResult = dispatchDncNotificationConfigSchema.safeParse(req.body);
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
        console.error("Error saving dispatch DNC config:", error);
        res.status(500).json({ message: error.message || "Failed to save config" });
      }
    }
  );
}
