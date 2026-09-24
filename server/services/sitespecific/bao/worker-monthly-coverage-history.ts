import type { TrustWmbScanQueue } from "@shared/schema";
import { storage } from "../../../storage/database";
import {
  createPolicyResolutionCache,
  resolveEmployerPolicyAsOf,
} from "../../policy-resolution";
import { getSystemTimeZone } from "../../../config/system-timezone";
import { getZonedDateParts } from "../../benefit-scan-schedule";
import {
  fromOrdinal,
  lastDayOfMonthYmd,
  resolveBaoThreshold,
  toOrdinal,
  type BaoThresholdReads,
} from "../../../plugins/trust/eligibility/plugins/bao-shared";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DEFAULT_THRESHOLD = 100;
const HISTORY_PAGE_LIMIT = 120;

export interface WorkerMonthlyCoverageHistoryMonth {
  coverageMonth: { year: number; month: number; label: string };
  workMonth: { year: number; month: number; label: string };
  hours: { reported: number; required: number } | null;
  status: "active" | "inactive" | "unknown";
  reasons: string[];
  medical: string[];
  dental: string[];
  other: string[];
  charge: string | null;
}

export interface WorkerMonthlyCoverageHistory {
  months: WorkerMonthlyCoverageHistoryMonth[];
  total: number;
  showCharges: boolean;
  partial: boolean;
}

type BenefitPresence = Awaited<ReturnType<typeof storage.trust.wmb.getWorkerBenefitPresence>>[number];
type MonthlyHours = Awaited<ReturnType<typeof storage.workerHours.getWorkerHoursMonthly>>[number];
type MonthlyCharge = {
  accountId: string;
  ym: string;
  balanceDelta: string;
  chargeTotal: string;
  hadNonzeroBalance?: boolean;
};

export function coverageMonthLabel(year: number, month: number) {
  return `${MONTHS[month - 1]} ${year}`;
}

function parseMoneyCents(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error(`Invalid ledger amount: ${value}`);
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0") || "0");
  return match[1] ? -cents : cents;
}

