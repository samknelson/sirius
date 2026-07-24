import { pgTable, varchar, jsonb, date, numeric, text, timestamp, unique, foreignKey, boolean, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { parsePhoneNumber } from "libphonenumber-js";
import { employers, ledgerAccounts, ledgerEa, workers, trustBenefits, trustProviders } from "../../../schema";
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

// ---------------------------------------------------------------------------
// COBRA — continuation coverage for people who lose medical/dental benefits.
//
// Rates: an effective-dated rate table per (benefit, covered-lives tier).
// Lookup picks the row with the latest effective date on or before the
// requested date.
//
// Cases: one case per covered person, tracking the qualifying event, the
// election/payment deadlines (auto-calculated, never manually overridden),
// and the medical/dental benefits lost. Status and qualifying-event values
// are options lists (options_bao_cobra_status / options_bao_cobra_qualifying_event)
// managed through the unified options system.
// ---------------------------------------------------------------------------

export const optionsBaoCobraStatus = pgTable("options_bao_cobra_status", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull().unique(),
  description: text("description"),
  /** Machine-readable flag: a case in a closed status is no longer active. */
  closed: boolean("closed").default(false).notNull(),
  sequence: integer("sequence").notNull().default(0),
  data: jsonb("data"),
});

export type OptionsBaoCobraStatus = typeof optionsBaoCobraStatus.$inferSelect;
export type InsertOptionsBaoCobraStatus = typeof optionsBaoCobraStatus.$inferInsert;

export const optionsBaoCobraQualifyingEvent = pgTable(
  "options_bao_cobra_qualifying_event",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 255 }).notNull().unique(),
    description: text("description"),
    sequence: integer("sequence").notNull().default(0),
    data: jsonb("data"),
  },
);

export type OptionsBaoCobraQualifyingEvent =
  typeof optionsBaoCobraQualifyingEvent.$inferSelect;
export type InsertOptionsBaoCobraQualifyingEvent =
  typeof optionsBaoCobraQualifyingEvent.$inferInsert;

/** Covered-lives tiers used to price COBRA coverage. */
export const BAO_COBRA_COVERED_LIVES_TIERS = ["1", "2", "3+"] as const;
export type BaoCobraCoveredLivesTier =
  (typeof BAO_COBRA_COVERED_LIVES_TIERS)[number];

/**
 * COBRA administration fee, as a fraction of the pre-fee package total
 * (2%). The fee is computed ONCE on the summed pre-fee total of all
 * continued benefits — not per benefit line — and rounded to cents, to
 * match the rate sheet's package-total rounding.
 */
export const BAO_COBRA_ADMIN_FEE_RATE = 0.02;

/** Round a dollar amount to cents, avoiding float drift. */
function roundCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export interface BaoCobraFeeBreakdown {
  /** Sum of the benefit rates before the admin fee, rounded to cents. */
  preFeeTotal: number;
  /** The 2% admin fee on the pre-fee total, rounded to cents. */
  adminFee: number;
  /** preFeeTotal + adminFee. */
  total: number;
}

/**
 * Apply the COBRA administration fee to a pre-fee package total.
 * The fee is computed once on the summed total and rounded to cents.
 */
export function applyBaoCobraAdminFee(preFeeTotal: number): BaoCobraFeeBreakdown {
  const base = roundCents(preFeeTotal);
  const adminFee = roundCents(base * BAO_COBRA_ADMIN_FEE_RATE);
  return { preFeeTotal: base, adminFee, total: roundCents(base + adminFee) };
}

