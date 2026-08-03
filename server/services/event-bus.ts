import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "../logger";
import type { EnrollmentType } from "@shared/schema";

export const EVENT_BUS_MAX_EMIT_DEPTH = 100;

export class EventBusEmitDepthExceededError extends Error {
  readonly depth: number;
  readonly rootEventType: string;
  readonly attemptedEventType: string;

  constructor(opts: { depth: number; rootEventType: string; attemptedEventType: string }) {
    super(
      `Event bus emit depth exceeded: refusing to emit "${opts.attemptedEventType}" at depth ${opts.depth} (root="${opts.rootEventType}", cap=${EVENT_BUS_MAX_EMIT_DEPTH})`,
    );
    this.name = "EventBusEmitDepthExceededError";
    this.depth = opts.depth;
    this.rootEventType = opts.rootEventType;
    this.attemptedEventType = opts.attemptedEventType;
  }
}

export enum EventType {
  HOURS_SAVED = "hours.saved",
  PAYMENT_SAVED = "payment.saved",
  WMB_SAVED = "wmb.saved",
  PARTICIPANT_SAVED = "participant.saved",
  DISPATCH_DNC_SAVED = "dispatch.dnc.saved",
  DISPATCH_HFE_SAVED = "dispatch.hfe.saved",
  DISPATCH_EBA_SAVED = "dispatch.eba.saved",
  DISPATCH_STATUS_SAVED = "dispatch.status.saved",
  DISPATCH_SAVED = "dispatch.saved",
  DISPATCH_JOB_SAVED = "dispatch.job.saved",
  DISPATCH_FORE_SAVED = "dispatch.fore.saved",
  DISPATCH_DEPARTMENT_SAVED = "dispatch.department.saved",
  WORKER_BAN_SAVED = "worker.ban.saved",
  WORKER_SKILL_SAVED = "worker.skill.saved",
  WORKER_WS_CHANGED = "worker.ws.changed",
  WORKER_WSH_SAVED = "worker.wsh.saved",
  WORKER_MSH_SAVED = "worker.msh.saved",
  STEWARD_ASSIGNMENT_SAVED = "steward.assignment.saved",
  GRIEVANCE_SAVED = "grievance.saved",
  TRUST_ELECTION_SAVED = "trust.election.saved",
  TRUST_EXEMPTION_SAVED = "trust.exemption.saved",
  WORKER_RELATION_SAVED = "worker.relation.saved",
  CONTACT_ELIGIBILITY_SAVED = "contact.eligibility.saved",
  CARDCHECK_SAVED = "cardcheck.saved",
  BAO_COBRA_CASE_SAVED = "bao.cobra.case.saved",
  LEDGER_ENTRY_SAVED = "ledger.entry.saved",
  WORKER_EMPLOYMENT_SAVED = "worker.employment.saved",
  EMPLOYER_INDUSTRY_SAVED = "employer.industry.saved",
  GRIEVANCE_STATUS_HISTORY_SAVED = "grievance.status-history.saved",
  GRIEVANCE_TIMELINE_CHANGED = "grievance.timeline.changed",
  GRIEVANCE_ASSIGNMENT_SAVED = "grievance.assignment.saved",
  GRIEVANCE_SETTLEMENT_SAVED = "grievance.settlement.saved",
  EDLS_SHEET_SAVED = "edls.sheet.saved",
  TRUST_WMB_SCAN_COMPLETED = "trust.wmb.scan.completed",
  TRUST_WMB_SCAN_WORKER_COMPLETED = "trust.wmb.scan.worker.completed",
  TOS_ABSENCE_REMINDER = "tos.absence.reminder",
  GRIEVANCE_DEADLINE_REMINDER = "grievance.deadline.reminder",
  EMPLOYER_MONTHLY = "employer.monthly",
  PLUGIN_CONFIG_SAVED = "plugin.config.saved",
  CRON = "cron",
  LOG = "log",
}

