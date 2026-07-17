import type { IStorage } from "../../storage";
import { z } from "zod";
import { dispatchStatusEnum } from "@shared/schema/dispatch/schema";

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

// Reads and writes now go through the generic variable routes
// (GET/PUT /api/variables/by-name/dispatch_seniority_reset_settings),
// governed by the variable registry (admin + dispatch component, with
// schema validation and trigger-status dedup).
