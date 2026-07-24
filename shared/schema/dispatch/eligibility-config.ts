import { z } from "zod";
import type { JsonSchema } from "../../json-schema-form";

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
  configSchema?: JsonSchema;
}

export type NotificationMedia = 'email' | 'sms' | 'in-app';

/**
 * Controls how dispatches for a job type get their is_primary flag.
 * - "primary": dispatches are always primary
 * - "both": primary if the worker has no accepted primary dispatch, otherwise secondary
 * - "secondary": dispatches are always secondary (default when absent)
 */
export const jobTypePrimarySettingEnum = ["primary", "both", "secondary"] as const;
export type JobTypePrimarySetting = typeof jobTypePrimarySettingEnum[number];

export interface JobTypeData {
  icon?: string;
  primary?: JobTypePrimarySetting;
  eligibility?: EligibilityPluginConfig[];
  minWorkers?: number;
  maxWorkers?: number;
  notificationMedia?: NotificationMedia[];
  offerRatio?: number;
  offerTimeout?: number;
}

export type PollPhaseStatus = 'passed' | 'failed' | 'skipped' | 'stub';

export interface PollPhaseResult {
  phase: string;
  status: PollPhaseStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface PollResult {
  mode: 'test' | 'live';
  timestamp: string;
  phases: PollPhaseResult[];
  exitedAtPhase?: string;
}

export interface DispatchJobData {
  offerRatio?: number;
  offerTimeout?: number;
  lastPollResult?: PollResult;
}
