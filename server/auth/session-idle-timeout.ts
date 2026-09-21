import { z } from "zod";
import type { IStorage } from "../storage";

export const SESSION_IDLE_TIMEOUT_VARIABLE = "session_idle_timeout";
export const SESSION_IDLE_TIMEOUT_MINUTES_MIN = 5;
export const SESSION_IDLE_TIMEOUT_MINUTES_MAX = 30 * 24 * 60;

export const sessionIdleTimeoutSchema = z.object({
  enabled: z.boolean(),
  timeoutMinutes: z
    .number()
    .int()
    .min(SESSION_IDLE_TIMEOUT_MINUTES_MIN)
    .max(SESSION_IDLE_TIMEOUT_MINUTES_MAX),
});

export type SessionIdleTimeoutSettings = z.infer<typeof sessionIdleTimeoutSchema>;

export const DEFAULT_SESSION_IDLE_TIMEOUT: SessionIdleTimeoutSettings = {
  enabled: false,
  timeoutMinutes: 60,
};

export async function getSessionIdleTimeoutSettings(
  storage: Pick<IStorage, "variables">,
): Promise<SessionIdleTimeoutSettings> {
  const variable = await storage.variables.getByName(SESSION_IDLE_TIMEOUT_VARIABLE);
  if (!variable) return DEFAULT_SESSION_IDLE_TIMEOUT;
  const parsed = sessionIdleTimeoutSchema.safeParse(variable.value);
  return parsed.success ? parsed.data : DEFAULT_SESSION_IDLE_TIMEOUT;
}
