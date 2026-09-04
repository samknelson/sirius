import { foreignKey, pgTable, varchar, text, jsonb, date } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers, trustBenefits } from "../../schema";
import { toYmd } from "../../utils/date";

export const trustBenefitEligibilityExemptions = pgTable("trust_benefit_eligibility_exemptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  subscriberWorkerId: varchar("subscriber_worker_id").notNull(),
  benefitId: varchar("benefit_id").notNull(),
  eligibilityPlugins: varchar("eligibility_plugins").array().notNull(),
  startYmd: date("start_ymd").notNull(),
  endYmd: date("end_ymd"),
  description: text("description"),
  data: jsonb("data"),
}, (table) => [
  foreignKey({
    name: "trust_benefit_eligibility_exemptions_subscriber_worker_id_worke",
    columns: [table.subscriberWorkerId],
    foreignColumns: [workers.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "trust_benefit_eligibility_exemptions_benefit_id_trust_benefits_",
    columns: [table.benefitId],
    foreignColumns: [trustBenefits.id],
  }).onDelete("cascade"),
]);

export const insertTrustBenefitEligibilityExemptionSchema = createInsertSchema(trustBenefitEligibilityExemptions).omit({
  id: true,
});

export type TrustBenefitEligibilityExemption = typeof trustBenefitEligibilityExemptions.$inferSelect;
export type InsertTrustBenefitEligibilityExemption = z.infer<typeof insertTrustBenefitEligibilityExemptionSchema>;

/**
 * Provenance of an exemption that something other than a staff member's
 * manual entry created — today, a Benefit Appeal the trustees approved.
 *
 * The contract every writer and reader of the `data` jsonb shares:
 *
 * - A writer records provenance at `data.source`, as one member of this
 *   union (`trustBenefitEligibilityExemptionDataFor` builds the value).
 *   Whatever else a writer keeps in `data` is private to it.
 * - Every storage read projects the row to
 *   `TrustBenefitEligibilityExemptionView`: the columns without `data`, plus
 *   the validated `source` (or null). The raw jsonb never leaves storage, so
 *   a writer's private keys never reach a client.
 * - The HTTP create/update schemas below deliberately accept neither `data`
 *   nor `source`. Provenance is asserted by the code performing the
 *   originating action, never by a request body — otherwise any staff user
 *   could label a manual exemption as an appeal outcome.
 *
 * A member carries only the identifier a reader needs to link back to the
 * originating record, never copies of that record's facts: those would go
 * stale as the record changes, and the record is one lookup away.
 */
export const TRUST_EXEMPTION_SOURCE_BAO_APPEAL = "bao_appeal" as const;

export const trustBenefitEligibilityExemptionSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal(TRUST_EXEMPTION_SOURCE_BAO_APPEAL),
    /** `sitespecific_bao_cases.id` of the Benefit Appeal whose approval granted the exemption. */
    caseId: z.string().min(1),
  }),
]);

export type TrustBenefitEligibilityExemptionSource = z.infer<typeof trustBenefitEligibilityExemptionSourceSchema>;

/**
 * What every read of an exemption returns: the row without its raw `data`,
 * plus the provenance recorded there (null for a manual entry).
 */
export type TrustBenefitEligibilityExemptionView = Omit<TrustBenefitEligibilityExemption, "data"> & {
  source: TrustBenefitEligibilityExemptionSource | null;
};

/** The `data` value a writer stores to record where an exemption came from. */
export function trustBenefitEligibilityExemptionDataFor(
  source: TrustBenefitEligibilityExemptionSource,
): { source: TrustBenefitEligibilityExemptionSource } {
  return { source: trustBenefitEligibilityExemptionSourceSchema.parse(source) };
}

/**
 * The provenance a row records, read out of its raw `data`. No `data`, or no
 * `source` in it, means a manual entry → null. A `source` that is present but
 * not a known shape THROWS rather than reading as null: `data` is written only
 * by code, so a malformed source is a writer bug, and hiding it would quietly
 * turn an appeal-granted exemption back into an anonymous one.
 */
export function readTrustBenefitEligibilityExemptionSource(
  row: Pick<TrustBenefitEligibilityExemption, "id" | "data">,
): TrustBenefitEligibilityExemptionSource | null {
  const { data } = row;
  if (data === null || data === undefined) return null;
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`Eligibility exemption ${row.id} has non-object data; its provenance cannot be read`);
  }
  const raw = (data as Record<string, unknown>).source;
  if (raw === undefined || raw === null) return null;
  const parsed = trustBenefitEligibilityExemptionSourceSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "source"}: ${issue.message}`).join("; ");
    throw new Error(`Eligibility exemption ${row.id} records an unrecognized data.source (${issues})`);
  }
  return parsed.data;
}

const ymdOrDate = z
  .union([z.string(), z.coerce.date()])
  .transform((v) => toYmd(v) ?? String(v));

export const createTrustBenefitEligibilityExemptionRequestSchema = z
  .object({
    subscriberWorkerId: z.string().min(1),
    benefitId: z.string().min(1, 'A benefit is required'),
    eligibilityPlugins: z.array(z.string()).min(1, 'At least one eligibility check is required'),
    startYmd: ymdOrDate,
    endYmd: ymdOrDate.nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.endYmd && val.endYmd <= val.startYmd) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endYmd'], message: 'endYmd must be strictly after startYmd' });
    }
  });

export const updateTrustBenefitEligibilityExemptionRequestSchema = z
  .object({
    benefitId: z.string().min(1, 'A benefit is required').optional(),
    eligibilityPlugins: z.array(z.string()).min(1, 'At least one eligibility check is required').optional(),
    startYmd: ymdOrDate.optional(),
    endYmd: ymdOrDate.nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.endYmd && val.startYmd && val.endYmd <= val.startYmd) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endYmd'], message: 'endYmd must be strictly after startYmd' });
    }
  });

export type CreateTrustBenefitEligibilityExemptionRequest = z.infer<typeof createTrustBenefitEligibilityExemptionRequestSchema>;
export type UpdateTrustBenefitEligibilityExemptionRequest = z.infer<typeof updateTrustBenefitEligibilityExemptionRequestSchema>;
