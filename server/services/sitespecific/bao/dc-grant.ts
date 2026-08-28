/**
 * Disability Credit grant + reconcile service.
 *
 * Approval of a DC case writes fund-attributed shortfall hours through the
 * CANONICAL worker-hours path (storage.workerHours.upsertWorkerHours /
 * deleteWorkerHours) so coverage changes flow exclusively through the
 * ordinary HOURS_SAVED → benefit auto-rescan pipeline — this service never
 * touches WMB rows directly.
 *
 * Per selected work month:
 *  - The continuation threshold comes from the worker's OWN active benefits'
 *    trust-eligibility rules (bao-buildup / bao-threshold), resolved through
 *    the employer → industry → member-status chain. Conflicting distinct
 *    thresholds (or coverage lags) across those benefits are rejected as
 *    invalid configuration (DcGrantError CONFLICTING_THRESHOLDS) — no
 *    hard-coded grant amount exists.
 *  - Shortfall = threshold − qualifying employer hours (employed or FMLA
 *    statuses, all employers, excluding the DC pseudo-employer). Only a
 *    positive shortfall is granted.
 *  - Months whose RESULTING COVERAGE month (work month + lag) is beyond
 *    current+1 are queued; the release cron grants them oldest-first once
 *    they enter the window. Zero-shortfall months are removed (restoring
 *    annual capacity — usage is derived from non-removed months).
 *
 * Reconciliation: as later employer reporting lands (HOURS_SAVED for any
 * non-DC employer), a granted month's DC hours are reduced to the NEW
 * shortfall — never increased — and removed entirely at zero (month marked
 * removed, capacity restored, typed event logged). Downward employer
 * corrections therefore never grow DC back.
 *
 * Everything runs under the per-worker DC advisory lock and is idempotent:
 * repeating an approval, release, or reconciliation converges without
 * duplicate hours, duplicate events, or extra rescans.
 */
import { storage } from "../../../storage";
import { logger } from "../../../logger";
import {
  eventBus,
  EventType,
  type HoursSavedPayload,
} from "../../event-bus";
import { onAfterCommit } from "../../../storage/transaction-context";
import {
  isCacheInitialized,
  isComponentEnabledSync,
} from "../../component-cache";
import {
  createPolicyResolutionCache,
  resolveEmployerPolicyAsOf,
} from "../../policy-resolution";
import {
  resolveBaoThreshold,
  resolveLowestActiveEmployerThreshold,
  toOrdinal,
  fromOrdinal,
  lastDayOfMonthYmd,
} from "../../../plugins/trust/eligibility/plugins/bao-shared";
import {
  BAO_DC_FUND_EMPLOYER_SIRIUS_ID,
  type BaoDcCaseMonth,
} from "@shared/schema";

const SERVICE_NAME = "bao-dc-grant";

/** Eligibility plugins whose rules carry a BAO continuation threshold. */
const THRESHOLD_PLUGIN_LAGS: Record<string, (config: Record<string, unknown>) => number> = {
  // Buildup: benefit month = work month + lagMonths (default 3).
  "sitespecific-bao-buildup": (config) => {
    const lag = Number((config as { lagMonths?: unknown }).lagMonths);
    return Number.isFinite(lag) && lag >= 0 ? lag : 3;
  },
  // Threshold: fixed 3-month lookback.
  "sitespecific-bao-threshold": () => 3,
};

export type DcGrantErrorCode =
  | "NO_THRESHOLD_RULE"
  | "CONFLICTING_THRESHOLDS"
  | "NO_POLICY";

export class DcGrantError extends Error {
  constructor(
    public readonly code: DcGrantErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "DcGrantError";
  }
}

/** Short, forward-looking description of each grant configuration failure. */
export const DC_GRANT_ERROR_DESCRIPTIONS: Record<DcGrantErrorCode, string> = {
  NO_POLICY:
    "No benefits policy could be resolved for the worker's employer",
  NO_THRESHOLD_RULE:
    "No continuation-threshold eligibility rule (buildup/threshold) covers the worker's continued benefits",
  CONFLICTING_THRESHOLDS:
    "The worker's continued benefits carry conflicting continuation thresholds or coverage lags",
};

