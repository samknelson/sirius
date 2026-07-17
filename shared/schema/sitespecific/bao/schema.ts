import { pgTable, varchar, jsonb, date, numeric, text, timestamp, unique, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { parsePhoneNumber } from "libphonenumber-js";
import { employers, ledgerAccounts } from "../../../schema";
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

// ---------------------------------------------------------------------------
// Distance cache — a persistent cache of measured worker↔site geographic
// distances so repeated Google Routes API lookups are served from the DB.
// It caches the MEASUREMENT (a distance in miles + how it was derived), not
// any eligibility verdict, keyed on the rounded origin/destination coords.
//
// Rows measured by real driving distance are durable cache hits. Rows that
// fell back to the straight-line (haversine) approximation are considered
// NON-AUTHORITATIVE: they are re-attempted on normal eligibility scans and
// via the admin "Rescan straight-line rows" action, in the hope that a later
// Google Routes lookup succeeds and upgrades the row to a driving distance.
//
// Shared by every BAO plugin that needs worker↔site distances (BAO Start
// Healthnet today, BAO Start Delta in the future).
// ---------------------------------------------------------------------------

export const BAO_DISTANCE_METHODS = ["driving", "straight-line"] as const;
export type BaoDistanceMethod = (typeof BAO_DISTANCE_METHODS)[number];

/**
 * Coordinates are rounded to this many decimal places before they are used to
 * key a cache row. ~5 decimals is roughly 1.1 m of precision — far finer than
 * driving distance cares about — and rounding avoids float jitter producing
 * near-duplicate rows for effectively the same pair.
 */
export const BAO_DISTANCE_CACHE_COORD_PRECISION = 5;

export const sitespecificBaoDistanceCache = pgTable(
  "sitespecific_bao_distance_cache",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    originLat: numeric("origin_lat", { precision: 9, scale: 5 }).notNull(),
    originLng: numeric("origin_lng", { precision: 9, scale: 5 }).notNull(),
    destLat: numeric("dest_lat", { precision: 9, scale: 5 }).notNull(),
    destLng: numeric("dest_lng", { precision: 9, scale: 5 }).notNull(),
    distanceMiles: numeric("distance_miles", { precision: 10, scale: 4 }).notNull(),
    method: varchar("method").notNull().$type<BaoDistanceMethod>(),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    unique("sitespecific_bao_distance_cache_coords_uq").on(
      table.originLat,
      table.originLng,
      table.destLat,
      table.destLng,
    ),
  ],
);

export type BaoDistanceCacheRow = typeof sitespecificBaoDistanceCache.$inferSelect;
export type InsertBaoDistanceCacheRow =
  typeof sitespecificBaoDistanceCache.$inferInsert;

// ---------------------------------------------------------------------------
// Benefit rate sources (contracts / rate letters) and their employer
// associations. A source documents where an employer's rates come from; the
// per-employer rate rows below reference their source. Active/inactive status
// for sources and rate entries is CALCULATED from source precedence per
// employer — it is never stored or manually toggled, so full history is
// preserved for recalculation.
// ---------------------------------------------------------------------------

export const BAO_RATE_SOURCE_TYPES = ["contract", "rate_letter"] as const;
export type BaoRateSourceType = (typeof BAO_RATE_SOURCE_TYPES)[number];

export const sitespecificBaoRateSources = pgTable(
  "sitespecific_bao_rate_sources",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    type: varchar("type").notNull().$type<BaoRateSourceType>(),
    startYmd: date("start_ymd").notNull(),
    data: jsonb("data"),
  },
);

export const sitespecificBaoRateSourceEmployers = pgTable(
  "sitespecific_bao_rate_source_employers",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    sourceId: varchar("source_id").notNull(),
    employerId: varchar("employer_id").notNull(),
  },
  (table) => [
    unique("sitespecific_bao_rate_source_employers_source_employer_uq").on(
      table.sourceId,
      table.employerId,
    ),
    foreignKey({
      name: "sitespecific_bao_rate_source_employers_source_id_fkey",
      columns: [table.sourceId],
      foreignColumns: [sitespecificBaoRateSources.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "sitespecific_bao_rate_source_employers_employer_id_fkey",
      columns: [table.employerId],
      foreignColumns: [employers.id],
    }).onDelete("cascade"),
  ],
);

export type BaoRateSource = typeof sitespecificBaoRateSources.$inferSelect;
export type InsertBaoRateSource = typeof sitespecificBaoRateSources.$inferInsert;
export type BaoRateSourceEmployer =
  typeof sitespecificBaoRateSourceEmployers.$inferSelect;

// ---------------------------------------------------------------------------
// Employer hourly rates (per employer, per fund account, effective-dated).
// This is the rate source the BAO Hourly charge plugin bills from.
// ---------------------------------------------------------------------------

