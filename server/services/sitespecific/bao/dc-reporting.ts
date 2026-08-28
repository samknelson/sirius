/**
 * Disability Credit live reporting — the SINGLE source for every dashboard
 * view and export. Every count derives from authoritative case, month,
 * event, and hours rows at read time; nothing here writes, caches, or
 * persists a counter.
 *
 * Views:
 *  - Upcoming populations: FMLA-eligible workers, active-denial-letter
 *    workers (expiry warning under 30 days), and open cases with upcoming
 *    (selected/queued) months. Workers already in the case pipeline are
 *    excluded from the two eligibility populations so each worker appears in
 *    exactly one view.
 *  - Active grants / approval queue / annual max-out with worker, month,
 *    balance, checklist, age and latest-activity context.
 *  - Upload review: retired-Disability employer rows, unreported gaps
 *    between FMLA months, and actionable grant-reconciliation conditions.
 *  - Net grant activity per WORK month from the append-only event log —
 *    grants minus removals, reconciled exactly against the currently-granted
 *    month rows.
 */
import { storage } from "../../../storage";
import {
  BAO_DC_ANNUAL_MONTH_LIMIT,
  BAO_DC_FMLA_REQUIRED_MONTHS,
  type BaoDcCase,
  type BaoDcCaseMonth,
} from "@shared/schema";
import {
  denialLetterExpiryYmd,
  isDenialLetterActive,
  rollingWindow,
  findUnreportedGapsBetweenFmlaMonths,
} from "@shared/sitespecific/bao/dc-eligibility";
import {
  buildDcYearUsage,
  daysUntilYmd,
  isDcExpiryWarning,
  summarizeDcGrantActivity,
  type DcNetActivityRow,
} from "@shared/sitespecific/bao/dc-reporting";
import { getDcDenialLetterValidityMonths } from "./dc-settings";
import { getDcCaseBundle } from "./dc-workflow";
import { addMonthsYmd } from "@shared/utils/date";

export interface DcWorkerRef {
  workerId: string;
  siriusId: number | null;
  name: string;
}

const todayYmd = () => new Date().toISOString().slice(0, 10);
const currentMonthYmd = () => `${todayYmd().slice(0, 7)}-01`;

async function workerRefMap(workerIds: string[]): Promise<Map<string, DcWorkerRef>> {
  const refs = await storage.baoDisabilityCredit.getWorkerRefs(workerIds);
  return new Map(
    refs.map((r) => [r.workerId, { workerId: r.workerId, siriusId: r.siriusId, name: r.name }]),
  );
}

function ref(map: Map<string, DcWorkerRef>, workerId: string): DcWorkerRef {
  return map.get(workerId) ?? { workerId, siriusId: null, name: "(unknown worker)" };
}

/** Worker ids with any OPEN (non-terminal) case — the case pipeline. */
async function openCaseWorkerIds(): Promise<Set<string>> {
  const dc = storage.baoDisabilityCredit;
  const open = await Promise.all([
    dc.listCasesByStatus("draft"),
    dc.listCasesByStatus("ready_for_review"),
    dc.listCasesByStatus("in_queue"),
  ]);
  return new Set(open.flat().map((c) => c.workerId));
}

// ---------------------------------------------------------------------------
// Upcoming populations
// ---------------------------------------------------------------------------

export interface DcUpcomingPopulations {
  asOfYmd: string;
  /** FMLA-eligible workers (>=3 FMLA months in rolling 12) with no open case. */
  fmlaEligible: Array<{
    worker: DcWorkerRef;
    fmlaMonths: string[];
  }>;
  /** Workers holding an ACTIVE denial letter, with derived expiry. */
  denialLetters: Array<{
    worker: DcWorkerRef;
    letterYmd: string;
    expiryYmd: string;
    daysToExpiry: number;
    /** Under 30 days from expiry — must be highlighted. */
    expiryWarning: boolean;
  }>;
  /** Open cases carrying upcoming (selected or queued) months. */
  upcomingMonths: Array<{
    caseId: string;
    caseStatus: string;
    worker: DcWorkerRef;
    months: Array<{ workMonthYmd: string; status: string }>;
  }>;
}

