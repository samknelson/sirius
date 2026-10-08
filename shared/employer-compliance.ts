import { z } from "zod";

export const complianceScopeSchema = z.object({
  wizardType: z.string().trim().min(1),
  year: z.coerce.number().int().min(1900).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  monthsBack: z.coerce.number().int().min(1).max(24).default(6),
  ledgerAccountIds: z.array(z.string().uuid()).max(100).default([]),
});
export type ComplianceScope = z.infer<typeof complianceScopeSchema>;

export interface ComplianceMonth {
  year: number;
  month: number;
  wizardId: string | null;
  status: string | null;
  currentStep: string | null;
  balanceDelta: string | null;
}

export function compliancePeriods(scope: Pick<ComplianceScope, "year" | "month" | "monthsBack">) {
  return Array.from({ length: scope.monthsBack }, (_, index) => {
    const date = new Date(scope.year, scope.month - scope.monthsBack + index, 1);
    return { year: date.getFullYear(), month: date.getMonth() + 1 };
  });
}

export function isMonthMissing(month: Pick<ComplianceMonth, "status">): boolean {
  return !month.status || (month.status !== "completed" && month.status !== "cancelled");
}

export function isMonthDelinquent(month: Pick<ComplianceMonth, "balanceDelta">): boolean {
  return month.balanceDelta !== null && Number(month.balanceDelta) > 0;
}

export function summarizeCompliance(months: ComplianceMonth[]) {
  const missing = months.filter(isMonthMissing);
  const delinquent = months.filter(isMonthDelinquent);
  return {
    missing,
    delinquent,
    delinquentTotal: delinquent.reduce((total, period) => total + Number(period.balanceDelta), 0).toFixed(2),
  };
}

export function compliancePeriodLabel(period: { year: number; month: number }): string {
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][period.month - 1]} ${period.year}`;
}
