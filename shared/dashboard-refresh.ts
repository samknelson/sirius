import { z } from "zod";

export const dashboardRefreshShape = {
  autoRefresh: z.boolean().default(false),
  refreshIntervalSeconds: z.number().int().min(10).max(86400).default(30),
};

export const dashboardRefreshSchema = z.object(dashboardRefreshShape);
export type DashboardRefreshSettings = z.infer<typeof dashboardRefreshSchema>;

/** Missing legacy settings are disabled, never an implicit opt-in. */
export function normalizeDashboardRefresh(value: unknown): DashboardRefreshSettings {
  const parsed = dashboardRefreshSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : { autoRefresh: false, refreshIntervalSeconds: 30 };
}