export interface DcGrantConfigWarning {
  workMonthYmd: string;
  code: DcGrantErrorCode;
  message: string;
}

/**
 * ADVISORY preview of the grant cascade's configuration checks: runs the
 * exact same resolveContinuationRequirement the approval path uses for each
 * given work month and reports the months that would fail (missing policy,
 * missing threshold rule, conflicting thresholds) — so approvers can see the
 * problem BEFORE clicking Approve. Never throws for expected configuration
 * errors and never blocks readiness/queueing; unexpected failures are logged
 * and skipped so a broken preview can't take down the case view.
 */
export async function previewDcGrantConfigWarnings(
  workerId: string,
  workMonthYmds: string[],
): Promise<DcGrantConfigWarning[]> {
  const warnings: DcGrantConfigWarning[] = [];
  for (const workMonthYmd of [...workMonthYmds].sort()) {
    try {
      await resolveContinuationRequirement(workerId, workMonthYmd);
    } catch (error) {
      if (error instanceof DcGrantError) {
        warnings.push({
          workMonthYmd,
          code: error.code,
          message: DC_GRANT_ERROR_DESCRIPTIONS[error.code],
        });
      } else {
        logger.warn("DC grant config preview failed unexpectedly", {
          service: SERVICE_NAME,
          workerId,
          workMonthYmd,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return warnings;
}

export interface DcContinuationRequirement {
  threshold: number;
  lagMonths: number;
  /** First-of-month Ymd of the resulting coverage month (work + lag). */
  coverageMonthYmd: string;
  benefitIds: string[];
}

function ymdToParts(ymd: string): { year: number; month: number } {
  const [y, m] = ymd.split("-").map(Number);
  return { year: y, month: m };
}

function partsToYmd(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function addMonths(ymd: string, months: number): string {
  const { year, month } = ymdToParts(ymd);
  const { year: y, month: m } = fromOrdinal(toOrdinal(year, month) + months);
  return partsToYmd(y, m);
}

function currentMonthYmd(): string {
  const now = new Date();
  return partsToYmd(now.getFullYear(), now.getMonth() + 1);
}

/** True when the coverage month is within the grantable window (≤ current+1). */
export function isCoverageMonthDue(coverageMonthYmd: string, nowMonthYmd = currentMonthYmd()): boolean {
  const c = ymdToParts(coverageMonthYmd);
  const n = ymdToParts(nowMonthYmd);
  return toOrdinal(c.year, c.month) <= toOrdinal(n.year, n.month) + 1;
}

/**
 * The benefits whose coverage the grant continues: the worker's WMB benefit
 * set from the most recent month AT OR BEFORE the work month that has any
 * WMB rows. (Selected DC months are themselves uncovered by definition.)
 */
async function resolveContinuedBenefitIds(
  workerId: string,
  workMonthYmd: string,
): Promise<string[]> {
  const all = await storage.trust.wmb.getWorkerBenefits(workerId);
  const target = ymdToParts(workMonthYmd);
  const targetOrd = toOrdinal(target.year, target.month);
  let bestOrd: number | undefined;
  const ids = new Set<string>();
  for (const row of all as Array<{ benefitId: string; year: number; month: number }>) {
    const ord = toOrdinal(row.year, row.month);
    if (ord > targetOrd) continue;
    if (bestOrd === undefined || ord > bestOrd) {
      bestOrd = ord;
      ids.clear();
    }
    if (ord === bestOrd) ids.add(row.benefitId);
  }
  return Array.from(ids);
}

/**
 * Resolve the worker's continuation threshold + coverage lag for a work
 * month from the trust-eligibility rules of the benefits being continued.
 * Fails coded on missing policy, no threshold-bearing rule, or conflicting
 * distinct thresholds/lags — configuration is never guessed.
 */
export async function resolveContinuationRequirement(
  workerId: string,
  workMonthYmd: string,
): Promise<DcContinuationRequirement> {
  const worker = await storage.workers.getWorker(workerId);
  if (!worker) throw new Error(`Worker not found: ${workerId}`);
  const { year, month } = ymdToParts(workMonthYmd);

  // Employer for policy + threshold resolution: active election as of the
  // work month end, falling back to the home employer (mirrors the scan).
  const monthEndYmd = lastDayOfMonthYmd(year, month);
  const election = await storage.workerTrustElections.getActiveByWorkerAsOf(
    workerId,
    monthEndYmd,
  );
  const employerId: string | undefined =
    election?.employerId ?? (worker as { denormHomeEmployerId?: string | null }).denormHomeEmployerId ?? undefined;

  const resolved = await resolveEmployerPolicyAsOf(
    storage,
    employerId ?? null,
    workMonthYmd,
    createPolicyResolutionCache(),
  );
  if (!resolved.policy) {
    throw new DcGrantError("NO_POLICY", { workerId, workMonthYmd });
  }

  const benefitIds = await resolveContinuedBenefitIds(workerId, workMonthYmd);
  // Fail closed: a worker with no prior covered benefit has nothing to
  // CONTINUE — granting against unrelated policy rules would invent
  // coverage. (Selection validation can admit such months, so this is the
  // enforcement point.)
  if (benefitIds.length === 0) {
    throw new DcGrantError("NO_THRESHOLD_RULE", {
      workerId,
      workMonthYmd,
      reason: "no_continued_benefits",
    });
  }

  const ruleRows = await storage.pluginConfigs.search("trust-eligibility", {
    policy: resolved.policy.id,
  });

  const candidates: Array<{ benefitId: string; threshold: number; lagMonths: number }> = [];
  for (const row of ruleRows as Array<{
    config: { pluginId?: string; data?: Record<string, unknown> };
    subsidiary: { benefit?: string } | null;
  }>) {
    const pluginId = row.config?.pluginId;
    if (!pluginId || !(pluginId in THRESHOLD_PLUGIN_LAGS)) continue;
    const benefitId = row.subsidiary?.benefit;
    if (!benefitId) continue;
    // Restrict to the benefits being continued (non-empty — enforced above).
    if (!benefitIds.includes(benefitId)) continue;
    const data = (row.config?.data ?? {}) as Record<string, unknown>;
    const defaultThreshold = Number(data.defaultThreshold ?? 0);
    const lagMonths = THRESHOLD_PLUGIN_LAGS[pluginId](data);

    let threshold: number | undefined;
    if (employerId) {
      const r = await resolveBaoThreshold(workerId, employerId, monthEndYmd, defaultThreshold);
      threshold = r.threshold;
      if (!r.resolved) {
        const lowest = await resolveLowestActiveEmployerThreshold(
          workerId,
          monthEndYmd,
          { year, month },
          defaultThreshold,
        );
        if (lowest) threshold = lowest.threshold;
      }
    } else {
      const lowest = await resolveLowestActiveEmployerThreshold(
        workerId,
        monthEndYmd,
        { year, month },
        defaultThreshold,
      );
      threshold = lowest ? lowest.threshold : defaultThreshold;
    }
    if (!Number.isFinite(threshold) || (threshold as number) <= 0) continue;
    candidates.push({ benefitId, threshold: threshold as number, lagMonths });
  }

  if (candidates.length === 0) {
    throw new DcGrantError("NO_THRESHOLD_RULE", { workerId, workMonthYmd, benefitIds });
  }
  const thresholds = Array.from(new Set(candidates.map((c) => c.threshold)));
  const lags = Array.from(new Set(candidates.map((c) => c.lagMonths)));
  if (thresholds.length > 1 || lags.length > 1) {
    throw new DcGrantError("CONFLICTING_THRESHOLDS", {
      workerId,
      workMonthYmd,
      candidates,
    });
  }
  return {
    threshold: thresholds[0],
    lagMonths: lags[0],
    coverageMonthYmd: addMonths(workMonthYmd, lags[0]),
    benefitIds: Array.from(new Set(candidates.map((c) => c.benefitId))),
  };
}

interface GrantOutcome {
  monthId: string;
  workMonthYmd: string;
  action: "granted" | "queued" | "removed" | "unchanged";
  grantedHours?: number;
}

/**
 * Grant one selected/queued month: compute the shortfall and either write
 * the DC hours row (granted), or remove the month when employer hours
 * already meet the threshold. Caller holds the worker lock; `via` names the
 * path for the event payload ("approval" | "release").
 */
async function grantMonth(
  month: BaoDcCaseMonth,
  requirement: DcContinuationRequirement,
  actorUserId: string | null,
  via: "approval" | "release",
): Promise<GrantOutcome> {
  const dc = storage.baoDisabilityCredit;
  const { employerId, employmentStatusId } = await dc.ensureDcFundIdentities();
  primeDcFundEmployerCache(employerId);
  const { year, month: m } = ymdToParts(month.workMonthYmd);
  const qualifyingHours = await dc.getQualifyingHoursForWorkerMonth(
    month.workerId,
    year,
    m,
    employerId,
  );
  const shortfall = Math.max(0, requirement.threshold - qualifyingHours);

  const snapshot = {
    threshold: requirement.threshold,
    lagMonths: requirement.lagMonths,
    coverageMonthYmd: requirement.coverageMonthYmd,
    qualifyingHoursAtGrant: qualifyingHours,
    via,
  };

  if (shortfall <= 0) {
    await dc.applyMonthGrantTransition(month.id, {
      status: "removed",
      voidReason:
        "No shortfall — qualifying employer hours already meet the continuation threshold",
      data: { ...snapshot, grantedHours: 0 },
      event: {
        type: "case_month_voided",
        dedupeKey: `case_month_voided:${month.id}:no_shortfall`,
        payload: { ...snapshot, reason: "no_shortfall" },
      },
    });
    return { monthId: month.id, workMonthYmd: month.workMonthYmd, action: "removed" };
  }

  // Canonical hours write — HOURS_SAVED emission + charge plugins + the
  // benefit auto-rescan all flow from here; no direct WMB writes.
  const result = await storage.workerHours.upsertWorkerHours({
    workerId: month.workerId,
    year,
    month: m,
    day: 1,
    employerId,
    employmentStatusId,
    hours: shortfall,
  });

  await dc.applyMonthGrantTransition(month.id, {
    status: "granted",
    data: { ...snapshot, grantedHours: shortfall, hoursId: result.data?.id ?? null },
    event: {
      type: via === "release" ? "case_month_released" : "case_month_granted",
      dedupeKey: `${via === "release" ? "case_month_released" : "case_month_granted"}:${month.id}`,
      payload: { ...snapshot, grantedHours: shortfall, actorUserId },
    },
  });
  return {
    monthId: month.id,
    workMonthYmd: month.workMonthYmd,
    action: "granted",
    grantedHours: shortfall,
  };
}

/**
 * Approval cascade for a case — runs under the caller's case serialization
 * (performDcCaseAction). Older queued months (any case of the worker) are
 * released FIRST when due, then each still-`selected` month of this case is
 * granted or queued, oldest first. Idempotent: already granted/removed
 * months are skipped, so re-running after a partial failure converges.
 */
export async function runDcGrantCascadeForCase(
  caseId: string,
  actorUserId: string,
): Promise<GrantOutcome[]> {
  const dc = storage.baoDisabilityCredit;
  const theCase = await dc.getCase(caseId);
  if (!theCase) throw new Error("CASE_NOT_FOUND");

  const outcomes: GrantOutcome[] = [];

  // Priority: due queued months (from ANY earlier grant) release first.
  outcomes.push(...(await releaseDueQueuedMonthsForWorker(theCase.workerId, actorUserId)));

  const months = (await dc.listCaseMonths(caseId))
    .filter((m) => m.status === "selected")
    .sort((a, b) => a.workMonthYmd.localeCompare(b.workMonthYmd));

  for (const month of months) {
    const requirement = await resolveContinuationRequirement(
      month.workerId,
      month.workMonthYmd,
    );
    if (!isCoverageMonthDue(requirement.coverageMonthYmd)) {
      await dc.applyMonthGrantTransition(month.id, {
        status: "queued",
        data: {
          threshold: requirement.threshold,
          lagMonths: requirement.lagMonths,
          coverageMonthYmd: requirement.coverageMonthYmd,
        },
        event: {
          type: "case_month_queued",
          dedupeKey: `case_month_queued:${month.id}`,
          payload: {
            threshold: requirement.threshold,
            coverageMonthYmd: requirement.coverageMonthYmd,
            actorUserId,
          },
        },
      });
      outcomes.push({ monthId: month.id, workMonthYmd: month.workMonthYmd, action: "queued" });
      continue;
    }
    outcomes.push(await grantMonth(month, requirement, actorUserId, "approval"));
  }
  return outcomes;
}

/**
 * Release every queued month of the worker whose coverage month has entered
 * the current+1 window — oldest work month first, so earlier queued months
 * take priority over newer grants. Requirement is re-resolved at release so
 * shortfall reflects the latest employer reporting. Idempotent.
 */
export async function releaseDueQueuedMonthsForWorker(
  workerId: string,
  actorUserId: string | null,
): Promise<GrantOutcome[]> {
  const dc = storage.baoDisabilityCredit;
  const queued = (await dc.listApplicableMonthsForWorker(workerId))
    .filter((m) => m.status === "queued")
    .sort((a, b) => a.workMonthYmd.localeCompare(b.workMonthYmd));
  const outcomes: GrantOutcome[] = [];
  for (const month of queued) {
    const requirement = await resolveContinuationRequirement(workerId, month.workMonthYmd);
    if (!isCoverageMonthDue(requirement.coverageMonthYmd)) continue;
    outcomes.push(await grantMonth(month, requirement, actorUserId, "release"));
  }
  return outcomes;
}

/**
 * Reconcile one granted month against the latest employer reporting: reduce
 * the DC hours row to the new (smaller) shortfall, or remove it at zero —
 * marking the month removed (restores annual capacity) and logging why. DC
 * hours are NEVER increased here, so downward employer corrections cannot
 * grow a grant back. The single hours write/delete triggers the standard
 * rescan. Runs under the worker's DC lock; idempotent.
 */
export async function reconcileDcGrantForWorkerMonth(
  workerId: string,
  workMonthYmd: string,
): Promise<{ action: "reduced" | "removed" | "unchanged" | "not_granted"; dcHours?: number }> {
  const dc = storage.baoDisabilityCredit;
  return dc.withWorkerSerialization(workerId, async () => {
    const month = await dc.getApplicableMonthForWorkerMonth(workerId, workMonthYmd);
    if (!month || month.status !== "granted") return { action: "not_granted" as const };

    const data = (month.data ?? {}) as Record<string, unknown>;
    const threshold = Number(data.threshold);
    if (!Number.isFinite(threshold) || threshold <= 0) {
      logger.error("DC reconcile: granted month lacks a threshold snapshot — skipping", {
        service: SERVICE_NAME,
        monthId: month.id,
        workerId,
        workMonthYmd,
      });
      return { action: "unchanged" as const };
    }

    const { employerId, employmentStatusId } = await dc.ensureDcFundIdentities();
    primeDcFundEmployerCache(employerId);
    const { year, month: m } = ymdToParts(workMonthYmd);
    const dcRows = await dc.getHoursRowsForWorkerEmployerMonth(workerId, employerId, year, m);
    const currentDcHours = dcRows.reduce((sum, r) => sum + (r.hours ?? 0), 0);
    if (dcRows.length === 0 || currentDcHours <= 0) return { action: "unchanged" as const };

    const qualifyingHours = await dc.getQualifyingHoursForWorkerMonth(
      workerId,
      year,
      m,
      employerId,
    );
    const newShortfall = Math.max(0, threshold - qualifyingHours);
    // Downward only — a shrinking employer report never grows DC back.
    const target = Math.min(currentDcHours, newShortfall);
    if (target === currentDcHours) return { action: "unchanged" as const };

    if (target > 0) {
      await storage.workerHours.upsertWorkerHours({
        workerId,
        year,
        month: m,
        day: dcRows[0].day,
        employerId,
        employmentStatusId,
        hours: target,
      });
      await dc.applyMonthGrantTransition(month.id, {
        data: { grantedHours: target, qualifyingHoursAtReconcile: qualifyingHours },
        event: {
          type: "case_month_reconciled",
          dedupeKey: `case_month_reconciled:${month.id}:${target}`,
          payload: { threshold, qualifyingHours, previousDcHours: currentDcHours, dcHours: target },
        },
      });
      return { action: "reduced" as const, dcHours: target };
    }

    for (const row of dcRows) {
      await storage.workerHours.deleteWorkerHours(row.id);
    }
    await dc.applyMonthGrantTransition(month.id, {
      status: "removed",
      voidReason: "Reconciled away — later employer hours reached the continuation threshold",
      data: { grantedHours: 0, qualifyingHoursAtReconcile: qualifyingHours },
      event: {
        type: "case_month_reconciled",
        dedupeKey: `case_month_reconciled:${month.id}:0`,
        payload: {
          threshold,
          qualifyingHours,
          previousDcHours: currentDcHours,
          dcHours: 0,
          removed: true,
        },
      },
    });
    return { action: "removed" as const };
  });
}

// ---------------------------------------------------------------------------
// Reconciliation listener — later employer reporting reduces DC grants.
// ---------------------------------------------------------------------------

let dcFundEmployerIdCache: { id: string | null; at: number } | null = null;

/**
 * Overwrite the cached pseudo-employer id with a KNOWN value. Called by every
 * grant/reconcile path right after `ensureDcFundIdentities` resolves the
 * employer, so a stale negative entry (cached by a charge-guard lookup that
 * ran before the first provisioning) can never survive into the grant's own
 * hours write — the charge plugin's guard sees the fresh id immediately.
 */
export function primeDcFundEmployerCache(id: string): void {
  dcFundEmployerIdCache = { id, at: Date.now() };
}

/** Cached lookup of the DC pseudo-employer id (null until provisioned). */
export async function getDcFundEmployerId(): Promise<string | null> {
  const now = Date.now();
  if (dcFundEmployerIdCache && (dcFundEmployerIdCache.id !== null || now - dcFundEmployerIdCache.at < 60_000)) {
    return dcFundEmployerIdCache.id;
  }
  const employer = await storage.employers.getBySiriusId(BAO_DC_FUND_EMPLOYER_SIRIUS_ID);
  dcFundEmployerIdCache = { id: employer?.id ?? null, at: now };
  return dcFundEmployerIdCache.id;
}

/** Test-only: force a (possibly stale/negative) cache entry. */
export function __setDcFundEmployerCache(id: string | null): void {
  dcFundEmployerIdCache = { id, at: Date.now() };
}

export async function isDcFundEmployer(employerId: string | null | undefined): Promise<boolean> {
  if (!employerId) return false;
  return (await getDcFundEmployerId()) === employerId;
}

/** Test-only: drop the cached pseudo-employer id. */
export function __clearDcFundEmployerCache(): void {
  dcFundEmployerIdCache = null;
}

function componentsActive(): boolean {
  return isCacheInitialized() && isComponentEnabledSync("sitespecific.bao");
}

async function handleHoursSaved(payload: HoursSavedPayload): Promise<void> {
  if (!componentsActive()) return;
  onAfterCommit(() => {
    void (async () => {
      try {
        // DC's own writes (and deletes) are attributed to the pseudo-employer
        // — never reconcile against them (no feedback loop).
        if (await isDcFundEmployer(payload.employerId)) return;
        const workMonthYmd = partsToYmd(payload.year, payload.month);
        const month = await storage.baoDisabilityCredit.getApplicableMonthForWorkerMonth(
          payload.workerId,
          workMonthYmd,
        );
        if (!month || month.status !== "granted") return;
        const result = await reconcileDcGrantForWorkerMonth(payload.workerId, workMonthYmd);
        if (result.action !== "unchanged" && result.action !== "not_granted") {
          logger.info("DC grant reconciled after employer hours change", {
            service: SERVICE_NAME,
            workerId: payload.workerId,
            workMonthYmd,
            action: result.action,
            dcHours: result.dcHours ?? 0,
          });
        }
      } catch (err) {
        logger.error("DC grant reconciliation failed", {
          service: SERVICE_NAME,
          workerId: payload.workerId,
          year: payload.year,
          month: payload.month,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  });
}

let reconciliationHandlerId: string | null = null;

/** Idempotent boot-time registration of the reconciliation listener. */
export function initDcGrantReconciliation(): void {
  if (reconciliationHandlerId) return;
  reconciliationHandlerId = eventBus.on({
    name: "bao-dc-grant-reconcile",
    description:
      "Reconciles a granted Disability Credit month downward when later employer hours arrive for the same work month — reduces the fund-attributed DC hours to the new shortfall or removes them at zero (restoring annual capacity). Never increases DC hours.",
    event: EventType.HOURS_SAVED,
    handler: handleHoursSaved,
  });
}
