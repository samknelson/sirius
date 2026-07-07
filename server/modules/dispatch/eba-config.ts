import type { IStorage } from "../../storage";
import { z } from "zod";

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

// Reads and writes now go through the generic variable routes
// (GET/PUT /api/variables/by-name/dispatch_eba_settings), governed by
// the variable registry (authenticated read + dispatch component;
// admin write with schema validation).