export async function getDcUpcomingPopulations(
  asOfYmd = todayYmd(),
): Promise<DcUpcomingPopulations> {
  const dc = storage.baoDisabilityCredit;
  const { startMonthYmd, endMonthYmd } = rollingWindow(asOfYmd);
  const [fmlaRows, letters, validityMonths, pipeline, pendingMonths] = await Promise.all([
    dc.listFmlaMonthRows(startMonthYmd, endMonthYmd),
    dc.listAllNonVoidedDenialLetters(),
    getDcDenialLetterValidityMonths(),
    openCaseWorkerIds(),
    dc.listMonthsByStatuses(["selected", "queued"]),
  ]);

  // FMLA-eligible: >= required distinct months in the window, no open case.
  const fmlaByWorker = new Map<string, string[]>();
  for (const row of fmlaRows) {
    const list = fmlaByWorker.get(row.workerId) ?? [];
    list.push(row.monthYmd);
    fmlaByWorker.set(row.workerId, list);
  }
  const fmlaEligibleIds = Array.from(fmlaByWorker.entries())
    .filter(([workerId, months]) => months.length >= BAO_DC_FMLA_REQUIRED_MONTHS && !pipeline.has(workerId))
    .map(([workerId]) => workerId);

  // Active denial letters (derived validity window), no open case.
  const activeLetters = letters.filter(
    (l) => isDenialLetterActive(l, asOfYmd, validityMonths) && !pipeline.has(l.workerId),
  );

  // Open cases with pending (selected/queued) months.
  const monthsByCase = new Map<string, BaoDcCaseMonth[]>();
  for (const m of pendingMonths) {
    const list = monthsByCase.get(m.caseId) ?? [];
    list.push(m);
    monthsByCase.set(m.caseId, list);
  }
  const upcomingCases = (
    await Promise.all(Array.from(monthsByCase.keys()).map((id) => dc.getCase(id)))
  ).filter((c): c is BaoDcCase => !!c && ["draft", "ready_for_review", "in_queue", "approved"].includes(c.status));

  const refs = await workerRefMap([
    ...fmlaEligibleIds,
    ...activeLetters.map((l) => l.workerId),
    ...upcomingCases.map((c) => c.workerId),
  ]);

  return {
    asOfYmd,
    fmlaEligible: fmlaEligibleIds
      .map((workerId) => ({
        worker: ref(refs, workerId),
        fmlaMonths: (fmlaByWorker.get(workerId) ?? []).sort(),
      }))
      .sort((a, b) => a.worker.name.localeCompare(b.worker.name)),
    denialLetters: activeLetters
      .map((l) => {
        const expiryYmd = denialLetterExpiryYmd(l.letterYmd, validityMonths);
        return {
          worker: ref(refs, l.workerId),
          letterYmd: l.letterYmd,
          expiryYmd,
          daysToExpiry: daysUntilYmd(expiryYmd, asOfYmd),
          expiryWarning: isDcExpiryWarning(expiryYmd, asOfYmd),
        };
      })
      .sort((a, b) => a.daysToExpiry - b.daysToExpiry),
    upcomingMonths: upcomingCases
      .map((c) => ({
        caseId: c.id,
        caseStatus: c.status,
        worker: ref(refs, c.workerId),
        months: (monthsByCase.get(c.id) ?? [])
          .map((m) => ({ workMonthYmd: m.workMonthYmd, status: m.status }))
          .sort((a, b) => a.workMonthYmd.localeCompare(b.workMonthYmd)),
      }))
      .sort((a, b) => a.worker.name.localeCompare(b.worker.name)),
  };
}

// ---------------------------------------------------------------------------
// Active grants
// ---------------------------------------------------------------------------

export interface DcActiveGrantRow {
  worker: DcWorkerRef;
  caseId: string;
  workMonthYmd: string;
  grantedHours: number | null;
  coverageMonthYmd: string | null;
  /** Coverage month is the current month or later. */
  current: boolean;
  yearUsage: { used: number; limit: number };
  latestActivity: { eventType: string; at: string } | null;
}

