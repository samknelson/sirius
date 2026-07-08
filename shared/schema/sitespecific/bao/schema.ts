import { pgTable, varchar, jsonb, date, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { parsePhoneNumber } from "libphonenumber-js";
import { employers } from "../../../schema";
import { validateSSN } from "../../../utils/ssn";

export const sitespecificBaoEmployerImmediateEligibility = pgTable(
  "sitespecific_bao_employer_immediate_eligibility",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    employerId: varchar("employer_id")
      .notNull()
      // Explicit name, on purpose: the auto-generated name
      // "sitespecific_bao_employer_immediate_eligibility_employer_id_unique"
      // exceeds Postgres's 63-char identifier limit, so the live DB stores it
      // truncated. drizzle-kit push compares by full (untruncated) name and
      // false-positives an "add constraint" on every db-push preview run
      // unless the declared name matches what Postgres actually kept.
      .unique("sitespecific_bao_employer_immediate_eligibility_employer_id_uni"),
    startYmd: date("start_ymd").notNull(),
    endYmd: date("end_ymd").notNull(),
    data: jsonb("data"),
  },
  (table) => [
    // Explicit name for the same 63-char truncation reason as the unique
    // constraint above: the auto-generated FK name exceeds the limit, so
    // drizzle-kit push would drop/re-add it on every run.
    foreignKey({
      name: "sitespecific_bao_employer_immediate_eligibility_employer_id_emp",
      columns: [table.employerId],
      foreignColumns: [employers.id],
    }).onDelete("cascade"),
  ],
);

export const insertBaoEmployerImmediateEligibilitySchema = createInsertSchema(
  sitespecificBaoEmployerImmediateEligibility,
).omit({
  id: true,
});

export type BaoEmployerImmediateEligibility =
  typeof sitespecificBaoEmployerImmediateEligibility.$inferSelect;
export type InsertBaoEmployerImmediateEligibility = z.infer<
  typeof insertBaoEmployerImmediateEligibilitySchema
>;

function toYmdString(value: string | Date): string {
  if (value instanceof Date) {
    const yr = value.getFullYear();
    const mo = String(value.getMonth() + 1).padStart(2, "0");
    const dy = String(value.getDate()).padStart(2, "0");
    return `${yr}-${mo}-${dy}`;
  }
  return value.length >= 10 ? value.slice(0, 10) : value;
}

const ymdOrDate = z
  .union([z.string(), z.coerce.date()])
  .transform((v) => toYmdString(v));

export const createBaoEmployerImmediateEligibilityRequestSchema = z
  .object({
    employerId: z.string().min(1, "An employer is required"),
    startYmd: ymdOrDate,
    endYmd: ymdOrDate,
    data: z.unknown().nullable().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.endYmd <= val.startYmd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endYmd"],
        message: "endYmd must be strictly after startYmd",
      });
    }
  });

export const updateBaoEmployerImmediateEligibilityRequestSchema = z
  .object({
    employerId: z.string().min(1, "An employer is required").optional(),
    startYmd: ymdOrDate.optional(),
    endYmd: ymdOrDate.optional(),
    data: z.unknown().nullable().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.startYmd && val.endYmd && val.endYmd <= val.startYmd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endYmd"],
        message: "endYmd must be strictly after startYmd",
      });
    }
  });

export type CreateBaoEmployerImmediateEligibilityRequest = z.infer<
  typeof createBaoEmployerImmediateEligibilityRequestSchema
>;
export type UpdateBaoEmployerImmediateEligibilityRequest = z.infer<
  typeof updateBaoEmployerImmediateEligibilityRequestSchema
>;

// ---------------------------------------------------------------------------
// Worker beneficiaries (stored as JSON on the worker at
// `data.sitespecific.bao.beneficiaries`).
// ---------------------------------------------------------------------------

// Tolerance for the "percentages must sum to 100" rule so that splits like
// 33.34/33.33/33.33 are accepted.
export const BAO_BENEFICIARY_PERCENT_EPSILON = 0.01;

