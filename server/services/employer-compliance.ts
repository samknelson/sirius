import type { IStorage } from "../storage";
import type { EmployerWithUploads } from "../storage/wizard_employer_monthly";
import {
  compliancePeriods, compliancePeriodLabel, summarizeCompliance,
  type ComplianceScope, type ComplianceMonth,
} from "@shared/employer-compliance";

export function buildComplianceMonths(
  uploads: EmployerWithUploads["uploads"],
  periods: Array<{ year: number; month: number }>,
  monthlyDeltas: Map<string, number> | undefined,
  hasAccounts: boolean,
): ComplianceMonth[] {
  const sorted = [...uploads].sort((a, b) =>
    (b.createdAt ? new Date(b.createdAt).getTime() : 0) -
    (a.createdAt ? new Date(a.createdAt).getTime() : 0));
  return periods.map((period) => {
    const upload = sorted.find((candidate) => candidate.year === period.year && candidate.month === period.month);
    const delta = monthlyDeltas?.get(`${period.year}-${String(period.month).padStart(2, "0")}`);
    if (delta !== undefined && !Number.isFinite(delta)) throw new Error("Invalid compliance ledger amount");
    return {
      ...period, wizardId: upload?.id ?? null, status: upload?.status ?? null,
      currentStep: upload?.currentStep ?? null,
      balanceDelta: hasAccounts && delta !== undefined ? delta.toFixed(2) : null,
    };
  });
}

async function loadMonthlyDeltas(
  storage: IStorage, scope: ComplianceScope, employerIds: string[],
  periods: Array<{ year: number; month: number }>,
) {
  const deltas = await storage.ledger.entries.getMonthlyDeltasByEntityAndAccount(
    "employer", employerIds, scope.ledgerAccountIds,
    periods.map((period) => `${period.year}-${String(period.month).padStart(2, "0")}`));
  const deltaMap = new Map<string, Map<string, number>>();
  for (const row of deltas) {
    if (!deltaMap.has(row.entityId)) deltaMap.set(row.entityId, new Map());
    deltaMap.get(row.entityId)!.set(row.ym, Number(row.total));
  }
  return deltaMap;
}

/** Dashboard and letter tokens deliberately share the same data and calculation. */
export async function loadComplianceReport(
  storage: IStorage,
  scope: ComplianceScope,
  options: { companyId?: string | null } = {},
) {
  const monthPeriods = compliancePeriods(scope);
  const uploads = await storage.wizardEmployerMonthly.listAllEmployersWithUploadsForRange(
    scope.year, scope.month, scope.wizardType, scope.monthsBack);
  const active = uploads.filter(({ employer }) => employer.isActive);
  const companyMap = await storage.employerCompanies.getByEmployerIdsWithCompanyName(active.map(({ employer }) => employer.id));
  const selected = active.filter(({ employer }) => {
    const company = companyMap.get(employer.id);
    return !options.companyId || (options.companyId === "__none__" ? !company : company?.companyId === options.companyId);
  });
  const employerIds = selected.map(({ employer }) => employer.id);
  const balances = await storage.ledger.entries.getBalancesByEntityAndAccount("employer", employerIds, scope.ledgerAccountIds);
  const deltaMap = await loadMonthlyDeltas(storage, scope, employerIds, monthPeriods);
  const balanceMap = new Map<string, Map<string, string>>();
  for (const row of balances) {
    if (!balanceMap.has(row.entityId)) balanceMap.set(row.entityId, new Map());
    balanceMap.get(row.entityId)!.set(row.accountId, row.total);
  }
  return {
    monthPeriods,
    rows: selected.map(({ employer, uploads }) => {
      const company = companyMap.get(employer.id);
      const accountBalances: Record<string, string | null> = {};
      let total = 0;
      for (const accountId of scope.ledgerAccountIds) {
        const balance = balanceMap.get(employer.id)?.get(accountId) ?? null;
        accountBalances[accountId] = balance;
        if (balance !== null) total += Number(balance);
      }
      return {
        employerId: employer.id, employerName: employer.name, siriusId: employer.siriusId,
        isActive: employer.isActive, companyId: company?.companyId ?? null,
        companyName: company?.companyName ?? null,
        months: buildComplianceMonths(uploads, monthPeriods, deltaMap.get(employer.id), scope.ledgerAccountIds.length > 0),
        balances: accountBalances, totalBalance: total.toFixed(2),
      };
    }),
  };
}

/** Validate references before any letter can describe absence as compliance. */
export async function validateComplianceReferences(storage: IStorage, scope: ComplianceScope): Promise<void> {
  const { wizardPluginRegistry } = await import("../plugins/wizards/registry");
  if (!wizardPluginRegistry.get(scope.wizardType)) throw new Error("Unknown compliance upload type");
  if (scope.ledgerAccountIds.length === 0) throw new Error("Select at least one ledger account for the letter");
  for (const id of scope.ledgerAccountIds) {
    if (!await storage.ledger.accounts.get(id)) throw new Error("Unknown compliance ledger account");
  }
}

export async function loadComplianceLetterValues(storage: IStorage, scope: ComplianceScope, employerId: string) {
  await validateComplianceReferences(storage, scope);
  const record = await storage.wizardEmployerMonthly.listEmployerWithUploadsForRange(
    employerId, scope.year, scope.month, scope.wizardType, scope.monthsBack);
  if (!record || record.employer.id !== employerId || !record.employer.isActive) {
    throw new Error("The employer is unavailable or inactive");
  }
  const periods = compliancePeriods(scope);
  const deltas = await loadMonthlyDeltas(storage, scope, [employerId], periods);
  const summary = summarizeCompliance(buildComplianceMonths(
    record.uploads, periods, deltas.get(employerId), scope.ledgerAccountIds.length > 0,
  ));
  return {
    employer_name: record.employer.name,
    missing_periods: summary.missing.map(compliancePeriodLabel).join(", ") || "No missing reporting periods.",
    delinquent_periods: summary.delinquent.map((period) =>
      `${compliancePeriodLabel(period)}: ${period.balanceDelta}`).join("; ") || "No delinquent statement periods.",
    delinquent_total: summary.delinquentTotal,
    period_window: `${compliancePeriodLabel(periods[0])} – ${compliancePeriodLabel(periods.at(-1)!)}`,
  };
}