export const sitespecificBaoCobraRates = pgTable(
  "sitespecific_bao_cobra_rates",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    benefitId: varchar("benefit_id").notNull(),
    coveredLivesTier: varchar("covered_lives_tier")
      .notNull()
      .$type<BaoCobraCoveredLivesTier>(),
    /** Monthly rate in dollars. */
    rate: numeric("rate", { precision: 10, scale: 2 }).notNull(),
    effectiveYmd: date("effective_ymd").notNull(),
    data: jsonb("data"),
  },
  (table) => [
    unique("sitespecific_bao_cobra_rates_benefit_tier_effective_uq").on(
      table.benefitId,
      table.coveredLivesTier,
      table.effectiveYmd,
    ),
    foreignKey({
      name: "sitespecific_bao_cobra_rates_benefit_id_fkey",
      columns: [table.benefitId],
      foreignColumns: [trustBenefits.id],
    }).onDelete("cascade"),
  ],
);

export const insertBaoCobraRateSchema = createInsertSchema(
  sitespecificBaoCobraRates,
)
  .omit({ id: true })
  .extend({
    coveredLivesTier: z.enum(BAO_COBRA_COVERED_LIVES_TIERS),
  });

export type BaoCobraRate = typeof sitespecificBaoCobraRates.$inferSelect;
export type InsertBaoCobraRate = z.infer<typeof insertBaoCobraRateSchema>;

/** A rate row enriched with its benefit name for display. */
export type BaoCobraRateWithBenefit = BaoCobraRate & {
  benefitName: string | null;
};

/** Where a COBRA case came from. */
export const BAO_COBRA_CASE_SOURCES = ["wmb_event", "life_event", "manual"] as const;
export type BaoCobraCaseSource = (typeof BAO_COBRA_CASE_SOURCES)[number];

