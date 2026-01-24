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

export interface PluginConfigField {
  name: string;
  label: string;
  inputType: "select-options" | "text" | "number" | "checkbox";
  required: boolean;
  helperText?: string;
  selectOptionsType?: string;
  multiSelect?: boolean;
}

export interface EligibilityPluginMetadata {
  id: string;
  name: string;
  description: string;
  componentId: string;
  componentEnabled: boolean;
  configFields?: PluginConfigField[];
}

export interface JobTypeData {
  icon?: string;
  eligibility?: EligibilityPluginConfig[];
  minWorkers?: number;
  maxWorkers?: number;
}