export async function listDcActiveGrants(): Promise<DcActiveGrantRow[]> {
  const dc = storage.baoDisabilityCredit;
  const granted = await dc.listMonthsByStatuses(["granted"]);
  const workerIds = granted.map((m) => m.workerId);
  const [refs, usageRows, latest] = await Promise.all([
    workerRefMap(workerIds),
    dc.listApplicableMonthCountsByWorkerYear(),
    dc.getLatestEventPerWorker(workerIds),
  ]);
  const usageByWorkerYear = new Map(
    usageRows.map((u) => [`${u.workerId}:${u.year}`, u.used]),
  );
  const latestByWorker = new Map(latest.map((e) => [e.workerId, e]));
  const nowMonth = currentMonthYmd();

  return granted
    .map((m) => {
      const data = (m.data ?? {}) as Record<string, unknown>;
      const coverage =
        typeof data.coverageMonthYmd === "string" ? data.coverageMonthYmd : null;
      const year = Number(m.workMonthYmd.slice(0, 4));
      const latestEvent = latestByWorker.get(m.workerId);
      return {
        worker: ref(refs, m.workerId),
        caseId: m.caseId,
        workMonthYmd: m.workMonthYmd,
        grantedHours: Number.isFinite(Number(data.grantedHours))
          ? Number(data.grantedHours)
          : null,
        coverageMonthYmd: coverage,
        current: (coverage ?? m.workMonthYmd) >= nowMonth,
        yearUsage: {
          used: usageByWorkerYear.get(`${m.workerId}:${year}`) ?? 0,
          limit: BAO_DC_ANNUAL_MONTH_LIMIT,
        },
        latestActivity: latestEvent
          ? { eventType: latestEvent.eventType, at: latestEvent.createdAt.toISOString() }
          : null,
      };
    })
    .sort(
      (a, b) =>
        b.workMonthYmd.localeCompare(a.workMonthYmd) ||
        a.worker.name.localeCompare(b.worker.name),
    );
}

// ---------------------------------------------------------------------------
// Approval queue (shared with the staff queue route)
// ---------------------------------------------------------------------------

export interface DcQueueRow {
  case: BaoDcCase;
  worker: DcWorkerRef;
  queuedAt: Date | string;
  ageDays: number;
  readiness?: { ready: boolean; missing: string[] };
  monthCount: number;
  yearUsage: Record<string, { used: number; limit: number }>;
  /** Advisory: selected months whose approval-time grant check would fail. */
  grantConfigWarnings: Array<{ workMonthYmd: string; code: string; message: string }>;
}