export interface HoursSavedPayload {
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

export interface PaymentSavedPayload {
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
}

export interface WmbSavedPayload {
  wmbId: string;
  workerId: string;
  employerId: string;
  benefitId: string;
  year: number;
  month: number;
  isDeleted?: boolean;
}

export interface ParticipantSavedPayload {
  participantId: string;
  eventId: string;
  eventTypeId: string;
  contactId: string;
  role: string;
  status: string | null;
  workerId: string | null;
  isSteward: boolean;
}

export interface DispatchDncSavedPayload {
  dncId: string;
  workerId: string;
  employerId: string;
  type: string;
  isDeleted?: boolean;
}

export interface DispatchHfeSavedPayload {
  hfeId: string;
  workerId: string;
  employerId: string;
  isDeleted?: boolean;
}

export interface DispatchEbaSavedPayload {
  workerId: string;
}

export interface DispatchStatusSavedPayload {
  statusId: string;
  workerId: string;
  status: string;
  /**
   * The status value before this write, when known: null on create (no prior
   * row), the pre-write value on update/upsert. Lets consumers (e.g. the
   * dispatch-status notifier) skip saves that did not actually change the
   * status. Absent on delete events.
   */
  previousStatus?: string | null;
  isDeleted?: boolean;
}

export interface DispatchSavedPayload {
  dispatchId: string;
  workerId: string;
  jobId: string;
  status: string;
  previousStatus?: string;
}

/**
 * Emitted after a dispatch job create or update commits (via the after-commit
 * hook, so listeners never see pre-commit data). Deliberately minimal: jobs
 * storage stays consumer-unaware; listeners (e.g. the `dispatch_job_event`
 * denorm plugin) re-read whatever job state they need.
 */
export interface DispatchJobSavedPayload {
  jobId: string;
}

export interface DispatchDepartmentSavedPayload {
  entryId: string;
  workerId: string;
  departmentId: string;
  preference: string;
  isDeleted?: boolean;
}

export interface DispatchForeSavedPayload {
  foreId: string;
  jobId: string;
  workerId: string;
  /** Whether the worker was added to or removed from the job's forepersons. */
  action: "added" | "removed";
  /** Job title + employer name, resolved at emit time so notifiers need no lookups. */
  jobTitle: string;
  employerName: string;
}

export interface WorkerBanSavedPayload {
  banId: string;
  workerId: string;
  type: string | null;
  startDate: Date;
  endDate: Date | null;
  active: boolean;
  isDeleted?: boolean;
}

export interface WorkerSkillSavedPayload {
  workerSkillId: string;
  workerId: string;
  skillId: string;
  isDeleted?: boolean;
}

export interface WorkerWsChangedPayload {
  workerId: string;
  wsId: string | null;
  previousWsId: string | null;
}

export interface WorkerWshSavedPayload {
  workerId: string;
  /**
   * Earliest effective date (YYYY-MM-DD) touched by the change. For updates
   * that move the date, this is the earlier of the old and new dates so
   * listeners can rescan every affected period. Null when unknown.
   */
  effectiveYmd?: string | null;
}

export interface WorkerMshSavedPayload {
  workerId: string;
  /**
   * Earliest effective date (YYYY-MM-DD) touched by the change. For updates
   * that move the date, this is the earlier of the old and new dates so
   * listeners can rescan every affected period. Null when unknown.
   */
  effectiveYmd?: string | null;
}

export interface StewardAssignmentSavedPayload {
  assignmentId: string;
  workerId: string;
  employerId: string;
  bargainingUnitId: string;
  operation: "created" | "updated" | "deleted";
}

export interface GrievanceSavedPayload {
  grievanceId: string;
}

/**
 * Emitted after any grievance status-history mutation (create/update/delete)
 * commits. Consumed by the `grievance_timeline` denorm plugin to recompute the
 * grievance's timeline steps (which only needs `grievanceId`).
 *
 * Also carries the grievance's derived *current* status before and after the
 * mutation, so a notifier can detect a genuine transition ("grievance attained
 * status X") without re-querying: the current status is the latest-dated
 * status-history entry. Both ids are null when the grievance has no history at
 * that point in time (e.g. `previous*` on the very first entry, `new*` after
 * the last entry is deleted). Status names are resolved for rendering and may be
 * null if the referenced status option is missing.
 */
export interface GrievanceStatusHistorySavedPayload {
  grievanceId: string;
  previousStatusId: string | null;
  previousStatusName: string | null;
  newStatusId: string | null;
  newStatusName: string | null;
}

/**
 * Emitted after a grievance save commits ONLY when the grievance's
 * `timeline_template_id` actually changed (set, swapped, or cleared) — so the
 * `grievance_timeline` denorm plugin does not recompute on every unrelated
 * grievance edit.
 */
export interface GrievanceTimelineChangedPayload {
  grievanceId: string;
}

export interface GrievanceAssignmentSavedPayload {
  grievanceId: string;
  userId: string;
  roleId: string;
  operation: "created" | "updated" | "deleted";
}

export interface GrievanceSettlementSavedPayload {
  grievanceId: string;
  settlementId: string;
  operation: "created" | "updated" | "deleted";
  /**
   * The settlement's amount (numeric string, may be null). Carried on the
   * payload so the message can render it even for deletes, where the row no
   * longer exists by the time the notifier runs.
   */
  amount: string | null;
}

export interface TrustElectionSavedPayload {
  electionId: string;
  workerId: string;
  /**
   * Which enrollment stream this election belongs to. May be null for legacy
   * or manually-created elections that carry no type; per-type notifiers skip
   * those via `shouldDispatch`.
   */
  enrollmentType: EnrollmentType | null;
  /** Effective period of the election (YYYY-MM-DD); endYmd null = open-ended. */
  startYmd: string;
  endYmd: string | null;
  operation: "created" | "updated" | "deleted";
}

export interface TrustExemptionSavedPayload {
  exemptionId: string;
  workerId: string;
  benefitId: string;
  startYmd: string;
  endYmd: string | null;
  operation: "created" | "updated" | "deleted";
}

/**
 * Emitted after a worker relationship (subscriber → dependent) create,
 * update, or delete commits. When an update moves the date range, storage
 * emits BOTH the old and the new range (two events) so listeners can cover
 * every affected period — mirroring the trust-election pattern. `startYmd`
 * may be null on legacy rows that predate date tracking.
 */
export interface WorkerRelationSavedPayload {
  relationId: string;
  /** worker_1 — the subscriber whose dependent coverage is affected. */
  subscriberWorkerId: string;
  /** worker_2 — the dependent side of the relation. */
  dependentWorkerId: string;
  startYmd: string | null;
  endYmd: string | null;
  operation: "created" | "updated" | "deleted";
}

/**
 * Emitted after a contact edit that can affect trust eligibility commits:
 * a birth-date change (read by the Ageout rule) or a change to the
 * contact's PRIMARY postal address situation — a primary added, replaced,
 * deactivated, or its coordinates arriving via geocoding (read by the
 * geographic BAO Start rules). Non-eligibility contact edits (name, phone,
 * email) intentionally do NOT emit this event.
 */
export interface ContactEligibilitySavedPayload {
  contactId: string;
  field: "birthDate" | "address";
}

/**
 * Emitted after a cardcheck write that changes the worker's signed-cardcheck
 * situation commits: a create with status "signed", an update that moves the
 * status to or from "signed" (sign / revoke), or a delete. Pure metadata
 * edits that leave signed-ness unchanged do NOT emit. `signedYmd` is the
 * cardcheck's signed date (the effective month for eligibility), null when
 * the card was never signed.
 */
export interface CardcheckSavedPayload {
  cardcheckId: string;
  workerId: string;
  status: string;
  signedYmd: string | null;
  operation: "created" | "updated" | "deleted";
}

/**
 * Emitted after a BAO COBRA case create, update, or delete commits. When an
 * update moves the coverage window, storage emits BOTH the old and the new
 * window (two events) so listeners can cover every affected period —
 * mirroring the worker-relation pattern. The covered person (not the
 * subscriber) is the worker whose benefits the case drives.
 */
export interface BaoCobraCaseSavedPayload {
  caseId: string;
  coveredPersonWorkerId: string;
  cobraEffectiveYmd: string;
  maxPeriodYmd: string | null;
  operation: "created" | "updated" | "deleted";
}

/**
 * Emitted after a ledger entry (charge, adjustment, or payment-allocation
 * row) create, update, or delete commits on a WORKER-owned ledger account.
 * Storage is the single emission point, so every code path that mutates
 * ledger entries — routes, charge plugins, payment deletes, batch flows —
 * is covered. When an update moves the statement month, storage emits BOTH
 * the old and the new month (two events). Non-worker accounts (employer,
 * trust provider) never emit: they don't affect worker eligibility rescans.
 * `statementYmd` is the entry's statement date (the accrual month), null
 * only for legacy rows without one.
 */
export interface LedgerEntrySavedPayload {
  entryId: string;
  eaId: string;
  accountId: string;
  entityType: string;
  entityId: string;
  statementYmd: string | null;
  operation: "created" | "updated" | "deleted";
}

/**
 * Emitted after a worker-hours mutation commits ONLY when it changed the
 * worker's derived home employer (the home employer is derived from hours
 * history: the first employer, by employer-id ordering, whose latest hours
 * row is flagged home). Covers a home employer being added (null → id),
 * ended (id → null), or changed (id → different id). Ordinary hours edits
 * that leave the home employer unchanged do NOT emit — HOURS_SAVED covers
 * those. `effectiveYmd` is the first day of the earliest hours month touched
 * by the mutation (old + new for month moves), so listeners can rescan every
 * period from the change onward.
 */
export interface WorkerEmploymentSavedPayload {
  workerId: string;
  previousHomeEmployerId: string | null;
  newHomeEmployerId: string | null;
  effectiveYmd: string | null;
}

/**
 * Emitted after an employer update commits ONLY when the employer's industry
 * assignment actually changed (set, swapped, or cleared). BAO Buildup and
 * BAO Threshold resolve their hour thresholds through the employer's
 * industry, so this silently changes eligibility math for every worker at
 * the employer; listeners react with an employer-scoped rescan.
 */
export interface EmployerIndustrySavedPayload {
  employerId: string;
  previousIndustryId: string | null;
  newIndustryId: string | null;
}

/**
 * Emitted after an EDLS sheet create or update commits. Carries the sheet's
 * status before and after the write so a notifier can detect a genuine
 * arrival at a status: `previousStatus` is null on create (the sheet "arrives"
 * at its initial status), and equals the pre-update status on update. The
 * title and ymd ride on the payload so consumers can render a message without
 * re-querying a row that may have changed since.
 */
export interface EdlsSheetSavedPayload {
  sheetId: string;
  previousStatus: string | null;
  newStatus: string;
  title: string;
  ymd: string;
}

/**
 * Per-worker scan-result event, emitted after one worker's WMB scan queue job
 * result is recorded (successfully). Carries the per-benefit actions
 * (including per-plugin eligibility results) so listeners — e.g. the
 * trust-wmb-terminate denorm plugin — can react without re-reading the queue.
 */
export interface TrustWmbScanWorkerCompletedPayload {
  queueId: string;
  workerId: string;
  month: number;
  year: number;
  actions: Array<{
    benefitId: string;
    benefitName: string;
    scanType: string;
    eligible: boolean;
    action: string;
    executed?: boolean;
    pluginResults: Array<{
      pluginKey: string;
      eligible: boolean;
      reason?: string;
      warning?: string;
    }>;
  }>;
}

export interface TrustWmbScanCompletedPayload {
  statusId: string;
  month: number;
  year: number;
  totalProcessed: number;
  successCount: number;
  failedCount: number;
  benefitsStarted: number;
  benefitsContinued: number;
  benefitsTerminated: number;
}

/**
 * A single TOS/absence reminder that fell due. Emitted by the generic EBS pump
 * cron from an `ebs_denorm` row scheduled by the `tos_absence_reminder` denorm
 * plugin; delivered by the `tos-absence-notifier` event-notifier plugin.
 * `offset` is the number of days after `absenceStartDate` this reminder fires.
 */
export interface TosAbsenceReminderPayload {
  tosId: string;
  workerId: string;
  contactId: string | null;
  offset: number;
  absenceStartDate: string;
}

/**
 * A single grievance deadline reminder that fell due. Emitted by the generic
 * EBS pump cron from an `ebs_denorm` row scheduled by the
 * `grievance_deadline_reminder` denorm plugin; delivered by the
 * `grievance-deadline-notifier` event-notifier plugin. `offset` is the number
 * of days BEFORE `dueDate` this reminder fires; `dueDate` is the step's due
 * date (YYYY-MM-DD). `stepName` is the timeline step's display name (null if it
 * can no longer be resolved).
 */
export interface GrievanceDeadlineReminderPayload {
  grievanceId: string;
  stepId: string;
  stepName: string | null;
  dueDate: string;
  offset: number;
}

/**
 * A single employer-monthly event that fell due. Emitted by the generic EBS
 * pump cron from an `ebs_denorm` row scheduled by the `employer_monthly` denorm
 * plugin. `month` is the calendar month this event is for, in `YYYY-MM` form.
 * This is currently a producer-only event: no consumer is registered yet
 * (downstream ledger interest/penalty work will subscribe later), so the pump
 * logging "No handlers" for it is expected.
 */
export interface EmployerMonthlyPayload {
  employerId: string;
  month: string;
}

export interface CronPayload {
  jobId: string;
  mode: "live" | "test";
}

export interface PluginConfigSavedPayload {
  kind: string;
  id: string;
  operation: "create" | "update" | "delete";
}

export interface LogPayload {
  id: number;
  level: string | null;
  message: string | null;
  timestamp: Date | null;
  source: string | null;
  meta: unknown | null;
  module: string | null;
  operation: string | null;
  entityId: string | null;
  hostEntityId: string | null;
  description: string | null;
  userId: string | null;
  userEmail: string | null;
  ipAddress: string | null;
}

export interface EventPayloadMap {
  [EventType.HOURS_SAVED]: HoursSavedPayload;
  [EventType.PAYMENT_SAVED]: PaymentSavedPayload;
  [EventType.WMB_SAVED]: WmbSavedPayload;
  [EventType.PARTICIPANT_SAVED]: ParticipantSavedPayload;
  [EventType.DISPATCH_DNC_SAVED]: DispatchDncSavedPayload;
  [EventType.DISPATCH_HFE_SAVED]: DispatchHfeSavedPayload;
  [EventType.DISPATCH_EBA_SAVED]: DispatchEbaSavedPayload;
  [EventType.DISPATCH_STATUS_SAVED]: DispatchStatusSavedPayload;
  [EventType.DISPATCH_SAVED]: DispatchSavedPayload;
  [EventType.DISPATCH_JOB_SAVED]: DispatchJobSavedPayload;
  [EventType.DISPATCH_FORE_SAVED]: DispatchForeSavedPayload;
  [EventType.DISPATCH_DEPARTMENT_SAVED]: DispatchDepartmentSavedPayload;
  [EventType.WORKER_BAN_SAVED]: WorkerBanSavedPayload;
  [EventType.WORKER_SKILL_SAVED]: WorkerSkillSavedPayload;
  [EventType.WORKER_WS_CHANGED]: WorkerWsChangedPayload;
  [EventType.WORKER_WSH_SAVED]: WorkerWshSavedPayload;
  [EventType.WORKER_MSH_SAVED]: WorkerMshSavedPayload;
  [EventType.STEWARD_ASSIGNMENT_SAVED]: StewardAssignmentSavedPayload;
  [EventType.GRIEVANCE_SAVED]: GrievanceSavedPayload;
  [EventType.TRUST_ELECTION_SAVED]: TrustElectionSavedPayload;
  [EventType.TRUST_EXEMPTION_SAVED]: TrustExemptionSavedPayload;
  [EventType.WORKER_RELATION_SAVED]: WorkerRelationSavedPayload;
  [EventType.CONTACT_ELIGIBILITY_SAVED]: ContactEligibilitySavedPayload;
  [EventType.CARDCHECK_SAVED]: CardcheckSavedPayload;
  [EventType.BAO_COBRA_CASE_SAVED]: BaoCobraCaseSavedPayload;
  [EventType.LEDGER_ENTRY_SAVED]: LedgerEntrySavedPayload;
  [EventType.WORKER_EMPLOYMENT_SAVED]: WorkerEmploymentSavedPayload;
  [EventType.EMPLOYER_INDUSTRY_SAVED]: EmployerIndustrySavedPayload;
  [EventType.GRIEVANCE_STATUS_HISTORY_SAVED]: GrievanceStatusHistorySavedPayload;
  [EventType.GRIEVANCE_TIMELINE_CHANGED]: GrievanceTimelineChangedPayload;
  [EventType.GRIEVANCE_ASSIGNMENT_SAVED]: GrievanceAssignmentSavedPayload;
  [EventType.GRIEVANCE_SETTLEMENT_SAVED]: GrievanceSettlementSavedPayload;
  [EventType.EDLS_SHEET_SAVED]: EdlsSheetSavedPayload;
  [EventType.TRUST_WMB_SCAN_COMPLETED]: TrustWmbScanCompletedPayload;
  [EventType.TRUST_WMB_SCAN_WORKER_COMPLETED]: TrustWmbScanWorkerCompletedPayload;
  [EventType.TOS_ABSENCE_REMINDER]: TosAbsenceReminderPayload;
  [EventType.GRIEVANCE_DEADLINE_REMINDER]: GrievanceDeadlineReminderPayload;
  [EventType.EMPLOYER_MONTHLY]: EmployerMonthlyPayload;
  [EventType.PLUGIN_CONFIG_SAVED]: PluginConfigSavedPayload;
  [EventType.CRON]: CronPayload;
  [EventType.LOG]: LogPayload;
}

export type EventHandler<T extends EventType> = (payload: EventPayloadMap[T]) => Promise<void>;

export interface OnOptions<T extends EventType> {
  name: string;
  description: string;
  event: T;
  handler: EventHandler<T>;
}

interface RegisteredHandler {
  id: string;
  name: string;
  description: string;
  handler: (payload: any) => Promise<void>;
}

export interface HandlerInfo {
  id: string;
  name: string;
  description: string;
}

export interface EmitFailure {
  handlerId: string;
  handlerName: string;
  message: string;
}

export interface RecentEmitEntry {
  emittedAt: Date;
  eventType: EventType;
  payload: unknown;
  payloadTruncated: boolean;
  handlerCount: number;
  successCount: number;
  failureCount: number;
  durationMs: number;
  failures: EmitFailure[];
}

const RECENT_EMITS_PER_TYPE = 100;
const PAYLOAD_MAX_SERIALIZED_BYTES = 4096;

function capturePayload(payload: unknown): { value: unknown; truncated: boolean } {
  try {
    const serialized = JSON.stringify(payload);
    if (serialized === undefined) {
      return { value: String(payload), truncated: false };
    }
    if (serialized.length > PAYLOAD_MAX_SERIALIZED_BYTES) {
      return {
        value: {
          __truncated: true,
          originalBytes: serialized.length,
          preview: serialized.slice(0, PAYLOAD_MAX_SERIALIZED_BYTES),
        },
        truncated: true,
      };
    }
    return { value: JSON.parse(serialized), truncated: false };
  } catch (err) {
    return {
      value: { __unserializable: true, error: err instanceof Error ? err.message : String(err) },
      truncated: true,
    };
  }
}

interface EmitDepthStore {
  depth: number;
  rootEventType: EventType;
}

class EventBus {
  private handlers = new Map<EventType, RegisteredHandler[]>();
  private handlerIdCounter = 0;
  private recentEmits = new Map<EventType, RecentEmitEntry[]>();
  private emitDepthAls = new AsyncLocalStorage<EmitDepthStore>();

