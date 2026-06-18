import type { ChargePluginConfig } from "@shared/schema";
import type { JsonSchema } from "@shared/json-schema-form";

export enum TriggerType {
  HOURS_SAVED = "hours_saved",
  PAYMENT_SAVED = "payment_saved",
  WMB_SAVED = "wmb_saved",
  PARTICIPANT_SAVED = "participant_saved",
  CRON = "cron",
  DUES_IMPORT_SAVED = "dues_import_saved",
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
  dateReceived: Date | null;
  dateCleared: Date | null;
  memo: string | null;
  paymentTypeId: string;
  allocationId?: string;
  allocationStatementYmd?: string;
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

export interface DuesImportSavedContext {
  trigger: TriggerType.DUES_IMPORT_SAVED;
  wizardId: string;
  rowIndex: number;
  workerId: string;
  workerName: string;
  bpsEmployeeId: string;
  amount: string;
  transactionDate: Date;
  accountId: string;
  deductionCode: string | null;
  memo: string | null;
}

export type PluginContext = HoursSavedContext | PaymentSavedContext | WmbSavedContext | ParticipantSavedContext | CronContext | DuesImportSavedContext;

export interface LedgerTransaction {
  chargePlugin: string;
  chargePluginKey: string;
  chargePluginConfigId: string;
  accountId: string;
  entityType: string;
  entityId: string;
  amount: string;
  description: string;
  memo?: string | null;
  transactionDate: Date;
  statementYmd?: string;
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
  skippedDuplicate?: boolean;
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
  /**
   * Which scopes a configuration of this plugin may use. The unified
   * config dialog shows a scope selector only when "employer" is
   * present; otherwise configs are always global. Defaults to
   * `["global"]` when omitted.
   */
  supportedScopes?: readonly ("global" | "employer")[];
  /**
   * JSON Schema describing the plugin's `settings` payload. This is the
   * single source of truth for the client form (RJSF) and server-side
   * validation. Cross-field rules that JSON Schema can't express live in
   * the plugin's `validateConfig` override.
   */
  configSchema?: JsonSchema;
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