export const sitespecificBaoCobraCases = pgTable(
  "sitespecific_bao_cobra_cases",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Where the case came from: wmb_event | life_event | manual. */
    source: varchar("source").notNull().$type<BaoCobraCaseSource>(),
    statusId: varchar("status_id").notNull(),
    qualifyingEventId: varchar("qualifying_event_id"),
    /** The person whose coverage the case continues. */
    coveredPersonWorkerId: varchar("covered_person_worker_id").notNull(),
    /** The subscriber whose plan the covered person lost coverage under. */
    subscriberWorkerId: varchar("subscriber_worker_id").notNull(),
    /** Relationship of the covered person to the subscriber (self, spouse, child, ...). */
    relationship: varchar("relationship"),
    /** Benefit end date = the date COBRA coverage takes effect. */
    cobraEffectiveYmd: date("cobra_effective_ymd").notNull(),
    // Deadline dates below are ALWAYS derived by computeCobraDeadlines —
    // they are stored for querying/reporting but never manually overridden.
    offerYmd: date("offer_ymd"),
    lastDayToElectYmd: date("last_day_to_elect_ymd"),
    electionMadeYmd: date("election_made_ymd"),
    initialPaymentDeadlineYmd: date("initial_payment_deadline_ymd"),
    paymentStatus: varchar("payment_status"),
    medicalBenefitLostId: varchar("medical_benefit_lost_id"),
    dentalBenefitLostId: varchar("dental_benefit_lost_id"),
    maxPeriodYmd: date("max_period_ymd"),
    data: jsonb("data"),
  },
  (table) => [
    foreignKey({
      name: "sitespecific_bao_cobra_cases_status_id_fkey",
      columns: [table.statusId],
      foreignColumns: [optionsBaoCobraStatus.id],
    }),
    foreignKey({
      name: "sitespecific_bao_cobra_cases_qualifying_event_id_fkey",
      columns: [table.qualifyingEventId],
      foreignColumns: [optionsBaoCobraQualifyingEvent.id],
    }).onDelete("set null"),
    foreignKey({
      name: "sitespecific_bao_cobra_cases_covered_person_worker_id_fkey",
      columns: [table.coveredPersonWorkerId],
      foreignColumns: [workers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "sitespecific_bao_cobra_cases_subscriber_worker_id_fkey",
      columns: [table.subscriberWorkerId],
      foreignColumns: [workers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "sitespecific_bao_cobra_cases_medical_benefit_lost_id_fkey",
      columns: [table.medicalBenefitLostId],
      foreignColumns: [trustBenefits.id],
    }).onDelete("set null"),
    foreignKey({
      name: "sitespecific_bao_cobra_cases_dental_benefit_lost_id_fkey",
      columns: [table.dentalBenefitLostId],
      foreignColumns: [trustBenefits.id],
    }).onDelete("set null"),
  ],
);

export const insertBaoCobraCaseSchema = createInsertSchema(
  sitespecificBaoCobraCases,
)
  .omit({ id: true })
  .extend({
    source: z.enum(BAO_COBRA_CASE_SOURCES),
  });

export type BaoCobraCase = typeof sitespecificBaoCobraCases.$inferSelect;
export type InsertBaoCobraCase = z.infer<typeof insertBaoCobraCaseSchema>;

/** A case enriched with display names for the list/detail screens. */
export type BaoCobraCaseWithDetails = BaoCobraCase & {
  statusName: string | null;
  statusClosed: boolean | null;
  qualifyingEventName: string | null;
  coveredPersonName: string | null;
  subscriberName: string | null;
  medicalBenefitLostName: string | null;
  dentalBenefitLostName: string | null;
};

const cobraYmd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format");

export const createBaoCobraRateRequestSchema = z
  .object({
    benefitId: z.string().min(1, "A benefit is required"),
    coveredLivesTier: z.enum(BAO_COBRA_COVERED_LIVES_TIERS),
    rate: z.coerce
      .number({ invalid_type_error: "Rate must be a number" })
      .nonnegative("Rate must be at least 0"),
    effectiveYmd: cobraYmd,
  })
  .strict();

export const updateBaoCobraRateRequestSchema = z
  .object({
    benefitId: z.string().min(1).optional(),
    coveredLivesTier: z.enum(BAO_COBRA_COVERED_LIVES_TIERS).optional(),
    rate: z.coerce.number().nonnegative().optional(),
    effectiveYmd: cobraYmd.optional(),
  })
  .strict()
  .refine((val) => Object.keys(val).length > 0, {
    message: "Provide at least one field to update",
  });

export type CreateBaoCobraRateRequest = z.infer<
  typeof createBaoCobraRateRequestSchema
>;
export type UpdateBaoCobraRateRequest = z.infer<
  typeof updateBaoCobraRateRequestSchema
>;

export const listBaoCobraRatesQuerySchema = z.object({
  benefitId: z.string().min(1).optional(),
  coveredLivesTier: z.enum(BAO_COBRA_COVERED_LIVES_TIERS).optional(),
  asOfYmd: cobraYmd.optional(),
});

export type ListBaoCobraRatesQuery = z.infer<typeof listBaoCobraRatesQuerySchema>;

export const createBaoCobraCaseRequestSchema = z
  .object({
    source: z.enum(BAO_COBRA_CASE_SOURCES),
    statusId: z.string().min(1, "A status is required"),
    qualifyingEventId: z.string().min(1).nullable().optional(),
    coveredPersonWorkerId: z.string().min(1, "A covered person is required"),
    subscriberWorkerId: z.string().min(1, "A subscriber is required"),
    relationship: z.string().trim().min(1).nullable().optional(),
    cobraEffectiveYmd: cobraYmd,
    electionMadeYmd: cobraYmd.nullable().optional(),
    paymentStatus: z.string().trim().min(1).nullable().optional(),
    medicalBenefitLostId: z.string().min(1).nullable().optional(),
    dentalBenefitLostId: z.string().min(1).nullable().optional(),
    data: z.unknown().nullable().optional(),
  })
  .strict();

export const updateBaoCobraCaseRequestSchema = z
  .object({
    source: z.enum(BAO_COBRA_CASE_SOURCES).optional(),
    statusId: z.string().min(1).optional(),
    qualifyingEventId: z.string().min(1).nullable().optional(),
    relationship: z.string().trim().min(1).nullable().optional(),
    cobraEffectiveYmd: cobraYmd.optional(),
    electionMadeYmd: cobraYmd.nullable().optional(),
    paymentStatus: z.string().trim().min(1).nullable().optional(),
    medicalBenefitLostId: z.string().min(1).nullable().optional(),
    dentalBenefitLostId: z.string().min(1).nullable().optional(),
    data: z.unknown().nullable().optional(),
  })
  .strict()
  .refine((val) => Object.keys(val).length > 0, {
    message: "Provide at least one field to update",
  });

export type CreateBaoCobraCaseRequest = z.infer<
  typeof createBaoCobraCaseRequestSchema
>;
export type UpdateBaoCobraCaseRequest = z.infer<
  typeof updateBaoCobraCaseRequestSchema
>;

// ---------------------------------------------------------------------------
// Domestic Partner (DP) rates — an effective-dated rate table per
// (benefit, coverage-tier transition). Lookup picks the row with the latest
// effective date on or before the requested date (same convention as the
// COBRA rates above — no explicit end dates, no fallback when nothing
// applies).
//
// The `family → family with DP` transition has no confirmed business rule
// yet: its rows are stored as configurable PLACEHOLDERS flagged provisional,
// surfaced as such in the UI, and never inferred from the other rates.
// ---------------------------------------------------------------------------

export const BAO_DP_TIER_TRANSITIONS = [
  "single_to_2party",
  "2party_to_family",
  "single_to_family",
  "family_to_family_dp",
] as const;
export type BaoDpTierTransition = (typeof BAO_DP_TIER_TRANSITIONS)[number];

export const BAO_DP_TIER_TRANSITION_LABELS: Record<BaoDpTierTransition, string> = {
  single_to_2party: "Single → 2-Party",
  "2party_to_family": "2-Party → Family",
  single_to_family: "Single → Family",
  family_to_family_dp: "Family → Family with DP",
};

export const sitespecificBaoDpRates = pgTable(
  "sitespecific_bao_dp_rates",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    benefitId: varchar("benefit_id").notNull(),
    tierTransition: varchar("tier_transition")
      .notNull()
      .$type<BaoDpTierTransition>(),
    /** Monthly rate in dollars. */
    rate: numeric("rate", { precision: 10, scale: 2 }).notNull(),
    effectiveYmd: date("effective_ymd").notNull(),
    /**
     * Provisional/placeholder flag. Provisional rows (all
     * family_to_family_dp rows today) are configurable placeholders —
     * never presented as confirmed values.
     */
    provisional: boolean("provisional").notNull().default(false),
    data: jsonb("data"),
  },
  (table) => [
    unique("sitespecific_bao_dp_rates_benefit_transition_effective_uq").on(
      table.benefitId,
      table.tierTransition,
      table.effectiveYmd,
    ),
    foreignKey({
      name: "sitespecific_bao_dp_rates_benefit_id_fkey",
      columns: [table.benefitId],
      foreignColumns: [trustBenefits.id],
    }).onDelete("cascade"),
  ],
);