  on<T extends EventType>(opts: OnOptions<T>): string {
    const { name, description, event, handler } = opts;
    if (!name || !description) {
      throw new Error(`eventBus.on requires name and description (event=${event})`);
    }
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }

    const handlerId = `handler_${++this.handlerIdCounter}`;
    this.handlers.get(event)!.push({
      id: handlerId,
      name,
      description,
      handler: handler as (payload: any) => Promise<void>,
    });

    logger.debug(`Event handler registered: ${name} (${handlerId}) for ${event}`, {
      service: "event-bus",
    });

    return handlerId;
  }

  off(handlerId: string): boolean {
    const entries = Array.from(this.handlers.entries());
    for (const [, handlers] of entries) {
      const index = handlers.findIndex((h: RegisteredHandler) => h.id === handlerId);
      if (index !== -1) {
        handlers.splice(index, 1);
        logger.debug(`Event handler unregistered: ${handlerId}`, {
          service: "event-bus",
        });
        return true;
      }
    }
    return false;
  }

  /**
   * Emit an event to every subscribed handler. Failures are swallowed (logged +
   * recorded in the ring buffer) so a bad handler can never break the emitter.
   * Callers that need to KNOW whether delivery succeeded (e.g. the EBS pump,
   * which must only mark a scheduled event `sent` when every handler ran
   * cleanly) should use {@link emitWithFailures} instead.
   */
  async emit<T extends EventType>(eventType: T, payload: EventPayloadMap[T]): Promise<void> {
    await this.dispatch(eventType, payload);
  }

