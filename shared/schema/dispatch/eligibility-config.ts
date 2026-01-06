import { z } from "zod";

export const eligibilityPluginConfigSchema = z.object({
  pluginId: z.string(),
  enabled: z.boolean().default(true),
  config: z.record(z.unknown()).default({}),
});

export const jobTypeEligibilitySchema = z.object({
  eligibility: z.array(eligibilityPluginConfigSchema).default([]),
});

export type EligibilityPluginConfig = z.infer<typeof eligibilityPluginConfigSchema>;
export type JobTypeEligibility = z.infer<typeof jobTypeEligibilitySchema>;

export interface EligibilityPluginMetadata {
  id: string;
  name: string;
  description: string;
  componentId: string;
  componentEnabled: boolean;
}

export interface JobTypeData {
  icon?: string;
  eligibility?: EligibilityPluginConfig[];
  minWorkers?: number;
  maxWorkers?: number;
}
