import type { ChargePluginConfig } from "@shared/schema";

export enum TriggerType {
  HOURS_SAVED = "hours_saved",
  PAYMENT_SAVED = "payment_saved",
  CRON = "cron",
}

export interface HoursSavedContext {
  trigger: TriggerType.HOURS_SAVED;
  hoursId: string;
  workerId: string;
  employerId: string;
  year: number;
  month: number;
  day: number;
  hours: number;
  employmentStatusId: string;
  home: boolean;
}

export interface PaymentSavedContext {
  trigger: TriggerType.PAYMENT_SAVED;
  paymentId: string;
  amount: string;
  status: string;
  entityType: string | null;
  entityId: string | null;
}

export interface CronContext {
  trigger: TriggerType.CRON;
  jobId: string;
  mode: "live" | "test";
}

export type PluginContext = HoursSavedContext | PaymentSavedContext | CronContext;

export interface LedgerTransaction {
  accountId: string;
  entityType: string; // "employer", "worker", "trust_provider"
  entityId: string;
  amount: string; // Numeric string, e.g., "15.50"
  description: string;
  transactionDate: Date;
  referenceType?: string;
  referenceId?: string;
  metadata?: Record<string, any>;
}

export interface PluginExecutionResult {
  success: boolean;
  transactions: LedgerTransaction[];
  message?: string;
  error?: string;
}

export interface ChargePluginMetadata {
  id: string;
  name: string;
  description: string;
  triggers: TriggerType[];
  defaultScope: "global" | "employer";
  settingsSchema?: any; // Zod schema for validating settings
}