  /**
   * Like {@link emit}, but returns the per-handler failures instead of
   * swallowing them. An empty array means every handler ran cleanly. The depth
   * guard still applies and throws {@link EventBusEmitDepthExceededError} on an
   * emit storm — a thrown depth error is NOT a handler failure and is surfaced
   * to the caller directly.
   */
  async emitWithFailures<T extends EventType>(
    eventType: T,
    payload: EventPayloadMap[T],
  ): Promise<EmitFailure[]> {
    return this.dispatch(eventType, payload);
  }

  private async dispatch<T extends EventType>(
    eventType: T,
    payload: EventPayloadMap[T],
  ): Promise<EmitFailure[]> {
    // Storm protection: per-async-chain emit depth tracking.
    const parent = this.emitDepthAls.getStore();
    const nextDepth = parent ? parent.depth + 1 : 1;
    const rootEventType = parent ? parent.rootEventType : eventType;

    if (nextDepth > EVENT_BUS_MAX_EMIT_DEPTH) {
      logger.error(
        `Event bus emit depth exceeded: refusing "${eventType}" at depth ${nextDepth} (root="${rootEventType}", cap=${EVENT_BUS_MAX_EMIT_DEPTH})`,
        {
          service: "event-bus",
          depth: nextDepth,
          rootEventType,
          attemptedEventType: eventType,
          cap: EVENT_BUS_MAX_EMIT_DEPTH,
        },
      );
      throw new EventBusEmitDepthExceededError({
        depth: nextDepth,
        rootEventType,
        attemptedEventType: eventType,
      });
    }

    return this.emitDepthAls.run({ depth: nextDepth, rootEventType }, async () => {
      const handlers = this.handlers.get(eventType) || [];

      if (handlers.length === 0) {
        logger.debug(`No handlers for event: ${eventType}`, {
          service: "event-bus",
        });
        this.recordEmit(eventType, payload, [], 0);
        return [];
      }

      logger.debug(`Emitting event: ${eventType} to ${handlers.length} handler(s)`, {
        service: "event-bus",
      });

      const startedAt = Date.now();
      const results = await Promise.allSettled(
        handlers.map(({ id, name, handler }) =>
          handler(payload).catch(error => {
            logger.error(`Event handler ${name} (${id}) failed for ${eventType}`, {
              service: "event-bus",
              handlerId: id,
              handlerName: name,
              eventType,
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          })
        )
      );
      const durationMs = Date.now() - startedAt;

      const failures: EmitFailure[] = [];
      results.forEach((r, idx) => {
        if (r.status === "rejected") {
          const h = handlers[idx];
          failures.push({
            handlerId: h?.id ?? "unknown",
            handlerName: h?.name ?? "unknown",
            message: r.reason instanceof Error ? r.reason.message : String(r.reason),
          });
        }
      });
      if (failures.length > 0) {
        logger.warn(`${failures.length}/${handlers.length} handlers failed for event: ${eventType}`, {
          service: "event-bus",
        });
      }

      this.recordEmit(eventType, payload, handlers, durationMs, results);
      return failures;
    });
  }

  private recordEmit<T extends EventType>(
    eventType: T,
    payload: EventPayloadMap[T],
    handlers: RegisteredHandler[],
    durationMs: number,
    results?: PromiseSettledResult<void>[],
  ): void {
    // Exclude LOG to avoid feedback loop with log-notifier.
    if (eventType === EventType.LOG) return;

    const failures: EmitFailure[] = [];
    let successCount = 0;
    let failureCount = 0;
    if (results) {
      results.forEach((r, idx) => {
        if (r.status === "fulfilled") {
          successCount++;
        } else {
          failureCount++;
          const h = handlers[idx];
          failures.push({
            handlerId: h?.id ?? "unknown",
            handlerName: h?.name ?? "unknown",
            message: r.reason instanceof Error ? r.reason.message : String(r.reason),
          });
        }
      });
    }

    const captured = capturePayload(payload);
    const entry: RecentEmitEntry = {
      emittedAt: new Date(),
      eventType,
      payload: captured.value,
      payloadTruncated: captured.truncated,
      handlerCount: handlers.length,
      successCount,
      failureCount,
      durationMs,
      failures,
    };

    let bucket = this.recentEmits.get(eventType);
    if (!bucket) {
      bucket = [];
      this.recentEmits.set(eventType, bucket);
    }
    bucket.push(entry);
    if (bucket.length > RECENT_EMITS_PER_TYPE) {
      bucket.splice(0, bucket.length - RECENT_EMITS_PER_TYPE);
    }
  }

  getHandlerCount(eventType?: EventType): number {
    if (eventType) {
      return this.handlers.get(eventType)?.length || 0;
    }
    let total = 0;
    const allHandlers = Array.from(this.handlers.values());
    for (const handlers of allHandlers) {
      total += handlers.length;
    }
    return total;
  }

  getRegistry(): Record<string, HandlerInfo[]> {
    const out: Record<string, HandlerInfo[]> = {};
    for (const eventType of Object.values(EventType)) {
      const handlers = this.handlers.get(eventType) || [];
      out[eventType] = handlers.map(h => ({ id: h.id, name: h.name, description: h.description }));
    }
    return out;
  }

  getRecentEmits(eventType?: EventType, limit?: number): RecentEmitEntry[] {
    const collect: RecentEmitEntry[] = [];
    if (eventType) {
      collect.push(...(this.recentEmits.get(eventType) || []));
    } else {
      const buckets = Array.from(this.recentEmits.values());
      for (const b of buckets) collect.push(...b);
    }
    collect.sort((a, b) => b.emittedAt.getTime() - a.emittedAt.getTime());
    if (limit && limit > 0) return collect.slice(0, limit);
    return collect;
  }

  clearRecentEmits(): void {
    this.recentEmits.clear();
  }
}

export const eventBus = new EventBus();
export const EVENT_BUS_RING_BUFFER_CAP = RECENT_EMITS_PER_TYPE;