function formatMoneyCents(cents: bigint): string {
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

export function deriveChargeHistory(rows: MonthlyCharge[]) {
  const balanceByAccount = new Map<string, bigint>();
  let hadNonzeroHistoricalBalance = rows.some((row) => row.hadNonzeroBalance === true);
  const chargeByMonth = new Map<string, bigint>();
  const chronological = [...rows].sort((a, b) =>
    a.ym.localeCompare(b.ym) || a.accountId.localeCompare(b.accountId),
  );
  for (const row of chronological) {
    const balance = (balanceByAccount.get(row.accountId) ?? 0n) + parseMoneyCents(row.balanceDelta);
    balanceByAccount.set(row.accountId, balance);
    if (balance !== 0n) hadNonzeroHistoricalBalance = true;
    chargeByMonth.set(
      row.ym,
      (chargeByMonth.get(row.ym) ?? 0n) + parseMoneyCents(row.chargeTotal),
    );
  }
  return {
    showCharges: hadNonzeroHistoricalBalance,
    charges: new Map(Array.from(chargeByMonth, ([ym, cents]) => [ym, formatMoneyCents(cents)])),
  };
}

export function classifyBenefitPresence(rows: BenefitPresence[]) {
  const result = { medical: new Set<string>(), dental: new Set<string>(), other: new Set<string>() };
  for (const row of rows) {
    const name = row.benefitName?.trim();
    if (!name) continue;
    const category = `${row.benefitTypeName ?? ""} ${name}`.toLowerCase();
    const bucket = /\bmedical\b/.test(category)
      ? result.medical
      : /\bdental\b/.test(category)
        ? result.dental
        : result.other;
    bucket.add(name);
  }
  return {
    medical: [...result.medical].sort((a, b) => a.localeCompare(b)),
    dental: [...result.dental].sort((a, b) => a.localeCompare(b)),
    other: [...result.other].sort((a, b) => a.localeCompare(b)),
  };
}

type ScanDecision = { status: "active" | "inactive" | "unknown"; reasons: string[] };

/** Missing or stale scan results never become negative coverage evidence. */
export function scanDecisionForMonth(
  rows: TrustWmbScanQueue[],
  coverageRows: BenefitPresence[],
  year: number,
  month: number,
): ScanDecision {
  const hasRecordedCoverage = coverageRows.some((row) => row.year === year && row.month === month);
  if (hasRecordedCoverage) return { status: "active", reasons: [] };

  const latest = rows.filter((row) => row.year === year && row.month === month)
    .sort((a, b) =>
      (new Date((b as typeof b & { queuedAt?: Date }).queuedAt ?? b.completedAt ?? 0).getTime() -
       new Date((a as typeof a & { queuedAt?: Date }).queuedAt ?? a.completedAt ?? 0).getTime()) ||
      b.id.localeCompare(a.id),
    )[0];
  if (latest?.status === "pending" || latest?.status === "processing") {
    return { status: "unknown", reasons: ["A coverage scan is still in progress."] };
  }
  const completed = latest;
  if (
    !completed ||
    completed.status !== "success" ||
    !completed.completedAt ||
    completed.resultSummary === null ||
    completed.resultSummary === undefined
  ) {
    return { status: "unknown", reasons: ["No reliable completed coverage decision is available."] };
  }
  const failedCauses = failedBaoCauses(completed.resultSummary);
  return {
    status: "inactive",
    reasons: failedCauses.length ? failedCauses : ["No failed BAO eligibility rule was recorded for this month."],
  };
}

function failedBaoCauses(summary: unknown): string[] {
  const actions = (summary as { actions?: unknown[] } | null)?.actions;
  if (!Array.isArray(actions)) return [];
  let lowHours = false;
  let unpaidBenefit = false;
  for (const action of actions as any[]) {
    if (action?.eligible !== false || !["none", "delete"].includes(action?.action)) continue;
    const results = Array.isArray(action.pluginResults) ? action.pluginResults : [];
    const election = results.find((result: any) => result?.pluginKey === "election");
    if (election && election.eligible !== true) continue;
    lowHours ||= results.some((result: any) =>
      ["sitespecific-bao-threshold", "sitespecific-bao-buildup"].includes(result?.pluginKey) &&
      result?.eligible === false,
    );
    unpaidBenefit ||= results.some((result: any) =>
      result?.pluginKey === "sitespecific-bao-ee-contributions" &&
      result?.eligible === false,
    );
  }
  return [
    ...(lowHours ? ["Low hours"] : []),
    ...(unpaidBenefit ? ["Unpaid benefit"] : []),
  ];
}

function monthOrdinalFromYmd(ymd: string): number {
  const [year, month] = ymd.slice(0, 7).split("-").map(Number);
  return toOrdinal(year, month);
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function getPolicyThresholdDefaults(workerId: string, coverageOrdinals: number[], monthlyHours: MonthlyHours[]) {
  const elections = await storage.workerTrustElections.listByWorker(workerId);
  const cache = createPolicyResolutionCache();
  const resolvedByMonth = new Map<number, { employerId: string | null; policyId: string | null }>();
  const policies = new Map<string, Promise<any>>();
  for (const ordinal of coverageOrdinals) {
    const { year, month } = fromOrdinal(ordinal);
    const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const asOf = ymd(year, month, endDay);
    const activeEmployerIds = Array.from(new Set(
      elections
        .filter((election) => election.startYmd <= asOf && (!election.endYmd || election.endYmd >= asOf))
        .flatMap((election) => election.employerId ? [election.employerId] : []),
    ));
    const source = fromOrdinal(ordinal - 3);
    const sourceRows = monthlyHours.filter((row) =>
      Number(row.year) === source.year && Number(row.month) === source.month && row.employerId);
    const homeIds = Array.from(new Set(sourceRows
      .filter((row) => row.homeStatus === "all" || row.homeStatus === "some")
      .map((row) => row.employerId as string)));
    const historicalIds = homeIds.length ? homeIds : Array.from(new Set(sourceRows.map((row) => row.employerId as string)));
    const employerIds = activeEmployerIds.length ? activeEmployerIds : historicalIds;
    const policyResults = await Promise.all(employerIds.map((employerId) => {
      const key = `${employerId}:${asOf}`;
      let result = policies.get(key);
      if (!result) {
        result = resolveEmployerPolicyAsOf(storage, employerId, asOf, cache);
        policies.set(key, result);
      }
      return result;
    }));
    const policyIds = new Set(policyResults.map((result) => result.policy?.id).filter(Boolean));
    resolvedByMonth.set(ordinal, {
      employerId: employerIds.length === 1 ? employerIds[0] : null,
      policyId: policyIds.size === 1 && policyResults.every((result) => result.policy) ? [...policyIds][0] : null,
    });
  }
  return resolvedByMonth;
}

export async function buildWorkerMonthlyCoverageHistory(
  workerId: string,
  offset: number,
  limit: number,
  now = new Date(),
): Promise<WorkerMonthlyCoverageHistory> {
  if (!Number.isInteger(offset) || offset < 0) throw new Error("History offset must be a non-negative integer.");
  if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_PAGE_LIMIT) {
    throw new Error(`History limit must be between 1 and ${HISTORY_PAGE_LIMIT}.`);
  }

  const { year: currentYear, month: currentMonth } = getZonedDateParts(now, getSystemTimeZone());
  const currentOrdinal = toOrdinal(currentYear, currentMonth);
    const [benefitsRead, scansRead, hoursRead, chargeConfigsRead, historicalEeAccountsRead] = await Promise.allSettled([
    storage.trust.wmb.getWorkerBenefitPresence(workerId),
    storage.wmbScanQueue.getWorkerCoverageHistoryScans(workerId),
    storage.workerHours.getWorkerHoursMonthly(workerId),
    storage.pluginConfigs.search("charge", { pluginId: "sitespecific-bao-ee-contribution" }),
      storage.ledger.entries.getBaoEeAccountIdsByWorker(workerId),
  ]);
  let partial = [benefitsRead, scansRead, hoursRead, chargeConfigsRead, historicalEeAccountsRead].some((result) => result.status === "rejected");
  const benefitRows = benefitsRead.status === "fulfilled" ? benefitsRead.value : [];
  const scanRows = scansRead.status === "fulfilled" ? scansRead.value : [];
  const monthlyHours = hoursRead.status === "fulfilled" ? hoursRead.value : [];
  const contributionConfigs = chargeConfigsRead.status === "fulfilled"
    ? chargeConfigsRead.value.flatMap(({ config, subsidiary }) => {
        const accountId = (subsidiary as { account?: string | null } | null)?.account;
        return accountId ? [{ configId: config.id, accountId }] : [];
      })
    : [];
  const accountIds = Array.from(new Set([
    ...contributionConfigs.map(({ accountId }) => accountId),
    ...(historicalEeAccountsRead.status === "fulfilled" ? historicalEeAccountsRead.value : []),
  ]));
  const chargeConfigIds = Array.from(new Set(contributionConfigs.map(({ configId }) => configId)));

  let chargeRows: MonthlyCharge[] = [];
  if (accountIds.length) {
    try {
      chargeRows = await storage.ledger.entries.getMonthlyAccountHistoryByEntityAndAccount(
        "worker",
        workerId,
        accountIds,
        chargeConfigIds,
      );
    } catch {
      partial = true;
    }
  }
  const chargeHistory = deriveChargeHistory(chargeRows);
  const hoursByOrdinal = new Map<number, number>();
  if (hoursRead.status === "fulfilled") {
    for (const row of monthlyHours as MonthlyHours[]) {
      const ordinal = toOrdinal(Number(row.year), Number(row.month));
      const total = Number(row.totalHours);
      if (!Number.isFinite(ordinal) || !Number.isFinite(total)) continue;
      hoursByOrdinal.set(ordinal, (hoursByOrdinal.get(ordinal) ?? 0) + total);
    }
  }

  const earliestOrdinals = [
    ...benefitRows.map((row) => toOrdinal(row.year, row.month)),
    ...scanRows.map((row) => toOrdinal(row.year, row.month)),
    ...Array.from(hoursByOrdinal.keys(), (workOrdinal) => workOrdinal + 3),
    ...chargeRows.map((row) => monthOrdinalFromYmd(`${row.ym}-01`)),
  ].filter((ordinal) => ordinal <= currentOrdinal);
  const total = earliestOrdinals.length === 0
    ? 0
    : Math.max(0, currentOrdinal - Math.min(...earliestOrdinals) + 1);
  const allOrdinals = Array.from({ length: total }, (_, index) => currentOrdinal - index);
  const pageOrdinals = allOrdinals.slice(offset, offset + limit);

  let thresholds = new Map<number, { employerId: string | null; policyId: string | null }>();
  let policyResolutionAvailable = true;
  if (pageOrdinals.length) {
    try {
      thresholds = await getPolicyThresholdDefaults(workerId, pageOrdinals, monthlyHours);
    } catch {
      partial = true;
      policyResolutionAvailable = false;
    }
  }

  const defaultsByPolicy = new Map<string, Promise<number>>();
  const employerReads = new Map<string, Promise<any>>();
  let mshRead: Promise<any[]> | undefined;
  let currentHoursRead: Promise<any[]> | undefined;
  const thresholdsReads: BaoThresholdReads = {
    getEmployer: (id) => {
      let result = employerReads.get(id);
      if (!result) {
        result = storage.employers.getEmployer(id);
        employerReads.set(id, result);
      }
      return result;
    },
    getWorkerMsh: () => (mshRead ??= storage.workerMsh.getWorkerMsh(workerId)),
    getWorkerHoursCurrent: () => (currentHoursRead ??= storage.workerHours.getWorkerHoursCurrent(workerId)),
    getWorkerHoursMonthly: async () => monthlyHours,
  };
  const defaultForPolicy = (policyId: string | null) => {
    if (!policyId) return Promise.resolve(DEFAULT_THRESHOLD);
    let result = defaultsByPolicy.get(policyId);
    if (!result) {
      result = storage.pluginConfigs.search("trust-eligibility", { policy: policyId }).then((configs) => {
        const thresholdConfig = configs.find(({ config }) =>
          ["sitespecific-bao-threshold", "sitespecific-bao-buildup"].includes(config.pluginId),
        );
        const configured = Number((thresholdConfig?.config.data as Record<string, unknown> | undefined)?.defaultThreshold);
        return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_THRESHOLD;
      });
      defaultsByPolicy.set(policyId, result);
    }
    return result;
  };

  const months: WorkerMonthlyCoverageHistoryMonth[] = [];
  for (const ordinal of pageOrdinals) {
    const { year, month } = fromOrdinal(ordinal);
    const source = fromOrdinal(ordinal - 3);
  const decision = benefitsRead.status === "fulfilled" && scansRead.status === "fulfilled"
      ? scanDecisionForMonth(scanRows, benefitRows, year, month)
      : { status: "unknown" as const, reasons: ["Coverage records could not be loaded."] };
    const benefits = classifyBenefitPresence(benefitRows.filter((row) => row.year === year && row.month === month));
    let hours: WorkerMonthlyCoverageHistoryMonth["hours"] = null;
    if (hoursRead.status === "fulfilled" && policyResolutionAvailable) {
      const resolved = thresholds.get(ordinal) ?? { employerId: null, policyId: null };
      try {
        const defaultThreshold = await defaultForPolicy(resolved.policyId);
        const asOfYmd = lastDayOfMonthYmd(year, month);
        let threshold = await resolveBaoThreshold(
          workerId,
          resolved.employerId ?? undefined,
          asOfYmd,
          defaultThreshold,
          thresholdsReads,
        );
        // Ambiguous historic employers: do not substitute today's home or
        // current-active employer. Use the lowest applicable requirement from
        // employers that actually reported hours in this source work month.
        if (!resolved.employerId) {
          const candidates = Array.from(new Set(monthlyHours
            .filter((row) => Number(row.year) === source.year && Number(row.month) === source.month)
            .map((row) => row.employerId)
            .filter((id): id is string => !!id)));
          if (candidates.length) {
            const found = await Promise.all(candidates.map((id) =>
              resolveBaoThreshold(workerId, id, asOfYmd, defaultThreshold, thresholdsReads)));
            threshold = found.reduce((lowest, candidate) =>
              candidate.threshold < lowest.threshold ? candidate : lowest);
          }
        }
        const reported = hoursByOrdinal.get(toOrdinal(source.year, source.month)) ?? 0;
        hours = { reported, required: threshold.threshold };
      } catch {
        partial = true;
      }
    }
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    months.push({
      coverageMonth: { year, month, label: coverageMonthLabel(year, month) },
      workMonth: { year: source.year, month: source.month, label: coverageMonthLabel(source.year, source.month) },
      hours,
      ...decision,
      medical: benefits.medical,
      dental: benefits.dental,
      other: benefits.other,
      charge: chargeHistory.showCharges ? chargeHistory.charges.get(ym) ?? "0.00" : null,
    });
  }
  return { months, total, showCharges: chargeHistory.showCharges, partial };
}