// Treat empty / whitespace-only strings on optional text fields as "absent".
const optionalTrimmedString = z.preprocess((val) => {
  if (typeof val !== "string") return val;
  const trimmed = val.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.string().optional());

const optionalSsn = z.preprocess(
  (val) => {
    if (typeof val !== "string") return val;
    const trimmed = val.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  },
  z
    .string()
    .optional()
    .refine(
      (val) => val === undefined || validateSSN(val).valid,
      { message: "Invalid SSN" },
    ),
);

const optionalPhone = z.preprocess(
  (val) => {
    if (typeof val !== "string") return val;
    const trimmed = val.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  },
  z
    .string()
    .optional()
    .refine(
      (val) => {
        if (val === undefined) return true;
        try {
          const parsed = parsePhoneNumber(val, "US");
          return !!parsed && parsed.isValid();
        } catch {
          return false;
        }
      },
      { message: "Invalid phone number" },
    ),
);

export const baoBeneficiarySchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  ssn: optionalSsn,
  phone: optionalPhone,
  address: optionalTrimmedString,
  relationship: optionalTrimmedString,
  percent: z
    .number({ invalid_type_error: "Percent is required" })
    .min(0, "Percent must be at least 0")
    .max(100, "Percent must be at most 100"),
});

export const baoBeneficiaryListSchema = z
  .array(baoBeneficiarySchema)
  .superRefine((list, ctx) => {
    if (list.length === 0) return;
    const total = list.reduce((sum, b) => sum + (b.percent ?? 0), 0);
    if (Math.abs(total - 100) > BAO_BENEFICIARY_PERCENT_EPSILON) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Beneficiary percentages must sum to 100 (currently ${total}).`,
      });
    }
  });

export type BaoBeneficiary = z.infer<typeof baoBeneficiarySchema>;
export type BaoBeneficiaryList = z.infer<typeof baoBeneficiaryListSchema>;

/**
 * Event Center Hours Purchase (ECHP) pricing — owned by the charge plugin.
 *
 * Pricing lives in the `sitespecific-bao-echp` charge plugin's configuration
 * settings (a single global config). The settings hold a flat list of
 * access-policy ids plus a single price ladder of breakpoints. A worker's policy
 * is "enabled" for ECHP when it appears in the policy list.
 *
 * The price a worker pays is determined by the ladder of breakpoints: the first
 * breakpoint (ascending by `maxHoursWorked`) whose `maxHoursWorked` is strictly
 * greater than the worker's hours worked supplies the price. There is exactly
 * one price — no per-policy ladders and no lowest-of selection.
 */
export const baoEchpBreakpointSchema = z.object({
  /** Applies when hours worked is strictly less than this value. */
  maxHoursWorked: z.number().positive(),
  /** Dollar price for the breakpoint. */
  price: z.number().nonnegative(),
});

/**
 * The charge plugin's settings: the flat list of policies that may purchase
 * hours, and the single price ladder. The ledger account ECHP charges post to
 * is now a first-class column on charge_plugin_configs (config.account), not a
 * setting. An empty policy list means no policy can purchase hours.
 */
export const baoEchpChargeSettingsSchema = z.object({
  policyIds: z.array(z.string()).default([]),
  breakpoints: z
    .array(baoEchpBreakpointSchema)
    .min(1, "Add at least one breakpoint"),
});

export type BaoEchpBreakpoint = z.infer<typeof baoEchpBreakpointSchema>;
export type BaoEchpChargeSettings = z.infer<typeof baoEchpChargeSettingsSchema>;

/**
 * Default ECHP pricing ladder used only to pre-fill the price ladder in the
 * configuration form. It is NOT a runtime fallback: a policy not present in the
 * policy list denies purchasing rather than silently applying these.
 */
export const DEFAULT_BAO_ECHP_BREAKPOINTS: BaoEchpBreakpoint[] = [
  { maxHoursWorked: 40, price: 750 },
  { maxHoursWorked: 44, price: 540 },
  { maxHoursWorked: 49, price: 515 },
  { maxHoursWorked: 54, price: 490 },
  { maxHoursWorked: 59, price: 465 },
  { maxHoursWorked: 64, price: 440 },
  { maxHoursWorked: 69, price: 415 },
  { maxHoursWorked: 74, price: 390 },
  { maxHoursWorked: 79, price: 365 },
  { maxHoursWorked: 84, price: 340 },
  { maxHoursWorked: 89, price: 315 },
  { maxHoursWorked: 94, price: 290 },
  { maxHoursWorked: 100, price: 265 },
];
