import { z } from "zod";
import { COMM_STATUSES } from "./commStatus";
import { isValidYmd } from "./utils/date";

export const WORKER_COMMS_COMPONENT = "worker.comms_compliance";
export const benefitPeriodSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("current") }).strict(),
  z.object({ mode: z.literal("ever") }).strict(),
  z.object({ mode: z.literal("lookback"), months: z.number().int().min(1).max(1200) }).strict(),
  z.object({
    mode: z.literal("range"),
    from: z.string().refine(isCalendarDay, "Use a valid YYYY-MM-DD date"),
    through: z.string().refine(isCalendarDay, "Use a valid YYYY-MM-DD date"),
  }).strict(),
]).refine(v => v.mode !== "range" || v.from <= v.through, {
  message: "Benefit through must be on or after benefit from", path: ["through"],
});
export type BenefitPeriod = z.infer<typeof benefitPeriodSchema>;
export const compliancePopulationSchema = z.object({
  nameIdSearch: z.string().max(200).default(""),
  contactSearch: z.string().max(200).default(""),
  memberStatusIds: z.array(z.string().min(1)).max(200).default([]),
  benefitIds: z.array(z.string().min(1)).max(200).default([]),
  benefitPeriod: benefitPeriodSchema.optional(),
  employerId: z.string().default(""),
  employerTypeId: z.string().default(""),
  bargainingUnitId: z.string().default(""),
  representativeId: z.string().default(""),
  jobTitle: z.string().max(200).default(""),
  hasMultipleEmployers: z.boolean().default(false),
  contactStatus: z.enum(["all", "has_email", "missing_email", "has_phone", "missing_phone", "has_address", "missing_address", "complete", "incomplete"]).default("all"),
}).strict();
function isCalendarDay(value: string) {
  if (!isValidYmd(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
const optionalDay = z.string().refine(v => !v || isCalendarDay(v), "Use a valid YYYY-MM-DD date").default("");
export const workerCommsDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(150),
  population: compliancePopulationSchema,
  commTagId: z.string().min(1),
  statuses: z.array(z.enum(COMM_STATUSES)).min(1).max(COMM_STATUSES.length),
  medium: z.enum(["", "email", "sms", "postal", "inapp"]).default(""),
  sentFrom: optionalDay,
  sentThrough: optionalDay,
}).strict().refine(v => !v.sentFrom || !v.sentThrough || v.sentFrom <= v.sentThrough, {
  message: "Sent through must be on or after sent from", path: ["sentThrough"],
});
export type WorkerCommsDefinitionInput = z.input<typeof workerCommsDefinitionSchema>;
export type WorkerCommsDefinition = z.infer<typeof workerCommsDefinitionSchema> & { id: string };
export const complianceViewSchema = z.enum(["all", "with", "without"]);
export type ComplianceView = z.infer<typeof complianceViewSchema>;
export interface WorkerCommsRow {
  workerId: string;
  contactId: string;
  siriusId: number | null;
  name: string;
  commId: string | null;
  status: string | null;
  medium: string | null;
  sent: string | null;
}
export interface WorkerCommsCounts { population: number; with: number; without: number }
export interface WorkerCommsReport {
  definition: WorkerCommsDefinition;
  counts: WorkerCommsCounts;
  rows: WorkerCommsRow[];
  total: number;
  page: number;
  pageSize: number;
  benefitMonth: string;
  benefitPeriod?: ResolvedBenefitPeriod;
}
export interface ResolvedBenefitPeriod {
  mode: BenefitPeriod["mode"] | "all";
  fromMonth: string | null;
  throughMonth: string | null;
  referenceMonth: string;
  label: string;
}

/** Monthly source data cannot establish a worker's exact day of coverage. */
export function resolveBenefitPeriod(
  population: Pick<WorkerCommsDefinition["population"], "benefitIds" | "benefitPeriod">,
  referenceMonth: string,
): ResolvedBenefitPeriod {
  const period = benefitPeriodSchema.parse(population.benefitPeriod ?? { mode: "current" });
  const base = { referenceMonth };
  if (!population.benefitIds.length) {
    return { ...base, mode: "all", fromMonth: null, throughMonth: null, label: "No benefit restriction" };
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(referenceMonth)) throw new Error("Invalid benefit reference month");
  if (period.mode === "ever") {
    return { ...base, mode: "ever", fromMonth: null, throughMonth: referenceMonth, label: `Ever through ${referenceMonth}` };
  }
  if (period.mode === "range") {
    const fromMonth = period.from.slice(0, 7), throughMonth = period.through.slice(0, 7);
    return { ...base, mode: "range", fromMonth, throughMonth, label: `${fromMonth} through ${throughMonth} (monthly coverage)` };
  }
  if (period.mode === "lookback") {
    const [year, month] = referenceMonth.split("-").map(Number);
    const firstIndex = year * 12 + month - 1 - (period.months - 1);
    if (firstIndex < 12) throw new Error("Benefit lookback extends before year 1");
    const fromMonth = `${String(Math.floor(firstIndex / 12)).padStart(4, "0")}-${String(firstIndex % 12 + 1).padStart(2, "0")}`;
    return { ...base, mode: "lookback", fromMonth, throughMonth: referenceMonth,
      label: `Last ${period.months} month${period.months === 1 ? "" : "s"}, including current: ${fromMonth} through ${referenceMonth}` };
  }
  return { ...base, mode: "current", fromMonth: referenceMonth, throughMonth: referenceMonth, label: `Current month: ${referenceMonth}` };
}
export interface WorkerCommsOptions {
  tags: { id: string; name: string }[];
  memberStatuses: { id: string; name: string }[];
  benefits: { id: string; name: string }[];
  employers: { id: string; name: string }[];
  employerTypes: { id: string; name: string }[];
  bargainingUnits: { id: string; name: string }[];
  representatives: { id: string; name: string }[];
  benefitsEnabled: boolean;
  bargainingUnitsEnabled: boolean;
  politicalEnabled: boolean;
  canManage: boolean;
  canBulk: boolean;
}