/** In-queue cases, oldest first, with queue age + live readiness + balance. */
export async function listDcApprovalQueue(): Promise<DcQueueRow[]> {
  const dc = storage.baoDisabilityCredit;
  const cases = await dc.listCasesByStatus("in_queue");
  const refs = await workerRefMap(cases.map((c) => c.workerId));
  const now = Date.now();
  return Promise.all(
    cases.map(async (c) => {
      const [bundle, events] = await Promise.all([
        getDcCaseBundle(c.id),
        dc.listEventsForCase(c.id),
      ]);
      const queuedEvent = [...events]
        .reverse()
        .find(
          (e) =>
            e.eventType === "case_status_changed" &&
            (e.payload as Record<string, unknown>)?.to === "in_queue",
        );
      const queuedAt = queuedEvent?.createdAt ?? c.createdAt;
      return {
        case: c,
        worker: ref(refs, c.workerId),
        queuedAt,
        ageDays: Math.max(
          0,
          Math.floor((now - new Date(queuedAt as unknown as string).getTime()) / 86400000),
        ),
        readiness: bundle?.readiness,
        monthCount: bundle?.months.filter((m) => m.status !== "removed").length ?? 0,
        yearUsage: bundle?.yearUsage ?? {},
        grantConfigWarnings: bundle?.grantConfigWarnings ?? [],
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Annual max-out
// ---------------------------------------------------------------------------

export interface DcMaxedOutRow {
  worker: DcWorkerRef;
  year: number;
  used: number;
  limit: number;
  latestActivity: { eventType: string; at: string } | null;
}

/** Workers whose derived usage has reached the annual limit, any year. */
export async function listDcMaxedOutWorkers(): Promise<DcMaxedOutRow[]> {
  const dc = storage.baoDisabilityCredit;
  const usage = await dc.listApplicableMonthCountsByWorkerYear();
  const maxed = usage.filter((u) => u.used >= BAO_DC_ANNUAL_MONTH_LIMIT);
  const workerIds = maxed.map((u) => u.workerId);
  const [refs, latest] = await Promise.all([
    workerRefMap(workerIds),
    dc.getLatestEventPerWorker(workerIds),
  ]);
  const latestByWorker = new Map(latest.map((e) => [e.workerId, e]));
  return maxed
    .map((u) => {
      const latestEvent = latestByWorker.get(u.workerId);
      return {
        worker: ref(refs, u.workerId),
        year: u.year,
        used: u.used,
        limit: BAO_DC_ANNUAL_MONTH_LIMIT,
        latestActivity: latestEvent
          ? { eventType: latestEvent.eventType, at: latestEvent.createdAt.toISOString() }
          : null,
      };
    })
    .sort((a, b) => b.year - a.year || a.worker.name.localeCompare(b.worker.name));
}

// ---------------------------------------------------------------------------
// Upload review
// ---------------------------------------------------------------------------

export type DcUploadFindingKind =
  | "retired_disability_row"
  | "fmla_gap"
  | "reconciliation_actionable";

export interface DcUploadFinding {
  kind: DcUploadFindingKind;
  worker: DcWorkerRef;
  monthYmd: string;
  employerName?: string;
  detail: string;
}

/**
 * Upload review: retired-Disability employer rows (trailing 12 months),
 * unreported gaps between a worker's FMLA months, and granted months whose
 * CURRENT employer hours would reduce or remove the grant on reconcile.
 */
export async function listDcUploadReviewFindings(
  asOfYmd = todayYmd(),
): Promise<DcUploadFinding[]> {
  const dc = storage.baoDisabilityCredit;
  const { startMonthYmd, endMonthYmd } = rollingWindow(asOfYmd);
  const [retiredRows, fmlaRows, granted] = await Promise.all([
    dc.listRetiredDisabilityHoursRows(startMonthYmd),
    dc.listFmlaMonthRows(startMonthYmd, endMonthYmd),
    dc.listMonthsByStatuses(["granted"]),
  ]);

  const findings: Omit<DcUploadFinding, "worker">[] = [];
  const workerFor: string[] = [];
  const push = (workerId: string, f: Omit<DcUploadFinding, "worker">) => {
    findings.push(f);
    workerFor.push(workerId);
  };

  for (const row of retiredRows) {
    push(row.workerId, {
      kind: "retired_disability_row",
      monthYmd: `${row.year}-${String(row.month).padStart(2, "0")}-01`,
      employerName: row.employerName,
      detail: `Employer reported the retired "${row.statusName}" status (${row.hours ?? 0} hours) — should be FMLA or a current status.`,
    });
  }

  // Gaps between FMLA months with NO reported hours rows at all.
  const fmlaByWorker = new Map<string, string[]>();
  for (const row of fmlaRows) {
    const list = fmlaByWorker.get(row.workerId) ?? [];
    list.push(row.monthYmd);
    fmlaByWorker.set(row.workerId, list);
  }
  const gapCandidates = Array.from(fmlaByWorker.entries()).filter(
    ([, months]) => months.length >= 2,
  );
  const reported = await dc.listReportedHoursMonthsForWorkers(
    gapCandidates.map(([workerId]) => workerId),
  );
  const reportedByWorker = new Map<string, string[]>();
  for (const row of reported) {
    const list = reportedByWorker.get(row.workerId) ?? [];
    list.push(row.monthYmd);
    reportedByWorker.set(row.workerId, list);
  }
  for (const [workerId, months] of gapCandidates) {
    const gaps = findUnreportedGapsBetweenFmlaMonths(
      months,
      reportedByWorker.get(workerId) ?? [],
    );
    for (const gap of gaps) {
      push(workerId, {
        kind: "fmla_gap",
        monthYmd: gap,
        detail: "No hours reported between surrounding FMLA months — a likely missing employer upload.",
      });
    }
  }

  // Actionable reconciliation: current qualifying hours vs the grant snapshot.
  if (granted.length > 0) {
    const { employerId } = await dc.ensureDcFundIdentities();
    for (const m of granted) {
      const data = (m.data ?? {}) as Record<string, unknown>;
      const threshold = Number(data.threshold);
      const grantedHours = Number(data.grantedHours);
      if (!Number.isFinite(threshold) || threshold <= 0) continue;
      if (!Number.isFinite(grantedHours) || grantedHours <= 0) continue;
      const [year, month] = m.workMonthYmd.split("-").map(Number);
      const qualifying = await dc.getQualifyingHoursForWorkerMonth(
        m.workerId,
        year,
        month,
        employerId,
      );
      const newShortfall = Math.max(0, threshold - qualifying);
      if (newShortfall < grantedHours) {
        push(m.workerId, {
          kind: "reconciliation_actionable",
          monthYmd: m.workMonthYmd,
          detail:
            newShortfall === 0
              ? `Employer hours (${qualifying}) now meet the ${threshold}-hour threshold — the ${grantedHours}-hour grant will be removed on reconcile.`
              : `Employer hours (${qualifying}) reduce the shortfall to ${newShortfall} — the ${grantedHours}-hour grant will be reduced on reconcile.`,
        });
      }
    }
  }

  const refs = await workerRefMap(workerFor);
  return findings
    .map((f, i) => ({ ...f, worker: ref(refs, workerFor[i]) }))
    .sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        a.worker.name.localeCompare(b.worker.name) ||
        a.monthYmd.localeCompare(b.monthYmd),
    );
}

// ---------------------------------------------------------------------------
// Net grant activity (trustee reporting)
// ---------------------------------------------------------------------------

export interface DcNetActivityReportRow extends DcNetActivityRow {
  /** Currently-granted month rows for this work month (live). */
  currentlyGranted: number;
  /** Event-log net matches the live granted rows exactly. */
  reconciled: boolean;
}

/**
 * Net DC months per WORK month from the event log, reconciled against the
 * live granted-month rows. `fromMonthYmd` defaults to a trailing year;
 * pass null to include everything.
 */
export async function getDcNetGrantActivity(
  fromMonthYmd?: string | null,
): Promise<DcNetActivityReportRow[]> {
  const dc = storage.baoDisabilityCredit;
  const from =
    fromMonthYmd === null ? null : fromMonthYmd ?? addMonthsYmd(currentMonthYmd(), -11);
  const [events, grantedCounts] = await Promise.all([
    dc.listGrantActivityEvents(),
    dc.listGrantedMonthCountsByWorkMonth(),
  ]);
  // The storage layer stamps every month-transition event payload with
  // `workMonthYmd` + `monthId`. Defensively resolve any event missing the
  // work month via its month row so no real activity is ever dropped.
  const normalized = await Promise.all(
    events.map(async (e) => {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      if (typeof p.workMonthYmd === "string") return e;
      const monthId = typeof p.monthId === "string" ? p.monthId : null;
      const month = monthId ? await dc.getMonthById(monthId) : undefined;
      return month
        ? { ...e, payload: { ...p, workMonthYmd: month.workMonthYmd } }
        : e;
    }),
  );
  const activity = summarizeDcGrantActivity(normalized);
  const grantedByMonth = new Map(grantedCounts.map((g) => [g.workMonthYmd, g.count]));
  const months = new Set<string>([
    ...activity.map((a) => a.workMonthYmd),
    ...grantedCounts.map((g) => g.workMonthYmd),
  ]);
  const activityByMonth = new Map(activity.map((a) => [a.workMonthYmd, a]));
  return Array.from(months)
    .filter((m) => from === null || m >= from)
    .sort()
    .map((workMonthYmd) => {
      const a = activityByMonth.get(workMonthYmd) ?? {
        workMonthYmd,
        grants: 0,
        removals: 0,
        net: 0,
      };
      const currentlyGranted = grantedByMonth.get(workMonthYmd) ?? 0;
      return { ...a, currentlyGranted, reconciled: a.net === currentlyGranted };
    });
}