export const insertBaoDpRateSchema = createInsertSchema(sitespecificBaoDpRates)
  .omit({ id: true })
  .extend({
    tierTransition: z.enum(BAO_DP_TIER_TRANSITIONS),
  });

export type BaoDpRate = typeof sitespecificBaoDpRates.$inferSelect;
export type InsertBaoDpRate = z.infer<typeof insertBaoDpRateSchema>;

/** A rate row enriched with its benefit name for display. */
export type BaoDpRateWithBenefit = BaoDpRate & {
  benefitName: string | null;
};

export const createBaoDpRateRequestSchema = z
  .object({
    benefitId: z.string().min(1, "A benefit is required"),
    tierTransition: z.enum(BAO_DP_TIER_TRANSITIONS),
    rate: z.coerce
      .number({ invalid_type_error: "Rate must be a number" })
      .nonnegative("Rate must be at least 0"),
    effectiveYmd: cobraYmd,
    provisional: z.boolean().optional(),
  })
  .strict();

export const updateBaoDpRateRequestSchema = z
  .object({
    benefitId: z.string().min(1).optional(),
    tierTransition: z.enum(BAO_DP_TIER_TRANSITIONS).optional(),
    rate: z.coerce.number().nonnegative().optional(),
    effectiveYmd: cobraYmd.optional(),
    provisional: z.boolean().optional(),
  })
  .strict()
  .refine((val) => Object.keys(val).length > 0, {
    message: "Provide at least one field to update",
  });

