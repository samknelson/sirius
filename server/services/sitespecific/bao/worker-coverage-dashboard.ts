import { formatAmount, getCurrency } from "@shared/currency";
import type { IStorage } from "../../../storage";
import { getSystemTimeZone } from "../../../config/system-timezone";
import { getZonedDateParts } from "../../benefit-scan-schedule";
import { fetchThresholdStatus } from "../../../plugins/trust/eligibility/plugins/sitespecific-bao-threshold";
import { resolveGrantingWorkerPolicyAsOf } from "../../policy-resolution";

export interface CoverageMonth {
  year: number;
  month: number;
  label: string;
}

export interface CoverageHours {
  reported: number;
  required: number;
  thresholdMet: boolean;
}

export interface FutureCoverageRow {
  workMonth: CoverageMonth;
  coverageMonth: CoverageMonth;
  hours: CoverageHours;
  status: "met" | "below" | "pending";
  deadline: string;
}

export interface WorkerCoverageSummary {
  state: "available" | "unlinked" | "unavailable";
  /** Worker record id used for the worker monthly-breakdown link. */
  workerId: string;
  current: {
    coverageMonth: CoverageMonth;
    workMonth: CoverageMonth;
    hours: CoverageHours | null;
    coverage: "covered" | "not-covered" | "stale" | "unavailable";
    causes: { hours: boolean | null; balance: boolean | null };
  };
  balance: {
    available: boolean;
    totals: Array<{ currency: string; amount: string; formatted: string }>;
    /** Accounts excluded rather than misinterpreted as monetary balances. */
    omittedAccounts: Array<{ accountId: string; unit: string }>;
  };
  future: FutureCoverageRow[];
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function shiftCoverageMonth(
  month: number,
  year: number,
  delta: number,
): { month: number; year: number } {
  const ordinal = year * 12 + month - 1 + delta;
  return { month: ((ordinal % 12) + 12) % 12 + 1, year: Math.floor(ordinal / 12) };
}

export function monthView(month: number, year: number): CoverageMonth {
  return { month, year, label: `${MONTHS[month - 1]} ${year}` };
}

export function reportingDeadline(workMonth: CoverageMonth): string {
  const next = shiftCoverageMonth(workMonth.month, workMonth.year, 1);
  return `${next.year}-${String(next.month).padStart(2, "0")}-20`;
}

export function thresholdRowStatus(
  reported: number,
  required: number,
  deadline: string,
  today: string,
): FutureCoverageRow["status"] {
  if (reported >= required) return "met";
  return today <= deadline ? "pending" : "below";
}

/** Adds exact decimal monetary strings without using binary floating point. */
export function sumMoneyAmounts(amounts: string[], precision = 2): string {
  if (!Number.isInteger(precision) || precision < 0 || precision > 10) {
    throw new Error(`Unsupported currency precision: ${precision}`);
  }
  const scale = 10n ** BigInt(precision);
  const cents = amounts.reduce((sum, amount) => {
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(amount);
    if (!match) throw new Error(`Invalid monetary balance: ${amount}`);
    const fraction = match[3] ?? "";
    const excess = fraction.slice(precision);
    if (/[1-9]/.test(excess)) {
      throw new Error(`Balance ${amount} exceeds the currency precision of ${precision}`);
    }
    const significantFraction = fraction.slice(0, precision).padEnd(precision, "0");
    const value = BigInt(match[2]) * scale + BigInt(significantFraction || "0");
    return sum + (match[1] ? -value : value);
  }, 0n);
  const absolute = cents < 0n ? -cents : cents;
  const fraction = precision > 0
    ? `.${String(absolute % scale).padStart(precision, "0")}`
    : "";
  return `${cents < 0n ? "-" : ""}${absolute / scale}${fraction}`;
}

export function accountIsFinancial(account: any): boolean {
  const data = account?.data;
  if (!data || typeof data !== "object" || typeof data.unit !== "string" || !data.unit.trim()) {
    return true;
  }
  const unit = data.unit.trim().toLowerCase();
  const currency = String(account.currencyCode ?? "USD").toLowerCase();
  return unit === currency || ["currency", "money", "financial"].includes(unit);
}

export function causalEvidence(
  resultSummary: any,
  isCovered: boolean,
): { hours: boolean | null; balance: boolean | null } {
  if (isCovered) return { hours: null, balance: null };
  const actions = Array.isArray(resultSummary?.actions) ? resultSummary.actions : [];
  let hoursBlocked = false;
  let balanceBlocked = false;
  let sawHoursEvidence = false;
  let sawBalanceEvidence = false;
  for (const action of actions) {
    // Only count a negative plugin result when this benefit's eligibility
    // outcome actually prevented creation or removed a prior WMB row.
    if (action?.eligible !== false || !["none", "delete"].includes(action?.action)) continue;
    const results = Array.isArray(action?.pluginResults) ? action.pluginResults : [];
    const electionResult = results.find((result: any) => result?.pluginKey === "election");
    // A failed election makes this benefit irrelevant to the worker's selected
    // coverage; don't attribute its other failed rules as a coverage cause.
    if (electionResult && electionResult.eligible !== true) continue;
    for (const result of results) {
      if (result?.pluginKey === "sitespecific-bao-threshold" ||
          result?.pluginKey === "sitespecific-bao-buildup") {
        sawHoursEvidence = true;
        if (result.eligible === false) hoursBlocked = true;
      }
      if (result?.pluginKey === "sitespecific-bao-ee-contributions") {
        sawBalanceEvidence = true;
        if (result.eligible === false) balanceBlocked = true;
      }
    }
  }
  return {
    hours: sawHoursEvidence ? hoursBlocked : null,
    balance: sawBalanceEvidence ? balanceBlocked : null,
  };
}

export function currentCoverageFromScan(
  scan: { status?: string; completedAt?: Date | null; resultSummary?: unknown } | null | undefined,
  coverageRows: Array<{ year: number; month: number }>,
  year: number,
  month: number,
): { coverage: WorkerCoverageSummary["current"]["coverage"]; fresh: boolean } {
  // A current WMB row is itself recorded coverage, including rows entered by
  // staff without a scan. A queued rescan must not erase that positive fact.
  // Only absence requires a completed scan to establish noncoverage.
  if (coverageRows.some((row) => row.year === year && row.month === month)) {
    return { coverage: "covered", fresh: false };
  }
  const fresh = scan?.status === "success" && !!scan.completedAt &&
    scan.resultSummary !== null && scan.resultSummary !== undefined;
  if (!fresh) {
    return { coverage: scan ? "stale" : "unavailable", fresh: false };
  }
  return { coverage: "not-covered", fresh: true };
}

function isoDateInZone(date: Date, timeZone: string): string {
  const { year, month, day } = getZonedDateParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function resolvedThresholdDefaults(
  storage: IStorage,
  workerId: string,
  coverageMonth: CoverageMonth,
): Promise<{ employerId?: string; defaultThreshold: number }> {
  const lastDay = new Date(Date.UTC(coverageMonth.year, coverageMonth.month, 0)).getUTCDate();
  const asOfYmd =
    `${coverageMonth.year}-${String(coverageMonth.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const resolved = await resolveGrantingWorkerPolicyAsOf(storage, workerId, asOfYmd);
  const worker = await storage.workers.getWorker(workerId);
  const employerId = resolved.employerId ?? worker?.denormHomeEmployerId ?? undefined;
  let defaultThreshold = 100;
  if (resolved.policy) {
    const configs = await storage.pluginConfigs.search("trust-eligibility", {
      policy: resolved.policy.id,
    });
    const thresholdRule = configs.find(({ config }) =>
      config.pluginId === "sitespecific-bao-threshold" ||
      config.pluginId === "sitespecific-bao-buildup",
    );
    const configured = Number((thresholdRule?.config.data as Record<string, unknown> | undefined)?.defaultThreshold);
    if (Number.isFinite(configured) && configured >= 0) defaultThreshold = configured;
  }
  return { employerId, defaultThreshold };
}

async function getHoursForCoverageMonth(
  storage: IStorage,
  workerId: string,
  coverage: CoverageMonth,
  thresholdFetcher: typeof fetchThresholdStatus,
): Promise<CoverageHours & { workMonth: CoverageMonth }> {
  const options = await resolvedThresholdDefaults(storage, workerId, coverage);
  const status = await thresholdFetcher(
    workerId,
    { year: coverage.year, month: coverage.month },
    options,
  );
  return {
    workMonth: monthView(status.targetMonth, status.targetYear),
    reported: status.hours,
    required: status.threshold,
    thresholdMet: status.success,
  };
}

export async function buildWorkerCoverageSummary(
  storage: IStorage,
  workerId: string,
  now = new Date(),
  timeZone = getSystemTimeZone(),
  thresholdFetcher: typeof fetchThresholdStatus = fetchThresholdStatus,
): Promise<WorkerCoverageSummary> {
  const { year, month } = getZonedDateParts(now, timeZone);
  const today = isoDateInZone(now, timeZone);
  const currentCoverageMonth = monthView(month, year);

  const [currentHours, scan, coverageRows, balances, accounts] = await Promise.all([
    getHoursForCoverageMonth(storage, workerId, currentCoverageMonth, thresholdFetcher),
    storage.wmbScanQueue.getWorkerQueueEntry(workerId, month, year),
    storage.trust.wmb.getWorkerBenefitPresence(workerId),
    storage.ledger.ea.getByEntityWithBalance("worker", workerId),
    storage.ledger.accounts.getAll(),
  ]);

  const currentScan = currentCoverageFromScan(scan, coverageRows, year, month);
  const currentCoverage = currentScan.coverage;
  const causes = currentScan.fresh
    ? causalEvidence(scan?.resultSummary, currentCoverage === "covered")
    : { hours: null, balance: null };

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const balancesByCurrency = new Map<string, string[]>();
  const omittedAccounts: Array<{ accountId: string; unit: string }> = [];
  for (const entry of balances) {
    const account = accountById.get(entry.accountId);
    if (!account) {
      omittedAccounts.push({ accountId: entry.accountId, unit: "unresolved" });
      continue;
    }
    if (!accountIsFinancial(account)) {
      const data = account.data as Record<string, unknown> | null;
      omittedAccounts.push({
        accountId: entry.accountId,
        unit: typeof data?.unit === "string" ? data.unit : "unsupported",
      });
      continue;
    }
    const currency = account.currencyCode || "USD";
    const values = balancesByCurrency.get(currency) ?? [];
    values.push(entry.balance || "0.00");
    balancesByCurrency.set(currency, values);
  }
  const balanceTotals = Array.from(balancesByCurrency, ([currency, amounts]) => {
    const precision = getCurrency(currency)?.precision ?? 2;
    const amount = sumMoneyAmounts(amounts, precision);
    // Currency formatters take a JS number; keep amounts outside the exact
    // integer range as decimal text instead of silently losing cents.
    const safe = BigInt(amount.split(".")[0]) <= BigInt(Number.MAX_SAFE_INTEGER) &&
      BigInt(amount.split(".")[0]) >= -BigInt(Number.MAX_SAFE_INTEGER);
    return { currency, amount, formatted: safe ? formatAmount(Number(amount), currency) : amount };
  }).sort((a, b) => a.currency.localeCompare(b.currency));
  if (balanceTotals.length === 0) {
    const precision = getCurrency("USD")?.precision ?? 2;
    const amount = sumMoneyAmounts([], precision);
    balanceTotals.push({ currency: "USD", amount, formatted: formatAmount(0, "USD") });
  }

  const future: FutureCoverageRow[] = [];
  for (const delta of [1, 2]) {
    const shifted = shiftCoverageMonth(month, year, delta);
    const coverageMonth = monthView(shifted.month, shifted.year);
    const hours = await getHoursForCoverageMonth(storage, workerId, coverageMonth, thresholdFetcher);
    const deadline = reportingDeadline(hours.workMonth);
    future.push({
      workMonth: hours.workMonth,
      coverageMonth,
      hours: {
        reported: hours.reported,
        required: hours.required,
        thresholdMet: hours.thresholdMet,
      },
      status: thresholdRowStatus(hours.reported, hours.required, deadline, today),
      deadline,
    });
  }

  return {
    state: "available",
    workerId,
    current: {
      coverageMonth: currentCoverageMonth,
      workMonth: currentHours.workMonth,
      hours: {
        reported: currentHours.reported,
        required: currentHours.required,
        thresholdMet: currentHours.thresholdMet,
      },
      coverage: currentCoverage,
      causes,
    },
    balance: { available: true, totals: balanceTotals, omittedAccounts },
    future,
  };
}