import { z } from "zod";

export const dispatchDncNotificationConfigSchema = z.object({
  email: z.boolean().default(false),
  sms: z.boolean().default(false),
  inApp: z.boolean().default(false),
});

export type DispatchDncNotificationConfig = z.infer<typeof dispatchDncNotificationConfigSchema>;

// Reads and writes now go through the generic variable routes
// (GET/PUT /api/variables/by-name/dispatch_dnc_notifications), governed
// by the variable registry (admin + dispatch component, with schema
// validation).
