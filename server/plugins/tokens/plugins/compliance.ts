import { registerTokenPlugin } from "../registry";
import { memo, tokenEntityOf, type TokenEvalContext } from "../types";
import { complianceScopeSchema, complianceReportSnapshotSchema } from "@shared/employer-compliance";
import { employers } from "@shared/schema";
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
 * Explicit arguments remain available for older non-report templates.
 * Report-linked sends always use their saved report, never these overrides.
 */
const args = {
  wizard: { required: false, description: "Legacy explicit upload type; omit for a report-linked letter" },
  account: { required: false, description: "Legacy explicit account Sirius ID; omit for a report-linked letter" },
  accounts: { required: false, description: "Optional additional ledger account Sirius IDs, separated by commas" },
  date: { required: false, description: "End period YYYY-MM; defaults to the current month at render time" },
  months: { required: false, description: "Reporting window from 1 to 24 months; defaults to 6" },
};

async function savedReport(ctx: TokenEvalContext) {
  const participant = tokenEntityOf(ctx.roots.bulk_participant, "bulk_participant");
  if (typeof participant?.row.messageId !== "string") return null;
  const messageId = participant.row.messageId;
  return memo(ctx, `compliance-report:${messageId}`, async () => {
    const message = await ctx.storage.bulkMessages.getById(messageId);
    const data = message?.data as Record<string, unknown> | null;
    if (!data || !Object.prototype.hasOwnProperty.call(data, "complianceReport")) return null;
    const parsed = complianceReportSnapshotSchema.safeParse(data.complianceReport);
    if (!parsed.success) throw new Error("The saved compliance report is invalid");
    return parsed.data;
  });
}

registerTokenPlugin({
  metadata: {
    id: "token.bulk_participant.compliance_employer",
    name: "Compliance report employer",
    description: "The employer this recipient was queued for by the compliance report",
    segmentName: "compliance_employer",
    inputTypes: ["bulk_participant"], outputType: "employer",
    requiredComponent: "ledger",
  },
  async resolve(entity, _args, ctx) {
    const participant = tokenEntityOf(entity, "bulk_participant");
    const report = await savedReport(ctx);
    if (!report || typeof participant?.row.contactId !== "string") {
      throw new Error("This letter requires a bulk message queued from Employer Compliance");
    }
    const id = report.employerByContact[participant.row.contactId];
    const values = report.valuesByEmployer[id];
    if (!values) throw new Error("This recipient is not associated with an employer in the saved compliance report");
    return { kind: "employer", table: employers, row: { id, name: values.employer_name } };
  },
});

async function resolveCompliance(entity: unknown, arguments_: Record<string, string>, ctx: TokenEvalContext) {
  const employer = tokenEntityOf(entity, "employer");
  if (typeof employer?.row.id !== "string") return null;
  const employerId = employer.row.id;
  const report = await savedReport(ctx);
  if (report) {
    const participant = tokenEntityOf(ctx.roots.bulk_participant, "bulk_participant");
    if (typeof participant?.row.contactId !== "string" ||
        report.employerByContact[participant.row.contactId] !== employerId) return null;
    const values = report.valuesByEmployer[employerId];
    if (!values) return null;
    return {
      values, wizardName: report.wizardName, accountName: report.accountName,
      date: `${report.scope.year}-${String(report.scope.month).padStart(2, "0")}`,
      runAt: report.runAt,
    };
  }
  if (!arguments_.account?.trim() || !arguments_.wizard?.trim()) return null;
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
    return { values, wizardName: wizard.name, accountName: accounts.map((account) => account!.name).join(", "), date, runAt: null };
  });
}
for (const leaf of [
  { segment: "compliance_message", name: "Compliance message", value: null },
  { segment: "compliance_missing_periods", name: "Missing reporting periods", value: "missing_periods" },
  { segment: "compliance_delinquent_periods", name: "Delinquent statement periods and amounts", value: "delinquent_periods" },
  { segment: "compliance_delinquent_total", name: "Total delinquent balance", value: "delinquent_total" },
  { segment: "compliance_period_window", name: "Compliance reporting window", value: "period_window" },
  { segment: "compliance_anchor_month", name: "Compliance report anchor month", value: "anchor_month" },
  { segment: "compliance_report_run_date", name: "Compliance report run date", value: "run_date" },
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
         : leaf.value === "period_window" ? "Feb 2049 – Jul 2049"
         : leaf.value === "anchor_month" ? "2049-07"
         : leaf.value === "run_date" ? "2049-08-01"
        : composeComplianceMessage("Olympus Mons Freight", "Monthly Hours Upload", "2049-07", "Health & Welfare Trust"),
    },
    async resolve(entity, arguments_, ctx) {
      const result = await resolveCompliance(entity, arguments_, ctx);
      if (!result) return null;
       if (leaf.value === "anchor_month") return result.date;
       if (leaf.value === "run_date") {
         if (!result.runAt) return null;
         const date = new Date(result.runAt);
         return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
       }
      return leaf.value ? result.values[leaf.value] : composeComplianceMessage(
        result.values.employer_name, result.wizardName, result.date, result.accountName, result.values);
    },
  });
}
