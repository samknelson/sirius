import type { IStorage } from "../storage";
import { z } from "zod";

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

// Reads and writes now go through the generic variable routes
// (GET/PUT /api/variables/by-name/worker_ban_notifications), governed by
// the variable registry (admin, with schema validation).
