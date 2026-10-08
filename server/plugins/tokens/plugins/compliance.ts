import { registerTokenPlugin } from "../registry";
import { memo, tokenEntityOf, type TokenEvalContext } from "../types";
import { complianceScopeSchema } from "@shared/employer-compliance";
import { loadComplianceLetterValues } from "../../../services/employer-compliance";

export function currentYearMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

type LetterValues = Awaited<ReturnType<typeof loadComplianceLetterValues>>;

/** Plain text, independent of the medium. HTML cleaning belongs to the host. */
export function composeComplianceMessage(
  employerName: string, wizardName: string, date: string, accountName: string,
  values?: LetterValues,
): string {
  if (!values) {
    // Fictional sample values, never used by the real resolver.
    return `${employerName}: ${wizardName}, through ${date}, ${accountName}. Missing reporting periods: ${date}. Delinquent statement periods: ${date}: 125.00. Total delinquent balance: 125.00.`;
  }
  const sentence = (value: string) => value.endsWith(".") ? value : `${value}.`;
  return `${employerName}: ${wizardName} (${values.period_window}), accounts: ${accountName}. ` +
    `Missing reporting periods: ${sentence(values.missing_periods)} ` +
    `Delinquent statement periods: ${sentence(values.delinquent_periods)} ` +
    `Total delinquent balance: ${values.delinquent_total}.`;
}

/**
 * Existing wizard/account/date contract stays intact. Accounts are external
 * Sirius identifiers. An optional comma-separated accounts argument extends
 * the scope without ever embedding internal database ids in saved templates.
 */
const args = {
  wizard: { required: true, description: "Registered upload type id (e.g. gbhet_legal_workers_monthly)" },
  account: { required: true, description: "Sirius ID of the ledger account" },
  accounts: { required: false, description: "Optional additional ledger account Sirius IDs, separated by commas" },
  date: { required: false, description: "End period YYYY-MM; defaults to the current month at render time" },
  months: { required: false, description: "Reporting window from 1 to 24 months; defaults to 6" },
};

async function resolveCompliance(entity: unknown, arguments_: Record<string, string>, ctx: TokenEvalContext) {
  const employer = tokenEntityOf(entity, "employer");
  if (typeof employer?.row.id !== "string") return null;
  if (!arguments_.account?.trim()) return null;
  const employerId = employer.row.id;
  const date = arguments_.date?.trim() || currentYearMonth(ctx.now);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(date)) return null;
  const siriusIds = [...new Set([arguments_.account, ...(arguments_.accounts ?? "").split(",")]
    .map((id) => id?.trim()).filter((id): id is string => Boolean(id)))];
  if (!siriusIds.length) return null;
  return memo(ctx, `compliance:${JSON.stringify([employerId, arguments_, date])}`, async () => {
    const { wizardPluginRegistry } = await import("../../wizards/registry");
    const wizard = wizardPluginRegistry.get(arguments_.wizard);
    if (!wizard) return null;
    const accounts = await Promise.all(siriusIds.map((id) => ctx.storage.ledger.accounts.getBySiriusId(id)));
    if (accounts.some((account) => !account)) return null;
    const parsed = complianceScopeSchema.safeParse({
      wizardType: arguments_.wizard, year: Number(date.slice(0, 4)),
      month: Number(date.slice(5)), monthsBack: arguments_.months ?? 6,
      ledgerAccountIds: accounts.map((account) => account!.id),
    });
    if (!parsed.success) return null;
    const values = await loadComplianceLetterValues(ctx.storage, parsed.data, employerId);
    return { values, wizardName: wizard.name, accountName: accounts.map((account) => account!.name).join(", "), date };
  });
}
for (const leaf of [
  { segment: "compliance_message", name: "Compliance message", value: null },
  { segment: "compliance_missing_periods", name: "Missing reporting periods", value: "missing_periods" },
  { segment: "compliance_delinquent_periods", name: "Delinquent statement periods and amounts", value: "delinquent_periods" },
  { segment: "compliance_delinquent_total", name: "Total delinquent balance", value: "delinquent_total" },
] as const) {
  registerTokenPlugin({
    metadata: {
      id: `token.employer.${leaf.segment}`, name: leaf.name,
      description: "Actual Employer Compliance report results for the selected upload type, accounts, and reporting window",
      segmentName: leaf.segment, inputTypes: ["employer"], outputType: "value",
      requiredComponent: "ledger", args,
      example: leaf.value === "missing_periods" ? "Jun 2049"
        : leaf.value === "delinquent_periods" ? "Jun 2049: 125.00"
        : leaf.value === "delinquent_total" ? "125.00"
        : composeComplianceMessage("Olympus Mons Freight", "Monthly Hours Upload", "2049-07", "Health & Welfare Trust"),
    },
    async resolve(entity, arguments_, ctx) {
      const result = await resolveCompliance(entity, arguments_, ctx);
      if (!result) return null;
      return leaf.value ? result.values[leaf.value] : composeComplianceMessage(
        result.values.employer_name, result.wizardName, result.date, result.accountName, result.values);
    },
  });
}
