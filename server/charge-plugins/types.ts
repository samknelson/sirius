import type { ChargePluginConfig } from "@shared/schema";

export enum TriggerType {
  HOURS_SAVED = "hours_saved",
  PAYMENT_SAVED = "payment_saved",
  WMB_SAVED = "wmb_saved",
  PARTICIPANT_SAVED = "participant_saved",
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
  ledgerEaId: string;
  accountId: string;
  entityType: string;
  entityId: string;
  dateCleared: Date | null;
  memo: string | null;
  paymentTypeId: string;
}

export interface WmbSavedContext {
  trigger: TriggerType.WMB_SAVED;
  wmbId: string;
  workerId: string;
  employerId: string;
  benefitId: string;
  year: number;
  month: number;
  isDeleted?: boolean;
}

export interface ParticipantSavedContext {
  trigger: TriggerType.PARTICIPANT_SAVED;
  participantId: string;
  eventId: string;
  eventTypeId: string;
  contactId: string;
  role: string;
  status: string | null;
  workerId: string | null;
  isSteward: boolean;
}

export interface CronContext {
  trigger: TriggerType.CRON;
  jobId: string;
  mode: "live" | "test";
}

export type PluginContext = HoursSavedContext | PaymentSavedContext | WmbSavedContext | ParticipantSavedContext | CronContext;

export interface LedgerTransaction {
  chargePlugin: string;
  chargePluginKey: string;
  chargePluginConfigId: string;
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

export type LedgerNotificationType = "created" | "updated" | "deleted";

export interface LedgerNotification {
  type: LedgerNotificationType;
  amount: string;
  previousAmount?: string; // Only for "updated" type
  description: string;
}

export interface PluginExecutionResult {
  success: boolean;
  transactions: LedgerTransaction[];
  notifications?: LedgerNotification[];
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
  requiredComponent?: string; // Component ID that must be enabled for this plugin to function
}

export interface LedgerEntryVerification {
  entryId: string;
  chargePlugin: string;
  chargePluginKey: string;
  isValid: boolean;
  discrepancies: string[];
  actualAmount: string;
  expectedAmount: string | null;
  actualDescription: string | null;
  expectedDescription: string | null;
  referenceType: string | null;
  referenceId: string | null;
  transactionDate: Date | null;
}