export type CreateBaoDpRateRequest = z.infer<typeof createBaoDpRateRequestSchema>;
export type UpdateBaoDpRateRequest = z.infer<typeof updateBaoDpRateRequestSchema>;

export const listBaoDpRatesQuerySchema = z.object({
  benefitId: z.string().min(1).optional(),
  tierTransition: z.enum(BAO_DP_TIER_TRANSITIONS).optional(),
  asOfYmd: cobraYmd.optional(),
});

export type ListBaoDpRatesQuery = z.infer<typeof listBaoDpRatesQuerySchema>;

export const searchBaoCobraCasesQuerySchema = z.object({
  statusId: z.string().min(1).optional(),
  qualifyingEventId: z.string().min(1).optional(),
  workerId: z.string().min(1).optional(),
  fromYmd: cobraYmd.optional(),
  toYmd: cobraYmd.optional(),
});

export type SearchBaoCobraCasesQuery = z.infer<
  typeof searchBaoCobraCasesQuerySchema
>;

// ---------------------------------------------------------------------------
// Provider premium accounting — an effective-dated monthly premium rate table
// per (benefit, coverage tier), plus premium files that snapshot unpaid
// statement months on a provider's ledger account and record the offsetting
// payment entries. Lookup picks the row with the latest effective date on or
// before the requested date (same convention as the COBRA/DP rates above —
// no explicit end dates, no fallback when nothing applies).
// ---------------------------------------------------------------------------

export const BAO_PREMIUM_COVERAGE_TIERS = ["1", "2", "3+"] as const;
export type BaoPremiumCoverageTier = (typeof BAO_PREMIUM_COVERAGE_TIERS)[number];

export const BAO_PREMIUM_COVERAGE_TIER_LABELS: Record<BaoPremiumCoverageTier, string> = {
  "1": "1 covered person",
  "2": "2 covered people",
  "3+": "3+ covered people",
};

export const sitespecificBaoPremiumRates = pgTable(
  "sitespecific_bao_premium_rates",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    benefitId: varchar("benefit_id").notNull(),
    coverageTier: varchar("coverage_tier")
      .notNull()
      .$type<BaoPremiumCoverageTier>(),
    /** Monthly premium in dollars. */
    rate: numeric("rate", { precision: 10, scale: 2 }).notNull(),
    effectiveYmd: date("effective_ymd").notNull(),
    data: jsonb("data"),
  },
  (table) => [
    unique("sitespecific_bao_premium_rates_benefit_tier_effective_uq").on(
      table.benefitId,
      table.coverageTier,
      table.effectiveYmd,
    ),
    foreignKey({
      name: "sitespecific_bao_premium_rates_benefit_id_fkey",
      columns: [table.benefitId],
      foreignColumns: [trustBenefits.id],
    }).onDelete("cascade"),
  ],
);

export const insertBaoPremiumRateSchema = createInsertSchema(sitespecificBaoPremiumRates)
  .omit({ id: true })
  .extend({
    coverageTier: z.enum(BAO_PREMIUM_COVERAGE_TIERS),
  });

export type BaoPremiumRate = typeof sitespecificBaoPremiumRates.$inferSelect;
export type InsertBaoPremiumRate = z.infer<typeof insertBaoPremiumRateSchema>;

/** A premium rate row enriched with its benefit name for display. */
export type BaoPremiumRateWithBenefit = BaoPremiumRate & {
  benefitName: string | null;
};

