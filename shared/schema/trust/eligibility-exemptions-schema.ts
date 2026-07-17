import { foreignKey, pgTable, varchar, text, jsonb, date } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers, trustBenefits } from "../../schema";

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

function toYmdString(value: string | Date): string {
  if (value instanceof Date) {
    const yr = value.getFullYear();
    const mo = String(value.getMonth() + 1).padStart(2, '0');
    const dy = String(value.getDate()).padStart(2, '0');
    return `${yr}-${mo}-${dy}`;
  }
  return value.length >= 10 ? value.slice(0, 10) : value;
}

const ymdOrDate = z
  .union([z.string(), z.coerce.date()])
  .transform((v) => toYmdString(v));

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