export const sitespecificBaoEmployerRates = pgTable(
  "sitespecific_bao_employer_rates",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    employerId: varchar("employer_id").notNull(),
    accountId: varchar("account_id").notNull(),
    rate: numeric("rate", { precision: 10, scale: 4 }).notNull(),
    effectiveYmd: date("effective_ymd").notNull(),
    sourceId: varchar("source_id"),
    data: jsonb("data"),
  },
  (table) => [
    unique("sitespecific_bao_employer_rates_employer_account_effective_uq").on(
      table.employerId,
      table.accountId,
      table.effectiveYmd,
    ),
    foreignKey({
      name: "sitespecific_bao_employer_rates_employer_id_fkey",
      columns: [table.employerId],
      foreignColumns: [employers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "sitespecific_bao_employer_rates_account_id_fkey",
      columns: [table.accountId],
      foreignColumns: [ledgerAccounts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "sitespecific_bao_employer_rates_source_id_fkey",
      columns: [table.sourceId],
      foreignColumns: [sitespecificBaoRateSources.id],
    }).onDelete("set null"),
  ],
);

export const insertBaoEmployerRateSchema = createInsertSchema(
  sitespecificBaoEmployerRates,
).omit({
  id: true,
});

export type BaoEmployerRate = typeof sitespecificBaoEmployerRates.$inferSelect;
export type InsertBaoEmployerRate = z.infer<typeof insertBaoEmployerRateSchema>;

const rateNumber = z.coerce
  .number({ invalid_type_error: "Rate must be a number" })
  .nonnegative("Rate must be at least 0")
  .refine((v) => Number.isFinite(v), { message: "Rate must be a number" });

const ymdString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
  .refine(
    (val) => {
      const [y, m, d] = val.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return (
        dt.getUTCFullYear() === y &&
        dt.getUTCMonth() === m - 1 &&
        dt.getUTCDate() === d
      );
    },
    { message: "Date must be a valid calendar date" },
  );

/**
 * Bulk create/update request: apply one effective-dated rate per fund account
 * to many employers at once. Existing rows with the same (employer, account,
 * effective date) are updated (upsert); everything else is inserted.
 */
export const bulkUpsertBaoEmployerRatesRequestSchema = z
  .object({
    employerIds: z.array(z.string().min(1)).min(1, "Select at least one employer"),
    effectiveYmd: ymdString,
    sourceId: z.string().min(1).nullable().optional(),
    rates: z
      .array(
        z.object({
          accountId: z.string().min(1, "An account is required"),
          rate: rateNumber,
        }),
      )
      .min(1, "Add at least one rate"),
  })
  .strict()
  .superRefine((val, ctx) => {
    const seen = new Set<string>();
    for (const [i, r] of val.rates.entries()) {
      if (seen.has(r.accountId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rates", i, "accountId"],
          message: "Duplicate fund account",
        });
      }
      seen.add(r.accountId);
    }
  });

export const updateBaoEmployerRateRequestSchema = z
  .object({
    rate: rateNumber.optional(),
    effectiveYmd: ymdString.optional(),
    sourceId: z.string().min(1).nullable().optional(),
  })
  .strict()
  .refine(
    (val) =>
      val.rate !== undefined ||
      val.effectiveYmd !== undefined ||
      val.sourceId !== undefined,
    {
      message: "Provide at least one of rate, effectiveYmd, or sourceId",
    },
  );

export type BulkUpsertBaoEmployerRatesRequest = z.infer<
  typeof bulkUpsertBaoEmployerRatesRequestSchema
>;
export type UpdateBaoEmployerRateRequest = z.infer<
  typeof updateBaoEmployerRateRequestSchema
>;

/** Filters accepted by the rates listing endpoint. */
export const listBaoEmployerRatesQuerySchema = z.object({
  employerId: z.string().min(1).optional(),
  accountId: z.string().min(1).optional(),
  sourceId: z.string().min(1).optional(),
  fromYmd: ymdString.optional(),
  toYmd: ymdString.optional(),
  /** "active" returns only the currently-effective rate per (employer, account). */
  mode: z.enum(["active", "history"]).default("history"),
});

export type ListBaoEmployerRatesQuery = z.infer<
  typeof listBaoEmployerRatesQuerySchema
>;

/**
 * A rate row enriched with its source and calculated status. A rate entry is
 * inactive iff some OTHER source associated with the same employer has a
 * later start date than the entry's own source AND that newer source's start
 * date is on/before the entry's effective date (the newer source governs that
 * period). Sourceless (legacy) rows are always active.
 */
export type BaoEmployerRateWithSource = BaoEmployerRate & {
  sourceName: string | null;
  sourceType: BaoRateSourceType | null;
  sourceStartYmd: string | null;
  isActive: boolean;
};

// ---------------------------------------------------------------------------
// Benefit rate source request schemas
// ---------------------------------------------------------------------------

export const createBaoRateSourceRequestSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    type: z.enum(BAO_RATE_SOURCE_TYPES),
    startYmd: ymdString,
    employerIds: z
      .array(z.string().min(1))
      .min(1, "Associate at least one employer"),
  })
  .strict();

export const updateBaoRateSourceRequestSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").optional(),
    type: z.enum(BAO_RATE_SOURCE_TYPES).optional(),
    startYmd: ymdString.optional(),
    employerIds: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict()
  .refine((val) => Object.keys(val).length > 0, {
    message: "Provide at least one field to update",
  });

export type CreateBaoRateSourceRequest = z.infer<
  typeof createBaoRateSourceRequestSchema
>;
export type UpdateBaoRateSourceRequest = z.infer<
  typeof updateBaoRateSourceRequestSchema
>;

/**
 * A source enriched with its employer associations and calculated status.
 * A source is "active" when, for at least one of its employers, no other
 * associated source has a later start date that is on/before today.
 * `activeForEmployerIds` lists the employers it is currently active for.
 */
export type BaoRateSourceWithDetails = BaoRateSource & {
  employers: { id: string; name: string }[];
  activeForEmployerIds: string[];
  isActive: boolean;
  attachmentCount: number;
};

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