export const createBaoPremiumRateRequestSchema = z
  .object({
    benefitId: z.string().min(1, "A benefit is required"),
    coverageTier: z.enum(BAO_PREMIUM_COVERAGE_TIERS),
    rate: z.coerce
      .number({ invalid_type_error: "Rate must be a number" })
      .nonnegative("Rate must be at least 0"),
    effectiveYmd: cobraYmd,
  })
  .strict();

export const updateBaoPremiumRateRequestSchema = z
  .object({
    benefitId: z.string().min(1).optional(),
    coverageTier: z.enum(BAO_PREMIUM_COVERAGE_TIERS).optional(),
    rate: z.coerce.number().nonnegative().optional(),
    effectiveYmd: cobraYmd.optional(),
  })
  .strict()
  .refine((val) => Object.keys(val).length > 0, {
    message: "Provide at least one field to update",
  });

export type CreateBaoPremiumRateRequest = z.infer<typeof createBaoPremiumRateRequestSchema>;
export type UpdateBaoPremiumRateRequest = z.infer<typeof updateBaoPremiumRateRequestSchema>;

export const listBaoPremiumRatesQuerySchema = z.object({
  benefitId: z.string().min(1).optional(),
  coverageTier: z.enum(BAO_PREMIUM_COVERAGE_TIERS).optional(),
  asOfYmd: cobraYmd.optional(),
});

export type ListBaoPremiumRatesQuery = z.infer<typeof listBaoPremiumRatesQuerySchema>;

// --- Premium files ---------------------------------------------------------

export const sitespecificBaoPremiumFiles = pgTable(
  "sitespecific_bao_premium_files",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    providerId: varchar("provider_id").notNull(),
    accountId: varchar("account_id").notNull(),
    eaId: varchar("ea_id").notNull(),
    generatedAt: timestamp("generated_at").notNull().default(sql`now()`),
    totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
    rowCount: integer("row_count").notNull(),
    data: jsonb("data"),
  },
  (table) => [
    foreignKey({
      name: "sitespecific_bao_premium_files_provider_id_fkey",
      columns: [table.providerId],
      foreignColumns: [trustProviders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "sitespecific_bao_premium_files_account_id_fkey",
      columns: [table.accountId],
      foreignColumns: [ledgerAccounts.id],
    }),
    foreignKey({
      name: "sitespecific_bao_premium_files_ea_id_fkey",
      columns: [table.eaId],
      foreignColumns: [ledgerEa.id],
    }).onDelete("cascade"),
  ],
);

export const sitespecificBaoPremiumFileRows = pgTable(
  "sitespecific_bao_premium_file_rows",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    fileId: varchar("file_id").notNull(),
    workerId: varchar("worker_id"),
    benefitId: varchar("benefit_id"),
    statementYmd: date("statement_ymd").notNull(),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    data: jsonb("data"),
  },
  (table) => [
    foreignKey({
      name: "sitespecific_bao_premium_file_rows_file_id_fkey",
      columns: [table.fileId],
      foreignColumns: [sitespecificBaoPremiumFiles.id],
    }).onDelete("cascade"),
  ],
);

export type BaoPremiumFile = typeof sitespecificBaoPremiumFiles.$inferSelect;
export type BaoPremiumFileRow = typeof sitespecificBaoPremiumFileRows.$inferSelect;

/** A premium file enriched with its provider/account names for display. */
export type BaoPremiumFileWithNames = BaoPremiumFile & {
  providerName: string | null;
  accountName: string | null;
};

/** A premium file row enriched with worker/benefit names for display/CSV. */
export type BaoPremiumFileRowWithNames = BaoPremiumFileRow & {
  workerName: string | null;
  benefitName: string | null;
};

export const generateBaoPremiumFileRequestSchema = z
  .object({
    providerId: z.string().min(1, "A provider is required"),
    accountId: z.string().min(1).optional(),
  })
  .strict();

export type GenerateBaoPremiumFileRequest = z.infer<
  typeof generateBaoPremiumFileRequestSchema
>;
